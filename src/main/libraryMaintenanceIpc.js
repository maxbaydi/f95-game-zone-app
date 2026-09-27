// @ts-check

const fs = require("fs");
const path = require("path");
const {
  listGameExecutables,
  relocateGameVersion,
  resolveExecutableWithinFolder,
  setGameExecutable,
  REPAIR_ERROR_MESSAGES,
} = require("./libraryVersionRepair");
const { backupDatabaseFile } = require("./libraryReset");
const { listLibraryBackups, restoreLibraryBackup } = require("./libraryBackups");
const { linkGameToCatalog } = require("./catalogLink");
const { deleteLiveVersion } = require("./db/liveVersionsStore");
const { normalizePathKey } = require("./libraryDuplicates");

/**
 * IPC for library maintenance: locating moved folders, choosing launchers,
 * library backups, linking records to the catalog and live thread checks.
 * Every handler validates its input, logs failures with a scope prefix and
 * returns `{ success: false, error }` with text meant for the user instead of
 * throwing into the renderer.
 */

const SCOPES = Object.freeze({
  repair: "[library.repair]",
  backups: "[library.backups]",
  catalog: "[library.catalog]",
  live: "[library.live]",
});

const MAX_TEXT_LENGTH = 4096;
const ANCESTOR_SEARCH_DEPTH = 6;

const MESSAGES = Object.freeze({
  gameNotFound: "This game is no longer in your library.",
  folderUnknown: "That folder is not part of your library.",
  unexpected: "Something went wrong. Try again.",
  backupFailed: "The library could not be backed up. Check the free space on the drive and try again.",
  restoreBusy: "Wait for the library scan to finish, then try again.",
  liveBusy: "Thread checks are not available right now. Try again in a moment.",
});

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parsePositiveInteger(value) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return Number.isInteger(number) && Number(number) > 0 ? Number(number) : null;
}

/**
 * Version labels are matched exactly as stored, so they are not trimmed.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function readVersionLabel(value) {
  return typeof value === "string" && value.length <= 500 ? value : null;
}

/**
 * @param {unknown} value
 * @param {number=} maxLength
 * @returns {string | null} the trimmed string, or null when not a string or too long
 */
