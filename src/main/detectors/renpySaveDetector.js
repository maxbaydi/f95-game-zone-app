// @ts-check

const fs = require("fs");
const path = require("path");

const COMMON_INSTALL_SAVE_PATHS = [
  "game/saves",
  "saves",
  "save",
  "www/save",
  "www/saves",
  "userdata/save",
  "userdata/saves",
];

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactToken(value) {
  return normalizeToken(value).replace(/\s+/g, "");
}

function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isRenpyLikeGame(game) {
  const normalizedEngine = normalizeToken(game?.engine);
  if (
    normalizedEngine.includes("renpy") ||
    normalizedEngine.includes("ren py")
  ) {
    return true;
  }

  const primaryPath = game?.primaryPath || "";
  if (!primaryPath) {
    return false;
  }

  const markerCandidates = [
    path.join(primaryPath, "renpy"),
    path.join(primaryPath, "renpy.exe"),
    path.join(primaryPath, "game", "script.rpy"),
    path.join(primaryPath, "game", "script.rpa"),
    path.join(primaryPath, "game", "options.rpy"),
    path.join(primaryPath, "game", "options.rpa"),
    path.join(primaryPath, "game", "gui.rpy"),
    path.join(primaryPath, "game", "gui.rpa"),
  ];

  return markerCandidates.some((candidatePath) => pathExists(candidatePath));
}

function safeReadDir(rootPath) {
  try {
    return fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function collectRenpyCandidateNames(game) {
  const names = new Set();
  const push = (value) => {
    const normalized = normalizeToken(value);
    if (normalized) {
      names.add(normalized);
    }
  };

  push(game?.displayTitle);
  push(game?.title);
  push(game?.short_name);
  push(path.basename(game?.primaryPath || ""));

  for (const version of game?.versions || []) {
    push(path.basename(version?.game_path || ""));
    push(path.basename(version?.exec_path || "", path.extname(version?.exec_path || "")));
  }

  return [...names];
}

function detectInstallRelativeSaveProfiles(game) {
  const primaryPath = game?.primaryPath || "";
  if (!primaryPath) {
    return [];
  }

  const profiles = [];

  for (const relativePath of COMMON_INSTALL_SAVE_PATHS) {
    const rootPath = path.join(primaryPath, ...relativePath.split("/"));
    if (!pathExists(rootPath)) {
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
      reasons: [`found local save directory at ${relativePath}`],
    });
  }

  return profiles;
}

function scoreRenpyAppDataDirectory(entryName, candidateNames, hasPersistentFile) {
  const normalizedEntryName = normalizeToken(entryName);
  const compactEntryName = compactToken(entryName);
  if (!normalizedEntryName) {
    return {
      confidence: 0,
      reasons: [],
    };
  }

  let confidence = 0;
  const reasons = [];

  for (const candidateName of candidateNames) {
    const compactCandidateName = compactToken(candidateName);

    if (
      normalizedEntryName === candidateName ||
      (compactEntryName && compactEntryName === compactCandidateName)
    ) {
      confidence += 75;
      reasons.push(`AppData folder exactly matches "${candidateName}"`);
      break;
    }

    if (
      normalizedEntryName.includes(candidateName) ||
      candidateName.includes(normalizedEntryName) ||
      (compactEntryName &&
        compactCandidateName &&
        (compactEntryName.includes(compactCandidateName) ||
          compactCandidateName.includes(compactEntryName)))
    ) {
      confidence += 45;
      reasons.push(`AppData folder overlaps with "${candidateName}"`);
      break;
    }
  }

  if (hasPersistentFile) {
    confidence += 15;
    reasons.push("found persistent save file");
  }

  return {
    confidence,
    reasons,
  };
}

function detectRenpyAppDataProfiles(game, options = {}) {
  if (!isRenpyLikeGame(game)) {
    return [];
  }

  const appDataRoot =
    options.appDataRenpyRoot ||
    path.join(process.env.APPDATA || "", "RenPy");
  if (!appDataRoot || !pathExists(appDataRoot)) {
    return [];
  }

  const candidateNames = collectRenpyCandidateNames(game);
  const profiles = [];

  for (const entry of safeReadDir(appDataRoot)) {
    if (!entry.isDirectory()) {
      continue;
    }

    const rootPath = path.join(appDataRoot, entry.name);
    const hasPersistentFile = pathExists(path.join(rootPath, "persistent"));
    const score = scoreRenpyAppDataDirectory(
      entry.name,
      candidateNames,
      hasPersistentFile,
    );

    if (score.confidence < 45) {
      continue;
    }

    profiles.push({
      provider: "renpy_appdata",
      rootPath,
      strategy: {
        type: "renpy-appdata",
        payload: {
          folderName: entry.name,
        },
      },
      confidence: score.confidence,
      reasons: score.reasons,
    });
  }

  profiles.sort((left, right) => right.confidence - left.confidence);
  return profiles;
}

function detectRenpySaveProfiles(game, options = {}) {
  return [
    ...detectInstallRelativeSaveProfiles(game),
    ...detectRenpyAppDataProfiles(game, options),
  ];
}

module.exports = {
  COMMON_INSTALL_SAVE_PATHS,
  collectRenpyCandidateNames,
  compactToken,
  detectInstallRelativeSaveProfiles,
  detectRenpyAppDataProfiles,
  detectRenpySaveProfiles,
  isRenpyLikeGame,
  normalizeToken,
  pathExists,
  safeReadDir,
};
