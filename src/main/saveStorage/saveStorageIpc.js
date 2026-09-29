// @ts-check

/**
 * IPC and lifecycle for the user-owned save storage: connect / test /
 * unlock / disconnect, manual and scheduled sync, the catalog of backups
 * and the portable connection card. One controller instance lives in the
 * main process; main.js asks it to reconcile after installs and launches.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const { detectCloudSyncFolders } = require("./cloudFolderDetector");
const { createSaveStorageProvider, SAVE_STORAGE_TYPES } = require("./providers");
const { createSaveStorageSync, identityOfGame, MARKER_PATH, REMOTE_PREFIX } = require("./saveStorageSync");
const {
  buildConnectionCard,
  buildStorageSection,
  createSecretsStore,
  describeConnection,
  readConnectionCard,
  readStorageSettings,
  splitConnectionInput,
} = require("./storageConfig");

const STARTUP_SYNC_DELAY_MS = 20 * 1000;

/**
 * @param {unknown} error
 */
function describeError(error) {
  const anyError = /** @type {any} */ (error);
  return String(anyError?.userMessage || anyError?.message || error || "Unknown error");
}

/**
 * @param {{
 *   ipcMain: { handle: (channel: string, handler: (event: any, payload?: any) => any) => void },
 *   dialog: { showOpenDialog: Function, showSaveDialog: Function },
 *   app: { getPath: (name: any) => string, getVersion: () => string },
 *   safeStorage: { isEncryptionAvailable: () => boolean, encryptString: (value: string) => Buffer, decryptString: (value: Buffer) => string } | null,
 *   getParentWindow: (event: any) => any,
 *   appPaths: any,
 *   getConfig: () => Record<string, any>,
 *   setStorageSection: (section: Record<string, string>) => void,
 *   getDatabaseConnection: () => any,
 *   getSaveProfileSnapshot: (recordId: number) => Promise<any>,
 *   refreshSaveProfiles: (recordId: number) => Promise<any>,
 *   listGames: () => Promise<any[]>,
 *   upsertSaveSyncState: (input: any) => Promise<any>,
 *   broadcast: (channel: string, payload: any) => void,
 *   logger?: { info: Function, warn: Function, error: Function },
 * }} deps
 */
