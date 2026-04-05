// @ts-check

const path = require("path");
const {
  collectRenpyCandidateNames,
  compactToken,
  detectInstallRelativeSaveProfiles,
  detectRenpyAppDataProfiles,
  isRenpyLikeGame,
  normalizeToken,
  safeReadDir,
} = require("./renpySaveDetector");
const {
  getKnownFolderRoot,
  matchFilePatterns,
  pathExistsSync,
} = require("../saveProfileStrategies");

const RPG_MAKER_FILE_PATTERNS = [
  "Save*.rxdata",
  "Save*.rvdata",
  "Save*.rvdata2",
  "file*.rpgsave",
  "global.rpgsave",
  "config.rpgsave",
  "*.rmmzsave",
];

const RPG_MAKER_INSTALL_SAVE_PATHS = ["save", "www/save", "www/saves"];
const UNREAL_INSTALL_SAVE_PATHS = ["Saved/SaveGames"];
const COMMON_HTML_STORAGE_PATHS = [
  "User Data/Default/Local Storage",
  "User Data/Default/IndexedDB",
  "User Data/Default/Session Storage",
  "Local Storage",
  "IndexedDB",
];

/**
 * @typedef {Object} DetectedSaveProfile
 * @property {string} provider
 * @property {string} rootPath
 * @property {{ type: string, payload: Record<string, any> }} strategy
 * @property {number} confidence
 * @property {string[]} reasons
 */

function collectCandidateCreators(game) {
  const creators = new Set();
  const push = (value) => {
    const normalized = normalizeToken(value);
    if (normalized) {
      creators.add(normalized);
    }
  };

  push(game?.displayCreator);
  push(game?.creator);

  return [...creators];
}

function collectCandidateExecutables(game) {
  const executables = new Set();
  const push = (value) => {
    const token = normalizeToken(value);
    if (token) {
      executables.add(token);
    }
  };

  for (const version of Array.isArray(game?.versions) ? game.versions : []) {
    const execPath = version?.exec_path || "";
    if (!execPath) {
      continue;
    }

    push(path.basename(execPath, path.extname(execPath)));
  }

  return [...executables];
}

function collectGameCandidateNames(game) {
  return Array.from(
    new Set([
      ...collectRenpyCandidateNames(game),
      ...collectCandidateCreators(game),
      ...collectCandidateExecutables(game),
    ]),
  );
}

function scoreCandidateTokenMatch(entryName, candidateNames, exactScore, overlapScore) {
  const normalizedEntryName = normalizeToken(entryName);
  const compactEntryName = compactToken(entryName);
  if (!normalizedEntryName) {
    return {
      confidence: 0,
      reasons: [],
    };
  }

  for (const candidateName of candidateNames) {
    const compactCandidateName = compactToken(candidateName);

    if (
      normalizedEntryName === candidateName ||
      (compactEntryName && compactEntryName === compactCandidateName)
    ) {
      return {
        confidence: exactScore,
        reasons: [`folder exactly matches "${candidateName}"`],
      };
    }

    if (
      normalizedEntryName.includes(candidateName) ||
      candidateName.includes(normalizedEntryName) ||
      (compactEntryName &&
        compactCandidateName &&
        (compactEntryName.includes(compactCandidateName) ||
          compactCandidateName.includes(compactEntryName)))
    ) {
      return {
        confidence: overlapScore,
        reasons: [`folder overlaps "${candidateName}"`],
      };
    }
  }

  return {
    confidence: 0,
    reasons: [],
  };
}

