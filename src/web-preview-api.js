(function () {
  if (typeof window.electronAPI !== "undefined") {
    return;
  }

  const WEB_PREVIEW_CONFIG = {
    Interface: {
      language: "English",
      gameStartup: "Do Nothing",
      showDebugConsole: false,
      minimizeToTray: false,
      showGameList: true,
    },
    Library: { rootPath: "", gameFolder: "" },
    Metadata: { downloadPreviews: false },
    Performance: { maxHeapSize: 4096 },
    Onboarding: { completed: true },
    F95Mirrors: {},
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

  const WEB_PREVIEW_API = {
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
    updateSettings: (section, values) => {
      WEB_PREVIEW_CONFIG[section] = {
        ...(WEB_PREVIEW_CONFIG[section] || {}),
        ...(values || {}),
      };
      return Promise.resolve({
        success: true,
        config: JSON.parse(JSON.stringify(WEB_PREVIEW_CONFIG)),
      });
    },
    getAppInfo: () =>
      Promise.resolve({
        version: "web-preview",
        platform: "web",
        isPackaged: false,
        isFreshInstall: false,
        paths: {},
        defaults: {
          gameExtensions: "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
          extractionExtensions: "zip,7z,rar",
        },
      }),
    inspectFolder: (targetPath) =>
      Promise.resolve({
        path: String(targetPath || ""),
        exists: false,
        writable: false,
        freeBytes: null,
        totalBytes: null,
        status: "error",
        warnings: [
          {
            code: "desktop_only",
            level: "error",
            message: "Folders can only be checked in the desktop app.",
          },
        ],
      }),
    suggestLibraryFolders: () => Promise.resolve([]),
    detectGameFolders: () => Promise.resolve([]),
    relaunchApp: pn,
    onSettingsChanged: listenUnsub,
    subscribeF95AuthChanged: listenUnsub,
    getSaveProfileSnapshot: () =>
      Promise.resolve({ success: true, snapshot: null }),
    refreshSaveProfiles: () =>
      Promise.resolve({ success: true, snapshot: null }),
    exportGameSaves: p({ success: false, error: "Desktop only" }),
    getSaveStorageState: p({
      success: true,
      state: { connected: false, type: "", label: "", encrypted: false, locked: false, busy: false, lastError: "", lastSyncAt: "", description: "", settings: {}, encryptionEnabled: false, secretsEncrypted: false, deviceName: "" },
    }),
    detectSaveStorageFolders: p({ success: true, folders: [] }),
    testSaveStorageConnection: p({ success: false, error: "Desktop only" }),
    connectSaveStorage: p({ success: false, error: "Desktop only" }),
    unlockSaveStorage: p({ success: false, error: "Desktop only" }),
    disconnectSaveStorage: p({ success: false, error: "Desktop only" }),
    syncSaveStorageAll: p({ success: false, error: "Desktop only" }),
    syncSaveStorageGame: p({ success: false, error: "Desktop only" }),
    getSaveStorageCatalog: p({ success: true, entries: [] }),
    exportSaveStorageCard: p({ success: false, error: "Desktop only" }),
    importSaveStorageCard: p({ success: false, error: "Desktop only" }),
    forgetSaveStorageGame: p({ success: false, error: "Desktop only" }),
    onSaveStorageChanged: listenUnsub,
    onSaveStorageProgress: listenUnsub,
    importGameSaves: p({ success: false, error: "Desktop only" }),
    exportAllGameSaves: p({ success: false, error: "Desktop only" }),
    openSaveLocation: p({ success: false, error: "Desktop only" }),
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
    cancelF95Download: p({ success: false, error: "Desktop only" }),
    retryF95Download: p({ success: false, error: "Desktop only" }),
    retryF95Install: p({ success: false, error: "Desktop only" }),
    installF95DownloadFromFile: p({ success: false, error: "Desktop only" }),
    installF95DownloadFromFolder: p({ success: false, error: "Desktop only" }),
    clearF95DownloadHistory: p({ success: true }),
    showF95DownloadInFolder: p({ success: false, error: "Desktop only" }),
    onF95InstallAttempt: listenUnsub,
    onF95BrowserNavigation: listen,
    openF95BrowserUrl: (payload) => openUrl(payload?.url),
    refreshLibraryPreviews: p({ success: false, error: "Desktop only" }),
    setGameFavorite: p({ success: false, error: "Desktop only" }),
    removeLibraryGame: p({ success: false, error: "Desktop only" }),
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
    openDirectory: openUrl,
    launchGame: p({
      success: false,
      error: "Launch requires the desktop app.",
    }),
    relocateGameVersion: p({ success: false, error: "Desktop only" }),
    listGameExecutables: p({ success: false, error: "Desktop only" }),
    pickGameExecutable: p({ success: false, cancelled: true }),
    setGameExecutable: p({ success: false, error: "Desktop only" }),
    listLibraryBackups: () => Promise.resolve([]),
    createLibraryBackup: p({ success: false, error: "Desktop only" }),
    restoreLibraryBackup: p({ success: false, error: "Desktop only" }),
    linkGameToCatalog: p({ success: false, error: "Desktop only" }),
    checkLiveUpdates: p({
      success: true,
      checked: 0,
      updated: 0,
      failed: 0,
      skippedReason: "not_authenticated",
      finishedAt: "",
    }),
    getLiveUpdateState: () =>
      Promise.resolve({ running: false, lastRun: null, nextRunAt: null }),
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
    onLibraryReset: listenUnsub,
    onF95AuthChanged: listen,
    onF95DownloadsChanged: listen,
    onGamesLibrarySynced: listenUnsub,
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

  // ------------------------------------------------------------------ demo
  // `index.html?demo=1` fills the browser preview with a fictional library so
  // the interface can be screenshotted (scripts/screenshots.js). Without the
  // flag nothing below runs and the stub behaves exactly as before.
  // `?demo=1&onboarding=saves` additionally starts with an empty library and
  // Onboarding.completed=false, so the first-launch assistant opens; the save
  // storage is then not connected yet, so the "Saves" step shows the detected
  // cloud folders.
  const DEMO_QUERY = new URLSearchParams(window.location.search || "");
  const DEMO_ENABLED = DEMO_QUERY.get("demo") === "1";
  const DEMO_ONBOARDING_STEP = DEMO_ENABLED
    ? String(DEMO_QUERY.get("onboarding") || "").trim()
    : "";

  const buildDemoApi = () => {
    const DEMO_APP_VERSION = "1.6.0";
    const DEMO_GAMES_FOLDER = "D:\\Games\\F95Launcher";
    const DEMO_USER_FOLDER = "C:\\Users\\Alex";
    const DEMO_APPDATA = `${DEMO_USER_FOLDER}\\AppData\\Roaming\\F95Launcher`;
    const now = Date.now();
    const minutesAgo = (minutes) => new Date(now - minutes * 60000).toISOString();
    const daysAgoUnix = (days) => Math.floor((now - days * 86400000) / 1000);
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const isoDeep = (value) => Promise.resolve(clone(value));

    const escapeXml = (value) =>
      String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]);

    const svgDataUri = (svg) =>
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    // Gradient "cover art" with the title, used for banners and screenshots.
    const demoArt = ({ width, height, palette, title, subtitle, label }) => {
      const [from, to, glow] = palette;
      const fontSize = Math.max(12, Math.round(height * 0.12));
      const pad = Math.round(width * 0.05);
      const font = "Manrope, 'Segoe UI', Roboto, sans-serif";
      const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        "<defs>",
        `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`,
        `<radialGradient id="r" cx="0.82" cy="0.18" r="0.75"><stop offset="0" stop-color="${glow}" stop-opacity="0.85"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>`,
        `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></linearGradient>`,
        "</defs>",
        `<rect width="100%" height="100%" fill="url(#g)"/>`,
        `<rect width="100%" height="100%" fill="url(#r)"/>`,
        `<circle cx="${Math.round(width * 0.76)}" cy="${Math.round(height * 0.38)}" r="${Math.round(height * 0.3)}" fill="#fff" fill-opacity="0.09"/>`,
        `<circle cx="${Math.round(width * 0.58)}" cy="${Math.round(height * 0.86)}" r="${Math.round(height * 0.44)}" fill="#000" fill-opacity="0.14"/>`,
        `<path d="M0 ${Math.round(height * 0.74)} L${width} ${Math.round(height * 0.52)} L${width} ${height} L0 ${height} Z" fill="#000" fill-opacity="0.2"/>`,
        `<rect width="100%" height="100%" fill="url(#s)"/>`,
        label
          ? `<text x="${pad}" y="${pad + Math.round(fontSize * 0.55)}" font-family="${font}" font-size="${Math.round(fontSize * 0.5)}" font-weight="600" letter-spacing="2" fill="#fff" fill-opacity="0.8">${escapeXml(String(label).toUpperCase())}</text>`
          : "",
        `<text x="${pad}" y="${height - pad - (subtitle ? Math.round(fontSize * 0.8) : 0)}" font-family="${font}" font-size="${fontSize}" font-weight="700" fill="#fff">${escapeXml(title)}</text>`,
        subtitle
          ? `<text x="${pad}" y="${height - pad}" font-family="${font}" font-size="${Math.round(fontSize * 0.52)}" fill="#fff" fill-opacity="0.85">${escapeXml(subtitle)}</text>`
          : "",
        "</svg>",
      ].join("");
      return svgDataUri(svg);
    };

    const folderName = (title) => title.replace(/[^A-Za-z0-9 &]/g, "").trim();
    const slug = (title) =>
      title
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    const demoVersion = ({
      version,
      title,
      engine,
      daysAgo,
      sizeGb,
      isPresent = true,
      execName,
    }) => {
      const gamePath = `${DEMO_GAMES_FOLDER}\\${folderName(title)}`;
      const exec =
        execName === null
          ? ""
          : execName ||
            (engine === "HTML"
              ? "index.html"
              : engine === "RPGM"
                ? "Game.exe"
                : `${folderName(title).replace(/\s+/g, "")}.exe`);
      return {
        version,
        game_path: gamePath,
        exec_path: exec ? `${gamePath}\\${exec}` : "",
        in_place: 0,
        last_played: isPresent ? daysAgoUnix(Math.max(0, daysAgo - 1)) : null,
        version_playtime: Math.round(sizeGb * 3.7 * 3600),
        folder_size: Math.round(sizeGb * 1024 ** 3),
        date_added: daysAgoUnix(daysAgo),
        isPresent,
      };
    };

    // Fictional catalog. Titles, studios and threads do not exist.
    const DEMO_GAME_SPECS = [
      {
        record_id: 1,
        title: "Harbor Lights",
        creator: "Lanternfall Studio",
        engine: "Ren'Py",
        status: "Ongoing",
        palette: ["#0f3b5c", "#1f7a8c", "#ffb703"],
        isFavorite: true,
        rating: "4.7",
        f95_tags:
          "adventure, mystery, romance, slice of life, visual novel, point and click",
        overview:
          "A quiet coastal town, a lighthouse that went dark thirty years ago and a summer job that turns into the strangest investigation of your life. Every chapter adds a new resident, a new secret and a new way to spend your evenings.",
        language: "English",
        translations: "German, Spanish, Portuguese",
        os: "Windows, Linux, Mac",
        releaseDaysAgo: 3,
        liveVersion: "0.10.0",
        liveCheckedMinutesAgo: 95,
        versions: [
          { version: "0.9.2", daysAgo: 12, sizeGb: 1.8 },
          { version: "0.8.0", daysAgo: 61, sizeGb: 1.6 },
        ],
        playtimeHours: 23,
      },
      {
        record_id: 2,
        title: "Starfall Academy",
        creator: "Nebula Forge",
        engine: "Unity",
        status: "Ongoing",
        palette: ["#2b1055", "#7597de", "#ff8fab"],
        isFavorite: true,
        rating: "4.5",
        f95_tags: "sci-fi, school, management, dating sim, 3d game, sandbox",
        overview:
          "Enrol at an orbital academy where every semester is a season. Balance classes, clubs and the friendships that decide which ending you reach.",
        language: "English",
        translations: "Russian, French",
        os: "Windows, Mac",
        releaseDaysAgo: 18,
        versions: [{ version: "1.4", daysAgo: 4, sizeGb: 4.2 }],
        playtimeHours: 41,
      },
      {
        record_id: 3,
        title: "Ashen Kingdom",
        creator: "Ironleaf Games",
        engine: "RPGM",
        status: "Ongoing",
        palette: ["#3a0d0d", "#8a2b2b", "#f4a261"],
        rating: "4.3",
        f95_tags: "fantasy, rpg, turn based combat, adventure, male protagonist",
        overview:
          "A fallen kingdom, a reluctant heir and an army of ash. Classic top-down role-playing with a crafting system that matters.",
        language: "English",
        translations: "Italian",
        os: "Windows",
        releaseDaysAgo: 9,
        liveVersion: "0.8",
        liveCheckedMinutesAgo: 95,
        lastKnownVersion: "0.7.1",
        versions: [
          { version: "0.7.1", daysAgo: 45, sizeGb: 2.9, isPresent: false },
        ],
        playtimeHours: 12,
      },
      {
        record_id: 4,
        title: "Midnight Bakery",
        creator: "Sugarplum Interactive",
        engine: "Ren'Py",
        status: "Completed",
        palette: ["#4a1942", "#c05299", "#ffd6ff"],
        isFavorite: true,
        rating: "4.8",
        f95_tags: "romance, cooking, slice of life, visual novel, humor, multiple endings",
        overview:
          "You inherited a bakery that only opens after midnight. The regulars are odd, the recipes are older than the town and the ovens hum when nobody is looking.",
        language: "English",
        translations: "Japanese, German",
        os: "Windows, Linux, Mac",
        releaseDaysAgo: 120,
        versions: [{ version: "2.1", daysAgo: 30, sizeGb: 1.1 }],
        playtimeHours: 9,
      },
      {
        record_id: 5,
        title: "Neon Drift City",
        creator: "Voltaic Works",
        engine: "Unreal Engine",
        status: "Ongoing",
        palette: ["#0b0f2b", "#3a0ca3", "#4cc9f0"],
        rating: "4.1",
        f95_tags: "cyberpunk, racing, open world, 3d game, action",
        overview:
          "Street racing in a city that never turns its neon off. Tune your car, take contracts and stay ahead of the syndicates.",
        language: "English",
        translations: "None",
        os: "Windows",
        releaseDaysAgo: 2,
        liveVersion: "0.4",
        liveCheckedMinutesAgo: 95,
        versions: [{ version: "0.3", daysAgo: 20, sizeGb: 7.4 }],
        playtimeHours: 6,
      },
      {
        record_id: 6,
        title: "The Cartographer's Daughter",
        creator: "Paper Compass",
        engine: "HTML",
        status: "Ongoing",
        palette: ["#2d3a1f", "#6a994e", "#f2e8cf"],
        rating: "4.4",
        f95_tags: "text based, exploration, adventure, female protagonist, historical",
        overview:
          "Chart unknown coasts with your late father's instruments. A branching text adventure with hand-drawn maps that fill in as you travel.",
        language: "English",
        translations: "Spanish",
        os: "Windows, Linux, Mac",
        releaseDaysAgo: 14,
        versions: [{ version: "0.12", daysAgo: 7, sizeGb: 0.4, execName: "index.html" }],
        playtimeHours: 5,
      },
      {
        record_id: 7,
        title: "Emberwood Tales",
        creator: "Mossgate Collective",
        engine: "Godot",
        status: "Ongoing",
        palette: ["#1b4332", "#40916c", "#ffba08"],
        rating: "4.2",
        f95_tags: "fantasy, 2d game, adventure, puzzle, anthology",
        overview:
          "Short interlocking stories from a forest village, told one season at a time. Each tale can be replayed with what you learned in the others.",
        language: "English",
        translations: "Polish, French",
        os: "Windows, Linux",
        releaseDaysAgo: 26,
        versions: [{ version: "0.5", daysAgo: 16, sizeGb: 0.9 }],
        playtimeHours: 4,
      },
      {
        record_id: 8,
        title: "Silver Coast Resort",
        creator: "Tidewater Games",
        engine: "Ren'Py",
        status: "Onhold",
        palette: ["#023e8a", "#0096c7", "#ffd60a"],
        rating: "3.9",
        f95_tags: "management, romance, sandbox, visual novel, beach",
        overview:
          "Run a run-down seaside resort back to its glory days. Hire staff, plan the season and keep the guests coming back.",
        language: "English",
        translations: "None",
        os: "Windows, Mac",
        releaseDaysAgo: 200,
        versions: [{ version: "0.8", daysAgo: 90, sizeGb: 2.2 }],
        playtimeHours: 14,
      },
      {
        record_id: 9,
        title: "Clockwork Hearts",
        creator: "Brass Lantern",
        engine: "RPGM",
        status: "Completed",
        palette: ["#3d2b1f", "#9c6644", "#e9c46a"],
        rating: "4.6",
        f95_tags: "steampunk, rpg, romance, adventure, turn based combat",
        overview:
          "An automaton with a borrowed heart searches the clockwork city for the engineer who built her. A complete story with three endings.",
        language: "English",
        translations: "German, Russian, Chinese",
        os: "Windows",
        releaseDaysAgo: 300,
        versions: [{ version: "1.0", daysAgo: 75, sizeGb: 1.7 }],
        playtimeHours: 19,
      },
      {
        record_id: 10,
        title: "Orbit & Ivy",
        creator: "Greenhouse Nine",
        engine: "Unity",
        status: "Ongoing",
        palette: ["#14213d", "#2a9d8f", "#e9ff70"],
        rating: "4.4",
        f95_tags: "sci-fi, farming, cozy, 3d game, simulation",
        overview:
          "Tend a greenhouse on a space station and trade with the ships that pass by. Slow, gentle and surprisingly deep.",
        language: "English",
        translations: "Korean",
        os: "Windows, Mac",
        releaseDaysAgo: 1,
        liveVersion: "0.7",
        liveCheckedMinutesAgo: 95,
        versions: [{ version: "0.6", daysAgo: 25, sizeGb: 3.1 }],
        playtimeHours: 8,
      },
      {
        record_id: 11,
        title: "Lanterns of Kyoto",
        creator: "Paper Crane Studio",
        engine: "Ren'Py",
        status: "Ongoing",
        palette: ["#590d22", "#c9184a", "#ffb3c1"],
        rating: "4.5",
        f95_tags: "visual novel, romance, historical, mystery, japan",
        overview:
          "A festival week in old Kyoto, seen through the eyes of a lantern maker's apprentice.",
        language: "English",
        translations: "Japanese",
        os: "Windows, Linux, Mac",
        releaseDaysAgo: 6,
        liveVersion: "0.4.5",
        liveCheckedMinutesAgo: 95,
        versions: [],
      },
    ];

    const buildDemoGame = (spec) => {
      const versions = spec.versions.map((version) =>
        demoVersion({ ...version, title: spec.title, engine: spec.engine }),
      );
      const present = versions.filter((version) => version.isPresent !== false);
      const newestInstalled = present
        .slice()
        .sort((left, right) => right.date_added - left.date_added)[0];
      const newestInstalledVersion = newestInstalled ? newestInstalled.version : "";
      const latestVersion = spec.liveVersion || newestInstalledVersion || spec.lastKnownVersion || "";
      const installState =
        versions.length === 0 ? "not_installed" : present.length > 0 ? "installed" : "missing";
      const f95Id = 180000 + spec.record_id * 137;
      const bannerUrl = demoArt({
        width: 460,
        height: 215,
        palette: spec.palette,
        title: spec.title,
        subtitle: spec.creator,
        label: spec.engine,
      });
      const bannerSmallUrl = demoArt({
        width: 252,
        height: 108,
        palette: spec.palette,
        title: spec.title,
      });
      return {
        record_id: spec.record_id,
        atlas_id: 5000 + spec.record_id,
        title: spec.title,
        creator: spec.creator,
        engine: spec.engine,
        isFavorite: Boolean(spec.isFavorite),
        description: spec.overview,
        total_playtime: Math.round((spec.playtimeHours || 0) * 3600),
        last_played_r: present.length ? daysAgoUnix(1) : null,
        last_played_version: newestInstalledVersion || null,
        banner_path: `${DEMO_APPDATA}\\banners\\${slug(spec.title)}-small.png`,
        bannerPath: `${DEMO_APPDATA}\\banners\\${slug(spec.title)}.png`,
        remote_banner_url: "",
        banner_url: bannerUrl,
        banner_small_url: bannerSmallUrl,
        f95_id: f95Id,
        siteUrl: `https://f95zone.to/threads/${slug(spec.title)}.${f95Id}/`,
        views: 12000 + spec.record_id * 4173,
        likes: 400 + spec.record_id * 91,
        f95_tags: spec.f95_tags,
        rating: spec.rating,
        atlas_title: spec.title,
        atlas_creator: spec.creator,
        status: spec.status,
        category: "Game",
        censored: "No",
        genre: spec.f95_tags,
        language: spec.language,
        os: spec.os,
        overview: spec.overview,
        translations: spec.translations,
        release_date: daysAgoUnix(spec.releaseDaysAgo || 30),
        voice: "No",
        short_name: slug(spec.title),
        tags: spec.f95_tags,
        atlasLatestVersion: latestVersion,
        liveVersion: spec.liveVersion || "",
        liveCheckedAt: spec.liveVersion ? minutesAgo(spec.liveCheckedMinutesAgo || 120) : "",
        latestVersion,
        displayTitle: spec.title,
        displayCreator: spec.creator,
        versions,
        versionCount: versions.length,
        isUpdateAvailable:
          installState === "installed" &&
          Boolean(latestVersion) &&
          latestVersion !== newestInstalledVersion,
        newestInstalledVersion,
        lastKnownVersion: spec.lastKnownVersion || newestInstalledVersion || "",
        installState,
      };
    };

    const DEMO_GAMES = DEMO_GAME_SPECS.map(buildDemoGame);
    const findDemoGame = (recordId) =>
      DEMO_GAMES.find((game) => game.record_id === Number(recordId)) || null;

    const DEMO_SCREENSHOT_SCENES = [
      "Chapter 1 · First morning",
      "Chapter 2 · The market",
      "Chapter 3 · After dark",
      "Chapter 4 · Old friends",
    ];
    const demoPreviews = (game) =>
      DEMO_SCREENSHOT_SCENES.map((scene, index) =>
        demoArt({
          width: 960,
          height: 540,
          palette: [game && index % 2 ? game.palette[1] : game.palette[0], game.palette[2], game.palette[1]],
          title: game.title,
          subtitle: scene,
          label: `Screenshot ${index + 1}`,
        }),
      );
    // Keep the palette next to the record for the screenshot generator.
    DEMO_GAMES.forEach((game, index) => {
      game.palette = DEMO_GAME_SPECS[index].palette;
    });

    const DEMO_DOWNLOADS = {
      activeCount: 1,
      items: [
        {
          id: "dl-ashen-kingdom-0-8",
          status: "error",
          title: "Ashen Kingdom 0.8",
          fileName: "AshenKingdom-0.8-pc.rar",
          text: "Install stopped: the archive could not be unpacked.",
          percent: 100,
          totalBytes: 3.1 * 1024 ** 3,
          receivedBytes: 3.1 * 1024 ** 3,
          hostLabel: "Pixeldrain",
          error: "The archive is protected with a password.",
          errorCode: "archive_encrypted",
          needsPassword: true,
          canInstallFromPackage: true,
          packagePath: `${DEMO_USER_FOLDER}\\Downloads\\F95Launcher\\AshenKingdom-0.8-pc.rar`,
          hint: "Look for the password in the game thread, right next to the download links. Enter it below and the install continues without downloading again.",
          canCancel: false,
          canRetry: true,
          canInstallManually: false,
          updatedAt: minutesAgo(4),
          threadUrl: findDemoGame(3).siteUrl,
        },
        {
          id: "dl-harbor-lights-0-10-0",
          status: "installing",
          title: "Harbor Lights 0.10.0",
          fileName: "HarborLights-0.10.0-pc.zip",
          text: `Unpacking into ${DEMO_GAMES_FOLDER}\\Harbor Lights…`,
          percent: 100,
          totalBytes: 1.9 * 1024 ** 3,
          receivedBytes: 1.9 * 1024 ** 3,
          speedBytesPerSecond: 0,
          hostLabel: "GoFile",
          canCancel: false,
          canRetry: false,
          updatedAt: minutesAgo(0),
          threadUrl: findDemoGame(1).siteUrl,
        },
        {
          id: "dl-orbit-ivy-0-7",
          status: "completed",
          title: "Orbit & Ivy 0.7",
          fileName: "OrbitAndIvy-0.7-win.7z",
          text: `Installed to ${DEMO_GAMES_FOLDER}\\Orbit & Ivy. Saves were kept.`,
          percent: 100,
          totalBytes: 3.3 * 1024 ** 3,
          receivedBytes: 3.3 * 1024 ** 3,
          hostLabel: "Mega",
          recordId: 10,
          canCancel: false,
          canRetry: false,
          updatedAt: minutesAgo(26),
          threadUrl: findDemoGame(10).siteUrl,
        },
        {
          id: "dl-neon-drift-city-0-4",
          status: "error",
          title: "Neon Drift City 0.4",
          fileName: "NeonDriftCity-0.4-pc.zip",
          text: "Install stopped: not enough free space.",
          percent: 100,
          totalBytes: 7.9 * 1024 ** 3,
          receivedBytes: 7.9 * 1024 ** 3,
          hostLabel: "GoFile",
          error: "Not enough free space on D: (needs 8.2 GB, 1.4 GB free).",
          errorCode: "disk_full",
          canInstallFromPackage: true,
          packagePath: `${DEMO_USER_FOLDER}\\Downloads\\F95Launcher\\NeonDriftCity-0.4-pc.zip`,
          hint: "Free up space or move the games folder in Settings → Library & folders, then press Retry install. The downloaded file is kept, nothing is downloaded again.",
          canCancel: false,
          canRetry: true,
          updatedAt: minutesAgo(51),
          threadUrl: findDemoGame(5).siteUrl,
        },
      ],
    };

    const demoSaveSnapshot = (recordId) => {
      const game = findDemoGame(recordId);
      if (!game) {
        return { success: false, error: "Unknown library record." };
      }
      const installPath = `${DEMO_GAMES_FOLDER}\\${folderName(game.title)}`;
      const renpySlug = `${folderName(game.title).replace(/\s+/g, "")}-${1700000000 + game.record_id * 4211}`;
      const fileSummary = `${10 + game.record_id} files · ${(1.2 + game.record_id * 0.3).toFixed(1)} MB`;
      return {
        success: true,
        snapshot: {
          recordId: game.record_id,
          title: game.title,
          profiles: [
            {
              provider: "",
              strategy: { type: "install-relative", relativePath: "game\\saves" },
              rootPath: `${installPath}\\game\\saves`,
              reasons: ["Save folder inside the game directory", fileSummary],
              fileCount: 10 + game.record_id,
            },
            {
              provider: "renpy_appdata",
              strategy: {
                type: "windows-known-folder",
                folder: "AppData\\Roaming\\RenPy",
              },
              rootPath: `${DEMO_USER_FOLDER}\\AppData\\Roaming\\RenPy\\${renpySlug}`,
              reasons: ["Ren'Py keeps a copy of every save here", fileSummary],
              fileCount: 10 + game.record_id,
            },
          ],
          syncState: {
            syncStatus: "synced",
            lastUploadedAt: minutesAgo(38),
            lastDownloadedAt: minutesAgo(3 * 24 * 60 + 15),
            lastRemotePath: `games/${slug(game.title)}/saves.zip`,
            lastError: "",
          },
        },
      };
    };

    const DEMO_STORAGE_CONNECTED = {
      connected: true,
      type: "folder",
      label: "OneDrive",
      description: `OneDrive · ${DEMO_USER_FOLDER}\\OneDrive\\F95Launcher Saves`,
      encrypted: false,
      locked: false,
      busy: false,
      lastError: "",
      lastSyncAt: minutesAgo(12),
      settings: {
        folderPath: `${DEMO_USER_FOLDER}\\OneDrive\\F95Launcher Saves`,
      },
      encryptionEnabled: false,
      secretsEncrypted: true,
      deviceName: "DESKTOP-ALEX",
    };
    const DEMO_STORAGE_DISCONNECTED = {
      connected: false,
      type: "",
      label: "",
      description: "",
      encrypted: false,
      locked: false,
      busy: false,
      lastError: "",
      lastSyncAt: "",
      settings: {},
      encryptionEnabled: false,
      secretsEncrypted: true,
      deviceName: "DESKTOP-ALEX",
    };
    const demoStorageState = () =>
      DEMO_ONBOARDING_STEP ? DEMO_STORAGE_DISCONNECTED : DEMO_STORAGE_CONNECTED;

    const DEMO_STORAGE_CATALOG = [
      {
        identity: "harbor-lights",
        title: "Harbor Lights",
        creator: "Lanternfall Studio",
        recordId: 1,
        fileCount: 14,
        updatedAt: minutesAgo(38),
        device: "DESKTOP-ALEX",
        inLibrary: true,
        installed: true,
      },
      {
        identity: "starfall-academy",
        title: "Starfall Academy",
        creator: "Nebula Forge",
        recordId: 2,
        fileCount: 6,
        updatedAt: minutesAgo(26 * 60),
        device: "DESKTOP-ALEX",
        inLibrary: true,
        installed: true,
      },
      {
        identity: "midnight-bakery",
        title: "Midnight Bakery",
        creator: "Sugarplum Interactive",
        recordId: 4,
        fileCount: 21,
        updatedAt: minutesAgo(5 * 24 * 60),
        device: "ALEX-LAPTOP",
        inLibrary: true,
        installed: true,
      },
      {
        identity: "ashen-kingdom",
        title: "Ashen Kingdom",
        creator: "Ironleaf Games",
        recordId: 3,
        fileCount: 9,
        updatedAt: minutesAgo(12 * 24 * 60),
        device: "ALEX-LAPTOP",
        inLibrary: true,
        installed: false,
      },
      {
        identity: "quiet-meadows",
        title: "Quiet Meadows",
        creator: "Hollowbrook",
        recordId: null,
        fileCount: 4,
        updatedAt: minutesAgo(30 * 24 * 60),
        device: "ALEX-LAPTOP",
        inLibrary: false,
        installed: false,
      },
    ];

    const DEMO_STORAGE_FOLDERS = [
      {
        id: "onedrive",
        label: "OneDrive",
        path: `${DEMO_USER_FOLDER}\\OneDrive`,
        suggestedPath: `${DEMO_USER_FOLDER}\\OneDrive\\F95Launcher Saves`,
        reason: "The OneDrive client is running and signed in on this PC.",
        recommended: true,
      },
      {
        id: "dropbox",
        label: "Dropbox",
        path: `${DEMO_USER_FOLDER}\\Dropbox`,
        suggestedPath: `${DEMO_USER_FOLDER}\\Dropbox\\F95Launcher Saves`,
        reason: "Dropbox folder found; the client keeps it in sync.",
        recommended: false,
      },
      {
        id: "googledrive",
        label: "Google Drive",
        path: "G:\\My Drive",
        suggestedPath: "G:\\My Drive\\F95Launcher Saves",
        reason: "Google Drive for desktop is mounted as drive G:.",
        recommended: false,
      },
    ];

    const DEMO_SCAN_SOURCES = [
      {
        id: 1,
        path: DEMO_GAMES_FOLDER,
        isEnabled: true,
        createdAt: minutesAgo(40 * 24 * 60),
        lastScannedAt: minutesAgo(2 * 60 + 5),
      },
      {
        id: 2,
        path: "E:\\Downloads\\Games",
        isEnabled: true,
        createdAt: minutesAgo(9 * 24 * 60),
        lastScannedAt: minutesAgo(2 * 60 + 5),
      },
    ];

    const DEMO_SCAN_JOBS = [
      {
        id: 41,
        status: "completed",
        mode: "incremental",
        startedAt: minutesAgo(2 * 60 + 9),
        finishedAt: minutesAgo(2 * 60 + 5),
        gamesFound: 12,
        errorsCount: 0,
        notes: { sourcePaths: DEMO_SCAN_SOURCES.map((source) => source.path) },
      },
      {
        id: 40,
        status: "completed",
        mode: "refresh",
        startedAt: minutesAgo(2 * 24 * 60 + 30),
        finishedAt: minutesAgo(2 * 24 * 60 + 22),
        gamesFound: 11,
        errorsCount: 0,
        notes: { sourcePaths: [DEMO_GAMES_FOLDER] },
      },
    ];

    const DEMO_SCAN_CANDIDATES = [
      {
        id: 301,
        title: "Frostpeak Chronicles",
        creator: "Glacier Hollow",
        engine: "RPGM",
        version: "0.3",
        detectionScore: 92,
        folderPath: "E:\\Downloads\\Games\\FrostpeakChronicles-0.3-pc",
        detectionReasons: [
          "Game.exe and www\\ folder found",
          "Version parsed from the folder name",
          "No matching thread yet",
        ],
        status: "pending",
        lastSeenAt: minutesAgo(2 * 60 + 5),
        libraryRecordId: null,
      },
      {
        id: 302,
        title: "Quiet Meadows",
        creator: "Hollowbrook",
        engine: "HTML",
        version: "0.2.1",
        detectionScore: 71,
        folderPath: "E:\\Downloads\\Games\\QuietMeadows_v0.2.1",
        detectionReasons: ["index.html with a game bundle", "Folder added 3 days ago"],
        status: "pending",
        lastSeenAt: minutesAgo(2 * 60 + 5),
        libraryRecordId: null,
      },
    ];

    const DEMO_FOLDER_SUGGESTIONS = [
      {
        path: DEMO_GAMES_FOLDER,
        label: "Games drive (D:)",
        reason: "Fastest drive with the most free space.",
        freeBytes: 812 * 1024 ** 3,
        totalBytes: 1863 * 1024 ** 3,
        recommended: true,
        isCurrent: true,
      },
      {
        path: `${DEMO_USER_FOLDER}\\Games`,
        label: "User folder (C:)",
        reason: "Your user folder on the system drive.",
        freeBytes: 96 * 1024 ** 3,
        totalBytes: 476 * 1024 ** 3,
        recommended: false,
        isCurrent: false,
      },
    ];

    const DEMO_DETECTED_GAME_FOLDERS = [
      { path: "E:\\Downloads\\Games", gameCount: 3, alreadyAdded: true },
      { path: `${DEMO_USER_FOLDER}\\Downloads`, gameCount: 2, alreadyAdded: false },
    ];

    const DEMO_LIBRARY_BACKUPS = [
      {
        path: `${DEMO_APPDATA}\\backups\\library-2026-09-27-2105.json`,
        createdAt: minutesAgo(2 * 24 * 60 + 40),
        gameCount: 12,
        sizeBytes: 184320,
      },
      {
        path: `${DEMO_APPDATA}\\backups\\library-2026-09-14-1830.json`,
        createdAt: minutesAgo(15 * 24 * 60),
        gameCount: 9,
        sizeBytes: 141312,
      },
    ];

    const demoFolderInsight = (targetPath) => ({
      path: String(targetPath || ""),
      exists: true,
      writable: true,
      freeBytes: 812 * 1024 ** 3,
      totalBytes: 1863 * 1024 ** 3,
      status: "ok",
      warnings: [],
    });

    const DEMO_F95_AUTH = {
      isAuthenticated: true,
      loginUrl: F95_LOGIN_PAGE_URL,
      searchUrl: F95_SEARCH_PAGE_URL,
      cookieCount: 6,
      username: "alex",
    };

    // The config object is shared with updateSettings, so the demo values
    // survive later reads in the same session.
    WEB_PREVIEW_CONFIG.Library = {
      ...WEB_PREVIEW_CONFIG.Library,
      rootPath: DEMO_GAMES_FOLDER,
      gameFolder: DEMO_GAMES_FOLDER,
    };
    WEB_PREVIEW_CONFIG.Onboarding = { completed: !DEMO_ONBOARDING_STEP };

    // `?demo=1&f95=thread` opens the F95 workspace on a fictional game
    // thread: the browser preview has no <webview>, so the workspace shows
    // this static page instead and the chrome around it can be screenshotted.
    const DEMO_F95_GAME = { ...findDemoGame(4), version: findDemoGame(4).latestVersion || "0.7.2" };
    const DEMO_F95_THREAD = {
      url: DEMO_F95_GAME.siteUrl,
      title: `${DEMO_F95_GAME.title} [${DEMO_F95_GAME.version}] [${DEMO_F95_GAME.creator}] | F95zone`,
      html: `<!doctype html><html><head><meta charset="utf-8"><style>
        body{margin:0;background:#101010;color:#c7c7c7;font:14px/1.5 "Segoe UI",Arial,sans-serif}
        .nav{background:#1c1c1c;border-bottom:1px solid #2c2c2c;padding:10px 24px;display:flex;gap:18px;font-size:13px;color:#8a8a8a}
        .nav b{color:#e0e0e0}
        .wrap{max-width:980px;margin:0 auto;padding:22px 24px}
        h1{font-size:22px;color:#f2f2f2;margin:0 0 6px;font-weight:600}
        .meta{font-size:12px;color:#8a8a8a;margin-bottom:14px}
        .tags span{display:inline-block;background:#262626;color:#bdbdbd;font-size:11px;padding:2px 8px;margin:0 6px 6px 0;border-radius:2px}
        .post{background:#181818;border:1px solid #2a2a2a;padding:18px 20px;margin-top:14px}
        .post h3{margin:14px 0 6px;font-size:13px;color:#f2f2f2;text-transform:uppercase;letter-spacing:.08em}
        .cover{height:220px;background:linear-gradient(135deg,#2b2f4a,#0f172a 60%,#1e293b);border:1px solid #2a2a2a;margin-bottom:16px}
        .links a{color:#66c0f4;text-decoration:none;margin-right:14px}
        p{margin:6px 0}
      </style></head><body>
        <div class="nav"><b>F95zone</b><span>Latest Updates</span><span>Games</span><span>Forums</span><span>Search</span></div>
        <div class="wrap">
          <h1>${DEMO_F95_GAME.title} [${DEMO_F95_GAME.version}] [${DEMO_F95_GAME.creator}]</h1>
          <div class="meta">Thread starter ${DEMO_F95_GAME.creator} · Updated 3 days ago · ${DEMO_F95_GAME.engine}</div>
          <div class="tags">${String(DEMO_F95_GAME.f95_tags || "").split(",").map((tag) => `<span>${tag.trim()}</span>`).join("")}</div>
          <div class="post">
            <div class="cover"></div>
            <h3>Overview</h3>
            <p>${DEMO_F95_GAME.description || "A fictional game thread used by the browser preview."}</p>
            <h3>Changelog</h3>
            <p>${DEMO_F95_GAME.version}: new chapter, three endings reworked, bug fixes.</p>
            <h3>Download</h3>
            <p>Win/Linux: <span class="links"><a href="#">MEGA</a><a href="#">PIXELDRAIN</a><a href="#">GOFILE</a><a href="#">WORKUPLOAD</a></span></p>
            <p>Mac: <span class="links"><a href="#">MEGA</a><a href="#">PIXELDRAIN</a></span></p>
          </div>
        </div>
      </body></html>`,
    };
    const DEMO_F95_MODE = String(DEMO_QUERY.get("f95") || "").trim();

    window.__f95LauncherDemo = {
      enabled: true,
      onboardingStep: DEMO_ONBOARDING_STEP,
      games: DEMO_GAMES,
      downloads: DEMO_DOWNLOADS,
      f95Page: DEMO_F95_MODE === "thread" ? DEMO_F95_THREAD : null,
    };

    const demoF95Api =
      DEMO_F95_MODE === "thread"
        ? {
            getF95ThreadInstallState: () =>
              isoDeep({
                inLibrary: true,
                installed: false,
                installState: "not_installed",
                recordId: DEMO_F95_GAME.record_id,
                title: DEMO_F95_GAME.title,
                creator: DEMO_F95_GAME.creator,
                version: "",
                gamePath: "",
                siteUrl: DEMO_F95_GAME.siteUrl,
              }),
            inspectF95Thread: () =>
              isoDeep({
                success: true,
                threadUrl: DEMO_F95_GAME.siteUrl,
                title: DEMO_F95_GAME.title,
                creator: DEMO_F95_GAME.creator,
                version: DEMO_F95_GAME.version,
                engine: DEMO_F95_GAME.engine,
                preferredLinkUrl: "https://pixeldrain.com/u/demo",
                links: [
                  {
                    url: "https://pixeldrain.com/u/demo",
                    label: "PIXELDRAIN",
                    host: "pixeldrain",
                  },
                ],
                variants: [],
              }),
            installF95Thread: () =>
              isoDeep({
                success: false,
                code: "captcha_required",
                actionKind: "verification",
                actionUrl: "https://pixeldrain.com/u/demo",
              }),
            onF95DownloadProgress: (callback) => {
              setTimeout(() => {
                callback({
                  phase: "downloading",
                  text: "Downloading Harbor Lights 0.10.0 from Pixeldrain",
                  percent: 62,
                  totalBytes: 2.4 * 1024 ** 3,
                  receivedBytes: 1.49 * 1024 ** 3,
                  fileName: "HarborLights-0.10.0-pc.zip",
                });
              }, 250);
              return noop;
            },
          }
        : {};

    return {
      ...demoF95Api,
      getVersion: () => Promise.resolve(DEMO_APP_VERSION),
      getAppInfo: () =>
        Promise.resolve({
          version: DEMO_APP_VERSION,
          platform: "win32",
          isPackaged: true,
          isFreshInstall: false,
          paths: {
            userData: DEMO_APPDATA,
            fallbackGames: `${DEMO_APPDATA}\\games`,
            logs: `${DEMO_APPDATA}\\logs`,
          },
          defaults: {
            gameExtensions: "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
            extractionExtensions: "zip,7z,rar",
          },
        }),
      getAppUpdateState: () =>
        Promise.resolve({
          status: "not-available",
          currentVersion: DEMO_APP_VERSION,
          availableVersion: null,
          percent: 0,
          error: null,
          checkedAt: minutesAgo(20),
          releaseNotes: null,
          releaseUrl: null,
          supportsDownload: true,
          supportsInstall: true,
        }),
      getGames: () => isoDeep(DEMO_ONBOARDING_STEP ? [] : DEMO_GAMES),
      getGame: (recordId) => isoDeep(findDemoGame(recordId)),
      getPreviews: (recordId) => {
        const game = findDemoGame(recordId);
        return Promise.resolve(game ? demoPreviews(game) : []);
      },
      getDefaultGameFolder: () => Promise.resolve(DEMO_GAMES_FOLDER),
      setDefaultGameFolder: (folderPath) => {
        WEB_PREVIEW_CONFIG.Library.gameFolder = String(folderPath || "");
        return Promise.resolve({ success: true, path: String(folderPath || "") });
      },
      inspectFolder: (targetPath) => Promise.resolve(demoFolderInsight(targetPath)),
      suggestLibraryFolders: () => isoDeep(DEMO_FOLDER_SUGGESTIONS),
      detectGameFolders: () => isoDeep(DEMO_DETECTED_GAME_FOLDERS),
      listLibraryBackups: () => isoDeep(DEMO_LIBRARY_BACKUPS),
      getScanSources: () => isoDeep({ success: true, sources: DEMO_SCAN_SOURCES }),
      addScanSource: (folderPath) =>
        Promise.resolve({
          success: true,
          source: {
            id: DEMO_SCAN_SOURCES.length + 1,
            path: String(folderPath || ""),
            isEnabled: true,
            createdAt: minutesAgo(0),
          },
        }),
      getScanJobs: () => isoDeep({ success: true, jobs: DEMO_SCAN_JOBS }),
      getScanCandidates: () =>
        isoDeep({ success: true, candidates: DEMO_SCAN_CANDIDATES }),
      getLiveUpdateState: () =>
        Promise.resolve({
          running: false,
          lastRun: {
            finishedAt: minutesAgo(95),
            checked: 8,
            updated: 4,
            failed: 0,
            skippedReason: "",
          },
          nextRunAt: minutesAgo(-265),
        }),
      getF95AuthStatus: () => isoDeep(DEMO_F95_AUTH),
      getF95Downloads: () => isoDeep(DEMO_DOWNLOADS),
      getSaveProfileSnapshot: (recordId) => isoDeep(demoSaveSnapshot(recordId)),
      refreshSaveProfiles: (recordId) => isoDeep(demoSaveSnapshot(recordId)),
      getSaveStorageState: () =>
        Promise.resolve({ success: true, state: clone(demoStorageState()) }),
      getSaveStorageCatalog: () =>
        isoDeep({ success: true, entries: DEMO_STORAGE_CATALOG }),
      detectSaveStorageFolders: () =>
        isoDeep({ success: true, folders: DEMO_STORAGE_FOLDERS }),
      getUniqueFilterOptions: () =>
        Promise.resolve({
          categories: ["Game"],
          engines: ["Ren'Py", "RPGM", "Unity", "Unreal Engine", "HTML", "Godot"],
          statuses: ["Ongoing", "Completed", "Onhold"],
          censored: ["No"],
          languages: ["English"],
          tags: [],
        }),
    };
  };

  window.electronAPI = DEMO_ENABLED
    ? { ...WEB_PREVIEW_API, ...buildDemoApi() }
    : WEB_PREVIEW_API;
})();
