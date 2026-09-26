// @ts-check

const nodeFs = require("fs");
const nodePath = require("path");
const nodeOs = require("os");

const GIB = 1024 ** 3;
const LOW_SPACE_BYTES = 10 * GIB;
const ROOMY_DRIVE_BYTES = 30 * GIB;
const DISK_QUERY_TIMEOUT_MS = 1500;
const LIBRARY_SUBFOLDER = ["Games", "F95Launcher"];
const SCAN_ROOT_NAMES = ["Games", "F95", "F95Zone", "F95 Games"];
const MAX_ENTRIES_PER_DIRECTORY = 400;
const MAX_CHILD_DIRECTORIES_PER_ROOT = 150;

const HELPER_EXECUTABLE_PATTERN =
  /^(?:unins\d*|uninstall|unitycrashhandler(?:32|64)?|notification_helper|crashpad_handler|dxwebsetup|dxsetup|vc_?redist.*|vcredist.*|oalinst|pythonw?|zsync(?:make)?|renpy)\.exe$/i;
const CLOUD_SYNC_SEGMENT_PATTERN =
  /^(?:onedrive(?:\s*-.*)?|dropbox|google drive|googledrive|icloud ?drive|icloud)$/i;

/**
 * @typedef {Object} FolderWarning
 * @property {string} code
 * @property {"error" | "warning" | "info"} level
 * @property {string} message
 * @property {string} [suggestedPath]
 */

/**
 * @typedef {Object} FolderInsightDeps
 * @property {typeof nodeFs} [fs]
 * @property {typeof nodePath} [path]
 * @property {string} [platform]
 * @property {string} [homeDir]
 * @property {string} [appRoot]
 * @property {string} [systemDrive]
 * @property {number} [timeoutMs]
 */

function resolveDeps(deps = {}) {
  const platform = deps.platform || process.platform;
  return {
    fs: deps.fs || nodeFs,
    path: deps.path || (platform === "win32" ? nodePath.win32 : nodePath),
    platform,
    homeDir: deps.homeDir || nodeOs.homedir(),
    appRoot: deps.appRoot || "",
    systemDrive: String(
      deps.systemDrive || process.env.SystemDrive || "C:",
    ).toUpperCase(),
    timeoutMs: deps.timeoutMs || DISK_QUERY_TIMEOUT_MS,
  };
}

function withTimeout(promise, timeoutMs, fallbackValue) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
    timer?.unref?.();
  });

  return Promise.race([promise.catch(() => fallbackValue), timeout]).finally(
    () => clearTimeout(timer),
  );
}

function formatGigabytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * GIB) {
    return `${(value / (1024 * GIB)).toFixed(1)} TB`;
  }
  return `${Math.max(0, Math.round(value / GIB))} GB`;
}