function normalizeEngineFamily(engine) {
  const normalizedEngine = normalizeToken(engine);
  if (!normalizedEngine) {
    return "";
  }

  if (
    normalizedEngine.includes("renpy") ||
    normalizedEngine.includes("ren py")
  ) {
    return "renpy";
  }

  if (
    normalizedEngine.includes("rpg maker") ||
    normalizedEngine.includes("rpgm") ||
    normalizedEngine.includes("rpg maker mv") ||
    normalizedEngine.includes("rpg maker mz") ||
    normalizedEngine.includes("rpg maker vx") ||
    normalizedEngine.includes("rpg maker vx ace") ||
    normalizedEngine.includes("rpg maker xp")
  ) {
    return "rpgmaker";
  }

  if (normalizedEngine.includes("unity")) {
    return "unity";
  }

  if (normalizedEngine.includes("unreal")) {
    return "unreal";
  }

  if (normalizedEngine.includes("godot")) {
    return "godot";
  }

  if (
    normalizedEngine.includes("html") ||
    normalizedEngine.includes("javascript") ||
    normalizedEngine.includes("web") ||
    normalizedEngine.includes("electron") ||
    normalizedEngine.includes("nwjs") ||
    normalizedEngine.includes("nw js")
  ) {
    return "html";
  }

  return "";
}

function isRpgMakerLikeGame(game) {
  const primaryPath = game?.primaryPath || "";
  if (!primaryPath) {
    return false;
  }

  const markerCandidates = [
    path.join(primaryPath, "Game.ini"),
    path.join(primaryPath, "www", "js", "rpg_core.js"),
    path.join(primaryPath, "www", "js", "rpg_managers.js"),
    path.join(primaryPath, "js", "rpg_core.js"),
    path.join(primaryPath, "js", "rmmz_core.js"),
  ];

  if (markerCandidates.some((candidatePath) => pathExistsSync(candidatePath))) {
    return true;
  }

  return safeReadDir(primaryPath).some(
    (entry) =>
      entry.isFile() && matchFilePatterns(entry.name, RPG_MAKER_FILE_PATTERNS),
  );
}

function isUnityLikeGame(game) {
  const primaryPath = game?.primaryPath || "";
  if (!primaryPath) {
    return false;
  }

  const executableRoots = safeReadDir(primaryPath)
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("_Data"))
    .map((entry) => path.join(primaryPath, entry.name));

  const markerCandidates = [
    path.join(primaryPath, "UnityPlayer.dll"),
    ...executableRoots.map((dataRoot) => path.join(dataRoot, "globalgamemanagers")),
    ...executableRoots.map((dataRoot) => path.join(dataRoot, "app.info")),
    ...executableRoots.map((dataRoot) => path.join(dataRoot, "resources.assets")),
  ];

  return markerCandidates.some((candidatePath) => pathExistsSync(candidatePath));
}

function isUnrealLikeGame(game) {
  const primaryPath = game?.primaryPath || "";
  if (!primaryPath) {
    return false;
  }

  const markerCandidates = [
    path.join(primaryPath, "Engine"),
    path.join(primaryPath, "Saved"),
    path.join(primaryPath, "Content", "Paks"),
    path.join(primaryPath, "Binaries", "Win64"),
  ];

  return markerCandidates.some((candidatePath) => pathExistsSync(candidatePath));
}

function isGodotLikeGame(game) {
  const primaryPath = game?.primaryPath || "";
  if (!primaryPath) {
    return false;
  }

  return safeReadDir(primaryPath).some(
    (entry) =>
      entry.isFile() &&
      (entry.name.endsWith(".pck") || entry.name === "project.godot"),
  );
}

function isHtmlLikeGame(game) {
  const primaryPath = game?.primaryPath || "";
  if (!primaryPath) {
    return false;
  }

  const markerCandidates = [
    path.join(primaryPath, "index.html"),
    path.join(primaryPath, "package.json"),
    path.join(primaryPath, "nw.dll"),
    path.join(primaryPath, "www", "index.html"),
    path.join(primaryPath, "resources", "app.asar"),
  ];

  return markerCandidates.some((candidatePath) => pathExistsSync(candidatePath));
}

