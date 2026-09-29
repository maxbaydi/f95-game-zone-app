// src/renderer.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  addGame: (game) => ipcRenderer.invoke("add-game", game),
  getGame: (id) => {
    console.log("Invoking getGame for recordId:", id);
    return ipcRenderer.invoke("get-game", id);
  },
  getGames: (offset, limit) =>
    ipcRenderer.invoke("get-games", { offset, limit }),
  removeGame: (id) => ipcRenderer.invoke("remove-game", id),
  unzipGame: (zipPath, extractPath) =>
    ipcRenderer.invoke("unzip-game", { zipPath, extractPath }),
  checkUpdates: () => ipcRenderer.invoke("check-updates"),
  getAppUpdateState: () => ipcRenderer.invoke("get-app-update-state"),
  checkAppUpdate: () => ipcRenderer.invoke("check-app-update"),
  downloadAppUpdate: () => ipcRenderer.invoke("download-app-update"),
  installAppUpdate: () => ipcRenderer.invoke("install-app-update"),
  checkDbUpdates: () => ipcRenderer.invoke("check-db-updates"),
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  maximizeWindow: () => ipcRenderer.invoke("maximize-window"),
  closeWindow: () => {
    console.log("Invoking closeWindow");
    return ipcRenderer.invoke("close-window");
  },
  selectFile: () => {
    console.log("Invoking selectFile");
    return ipcRenderer.invoke("select-file");
  },
  selectDirectory: (options) =>
    ipcRenderer.invoke("select-directory", options || {}),
  getVersion: () => ipcRenderer.invoke("get-version"),
  openSettings: () => ipcRenderer.invoke("open-settings"),
  openImporter: (source) => {
    console.log(`Invoking openImporter with source: ${source}`);
    return ipcRenderer.invoke("open-importer", source);
  },
  onImportSource: (callback) => {
    console.log("Registering onImportSource listener");
    ipcRenderer.on("import-source", (event, source) => callback(source));
  },
  getConfig: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  getCloudAuthState: () => ipcRenderer.invoke("get-cloud-auth-state"),
  signInCloud: (payload) => ipcRenderer.invoke("sign-in-cloud", payload),
  signUpCloud: (payload) => ipcRenderer.invoke("sign-up-cloud", payload),
  signOutCloud: () => ipcRenderer.invoke("sign-out-cloud"),
  runBulkCloudSaveAction: (mode) =>
    ipcRenderer.invoke("run-bulk-cloud-save-action", mode),
  getCloudLibraryCatalog: () => ipcRenderer.invoke("get-cloud-library-catalog"),
  syncCloudLibraryCatalog: () =>
    ipcRenderer.invoke("sync-cloud-library-catalog"),
  getSaveProfileSnapshot: (recordId) =>
    ipcRenderer.invoke("get-save-profile-snapshot", recordId),
  refreshSaveProfiles: (recordId) =>
    ipcRenderer.invoke("refresh-save-profiles", recordId),
  uploadCloudSaves: (recordId) =>
    ipcRenderer.invoke("upload-cloud-saves", recordId),
  getSaveStorageState: () => ipcRenderer.invoke("get-save-storage-state"),
  detectSaveStorageFolders: () =>
    ipcRenderer.invoke("detect-save-storage-folders"),
  testSaveStorageConnection: (payload) =>
    ipcRenderer.invoke("test-save-storage-connection", payload),
  connectSaveStorage: (payload) =>
    ipcRenderer.invoke("connect-save-storage", payload),
  unlockSaveStorage: (passphrase) =>
    ipcRenderer.invoke("unlock-save-storage", { passphrase }),
  disconnectSaveStorage: () => ipcRenderer.invoke("disconnect-save-storage"),
  syncSaveStorageAll: (mode) =>
    ipcRenderer.invoke("sync-save-storage-all", { mode }),
  syncSaveStorageGame: (recordId, action) =>
    ipcRenderer.invoke("sync-save-storage-game", { recordId, action }),
  getSaveStorageCatalog: () => ipcRenderer.invoke("get-save-storage-catalog"),
  exportSaveStorageCard: (passphrase) =>
    ipcRenderer.invoke("export-save-storage-card", { passphrase }),
  importSaveStorageCard: (payload) =>
    ipcRenderer.invoke("import-save-storage-card", payload || {}),
  forgetSaveStorageGame: (recordId) =>
    ipcRenderer.invoke("forget-save-storage-game", { recordId }),
  onSaveStorageChanged: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("save-storage-changed", listener);
    return () => ipcRenderer.removeListener("save-storage-changed", listener);
  },
  onSaveStorageProgress: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("save-storage-progress", listener);
    return () => ipcRenderer.removeListener("save-storage-progress", listener);
  },
  exportGameSaves: (recordId) =>
    ipcRenderer.invoke("export-game-saves", { recordId }),
  importGameSaves: (recordId, options) =>
    ipcRenderer.invoke("import-game-saves", { recordId, ...(options || {}) }),
  exportAllGameSaves: () => ipcRenderer.invoke("export-all-game-saves"),
  openSaveLocation: (recordId, rootPath) =>
    ipcRenderer.invoke("open-save-location", { recordId, rootPath }),
  restoreCloudSaves: (recordId) =>
    ipcRenderer.invoke("restore-cloud-saves", recordId),
  getScanSources: () => ipcRenderer.invoke("get-scan-sources"),
  addScanSource: (sourcePath) =>
    ipcRenderer.invoke("add-scan-source", sourcePath),
  updateScanSource: (params) =>
    ipcRenderer.invoke("update-scan-source", params),
  removeScanSource: (sourceId) =>
    ipcRenderer.invoke("remove-scan-source", sourceId),
  getScanJobs: (limit) => ipcRenderer.invoke("get-scan-jobs", limit),
  getScanCandidates: (limit) =>
    ipcRenderer.invoke("get-scan-candidates", limit),
  startScan: (params) => ipcRenderer.invoke("start-scan", params),
  startScanSources: (params) =>
    ipcRenderer.invoke("start-scan-sources", params),
  cancelScan: () => ipcRenderer.invoke("cancel-scan"),
  scanLibrary: (options) => ipcRenderer.invoke("scan-library", options),
  refreshLibraryPreviews: () => ipcRenderer.invoke("refresh-library-previews"),
  searchAtlasByF95Id: (f95Id) =>
    ipcRenderer.invoke("search-atlas-by-f95-id", f95Id),
  searchAtlas: (title, creator) =>
    ipcRenderer.invoke("search-atlas", { title, creator }),
  searchSiteCatalog: (filters, limit) =>
    ipcRenderer.invoke("search-site-catalog", { filters, limit }),
  getF95AuthStatus: () => ipcRenderer.invoke("get-f95-auth-status"),
  getF95Downloads: () => ipcRenderer.invoke("get-f95-downloads"),
  getF95ThreadInstallState: (payload) =>
    ipcRenderer.invoke("get-f95-thread-install-state", payload),
  addF95ThreadToLibrary: (payload) =>
    ipcRenderer.invoke("add-f95-thread-to-library", payload),
  inspectF95Thread: (payload) =>
    ipcRenderer.invoke("inspect-f95-thread", payload),
  openF95Login: () => ipcRenderer.invoke("open-f95-login"),
  logoutF95: () => ipcRenderer.invoke("logout-f95"),
  installF95Thread: (payload) =>
    ipcRenderer.invoke("install-f95-thread", payload),
  cancelF95Download: (id) => ipcRenderer.invoke("cancel-f95-download", id),
  retryF95Download: (id) => ipcRenderer.invoke("retry-f95-download", id),
  openF95DownloadAction: (id) =>
    ipcRenderer.invoke("open-f95-download-action", id),
  openF95DownloadInBrowser: (id) =>
    ipcRenderer.invoke("open-f95-download-in-browser", id),
  installF95DownloadFromFile: (id) =>
    ipcRenderer.invoke("install-f95-download-from-file", id),
  installF95DownloadFromFolder: (id) =>
    ipcRenderer.invoke("install-f95-download-from-folder", id),
  retryF95Install: (id, password) =>
    ipcRenderer.invoke("retry-f95-install", { id, password: password || "" }),
  clearF95DownloadHistory: () =>
    ipcRenderer.invoke("clear-f95-download-history"),
  showF95DownloadInFolder: (id) =>
    ipcRenderer.invoke("show-f95-download-in-folder", id),
  addAtlasMapping: (recordId, atlasId) =>
    ipcRenderer.invoke("add-atlas-mapping", { recordId, atlasId }),
  findF95Id: (atlasId) => ipcRenderer.invoke("find-f95-id", atlasId),
  getAtlasData: (atlasId) => ipcRenderer.invoke("get-atlas-data", atlasId),
  checkRecordExist: (params) =>
    ipcRenderer.invoke("check-record-exist", params),
  importGames: (params) => ipcRenderer.invoke("import-games", params),
  log: (message) => ipcRenderer.invoke("log", message),
  sendUpdateProgress: (progress) =>
    ipcRenderer.invoke("update-progress", progress),
  getAvailableBannerTemplates: () =>
    ipcRenderer.invoke("get-available-banner-templates"),

  // ─── FIXED: Added missing banner template getter ────────────────────────
  getSelectedBannerTemplate: () =>
    ipcRenderer.invoke("get-selected-banner-template"),

  setSelectedBannerTemplate: (template) =>
    ipcRenderer.invoke("set-selected-banner-template", template),

  // ─── FIXED: Added missing external URL opener for Update Available button ──
  openExternalUrl: (url) => ipcRenderer.invoke("open-external-url", url),
  openF95BrowserUrl: (payload) =>
    ipcRenderer.invoke("open-f95-browser-url", payload),

  saveEmulatorConfig: (config) =>
    ipcRenderer.invoke("save-emulator-config", config),
  getEmulatorConfig: () => ipcRenderer.invoke("get-emulator-config"),
  removeEmulatorConfig: (extension) =>
    ipcRenderer.invoke("remove-emulator-config", extension),
  getPreviews: (recordId) => {
    console.log("Invoking getPreviews for recordId:", recordId);
    return ipcRenderer.invoke("get-previews", recordId);
  },
  updateBanners: (recordId) => {
    console.log("Invoking updateBanners for recordId:", recordId);
    return ipcRenderer.invoke("update-banners", recordId);
  },
  updatePreviews: (recordId) => {
    console.log("Invoking updatePreviews for recordId:", recordId);
    return ipcRenderer.invoke("update-previews", recordId);
  },
  convertAndSaveBanner: (recordId, filePath) => {
    console.log(
      "Invoking convertAndSaveBanner for recordId:",
      recordId,
      "filePath:",
      filePath,
    );
    return ipcRenderer.invoke("convert-and-save-banner", {
      recordId,
      filePath,
    });
  },
  updateGame: (game) => {
    console.log("Invoking updateGame with game data:", game);
    return ipcRenderer.invoke("update-game", game);
  },
  setGameFavorite: (payload) => ipcRenderer.invoke("set-game-favorite", payload),
  updateVersion: (version, record_id) => {
    console.log("Invoking updateVersion with version data:", version);
    return ipcRenderer.invoke("update-version", version, record_id);
  },
  onWindowStateChanged: (callback) => {
    ipcRenderer.on("window-state-changed", (event, state) => callback(state));
  },
  onDbUpdateProgress: (callback) => {
    ipcRenderer.on("db-update-progress", (event, progress) =>
      callback(progress),
    );
  },
  deleteBanner: (recordId) => {
    console.log("Invoking deleteBanner for recordId:", recordId);
    return ipcRenderer.invoke("delete-banner", recordId);
  },
  deletePreviews: (recordId) => {
    console.log("Invoking deletePreviews for recordId:", recordId);
    return ipcRenderer.invoke("delete-previews", recordId);
  },
  onScanProgress: (callback) =>
    ipcRenderer.on("scan-progress", (event, progress) => callback(progress)),
  onScanComplete: (callback) =>
    ipcRenderer.on("scan-complete", (event, game) => callback(game)),
  onScanCompleteFinal: (callback) =>
    ipcRenderer.on("scan-complete-final", (event, games) => callback(games)),
  onScanWarning: (callback) =>
    ipcRenderer.on("scan-warning", (event, warning) => callback(warning)),
  onUpdateProgress: (callback) =>
    ipcRenderer.on("update-progress", (event, progress) => callback(progress)),
  onImportProgress: (callback) =>
    ipcRenderer.on("import-progress", (event, progress) => callback(progress)),
  onGameImported: (callback) => ipcRenderer.on("game-imported", callback),
  onGameUpdated: (callback) => ipcRenderer.on("game-updated", callback),
  onImportComplete: (callback) => ipcRenderer.on("import-complete", callback),
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (event, status) => callback(status));
    return () => ipcRenderer.removeAllListeners("update-status");
  },
  showContextMenu: (template) =>
    ipcRenderer.invoke("show-context-menu", template),
  onContextMenuCommand: (callback) =>
    ipcRenderer.on("context-menu-command", callback),
  openDirectory: (path) => {
    console.log("Invoking openDirectory for path:", path);
    return ipcRenderer.invoke("open-directory", path);
  },
  launchGame: (payload) => ipcRenderer.invoke("launch-game", payload),
  // Library maintenance: locate a moved folder, choose the launcher, backups,
  // catalog link and live thread checks (main/libraryMaintenanceIpc.js).
  relocateGameVersion: (payload) =>
    ipcRenderer.invoke("relocate-game-version", payload),
  listGameExecutables: (payload) =>
    ipcRenderer.invoke("list-game-executables", payload),
  pickGameExecutable: (payload) =>
    ipcRenderer.invoke("pick-game-executable", payload),
  setGameExecutable: (payload) =>
    ipcRenderer.invoke("set-game-executable", payload),
  listLibraryBackups: () => ipcRenderer.invoke("list-library-backups"),
  createLibraryBackup: () => ipcRenderer.invoke("create-library-backup"),
  restoreLibraryBackup: (payload) =>
    ipcRenderer.invoke("restore-library-backup", payload),
  linkGameToCatalog: (payload) =>
    ipcRenderer.invoke("link-game-to-catalog", payload),
  checkLiveUpdates: (payload) =>
    ipcRenderer.invoke("check-live-updates", payload || {}),
  getLiveUpdateState: () => ipcRenderer.invoke("get-live-update-state"),
  startSteamScan: (params) => ipcRenderer.invoke("start-steam-scan", params),
  selectSteamDirectory: () => {
    console.log("Invoking selectSteamDirectory");
    return ipcRenderer.invoke("select-steam-directory");
  },
  onPromptSteamDirectory: (callback) => {
    console.log("Registering onPromptSteamDirectory listener");
    ipcRenderer.on("prompt-steam-directory", () => callback());
  },
  openSteamImportWindow: () => {
    console.log("Invoking openSteamImportWindow");
    return ipcRenderer.invoke("open-steam-import-window");
  },
  getSteamGameData: (steamId) =>
    ipcRenderer.invoke("get-steam-game-data", steamId),

  // ────────────────────────────────────────────────────────────────
  //     METHODS FOR MOVE-TO-LIBRARY FEATURE (already added)
  // ────────────────────────────────────────────────────────────────
  getDefaultGameFolder: () => ipcRenderer.invoke("get-default-game-folder"),
  updateSettings: (section, values) =>
    ipcRenderer.invoke("update-settings", { section, values }),
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),
  inspectFolder: (targetPath, options) =>
    ipcRenderer.invoke("inspect-folder", targetPath, options || {}),
  suggestLibraryFolders: () => ipcRenderer.invoke("suggest-library-folders"),
  detectGameFolders: () => ipcRenderer.invoke("detect-game-folders"),
  relaunchApp: () => ipcRenderer.invoke("relaunch-app"),
  onSettingsChanged: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("settings-changed", listener);
    return () => ipcRenderer.removeListener("settings-changed", listener);
  },
  subscribeF95AuthChanged: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("f95-auth-changed", listener);
    return () => ipcRenderer.removeListener("f95-auth-changed", listener);
  },
  setDefaultGameFolder: (newPath) =>
    ipcRenderer.invoke("set-default-game-folder", newPath),
  moveFolderToLibrary: (args) =>
    ipcRenderer.invoke("move-folder-to-library", args),

  // Optional: better feedback during long imports/moves
  onImportWarning: (callback) =>
    ipcRenderer.on("import-warning", (event, data) => callback(data)),

  // ────────────────────────────────────────────────────────────────
  //     METHODS TO REMOVE
  // ────────────────────────────────────────────────────────────────
  countVersions: (recordId) => ipcRenderer.invoke("count-versions", recordId),
  deleteVersion: (params) => ipcRenderer.invoke("delete-version", params),
  removeLibraryGame: (params) =>
    ipcRenderer.invoke("remove-library-game", params),
  deleteGameCompletely: (recordId) =>
    ipcRenderer.invoke("delete-game-completely", recordId),
  onGameDeleted: (callback) => {
    ipcRenderer.on("game-deleted", (event, recordId) => callback(recordId));
  },
  onLibraryReset: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("library-reset", listener);
    return () => ipcRenderer.removeListener("library-reset", listener);
  },
  onScanCacheReset: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("scan-cache-reset", listener);
    return () => ipcRenderer.removeListener("scan-cache-reset", listener);
  },
  onF95AuthChanged: (callback) =>
    ipcRenderer.on("f95-auth-changed", (event, payload) => callback(payload)),
  onF95DownloadsChanged: (callback) =>
    ipcRenderer.on("f95-downloads-changed", (event, payload) =>
      callback(payload),
    ),
  onCloudAuthChanged: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("cloud-auth-changed", listener);
    return () => ipcRenderer.removeListener("cloud-auth-changed", listener);
  },
  onCloudBulkProgress: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("cloud-bulk-progress", listener);
    return () => ipcRenderer.removeListener("cloud-bulk-progress", listener);
  },
  onGamesLibrarySynced: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("games-library-synced", listener);
    return () => ipcRenderer.removeListener("games-library-synced", listener);
  },
  onF95DownloadProgress: (callback) =>
    ipcRenderer.on("f95-download-progress", (event, payload) =>
      callback(payload),
    ),
  onF95InstallAttempt: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("f95-install-attempt", listener);
    return () => ipcRenderer.removeListener("f95-install-attempt", listener);
  },
  onF95BrowserNavigation: (callback) =>
    ipcRenderer.on("f95-browser-navigation", (event, payload) =>
      callback(payload),
    ),
  getUniqueFilterOptions: () => ipcRenderer.invoke("get-unique-filter-options"),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
