// @ts-check

/**
 * Save export/import through plain files, independent of the cloud.
 *
 * An export is a zip with a `manifest.json` (the shared save manifest plus
 * game and app metadata) and every tracked save file under the profile's
 * archive root (the same layout the local vault and the cloud archive use).
 * Import understands those archives and also "foreign" ones: a zip the user
 * made of a saves folder, a bundle from another launcher, a single save file
 * set. Foreign archives are mapped onto the game's best save location by
 * engine family and file type.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const AdmZip = require("adm-zip");

const { buildSaveManifest } = require("../shared/saveManifest");
const {
  buildTrackedProfileDescriptor,
  listSaveProfileFiles,
  normalizeRelativeSegments,
  resolveSaveProfileDestinationPath,
} = require("./saveProfileStrategies");
const { normalizeEngineFamily } = require("./detectors/saveProfileDetector");

const SAVE_TRANSFER_FORMAT = "f95launcher-saves";
const SAVE_TRANSFER_FORMAT_VERSION = 1;

/** File extensions that are save data for the engines the app knows. */
const SAVE_FILE_EXTENSIONS = new Set([
  "save",
  "sav",
  "rpgsave",
  "rmmzsave",
  "rvdata",
  "rvdata2",
  "rxdata",
  "lsd",
  "dat",
  "json",
  "bin",
  "sol",
  "ksd",
  "bmp",
  "png",
  "txt",
  "ini",
  "cfg",
  "db",
  "xml",
  "tres",
  "res",
  "persistent",
  "bak",
  "qsp",
  "es3",
  "usd",
  "sg",
  "gd",
  "ldb",
  "ldd",
]);

/** Folder names that hold saves; a common path ending in one is a wrapper. */
const SAVE_FOLDER_NAMES = new Set([
  "saves",
  "save",
  "savedata",
  "savegames",
  "savegame",
  "saved",
  "sav",
]);

/**
 * Directory segments shared by every path (the file name itself excluded).
 * @param {string[]} relativePaths
 * @returns {string[]}
 */
function longestCommonDirectoryPrefix(relativePaths) {
  if (relativePaths.length === 0) {
    return [];
  }
  let prefix = null;
  for (const relativePath of relativePaths) {
    const segments = relativePath.split("/");
    segments.pop();
    if (prefix === null) {
      prefix = segments;
      continue;
    }
    let index = 0;
    while (index < prefix.length && index < segments.length && prefix[index] === segments[index]) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
    if (prefix.length === 0) {
      break;
    }
  }
  return prefix || [];
}

/** Where a foreign archive lands when the game has no known save folder. */
const ENGINE_DEFAULT_SAVE_PATHS = {
  renpy: "game/saves",
  rpgmaker: "save",
  unreal: "Saved/SaveGames",
  wolf: "Save",
  kirikiri: "savedata",
  html: "saves",
  unity: "saves",
  godot: "saves",
  flash: "saves",
  gamemaker: "saves",
  "": "saves",
};

/**
 * @typedef {{
 *   provider: string,
 *   rootPath: string,
 *   strategy: { type: string, payload: Record<string, any> },
 *   confidence?: number,
 *   reasons?: string[],
 * }} SaveProfile
 */

/**
 * @typedef {{
 *   game: any,
 *   profiles: SaveProfile[],
 *   syncState?: any,
 * }} SaveSnapshot
 */