function detectEngineFamilies(game) {
  const detectedFamilies = new Set();
  const metadataFamily = normalizeEngineFamily(game?.engine);
  if (metadataFamily) {
    detectedFamilies.add(metadataFamily);
  }

  if (isRenpyLikeGame(game)) {
    detectedFamilies.add("renpy");
  }

  if (metadataFamily === "rpgmaker" || isRpgMakerLikeGame(game)) {
    detectedFamilies.add("rpgmaker");
  }

  if (metadataFamily === "unity" || isUnityLikeGame(game)) {
    detectedFamilies.add("unity");
  }

  if (metadataFamily === "unreal" || isUnrealLikeGame(game)) {
    detectedFamilies.add("unreal");
  }

  if (metadataFamily === "godot" || isGodotLikeGame(game)) {
    detectedFamilies.add("godot");
  }

  if (metadataFamily === "html" || isHtmlLikeGame(game)) {
    detectedFamilies.add("html");
  }

  return [...detectedFamilies];
}

function dedupeProfiles(profiles) {
  const seenProfiles = new Set();
  const deduped = [];

  for (const profile of profiles) {
    const key = JSON.stringify([
      profile?.provider || "",
      profile?.rootPath || "",
      profile?.strategy?.type || "",
      profile?.strategy?.payload || {},
    ]);

    if (seenProfiles.has(key)) {
      continue;
    }

    seenProfiles.add(key);
    deduped.push(profile);
  }

  deduped.sort((left, right) => {
    const confidenceDelta = (Number(right.confidence) || 0) - (Number(left.confidence) || 0);
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }

    return String(left.rootPath || "").localeCompare(String(right.rootPath || ""));
  });

  return deduped;
}

function detectRpgMakerInstallProfiles(game) {
  const primaryPath = game?.primaryPath || "";
  if (!primaryPath) {
    return [];
  }

  /** @type {DetectedSaveProfile[]} */
  const profiles = [];

  for (const relativePath of RPG_MAKER_INSTALL_SAVE_PATHS) {
    const rootPath = path.join(primaryPath, ...relativePath.split("/"));
    if (!pathExistsSync(rootPath)) {
      continue;
    }

    profiles.push({
      provider: "local",
      rootPath,
      strategy: {
        type: "install-relative",
        payload: {
          relativePath,
        },
      },
      confidence: 100,
      reasons: [`found RPG Maker save directory at ${relativePath}`],
    });
  }

  if (
    safeReadDir(primaryPath).some(
      (entry) =>
        entry.isFile() && matchFilePatterns(entry.name, RPG_MAKER_FILE_PATTERNS),
    )
  ) {
    profiles.push({
      provider: "local",
      rootPath: primaryPath,
      strategy: {
        type: "install-file-patterns",
        payload: {
          relativePath: "",
          filePatterns: RPG_MAKER_FILE_PATTERNS,
        },
      },
      confidence: 100,
      reasons: ["found RPG Maker save files in the game root"],
    });
  }

  return profiles;
}

function detectUnityLocalLowProfiles(game) {
  const localLowRoot = getKnownFolderRoot("localLow");
  if (!localLowRoot || !pathExistsSync(localLowRoot)) {
    return [];
  }

  const titleCandidates = collectRenpyCandidateNames(game);
  const creatorCandidates = collectCandidateCreators(game);
  /** @type {DetectedSaveProfile[]} */
  const profiles = [];

  for (const companyEntry of safeReadDir(localLowRoot)) {
    if (!companyEntry.isDirectory()) {
      continue;
    }

    const companyScore = scoreCandidateTokenMatch(
      companyEntry.name,
      creatorCandidates,
      18,
      10,
    );
    const companyRoot = path.join(localLowRoot, companyEntry.name);

    for (const productEntry of safeReadDir(companyRoot)) {
      if (!productEntry.isDirectory()) {
        continue;
      }

      const productScore = scoreCandidateTokenMatch(
        productEntry.name,
        titleCandidates,
        76,
        48,
      );

      const confidence =
        companyScore.confidence + productScore.confidence + 6;
      if (productScore.confidence < 48 || confidence < 54) {
        continue;
      }

      profiles.push({
        provider: "unity_locallow",
        rootPath: path.join(companyRoot, productEntry.name),
        strategy: {
          type: "windows-known-folder",
          payload: {
            baseFolder: "localLow",
            path: `${companyEntry.name}/${productEntry.name}`,
          },
        },
        confidence: Math.min(confidence, 100),
        reasons: [
          "found Unity persistent data directory in LocalLow",
          ...companyScore.reasons.map((reason) => `company ${reason}`),
          ...productScore.reasons.map((reason) => `product ${reason}`),
        ],
      });
    }
  }

  return profiles;
}

