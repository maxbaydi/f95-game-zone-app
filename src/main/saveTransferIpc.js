// @ts-check

/**
 * IPC for file-based save export/import. Everything here works without a
 * cloud account: the local vault is the safety net, a zip is the transport.
 */

const fs = require("fs");
const path = require("path");

const { extractArchiveSafely, isArchiveError } = require("./archive/extractArchive");
const { describeArchiveErrorCode } = require("./archive/archiveErrors");
const {
  buildSaveExportFileName,
  exportGameSavesToFile,
  importGameSavesFromFile,
} = require("./saveTransfer");
const { backupGameSaves, buildSaveVaultIdentity } = require("./saveVault");

const SAVE_ARCHIVE_EXTENSIONS = ["zip", "7z", "rar", "tar", "gz", "tgz"];

/**
 * @param {unknown} error
 */
function describeError(error) {
  const anyError = /** @type {any} */ (error);
  if (isArchiveError(error)) {
    return describeArchiveErrorCode(anyError.code) || anyError.message;
  }
  return anyError?.userMessage || anyError?.message || String(error);
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
 * @param {{
 *   ipcMain: { handle: (channel: string, handler: (event: any, payload?: any) => any) => void },
 *   dialog: { showOpenDialog: Function, showSaveDialog: Function },
 *   shell: { openPath: (target: string) => Promise<string>, showItemInFolder: (target: string) => void },
 *   app: { getPath: (name: any) => string, getVersion: () => string },
 *   getParentWindow: (event: any) => any,
 *   appPaths: any,
 *   getDatabaseConnection: () => any,
 *   getSaveProfileSnapshot: (recordId: number) => Promise<any>,
 *   refreshSaveProfiles: (recordId: number) => Promise<any>,
 *   listGames: () => Promise<any[]>,
 *   logger?: { info: Function, warn: Function, error: Function },
 * }} deps
 */
function registerSaveTransferIpc(deps) {
  const logger = deps.logger || console;
  const { ipcMain } = deps;

  const parseRecordId = (value) => {
    const recordId = Number.parseInt(String(value ?? ""), 10);
    return Number.isInteger(recordId) && recordId > 0 ? recordId : 0;
  };

  const loadSnapshot = async (/** @type {number} */ recordId, refresh = false) => {
    if (!deps.getDatabaseConnection()) {
      throw new Error("The library database is not ready yet.");
    }
    const snapshot = refresh
      ? await deps.refreshSaveProfiles(recordId)
      : await deps.getSaveProfileSnapshot(recordId);
    if (!snapshot?.game) {
      throw new Error("This game is no longer in the library.");
    }
    return snapshot;
  };

  const buildVaultInput = (snapshot) => {
    const game = snapshot.game;
    return {
      appPaths: deps.appPaths,
      threadUrl: game?.siteUrl || "",
      atlasId: game?.atlas_id || "",
      title: game?.displayTitle || game?.title || "",
      creator: game?.displayCreator || game?.creator || "",
      installDirectory: getPrimaryInstallDirectory(game),
      profiles: snapshot.profiles || [],
    };
  };

  const identityOf = (snapshot) =>
    buildSaveVaultIdentity({
      threadUrl: snapshot.game?.siteUrl || "",
      atlasId: snapshot.game?.atlas_id || "",
      title: snapshot.game?.displayTitle || snapshot.game?.title || "",
      creator: snapshot.game?.displayCreator || snapshot.game?.creator || "",
    });

  // ── Export one game ──────────────────────────────────────────────────

  ipcMain.handle("export-game-saves", async (event, payload) => {
    const recordId = parseRecordId(typeof payload === "object" ? payload?.recordId : payload);
    if (!recordId) {
      return { success: false, error: "Unknown game." };
    }
    try {
      // Re-detect first so a save folder created since the last scan is included.
      const snapshot = await loadSnapshot(recordId, true);
      const defaultName = buildSaveExportFileName(snapshot.game);
      const selection = await deps.dialog.showSaveDialog(deps.getParentWindow(event), {
        title: `Export saves of ${snapshot.game.displayTitle || snapshot.game.title}`,
        defaultPath: path.join(deps.app.getPath("documents"), defaultName),
        buttonLabel: "Export",
        filters: [{ name: "Save archive", extensions: ["zip"] }],
      });
      if (selection?.canceled || !selection?.filePath) {
        return { success: false, cancelled: true };
      }
      const targetPath = /\.zip$/i.test(selection.filePath)
        ? selection.filePath
        : `${selection.filePath}.zip`;
      const result = await exportGameSavesToFile({
        snapshot,
        targetPath,
        appVersion: deps.app.getVersion(),
        identity: identityOf(snapshot),
      });
      logger.info("[save.transfer] Exported saves:", {
        recordId,
        archivePath: result.archivePath,
        fileCount: result.fileCount,
      });
      return {
        success: true,
        archivePath: result.archivePath,
        fileCount: result.fileCount,
        totalBytes: result.totalBytes,
        profiles: result.profiles,
      };
    } catch (error) {
      logger.error("[save.transfer] Export failed:", error);
      return { success: false, error: describeError(error), code: /** @type {any} */ (error)?.code || "" };
    }
  });

  // ── Import into one game ─────────────────────────────────────────────

  ipcMain.handle("import-game-saves", async (event, payload) => {
    const recordId = parseRecordId(typeof payload === "object" ? payload?.recordId : payload);
    const password = typeof payload === "object" ? String(payload?.password || "") : "";
    const archiveFromPayload = typeof payload === "object" ? String(payload?.archivePath || "") : "";
    if (!recordId) {
      return { success: false, error: "Unknown game." };
    }
    try {
      const snapshot = await loadSnapshot(recordId, true);
      let archivePath = archiveFromPayload;
      if (!archivePath) {
        const selection = await deps.dialog.showOpenDialog(deps.getParentWindow(event), {
          title: `Import saves into ${snapshot.game.displayTitle || snapshot.game.title}`,
          defaultPath: deps.app.getPath("documents"),
          buttonLabel: "Import",
          properties: ["openFile"],
          filters: [
            { name: "Save archives", extensions: SAVE_ARCHIVE_EXTENSIONS },
            { name: "All files", extensions: ["*"] },
          ],
        });
        if (selection?.canceled || !selection?.filePaths?.[0]) {
          return { success: false, cancelled: true };
        }
        archivePath = selection.filePaths[0];
      }

      // Safety net: whatever is there now goes to the vault before anything
      // is overwritten.
      let backup = null;
      try {
        backup = await backupGameSaves(buildVaultInput(snapshot));
      } catch (error) {
        logger.warn("[save.transfer] Vault backup before import failed:", error);
      }

      const result = await importGameSavesFromFile({
        snapshot,
        archivePath,
        password,
        extractArchive: extractArchiveSafely,
        tempRoot: deps.appPaths.cache,
      });
      await deps.refreshSaveProfiles(recordId).catch(() => {});
      logger.info("[save.transfer] Imported saves:", {
        recordId,
        archivePath,
        importedFiles: result.importedFiles,
        destinations: result.destinations,
      });
      return {
        success: true,
        archivePath,
        importedFiles: result.importedFiles,
        skippedFiles: result.skippedFiles,
        destinations: result.destinations,
        foreign: result.foreign,
        warnings: result.warnings,
        backupIdentity: backup?.identity || "",
        backedUpPaths: backup?.backedUpPaths || [],
      };
    } catch (error) {
      logger.error("[save.transfer] Import failed:", error);
      const anyError = /** @type {any} */ (error);
      return {
        success: false,
        error: describeError(error),
        code: anyError?.code || "",
        needsPassword:
          isArchiveError(error) &&
          ["archive_encrypted", "archive_wrong_password"].includes(anyError.code),
      };
    }
  });

  // ── Export every game with saves into a folder ───────────────────────

  ipcMain.handle("export-all-game-saves", async (event) => {
    try {
      const selection = await deps.dialog.showOpenDialog(deps.getParentWindow(event), {
        title: "Choose a folder for the save archives",
        defaultPath: deps.app.getPath("documents"),
        buttonLabel: "Export here",
        properties: ["openDirectory", "createDirectory"],
      });
      if (selection?.canceled || !selection?.filePaths?.[0]) {
        return { success: false, cancelled: true };
      }
      const folder = selection.filePaths[0];
      const games = await deps.listGames();
      /** @type {Array<{ recordId: number, title: string, archivePath: string, fileCount: number }>} */
      const exported = [];
      /** @type {Array<{ recordId: number, title: string, reason: string }>} */
      const skipped = [];
      for (const game of games) {
        const recordId = parseRecordId(game?.record_id);
        if (!recordId) {
          continue;
        }
        const title = game.displayTitle || game.title || `#${recordId}`;
        try {
          const snapshot = await loadSnapshot(recordId, true);
          if (!snapshot.profiles?.length) {
            skipped.push({ recordId, title, reason: "no save location" });
            continue;
          }
          const result = await exportGameSavesToFile({
            snapshot,
            targetPath: path.join(folder, buildSaveExportFileName(snapshot.game)),
            appVersion: deps.app.getVersion(),
            identity: identityOf(snapshot),
          });
          exported.push({ recordId, title, archivePath: result.archivePath, fileCount: result.fileCount });
        } catch (error) {
          const anyError = /** @type {any} */ (error);
          skipped.push({
            recordId,
            title,
            reason: anyError?.code === "no_save_files" ? "no save files" : describeError(error),
          });
        }
      }
      logger.info("[save.transfer] Bulk export finished:", {
        folder,
        exported: exported.length,
        skipped: skipped.length,
      });
      return { success: true, folder, exported, skipped };
    } catch (error) {
      logger.error("[save.transfer] Bulk export failed:", error);
      return { success: false, error: describeError(error) };
    }
  });

  // ── Reveal a save location ───────────────────────────────────────────

  ipcMain.handle("open-save-location", async (event, payload) => {
    const recordId = parseRecordId(payload?.recordId);
    const rootPath = String(payload?.rootPath || "");
    if (!recordId || !rootPath) {
      return { success: false, error: "Unknown save location." };
    }
    try {
      const snapshot = await loadSnapshot(recordId, false);
      const known = (snapshot.profiles || []).some(
        (profile) => path.resolve(String(profile.rootPath || "")) === path.resolve(rootPath),
      );
      if (!known) {
        return { success: false, error: "This folder does not belong to the game's save locations." };
      }
      if (!fs.existsSync(rootPath)) {
        return { success: false, error: "The save folder does not exist yet." };
      }
      const stat = await fs.promises.stat(rootPath);
      if (stat.isDirectory()) {
        const openError = await deps.shell.openPath(rootPath);
        if (openError) {
          return { success: false, error: openError };
        }
      } else {
        deps.shell.showItemInFolder(rootPath);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: describeError(error) };
    }
  });
}

module.exports = {
  SAVE_ARCHIVE_EXTENSIONS,
  registerSaveTransferIpc,
};