function readText(value, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > maxLength ? null : trimmed;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Closest folder of `targetPath` (itself excluded) that still exists.
 *
 * @param {string} targetPath
 * @returns {string}
 */
function findExistingAncestor(targetPath) {
  let current = String(targetPath || "").trim();
  for (let depth = 0; current && depth < ANCESTOR_SEARCH_DEPTH; depth += 1) {
    const parent = path.dirname(current);
    if (!parent || parent === current) {
      return "";
    }
    if (fs.existsSync(parent)) {
      return parent;
    }
    current = parent;
  }
  return "";
}

/**
 * @param {any} game
 * @param {string} version
 * @returns {any | null}
 */
function findVersionRow(game, version) {
  return (
    (Array.isArray(game?.versions) ? game.versions : []).find(
      (entry) => String(entry?.version ?? "") === version,
    ) || null
  );
}

/**
 * @param {any[]} games
 * @param {string} gamePath
 * @returns {boolean}
 */
function isKnownInstallFolder(games, gamePath) {
  const key = normalizePathKey(gamePath);
  return Boolean(key) && games.some((game) =>
    (Array.isArray(game?.versions) ? game.versions : []).some(
      (version) => normalizePathKey(version?.game_path) === key,
    ),
  );
}

/**
 * @param {{
 *   ipcMain: { handle: (channel: string, handler: (event: any, payload?: any) => any) => void },
 *   dialog: { showOpenDialog: Function },
 *   getParentWindow: (event: any) => any,
 *   getMainWindow: () => any,
 *   appPaths: any,
 *   getDatabaseConnection: () => any,
 *   getGames: (appPaths: any, offset: number, limit: number | null) => Promise<any[]>,
 *   getGame: (recordId: number, appPaths: any) => Promise<any>,
 *   loadLibraryGame: (recordId: number) => Promise<any>,
 *   getConfiguredLibraryFolder: () => string,
 *   getGameExtensions: () => string[],
 *   isLibraryScanRunning: () => boolean,
 *   updateVersionLocation: (recordId: number, version: string, gamePath: string, execPath: string) => Promise<number>,
 *   updateVersionExecutable: (recordId: number, version: string, execPath: string) => Promise<number>,
 *   catalogDeps: Parameters<typeof linkGameToCatalog>[0]["deps"],
 *   downloadImages: (recordId: number, atlasId: number, onProgress: Function, banners: boolean, previews: boolean, previewLimit: any, videos: boolean) => Promise<unknown>,
 *   previewLimit: any,
 *   refreshSaveProfiles: (recordId: number) => Promise<unknown>,
 *   broadcastGamesLibrarySynced: (payload: any) => void,
 *   getLiveUpdateChecker: () => any,
 *   logger?: { info: Function, warn: Function, error: Function }
 * }} deps
 */
function registerLibraryMaintenanceIpc(deps) {
  const logger = deps.logger || console;
  const { ipcMain } = deps;

  /**
   * @param {string} channel
   * @param {unknown} payload
   */
  const sendToMainWindow = (channel, payload) => {
    const window = deps.getMainWindow();
    if (window && !window.isDestroyed?.() && window.webContents && !window.webContents.isDestroyed?.()) {
      window.webContents.send(channel, payload);
    }
  };

  const invalidInput = (/** @type {string} */ error = MESSAGES.gameNotFound) => ({
    success: false,
    code: "INVALID_INPUT",
    error,
  });

  const refreshSaveProfilesSafely = async (/** @type {number} */ recordId) => {
    if (!deps.getDatabaseConnection()) {
      return;
    }
    await deps.refreshSaveProfiles(recordId).catch((error) => {
      logger.warn(`${SCOPES.repair} Save locations were not refreshed:`, {
        recordId,
        error: describeError(error),
      });
    });
  };

  // ── Locate folder / choose launcher ────────────────────────────────────

  ipcMain.handle("relocate-game-version", async (event, payload) => {
    const recordId = parsePositiveInteger(payload?.recordId);
    const version = readVersionLabel(payload?.version);
    if (!recordId || version === null) {
      return invalidInput();
    }

    try {
      const game = await deps.getGame(recordId, deps.appPaths);
      const versionRow = game ? findVersionRow(game, version) : null;
      if (!game || !versionRow) {
        return invalidInput(game ? REPAIR_ERROR_MESSAGES.VERSION_NOT_FOUND : MESSAGES.gameNotFound);
      }

      const oldPath = String(versionRow.game_path || "");
      const title = game.displayTitle || game.title || "this game";
      const defaultPath =
        findExistingAncestor(oldPath) || deps.getConfiguredLibraryFolder() || undefined;
      const selection = await deps.dialog.showOpenDialog(deps.getParentWindow(event), {
        title: `Where is ${title} now?`,
        buttonLabel: "Use this folder",
        defaultPath,
        properties: ["openDirectory"],
      });
      if (selection?.canceled || !selection?.filePaths?.[0]) {
        return { success: false, cancelled: true };
      }

      const games = await deps.getGames(deps.appPaths, 0, null);
      const otherGamePaths = games
        .filter((entry) => Number(entry?.record_id) !== recordId)
        .flatMap((entry) =>
          (Array.isArray(entry?.versions) ? entry.versions : []).map((row) =>
            String(row?.game_path || ""),
          ),
        )
        .filter(Boolean);

      const result = await relocateGameVersion({
        recordId,
        version,
        oldPath,
        newPath: selection.filePaths[0],
        title: game.title || "",
        creator: game.creator || "",
        gameExtensions: deps.getGameExtensions(),
        otherGamePaths,
        updateVersionLocation: deps.updateVersionLocation,
      });
      if (result.success === false) {
        logger.warn(`${SCOPES.repair} Locate refused:`, {
          recordId,
          version,
          code: result.code,
        });
        return result;
      }

      logger.info(`${SCOPES.repair} Version moved to a new folder:`, {
        recordId,
        version,
        executableFound: Boolean(result.execPath),
      });
      await refreshSaveProfilesSafely(recordId);
      sendToMainWindow("game-updated", recordId);
      return {
        ...result,
        success: true,
        game: await deps.loadLibraryGame(recordId),
      };
    } catch (error) {
      logger.error(`${SCOPES.repair} Locate failed:`, { recordId, error: describeError(error) });
      return { success: false, code: "UPDATE_FAILED", error: REPAIR_ERROR_MESSAGES.UPDATE_FAILED };
    }
  });

  /**
   * @param {unknown} value
   * @returns {Promise<string | null>} the folder when it belongs to a library version
   */
  const readKnownInstallFolder = async (value) => {
    const gamePath = readText(value);
    if (!gamePath || !path.isAbsolute(gamePath)) {
      return null;
    }
    const games = await deps.getGames(deps.appPaths, 0, null);
    return isKnownInstallFolder(games, gamePath) ? gamePath : null;
  };

  ipcMain.handle("list-game-executables", async (_event, payload) => {
    try {
      const gamePath = await readKnownInstallFolder(payload?.gamePath);
      if (!gamePath) {
        return invalidInput(MESSAGES.folderUnknown);
      }
      return listGameExecutables({
        gamePath,
        gameExtensions: deps.getGameExtensions(),
      });
    } catch (error) {
      logger.error(`${SCOPES.repair} Listing launchers failed:`, describeError(error));
      return { success: false, code: "FOLDER_UNREADABLE", error: REPAIR_ERROR_MESSAGES.FOLDER_UNREADABLE };
    }
  });

  ipcMain.handle("pick-game-executable", async (event, payload) => {
    try {
      const gamePath = await readKnownInstallFolder(payload?.gamePath);
      if (!gamePath) {
        return invalidInput(MESSAGES.folderUnknown);
      }
      if (!fs.existsSync(gamePath)) {
        return { success: false, code: "FOLDER_MISSING", error: REPAIR_ERROR_MESSAGES.FOLDER_MISSING };
      }

      const extensions = deps.getGameExtensions();
      const selection = await deps.dialog.showOpenDialog(deps.getParentWindow(event), {
        title: "Choose the file that starts the game",
        buttonLabel: "Use this file",
        defaultPath: gamePath,
        properties: ["openFile"],
        filters: [
          ...(extensions.length > 0 ? [{ name: "Game launchers", extensions }] : []),
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (selection?.canceled || !selection?.filePaths?.[0]) {
        return { success: false, cancelled: true };
      }

      const resolved = resolveExecutableWithinFolder(gamePath, selection.filePaths[0]);
      if (!resolved.ok) {
        return {
          success: false,
          code: "EXECUTABLE_OUTSIDE_FOLDER",
          error: REPAIR_ERROR_MESSAGES.EXECUTABLE_OUTSIDE_FOLDER,
        };
      }
      return { success: true, executable: resolved.relativePath };
    } catch (error) {
      logger.error(`${SCOPES.repair} Picking a launcher failed:`, describeError(error));
      return { success: false, code: "UNEXPECTED", error: MESSAGES.unexpected };
    }
  });

  ipcMain.handle("set-game-executable", async (_event, payload) => {
    const recordId = parsePositiveInteger(payload?.recordId);
    const version = readVersionLabel(payload?.version);
    const executable = readText(payload?.executable);
    if (!recordId || version === null || !executable) {
      return invalidInput();
    }

    try {
      const game = await deps.getGame(recordId, deps.appPaths);
      const versionRow = game ? findVersionRow(game, version) : null;
      if (!game || !versionRow) {
        return invalidInput(game ? REPAIR_ERROR_MESSAGES.VERSION_NOT_FOUND : MESSAGES.gameNotFound);
      }

      // The folder always comes from the library, never from the renderer.
      const gamePath = String(versionRow.game_path || "");
      const requestedPath = readText(payload?.gamePath);
      if (requestedPath && normalizePathKey(requestedPath) !== normalizePathKey(gamePath)) {
        return invalidInput(MESSAGES.folderUnknown);
      }

      const result = await setGameExecutable({
        recordId,
        version,
        gamePath,
        executable,
        updateVersionExecutable: deps.updateVersionExecutable,
      });
      if (result.success === false) {
        logger.warn(`${SCOPES.repair} Launcher refused:`, { recordId, version, code: result.code });
        return result;
      }

      logger.info(`${SCOPES.repair} Launcher chosen:`, { recordId, version });
      sendToMainWindow("game-updated", recordId);
      return {
        ...result,
        success: true,
        game: await deps.loadLibraryGame(recordId),
      };
    } catch (error) {
      logger.error(`${SCOPES.repair} Saving the launcher failed:`, {
        recordId,
        error: describeError(error),
      });
      return { success: false, code: "UPDATE_FAILED", error: REPAIR_ERROR_MESSAGES.UPDATE_FAILED };
    }
  });

  // ── Library backups ─────────────────────────────────────────────────────

  ipcMain.handle("list-library-backups", async () => {
    try {
      return await listLibraryBackups({ appPaths: deps.appPaths });
    } catch (error) {
      logger.error(`${SCOPES.backups} Listing backups failed:`, describeError(error));
      return [];
    }
  });

  ipcMain.handle("create-library-backup", async () => {
    const db = deps.getDatabaseConnection();
    if (!db) {
      return { success: false, error: MESSAGES.backupFailed };
    }
    try {
      const backupPath = await backupDatabaseFile({ appPaths: deps.appPaths, db, logger });
      logger.info(`${SCOPES.backups} Backup created.`);
      return { success: true, backupPath };
    } catch (error) {
      logger.error(`${SCOPES.backups} Backup failed:`, describeError(error));
      return { success: false, error: MESSAGES.backupFailed };
    }
  });

  /**
   * Banners of restored records are downloaded again in the background; the
   * restore itself does not wait for the network.
   *
   * @param {number[]} recordIds
   */
  const redownloadRestoredBanners = async (recordIds) => {
    const wanted = new Set(recordIds);
    const games = await deps.getGames(deps.appPaths, 0, null);
    const targets = games.filter(
      (game) => wanted.has(Number(game?.record_id)) && parsePositiveInteger(game?.atlas_id),
    );
    for (const game of targets) {
      try {
        await deps.downloadImages(
          Number(game.record_id),
          Number(game.atlas_id),
          () => {},
          true,
          false,
          "0",
          false,
        );
        sendToMainWindow("game-updated", Number(game.record_id));
      } catch (error) {
        logger.warn(`${SCOPES.backups} Banner download after restore failed:`, {
          recordId: game.record_id,
          error: describeError(error),
        });
      }
    }
  };

  ipcMain.handle("restore-library-backup", async (_event, payload) => {
    const backupPath = readText(payload?.backupPath);
    if (!backupPath) {
      return { success: false, code: "INVALID_INPUT", error: "Choose a backup to restore." };
    }
    const db = deps.getDatabaseConnection();
    if (!db) {
      return { success: false, code: "LIBRARY_RESTORE_FAILED", error: MESSAGES.unexpected };
    }
    if (deps.isLibraryScanRunning()) {
      return { success: false, code: "LIBRARY_BUSY", error: MESSAGES.restoreBusy };
    }

    try {
      const result = await restoreLibraryBackup({ appPaths: deps.appPaths, db, backupPath, logger });
      if (!result.success) {
        logger.warn(`${SCOPES.backups} Restore refused:`, { code: result.error.code });
        return { success: false, code: result.error.code, error: result.error.message };
      }

      logger.info(`${SCOPES.backups} Library restored:`, {
        restored: result.restored,
        removedImageDirectories: result.removedImageDirectories.length,
      });
      sendToMainWindow("library-reset", { restored: true });
      deps.broadcastGamesLibrarySynced({ reason: "library-restore" });
      void redownloadRestoredBanners(result.recordIds).catch((error) => {
        logger.warn(`${SCOPES.backups} Banner refresh after restore failed:`, describeError(error));
      });

      return {
        success: true,
        restoredGames: Number(result.restored.games || 0),
        restored: result.restored,
      };
    } catch (error) {
      logger.error(`${SCOPES.backups} Restore failed:`, describeError(error));
      return {
        success: false,
        code: "LIBRARY_RESTORE_FAILED",
        error: "This backup could not be restored. Your library was not changed.",
      };
    }
  });

  // ── Catalog link ────────────────────────────────────────────────────────

  ipcMain.handle("link-game-to-catalog", async (_event, payload) => {
    const recordId = parsePositiveInteger(payload?.recordId);
    const atlasId = parsePositiveInteger(payload?.atlasId);
    if (!recordId || !atlasId) {
      return invalidInput("Choose a game from the catalog list.");
    }

    try {
      const game = await deps.getGame(recordId, deps.appPaths);
      if (!game) {
        return invalidInput();
      }

      const result = await linkGameToCatalog({
        recordId,
        atlasId,
        game,
        deps: deps.catalogDeps,
        logger,
      });
      if (!result.success) {
        return result;
      }

      // The thread may have changed: the next check reads the new one.
      const db = deps.getDatabaseConnection();
      if (db) {
        await deleteLiveVersion(db, recordId).catch((error) => {
          logger.warn(`${SCOPES.catalog} Old thread version was not cleared:`, describeError(error));
        });
      }

      logger.info(`${SCOPES.catalog} Game linked to the catalog:`, {
        recordId,
        atlasId,
        hasThread: Boolean(result.f95Id),
        metadataUpdated: result.metadataUpdated,
      });
      sendToMainWindow("game-updated", recordId);
      void deps
        .downloadImages(recordId, atlasId, () => {}, true, true, deps.previewLimit, false)
        .then(() => sendToMainWindow("game-updated", recordId))
        .catch((error) => {
          logger.warn(`${SCOPES.catalog} Images were not downloaded:`, {
            recordId,
            error: describeError(error),
          });
        });

      return {
        ...result,
        game: await deps.loadLibraryGame(recordId),
      };
    } catch (error) {
      logger.error(`${SCOPES.catalog} Linking failed:`, { recordId, error: describeError(error) });
      return {
        success: false,
        code: "CATALOG_LINK_FAILED",
        error: "This game could not be linked to the catalog entry. Try again or pick another entry.",
      };
    }
  });

  // ── Live thread checks ──────────────────────────────────────────────────

  ipcMain.handle("check-live-updates", async (_event, payload) => {
    const checker = deps.getLiveUpdateChecker();
    if (!checker) {
      return { success: false, error: MESSAGES.liveBusy };
    }
    try {
      const summary = await checker.runNow({
        reason: "manual",
        force: payload?.force === true,
        favoritesOnly:
          typeof payload?.favoritesOnly === "boolean" ? payload.favoritesOnly : undefined,
      });
      return {
        success: summary.skippedReason !== "error",
        checked: summary.checked,
        updated: summary.updated,
        failed: summary.failed,
        skippedReason: summary.skippedReason,
        finishedAt: summary.finishedAt,
        ...(summary.skippedReason === "error"
          ? { error: "The threads could not be checked. Try again later." }
          : {}),
      };
    } catch (error) {
      logger.error(`${SCOPES.live} Manual check failed:`, describeError(error));
      return { success: false, error: "The threads could not be checked. Try again later." };
    }
  });

  ipcMain.handle("get-live-update-state", async () => {
    const checker = deps.getLiveUpdateChecker();
    if (!checker) {
      return { running: false, lastRun: null, nextRunAt: null };
    }
    const state = checker.getState();
    return {
      running: Boolean(state.running),
      nextRunAt: state.nextRunAt,
      lastRun: state.lastRun
        ? {
            reason: state.lastRun.reason,
            finishedAt: state.lastRun.finishedAt,
            checked: state.lastRun.checked,
            updated: state.lastRun.updated,
            failed: state.lastRun.failed,
            skippedReason: state.lastRun.skippedReason,
          }
        : null,
    };
  });
}

module.exports = {
  findExistingAncestor,
  isKnownInstallFolder,
  parsePositiveInteger,
  readText,
  registerLibraryMaintenanceIpc,
};