function detectUnrealProfiles(game) {
  const primaryPath = game?.primaryPath || "";
  /** @type {DetectedSaveProfile[]} */
  const profiles = [];

  for (const relativePath of UNREAL_INSTALL_SAVE_PATHS) {
    const rootPath = path.join(primaryPath, ...relativePath.split("/"));
    if (!pathExistsSync(rootPath)) {
      continue;
    }

    profiles.push({
      provider: "local",
      rootPath,
      strategy: {
        type: "install-relative",
        payload: {
          relativePath,
        },
      },
      confidence: 100,
      reasons: [`found Unreal save directory at ${relativePath}`],
    });
  }

  const localAppDataRoot = getKnownFolderRoot("localAppData");
  if (!localAppDataRoot || !pathExistsSync(localAppDataRoot)) {
    return profiles;
  }

  const titleCandidates = collectGameCandidateNames(game);
  for (const entry of safeReadDir(localAppDataRoot)) {
    if (!entry.isDirectory()) {
      continue;
    }

    const saveGamesRoot = path.join(
      localAppDataRoot,
      entry.name,
      "Saved",
      "SaveGames",
    );
    if (!pathExistsSync(saveGamesRoot)) {
      continue;
    }

    const score = scoreCandidateTokenMatch(entry.name, titleCandidates, 80, 52);
    if (score.confidence < 52) {
      continue;
    }

    profiles.push({
      provider: "unreal_localappdata",
      rootPath: saveGamesRoot,
      strategy: {
        type: "windows-known-folder",
        payload: {
          baseFolder: "localAppData",
          path: `${entry.name}/Saved/SaveGames`,
        },
      },
      confidence: Math.min(score.confidence + 10, 100),
      reasons: [
        "found Unreal save directory in Local AppData",
        ...score.reasons,
      ],
    });
  }

  return profiles;
}

function detectGodotProfiles(game) {
  const appDataRoot = getKnownFolderRoot("appdata");
  if (!appDataRoot) {
    return [];
  }

  const titleCandidates = collectRenpyCandidateNames(game);
  /** @type {DetectedSaveProfile[]} */
  const profiles = [];
  const godotRoot = path.join(appDataRoot, "Godot", "app_userdata");

  if (pathExistsSync(godotRoot)) {
    for (const entry of safeReadDir(godotRoot)) {
      if (!entry.isDirectory()) {
        continue;
      }

      const score = scoreCandidateTokenMatch(entry.name, titleCandidates, 80, 52);
      if (score.confidence < 52) {
        continue;
      }

      profiles.push({
        provider: "godot_appdata",
        rootPath: path.join(godotRoot, entry.name),
        strategy: {
          type: "windows-known-folder",
          payload: {
            baseFolder: "appdata",
            path: `Godot/app_userdata/${entry.name}`,
          },
        },
        confidence: Math.min(score.confidence + 10, 100),
        reasons: [
          "found Godot user directory under app_userdata",
          ...score.reasons,
        ],
      });
    }
  }

  for (const entry of safeReadDir(appDataRoot)) {
    if (!entry.isDirectory() || entry.name === "Godot") {
      continue;
    }

    const score = scoreCandidateTokenMatch(entry.name, titleCandidates, 72, 45);
    if (score.confidence < 60) {
      continue;
    }

    profiles.push({
      provider: "godot_appdata",
      rootPath: path.join(appDataRoot, entry.name),
      strategy: {
        type: "windows-known-folder",
        payload: {
          baseFolder: "appdata",
          path: entry.name,
        },
      },
      confidence: score.confidence,
      reasons: [
        "found possible custom Godot user directory",
        ...score.reasons,
      ],
    });
  }

  return profiles;
}

