// @ts-check

const fs = require("fs");
const path = require("path");
const { buildSaveVaultIdentity, backupGameSaves } = require("./saveVault");
const { getPrimaryInstallPath } = require("./saveProfiles");
const {
  GAME_REMOVAL_MODES,
  normalizeGameRemovalRequest,
} = require("../shared/gameRemoval");

const PROTECTED_APP_PATH_KEYS = [
  "root",
  "data",
  "cache",
  "logs",
  "backups",
  "launchers",
  "games",
  "downloads",
  "images",
  "updates",
  "templates",
  "bannerTemplates",
];

function normalizePathForComparison(targetPath) {
  const resolvedPath = path.resolve(String(targetPath || ""));
  return process.platform === "win32"
    ? resolvedPath.toLowerCase()
    : resolvedPath;
}

function isSamePath(leftPath, rightPath) {
  return (
    normalizePathForComparison(leftPath) ===
    normalizePathForComparison(rightPath)
  );
}

function isPathWithin(parentPath, candidatePath) {
  const relativePath = path.relative(
    path.resolve(parentPath),
    path.resolve(candidatePath),
  );

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function collectInstallDirectories(game) {
  const seenPaths = new Set();
  const collectedPaths = [];

  for (const version of Array.isArray(game?.versions) ? game.versions : []) {
    const rawPath = String(version?.game_path || "").trim();
    if (!rawPath) {
      continue;
    }

    const resolvedPath = path.resolve(rawPath);
    const comparisonToken = normalizePathForComparison(resolvedPath);
    if (seenPaths.has(comparisonToken)) {
      continue;
    }

    seenPaths.add(comparisonToken);
    collectedPaths.push(resolvedPath);
  }

  return collectedPaths;
}

function collectOtherGameDirectories(games, currentRecordId) {
  const seenPaths = new Set();
  const collectedPaths = [];

  for (const game of Array.isArray(games) ? games : []) {
    if (Number(game?.record_id) === Number(currentRecordId)) {
      continue;
    }

    for (const directoryPath of collectInstallDirectories(game)) {
      const comparisonToken = normalizePathForComparison(directoryPath);
      if (seenPaths.has(comparisonToken)) {
        continue;
      }

      seenPaths.add(comparisonToken);
      collectedPaths.push(directoryPath);
    }
  }

  return collectedPaths;
}

async function validateRemovableInstallDirectory(input) {
  const resolvedPath = path.resolve(input.targetPath);
  if (!(await pathExists(resolvedPath))) {
    return {
      ok: true,
      missing: true,
      resolvedPath,
    };
  }

  const stats = await fs.promises.stat(resolvedPath);
  if (!stats.isDirectory()) {
    return {
      ok: false,
      error:
        "Atlas refused to delete the selected install path because it is not a folder.",
      resolvedPath,
    };
  }

  if (path.parse(resolvedPath).root === resolvedPath) {
    return {
      ok: false,
      error:
        "Atlas refused to delete the selected install path because it resolves to a drive root.",
      resolvedPath,
    };
  }

  const protectedPaths = PROTECTED_APP_PATH_KEYS.map(
    (key) => input.appPaths?.[key],
  )
    .filter(Boolean)
    .concat(input.libraryRoot ? [input.libraryRoot] : []);

  if (
    protectedPaths.some((protectedPath) =>
      isSamePath(protectedPath, resolvedPath),
    )
  ) {
    return {
      ok: false,
      error:
        "Atlas refused to delete the selected install path because it is a protected app or library root.",
      resolvedPath,
    };
  }

  const overlappingGamePath = input.otherGameDirectories.find(
    (otherPath) =>
      isPathWithin(resolvedPath, otherPath) ||
      isPathWithin(otherPath, resolvedPath),
  );

  if (overlappingGamePath) {
    return {
      ok: false,
      error:
        "Atlas refused to delete the selected install path because it overlaps another library entry.",
      resolvedPath,
    };
  }

  return {
    ok: true,
    missing: false,
    resolvedPath,
  };
}

function collectExternalSaveDirectories(saveSnapshot, installDirectories) {
  const renpyRoot = process.env.APPDATA
    ? path.resolve(path.join(process.env.APPDATA, "RenPy"))
    : "";
  const seenPaths = new Set();
  const deletePaths = [];
  const unsupportedPaths = [];

  for (const profile of Array.isArray(saveSnapshot?.profiles)
    ? saveSnapshot.profiles
    : []) {
    const rawRootPath = String(profile?.rootPath || "").trim();
    if (!rawRootPath) {
      continue;
    }

    const resolvedRootPath = path.resolve(rawRootPath);
    if (
      installDirectories.some((installDirectory) =>
        isPathWithin(installDirectory, resolvedRootPath),
      )
    ) {
      continue;
    }

    const comparisonToken = normalizePathForComparison(resolvedRootPath);
    if (seenPaths.has(comparisonToken)) {
      continue;
    }

    const strategyType = String(profile?.strategy?.type || "");
    if (
      strategyType === "renpy-appdata" &&
      renpyRoot &&
      isPathWithin(renpyRoot, resolvedRootPath)
    ) {
      seenPaths.add(comparisonToken);
      deletePaths.push(resolvedRootPath);
      continue;
    }

    unsupportedPaths.push(resolvedRootPath);
  }

  return {
    deletePaths,
    unsupportedPaths,
  };
}

async function deleteDirectoryList(pathsToDelete) {
  const deletedPaths = [];
  const skippedMissingPaths = [];

  for (const targetPath of pathsToDelete) {
    if (!(await pathExists(targetPath))) {
      skippedMissingPaths.push(targetPath);
      continue;
    }

    await fs.promises.rm(targetPath, {
      recursive: true,
      force: false,
      maxRetries: 2,
    });
    deletedPaths.push(targetPath);
  }

  return {
    deletedPaths,
    skippedMissingPaths,
  };
}

async function deleteSaveVaultBackup(appPaths, identity) {
  const vaultRoot = path.join(appPaths.backups, "save_vault", identity);
  if (!(await pathExists(vaultRoot))) {
    return false;
  }

  await fs.promises.rm(vaultRoot, {
    recursive: true,
    force: false,
    maxRetries: 2,
  });
  return true;
}

async function removeLibraryGame(request, dependencies) {
  const normalizedRequest = normalizeGameRemovalRequest(request);
  const {
    appPaths,
    libraryRoot,
    databaseConnection,
    getGame,
    getGames,
    getSaveProfileSnapshot,
    deleteGameCompletely,
    backupGameSaves: backupGameSavesOverride,
  } = dependencies || {};

  if (
    !appPaths ||
    typeof getGame !== "function" ||
    typeof deleteGameCompletely !== "function"
  ) {
    throw new Error("Game removal service is not configured correctly.");
  }

  const game = await getGame(normalizedRequest.recordId, appPaths);
  if (!game) {
    return {
      success: false,
      code: "GAME_NOT_FOUND",
      error: "F95 Game Zone App could not find this game in your library.",
    };
  }

  const installDirectories = collectInstallDirectories(game);
  const identity = buildSaveVaultIdentity({
    threadUrl: game?.siteUrl || "",
    atlasId: game?.atlas_id || "",
    title: game?.displayTitle || game?.title || "",
    creator: game?.displayCreator || game?.creator || "",
  });
  const warnings = [];
  let saveSnapshot = null;

  if (normalizedRequest.mode !== GAME_REMOVAL_MODES.LIBRARY_ONLY) {
    if (!databaseConnection || typeof getSaveProfileSnapshot !== "function") {
      return {
        success: false,
        code: "SAVE_STATE_UNAVAILABLE",
        error:
          "F95 Game Zone App could not inspect save locations right now. Nothing was removed.",
      };
    }

    try {
      saveSnapshot = await getSaveProfileSnapshot(
        appPaths,
        databaseConnection,
        normalizedRequest.recordId,
      );
    } catch {
      return {
        success: false,
        code: "SAVE_STATE_UNAVAILABLE",
        error:
          "F95 Game Zone App could not inspect save locations right now. Nothing was removed.",
      };
    }
  }

  let backupResult = null;
  if (normalizedRequest.mode === GAME_REMOVAL_MODES.DELETE_FILES_KEEP_SAVES) {
    try {
      backupResult = await (backupGameSavesOverride || backupGameSaves)({
        appPaths,
        threadUrl: game?.siteUrl || "",
        atlasId: game?.atlas_id || "",
        title: game?.displayTitle || game?.title || "",
        creator: game?.displayCreator || game?.creator || "",
        installDirectory: getPrimaryInstallPath(game),
        profiles: saveSnapshot?.profiles || [],
      });
    } catch (error) {
      return {
        success: false,
        code: "SAVE_BACKUP_FAILED",
        error:
          "F95 Game Zone App could not preserve your save files, so the game was not removed.",
      };
    }
  }

  let removableInstallDirectories = [];
  if (normalizedRequest.mode !== GAME_REMOVAL_MODES.LIBRARY_ONLY) {
    if (typeof getGames !== "function") {
      throw new Error(
        "Game removal service requires getGames() for file deletion.",
      );
    }

    const otherGameDirectories = collectOtherGameDirectories(
      await getGames(appPaths, 0, null),
      normalizedRequest.recordId,
    );

    for (const installDirectory of installDirectories) {
      const validation = await validateRemovableInstallDirectory({
        targetPath: installDirectory,
        appPaths,
        libraryRoot,
        otherGameDirectories,
      });

      if (!validation.ok) {
        return {
          success: false,
          code: "UNSAFE_INSTALL_PATH",
          error: validation.error,
        };
      }

      if (validation.missing) {
        warnings.push(
          `Install folder already missing: ${validation.resolvedPath}`,
        );
        continue;
      }

      removableInstallDirectories.push(validation.resolvedPath);
    }
  }

  let externalSaveDirectories = [];
  if (normalizedRequest.mode === GAME_REMOVAL_MODES.DELETE_FILES_AND_SAVES) {
    const { deletePaths, unsupportedPaths } = collectExternalSaveDirectories(
      saveSnapshot,
      removableInstallDirectories,
    );

    if (unsupportedPaths.length > 0) {
      return {
        success: false,
        code: "UNSAFE_SAVE_PATH",
        error:
          "Atlas found save folders that it cannot wipe safely. Use the keep-saves option or clean them manually.",
      };
    }

    externalSaveDirectories = deletePaths;
  }

  try {
    if (normalizedRequest.mode !== GAME_REMOVAL_MODES.LIBRARY_ONLY) {
      const installDeletionResult = await deleteDirectoryList(
        removableInstallDirectories,
      );
      warnings.push(
        ...installDeletionResult.skippedMissingPaths.map(
          (folderPath) => `Install folder already missing: ${folderPath}`,
        ),
      );
      removableInstallDirectories = installDeletionResult.deletedPaths;
    }

    let deletedSaveDirectories = [];
    if (normalizedRequest.mode === GAME_REMOVAL_MODES.DELETE_FILES_AND_SAVES) {
      const saveDeletionResult = await deleteDirectoryList(
        externalSaveDirectories,
      );
      warnings.push(
        ...saveDeletionResult.skippedMissingPaths.map(
          (folderPath) => `Save folder already missing: ${folderPath}`,
        ),
      );
      deletedSaveDirectories = saveDeletionResult.deletedPaths;
      externalSaveDirectories = deletedSaveDirectories;

      try {
        const removedVault = await deleteSaveVaultBackup(appPaths, identity);
        if (!removedVault) {
          warnings.push("No local save backup copy was found to remove.");
        }
      } catch {
        warnings.push(
          "F95 Game Zone App could not remove an older local save backup copy.",
        );
      }
    }

    const deleteResult = await deleteGameCompletely(
      normalizedRequest.recordId,
      appPaths,
    );

    if (!deleteResult?.success) {
      return {
        success: false,
        code: "LIBRARY_DELETE_FAILED",
        error:
          deleteResult?.error ||
          "F95 Game Zone App could not remove the game from your library.",
      };
    }

    return {
      success: true,
      recordId: normalizedRequest.recordId,
      mode: normalizedRequest.mode,
      deletedInstallDirectories: removableInstallDirectories,
      deletedSaveDirectories: externalSaveDirectories,
      keptSaveBackup:
        normalizedRequest.mode === GAME_REMOVAL_MODES.DELETE_FILES_KEEP_SAVES &&
        Boolean(backupResult),
      warnings,
    };
  } catch {
    return {
      success: false,
      code: "FILESYSTEM_DELETE_FAILED",
      error:
        "F95 Game Zone App could not finish deleting the selected files. The library entry was kept.",
    };
  }
}

module.exports = {
  collectExternalSaveDirectories,
  collectInstallDirectories,
  isPathWithin,
  removeLibraryGame,
  validateRemovableInstallDirectory,
};