function hashFileSync(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * Archive root of a profile: identical to the vault layout, so vault, cloud
 * and file exports can be read by the same code.
 * @param {SaveProfile} profile
 * @param {number} index
 */
function getArchiveRoot(profile, index) {
  const descriptor = buildTrackedProfileDescriptor(profile, index);
  const relative = descriptor?.vaultRelativePath || path.join("profiles", "misc", `profile-${index}`);
  return String(relative).replace(/\\/g, "/");
}

/**
 * @param {string} value
 */
function sanitizeFileName(value) {
  return String(value || "")
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * "Title (creator) saves 2026-09-29.zip"
 * @param {any} game
 * @param {Date=} now
 */
function buildSaveExportFileName(game, now = new Date()) {
  const title = sanitizeFileName(game?.displayTitle || game?.title || "game") || "game";
  const creator = sanitizeFileName(game?.displayCreator || game?.creator || "");
  const stamp = now.toISOString().slice(0, 10);
  return `${title}${creator ? ` (${creator})` : ""} saves ${stamp}.zip`;
}

/**
 * @param {any} game
 */
function getPrimaryInstallDirectory(game) {
  const versions = Array.isArray(game?.versions) ? [...game.versions] : [];
  versions.sort((left, right) => (right?.date_added || 0) - (left?.date_added || 0));
  for (const version of versions) {
    if (version?.game_path) {
      return String(version.game_path);
    }
  }
  return "";
}

/**
 * Detects the engine family for a snapshot (metadata first, then folder
 * markers through the same detector the profiles use).
 * @param {any} game
 * @param {string} installDirectory
 */
function resolveEngineFamily(game, installDirectory) {
  const fromMetadata = normalizeEngineFamily(game?.engine);
  if (fromMetadata) {
    return fromMetadata;
  }
  try {
    const { detectGameEngine } = require("./install/detectEngine");
    const detection = installDirectory ? detectGameEngine(installDirectory) : null;
    const family = normalizeEngineFamily(detection?.engine || "");
    if (family) {
      return family;
    }
    if (detection?.id === "wolf") return "wolf";
    if (detection?.id === "kirikiri") return "kirikiri";
    if (detection?.id === "flash") return "flash";
    if (detection?.id === "gamemaker") return "gamemaker";
  } catch {
    // Detection is best-effort.
  }
  return "";
}

// ─── Export ──────────────────────────────────────────────────────────────

/**
 * Writes a save archive for one game.
 * @param {{
 *   snapshot: SaveSnapshot,
 *   targetPath: string,
 *   appVersion?: string,
 *   identity: string,
 *   now?: () => Date,
 * }} input
 * @returns {Promise<{ archivePath: string, fileCount: number, totalBytes: number, profiles: Array<{ rootPath: string, files: number }>, manifest: any }>}
 */
async function exportGameSavesToFile(input) {
  const { snapshot } = input;
  const game = snapshot?.game || {};
  const profiles = Array.isArray(snapshot?.profiles) ? snapshot.profiles : [];
  const zip = new AdmZip();
  const manifestProfiles = [];
  const manifestEntries = [];
  const exportedProfiles = [];
  let totalBytes = 0;

  for (const [index, profile] of profiles.entries()) {
    if (!profile?.rootPath || !fs.existsSync(profile.rootPath)) {
      continue;
    }
    const archiveRoot = getArchiveRoot(profile, index);
    let files = [];
    try {
      files = await listSaveProfileFiles(profile);
    } catch {
      files = [];
    }
    let count = 0;
    for (const file of files) {
      const archivePath = `${archiveRoot}/${String(file.relativePath || "").replace(/\\/g, "/")}`;
      zip.addFile(archivePath, fs.readFileSync(file.filePath));
      manifestEntries.push({
        path: archivePath,
        size: file.size,
        mtimeMs: file.mtimeMs,
        sha256: hashFileSync(file.filePath),
      });
      totalBytes += Number(file.size) || 0;
      count += 1;
    }
    manifestProfiles.push({
      provider: profile.provider,
      rootPath: profile.rootPath,
      strategy: profile.strategy,
      archiveRoot,
      confidence: profile.confidence,
      reasons: profile.reasons,
    });
    exportedProfiles.push({ rootPath: profile.rootPath, files: count });
  }

  if (manifestEntries.length === 0) {
    const error = new Error("No save files were found for this game, nothing to export.");
    // @ts-ignore
    error.code = "no_save_files";
    throw error;
  }

  const manifest = {
    ...buildSaveManifest({
      identity: input.identity,
      generatedAt: (input.now || (() => new Date()))().toISOString(),
      profiles: manifestProfiles,
      entries: manifestEntries,
    }),
    format: SAVE_TRANSFER_FORMAT,
    formatVersion: SAVE_TRANSFER_FORMAT_VERSION,
    app: { name: "F95Launcher", version: String(input.appVersion || "") },
    game: {
      title: game?.displayTitle || game?.title || "",
      creator: game?.displayCreator || game?.creator || "",
      engine: game?.engine || "",
      threadUrl: game?.siteUrl || "",
      atlasId: game?.atlas_id || null,
      recordId: game?.record_id || null,
    },
  };
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

  await fs.promises.mkdir(path.dirname(input.targetPath), { recursive: true });
  await fs.promises.writeFile(input.targetPath, zip.toBuffer());

  return {
    archivePath: input.targetPath,
    fileCount: manifestEntries.length,
    totalBytes,
    profiles: exportedProfiles,
    manifest,
  };
}

// ─── Import ──────────────────────────────────────────────────────────────

/**
 * @param {string} rootDir
 * @param {string=} prefix
 * @returns {Array<{ relativePath: string, filePath: string, size: number }>}
 */
function walkFiles(rootDir, prefix = "") {
  /** @type {Array<{ relativePath: string, filePath: string, size: number }>} */
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, relative));
    } else if (entry.isFile()) {
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        size = 0;
      }
      out.push({ relativePath: relative, filePath: full, size });
    }
  }
  return out;
}

