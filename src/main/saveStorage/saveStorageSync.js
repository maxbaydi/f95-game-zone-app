// @ts-check

/**
 * Save sync against a user-owned storage (see providers.js).
 *
 * Layout inside the storage:
 *   storage.json                       marker: format, encryption salt/check
 *   catalog.json                       every game with a backup (for reconnects)
 *   games/<identity>/latest.zip        the save archive (export format)
 *   games/<identity>/latest.manifest.json
 *   games/<identity>/history/<ts>.zip  previous archives, pruned to a few
 *
 * `identity` is the same key the local vault uses (f95-<thread id> first),
 * so a fresh install on another PC finds its saves without any account.
 * With a passphrase every object is sealed with AES-256-GCM; the marker
 * keeps the salt and a check value so a reconnecting PC can verify the
 * passphrase before touching anything.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { decideSaveSyncPlan } = require("../../shared/saveSyncPlan");
const { buildSaveVaultIdentity, backupGameSaves } = require("../saveVault");
const {
  exportGameSavesToFile,
  importGameSavesFromFile,
} = require("../saveTransfer");
const { extractArchiveSafely } = require("../archive/extractArchive");
const { createSaveStorageProvider, SaveStorageError, SAVE_STORAGE_TYPES } = require("./providers");

const STORAGE_FORMAT = "f95launcher-save-storage";
const STORAGE_VERSION = 1;
const MARKER_PATH = "storage.json";
const CATALOG_PATH = "catalog.json";
const HISTORY_KEEP = 5;
const SEAL_MAGIC = Buffer.from("F95SAVE1");
const KDF = { N: 16384, r: 8, p: 1, keyLength: 32 };
const WATCH_DEBOUNCE_MS = 90 * 1000;
const WATCH_MAX_MS = 8 * 60 * 60 * 1000;

/** Where remote types keep the app's data inside the user's storage. */
const REMOTE_PREFIX = {
  [SAVE_STORAGE_TYPES.FOLDER]: "",
  [SAVE_STORAGE_TYPES.WEBDAV]: "F95Launcher Saves",
  [SAVE_STORAGE_TYPES.S3]: "",
  [SAVE_STORAGE_TYPES.SUPABASE]: "",
};

/**
 * @param {string} passphrase
 * @param {Buffer} salt
 */
function deriveKey(passphrase, salt) {
  return crypto.scryptSync(Buffer.from(String(passphrase), "utf8"), salt, KDF.keyLength, {
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
  });
}

/**
 * @param {Buffer} plain
 * @param {Buffer} key
 */
