(function () {
  if (typeof window.electronAPI !== "undefined") {
    return;
  }

  const WEB_PREVIEW_CONFIG = {
    Interface: {
      language: "English",
      atlasStartup: "Do Nothing",
      gameStartup: "Do Nothing",
      showDebugConsole: false,
      minimizeToTray: false,
      showGameList: true,
    },
    Library: { rootPath: "", gameFolder: "" },
    Metadata: { downloadPreviews: false },
    Performance: { maxHeapSize: 4096 },
    CloudSync: {
      enabled: false,
      projectRef: "",
      supabaseUrl: "",
      publishableKey: "",
      storageBucket: "",
    },
    F95Mirrors: {},
  };

  const CLOUD_AUTH_STATE = {
    configured: false,
    authenticated: false,
    user: null,
    error: "",
    settings: {},
  };

  const F95_LOGIN_PAGE_URL = "https://f95zone.to/login/";
  const F95_SEARCH_PAGE_URL = "https://f95zone.to/sam/latest_alpha/";
  const PATH_SETTINGS_HTML = "settings.html";
  const PATH_IMPORTER_HTML = "core/ui/windows/importer.html";

  const p = (value) => () => Promise.resolve(value);
  const pn = () => Promise.resolve();
  const noop = () => {};
  const listen = () => noop;
  const listenUnsub = () => () => {};

  const openUrl = (url) => {
    if (typeof url === "string" && url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    return Promise.resolve();
  };

  const openAppHtmlPage = (relativePath) => {
    try {
      const resolved = new URL(relativePath, window.location.href).href;
      window.open(resolved, "_blank", "noopener,noreferrer");
    } catch (_) {
      /* ignore */
    }
    return Promise.resolve();
  };

  window.electronAPI = {
    addGame: p({}),
    getGame: () => Promise.resolve(null),
    getGames: () => Promise.resolve([]),
    removeGame: p({ success: true }),
    unzipGame: p({}),
    checkUpdates: p({}),
    getAppUpdateState: p({}),
    checkAppUpdate: pn,
    downloadAppUpdate: pn,
    installAppUpdate: pn,
    checkDbUpdates: p({ success: true, total: 0, message: "" }),
    minimizeWindow: pn,
    maximizeWindow: pn,
    closeWindow: pn,
    selectFile: () => Promise.resolve(null),
    selectDirectory: () => Promise.resolve(null),
    getVersion: () => Promise.resolve("web-preview"),
    openSettings: () => openAppHtmlPage(PATH_SETTINGS_HTML),
    openImporter: () => openAppHtmlPage(PATH_IMPORTER_HTML),
    onImportSource: listen,
    getConfig: () =>
      Promise.resolve(JSON.parse(JSON.stringify(WEB_PREVIEW_CONFIG))),
    saveSettings: p({ success: true }),
    getCloudAuthState: () =>
      Promise.resolve({ success: true, state: CLOUD_AUTH_STATE }),
    signInCloud: p({ success: false, error: "Desktop only", state: null }),
    signUpCloud: p({ success: false, error: "Desktop only", state: null }),
    signOutCloud: p({ success: true, state: CLOUD_AUTH_STATE }),
    runBulkCloudSaveAction: p({ success: false, error: "Desktop only" }),
    getCloudLibraryCatalog: () =>
      Promise.resolve({ success: true, result: null }),
    syncCloudLibraryCatalog: p({ success: false, error: "Desktop only" }),
    getSaveProfileSnapshot: () =>
      Promise.resolve({ success: true, snapshot: null }),
    refreshSaveProfiles: () =>
      Promise.resolve({ success: true, snapshot: null }),
    uploadCloudSaves: p({ success: false, error: "Desktop only" }),
    restoreCloudSaves: p({ success: false, error: "Desktop only" }),
    getScanSources: () => Promise.resolve({ success: true, sources: [] }),
    addScanSource: p({ success: false, error: "Desktop only" }),
    updateScanSource: p({ success: false, error: "Desktop only" }),
    removeScanSource: p({ success: false, error: "Desktop only" }),
    getScanJobs: () => Promise.resolve({ success: true, jobs: [] }),
    getScanCandidates: () => Promise.resolve({ success: true, candidates: [] }),
    startScan: p({ success: false, error: "Desktop only" }),
    startScanSources: p({ success: false, error: "Desktop only" }),
    cancelScan: p({ success: true, cancelled: true }),
    scanLibrary: p({ success: false, error: "Desktop only", cancelled: false }),
    searchAtlasByF95Id: () => Promise.resolve(null),
    searchAtlas: () => Promise.resolve(null),
    searchSiteCatalog: () =>
      Promise.resolve({ results: [], total: 0, limit: 50, limited: false }),
    getF95AuthStatus: () =>
      Promise.resolve({
        isAuthenticated: false,
        loginUrl: F95_LOGIN_PAGE_URL,
        searchUrl: F95_SEARCH_PAGE_URL,
        cookieCount: 0,
      }),
    getF95Downloads: () =>
      Promise.resolve({ items: [], activeCount: 0 }),
    getF95ThreadInstallState: () =>
      Promise.resolve({
        inLibrary: false,
        installed: false,
        recordId: null,
        title: "",
        creator: "",
        version: "",
        gamePath: "",
        siteUrl: "",
      }),
    addF95ThreadToLibrary: p({ success: false, error: "Desktop only" }),
    inspectF95Thread: p({
      success: false,
      error: "F95 tools require the desktop app.",
    }),
    openF95Login: () => {
      window.open(F95_LOGIN_PAGE_URL, "_blank", "noopener,noreferrer");
      return Promise.resolve({
        isAuthenticated: false,
        loginUrl: F95_LOGIN_PAGE_URL,
        searchUrl: F95_SEARCH_PAGE_URL,
        cookieCount: 0,
      });
    },
    logoutF95: () =>
      Promise.resolve({
        isAuthenticated: false,
        loginUrl: F95_LOGIN_PAGE_URL,
        searchUrl: F95_SEARCH_PAGE_URL,
        cookieCount: 0,
      }),
    installF95Thread: p({
      success: false,
      error: "Desktop only",
    }),
    addAtlasMapping: p({}),
    findF95Id: () => Promise.resolve(null),
    getAtlasData: () => Promise.resolve(null),
    checkRecordExist: p({ exists: false }),
    importGames: p({ success: false }),
    log: pn,
    sendUpdateProgress: pn,
    getAvailableBannerTemplates: () => Promise.resolve([]),
    getSelectedBannerTemplate: () => Promise.resolve("Default"),
    setSelectedBannerTemplate: p({ success: true }),
    openExternalUrl: openUrl,
    saveEmulatorConfig: p({ success: true }),
    getEmulatorConfig: () => Promise.resolve([]),
    removeEmulatorConfig: p({ success: true }),
    getPreviews: () => Promise.resolve([]),
    updateBanners: () => Promise.resolve(null),
    updatePreviews: () => Promise.resolve([]),
    convertAndSaveBanner: p({ success: false }),
    updateGame: p({ success: false }),
    updateVersion: p({ success: false }),
    onWindowStateChanged: listen,
    onDbUpdateProgress: listen,
    deleteBanner: p({ success: false }),
    deletePreviews: p({ success: false }),
    onScanProgress: listen,
    onScanComplete: listen,
    onScanCompleteFinal: listen,
    onScanWarning: listen,
    onUpdateProgress: listen,
    onImportProgress: listen,
    onGameImported: listen,
    onGameUpdated: listen,
    onImportComplete: listen,
    onUpdateStatus: listenUnsub,
    removeUpdateStatusListener: noop,
    showContextMenu: pn,
    onContextMenuCommand: listen,
    onGameData: listen,
    openDirectory: openUrl,
    launchGame: p({
      success: false,
      error: "Launch requires the desktop app.",
    }),
    onGameDetailsImportProgress: listen,
    removeGameDetailsImportProgressListener: noop,
    startSteamScan: p({ success: false }),
    selectSteamDirectory: () => Promise.resolve(null),
    onPromptSteamDirectory: listen,
    openSteamImportWindow: pn,
    getSteamGameData: () => Promise.resolve(null),
    getDefaultGameFolder: () => Promise.resolve(""),
    setDefaultGameFolder: p({ success: false }),
    moveFolderToLibrary: p({ success: false }),
    onImportWarning: listen,
    countVersions: () => Promise.resolve(0),
    deleteVersion: p({ success: false }),
    deleteGameCompletely: p({ success: false }),
    deleteFolderRecursive: p({ success: false }),
    onGameDeleted: listen,
    onF95AuthChanged: listen,
    onF95DownloadsChanged: listen,
    onCloudAuthChanged: listenUnsub,
    onCloudBulkProgress: listenUnsub,
    onF95DownloadProgress: listen,
    getUniqueFilterOptions: () =>
      Promise.resolve({
        categories: [],
        engines: [],
        statuses: [],
        censored: [],
        languages: [],
        tags: [],
      }),
    removeAllListeners: noop,
  };
})();