/**
 * @param {string} name
 */
function isLikelySaveFile(name) {
  const base = path.posix.basename(String(name || "").replace(/\\/g, "/"));
  if (!base || base === "manifest.json" || /^(thumbs\.db|\.ds_store|desktop\.ini)$/i.test(base)) {
    return false;
  }
  const extension = path.posix.extname(base).replace(/^\./, "").toLowerCase();
  if (SAVE_FILE_EXTENSIONS.has(extension)) {
    return true;
  }
  if (!extension) {
    // Ren'Py `persistent`, RPG Maker `global`, etc.
    return /^(persistent|global|config|save|savedata)/i.test(base);
  }
  return /save|slot/i.test(base);
}

/**
 * Picks the local profile a manifest profile corresponds to: same strategy
 * and payload, then same provider, then the strongest local profile.
 * @param {any} manifestProfile
 * @param {SaveProfile[]} localProfiles
 */
function matchManifestProfile(manifestProfile, localProfiles) {
  const key = JSON.stringify([
    manifestProfile?.strategy?.type || "",
    manifestProfile?.strategy?.payload || {},
  ]);
  const exact = localProfiles.find(
    (profile) =>
      JSON.stringify([profile?.strategy?.type || "", profile?.strategy?.payload || {}]) === key,
  );
  if (exact) {
    return { profile: exact, how: "same-strategy" };
  }
  const sameProvider = localProfiles.find(
    (profile) => profile?.provider && profile.provider === manifestProfile?.provider,
  );
  if (sameProvider) {
    return { profile: sameProvider, how: "same-provider" };
  }
  return { profile: null, how: "manifest-strategy" };
}

/**
 * Chooses the destination for files that came without a manifest.
 * @param {{
 *   files: Array<{ relativePath: string }>,
 *   profiles: SaveProfile[],
 *   installDirectory: string,
 *   engineFamily: string,
 * }} input
 * @returns {{ destination: string, strip: string, reason: string, files: Array<{ relativePath: string }>, skipped: Array<{ relativePath: string }> }}
 */