function detectHtmlStorageProfiles(game) {
  const titleCandidates = collectGameCandidateNames(game);
  const baseFolders = [
    { baseFolder: "localAppData", rootPath: getKnownFolderRoot("localAppData") },
    { baseFolder: "appdata", rootPath: getKnownFolderRoot("appdata") },
  ].filter((entry) => entry.rootPath && pathExistsSync(entry.rootPath));
  /** @type {DetectedSaveProfile[]} */
  const profiles = [];

  for (const baseFolder of baseFolders) {
    for (const appEntry of safeReadDir(baseFolder.rootPath)) {
      if (!appEntry.isDirectory()) {
        continue;
      }

      const appScore = scoreCandidateTokenMatch(
        appEntry.name,
        titleCandidates,
        72,
        45,
      );
      if (appScore.confidence < 45) {
        continue;
      }

      for (const relativeStoragePath of COMMON_HTML_STORAGE_PATHS) {
        const storageSegments = relativeStoragePath.split("/");
        const storageRoot = path.join(
          baseFolder.rootPath,
          appEntry.name,
          ...storageSegments,
        );
        if (!pathExistsSync(storageRoot)) {
          continue;
        }

        profiles.push({
          provider: "html_appdata",
          rootPath: storageRoot,
          strategy: {
            type: "windows-known-folder",
            payload: {
              baseFolder: baseFolder.baseFolder,
              path: `${appEntry.name}/${relativeStoragePath}`,
            },
          },
          confidence: Math.min(appScore.confidence + 12, 100),
          reasons: [
            "found packaged HTML app storage directory",
            ...appScore.reasons,
            `storage path ${relativeStoragePath}`,
          ],
        });
      }
    }
  }

  return profiles;
}

function detectSaveProfiles(game, options = {}) {
  /** @type {DetectedSaveProfile[]} */
  const profiles = [...detectInstallRelativeSaveProfiles(game)];
  const engineFamilies = detectEngineFamilies(game);

  if (engineFamilies.includes("renpy")) {
    profiles.push(...detectRenpyAppDataProfiles(game, options));
  }

  if (engineFamilies.includes("rpgmaker")) {
    profiles.push(...detectRpgMakerInstallProfiles(game));
  }

  if (engineFamilies.includes("unity")) {
    profiles.push(...detectUnityLocalLowProfiles(game));
  }

  if (engineFamilies.includes("unreal")) {
    profiles.push(...detectUnrealProfiles(game));
  }

  if (engineFamilies.includes("godot")) {
    profiles.push(...detectGodotProfiles(game));
  }

  if (engineFamilies.includes("html")) {
    profiles.push(...detectHtmlStorageProfiles(game));
  }

  return dedupeProfiles(profiles);
}

module.exports = {
  COMMON_HTML_STORAGE_PATHS,
  RPG_MAKER_FILE_PATTERNS,
  detectEngineFamilies,
  detectGodotProfiles,
  detectHtmlStorageProfiles,
  detectRpgMakerInstallProfiles,
  detectSaveProfiles,
  detectUnityLocalLowProfiles,
  detectUnrealProfiles,
  isGodotLikeGame,
  isHtmlLikeGame,
  isRpgMakerLikeGame,
  isUnityLikeGame,
  normalizeEngineFamily,
};