function isSamePathOrInside(parentPath, childPath, pathApi, platform) {
  if (!parentPath || !childPath) {
    return false;
  }

  const normalize = (value) => {
    const resolved = pathApi.resolve(value);
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const relative = pathApi.relative(
    normalize(parentPath),
    normalize(childPath),
  );
  return (
    relative === "" ||
    (!relative.startsWith("..") && !pathApi.isAbsolute(relative))
  );
}

function getDriveRoot(targetPath, pathApi) {
  return pathApi.parse(pathApi.resolve(targetPath)).root;
}

async function findExistingAncestor(targetPath, deps) {
  const { fs, path } = deps;
  let current = path.resolve(targetPath);

  for (;;) {
    try {
      const stats = await withTimeout(
        fs.promises.stat(current),
        deps.timeoutMs,
        null,
      );
      if (stats?.isDirectory()) {
        return current;
      }
    } catch {
      // Keep walking up until an existing directory is found.
    }

    const parent = path.dirname(current);
    if (!parent || parent === current) {
      return "";
    }
    current = parent;
  }
}

async function getDiskSpace(targetPath, deps) {
  const { fs } = deps;
  if (typeof fs.promises.statfs !== "function" || !targetPath) {
    return null;
  }

  const stats = await withTimeout(
    fs.promises.statfs(targetPath),
    deps.timeoutMs,
    null,
  );
  if (!stats) {
    return null;
  }

  return {
    freeBytes: Number(stats.bavail) * Number(stats.bsize),
    totalBytes: Number(stats.blocks) * Number(stats.bsize),
  };
}

async function probeWritable(directoryPath, deps) {
  const { fs, path } = deps;
  if (!directoryPath) {
    return false;
  }

  try {
    const probeDirectory = await fs.promises.mkdtemp(
      path.join(directoryPath, ".f95launcher-write-test-"),
    );
    await fs.promises.rmdir(probeDirectory);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure classification of a folder the user wants to keep games in.
 *
 * @param {{
 *   targetPath: string,
 *   exists: boolean,
 *   writable: boolean,
 *   freeBytes: number | null,
 * }} input
 * @param {FolderInsightDeps} [rawDeps]
 * @returns {FolderWarning[]}
 */
function classifyFolderWarnings(input, rawDeps = {}) {
  const deps = resolveDeps(rawDeps);
  const { path, platform } = deps;
  const warnings = /** @type {FolderWarning[]} */ ([]);
  const resolvedPath = path.resolve(input.targetPath);
  const segments = resolvedPath.split(/[\\/]+/).filter(Boolean);

  if (!input.writable) {
    warnings.push({
      code: "not_writable",
      level: "error",
      message:
        "F95Launcher can't write to this folder. Pick a folder you own, for example on another drive.",
    });
  }

  const protectedRoots =
    platform === "win32"
      ? [
          process.env.ProgramFiles || "C:\\Program Files",
          process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
          process.env.SystemRoot || "C:\\Windows",
        ]
      : ["/usr", "/bin", "/etc", "/opt", "/System", "/Applications"];
  if (
    protectedRoots.some((root) =>
      isSamePathOrInside(root, resolvedPath, path, platform),
    )
  ) {
    warnings.push({
      code: "protected_location",
      level: "warning",
      message:
        "This is a protected system folder. Games installed here often can't save progress.",
    });
  }

  if (
    deps.appRoot &&
    isSamePathOrInside(deps.appRoot, resolvedPath, path, platform)
  ) {
    warnings.push({
      code: "inside_app_folder",
      level: "warning",
      message:
        "This is inside F95Launcher's own folder. Updating or uninstalling the app could remove your games.",
    });
  }

  if (segments.some((segment) => CLOUD_SYNC_SEGMENT_PATTERN.test(segment))) {
    warnings.push({
      code: "cloud_synced",
      level: "warning",
      message:
        "This folder is synced to the cloud. Installs get slower and gigabytes of game files may be uploaded.",
    });
  }

  if (
    typeof input.freeBytes === "number" &&
    input.freeBytes >= 0 &&
    input.freeBytes < LOW_SPACE_BYTES
  ) {
    warnings.push({
      code: "low_space",
      level: "warning",
      message: `Only ${formatGigabytes(input.freeBytes)} free on this drive. A single game is often 1–5 GB.`,
    });
  }

  const driveRoot = getDriveRoot(resolvedPath, path);
  if (resolvedPath === driveRoot || segments.length === 0) {
    warnings.push({
      code: "drive_root",
      level: "info",
      message:
        "Games would be mixed with everything else on this drive. A dedicated subfolder keeps things tidy.",
      suggestedPath: path.join(driveRoot, ...LIBRARY_SUBFOLDER),
    });
  }

  return warnings;
}

function summarizeStatus(warnings) {
  if (warnings.some((warning) => warning.level === "error")) {
    return "error";
  }
  if (warnings.some((warning) => warning.level === "warning")) {
    return "warning";
  }
  return "ok";
}

/**
 * @param {string} targetPath
 * @param {FolderInsightDeps} [rawDeps]
 */
async function inspectFolder(targetPath, rawDeps = {}) {
  const deps = resolveDeps(rawDeps);
  const { fs, path } = deps;
  const normalizedInput = String(targetPath || "").trim();

  if (!normalizedInput || !path.isAbsolute(normalizedInput)) {
    return {
      path: normalizedInput,
      exists: false,
      writable: false,
      freeBytes: null,
      totalBytes: null,
      status: "error",
      warnings: [
        {
          code: "invalid_path",
          level: "error",
          message: "Choose a full folder path, for example D:\\Games.",
        },
      ],
    };
  }

  const resolvedPath = path.resolve(normalizedInput);
  let exists = false;
  try {
    const stats = await withTimeout(
      fs.promises.stat(resolvedPath),
      deps.timeoutMs,
      null,
    );
    exists = Boolean(stats?.isDirectory());
  } catch {
    exists = false;
  }

  const existingAncestor = exists
    ? resolvedPath
    : await findExistingAncestor(resolvedPath, deps);
  const [space, writable] = await Promise.all([
    getDiskSpace(existingAncestor, deps),
    probeWritable(existingAncestor, deps),
  ]);
  const warnings = classifyFolderWarnings(
    {
      targetPath: resolvedPath,
      exists,
      writable,
      freeBytes: space ? space.freeBytes : null,
    },
    rawDeps,
  );

  return {
    path: resolvedPath,
    exists,
    writable,
    freeBytes: space ? space.freeBytes : null,
    totalBytes: space ? space.totalBytes : null,
    status: summarizeStatus(warnings),
    warnings,
  };
}

/**
 * Read-only check for folders that are only scanned: they just need to exist
 * (a disconnected drive is the usual culprit).
 *
 * @param {string} targetPath
 * @param {FolderInsightDeps} [rawDeps]
 */
async function inspectScanFolder(targetPath, rawDeps = {}) {
  const deps = resolveDeps(rawDeps);
  const resolvedPath = deps.path.resolve(
    String(targetPath || "").trim() || ".",
  );
  let exists = false;
  try {
    const stats = await withTimeout(
      deps.fs.promises.stat(resolvedPath),
      deps.timeoutMs,
      null,
    );
    exists = Boolean(stats?.isDirectory());
  } catch {
    exists = false;
  }

  const warnings = exists
    ? []
    : [
        {
          code: "missing",
          level: "error",
          message:
            "This folder can't be found. Its drive may be disconnected, or the folder was moved.",
        },
      ];
  return {
    path: resolvedPath,
    exists,
    status: exists ? "ok" : "error",
    warnings,
  };
}

/**
 * Fixed drives with their free space (Windows only; other platforms have a
 * single filesystem tree).
 *
 * @param {FolderInsightDeps} [rawDeps]
 */
async function listDrives(rawDeps = {}) {
  const deps = resolveDeps(rawDeps);
  if (deps.platform !== "win32") {
    return [];
  }

  const letters = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const drives = await Promise.all(
    letters.map(async (letter) => {
      const root = `${letter}:\\`;
      const space = await getDiskSpace(root, deps);
      if (!space || space.totalBytes <= 0) {
        return null;
      }
      return {
        root,
        letter,
        isSystem: `${letter}:` === deps.systemDrive,
        ...space,
      };
    }),
  );

  return drives.filter(Boolean);
}

/**
 * Suggests where to keep installed games, best option first.
 *
 * @param {FolderInsightDeps & { currentFolder?: string, drives?: any[] }} [rawDeps]
 */
async function suggestLibraryFolders(rawDeps = {}) {
  const deps = resolveDeps(rawDeps);
  const { path } = deps;
  const drives = Array.isArray(rawDeps.drives)
    ? rawDeps.drives
    : await listDrives(rawDeps);
  const suggestions = [];
  const seen = new Set();
  const push = (suggestion) => {
    const key =
      deps.platform === "win32"
        ? suggestion.path.toLowerCase()
        : suggestion.path;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    suggestions.push(suggestion);
  };

  const homeFolder = path.join(deps.homeDir, ...LIBRARY_SUBFOLDER);
  const homeSpace =
    drives.find((drive) => drive.isSystem) ||
    (await getDiskSpace(await findExistingAncestor(homeFolder, deps), deps));
  const roomyDrives = drives
    .filter((drive) => !drive.isSystem && drive.freeBytes >= ROOMY_DRIVE_BYTES)
    .sort((left, right) => right.freeBytes - left.freeBytes);

  if (rawDeps.currentFolder) {
    push({
      path: path.resolve(rawDeps.currentFolder),
      label: "Current folder",
      reason: "Games are installed here now.",
      freeBytes: null,
      isCurrent: true,
    });
  }

  for (const drive of roomyDrives) {
    push({
      path: path.join(drive.root, ...LIBRARY_SUBFOLDER),
      label: `Drive ${drive.letter}:`,
      reason: "A separate drive keeps big game files away from Windows.",
      freeBytes: drive.freeBytes,
      totalBytes: drive.totalBytes,
    });
  }

  push({
    path: homeFolder,
    label: "Your user folder",
    reason: "Always writable and easy to find.",
    freeBytes: homeSpace?.freeBytes ?? null,
    totalBytes: homeSpace?.totalBytes ?? null,
  });

  const recommendedIndex = suggestions.findIndex(
    (suggestion) => !suggestion.isCurrent,
  );
  return suggestions.map((suggestion, index) => ({
    ...suggestion,
    recommended: index === recommendedIndex,
  }));
}

async function readDirectorySafe(directoryPath, deps) {
  try {
    const entries = await withTimeout(
      deps.fs.promises.readdir(directoryPath, { withFileTypes: true }),
      deps.timeoutMs,
      [],
    );
    return entries.slice(0, MAX_ENTRIES_PER_DIRECTORY);
  } catch {
    return [];
  }
}

/**
 * A folder looks like an installed game when it holds a real executable or a
 * Ren'Py / RPG Maker layout.
 */
function looksLikeGameEntries(entries) {
  return entries.some((entry) => {
    const name = String(entry.name || "");
    if (entry.isDirectory()) {
      // Ren'Py ships a "renpy" runtime folder, RPG Maker MV/MZ a "www" one.
      return /^(?:renpy|www)$/i.test(name);
    }
    return (
      entry.isFile() &&
      /\.(?:exe|x86_64|sh|app)$/i.test(name) &&
      !HELPER_EXECUTABLE_PATTERN.test(name)
    );
  });
}

async function countGameFolders(rootPath, deps) {
  const entries = await readDirectorySafe(rootPath, deps);
  if (entries.length === 0) {
    return 0;
  }

  const childDirectories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .slice(0, MAX_CHILD_DIRECTORIES_PER_ROOT);
  const results = await Promise.all(
    childDirectories.map(async (entry) =>
      looksLikeGameEntries(
        await readDirectorySafe(deps.path.join(rootPath, entry.name), deps),
      ),
    ),
  );

  return results.filter(Boolean).length;
}

/**
 * Finds folders that already contain games so the user can add them as scan
 * sources with one click.
 *
 * @param {FolderInsightDeps & {
 *   drives?: any[],
 *   extraRoots?: string[],
 *   existingSources?: string[],
 * }} [rawDeps]
 */
async function detectGameFolders(rawDeps = {}) {
  const deps = resolveDeps(rawDeps);
  const { path, platform } = deps;
  const drives = Array.isArray(rawDeps.drives)
    ? rawDeps.drives
    : await listDrives(rawDeps);
  const normalizeKey = (value) =>
    platform === "win32"
      ? path.resolve(value).toLowerCase()
      : path.resolve(value);
  const existingKeys = new Set(
    (rawDeps.existingSources || []).filter(Boolean).map(normalizeKey),
  );

  const roots = [
    ...(rawDeps.extraRoots || []).filter(Boolean),
    path.join(deps.homeDir, "Downloads"),
    path.join(deps.homeDir, "Desktop"),
    path.join(deps.homeDir, "Games"),
    path.join(deps.homeDir, "Documents", "Games"),
    ...drives.flatMap((drive) =>
      SCAN_ROOT_NAMES.map((name) => path.join(drive.root, name)),
    ),
  ];
  const uniqueRoots = [
    ...new Map(roots.map((root) => [normalizeKey(root), root])).values(),
  ];

  const results = await Promise.all(
    uniqueRoots.map(async (root) => ({
      path: path.resolve(root),
      gameCount: await countGameFolders(root, deps),
      alreadyAdded: existingKeys.has(normalizeKey(root)),
    })),
  );

  return results
    .filter((result) => result.gameCount > 0)
    .sort((left, right) => right.gameCount - left.gameCount);
}

module.exports = {
  LOW_SPACE_BYTES,
  classifyFolderWarnings,
  detectGameFolders,
  formatGigabytes,
  inspectFolder,
  inspectScanFolder,
  listDrives,
  looksLikeGameEntries,
  suggestLibraryFolders,
};