function planForeignSaveImport(input) {
  const files = Array.isArray(input.files) ? input.files : [];
  const normalized = files.map((file) => ({
    ...file,
    relativePath: String(file.relativePath || "").replace(/\\/g, "/").replace(/^\/+/, ""),
  }));

  // Wrapper folders are stripped so the files land directly in the save
  // folder: the whole common path when it ends in a save folder
  // ("MyGame/Saved/SaveGames/", "Stained Blood/game/saves/"), otherwise just
  // the single top-level folder a zip of a game folder starts with.
  let strip = "";
  const commonPrefix = longestCommonDirectoryPrefix(normalized.map((file) => file.relativePath));
  if (
    commonPrefix.length > 0 &&
    SAVE_FOLDER_NAMES.has(commonPrefix[commonPrefix.length - 1].toLowerCase())
  ) {
    strip = `${commonPrefix.join("/")}/`;
  } else {
    const topLevel = new Set(normalized.map((file) => file.relativePath.split("/")[0]));
    if (topLevel.size === 1 && normalized.every((file) => file.relativePath.includes("/"))) {
      strip = `${[...topLevel][0]}/`;
    }
  }

  const selected = [];
  const skipped = [];
  for (const file of normalized) {
    const rest = strip ? file.relativePath.slice(strip.length) : file.relativePath;
    if (!rest || !isLikelySaveFile(rest)) {
      skipped.push(file);
      continue;
    }
    selected.push({ ...file, relativePath: rest });
  }

  const localProfiles = Array.isArray(input.profiles) ? input.profiles : [];
  const installRelative = localProfiles
    .filter((profile) => profile?.strategy?.type === "install-relative" && profile.rootPath)
    .sort((left, right) => (Number(right.confidence) || 0) - (Number(left.confidence) || 0));
  const patternProfile = localProfiles.find(
    (profile) => profile?.strategy?.type === "install-file-patterns" && profile.rootPath,
  );
  const knownFolder = localProfiles
    .filter((profile) => profile?.strategy?.type !== "install-relative" && profile.rootPath)
    .sort((left, right) => (Number(right.confidence) || 0) - (Number(left.confidence) || 0))[0];

  const rpgRootFiles = selected.every((file) =>
    /^(save\d*\.(rvdata2?|rxdata|lsd)|file\d+\.rpgsave|global\.rpgsave|config\.rpgsave|[^/]+\.rmmzsave)$/i.test(
      file.relativePath,
    ),
  );
  if (patternProfile && selected.length > 0 && rpgRootFiles) {
    return {
      destination: patternProfile.rootPath,
      strip,
      reason: "RPG Maker save files belong next to the game executable",
      files: selected,
      skipped,
    };
  }
  if (installRelative.length > 0) {
    return {
      destination: installRelative[0].rootPath,
      strip,
      reason: "detected save folder inside the game",
      files: selected,
      skipped,
    };
  }
  if (knownFolder) {
    return {
      destination: knownFolder.rootPath,
      strip,
      reason: `detected ${knownFolder.provider || "app data"} save location`,
      files: selected,
      skipped,
    };
  }
  const fallback = ENGINE_DEFAULT_SAVE_PATHS[input.engineFamily] || ENGINE_DEFAULT_SAVE_PATHS[""];
  return {
    destination: input.installDirectory
      ? path.join(input.installDirectory, ...fallback.split("/"))
      : "",
    strip,
    reason: `no save location detected, using the ${input.engineFamily || "default"} engine folder ${fallback}`,
    files: selected,
    skipped,
  };
}

/**
 * Reads a save archive (ours or foreign) into a temp folder and describes it.
 * @param {{
 *   archivePath: string,
 *   extractArchive: (input: { archivePath: string, destinationPath: string, password?: string }) => Promise<any>,
 *   password?: string,
 *   tempRoot?: string,
 * }} input
 * @returns {Promise<{ tempDir: string, manifest: any | null, files: Array<{ relativePath: string, filePath: string, size: number }> }>}
 */
async function inspectSaveArchive(input) {
  const tempDir = await fs.promises.mkdtemp(
    path.join(input.tempRoot || os.tmpdir(), "f95-saves-import-"),
  );
  await input.extractArchive({
    archivePath: input.archivePath,
    destinationPath: tempDir,
    password: input.password || "",
  });
  const files = walkFiles(tempDir);
  let manifest = null;
  const manifestFile = files.find((file) => file.relativePath === "manifest.json");
  if (manifestFile) {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(manifestFile.filePath, "utf8"));
      if (parsed && Array.isArray(parsed.profiles) && Array.isArray(parsed.entries)) {
        manifest = parsed;
      }
    } catch {
      manifest = null;
    }
  }
  return { tempDir, manifest, files };
}

/**
 * @param {string} sourcePath
 * @param {string} destinationPath
 */
async function copyFileInto(sourcePath, destinationPath) {
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.promises.copyFile(sourcePath, destinationPath);
}