function createSaveStorageController(deps) {
  const logger = deps.logger || console;
  const secrets = createSecretsStore({ dataDir: deps.appPaths.data, safeStorage: deps.safeStorage });
  const deviceName = (() => {
    try {
      return os.hostname();
    } catch {
      return "";
    }
  })();

  /** Current connection assembled from config.ini + the secrets file. */
  const getConnection = () => {
    const stored = readStorageSettings(deps.getConfig());
    if (!stored) {
      return null;
    }
    const secretPayload = secrets.read();
    return {
      type: stored.type,
      settings: stored.settings,
      secrets: secretPayload?.secrets || {},
      encryption: {
        enabled: stored.encryptionEnabled,
        passphrase: secretPayload?.passphrase || "",
      },
      connectedAt: stored.connectedAt,
      deviceName: stored.deviceName,
    };
  };

  const engine = createSaveStorageSync({
    appPaths: deps.appPaths,
    getConnection,
    getSaveProfileSnapshot: deps.getSaveProfileSnapshot,
    refreshSaveProfiles: deps.refreshSaveProfiles,
    listGames: deps.listGames,
    upsertSaveSyncState: deps.upsertSaveSyncState,
    appVersion: deps.app.getVersion(),
    deviceName,
    onStateChanged: () => deps.broadcast("save-storage-changed", publicState()),
    onProgress: (payload) => deps.broadcast("save-storage-progress", payload),
    logger,
  });

  function publicState() {
    const connection = getConnection();
    const status = engine.getStatus();
    return {
      ...status,
      description: describeConnection(connection),
      settings: connection?.settings || {},
      encryptionEnabled: Boolean(connection?.encryption?.enabled),
      secretsEncrypted: secrets.isEncrypted,
      deviceName,
      legacyCloudConfigured: Boolean(deps.getConfig()?.CloudSync?.publishableKey),
    };
  }

  /**
   * Validates the raw form input for a type and returns a full connection.
   * @param {{ type: string, fields?: Record<string, any>, passphrase?: string, encryptNew?: boolean }} payload
   */
  const buildConnectionFromPayload = (payload) => {
    const type = String(payload?.type || "");
    const split = splitConnectionInput(type, payload?.fields || {});
    if (type === SAVE_STORAGE_TYPES.FOLDER && !split.settings.folderPath) {
      throw new Error("Choose a folder first.");
    }
    if (type === SAVE_STORAGE_TYPES.WEBDAV && !split.settings.url) {
      throw new Error("Enter the WebDAV address.");
    }
    if (type === SAVE_STORAGE_TYPES.S3 && (!split.settings.endpoint || !split.settings.bucket || !split.settings.accessKeyId || !split.secrets.secretAccessKey)) {
      throw new Error("Endpoint, bucket, access key and secret key are all required.");
    }
    const passphrase = String(payload?.passphrase || "");
    return {
      type,
      settings: split.settings,
      secrets: split.secrets,
      encryption: { enabled: Boolean(payload?.encryptNew && passphrase) || Boolean(passphrase), passphrase },
      connectedAt: new Date().toISOString(),
      deviceName,
    };
  };

  /**
   * Looks at a storage before connecting: reachable? already used by the
   * app? encrypted?
   * @param {import("./storageConfig").SaveStorageConnection} connection
   */
  const inspectStorage = async (connection) => {
    const provider = createSaveStorageProvider(connection);
    const test = await provider.test();
    if (!test.ok) {
      return { ok: false, message: test.message, code: test.details?.code || "" };
    }
    const prefix = REMOTE_PREFIX[connection.type] || "";
    const markerPath = prefix ? `${prefix}/${MARKER_PATH}` : MARKER_PATH;
    let existing = false;
    let encrypted = false;
    let createdBy = "";
    try {
      const raw = await provider.read(markerPath);
      if (raw) {
        const marker = JSON.parse(raw.toString("utf8"));
        existing = true;
        encrypted = Boolean(marker?.encrypted);
        createdBy = String(marker?.createdBy || "");
      }
    } catch {
      existing = false;
    }
    return { ok: true, message: test.message, existing, encrypted, createdBy, label: provider.label };
  };

  /**
   * Persists a connection and loads it. Secrets first, then config, so a
   * crash in between never leaves a connection without its credentials.
   * @param {import("./storageConfig").SaveStorageConnection} connection
   * @param {{ createEncrypted?: boolean }} options
   */
  const persistAndLoad = async (connection, options = {}) => {
    secrets.write({ secrets: connection.secrets, passphrase: connection.encryption.passphrase });
    deps.setStorageSection(buildStorageSection(connection));
    const loaded = await engine.load({
      passphrase: connection.encryption.passphrase,
      createEncrypted: Boolean(options.createEncrypted),
    });
    if (loaded.connected && loaded.encrypted !== undefined && loaded.encrypted !== connection.encryption.enabled) {
      // The storage decides: an existing encrypted storage stays encrypted,
      // a plain one stays plain. Keep config.ini honest about it.
      const corrected = { ...connection, encryption: { ...connection.encryption, enabled: Boolean(loaded.encrypted) } };
      deps.setStorageSection(buildStorageSection(corrected));
    }
    return loaded;
  };

  const scheduleSyncAll = (reason) => {
    if (!engine.isReady()) {
      return Promise.resolve(null);
    }
    return engine.enqueue(`sync all (${reason})`, () => engine.syncAll({ mode: "sync", emitProgress: false }));
  };

  const scheduleReconcile = (recordId, reason) => {
    if (!engine.isReady() || !recordId) {
      return Promise.resolve(null);
    }
    return engine.enqueue(`reconcile ${recordId} (${reason})`, () => engine.reconcileGame(Number(recordId)));
  };

  // ── IPC ──────────────────────────────────────────────────────────────

  const { ipcMain } = deps;

  ipcMain.handle("get-save-storage-state", async () => ({ success: true, state: publicState() }));

  ipcMain.handle("detect-save-storage-folders", async () => {
    try {
      return { success: true, folders: detectCloudSyncFolders() };
    } catch (error) {
      return { success: false, error: describeError(error), folders: [] };
    }
  });

  ipcMain.handle("test-save-storage-connection", async (event, payload) => {
    try {
      const connection = buildConnectionFromPayload(payload || {});
      const result = await inspectStorage(connection);
      return { success: result.ok, ...result, error: result.ok ? "" : result.message };
    } catch (error) {
      return { success: false, error: describeError(error) };
    }
  });

  ipcMain.handle("connect-save-storage", async (event, payload) => {
    try {
      const connection = buildConnectionFromPayload(payload || {});
      const inspection = await inspectStorage(connection);
      if (!inspection.ok) {
        return { success: false, error: inspection.message, code: inspection.code };
      }
      if (inspection.existing && inspection.encrypted && !connection.encryption.passphrase) {
        return { success: false, needsPassphrase: true, error: "This storage is protected with a passphrase. Enter it to connect." };
      }
      const loaded = await persistAndLoad(connection, { createEncrypted: Boolean(payload?.encryptNew) });
      if (loaded.error) {
        return { success: false, error: loaded.error, needsPassphrase: Boolean(loaded.locked), state: publicState() };
      }
      logger.info("[save.storage] Connected:", { type: connection.type, existing: inspection.existing, encrypted: loaded.encrypted });
      void scheduleSyncAll("connect");
      return { success: true, existing: inspection.existing, encrypted: Boolean(loaded.encrypted), state: publicState() };
    } catch (error) {
      logger.error("[save.storage] Connect failed:", error);
      return { success: false, error: describeError(error) };
    }
  });

  ipcMain.handle("unlock-save-storage", async (event, payload) => {
    try {
      const connection = getConnection();
      if (!connection) {
        return { success: false, error: "No save storage is connected." };
      }
      const passphrase = String(payload?.passphrase || "");
      const loaded = await engine.load({ passphrase });
      if (loaded.error || loaded.locked) {
        return { success: false, error: loaded.error || "The passphrase does not open this storage.", state: publicState() };
      }
      secrets.write({ secrets: connection.secrets, passphrase });
      void scheduleSyncAll("unlock");
      return { success: true, state: publicState() };
    } catch (error) {
      return { success: false, error: describeError(error) };
    }
  });

  ipcMain.handle("disconnect-save-storage", async () => {
    try {
      secrets.clear();
      deps.setStorageSection(buildStorageSection(null));
      await engine.load();
      logger.info("[save.storage] Disconnected; remote data left in place.");
      return { success: true, state: publicState() };
    } catch (error) {
      return { success: false, error: describeError(error) };
    }
  });

  ipcMain.handle("sync-save-storage-all", async (event, payload) => {
    try {
      if (!engine.isReady()) {
        return { success: false, error: engine.getStatus().locked ? "Unlock the storage first." : "No save storage is connected." };
      }
      const mode = payload?.mode === "upload" ? "upload" : "sync";
      const summary = await engine.enqueue(`manual ${mode}`, () => engine.syncAll({ mode, emitProgress: true }));
      if (!summary) {
        return { success: false, error: engine.getStatus().lastError || "Sync failed." };
      }
      return { success: true, summary, state: publicState() };
    } catch (error) {
      return { success: false, error: describeError(error) };
    }
  });

  ipcMain.handle("sync-save-storage-game", async (event, payload) => {
    const recordId = Number.parseInt(String(payload?.recordId ?? ""), 10);
    const action = String(payload?.action || "reconcile");
    if (!Number.isInteger(recordId) || recordId <= 0) {
      return { success: false, error: "Unknown game." };
    }
    try {
      if (!engine.isReady()) {
        return { success: false, error: engine.getStatus().locked ? "Unlock the storage first." : "No save storage is connected." };
      }
      const result =
        action === "upload"
          ? await engine.uploadGame(recordId)
          : action === "restore"
            ? await engine.restoreGame(recordId)
            : await engine.reconcileGame(recordId);
      return { success: true, action, result };
    } catch (error) {
      return { success: false, error: describeError(error), code: /** @type {any} */ (error)?.code || "" };
    }
  });

  ipcMain.handle("get-save-storage-catalog", async () => {
    try {
      if (!engine.isReady()) {
        return { success: true, entries: [], locked: engine.getStatus().locked };
      }
      const catalog = await engine.readCatalog();
      const games = await deps.listGames();
      const byIdentity = new Map();
      for (const game of games) {
        try {
          byIdentity.set(identityOfGame(game), game);
        } catch {
          // Unidentifiable rows are skipped.
        }
      }
      const entries = catalog.entries.map((entry) => {
        const game = byIdentity.get(entry.identity);
        return {
          ...entry,
          inLibrary: Boolean(game),
          recordId: game?.record_id || null,
          installed: Boolean(game && Array.isArray(game.versions) && game.versions.some((version) => version?.game_path)),
        };
      });
      return { success: true, entries, updatedAt: catalog.updatedAt, locked: false };
    } catch (error) {
      return { success: false, error: describeError(error), entries: [] };
    }
  });

  ipcMain.handle("export-save-storage-card", async (event, payload) => {
    try {
      const connection = getConnection();
      if (!connection) {
        return { success: false, error: "No save storage is connected." };
      }
      const selection = await deps.dialog.showSaveDialog(deps.getParentWindow(event), {
        title: "Save the storage connection card",
        defaultPath: path.join(deps.app.getPath("documents"), "F95Launcher save storage.f95card"),
        buttonLabel: "Save card",
        filters: [{ name: "F95Launcher storage card", extensions: ["f95card", "json"] }],
      });
      if (selection?.canceled || !selection?.filePath) {
        return { success: false, cancelled: true };
      }
      const card = buildConnectionCard(connection, {
        passphrase: String(payload?.passphrase || ""),
        appVersion: deps.app.getVersion(),
      });
      await fs.promises.writeFile(selection.filePath, JSON.stringify(card, null, 2), "utf8");
      return { success: true, filePath: selection.filePath, sealed: card.sealed };
    } catch (error) {
      return { success: false, error: describeError(error) };
    }
  });

  ipcMain.handle("import-save-storage-card", async (event, payload) => {
    try {
      let filePath = String(payload?.filePath || "");
      if (!filePath) {
        const selection = await deps.dialog.showOpenDialog(deps.getParentWindow(event), {
          title: "Open a storage connection card",
          defaultPath: deps.app.getPath("documents"),
          buttonLabel: "Connect",
          properties: ["openFile"],
          filters: [
            { name: "F95Launcher storage card", extensions: ["f95card", "json"] },
            { name: "All files", extensions: ["*"] },
          ],
        });
        if (selection?.canceled || !selection?.filePaths?.[0]) {
          return { success: false, cancelled: true };
        }
        filePath = selection.filePaths[0];
      }
      let card;
      try {
        card = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
      } catch {
        return { success: false, error: "This file is not a storage card.", filePath };
      }
      let parsed;
      try {
        parsed = readConnectionCard(card, { passphrase: String(payload?.cardPassphrase || "") });
      } catch (error) {
        const code = /** @type {any} */ (error)?.code || "";
        return { success: false, error: describeError(error), code, needsCardPassphrase: code === "card_passphrase_required" || code === "card_wrong_passphrase", filePath };
      }
      const connection = {
        type: parsed.type,
        settings: parsed.settings,
        secrets: parsed.secrets,
        encryption: parsed.encryption,
        connectedAt: new Date().toISOString(),
        deviceName,
      };
      const inspection = await inspectStorage(connection);
      if (!inspection.ok) {
        return { success: false, error: inspection.message, filePath };
      }
      const loaded = await persistAndLoad(connection);
      if (loaded.error) {
        return { success: false, error: loaded.error, needsPassphrase: Boolean(loaded.locked), state: publicState(), filePath };
      }
      void scheduleSyncAll("import-card");
      return { success: true, existing: inspection.existing, state: publicState(), filePath };
    } catch (error) {
      return { success: false, error: describeError(error) };
    }
  });

  ipcMain.handle("forget-save-storage-game", async (event, payload) => {
    const recordId = Number.parseInt(String(payload?.recordId ?? ""), 10);
    if (!Number.isInteger(recordId) || recordId <= 0) {
      return { success: false, error: "Unknown game." };
    }
    try {
      if (!engine.isReady()) {
        return { success: false, error: "No save storage is connected." };
      }
      await engine.clearRemoteGame(recordId);
      return { success: true };
    } catch (error) {
      return { success: false, error: describeError(error) };
    }
  });

  // ── Lifecycle for main.js ────────────────────────────────────────────

  return {
    engine,
    getConnection,
    publicState,
    scheduleReconcile,
    scheduleSyncAll,
    isReady: () => engine.isReady(),
    async start() {
      const loaded = await engine.load();
      if (loaded.connected && !loaded.locked && !loaded.error) {
        setTimeout(() => {
          scheduleSyncAll("startup");
        }, STARTUP_SYNC_DELAY_MS);
      } else if (loaded.locked) {
        logger.warn("[save.storage] Storage is locked: the passphrase is missing on this PC.");
      }
      return loaded;
    },
    watchAfterLaunch(recordId) {
      if (!engine.isReady() || !recordId) {
        return;
      }
      engine.watchGameSaves(Number(recordId)).catch(() => {});
    },
  };
}

module.exports = {
  STARTUP_SYNC_DELAY_MS,
  createSaveStorageController,
};