function sealBuffer(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([SEAL_MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

/**
 * @param {Buffer} sealed
 * @param {Buffer} key
 */
function openBuffer(sealed, key) {
  if (!isSealed(sealed)) {
    return sealed;
  }
  const iv = sealed.subarray(SEAL_MAGIC.length, SEAL_MAGIC.length + 12);
  const tag = sealed.subarray(SEAL_MAGIC.length + 12, SEAL_MAGIC.length + 28);
  const body = sealed.subarray(SEAL_MAGIC.length + 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * @param {Buffer | null} buffer
 */
function isSealed(buffer) {
  return Boolean(buffer && buffer.length > SEAL_MAGIC.length + 28 && buffer.subarray(0, SEAL_MAGIC.length).equals(SEAL_MAGIC));
}

/**
 * @param {any} game
 */
function identityOfGame(game) {
  return buildSaveVaultIdentity({
    threadUrl: game?.siteUrl || "",
    title: game?.displayTitle || game?.title || "",
    creator: game?.displayCreator || game?.creator || "",
  });
}

/**
 * @param {any} game
 */
function primaryInstallDirectory(game) {
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
 *   appPaths: any,
 *   getConnection: () => (import("./storageConfig").SaveStorageConnection | null),
 *   getSaveProfileSnapshot: (recordId: number) => Promise<any>,
 *   refreshSaveProfiles: (recordId: number) => Promise<any>,
 *   listGames: () => Promise<any[]>,
 *   upsertSaveSyncState: (input: any) => Promise<any>,
 *   appVersion?: string,
 *   deviceName?: string,
 *   onStateChanged?: (state: any) => void,
 *   onProgress?: (payload: any) => void,
 *   logger?: { info: Function, warn: Function, error: Function },
 *   now?: () => Date,
 * }} deps
 */
function createSaveStorageSync(deps) {
  const logger = deps.logger || console;
  const now = deps.now || (() => new Date());
  /** @type {import("./providers").SaveStorageProvider | null} */
  let provider = null;
  /** @type {import("./storageConfig").SaveStorageConnection | null} */
  let connection = null;
  /** @type {Buffer | null} */
  let key = null;
  /** @type {any} */
  let marker = null;
  let locked = false;
  let lastError = "";
  let lastSyncAt = "";
  let busy = false;
  /** @type {Promise<any>} */
  let queue = Promise.resolve();
  /** @type {Map<number, { watchers: fs.FSWatcher[], timer: any, stopAt: number }>} */
  const watchers = new Map();

  const prefixFor = () => (connection ? REMOTE_PREFIX[connection.type] || "" : "");
  const remotePath = (relative) => {
    const prefix = prefixFor();
    return prefix ? `${prefix}/${relative}` : relative;
  };
  const gamePaths = (identity) => ({
    base: remotePath(`games/${identity}`),
    archive: remotePath(`games/${identity}/latest.zip`),
    manifest: remotePath(`games/${identity}/latest.manifest.json`),
    history: remotePath(`games/${identity}/history`),
  });

  const emitState = () => {
    if (typeof deps.onStateChanged === "function") {
      try {
        deps.onStateChanged(getStatus());
      } catch {
        // UI notifications never break the sync.
      }
    }
  };

  const requireProvider = () => {
    if (!provider || !connection) {
      throw new SaveStorageError("No save storage is connected.", { code: "not_connected" });
    }
    if (locked) {
      throw new SaveStorageError("The storage is protected with a passphrase. Unlock it first.", { code: "locked" });
    }
    return provider;
  };

  const readObject = async (relativePath) => {
    const raw = await requireProvider().read(relativePath);
    if (!raw) {
      return null;
    }
    if (isSealed(raw)) {
      if (!key) {
        throw new SaveStorageError("The storage is encrypted and no passphrase is set.", { code: "locked" });
      }
      try {
        return openBuffer(raw, key);
      } catch {
        throw new SaveStorageError("The passphrase does not open this storage.", { code: "wrong_passphrase" });
      }
    }
    return raw;
  };

  const writeObject = async (relativePath, buffer) => {
    const payload = key ? sealBuffer(buffer, key) : buffer;
    await requireProvider().write(relativePath, payload);
  };

  const readJson = async (relativePath) => {
    const buffer = await readObject(relativePath);
    if (!buffer) {
      return null;
    }
    try {
      return JSON.parse(buffer.toString("utf8"));
    } catch {
      return null;
    }
  };

  const writeJson = (relativePath, value) =>
    writeObject(relativePath, Buffer.from(JSON.stringify(value, null, 2), "utf8"));

  // ── Marker / encryption ──────────────────────────────────────────────

  /**
   * Reads (or creates) the storage marker and prepares the encryption key.
   * @param {{ passphrase?: string, createEncrypted?: boolean }} options
   */
  const initializeMarker = async (options = {}) => {
    const active = /** @type {import("./providers").SaveStorageProvider} */ (provider);
    const raw = await active.read(remotePath(MARKER_PATH));
    const passphrase = String(options.passphrase || "");
    if (raw) {
      let parsed;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new SaveStorageError("The storage marker is damaged. Pick another folder or clear it.", { code: "marker_invalid" });
      }
      marker = parsed;
      if (parsed?.encrypted) {
        if (!passphrase) {
          key = null;
          locked = true;
          return { existing: true, encrypted: true, locked: true };
        }
        const salt = Buffer.from(parsed.kdf?.salt || "", "base64");
        const candidate = deriveKey(passphrase, salt);
        try {
          const check = openBuffer(Buffer.from(parsed.check || "", "base64"), candidate).toString("utf8");
          if (check !== "ok") {
            throw new Error("mismatch");
          }
        } catch {
          key = null;
          locked = true;
          throw new SaveStorageError("The passphrase does not open this storage.", { code: "wrong_passphrase" });
        }
        key = candidate;
        locked = false;
        return { existing: true, encrypted: true, locked: false };
      }
      key = null;
      locked = false;
      return { existing: true, encrypted: false, locked: false };
    }

    // Fresh storage.
    const encrypted = Boolean(options.createEncrypted && passphrase);
    let salt = null;
    if (encrypted) {
      salt = crypto.randomBytes(16);
      key = deriveKey(passphrase, salt);
    } else {
      key = null;
    }
    marker = {
      format: STORAGE_FORMAT,
      version: STORAGE_VERSION,
      createdAt: now().toISOString(),
      createdBy: deps.deviceName || "",
      app: { name: "F95Launcher", version: String(deps.appVersion || "") },
      encrypted,
      ...(encrypted && salt
        ? {
            kdf: { name: "scrypt", ...KDF, salt: salt.toString("base64") },
            check: sealBuffer(Buffer.from("ok"), /** @type {Buffer} */ (key)).toString("base64"),
          }
        : {}),
    };
    await active.write(remotePath(MARKER_PATH), Buffer.from(JSON.stringify(marker, null, 2), "utf8"));
    locked = false;
    return { existing: false, encrypted, locked: false };
  };

  // ── Catalog ──────────────────────────────────────────────────────────

  const readCatalog = async () => {
    const catalog = await readJson(remotePath(CATALOG_PATH));
    const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
    return { updatedAt: String(catalog?.updatedAt || ""), entries };
  };

  const updateCatalogEntry = async (entry) => {
    const catalog = await readCatalog();
    const others = catalog.entries.filter((existing) => existing?.identity !== entry.identity);
    const nextEntries = [...others, entry].sort((left, right) =>
      String(left.title || "").localeCompare(String(right.title || "")),
    );
    await writeJson(remotePath(CATALOG_PATH), {
      format: STORAGE_FORMAT,
      version: STORAGE_VERSION,
      updatedAt: now().toISOString(),
      entries: nextEntries,
    });
    return nextEntries;
  };

  const removeCatalogEntry = async (identity) => {
    const catalog = await readCatalog();
    const nextEntries = catalog.entries.filter((existing) => existing?.identity !== identity);
    if (nextEntries.length !== catalog.entries.length) {
      await writeJson(remotePath(CATALOG_PATH), {
        format: STORAGE_FORMAT,
        version: STORAGE_VERSION,
        updatedAt: now().toISOString(),
        entries: nextEntries,
      });
    }
  };

  // ── History ──────────────────────────────────────────────────────────

  const pruneHistory = async (identity) => {
    const paths = gamePaths(identity);
    const entries = (await requireProvider().list(paths.history)).sort((left, right) => left.path.localeCompare(right.path));
    const excess = entries.length - HISTORY_KEEP;
    for (let index = 0; index < excess; index += 1) {
      await requireProvider().remove(entries[index].path).catch(() => {});
    }
  };

  // ── Core operations ──────────────────────────────────────────────────

  const withTemp = async (name, work) => {
    const tempPath = path.join(deps.appPaths.cache, "save-storage", `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${name}`);
    await fs.promises.mkdir(path.dirname(tempPath), { recursive: true });
    try {
      return await work(tempPath);
    } finally {
      await fs.promises.rm(tempPath, { force: true, recursive: true }).catch(() => {});
    }
  };

  const buildLocalArchive = async (snapshot, identity) =>
    withTemp("local.zip", async (tempPath) => {
      const exported = await exportGameSavesToFile({
        snapshot,
        targetPath: tempPath,
        appVersion: deps.appVersion,
        identity,
        now,
      });
      const buffer = await fs.promises.readFile(tempPath);
      return { buffer, manifest: exported.manifest, fileCount: exported.fileCount, totalBytes: exported.totalBytes };
    });

  const saveState = (recordId, identity, patch) =>
    deps.upsertSaveSyncState({
      recordId,
      cloudIdentity: identity,
      ...patch,
    });

  /**
   * @param {number} recordId
   * @param {{ snapshot?: any }} options
   */
  const uploadGame = async (recordId, options = {}) => {
    requireProvider();
    const snapshot = options.snapshot || (await deps.refreshSaveProfiles(recordId));
    if (!snapshot?.game) {
      throw new SaveStorageError("The game is no longer in the library.", { code: "missing_game" });
    }
    if (!snapshot.profiles?.length) {
      throw new SaveStorageError("No save location was found for this game on this PC.", { code: "no_saves" });
    }
    const identity = identityOfGame(snapshot.game);
    const paths = gamePaths(identity);
    const local = await buildLocalArchive(snapshot, identity);
    const previous = snapshot.syncState || {};
    try {
      const existing = await requireProvider().read(paths.archive);
      if (existing) {
        const stamp = now().toISOString().replace(/[:.]/g, "-");
        await requireProvider().write(`${paths.history}/${stamp}.zip`, existing);
      }
      await writeObject(paths.archive, local.buffer);
      await writeJson(paths.manifest, local.manifest);
      await updateCatalogEntry({
        identity,
        title: snapshot.game.displayTitle || snapshot.game.title || "",
        creator: snapshot.game.displayCreator || snapshot.game.creator || "",
        threadUrl: snapshot.game.siteUrl || "",
        engine: snapshot.game.engine || "",
        updatedAt: now().toISOString(),
        manifestHash: local.manifest.manifestHash,
        fileCount: local.fileCount,
        totalBytes: local.totalBytes,
        device: deps.deviceName || "",
      });
      await pruneHistory(identity).catch(() => {});
      const state = await saveState(recordId, identity, {
        lastLocalManifestHash: local.manifest.manifestHash,
        lastRemoteManifestHash: local.manifest.manifestHash,
        lastUploadedAt: now().toISOString(),
        lastDownloadedAt: previous.lastDownloadedAt || "",
        lastRemotePath: paths.archive,
        syncStatus: "uploaded",
        lastError: "",
      });
      lastError = "";
      lastSyncAt = now().toISOString();
      emitState();
      return { uploaded: true, identity, manifestHash: local.manifest.manifestHash, fileCount: local.fileCount, syncState: state };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await saveState(recordId, identity, {
        lastLocalManifestHash: previous.lastLocalManifestHash || "",
        lastRemoteManifestHash: previous.lastRemoteManifestHash || "",
        lastUploadedAt: previous.lastUploadedAt || "",
        lastDownloadedAt: previous.lastDownloadedAt || "",
        lastRemotePath: previous.lastRemotePath || "",
        syncStatus: "error",
        lastError: message,
      }).catch(() => {});
      lastError = message;
      emitState();
      throw error;
    }
  };

  /**
   * @param {number} recordId
   */
  const restoreGame = async (recordId) => {
    requireProvider();
    const snapshot = await deps.refreshSaveProfiles(recordId);
    if (!snapshot?.game) {
      throw new SaveStorageError("The game is no longer in the library.", { code: "missing_game" });
    }
    const identity = identityOfGame(snapshot.game);
    const paths = gamePaths(identity);
    const previous = snapshot.syncState || {};
    try {
      const archive = await readObject(paths.archive);
      if (!archive) {
        throw new SaveStorageError("There is no backup of this game in the storage yet.", { code: "no_backup" });
      }
      const installDirectory = primaryInstallDirectory(snapshot.game);
      if (snapshot.profiles?.length) {
        await backupGameSaves({
          appPaths: deps.appPaths,
          threadUrl: snapshot.game.siteUrl || "",
          title: snapshot.game.displayTitle || snapshot.game.title || "",
          creator: snapshot.game.displayCreator || snapshot.game.creator || "",
          installDirectory,
          profiles: snapshot.profiles,
        }).catch((error) => logger.warn("[save.storage] Vault backup before restore failed:", error));
      }
      const imported = await withTemp("restore.zip", async (tempPath) => {
        await fs.promises.writeFile(tempPath, archive);
        return importGameSavesFromFile({
          snapshot,
          archivePath: tempPath,
          extractArchive: extractArchiveSafely,
          tempRoot: deps.appPaths.cache,
          installDirectory,
        });
      });
      const remoteManifest = await readJson(paths.manifest);
      const refreshed = await deps.refreshSaveProfiles(recordId).catch(() => null);
      // The restored files carry new timestamps: remember the local hash so
      // the next reconcile sees "unchanged", not "changed since last sync".
      let localHashAfterRestore = "";
      if (refreshed?.profiles?.length) {
        localHashAfterRestore = await buildLocalArchive(refreshed, identity)
          .then((local) => local.manifest.manifestHash)
          .catch(() => "");
      }
      const state = await saveState(recordId, identity, {
        lastLocalManifestHash: localHashAfterRestore || remoteManifest?.manifestHash || previous.lastLocalManifestHash || "",
        lastRemoteManifestHash: remoteManifest?.manifestHash || previous.lastRemoteManifestHash || "",
        lastUploadedAt: previous.lastUploadedAt || "",
        lastDownloadedAt: now().toISOString(),
        lastRemotePath: paths.archive,
        syncStatus: "restored",
        lastError: "",
      });
      lastError = "";
      lastSyncAt = now().toISOString();
      emitState();
      return { restored: true, identity, importedFiles: imported.importedFiles, destinations: imported.destinations, syncState: state };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await saveState(recordId, identity, {
        lastLocalManifestHash: previous.lastLocalManifestHash || "",
        lastRemoteManifestHash: previous.lastRemoteManifestHash || "",
        lastUploadedAt: previous.lastUploadedAt || "",
        lastDownloadedAt: previous.lastDownloadedAt || "",
        lastRemotePath: previous.lastRemotePath || "",
        syncStatus: "error",
        lastError: message,
      }).catch(() => {});
      lastError = message;
      emitState();
      throw error;
    }
  };

  /**
   * Decides between upload, restore and nothing for one game.
   * @param {number} recordId
   */
  const reconcileGame = async (recordId) => {
    requireProvider();
    const snapshot = await deps.refreshSaveProfiles(recordId);
    if (!snapshot?.game) {
      return { action: "noop", reason: "missing-game" };
    }
    const identity = identityOfGame(snapshot.game);
    const paths = gamePaths(identity);
    const hasLocal = Array.isArray(snapshot.profiles) && snapshot.profiles.length > 0;
    let localManifest = null;
    if (hasLocal) {
      try {
        localManifest = (await buildLocalArchive(snapshot, identity)).manifest;
      } catch (error) {
        if (/** @type {any} */ (error)?.code !== "no_save_files") {
          throw error;
        }
      }
    }
    const remoteManifest = await readJson(paths.manifest);
    const plan = decideSaveSyncPlan({
      localManifest,
      remoteManifest,
      syncState: snapshot.syncState || null,
    });
    if (plan.action === "upload") {
      const result = await uploadGame(recordId, { snapshot });
      return { action: "upload", reason: plan.reason, result };
    }
    if (plan.action === "restore") {
      const result = await restoreGame(recordId);
      return { action: "restore", reason: plan.reason, result };
    }
    const previous = snapshot.syncState || {};
    const state = await saveState(recordId, identity, {
      lastLocalManifestHash: localManifest?.manifestHash || previous.lastLocalManifestHash || "",
      lastRemoteManifestHash: remoteManifest?.manifestHash || previous.lastRemoteManifestHash || "",
      lastUploadedAt: previous.lastUploadedAt || "",
      lastDownloadedAt: previous.lastDownloadedAt || "",
      lastRemotePath: remoteManifest ? paths.archive : previous.lastRemotePath || "",
      syncStatus:
        plan.action === "conflict"
          ? "conflict"
          : plan.reason === "already-synced"
            ? "synced"
            : previous.syncStatus || "idle",
      lastError:
        plan.action === "conflict"
          ? "Saves changed here and in the storage at the same time. Choose Back up or Restore to decide which copy wins."
          : "",
    });
    return { action: plan.action, reason: plan.reason, syncState: state };
  };

  /**
   * @param {{ mode?: "sync" | "upload", emitProgress?: boolean }} options
   */
  const syncAll = async (options = {}) => {
    requireProvider();
    const mode = options.mode === "upload" ? "upload" : "sync";
    const games = (await deps.listGames()).filter(
      (game) => game?.record_id && Array.isArray(game?.versions) && game.versions.length > 0,
    );
    const summary = { mode, total: games.length, completed: 0, uploaded: 0, restored: 0, synced: 0, conflicts: 0, skipped: 0, failed: 0, results: [] };
    const progress = (currentTitle, active) => {
      if (options.emitProgress !== false && typeof deps.onProgress === "function") {
        deps.onProgress({ active, mode, completed: summary.completed, total: summary.total, currentTitle, summary, source: "storage" });
      }
    };
    busy = true;
    emitState();
    progress("", true);
    try {
      for (const game of games) {
        const title = game.displayTitle || game.title || `#${game.record_id}`;
        let outcome = "skipped";
        let message = "";
        try {
          if (mode === "upload") {
            const snapshot = await deps.refreshSaveProfiles(game.record_id);
            if (!snapshot?.profiles?.length) {
              message = "No save location on this PC.";
            } else {
              await uploadGame(game.record_id, { snapshot });
              outcome = "uploaded";
            }
          } else {
            const result = await reconcileGame(game.record_id);
            outcome =
              result.action === "upload" ? "uploaded" : result.action === "restore" ? "restored" : result.action === "conflict" ? "conflict" : "synced";
            message = result.reason || "";
          }
        } catch (error) {
          outcome = "failed";
          message = error instanceof Error ? error.message : String(error);
        }
        summary.completed += 1;
        summary[outcome === "uploaded" ? "uploaded" : outcome === "restored" ? "restored" : outcome === "conflict" ? "conflicts" : outcome === "failed" ? "failed" : outcome === "synced" ? "synced" : "skipped"] += 1;
        summary.results.push({ recordId: game.record_id, title, outcome, message });
        progress(title, summary.completed < summary.total);
      }
      lastSyncAt = now().toISOString();
      lastError = summary.failed > 0 ? `${summary.failed} game(s) failed to sync.` : "";
      return summary;
    } finally {
      busy = false;
      progress("", false);
      emitState();
    }
  };

  // ── Watching saves after a game was launched ─────────────────────────

  const stopWatching = (recordId) => {
    const entry = watchers.get(recordId);
    if (!entry) {
      return;
    }
    for (const watcher of entry.watchers) {
      try {
        watcher.close();
      } catch {
        // Already closed.
      }
    }
    clearTimeout(entry.timer);
    watchers.delete(recordId);
  };

  /**
   * Games are launched through the shell, so there is no process to wait
   * for. Instead the save folders are watched: a change followed by quiet
   * time triggers a reconcile, which uploads the new saves.
   * @param {number} recordId
   */
  const watchGameSaves = async (recordId) => {
    if (!provider || locked) {
      return;
    }
    stopWatching(recordId);
    let snapshot;
    try {
      snapshot = await deps.getSaveProfileSnapshot(recordId);
    } catch {
      return;
    }
    const roots = (snapshot?.profiles || []).map((profile) => profile.rootPath).filter((root) => root && fs.existsSync(root));
    if (roots.length === 0) {
      return;
    }
    const entry = { watchers: [], timer: null, stopAt: Date.now() + WATCH_MAX_MS };
    const schedule = () => {
      clearTimeout(entry.timer);
      if (Date.now() > entry.stopAt) {
        stopWatching(recordId);
        return;
      }
      entry.timer = setTimeout(() => {
        enqueue(`post-play reconcile ${recordId}`, () => reconcileGame(recordId));
      }, WATCH_DEBOUNCE_MS);
    };
    for (const root of roots) {
      try {
        const watcher = fs.watch(root, { recursive: process.platform === "win32" || process.platform === "darwin" }, schedule);
        watcher.on("error", () => {});
        entry.watchers.push(watcher);
      } catch {
        // Unwatchable location; skip it.
      }
    }
    if (entry.watchers.length) {
      watchers.set(recordId, entry);
    }
  };

  // ── Lifecycle ────────────────────────────────────────────────────────

  const enqueue = (label, task) => {
    queue = queue
      .catch(() => null)
      .then(async () => {
        try {
          return await task();
        } catch (error) {
          logger.warn(`[save.storage] ${label} failed:`, error instanceof Error ? error.message : error);
          return null;
        }
      });
    return queue;
  };

  /**
   * @typedef {{ connected: boolean, existing?: boolean, encrypted?: boolean, locked?: boolean, error?: string }} LoadResult
   */

  /**
   * (Re)loads the connection from settings. Returns the marker state so the
   * caller can ask for a passphrase when the storage is encrypted.
   * @param {{ passphrase?: string, createEncrypted?: boolean }=} options
   * @returns {Promise<LoadResult>}
   */
  const load = async (options = {}) => {
    for (const recordId of [...watchers.keys()]) {
      stopWatching(recordId);
    }
    connection = deps.getConnection();
    provider = null;
    key = null;
    marker = null;
    locked = false;
    lastError = "";
    if (!connection) {
      emitState();
      return { connected: false };
    }
    try {
      provider = createSaveStorageProvider(connection);
      const markerState = await initializeMarker({
        passphrase: options.passphrase ?? connection.encryption?.passphrase ?? "",
        createEncrypted: options.createEncrypted ?? Boolean(connection.encryption?.enabled),
      });
      emitState();
      return { connected: true, ...markerState };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (/** @type {any} */ (error)?.code === "wrong_passphrase") {
        locked = true;
      }
      emitState();
      return { connected: Boolean(provider), error: lastError, locked };
    }
  };

  function getStatus() {
    return {
      connected: Boolean(provider && connection),
      type: connection?.type || "",
      label: provider?.label || "",
      encrypted: Boolean(marker?.encrypted),
      locked,
      busy,
      lastError,
      lastSyncAt,
      connectedAt: connection?.connectedAt || "",
    };
  }

  const clearRemoteGame = async (recordId) => {
    requireProvider();
    const snapshot = await deps.getSaveProfileSnapshot(recordId);
    if (!snapshot?.game) {
      return;
    }
    const identity = identityOfGame(snapshot.game);
    const paths = gamePaths(identity);
    for (const entry of await requireProvider().list(paths.base)) {
      await requireProvider().remove(entry.path).catch(() => {});
    }
    await removeCatalogEntry(identity);
  };

  return {
    load,
    getStatus,
    getProvider: () => provider,
    isReady: () => Boolean(provider && connection && !locked),
    uploadGame,
    restoreGame,
    reconcileGame,
    syncAll,
    readCatalog,
    clearRemoteGame,
    watchGameSaves,
    stopWatching,
    enqueue,
    identityOfGame,
  };
}

module.exports = {
  CATALOG_PATH,
  HISTORY_KEEP,
  MARKER_PATH,
  REMOTE_PREFIX,
  STORAGE_FORMAT,
  createSaveStorageSync,
  deriveKey,
  identityOfGame,
  isSealed,
  openBuffer,
  sealBuffer,
};