/**
 * Copies files from a save archive into the game's save locations.
 * The caller backs up the current saves first (see saveTransferIpc.js).
 * @param {{
 *   snapshot: SaveSnapshot,
 *   archivePath: string,
 *   extractArchive: (input: { archivePath: string, destinationPath: string, password?: string }) => Promise<any>,
 *   password?: string,
 *   tempRoot?: string,
 *   installDirectory?: string,
 * }} input
 * @returns {Promise<{ importedFiles: number, skippedFiles: number, destinations: Array<{ rootPath: string, files: number, how: string }>, manifest: any | null, foreign: boolean, warnings: string[] }>}
 */
async function importGameSavesFromFile(input) {
  const snapshot = input.snapshot;
  const game = snapshot?.game || {};
  const profiles = Array.isArray(snapshot?.profiles) ? snapshot.profiles : [];
  const installDirectory = input.installDirectory || getPrimaryInstallDirectory(game);
  const inspected = await inspectSaveArchive(input);
  /** @type {Array<{ rootPath: string, files: number, how: string }>} */
  const destinations = [];
  /** @type {string[]} */
  const warnings = [];
  let importedFiles = 0;
  let skippedFiles = 0;

  try {
    if (inspected.manifest) {
      for (const manifestProfile of inspected.manifest.profiles) {
        const archiveRoot = String(manifestProfile?.archiveRoot || "").replace(/\\/g, "/").replace(/\/+$/, "");
        if (!archiveRoot) {
          continue;
        }
        const matched = matchManifestProfile(manifestProfile, profiles);
        const destination = matched.profile
          ? matched.profile.rootPath
          : resolveSaveProfileDestinationPath(manifestProfile, installDirectory);
        const files = inspected.files.filter(
          (file) =>
            file.relativePath.startsWith(`${archiveRoot}/`) && file.relativePath !== "manifest.json",
        );
        if (files.length === 0) {
          continue;
        }
        if (!destination) {
          warnings.push(
            `${files.length} file(s) from ${archiveRoot} could not be placed: the save location is unknown on this computer.`,
          );
          skippedFiles += files.length;
          continue;
        }
        let count = 0;
        for (const file of files) {
          const rest = file.relativePath.slice(archiveRoot.length + 1);
          const segments = normalizeRelativeSegments(rest);
          if (segments.length === 0) {
            skippedFiles += 1;
            continue;
          }
          await copyFileInto(file.filePath, path.join(destination, ...segments));
          count += 1;
        }
        importedFiles += count;
        destinations.push({ rootPath: destination, files: count, how: matched.how });
      }
      return {
        importedFiles,
        skippedFiles,
        destinations,
        manifest: inspected.manifest,
        foreign: false,
        warnings,
      };
    }

    const plan = planForeignSaveImport({
      files: inspected.files,
      profiles,
      installDirectory,
      engineFamily: resolveEngineFamily(game, installDirectory),
    });
    skippedFiles += plan.skipped.length;
    if (plan.files.length === 0) {
      const error = new Error(
        "The archive does not contain files that look like game saves.",
      );
      // @ts-ignore
      error.code = "no_save_files";
      throw error;
    }
    if (!plan.destination) {
      const error = new Error(
        "The game has no install folder on this computer, so the saves have nowhere to go.",
      );
      // @ts-ignore
      error.code = "no_destination";
      throw error;
    }
    let count = 0;
    for (const file of plan.files) {
      const segments = normalizeRelativeSegments(file.relativePath);
      if (segments.length === 0) {
        skippedFiles += 1;
        continue;
      }
      await copyFileInto(
        /** @type {any} */ (file).filePath,
        path.join(plan.destination, ...segments),
      );
      count += 1;
    }
    importedFiles += count;
    destinations.push({ rootPath: plan.destination, files: count, how: plan.reason });
    return {
      importedFiles,
      skippedFiles,
      destinations,
      manifest: null,
      foreign: true,
      warnings,
    };
  } finally {
    await fs.promises.rm(inspected.tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  ENGINE_DEFAULT_SAVE_PATHS,
  SAVE_FILE_EXTENSIONS,
  SAVE_TRANSFER_FORMAT,
  SAVE_TRANSFER_FORMAT_VERSION,
  buildSaveExportFileName,
  exportGameSavesToFile,
  getArchiveRoot,
  importGameSavesFromFile,
  inspectSaveArchive,
  isLikelySaveFile,
  matchManifestProfile,
  planForeignSaveImport,
};
