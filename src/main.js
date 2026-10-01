const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  screen,
  Menu,
  Notification,
  Tray,
  nativeImage,
  safeStorage,
  powerMonitor,
} = require("electron");

app.setAppUserModelId("com.maxbaydi.f95launcher");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const axios = require("axios");
const ini = require("ini");
const { initializeAppPaths } = require("./main/appPaths");
const { attachWindowResilience } = require("./main/windowResilience");
const { writeFileAtomicSync } = require("./main/atomicFile");
const {
  createAppUpdateNotificationController,
} = require("./main/appUpdateNotificationController");
const {
  extractArchiveSafely,
  isArchiveError,
  isSupportedArchiveName,
} = require("./main/archive/extractArchive");
const { describeArchiveErrorCode } = require("./main/archive/archiveErrors");
const { detectGameEngine } = require("./main/install/detectEngine");
const { toStoredImagePath } = require("./main/assetPaths");
const { createAppUpdaterController } = require("./main/appUpdater");
const {
  mergeImportedGameMetadata,
  mergeRefreshedGameMetadata,
} = require("./main/importMetadata");
const { resolveArchiveContentRoot } = require("./main/install/archiveLayout");
const {
  chooseInstallDirectory,
  sanitizePathSegment,
} = require("./main/install/installTarget");
const { annotateLibraryPresence } = require("./main/libraryPresence");
const { normalizeLibraryScanRequest } = require("./main/libraryScanRequest");
const { resetLibraryIndex } = require("./main/libraryReset");
const {
  registerLibraryMaintenanceIpc,
} = require("./main/libraryMaintenanceIpc");
const { registerSaveTransferIpc } = require("./main/saveTransferIpc");
const { createSaveStorageController } = require("./main/saveStorage/saveStorageIpc");
const { createLiveUpdateChecker } = require("./main/liveUpdateCheck");
const { upsertLiveVersion } = require("./main/db/liveVersionsStore");
const { findExecutables } = require("./main/install/findExecutables");
const { getFolderSizeAsync } = require("./main/folderSize");
const {
  LIBRARY_INSTALL_STATES,
  countLibraryInstallStates,
} = require("./shared/libraryInstallState");
const {
  selectPreferredExecutable,
} = require("./main/install/selectExecutable");
const { getErrorMessage } = require("./main/errorMessage");
const {
  detectGameFolders,
  inspectFolder,
  inspectScanFolder,
  suggestLibraryFolders,
} = require("./main/folderInsights");
const {
  DEFAULT_ARCHIVE_EXTENSIONS,
  DEFAULT_GAME_EXTENSIONS,
  applySettingsPatch,
} = require("./main/settingsPatch");
const {
  buildMirrorCandidates,
  resolveMirrorWithFallback,
} = require("./main/f95/mirrorFallback");
const { pickRecommendedMirror } = require("./shared/f95MirrorAutomation");
const {
  clearF95Session,
  createF95BrowserWindow,
  createF95LoginWindow,
  getF95AuthState,
  getF95Session,
} = require("./main/f95/session");
const {
  createDownloadsStore,
  isActiveStatus,
} = require("./main/f95/downloadsStore");
const {
  downloadToFile,
  selectTransferMode,
} = require("./main/f95/directDownload");
const { buildDirectTransferOptions } = require("./main/f95/transferOptions");
const { createMirrorActionFlow } = require("./main/f95/mirrorActionFlow");
const { createElectronResolverSession } = require("./main/f95/electronSession");
const {
  describeManualPackageError,
  inspectManualPackage,
  stageManualPackage,
} = require("./main/f95/manualInstall");
const {
  DownloadCancelledError,
  DownloadValidationError,
  getMirrorHostInfo,
  inspectDownloadedPackage,
  MirrorActionRequiredError,
  MirrorError,
  normalizeEngineLabel,
  normalizeHostname,
  parseF95ThreadTitle,
  prepareF95DownloadUrl,
} = require("./main/f95/downloadSupport");
const { fetchWithCookieJar } = require("./main/f95/hosts/common");
const { inspectF95Thread } = require("./main/f95/threadInspector");
const { backupGameSaves, restoreGameSaves } = require("./main/saveVault");
const { buildLibraryIdentity } = require("./main/libraryIdentity");
const {
  getSaveProfileSnapshot,
  refreshSaveProfiles,
} = require("./main/saveProfiles");
const { removeLibraryGame } = require("./main/gameRemoval");
const {
  createTrayController,
  isMinimizeToTrayEnabled,
} = require("./main/trayController");
const {
  createLibraryUpdateNotificationController,
} = require("./main/libraryUpdateNotificationController");
const {
  createInstallNotificationController,
} = require("./main/installNotificationController");
const { createPeriodicJob } = require("./main/periodicJob");
const { runScheduledLibraryBackup } = require("./main/libraryAutoBackup");
const { listLibraryBackups } = require("./main/libraryBackups");
const { backupDatabaseFile } = require("./main/libraryReset");
const { upsertSaveSyncState } = require("./main/db/saveSyncStateStore");
const {
  listScanSources,
  createScanSource,
  patchScanSource,
  deleteScanSource,
} = require("./main/scanSources");
const {
  getRecentScanCandidates,
  markImportedCandidate,
} = require("./main/scanCandidates");
const { resetScanCache } = require("./main/scanCache");
const { createAtlasScanMatcher } = require("./main/scanAtlasMatcher");
const {
  splitAutoImportableScanGames,
} = require("./main/scanCandidateImportPolicy");
const {
  buildLibraryPreviewRefreshTargets,
  shouldRefreshCachedPreviews,
} = require("./main/libraryPreviewRefresh");
const {
  buildLibraryPathIndex,
  findPreferredGameByPath,
  normalizePathKey,
  reconcileLibraryDuplicateGamePaths,
  summarizeDuplicateCleanup,
} = require("./main/libraryDuplicates");
const {
  DEFAULT_PREVIEW_LIMIT,
  resolvePreviewDownloadCount,
} = require("./main/previewLimit");
const {
  startEnabledSourcesScan,
  getRecentScanJobs,
} = require("./main/scanRunner");
const {
  beginScanSession,
  cancelScanSession,
  endScanSession,
} = require("./main/scanSessions");
const {
  initializeDatabase,
  addGame,
  updateGame,
  setGameFavorite,
  addVersion,
  updateVersion,
  updateVersionLocation,
  updateVersionExecutable,
  addAtlasMapping,
  getF95ZoneDataByAtlasId,
  getGame,
  getGames,
  checkDbUpdates,
  updateFolderSize,
  getBannerUrl,
  getScreensUrlList,
  getEmulatorConfig,
  removeEmulatorConfig,
  saveEmulatorConfig,
  getEmulatorByExtension,
  GetAtlasIDbyRecord,
  getPreviews,
  getBanner,
  deleteBanner,
  deletePreviews,
  searchAtlas,
  searchSiteCatalog,
  searchAtlasByF95Id,
  upsertF95ZoneMapping,
  updateBanners,
  updatePreviews,
  getAtlasData,
  countVersions,
  deleteVersion,
  deleteVersionsForRecordPath,
  deleteGameCompletely,
  getUniqueFilterOptions,
  findF95Id,
  checkRecordExist,
  checkPathExist,
  getSteamIDbyRecord,
  getDb,
} = require("./database");
const cp = require("child_process");
const contextMenuData = new Map();

// SCANNERS
const { startSteamScan } = require("./core/scanners/steamscanner");
const { startScan } = require("./core/scanners/f95scanner");

let contextMenuId = 0;
let mainWindow;
let settingsWindow;
let importerWindow;
let appConfig;
let databaseConnection = null;
// User-owned save storage (synced folder, WebDAV, S3); see src/main/saveStorage.
let saveStorage = null;
let libraryUpdateRefreshPromise = null;
// Background check of live F95 threads (see main/liveUpdateCheck.js).
let libraryLiveUpdateChecker = null;
let f95LoginLiveCheckTimer = null;
// null until the first F95 auth state is known; a later false → true
// transition (the user signed in) triggers one live thread check.
let lastKnownF95Authenticated = null;
let libraryScanInProgress = false;

const LIVE_CHECK_STARTUP_DELAY_MS = 90 * 1000;
const LIVE_CHECK_AFTER_LOGIN_DELAY_MS = 10 * 1000;

app.commandLine.appendSwitch("force-color-profile", "srgb");

const appPaths = initializeAppPaths(app, {
  mainDir: __dirname,
});
const dataDir = appPaths.data;
const updatesDir = appPaths.updates;
const downloadsDir = appPaths.downloads;
const imagesDir = appPaths.images;
const configPath = appPaths.config;
let f95Session = null;
const f95InstallQueue = [];
const f95InstallContexts = new Map();
// Every download (active or retryable history entry) keyed by store id.
const f95DownloadContexts = new Map();
// Archive passwords read from thread posts, by thread URL: an encrypted
// package is unpacked with it without asking the user.
const f95ThreadArchivePasswords = new Map();
const F95_THREAD_PASSWORD_CACHE_LIMIT = 200;

function rememberThreadArchivePassword(threadUrl, password) {
  const key = String(threadUrl || "").trim();
  const value = String(password || "").trim();
  if (!key) {
    return;
  }
  if (!value) {
    f95ThreadArchivePasswords.delete(key);
    return;
  }
  f95ThreadArchivePasswords.delete(key);
  f95ThreadArchivePasswords.set(key, value);
  while (f95ThreadArchivePasswords.size > F95_THREAD_PASSWORD_CACHE_LIMIT) {
    const oldest = f95ThreadArchivePasswords.keys().next().value;
    f95ThreadArchivePasswords.delete(oldest);
  }
}

function getThreadArchivePassword(threadUrl) {
  return f95ThreadArchivePasswords.get(String(threadUrl || "").trim()) || "";
}
// Target paths handed out to in-flight downloads (their files may not exist yet).
const f95ReservedDownloadPaths = new Set();
const F95_DOWNLOADS_STATE_PATH = path.join(dataDir, "f95-downloads.json");
let f95DownloadsPersistTimer = null;
let f95DownloadsPendingSnapshot = null;
const f95DownloadsStore = createDownloadsStore({
  onChange: (entries) => scheduleF95DownloadsPersist(entries),
});
let f95DownloadSequence = 0;
let configExistedAtStartup = true;

const MAIN_WINDOW_DEFAULT_WIDTH = 1600;
const MAIN_WINDOW_DEFAULT_HEIGHT = 900;
const MAIN_WINDOW_MIN_WIDTH = 1024;
const MAIN_WINDOW_MIN_HEIGHT = 680;
const MAIN_WINDOW_EDGE_PADDING = 48;
const MAIN_WINDOW_SAFE_MIN_WIDTH = 900;
const MAIN_WINDOW_SAFE_MIN_HEIGHT = 620;
const APP_WINDOW_ICON_PATH = path.join(
  __dirname,
  "assets",
  "images",
  "appicon.ico",
);

function createTrayImage() {
  const trayImage = nativeImage.createFromPath(APP_WINDOW_ICON_PATH);

  if (trayImage.isEmpty()) {
    return APP_WINDOW_ICON_PATH;
  }

  return trayImage.resize({ width: 16, height: 16 });
}

const trayController = createTrayController({
  app,
  Menu,
  Tray,
  Notification,
  createTrayImage,
  getConfig: () => appConfig || defaultConfig,
  onCheckForAppUpdates: () => runAppUpdateCheck("tray-menu"),
  onCheckForLibraryUpdates: () => runLibraryUpdateRefresh("tray-menu"),
  tooltip: "F95Launcher",
  iconPath: APP_WINDOW_ICON_PATH,
});

const appUpdateNotificationController = createAppUpdateNotificationController({
  Notification,
  iconPath: APP_WINDOW_ICON_PATH,
  onActivate: () => {
    trayController.showMainWindow();
  },
});

const libraryUpdateNotificationController =
  createLibraryUpdateNotificationController({
    Notification,
    iconPath: APP_WINDOW_ICON_PATH,
    onClick: () => {
      trayController.showMainWindow();
    },
  });

const installNotificationController = createInstallNotificationController({
  Notification,
  iconPath: APP_WINDOW_ICON_PATH,
  isEnabled: () =>
    (appConfig || defaultConfig)?.Notifications?.installs !== false,
  isWindowFocused: () =>
    Boolean(
      mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.isVisible() &&
        mainWindow.isFocused(),
    ),
  onClick: () => {
    trayController.showMainWindow();
  },
});

// "Launch with Windows" registers the app with the OS; "--hidden" is what the
// autostart passes so the window stays in the tray until the user asks.
const STARTUP_HIDDEN_ARG = "--hidden";

function applyLoginItemSettings() {
  if (process.platform !== "win32" && process.platform !== "darwin") {
    return;
  }
  const config = appConfig || defaultConfig;
  const openAtLogin = Boolean(config?.Interface?.openAtLogin);
  try {
    app.setLoginItemSettings({
      openAtLogin,
      args: openAtLogin ? [STARTUP_HIDDEN_ARG] : [],
    });
  } catch (error) {
    console.warn("[startup] Could not update the login item:", error);
  }
}

function shouldStartHidden() {
  const config = appConfig || defaultConfig;
  if (!isMinimizeToTrayEnabled(config)) {
    return false;
  }
  return (
    process.argv.includes(STARTUP_HIDDEN_ARG) ||
    Boolean(config?.Interface?.startMinimized)
  );
}

// Re-check the app release every few hours while the launcher runs (it may
// sit in the tray for days) and again when the PC wakes up.
const APP_UPDATE_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const appUpdateRecheckJob = createPeriodicJob({
  name: "app-update",
  intervalMs: APP_UPDATE_RECHECK_INTERVAL_MS,
  run: (reason) => runAppUpdateCheck(reason, { background: true }),
});

// The weekly library snapshot is checked once a day: the launcher can sit in
// the tray for weeks, so "at startup" alone would never come around.
const AUTO_BACKUP_STARTUP_DELAY_MS = 45 * 1000;
const AUTO_BACKUP_RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const libraryAutoBackupJob = createPeriodicJob({
  name: "library-backup",
  intervalMs: AUTO_BACKUP_RECHECK_INTERVAL_MS,
  run: () => runScheduledLibraryBackupIfEnabled(),
});

const appUpdater = createAppUpdaterController({
  app,
  getAutoDownload: () =>
    (appConfig || defaultConfig)?.AppUpdates?.autoDownload !== false,
  onStateChanged: (nextState, previousState) => {
    const config = appConfig || defaultConfig;
    if (config?.Notifications?.appUpdates === false) {
      return;
    }
    appUpdateNotificationController.handleStateChange(nextState, previousState);
  },
});

// ────────────────────────────────────────────────
// WINDOW CREATION FUNCTIONS
// ────────────────────────────────────────────────

function resolveMainWindowBounds() {
  const workArea = screen.getPrimaryDisplay()?.workAreaSize || {
    width: MAIN_WINDOW_DEFAULT_WIDTH,
    height: MAIN_WINDOW_DEFAULT_HEIGHT,
  };
  const screenWidth = Math.max(
    Number(workArea.width) || MAIN_WINDOW_DEFAULT_WIDTH,
    MAIN_WINDOW_SAFE_MIN_WIDTH,
  );
  const screenHeight = Math.max(
    Number(workArea.height) || MAIN_WINDOW_DEFAULT_HEIGHT,
    MAIN_WINDOW_SAFE_MIN_HEIGHT,
  );
  const maxWidth = Math.max(
    MAIN_WINDOW_SAFE_MIN_WIDTH,
    screenWidth - MAIN_WINDOW_EDGE_PADDING,
  );
  const maxHeight = Math.max(
    MAIN_WINDOW_SAFE_MIN_HEIGHT,
    screenHeight - MAIN_WINDOW_EDGE_PADDING,
  );
  const width = Math.max(
    MAIN_WINDOW_SAFE_MIN_WIDTH,
    Math.min(MAIN_WINDOW_DEFAULT_WIDTH, maxWidth),
  );
  const height = Math.max(
    MAIN_WINDOW_SAFE_MIN_HEIGHT,
    Math.min(MAIN_WINDOW_DEFAULT_HEIGHT, maxHeight),
  );

  return {
    width,
    height,
    minWidth: Math.min(MAIN_WINDOW_MIN_WIDTH, width),
    minHeight: Math.min(MAIN_WINDOW_MIN_HEIGHT, height),
  };
}

function createWindow() {
  const mainWindowBounds = resolveMainWindowBounds();

  const startHidden = shouldStartHidden();
  mainWindow = new BrowserWindow({
    width: mainWindowBounds.width,
    height: mainWindowBounds.height,
    minWidth: mainWindowBounds.minWidth,
    minHeight: mainWindowBounds.minHeight,
    icon: APP_WINDOW_ICON_PATH,
    show: !startHidden,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    center: true,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: true,
      webviewTag: true,
    },
  });

  attachWindowResilience(mainWindow, { name: "main", dialog });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  trayController.attachMainWindow(mainWindow);
  appUpdater.attachWindow(mainWindow);

  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window-state-changed", "maximized");
  });
  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window-state-changed", "restored");
  });
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 850,
    height: 600,
    minWidth: 850,
    minHeight: 600,
    icon: APP_WINDOW_ICON_PATH,
    roundedCorners: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    center: false,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
    },
  });

  attachWindowResilience(settingsWindow, { name: "settings", dialog });
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));

  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    settingsWindow.webContents.openDevTools();
  }

  settingsWindow.on("maximize", () => {
    settingsWindow.webContents.send("window-state-changed", "maximized");
  });
  settingsWindow.on("unmaximize", () => {
    settingsWindow.webContents.send("window-state-changed", "restored");
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createImporterWindow() {
  console.log("Creating importer window");
  importerWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1280,
    minHeight: 720,
    icon: APP_WINDOW_ICON_PATH,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    center: true,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
    },
  });

  attachWindowResilience(importerWindow, { name: "importer", dialog });
  const filePath = path.join(__dirname, "core/ui/windows/importer.html");
  console.log("Loading importer file:", filePath);
  importerWindow
    .loadFile(filePath)
    .then(() => {
      console.log("importer.html loaded successfully");
    })
    .catch((err) => {
      console.error("Failed to load importer.html:", err);
    });

  importerWindow.on("maximize", () => {
    console.log("Importer window maximized");
    importerWindow.webContents.send("window-state-changed", "maximized");
  });
  importerWindow.on("unmaximize", () => {
    console.log("Importer window unmaximized");
    importerWindow.webContents.send("window-state-changed", "restored");
  });

  importerWindow.on("closed", () => {
    console.log("Importer window closed");
  });
}

async function runAppUpdateCheck(reason = "manual", options = {}) {
  try {
    return await appUpdater.checkForUpdates(options);
  } catch (error) {
    console.error(
      `[app.updater] Failed to check for updates (${reason}):`,
      error,
    );
    throw error;
  }
}

async function runLibraryUpdateRefresh(reason = "manual") {
  if (libraryUpdateRefreshPromise) {
    return libraryUpdateRefreshPromise;
  }

  libraryUpdateRefreshPromise = (async () => {
    const safeWindow =
      mainWindow &&
      typeof mainWindow.isDestroyed === "function" &&
      !mainWindow.isDestroyed()
        ? mainWindow
        : null;
    const result = await checkDbUpdates(updatesDir, safeWindow);

    if (result?.success) {
      try {
        const config = appConfig || defaultConfig;
        const allowNotify =
          Number(result?.total || 0) > 0 &&
          config?.Notifications?.libraryUpdates !== false;
        await libraryUpdateNotificationController.syncFromAllGames({
          getGames: () => loadLibraryGames(),
          allowNotify,
          reason,
        });
      } catch (error) {
        console.error(
          `[library.updates] Failed to refresh notification state (${reason}):`,
          error,
        );
      }
    }

    return result;
  })().finally(() => {
    libraryUpdateRefreshPromise = null;
  });

  return libraryUpdateRefreshPromise;
}

function normalizeF95DownloadUrl(url) {
  return String(url || "").trim();
}

function isUnknownEngineLabel(value) {
  const normalized = String(value || "").trim();
  return !normalized || /^unknown$/i.test(normalized);
}

function resolveEngineLabel(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      continue;
    }
    if (!isUnknownEngineLabel(normalized)) {
      return normalizeEngineLabel(normalized) || normalized;
    }
  }

  return "Unknown";
}

function ensureUniquePath(basePath) {
  if (!fs.existsSync(basePath)) {
    return basePath;
  }

  const directory = path.dirname(basePath);
  const extension = path.extname(basePath);
  const stem = path.basename(basePath, extension);

  let attempt = 1;
  let candidatePath = basePath;
  while (fs.existsSync(candidatePath)) {
    candidatePath = path.join(directory, `${stem} (${attempt++})${extension}`);
  }

  return candidatePath;
}

function parseConfiguredExtensions(value, fallbackValue) {
  return String(value || fallbackValue || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function extractF95IdFromUrl(url) {
  const match = String(url || "").match(/\/threads\/[^./]+?\.(\d+)(?:\/|$)/i);
  return match ? match[1] : "";
}

function normalizeLibraryMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getConfiguredLibraryFolder() {
  const libraryFolder =
    appConfig?.Library?.gameFolder &&
    fs.existsSync(appConfig.Library.gameFolder)
      ? appConfig.Library.gameFolder
      : appPaths.games;

  return libraryFolder;
}

/**
 * Library games with on-disk presence: `installState`, `versions[].isPresent`
 * and an `isUpdateAvailable` that ignores folders that no longer exist.
 * Every renderer-facing read of the library goes through here.
 */
async function loadLibraryGames() {
  return annotateLibraryPresence(await getGames(appPaths, 0, null));
}

async function loadLibraryGame(recordId) {
  const game = await getGame(recordId, appPaths);
  if (!game) {
    return null;
  }
  const [annotated] = await annotateLibraryPresence([game]);
  return annotated || game;
}

function getPreferredInstalledPath(game) {
  const versions = Array.isArray(game?.versions) ? [...game.versions] : [];
  versions.sort(
    (left, right) => (right.date_added || 0) - (left.date_added || 0),
  );

  // Prefer a folder that still exists; fall back to the newest recorded one.
  const presentVersion = versions.find(
    (version) => version?.game_path && version.isPresent !== false,
  );
  if (presentVersion) {
    return presentVersion.game_path;
  }

  for (const version of versions) {
    if (version?.game_path) {
      return version.game_path;
    }
  }

  return "";
}

function getLibraryIdentityKey(game) {
  return buildLibraryIdentity({
    atlasId: game?.atlas_id ? String(game.atlas_id) : "",
    f95Id: game?.f95_id ? String(game.f95_id) : "",
    siteUrl: String(game?.siteUrl || "").trim(),
    title: String(game?.displayTitle || game?.title || "").trim(),
    creator: String(game?.displayCreator || game?.creator || "").trim(),
  });
}

function findMatchingLibraryGame(libraryGames, metadata, fallbackName = "") {
  const normalizedF95Id = extractF95IdFromUrl(metadata?.threadUrl || "");
  const normalizedTitle = normalizeLibraryMatchText(
    metadata?.title || fallbackName,
  );
  const normalizedCreator = normalizeLibraryMatchText(metadata?.creator || "");
  const requestedIdentityKey = buildLibraryIdentity({
    atlasId: metadata?.atlasId,
    f95Id: metadata?.f95Id || normalizedF95Id,
    siteUrl: metadata?.threadUrl || metadata?.siteUrl || "",
    title: metadata?.title || fallbackName,
    creator: metadata?.creator || "",
  });

  let existingGame = null;

  if (requestedIdentityKey) {
    existingGame =
      libraryGames.find(
        (game) => getLibraryIdentityKey(game) === requestedIdentityKey,
      ) || null;
  }

  if (normalizedF95Id) {
    existingGame =
      existingGame ||
      libraryGames.find(
        (game) => String(game?.f95_id || "") === String(normalizedF95Id),
      ) ||
      null;
  }

  if (!existingGame && normalizedTitle) {
    existingGame =
      libraryGames.find((game) => {
        const candidateTitle = normalizeLibraryMatchText(
          game?.displayTitle || game?.title || "",
        );
        if (candidateTitle !== normalizedTitle) {
          return false;
        }

        if (!normalizedCreator) {
          return true;
        }

        const candidateCreator = normalizeLibraryMatchText(
          game?.displayCreator || game?.creator || "",
        );
        return candidateCreator === normalizedCreator;
      }) || null;
  }

  return existingGame;
}

async function getF95ThreadInstallState(input) {
  const libraryGames = await loadLibraryGames();
  const parsedTitle = parseF95ThreadTitle(input?.rawTitle || "");
  const existingGame = findMatchingLibraryGame(
    libraryGames,
    {
      threadUrl: input?.threadUrl || "",
      title: parsedTitle.title,
      creator: parsedTitle.creator,
    },
    parsedTitle.title || "",
  );

  if (!existingGame) {
    return {
      inLibrary: false,
      installed: false,
      installState: LIBRARY_INSTALL_STATES.NOT_INSTALLED,
      recordId: null,
      title: parsedTitle.title || "",
      creator: parsedTitle.creator || "",
      version: "",
      gamePath: "",
    };
  }

  const installState =
    existingGame.installState || LIBRARY_INSTALL_STATES.NOT_INSTALLED;

  return {
    inLibrary: true,
    // "Installed" means the files are actually on this PC; a record whose
    // folder vanished is offered a fresh install instead of an update.
    installed: installState === LIBRARY_INSTALL_STATES.INSTALLED,
    installState,
    recordId: existingGame.record_id,
    title:
      existingGame.displayTitle ||
      existingGame.title ||
      parsedTitle.title ||
      "",
    creator:
      existingGame.displayCreator ||
      existingGame.creator ||
      parsedTitle.creator ||
      "",
    version:
      existingGame.newestInstalledVersion ||
      existingGame.latestVersion ||
      existingGame.version ||
      "",
    gamePath: getPreferredInstalledPath(existingGame),
    siteUrl: existingGame.siteUrl || input?.threadUrl || "",
  };
}

/**
 * Where a downloaded package goes. An existing folder of the same library
 * record is reused only while it still exists; a record whose files are gone
 * gets a fresh install under the library folder and its dead version rows are
 * reported as `staleInstallPaths`.
 */
async function resolveF95InstallTarget(metadata, fallbackName) {
  const libraryGames = await loadLibraryGames();
  const existingGame = findMatchingLibraryGame(
    libraryGames,
    metadata,
    fallbackName,
  );
  const target = chooseInstallDirectory({
    existingGame,
    libraryFolder: getConfiguredLibraryFolder(),
    folderName: sanitizePathSegment(metadata?.title, fallbackName),
  });

  if (existingGame && !target.reusedExisting && target.staleInstallPaths.length) {
    console.log("[f95.install] Recorded install folders are missing, installing fresh:", {
      recordId: existingGame.record_id,
      staleInstallPaths: target.staleInstallPaths,
      installDirectory: target.installDirectory,
    });
  }

  return {
    installDirectory: target.installDirectory,
    existingGame: existingGame || null,
    reusedExisting: target.reusedExisting,
    staleInstallPaths: target.staleInstallPaths,
  };
}

async function moveDirectoryIntoPlace(sourceDirectory, targetDirectory) {
  if (!fs.existsSync(targetDirectory)) {
    // The parent may be gone too (deleted library folder, drive letter that
    // changed): rename() does not create it and fails with ENOENT.
    await fs.promises.mkdir(path.dirname(targetDirectory), { recursive: true });
    try {
      await fs.promises.rename(sourceDirectory, targetDirectory);
      return targetDirectory;
    } catch (error) {
      if (error?.code !== "EXDEV") {
        throw error;
      }
    }
  }

  await fs.promises.mkdir(targetDirectory, { recursive: true });
  await fs.promises.cp(sourceDirectory, targetDirectory, {
    recursive: true,
    force: true,
  });
  await fs.promises.rm(sourceDirectory, {
    recursive: true,
    force: true,
  });
  return targetDirectory;
}

async function prepareDownloadedGameMetadata(metadata) {
  const normalizedF95Id = extractF95IdFromUrl(metadata?.threadUrl || "");
  if (!normalizedF95Id) {
    return {
      atlasId: null,
      f95Id: "",
    };
  }

  try {
    const atlasMatches = await searchAtlasByF95Id(normalizedF95Id);
    const atlasId = atlasMatches?.[0]?.atlas_id || null;

    return {
      atlasId,
      f95Id: normalizedF95Id,
    };
  } catch (error) {
    console.warn("[f95.download] Failed to resolve catalog mapping for thread:", {
      threadUrl: metadata?.threadUrl || "",
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      atlasId: null,
      f95Id: normalizedF95Id,
    };
  }
}

async function resolveAtlasGameMetadata(atlasId) {
  if (!atlasId) {
    return {};
  }

  try {
    return (await getAtlasData(atlasId)) || {};
  } catch (error) {
    console.warn("[library.stub] Failed to load catalog metadata:", {
      atlasId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

async function buildF95ThreadLibraryMetadata(input) {
  const parsedTitle = parseF95ThreadTitle(
    input?.rawTitle || input?.title || "",
  );
  const atlasMetadata = await prepareDownloadedGameMetadata({
    threadUrl: input?.threadUrl || "",
  });
  const atlasData = await resolveAtlasGameMetadata(atlasMetadata.atlasId);

  return {
    threadUrl: String(input?.threadUrl || "").trim(),
    rawTitle: String(input?.rawTitle || "").trim(),
    title: String(
      input?.title || atlasData.title || parsedTitle.title || "Unknown",
    ).trim(),
    creator: String(
      input?.creator || atlasData.creator || parsedTitle.creator || "Unknown",
    ).trim(),
    version: String(
      input?.version || parsedTitle.version || atlasData.version || "",
    ).trim(),
    engine: resolveEngineLabel(
      input?.engine,
      parsedTitle.engine,
      atlasData.engine,
    ),
    atlasId: atlasMetadata.atlasId || null,
    f95Id: atlasMetadata.f95Id || extractF95IdFromUrl(input?.threadUrl || ""),
  };
}

async function upsertLibraryGameFromMetadata(metadata, options = {}) {
  const libraryGames = Array.isArray(options.libraryGames)
    ? options.libraryGames
    : await getGames(appPaths, 0, null);
  const existingGame = findMatchingLibraryGame(
    libraryGames,
    metadata,
    metadata?.title || "",
  );
  const gamePayload = {
    title: String(
      metadata?.title ||
        existingGame?.title ||
        existingGame?.displayTitle ||
        "Unknown",
    ).trim(),
    creator: String(
      metadata?.creator ||
        existingGame?.creator ||
        existingGame?.displayCreator ||
        "Unknown",
    ).trim(),
    engine: resolveEngineLabel(metadata?.engine, existingGame?.engine),
  };
  let recordId = existingGame?.record_id || null;

  if (recordId) {
    await updateGame({
      record_id: recordId,
      ...gamePayload,
    });
  } else {
    recordId = await addGame(gamePayload);
  }

  if (metadata?.atlasId && existingGame?.atlas_id !== metadata.atlasId) {
    try {
      await addAtlasMapping(recordId, metadata.atlasId);
    } catch (error) {
      console.warn("[library.stub] Failed to attach catalog mapping:", {
        recordId,
        atlasId: metadata.atlasId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (metadata?.f95Id || metadata?.threadUrl || metadata?.siteUrl) {
    const resolvedF95Id =
      metadata?.f95Id || extractF95IdFromUrl(metadata?.threadUrl || "");
    if (resolvedF95Id) {
      await upsertF95ZoneMapping(
        recordId,
        resolvedF95Id,
        metadata?.siteUrl || metadata?.threadUrl || "",
      );
    }
  }

  const localGame = existingGame || {
    record_id: recordId,
    versions: [],
  };

  localGame.record_id = recordId;
  localGame.title = gamePayload.title;
  localGame.creator = gamePayload.creator;
  localGame.engine = gamePayload.engine;
  localGame.atlas_id = metadata?.atlasId || localGame.atlas_id || null;
  localGame.f95_id =
    metadata?.f95Id ||
    extractF95IdFromUrl(metadata?.threadUrl || "") ||
    localGame.f95_id ||
    "";
  localGame.siteUrl =
    metadata?.siteUrl || metadata?.threadUrl || localGame.siteUrl || "";
  localGame.displayTitle = localGame.atlas_id
    ? localGame.displayTitle || gamePayload.title
    : gamePayload.title;
  localGame.displayCreator = localGame.atlas_id
    ? localGame.displayCreator || gamePayload.creator
    : gamePayload.creator;

  if (!existingGame) {
    libraryGames.push(localGame);
  }

  if (options.emitEvent !== false) {
    mainWindow?.webContents.send(
      existingGame ? "game-updated" : "game-imported",
      recordId,
    );
  }

  return {
    recordId,
    added: !existingGame,
    existing: Boolean(existingGame),
  };
}

async function addF95ThreadToLibrary(input) {
  const metadata = await buildF95ThreadLibraryMetadata(input);
  const result = await upsertLibraryGameFromMetadata(metadata, {
    reason: "manual-thread-add",
  });
  const state = await getF95ThreadInstallState({
    threadUrl: metadata.threadUrl,
    rawTitle: metadata.rawTitle || metadata.title,
  });

  return {
    ...result,
    state,
  };
}

async function inspectF95ThreadPayload(threadUrl) {
  if (!threadUrl || !/^https?:\/\//i.test(threadUrl)) {
    throw new Error("A valid F95 thread URL is required.");
  }

  const authState = await getF95AuthState(getReadyF95Session());
  if (!authState.isAuthenticated) {
    throw new Error("F95 login is required before checking thread downloads.");
  }

  const payload = await inspectF95Thread({
    BrowserWindow,
    threadUrl,
  });

  if (!payload?.success) {
    throw new Error(payload?.error || "Failed to inspect the F95 thread.");
  }

  rememberThreadArchivePassword(threadUrl, payload.archivePassword);
  const rememberedLink = pickPreferredThreadLink(
    threadUrl,
    payload.links || [],
  );
  const recommendation = pickRecommendedMirror({
    variants: payload.variants || [],
    links: payload.links || [],
    preferredLinkUrl: rememberedLink?.url || "",
    platform: process.platform,
  });

  return {
    ...payload,
    preferredLinkUrl: recommendation?.link?.url || "",
    recommendation: recommendation
      ? {
          linkUrl: recommendation.link.url,
          variantId: recommendation.variant?.id || "",
          reason: recommendation.reason,
        }
      : null,
  };
}

function getReadyF95Session() {
  if (!f95Session) {
    f95Session = getF95Session();
  }

  return f95Session;
}

let f95ResolverSession = null;

/**
 * The F95 session as the resolvers and the transfer must see it: cookies of
 * the partition attached explicitly (Electron's session.fetch sends none)
 * and manual redirects served by net.request. See electronSession.js.
 */
function getF95ResolverSession() {
  const session = getReadyF95Session();
  if (!f95ResolverSession || f95ResolverSession.raw !== session) {
    f95ResolverSession = createElectronResolverSession(session);
  }
  return f95ResolverSession;
}

function scheduleCloudSaveReconcile(recordId, reason) {
  if (!recordId || !saveStorage?.isReady()) {
    return Promise.resolve(null);
  }

  return saveStorage.scheduleReconcile(recordId, reason);
}

function broadcastGamesLibrarySynced(payload) {
  for (const windowInstance of [mainWindow, settingsWindow]) {
    if (!windowInstance || windowInstance.isDestroyed()) {
      continue;
    }

    windowInstance.webContents.send("games-library-synced", payload ?? {});
  }
}

async function moveFileIntoDirectory(
  sourcePath,
  targetDirectory,
  options = {},
) {
  await fs.promises.mkdir(targetDirectory, { recursive: true });
  const requestedTargetPath = path.join(
    targetDirectory,
    sanitizePathSegment(path.basename(sourcePath)),
  );
  const targetPath = options.overwrite
    ? requestedTargetPath
    : ensureUniquePath(requestedTargetPath);

  if (options.overwrite && fs.existsSync(targetPath)) {
    await fs.promises.unlink(targetPath).catch(() => {});
  }

  try {
    await fs.promises.rename(sourcePath, targetPath);
    return targetPath;
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }

    await fs.promises.copyFile(sourcePath, targetPath);
    await fs.promises.unlink(sourcePath);
    return targetPath;
  }
}

/**
 * Runs one live thread check shortly after the user signs in to F95 (false →
 * true). Cookie changes arrive in bursts during a login, so the run is
 * debounced; the startup state never triggers it (the startup run does).
 */
function noteF95AuthStateForLiveChecks(authState) {
  const isAuthenticated = Boolean(authState?.isAuthenticated);
  const wasAuthenticated = lastKnownF95Authenticated;
  lastKnownF95Authenticated = isAuthenticated;

  if (!isAuthenticated) {
    if (f95LoginLiveCheckTimer) {
      clearTimeout(f95LoginLiveCheckTimer);
      f95LoginLiveCheckTimer = null;
    }
    return;
  }

  if (wasAuthenticated !== false || !libraryLiveUpdateChecker) {
    return;
  }

  if (f95LoginLiveCheckTimer) {
    clearTimeout(f95LoginLiveCheckTimer);
  }
  f95LoginLiveCheckTimer = setTimeout(() => {
    f95LoginLiveCheckTimer = null;
    libraryLiveUpdateChecker?.runNow({ reason: "login" }).catch((error) => {
      console.error("[library.live] Check after sign-in failed:", error);
    });
  }, LIVE_CHECK_AFTER_LOGIN_DELAY_MS);
}

async function handleLiveUpdateRunFinished(summary) {
  if (!summary || summary.checked <= 0) {
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    for (const recordId of summary.checkedRecordIds || []) {
      mainWindow.webContents.send("game-updated", recordId);
    }
  }

  try {
    const config = appConfig || defaultConfig;
    await libraryUpdateNotificationController.syncFromAllGames({
      getGames: () => loadLibraryGames(),
      allowNotify: config?.Notifications?.libraryUpdates !== false,
      reason: `live-${summary.reason}`,
    });
  } catch (error) {
    console.error(
      "[library.live] Failed to refresh update notifications after a thread check:",
      error,
    );
  }
}

function createLibraryLiveUpdateChecker() {
  return createLiveUpdateChecker({
    listGames: () => loadLibraryGames(),
    inspectThread: (threadUrl) => inspectF95Thread({ BrowserWindow, threadUrl }),
    saveResult: (result) => {
      if (!databaseConnection) {
        throw new Error("The library database is not ready.");
      }
      return upsertLiveVersion(databaseConnection, result);
    },
    isAuthenticated: async () =>
      (await getF95AuthState(getReadyF95Session())).isAuthenticated,
    favoritesOnly: () =>
      (appConfig || defaultConfig)?.LiveUpdates?.allGames !== true,
    onRunFinished: (summary) => handleLiveUpdateRunFinished(summary),
  });
}

async function broadcastF95AuthState() {
  const authState = await getF95AuthState(getReadyF95Session());
  noteF95AuthStateForLiveChecks(authState);
  const loginWindow = BrowserWindow.getAllWindows().find(
    (windowInstance) => windowInstance.__f95LoginWindow === true,
  );

  if (authState.isAuthenticated && loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.close();
  }

  BrowserWindow.getAllWindows().forEach((windowInstance) => {
    if (!windowInstance.isDestroyed()) {
      windowInstance.webContents.send("f95-auth-changed", authState);
    }
  });
  return authState;
}

function broadcastF95Downloads() {
  const payload = {
    items: f95DownloadsStore.list(),
    activeCount: f95DownloadsStore.activeCount(),
  };

  BrowserWindow.getAllWindows().forEach((windowInstance) => {
    if (!windowInstance.isDestroyed()) {
      windowInstance.webContents.send("f95-downloads-changed", payload);
    }
  });

  return payload;
}

function broadcastF95BrowserNavigation(payload) {
  const normalizedPayload = {
    url: String(payload?.url || "").trim(),
    title: String(payload?.title || "").trim(),
  };

  BrowserWindow.getAllWindows().forEach((windowInstance) => {
    if (!windowInstance.isDestroyed()) {
      windowInstance.webContents.send(
        "f95-browser-navigation",
        normalizedPayload,
      );
    }
  });

  return normalizedPayload;
}

function broadcastGameDeleted(recordId) {
  BrowserWindow.getAllWindows().forEach((windowInstance) => {
    if (!windowInstance.isDestroyed()) {
      windowInstance.webContents.send("game-deleted", recordId);
    }
  });
}

/**
 * The downloads list survives restarts so a package kept after a failed
 * install can still be installed later without downloading it again.
 */
function scheduleF95DownloadsPersist(entries) {
  f95DownloadsPendingSnapshot = entries;
  if (f95DownloadsPersistTimer) {
    return;
  }
  f95DownloadsPersistTimer = setTimeout(() => {
    f95DownloadsPersistTimer = null;
    flushF95DownloadsPersist();
  }, 300);
}

function flushF95DownloadsPersist() {
  if (f95DownloadsPersistTimer) {
    clearTimeout(f95DownloadsPersistTimer);
    f95DownloadsPersistTimer = null;
  }
  if (!f95DownloadsPendingSnapshot) {
    return;
  }
  const snapshot = f95DownloadsPendingSnapshot;
  f95DownloadsPendingSnapshot = null;
  try {
    fs.mkdirSync(path.dirname(F95_DOWNLOADS_STATE_PATH), { recursive: true });
    writeFileAtomicSync(
      F95_DOWNLOADS_STATE_PATH,
      JSON.stringify({ version: 1, entries: snapshot }),
    );
  } catch (error) {
    console.warn("[f95.download] Failed to persist the downloads list:", error);
  }
}

function isPathInsideDownloadsDir(candidatePath) {
  const relative = path.relative(downloadsDir, String(candidatePath || ""));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Restores the downloads list from the previous run and removes leftovers
 * in the downloads folder that no entry references any more (staging
 * folders of interrupted installs, packages of forgotten entries).
 */
function hydrateF95DownloadsStore() {
  let rawEntries = [];
  try {
    if (fs.existsSync(F95_DOWNLOADS_STATE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(F95_DOWNLOADS_STATE_PATH, "utf8"));
      rawEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    }
  } catch (error) {
    console.warn("[f95.download] Failed to read the persisted downloads list:", error);
  }
  f95DownloadsStore.hydrate(rawEntries, (packagePath) => {
    try {
      return fs.statSync(packagePath).isFile();
    } catch {
      return false;
    }
  });

  const referenced = new Set(
    f95DownloadsStore.packagePaths().map((value) => path.resolve(value)),
  );
  try {
    for (const entry of fs.readdirSync(downloadsDir, { withFileTypes: true })) {
      const fullPath = path.join(downloadsDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "_staging") {
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
        continue;
      }
      if (!referenced.has(path.resolve(fullPath))) {
        fs.rmSync(fullPath, { force: true });
      }
    }
  } catch (error) {
    console.warn("[f95.download] Failed to tidy the downloads folder:", error);
  }
}

/**
 * Deletes the package kept for an entry once the entry is forgotten.
 */
function removeF95RetainedPackage(entry) {
  const packagePath = String(entry?.packagePath || "");
  if (!packagePath || !isPathInsideDownloadsDir(packagePath)) {
    return;
  }
  fs.promises.rm(packagePath, { force: true }).catch(() => {});
}

/**
 * Rebuilds a download context for an entry restored from disk (the app was
 * restarted): enough to install a kept package, a user's file or a folder,
 * but not to re-resolve the mirror.
 */
function createF95ContextFromEntry(entry) {
  const existing = f95DownloadContexts.get(entry.id);
  if (existing) {
    return existing;
  }
  const hostInfo = getMirrorHostInfo(entry.requestedUrl || "");
  const context = {
    id: entry.id,
    request: {
      downloadUrl: "",
      threadUrl: entry.threadUrl || "",
      title: entry.title || "F95 download",
      creator: entry.creator || "",
      version: entry.version || "",
      engine: entry.engine || "",
      downloadLabel: entry.sourceLabel || "",
      platformHint: "",
      mirrorHost: entry.sourceHost || "",
      variantId: "",
      fallbackLinks: [],
    },
    requestedUrl: entry.requestedUrl || "",
    hostLabel: entry.hostLabel || hostInfo.label || "",
    metadata: {
      id: entry.id,
      title: entry.title || "F95 download",
      creator: entry.creator || "",
      version: entry.version || "",
      engine: resolveEngineLabel(entry.engine),
      threadUrl: entry.threadUrl || "",
      downloadLabel: entry.sourceLabel || "",
      sourceHost: entry.sourceHost || "",
      mirrorHost: entry.sourceHost || "",
      linkHost: entry.sourceHost || "",
      variantId: "",
    },
    prepared: null,
    abortController: null,
    downloadItem: null,
    actionFlow: null,
    cancelled: false,
    targetPath: entry.packagePath || "",
    reservedPath: "",
  };
  f95DownloadContexts.set(entry.id, context);
  return context;
}

function buildF95DownloadRequest(payload) {
  const parsedThreadTitle = parseF95ThreadTitle(payload?.title || "");
  return {
    downloadUrl: normalizeF95DownloadUrl(payload?.downloadUrl),
    threadUrl: String(payload?.threadUrl || "").trim(),
    title:
      parsedThreadTitle.title ||
      sanitizePathSegment(payload?.title || "", "") ||
      "F95 download",
    creator:
      String(payload?.creator || "").trim() || parsedThreadTitle.creator || "",
    version:
      String(payload?.version || "").trim() || parsedThreadTitle.version || "",
    engine: resolveEngineLabel(payload?.engine, parsedThreadTitle.engine),
    downloadLabel: String(payload?.downloadLabel || "").trim(),
    platformHint: String(
      payload?.platformHint ||
        payload?.platformLabel ||
        payload?.variantLabel ||
        "",
    ).trim(),
    mirrorHost: String(payload?.mirrorHost || "").trim(),
    variantId: String(payload?.variantId || "").trim(),
    archivePassword: String(payload?.archivePassword || "").trim(),
    // Other mirrors of the same build, tried in order when this one fails.
    fallbackLinks: buildMirrorCandidates(
      { url: normalizeF95DownloadUrl(payload?.downloadUrl) },
      payload?.fallbackLinks,
    ).slice(1),
  };
}

function createF95DownloadContext(request) {
  const contextId = `f95-download-${++f95DownloadSequence}`;
  const hostInfo = getMirrorHostInfo(request.downloadUrl);
  const context = {
    id: contextId,
    // Original request payload: retry re-resolves from here because resolved
    // mirror URLs expire.
    request,
    // Resolved URL once known (used to match Electron `will-download` items).
    requestedUrl: request.downloadUrl,
    hostLabel: hostInfo.label || hostInfo.host || "",
    metadata: {
      id: contextId,
      title: request.title || "F95 download",
      creator: request.creator || "",
      version: request.version || "",
      engine: resolveEngineLabel(request.engine),
      threadUrl: request.threadUrl || "",
      downloadLabel: request.downloadLabel || "",
      sourceHost: hostInfo.host || "",
      mirrorHost: hostInfo.host || "",
      // Host of the thread link itself, used to remember the mirror choice.
      linkHost: request.mirrorHost || hostInfo.host || "",
      variantId: request.variantId || "",
      // Password published in the thread, tried automatically on an
      // encrypted archive before the user is asked.
      archivePassword:
        request.archivePassword || getThreadArchivePassword(request.threadUrl),
    },
    prepared: null,
    abortController: null,
    downloadItem: null,
    // "Finish the step in the browser" flow (captcha / Cloudflare), if any.
    actionFlow: null,
    cancelled: false,
    targetPath: "",
    reservedPath: "",
  };

  f95DownloadContexts.set(contextId, context);
  return context;
}

function stopF95MirrorActionFlow(context) {
  const flow = context?.actionFlow;
  if (!flow) {
    return;
  }
  context.actionFlow = null;
  try {
    flow.stop();
  } catch (error) {
    console.warn("[f95.download] Failed to stop the browser-step flow:", error);
  }
}

/**
 * Embedded browser window (same session as the downloader, so cookies such
 * as cf_clearance are shared) wrapped for createMirrorActionFlow.
 */
function openF95MirrorActionWindow(url, hostLabel) {
  const navigationListeners = new Set();
  const closedListeners = new Set();
  const browserWindow = createF95BrowserWindow({
    BrowserWindow,
    appConfig,
    url,
    title: `${hostLabel}: finish the step in this window`,
    reuseKey: "__f95ActionWindow",
    // The user has to see the mirror page, not a DevTools pane.
    openDevTools: false,
    onNavigation: (info) => {
      broadcastF95BrowserNavigation(info);
      for (const listener of [...navigationListeners]) {
        try {
          listener(info);
        } catch (error) {
          console.warn("[f95.download] Browser-step navigation listener failed:", error);
        }
      }
    },
  });
  browserWindow.once("closed", () => {
    for (const listener of [...closedListeners]) {
      try {
        listener();
      } catch (error) {
        console.warn("[f95.download] Browser-step close listener failed:", error);
      }
    }
  });

  return {
    webContentsId: browserWindow.webContents.id,
    onNavigated(callback) {
      navigationListeners.add(callback);
      return () => navigationListeners.delete(callback);
    },
    onClosed(callback) {
      closedListeners.add(callback);
      return () => closedListeners.delete(callback);
    },
    close() {
      if (!browserWindow.isDestroyed()) {
        browserWindow.close();
      }
    },
    isOpen: () => !browserWindow.isDestroyed(),
  };
}

/**
 * A mirror asked for a human step (captcha, Cloudflare check, link page).
 * Open it in the embedded browser and keep re-resolving quietly; the
 * transfer starts by itself once the page lets us through. A file download
 * the user starts inside that window is adopted by the will-download
 * listener.
 * @param {any} context
 * @param {string} actionUrl
 */
function startF95MirrorActionFlow(context, actionUrl) {
  stopF95MirrorActionFlow(context);
  const targetUrl =
    String(actionUrl || "").trim() || context.request.downloadUrl;
  const hostLabel = describeF95DownloadHost(context);
  context.cancelled = false;
  context.abortController = null;
  context.downloadItem = null;
  context.prepared = null;
  releaseF95DownloadPath(context);

  f95DownloadsStore.awaitingAction(context.id, {
    actionUrl: targetUrl,
    hostLabel,
    text: `${hostLabel} needs a quick step in the browser window. Finish it there and the download continues by itself.`,
  });
  broadcastF95Downloads();

  const flow = createMirrorActionFlow({
    actionUrl: targetUrl,
    hostLabel,
    logger: console,
    openWindow: (url) => openF95MirrorActionWindow(url, hostLabel),
    resolveMirror: (signal) =>
      prepareF95DownloadUrl(getF95ResolverSession(), context.request.downloadUrl, {
        signal,
        platformHint: context.request.platformHint,
        retry: { attempts: 1 },
        requestTimeoutMs: 20000,
        // Only end the step once the file itself is served (Cloudflare needs
        // a few seconds in the window before its clearance cookie exists).
        probeTarget: true,
      }),
    onStatus: (text) => {
      if (context.actionFlow !== flow) {
        return;
      }
      f95DownloadsStore.status(context.id, { text });
      broadcastF95Downloads();
    },
    onResolved: (prepared) => {
      if (context.actionFlow !== flow) {
        return;
      }
      context.actionFlow = null;
      context.abortController = new AbortController();
      context.prepared = prepared;
      context.hostLabel = prepared.hostLabel || context.hostLabel;
      context.requestedUrl = prepared.resolvedUrl;
      context.metadata.sourceHost = prepared.sourceHost;
      context.metadata.mirrorHost =
        prepared.mirrorHost || context.metadata.mirrorHost;
      if (selectTransferMode(prepared) === "session") {
        startSessionF95Download(context, prepared);
      } else {
        void startDirectF95Download(context, prepared);
      }
    },
    onGaveUp: (error) => {
      if (context.actionFlow !== flow) {
        return;
      }
      context.actionFlow = null;
      context.abortController = null;
      console.warn("[f95.download] Browser step not completed:", error);
      markF95DownloadFailed(context, error, "resolve");
    },
  });
  context.actionFlow = flow;
  flow.start();

  return {
    success: true,
    queued: true,
    awaitingAction: true,
    id: context.id,
    actionUrl: targetUrl,
    hostLabel,
  };
}

/**
 * A download the user started inside the browser-step window belongs to the
 * context waiting on that window.
 * @param {import("electron").WebContents | undefined} webContents
 */
function adoptF95ActionContext(webContents) {
  const webContentsId = webContents?.id;
  if (webContentsId === undefined) {
    return null;
  }
  for (const context of f95DownloadContexts.values()) {
    const flow = context.actionFlow;
    if (flow && flow.matchesWebContents(webContentsId)) {
      flow.adoptDownload();
      context.actionFlow = null;
      context.abortController = new AbortController();
      return context;
    }
  }
  return null;
}

function pruneF95DownloadContexts() {
  const liveIds = new Set(f95DownloadsStore.ids());
  for (const [contextId, context] of f95DownloadContexts.entries()) {
    if (!liveIds.has(contextId) && !context.abortController) {
      f95DownloadContexts.delete(contextId);
    }
  }
}

/**
 * A new attempt for the same thread replaces its failed/cancelled history
 * entries (e.g. the "captcha required" entry left behind before the user
 * solved the captcha and the UI re-queued the install).
 */
function supersedeF95DownloadEntries(context) {
  const threadUrl = context.request.threadUrl;
  if (!threadUrl) {
    return;
  }

  for (const entry of f95DownloadsStore.list()) {
    if (
      entry.id !== context.id &&
      entry.threadUrl === threadUrl &&
      (entry.status === "error" || entry.status === "cancelled")
    ) {
      removeF95RetainedPackage(entry);
      f95DownloadsStore.remove(entry.id);
      f95DownloadContexts.delete(entry.id);
    }
  }
}

function describeF95DownloadHost(context) {
  return (
    context.hostLabel ||
    context.metadata.sourceHost ||
    context.metadata.mirrorHost ||
    "selected mirror"
  );
}

function reserveF95DownloadPath(basePath) {
  const directory = path.dirname(basePath);
  const extension = path.extname(basePath);
  const stem = path.basename(basePath, extension);
  const isTaken = (candidatePath) =>
    f95ReservedDownloadPaths.has(candidatePath) ||
    fs.existsSync(candidatePath) ||
    fs.existsSync(`${candidatePath}.part`);

  let candidatePath = basePath;
  let attempt = 1;
  while (isTaken(candidatePath)) {
    candidatePath = path.join(directory, `${stem} (${attempt++})${extension}`);
  }

  f95ReservedDownloadPaths.add(candidatePath);
  return candidatePath;
}

function releaseF95DownloadPath(context) {
  if (context?.reservedPath) {
    f95ReservedDownloadPaths.delete(context.reservedPath);
    context.reservedPath = "";
  }
}

function queueF95InstallContext(context) {
  const normalizedUrl = normalizeF95DownloadUrl(context.requestedUrl);

  f95InstallQueue.push(context);
  if (normalizedUrl) {
    f95InstallContexts.set(normalizedUrl, context);
  }

  f95DownloadsStore.queue({
    id: context.id,
    title: context.metadata.title,
    creator: context.metadata.creator,
    version: context.metadata.version,
    threadUrl: context.metadata.threadUrl,
    requestedUrl: context.request.downloadUrl,
    sourceHost: context.metadata.sourceHost,
    sourceLabel: context.metadata.downloadLabel,
    hostLabel: context.hostLabel,
    hasRetryPayload: true,
    text: `Queued ${context.metadata.title} via ${describeF95DownloadHost(context)}`,
  });
  broadcastF95Downloads();

  return context;
}

function resolveF95InstallContext(downloadItem) {
  const chain =
    typeof downloadItem.getURLChain === "function"
      ? downloadItem.getURLChain()
      : [downloadItem.getURL()];

  for (const url of chain) {
    const normalizedUrl = normalizeF95DownloadUrl(url);
    if (f95InstallContexts.has(normalizedUrl)) {
      const context = f95InstallContexts.get(normalizedUrl);
      f95InstallContexts.delete(normalizedUrl);
      const queueIndex = f95InstallQueue.indexOf(context);
      if (queueIndex >= 0) {
        f95InstallQueue.splice(queueIndex, 1);
      }
      return context;
    }
  }

  while (f95InstallQueue.length > 0) {
    const context = f95InstallQueue.shift();
    if (context && !context.cancelled) {
      if (
        context.requestedUrl &&
        f95InstallContexts.get(context.requestedUrl) === context
      ) {
        f95InstallContexts.delete(context.requestedUrl);
      }
      return context;
    }
  }

  return null;
}

function removeF95InstallContext(context) {
  if (!context) {
    return;
  }

  if (
    context.requestedUrl &&
    f95InstallContexts.get(context.requestedUrl) === context
  ) {
    f95InstallContexts.delete(context.requestedUrl);
  }

  const queueIndex = f95InstallQueue.indexOf(context);
  if (queueIndex >= 0) {
    f95InstallQueue.splice(queueIndex, 1);
  }
}

function sendF95DownloadProgress(payload) {
  mainWindow?.webContents.send("f95-download-progress", payload);
}

function summarizeF95DownloadError(error) {
  const message = String(
    error?.userMessage || error?.message || error || "connection problem",
  );
  return message.length > 140 ? `${message.slice(0, 137)}...` : message;
}

/**
 * Normalise any resolution/transfer/install error into the store fields the
 * downloads UI renders (`error`, `errorCode`, `actionUrl`).
 * @param {any} context
 * @param {any} error
 * @param {"resolve" | "download" | "install"} phase
 */
function describeF95DownloadError(context, error, phase) {
  const originalUrl = context?.request?.downloadUrl || "";
  if (
    error instanceof MirrorActionRequiredError ||
    error?.code === "captcha_required" ||
    error?.code === "mirror_action_required"
  ) {
    return {
      errorCode: "captcha_required",
      actionUrl: error?.actionUrl || originalUrl,
      message:
        error?.userMessage ||
        getErrorMessage(
          error,
          "This mirror needs captcha confirmation before F95Launcher can continue.",
        ),
    };
  }

  const fallbackCode =
    phase === "resolve"
      ? "resolve_failed"
      : phase === "install"
        ? "install_failed"
        : "download_failed";
  const rawCode = typeof error?.code === "string" ? error.code : "";
  const errorCode = /^[a-z][a-z0-9_]*$/.test(rawCode)
    ? rawCode
    : /^E[A-Z]+|^UND_ERR/.test(rawCode)
      ? "network"
      : fallbackCode;
  const actionUrl =
    error?.actionUrl ||
    (["html_payload", "access_denied"].includes(errorCode) ? originalUrl : "");

  return {
    errorCode,
    actionUrl,
    message:
      error?.userMessage ||
      getErrorMessage(
        error,
        phase === "install" ? "Unknown install error." : "Unknown download error.",
      ),
  };
}

function markF95DownloadFailed(context, error, phase = "download", extra = {}) {
  const details = describeF95DownloadError(context, error, phase);
  const prefix =
    phase === "resolve"
      ? "Could not start"
      : phase === "install"
        ? "Install failed for"
        : "Download failed for";
  const text = `${prefix} ${context.metadata.title}: ${details.message}`;
  const fileName = context.targetPath ? path.basename(context.targetPath) : "";

  f95DownloadsStore.fail(context.id, {
    title: context.metadata.title,
    fileName,
    text,
    error: details.message,
    errorCode: details.errorCode,
    actionUrl: details.actionUrl,
    hostLabel: context.hostLabel,
    ...extra,
  });
  broadcastF95Downloads();
  sendF95DownloadProgress({
    phase: "error",
    text,
    percent: 0,
    totalBytes: extra.totalBytes || 0,
    receivedBytes: extra.receivedBytes || 0,
    fileName,
  });
  installNotificationController.notifyFailed({
    title: context.metadata.title,
    error: details.message,
  });

  return details;
}

function markF95DownloadCancelled(context) {
  const title = context?.metadata?.title || "download";
  f95DownloadsStore.cancel(context.id, {
    title,
    text: `Cancelled ${title}`,
  });
  broadcastF95Downloads();
  sendF95DownloadProgress({
    phase: "cancelled",
    text: `Cancelled ${title}`,
    percent: 0,
    totalBytes: 0,
    receivedBytes: 0,
    fileName: context?.targetPath ? path.basename(context.targetPath) : "",
  });
}

function buildF95CancelledResult(context) {
  return {
    success: false,
    cancelled: true,
    id: context.id,
    error: "Download cancelled.",
  };
}

/**
 * Resolve the context's original mirror link and start the transfer. Used by
 * both `install-f95-thread` and `retry-f95-download`; the store entry is
 * visible (status "resolving") before any network request is made.
 */
async function runF95DownloadContext(context, options = {}) {
  stopF95MirrorActionFlow(context);
  const controller = new AbortController();
  context.abortController = controller;
  context.cancelled = false;
  context.downloadItem = null;
  context.prepared = null;
  context.targetPath = "";
  context.requestedUrl = context.request.downloadUrl;
  releaseF95DownloadPath(context);

  f95DownloadsStore.resolving({
    id: context.id,
    title: context.metadata.title,
    creator: context.metadata.creator,
    version: context.metadata.version,
    threadUrl: context.metadata.threadUrl,
    requestedUrl: context.request.downloadUrl,
    sourceHost: context.metadata.sourceHost,
    sourceLabel: context.metadata.downloadLabel,
    hostLabel: context.hostLabel,
    hasRetryPayload: true,
    text: `Resolving ${describeF95DownloadHost(context)} link`,
  });
  broadcastF95Downloads();

  const isStale = () =>
    context.cancelled || context.abortController !== controller;
  const primaryCandidate = {
    url: context.request.downloadUrl,
    label: context.request.downloadLabel,
    host: context.request.mirrorHost,
    variantId: context.request.variantId,
  };
  const candidates = [primaryCandidate, ...(context.request.fallbackLinks || [])];
  const describeCandidate = (candidate) => {
    const info = getMirrorHostInfo(candidate?.url || candidate?.host || "");
    return info.label || candidate?.host || "the next mirror";
  };

  const resolution = await resolveMirrorWithFallback({
    candidates,
    prepare: (candidateUrl) =>
      prepareF95DownloadUrl(getF95ResolverSession(), candidateUrl, {
        signal: controller.signal,
        platformHint: context.request.platformHint,
        onStatus: (text) => {
          if (isStale()) {
            return;
          }
          f95DownloadsStore.status(context.id, { text });
          broadcastF95Downloads();
        },
      }),
    shouldStop: (error) =>
      isStale() ||
      controller.signal.aborted ||
      error instanceof DownloadCancelledError,
    onAttempt: (attempt) => {
      if (isStale()) {
        return;
      }
      sendF95InstallAttempt(options.sender, {
        threadUrl: context.request.threadUrl,
        phase: attempt.phase,
        index: attempt.index,
        total: attempt.total,
        url: attempt.candidate.url,
        host: attempt.candidate.host,
        label: attempt.candidate.label,
        actionRequired: Boolean(attempt.actionRequired),
        error: attempt.error || "",
      });
      if (attempt.phase === "trying" && attempt.index > 0) {
        f95DownloadsStore.status(context.id, {
          hostLabel: describeCandidate(attempt.candidate),
          text: `${describeCandidate(candidates[attempt.index - 1])} did not return the file. Trying ${describeCandidate(attempt.candidate)} (${attempt.index + 1}/${attempt.total})`,
        });
        broadcastF95Downloads();
      }
    },
  });

  if (resolution.stopped || !resolution.prepared) {
    if (context.abortController !== controller) {
      return buildF95CancelledResult(context);
    }
    if (resolution.stopped || context.cancelled || controller.signal.aborted) {
      context.abortController = null;
      markF95DownloadCancelled(context);
      return buildF95CancelledResult(context);
    }

    context.abortController = null;
    if (resolution.actionFailure) {
      // No mirror worked without the user; open the browser step for the
      // first one that asked for it (it re-resolves that mirror when done).
      const actionCandidate = resolution.actionFailure.candidate;
      if (actionCandidate.url !== context.request.downloadUrl) {
        adoptF95FallbackCandidate(context, actionCandidate, candidates);
      }
      const details = describeF95DownloadError(
        context,
        resolution.actionFailure.error,
        "resolve",
      );
      console.warn(
        "[f95.download] Mirror needs a browser step, opening it:",
        details.actionUrl,
      );
      return {
        ...startF95MirrorActionFlow(context, details.actionUrl),
        attempts: resolution.attempts,
      };
    }

    const error = resolution.lastError;
    console.error("[f95.download] Failed to resolve requested mirror:", {
      threadUrl: context.request.threadUrl,
      attempts: resolution.attempts,
    });
    const details = describeF95DownloadError(context, error, "resolve");
    const summarizedError =
      resolution.attempts.length > 1
        ? Object.assign(new Error(details.message), {
            code: details.errorCode,
            userMessage: `Tried ${resolution.attempts.length} mirrors automatically, but none returned the game file. Last error: ${details.message}`,
          })
        : error;
    const failure = markF95DownloadFailed(context, summarizedError, "resolve");
    return {
      success: false,
      id: context.id,
      errorCode: failure.errorCode,
      error: failure.message,
      attempts: resolution.attempts,
    };
  }

  if (isStale()) {
    return buildF95CancelledResult(context);
  }

  const prepared = resolution.prepared;
  const usedCandidate = resolution.candidate;
  const fellBack = usedCandidate.url !== context.request.downloadUrl;
  if (fellBack) {
    context.hostLabel = describeCandidate(usedCandidate);
    context.metadata.downloadLabel =
      usedCandidate.label || context.metadata.downloadLabel;
    context.metadata.linkHost = usedCandidate.host || context.metadata.linkHost;
    context.metadata.variantId =
      usedCandidate.variantId || context.metadata.variantId;
  }

  context.prepared = prepared;
  context.hostLabel = prepared.hostLabel || context.hostLabel;
  context.requestedUrl = prepared.resolvedUrl;
  context.metadata.sourceHost = prepared.sourceHost;
  context.metadata.mirrorHost =
    prepared.mirrorHost || context.metadata.mirrorHost;

  if (selectTransferMode(prepared) === "session") {
    const sessionResult = startSessionF95Download(context, prepared);
    if (!sessionResult.success) {
      return { ...sessionResult, id: context.id };
    }
  } else {
    void startDirectF95Download(context, prepared);
  }

  return {
    success: true,
    queued: true,
    id: context.id,
    requestedUrl: prepared.resolvedUrl,
    sourceHost: prepared.sourceHost,
    hostLabel: context.hostLabel,
    usedUrl: usedCandidate.url,
    usedHost: usedCandidate.host,
    usedLabel: usedCandidate.label,
    fellBack,
    attempts: resolution.attempts,
  };
}

/**
 * Makes a fallback mirror the context's main request (label, host, build) so
 * the browser step and later retries work on the mirror that needs the user.
 */
function adoptF95FallbackCandidate(context, candidate, candidates) {
  const info = getMirrorHostInfo(candidate.url || candidate.host || "");
  context.request = {
    ...context.request,
    downloadUrl: candidate.url,
    downloadLabel: candidate.label || context.request.downloadLabel,
    mirrorHost: candidate.host || context.request.mirrorHost,
    variantId: candidate.variantId || context.request.variantId,
    fallbackLinks: candidates.filter((entry) => entry.url !== candidate.url),
  };
  context.requestedUrl = candidate.url;
  context.hostLabel = info.label || info.host || context.hostLabel;
  context.metadata.downloadLabel = context.request.downloadLabel;
  context.metadata.linkHost = context.request.mirrorHost;
  context.metadata.variantId = context.request.variantId;
}

function sendF95InstallAttempt(sender, payload) {
  try {
    if (sender && !sender.isDestroyed()) {
      sender.send("f95-install-attempt", payload);
    }
  } catch (error) {
    console.warn("[f95.download] Failed to report mirror attempt:", error);
  }
}

function startSessionF95Download(context, prepared) {
  queueF95InstallContext(context);

  try {
    const headers = prepared.headers || {};
    if (Object.keys(headers).length > 0) {
      getReadyF95Session().downloadURL(prepared.resolvedUrl, { headers });
    } else {
      getReadyF95Session().downloadURL(prepared.resolvedUrl);
    }
    return { success: true };
  } catch (error) {
    removeF95InstallContext(context);
    context.abortController = null;
    const details = markF95DownloadFailed(context, error, "download");
    return {
      success: false,
      errorCode: details.errorCode,
      error: details.message,
    };
  }
}

/**
 * `session.fetch` (Chromium network stack + F95 session cookies) with a
 * fallback to Node's fetch carrying the same cookies.
 */
function createF95TransferFetch() {
  const f95SessionInstance = getF95ResolverSession();
  return async (url, init) => {
    if (typeof f95SessionInstance.fetch === "function") {
      try {
        return await f95SessionInstance.fetch(url, init);
      } catch (error) {
        if (init?.signal?.aborted) {
          throw error;
        }
        console.warn(
          "[f95.download] Session fetch failed, retrying with Node fetch:",
          getErrorMessage(error, "unknown error"),
        );
      }
    }

    return fetchWithCookieJar(f95SessionInstance, url, init);
  };
}

async function finalizeF95DownloadedPackage({
  context,
  targetPath,
  totalBytes,
  receivedBytes,
  mimeType,
  password,
}) {
  try {
    const importResults = await importDownloadedF95Package(
      targetPath,
      {
        ...context.metadata,
        mimeType: mimeType || "",
      },
      { password: password || "" },
    );
    const firstResult = Array.isArray(importResults) ? importResults[0] : null;
    if (firstResult && firstResult.success === false) {
      throw new Error(firstResult.error || "Unknown install error");
    }
    const warning = String(firstResult?.warning || "");

    storePreferredF95Mirror({
      threadUrl: context.metadata.threadUrl,
      host: context.metadata.linkHost || context.metadata.mirrorHost,
      label: context.metadata.downloadLabel,
      variantId: context.metadata.variantId,
    });

    context.abortController = null;
    f95DownloadsStore.complete(context.id, {
      title: context.metadata.title,
      fileName: path.basename(targetPath),
      text: warning
        ? `Installed ${context.metadata.title} (check the launcher in the library)`
        : `Installed ${context.metadata.title}`,
      totalBytes: totalBytes || 0,
      receivedBytes: receivedBytes || 0,
      recordId: firstResult?.recordId ?? null,
      warning,
      packagePath: "",
    });
    broadcastF95Downloads();
    sendF95DownloadProgress({
      phase: "completed",
      text: `Installed ${context.metadata.title}`,
      percent: 100,
      totalBytes: totalBytes || 0,
      receivedBytes: receivedBytes || 0,
      fileName: path.basename(targetPath),
    });
    installNotificationController.notifyCompleted({
      title: context.metadata.title,
      warning,
      recordId: firstResult?.recordId ?? null,
    });
  } catch (error) {
    console.error(
      "[f95.download] Failed to install downloaded package:",
      error,
    );
    // The package stays on disk after a failed install: the user can retry
    // (with a password, after freeing disk space ...) or unpack it by hand
    // instead of downloading it again. Only payloads that are not a game
    // package at all (HTML error pages, empty files) are removed.
    const threadPassword = String(context.metadata?.archivePassword || "");
    if (
      !password &&
      threadPassword &&
      isArchiveError(error) &&
      ["archive_encrypted", "archive_wrong_password"].includes(error.code)
    ) {
      console.info(
        "[f95.download] The archive is encrypted; retrying with the password from the thread.",
        { id: context.id },
      );
      f95DownloadsStore.installing(context.id, {
        title: context.metadata.title,
        text: `Unpacking ${context.metadata.title} with the password from the thread`,
      });
      broadcastF95Downloads();
      return finalizeF95DownloadedPackage({
        context,
        targetPath,
        totalBytes,
        receivedBytes,
        mimeType,
        password: threadPassword,
      });
    }
    let packagePath = String(error?.packagePath || targetPath || "");
    if (error instanceof DownloadValidationError && error.cleanupFile) {
      await fs.promises.unlink(packagePath).catch(() => {});
      packagePath = "";
    } else if (!fs.existsSync(packagePath)) {
      packagePath = "";
    }
    const hint = isArchiveError(error)
      ? describeArchiveErrorCode(error.code, { password: Boolean(password) })
      : error?.code === "no_executable"
        ? "The package has no launcher the app recognises. Install it anyway from the unpacked folder, or pick the launcher in the library afterwards."
        : "";
    context.abortController = null;
    context.targetPath = packagePath || targetPath;
    markF95DownloadFailed(context, error, "install", {
      totalBytes: totalBytes || 0,
      receivedBytes: receivedBytes || 0,
      packagePath,
      hint,
    });
  } finally {
    releaseF95DownloadPath(context);
  }
}

/**
 * Re-runs the install for a package that is still in the downloads folder
 * (a failed unpack, a password-protected archive, the app closed mid-way).
 * @param {any} context
 * @param {string} packagePath
 * @param {{ password?: string }} options
 */
async function installF95RetainedPackage(context, packagePath, options = {}) {
  stopF95MirrorActionFlow(context);
  context.abortController = null;
  context.cancelled = false;
  context.downloadItem = null;
  context.prepared = null;
  context.targetPath = packagePath;
  releaseF95DownloadPath(context);

  let totalBytes = 0;
  try {
    totalBytes = (await fs.promises.stat(packagePath)).size;
  } catch {
    f95DownloadsStore.clearPackage(context.id);
    markF95DownloadFailed(context, new Error("The downloaded package is no longer on disk. Download it again."), "install");
    return;
  }

  const title = context.metadata.title;
  f95DownloadsStore.installing(context.id, {
    title,
    fileName: path.basename(packagePath),
    text: options.password ? `Unpacking ${title} with the password` : `Installing ${title} again`,
    percent: 100,
    totalBytes,
    receivedBytes: totalBytes,
    error: "",
    errorCode: "",
    hint: "",
    actionUrl: "",
    actionMode: "",
  });
  broadcastF95Downloads();
  sendF95DownloadProgress({
    phase: "installing",
    text: `Installing ${title}`,
    percent: 100,
    totalBytes,
    receivedBytes: totalBytes,
    fileName: path.basename(packagePath),
  });

  await finalizeF95DownloadedPackage({
    context,
    targetPath: packagePath,
    totalBytes,
    receivedBytes: totalBytes,
    mimeType: "",
    password: options.password || "",
  });
}

/**
 * "Install from folder": the user unpacked the package themselves (or has
 * the game folder from elsewhere). The folder is copied into the library
 * unless it already lives inside it, then registered like any install.
 * @param {any} context
 * @param {string} folderPath
 */
async function installF95PackageFromFolder(context, folderPath) {
  stopF95MirrorActionFlow(context);
  context.abortController = null;
  context.cancelled = false;
  context.downloadItem = null;
  context.prepared = null;
  releaseF95DownloadPath(context);

  const metadata = { ...context.metadata };
  const title = metadata.title;
  const folderName = path.basename(folderPath);
  f95DownloadsStore.installing(context.id, {
    title,
    fileName: folderName,
    text: `Installing ${title} from ${folderName}`,
    percent: 100,
    totalBytes: 0,
    receivedBytes: 0,
    error: "",
    errorCode: "",
    hint: "",
    actionUrl: "",
    actionMode: "",
  });
  broadcastF95Downloads();

  try {
    const importResults = await importGameFolderAsF95Package(folderPath, metadata);
    const firstResult = Array.isArray(importResults) ? importResults[0] : null;
    if (firstResult && firstResult.success === false) {
      throw new Error(firstResult.error || "Unknown install error");
    }
    const warning = String(firstResult?.warning || "");
    const retained = f95DownloadsStore.get(context.id)?.packagePath;
    if (retained) {
      // The package was unpacked by hand; its copy is no longer needed.
      removeF95RetainedPackage({ packagePath: retained });
    }
    f95DownloadsStore.complete(context.id, {
      title,
      fileName: folderName,
      text: warning
        ? `Installed ${title} from folder (check the launcher in the library)`
        : `Installed ${title} from folder`,
      totalBytes: 0,
      receivedBytes: 0,
      recordId: firstResult?.recordId ?? null,
      warning,
      packagePath: "",
    });
    broadcastF95Downloads();
    sendF95DownloadProgress({
      phase: "completed",
      text: `Installed ${title}`,
      percent: 100,
      totalBytes: 0,
      receivedBytes: 0,
      fileName: folderName,
    });
    installNotificationController.notifyCompleted({
      title,
      warning,
      recordId: firstResult?.recordId ?? null,
    });
  } catch (error) {
    console.error("[f95.download] Failed to install from folder:", error);
    const retained = f95DownloadsStore.get(context.id)?.packagePath || "";
    markF95DownloadFailed(context, error, "install", {
      packagePath: retained && fs.existsSync(retained) ? retained : "",
    });
  }
}

/**
 * Registers an already unpacked game folder for the thread the download
 * belongs to. Shares the target/backup/executable/engine steps with the
 * archive path.
 */
async function importGameFolderAsF95Package(folderPath, metadata) {
  const librarySettings = appConfig?.Library || {};
  const gameExtensions = parseConfiguredExtensions(
    librarySettings.gameExtensions,
    "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
  );
  const sourceStats = await fs.promises.stat(folderPath);
  if (!sourceStats.isDirectory()) {
    throw new Error("Pick the folder that contains the unpacked game.");
  }
  const contentRoot = await resolveArchiveContentRoot(folderPath);
  const atlasMetadata = await prepareDownloadedGameMetadata(metadata);
  const fallbackName = path.basename(folderPath);
  const title = metadata?.title || fallbackName;
  const installTarget = await resolveF95InstallTarget(metadata, fallbackName);
  const libraryFolder = getConfiguredLibraryFolder();
  const insideLibrary =
    !path.relative(libraryFolder, contentRoot).startsWith("..") &&
    !path.isAbsolute(path.relative(libraryFolder, contentRoot)) &&
    path.relative(libraryFolder, contentRoot) !== "";
  // A folder that already lives in the library is registered where it is;
  // anything else is copied so the user's folder stays untouched.
  const installDirectory = insideLibrary ? contentRoot : installTarget.installDirectory;
  const saveVaultInput = {
    appPaths,
    threadUrl: metadata?.threadUrl || "",
    atlasId: atlasMetadata.atlasId,
    title,
    creator: metadata?.creator || "",
    installDirectory,
  };
  if (!insideLibrary) {
    const existingSaveSnapshot =
      installTarget.existingGame?.record_id && databaseConnection
        ? await getSaveProfileSnapshot(
            appPaths,
            databaseConnection,
            installTarget.existingGame.record_id,
          ).catch(() => null)
        : null;
    if (installTarget.existingGame && fs.existsSync(installDirectory)) {
      await backupGameSaves({
        ...saveVaultInput,
        profiles: existingSaveSnapshot?.profiles || [],
      }).catch((error) => {
        console.warn("[save.vault] Failed to back up saves before folder install:", error);
      });
    }
    await fs.promises.mkdir(installDirectory, { recursive: true });
    await fs.promises.cp(contentRoot, installDirectory, {
      recursive: true,
      force: true,
    });
    await restoreGameSaves({
      ...saveVaultInput,
      overwrite: Boolean(installTarget.existingGame),
    }).catch((error) => {
      console.warn("[save.vault] Failed to restore saves after folder install:", error);
    });
  }

  const executables = findExecutables(installDirectory, gameExtensions);
  const detection = detectGameEngine(installDirectory, { executables });
  const selectedValue = selectPreferredExecutable(executables, {
    title,
    creator: metadata?.creator || "",
    preferredExecutables: detection.preferredExecutables,
    ignoredExecutables: detection.ignoredExecutables,
  });
  const results = await persistF95InstalledGame({
    title,
    metadata,
    installDirectory,
    selectedValue,
    detectedEngine: detection.engine || "Unknown",
    executables: executables.map((value) => ({ key: value, value })),
    existingGame: installTarget.existingGame,
    reusedExisting: installTarget.reusedExisting,
    staleInstallPaths: installTarget.staleInstallPaths,
    gameExtensions,
    atlasMetadata,
  });
  if (Array.isArray(results) && results[0] && executables.length === 0) {
    results[0].warning = "no_executable";
  }
  return results;
}

async function startDirectF95Download(context, prepared) {
  const controller = context.abortController || new AbortController();
  context.abortController = controller;
  const hostLabel = describeF95DownloadHost(context);
  const title = context.metadata.title;
  const fallbackFileName = `${sanitizePathSegment(
    title || "f95-download",
    "f95-download",
  )}.bin`;
  const isCurrentAttempt = () =>
    !context.cancelled && context.abortController === controller;

  f95DownloadsStore.start({
    id: context.id,
    title,
    creator: context.metadata.creator,
    version: context.metadata.version,
    threadUrl: context.metadata.threadUrl,
    requestedUrl: context.request.downloadUrl,
    sourceHost: prepared.sourceHost,
    sourceLabel: context.metadata.downloadLabel,
    hostLabel,
    fileName: prepared.fileName || "",
    text: `Connecting to ${hostLabel}`,
    totalBytes: prepared.size || 0,
    receivedBytes: 0,
    percent: 0,
    speedBytesPerSecond: 0,
  });
  broadcastF95Downloads();
  sendF95DownloadProgress({
    phase: "downloading",
    text: `Connecting to ${hostLabel}`,
    percent: 0,
    totalBytes: prepared.size || 0,
    receivedBytes: 0,
    fileName: prepared.fileName || "",
  });

  let result = null;
  try {
    await fs.promises.mkdir(downloadsDir, { recursive: true });
    // Options are built by the shared module so scripts/check-mirrors.js
    // exercises exactly the same transfer configuration as the app.
    result = await downloadToFile(buildDirectTransferOptions({
      prepared,
      fetchImpl: createF95TransferFetch(),
      signal: controller.signal,
      hostLabel,
      // Cloudflare clearances earned in the browser window are bound to the
      // session's user agent, so the transfer must present the same one.
      userAgent: getReadyF95Session().getUserAgent(),
      fallbackFileName,
      resolveTargetPath: (fileName) => {
        releaseF95DownloadPath(context);
        const reservedPath = reserveF95DownloadPath(
          path.join(
            downloadsDir,
            sanitizePathSegment(fileName || fallbackFileName, fallbackFileName),
          ),
        );
        context.reservedPath = reservedPath;
        context.targetPath = reservedPath;
        return reservedPath;
      },
      onTarget: ({ fileName, totalBytes }) => {
        if (!isCurrentAttempt()) {
          return;
        }
        f95DownloadsStore.progress(context.id, {
          fileName,
          text: `Downloading ${title}`,
          totalBytes,
          receivedBytes: 0,
          percent: 0,
          speedBytesPerSecond: 0,
        });
        broadcastF95Downloads();
        sendF95DownloadProgress({
          phase: "downloading",
          text: `Downloading ${title}`,
          percent: 0,
          totalBytes,
          receivedBytes: 0,
          fileName,
        });
      },
      onProgress: ({ receivedBytes, totalBytes, percent, speedBytesPerSecond }) => {
        if (!isCurrentAttempt()) {
          return;
        }
        const fileName = context.targetPath
          ? path.basename(context.targetPath)
          : "";
        f95DownloadsStore.progress(context.id, {
          title,
          fileName,
          text: `Downloading ${title}`,
          percent,
          totalBytes,
          receivedBytes,
          speedBytesPerSecond,
        });
        broadcastF95Downloads();
        sendF95DownloadProgress({
          phase: "downloading",
          text: `Downloading ${title}`,
          percent,
          totalBytes,
          receivedBytes,
          fileName,
        });
      },
      onRetry: ({ attempt, maxAttempts, delayMs, error, resumeFrom }) => {
        if (!isCurrentAttempt()) {
          return;
        }
        const resumeNote = resumeFrom > 0 ? " and resume" : "";
        f95DownloadsStore.progress(context.id, {
          text: `${hostLabel}: ${summarizeF95DownloadError(error)} Retrying${resumeNote} in ${Math.max(1, Math.ceil(delayMs / 1000))}s (attempt ${attempt + 1}/${maxAttempts})`,
          speedBytesPerSecond: 0,
        });
        broadcastF95Downloads();
      },
    }));
  } catch (error) {
    releaseF95DownloadPath(context);
    if (context.abortController !== controller) {
      return;
    }
    if (
      context.cancelled ||
      controller.signal.aborted ||
      error instanceof DownloadCancelledError
    ) {
      context.abortController = null;
      markF95DownloadCancelled(context);
      return;
    }

    context.abortController = null;
    if (
      error instanceof MirrorActionRequiredError ||
      error?.code === "captcha_required"
    ) {
      console.warn(
        "[f95.download] Transfer needs a browser step, opening it:",
        error.actionUrl || prepared.requestedUrl,
      );
      startF95MirrorActionFlow(
        context,
        error.actionUrl || prepared.requestedUrl || context.request.downloadUrl,
      );
      return;
    }
    console.error("[f95.download] Direct download failed:", error);
    markF95DownloadFailed(context, error, "download");
    return;
  }

  context.targetPath = result.targetPath;
  if (!isCurrentAttempt()) {
    releaseF95DownloadPath(context);
    await fs.promises.unlink(result.targetPath).catch(() => {});
    if (context.abortController === controller) {
      context.abortController = null;
      markF95DownloadCancelled(context);
    }
    return;
  }

  await finalizeF95DownloadedPackage({
    context,
    targetPath: result.targetPath,
    totalBytes: result.totalBytes,
    receivedBytes: result.receivedBytes,
    mimeType: result.mimeType,
  });
}

/**
 * Fallback for mirrors that cannot be finished inside the embedded window
 * (Cloudflare Turnstile answers error 600010 there, Adscore flags the window
 * as a bot): the user downloads the package in their own browser and hands
 * the file over. It is copied into the downloads folder, so the user's copy
 * stays untouched whatever happens next, and then goes through the regular
 * install path.
 * @param {any} context
 * @param {{sourcePath: string, fileName: string, totalBytes: number}} inspected
 */
async function installF95PackageFromFile(context, inspected) {
  stopF95MirrorActionFlow(context);
  const controller = new AbortController();
  context.abortController = controller;
  context.cancelled = false;
  context.downloadItem = null;
  context.prepared = null;
  context.targetPath = "";
  releaseF95DownloadPath(context);

  const title = context.metadata.title;
  const preparingText = `Preparing ${inspected.fileName}`;
  f95DownloadsStore.installing(context.id, {
    title,
    fileName: inspected.fileName,
    text: preparingText,
    percent: 100,
    totalBytes: inspected.totalBytes,
    receivedBytes: inspected.totalBytes,
    error: "",
    errorCode: "",
    actionUrl: "",
    actionMode: "",
  });
  broadcastF95Downloads();
  sendF95DownloadProgress({
    phase: "installing",
    text: preparingText,
    percent: 100,
    totalBytes: inspected.totalBytes,
    receivedBytes: inspected.totalBytes,
    fileName: inspected.fileName,
  });

  let staged;
  try {
    await fs.promises.mkdir(downloadsDir, { recursive: true });
    staged = await stageManualPackage({
      sourcePath: inspected.sourcePath,
      downloadsDir,
      keepOriginal: true,
      reservePath: (candidatePath) => {
        const reservedPath = reserveF95DownloadPath(candidatePath);
        context.reservedPath = reservedPath;
        return reservedPath;
      },
    });
  } catch (error) {
    releaseF95DownloadPath(context);
    context.abortController = null;
    console.error("[f95.download] Failed to stage the user's package:", error);
    if (error && typeof error === "object" && !error.userMessage) {
      error.userMessage = describeManualPackageError(error);
    }
    markF95DownloadFailed(context, error, "install");
    return;
  }

  context.targetPath = staged.targetPath;
  await finalizeF95DownloadedPackage({
    context,
    targetPath: staged.targetPath,
    totalBytes: staged.totalBytes,
    receivedBytes: staged.totalBytes,
    mimeType: "",
  });
}

/**
 * Version rows that point at folders which no longer exist are retired once
 * the game has been installed into a fresh folder (the old rows would keep
 * showing a dead install next to the new one).
 */
async function retireStaleVersionRows(recordId, staleInstallPaths) {
  let retired = 0;
  for (const stalePath of Array.isArray(staleInstallPaths) ? staleInstallPaths : []) {
    if (!stalePath || fs.existsSync(stalePath)) {
      continue;
    }
    try {
      retired += await deleteVersionsForRecordPath(recordId, stalePath);
    } catch (error) {
      console.warn("[f95.install] Failed to retire a stale version row:", {
        recordId,
        stalePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (retired > 0) {
    console.log("[f95.install] Retired stale version rows after a fresh install:", {
      recordId,
      retired,
    });
  }
  return retired;
}

async function persistF95InstalledGame(payload) {
  const atlasMetadata =
    payload.atlasMetadata ||
    (await prepareDownloadedGameMetadata(payload.metadata));
  const installedFolderSize =
    payload.installDirectory && fs.existsSync(payload.installDirectory)
      ? await getFolderSizeAsync(payload.installDirectory)
      : 0;
  const gameRecord = {
    title: payload.title,
    creator: payload.metadata?.creator || "Unknown",
    version: payload.metadata?.version || "Downloaded",
    engine: resolveEngineLabel(
      payload.detectedEngine,
      payload.metadata?.engine,
    ),
    description: payload.metadata?.threadUrl
      ? `Installed from ${payload.metadata.threadUrl}`
      : "Installed from F95",
    folder: payload.installDirectory,
    selectedValue: payload.selectedValue,
    executables: payload.executables,
    siteUrl: payload.metadata?.threadUrl || "",
    f95Id: atlasMetadata.f95Id,
    atlasId: atlasMetadata.atlasId,
  };

  if (payload.existingGame?.record_id) {
    await updateGame({
      record_id: payload.existingGame.record_id,
      title: gameRecord.title,
      creator: gameRecord.creator,
      engine: gameRecord.engine,
    });
    await deleteVersionsForRecordPath(
      payload.existingGame.record_id,
      payload.installDirectory,
    );
    await addVersion(
      {
        ...gameRecord,
        folder: payload.installDirectory,
        folderSize: installedFolderSize,
        execPath: payload.selectedValue
          ? path.join(payload.installDirectory, payload.selectedValue)
          : "",
      },
      payload.existingGame.record_id,
    );
    if (!payload.reusedExisting) {
      await retireStaleVersionRows(
        payload.existingGame.record_id,
        payload.staleInstallPaths,
      );
    }

    if (
      gameRecord.atlasId &&
      payload.existingGame.atlas_id !== gameRecord.atlasId
    ) {
      try {
        await addAtlasMapping(
          payload.existingGame.record_id,
          gameRecord.atlasId,
        );
      } catch (error) {
        console.warn("[f95.install] Failed to update catalog mapping:", {
          recordId: payload.existingGame.record_id,
          atlasId: gameRecord.atlasId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (gameRecord.f95Id || gameRecord.siteUrl) {
      const resolvedF95Id =
        gameRecord.f95Id || extractF95IdFromUrl(gameRecord.siteUrl);
      if (resolvedF95Id) {
        await upsertF95ZoneMapping(
          payload.existingGame.record_id,
          resolvedF95Id,
          gameRecord.siteUrl,
        );
      }
    }

    if (databaseConnection) {
      await refreshSaveProfiles(
        appPaths,
        databaseConnection,
        payload.existingGame.record_id,
      ).catch((error) => {
        console.warn(
          "[save.profiles] Failed to refresh save profiles after update:",
          error,
        );
      });
      scheduleCloudSaveReconcile(
        payload.existingGame.record_id,
        "post-install-update",
      );
    }

    mainWindow?.webContents.send(
      "game-imported",
      payload.existingGame.record_id,
    );
    return [
      {
        success: true,
        recordId: payload.existingGame.record_id,
        atlasId: gameRecord.atlasId,
        title: payload.title,
        updatedExisting: true,
      },
    ];
  }

  const importResults = await importGamesInternal({
    games: [gameRecord],
    deleteAfter: false,
    scanSize: false,
    downloadBannerImages: false,
    downloadPreviewImages: false,
    previewLimit: "0",
    downloadVideos: false,
    gameExt: payload.gameExtensions,
    moveToDefaultFolder: false,
    format: "",
  });

  const importedRecordId = Array.isArray(importResults)
    ? importResults[0]?.recordId
    : null;
  if (
    importedRecordId &&
    installedFolderSize > 0 &&
    String(gameRecord.version || "").trim()
  ) {
    await updateFolderSize(
      importedRecordId,
      String(gameRecord.version).trim(),
      installedFolderSize,
    ).catch((error) => {
      console.warn("[f95.install] Failed to store installed folder size:", {
        recordId: importedRecordId,
        version: gameRecord.version,
        size: installedFolderSize,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  if (databaseConnection && importedRecordId) {
    await refreshSaveProfiles(
      appPaths,
      databaseConnection,
      importedRecordId,
    ).catch((error) => {
      console.warn(
        "[save.profiles] Failed to refresh save profiles after install:",
        error,
      );
    });
    scheduleCloudSaveReconcile(importedRecordId, "post-install-import");
  }

  return importResults;
}

async function importDownloadedF95Package(downloadPath, metadata, options = {}) {
  const librarySettings = appConfig?.Library || {};
  const archiveExtensions = parseConfiguredExtensions(
    librarySettings.extractionExtensions,
    "zip,7z,rar",
  );
  const gameExtensions = parseConfiguredExtensions(
    librarySettings.gameExtensions,
    "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
  );
  const payloadInfo = await inspectDownloadedPackage({
    filePath: downloadPath,
    mimeType: metadata?.mimeType || "",
    archiveExtensions,
    gameExtensions,
  });
  const atlasMetadata = await prepareDownloadedGameMetadata(metadata);

  let installSourcePath = downloadPath;
  try {
    return await importDownloadedF95PackageAt();
  } catch (error) {
    // The package may have been renamed to its real extension; report the
    // path that is actually on disk so it can be retried later.
    if (error && typeof error === "object") {
      error.packagePath = installSourcePath;
    }
    throw error;
  }

  async function importDownloadedF95PackageAt() {
  const currentExtension = path
    .extname(installSourcePath)
    .replace(/^\./, "")
    .toLowerCase();

  if (
    payloadInfo.installKind === "archive" &&
    payloadInfo.normalizedExtension &&
    currentExtension !== payloadInfo.normalizedExtension
  ) {
    const normalizedArchivePath = ensureUniquePath(
      `${installSourcePath}.${payloadInfo.normalizedExtension}`,
    );
    await fs.promises.rename(installSourcePath, normalizedArchivePath);
    installSourcePath = normalizedArchivePath;
  }

  const fallbackName = path.basename(
    installSourcePath,
    path.extname(installSourcePath),
  );
  const title = metadata?.title || fallbackName;
  const installTarget = await resolveF95InstallTarget(metadata, fallbackName);
  const installDirectory = installTarget.installDirectory;
  const saveVaultInput = {
    appPaths,
    threadUrl: metadata?.threadUrl || "",
    atlasId: atlasMetadata.atlasId,
    title,
    creator: metadata?.creator || "",
    installDirectory,
  };
  const existingSaveSnapshot =
    installTarget.existingGame?.record_id && databaseConnection
      ? await getSaveProfileSnapshot(
          appPaths,
          databaseConnection,
          installTarget.existingGame.record_id,
        ).catch((error) => {
          console.warn(
            "[save.profiles] Failed to load save profile snapshot:",
            error,
          );
          return null;
        })
      : null;

  if (installTarget.existingGame && fs.existsSync(installDirectory)) {
    await backupGameSaves({
      ...saveVaultInput,
      profiles: existingSaveSnapshot?.profiles || [],
    }).catch((error) => {
      console.warn(
        "[save.vault] Failed to back up saves before update:",
        error,
      );
    });
  }

  mainWindow?.webContents.send("f95-download-progress", {
    phase: "installing",
    text: `Preparing install for ${title}`,
    percent: 100,
    totalBytes: 0,
    receivedBytes: 0,
  });
  f95DownloadsStore.installing(metadata.id, {
    title,
    text: `Installing ${title}`,
    percent: 100,
    totalBytes: 0,
    receivedBytes: 0,
  });
  broadcastF95Downloads();

  if (payloadInfo.installKind === "archive") {
    const extractionStagingDirectory = ensureUniquePath(
      path.join(
        downloadsDir,
        "_staging",
        sanitizePathSegment(`${title}-${Date.now()}`),
      ),
    );

    // Everything is unpacked and checked in a staging folder first: the
    // install folder (and an existing install being updated) is touched only
    // once the package proved to be a usable game.
    let stagedExecutables = [];
    try {
      await extractArchiveSafely({
        archivePath: installSourcePath,
        destinationPath: extractionStagingDirectory,
        password: options.password || "",
      });
      let archiveContentRoot = await resolveArchiveContentRoot(
        extractionStagingDirectory,
      );
      stagedExecutables = findExecutables(archiveContentRoot, gameExtensions);
      if (stagedExecutables.length === 0) {
        // "Archive inside an archive": unpack one nested level in place.
        const nested = await unwrapNestedArchive(archiveContentRoot, {
          password: options.password || "",
        });
        if (nested) {
          archiveContentRoot = await resolveArchiveContentRoot(nested);
          stagedExecutables = findExecutables(archiveContentRoot, gameExtensions);
        }
      }

      await moveDirectoryIntoPlace(archiveContentRoot, installDirectory);
      await fs.promises
        .rm(extractionStagingDirectory, {
          recursive: true,
          force: true,
        })
        .catch(() => {});
    } catch (error) {
      await fs.promises
        .rm(extractionStagingDirectory, {
          recursive: true,
          force: true,
        })
        .catch(() => {});
      throw error;
    }
    // The install succeeded: the package is not needed any more.
    await fs.promises.unlink(installSourcePath).catch(() => {});

    const executables = findExecutables(installDirectory, gameExtensions);
    const detection = detectGameEngine(installDirectory, { executables });
    const selectedValue = selectPreferredExecutable(executables, {
      title,
      creator: metadata?.creator || "",
      preferredExecutables: detection.preferredExecutables,
      ignoredExecutables: detection.ignoredExecutables,
    });
    const detectedEngine = detection.engine || "Unknown";

    await restoreGameSaves({
      ...saveVaultInput,
      overwrite: Boolean(installTarget.existingGame),
    }).catch((error) => {
      console.warn(
        "[save.vault] Failed to restore saves after archive install:",
        error,
      );
    });

    const results = await persistF95InstalledGame({
      title,
      metadata,
      installDirectory,
      selectedValue,
      detectedEngine,
      executables: executables.map((value) => ({ key: value, value })),
      existingGame: installTarget.existingGame,
      reusedExisting: installTarget.reusedExisting,
      staleInstallPaths: installTarget.staleInstallPaths,
      gameExtensions,
      atlasMetadata,
    });
    if (Array.isArray(results) && results[0] && executables.length === 0) {
      results[0].warning = "no_executable";
    }
    return results;
  }

  const installedFilePath = await moveFileIntoDirectory(
    installSourcePath,
    installDirectory,
    {
      overwrite: Boolean(installTarget.existingGame),
    },
  );
  const relativeExecutable = path.basename(installedFilePath);
  const detectedEngine =
    detectGameEngine(installDirectory, { executables: [relativeExecutable] }).engine ||
    "Unknown";

  await restoreGameSaves({
    ...saveVaultInput,
    overwrite: Boolean(installTarget.existingGame),
  }).catch((error) => {
    console.warn(
      "[save.vault] Failed to restore saves after file install:",
      error,
    );
  });

  return persistF95InstalledGame({
    title,
    metadata,
    installDirectory,
    selectedValue: relativeExecutable,
    detectedEngine,
    executables: [{ key: relativeExecutable, value: relativeExecutable }],
    existingGame: installTarget.existingGame,
    reusedExisting: installTarget.reusedExisting,
    staleInstallPaths: installTarget.staleInstallPaths,
    gameExtensions,
    atlasMetadata,
  });
  }
}

/**
 * When an unpacked package holds nothing but another archive (zip inside a
 * rar is common on mirrors), unpack that one next to it and return the new
 * content root; otherwise null.
 * @param {string} contentRoot
 * @param {{ password?: string }} options
 */
async function unwrapNestedArchive(contentRoot, options = {}) {
  const entries = await fs.promises.readdir(contentRoot, { withFileTypes: true });
  const archives = entries.filter(
    (entry) => entry.isFile() && isSupportedArchiveName(entry.name),
  );
  const others = entries.filter(
    (entry) => !entry.isDirectory() && !isSupportedArchiveName(entry.name),
  );
  if (archives.length !== 1 || others.length > 3) {
    return null;
  }
  const nestedPath = path.join(contentRoot, archives[0].name);
  const nestedDestination = path.join(
    contentRoot,
    `${path.basename(archives[0].name, path.extname(archives[0].name))}`,
  );
  await extractArchiveSafely({
    archivePath: nestedPath,
    destinationPath: nestedDestination,
    password: options.password || "",
  });
  await fs.promises.unlink(nestedPath).catch(() => {});
  return nestedDestination;
}

const F95_SESSION_DOWNLOAD_MAX_RESUMES = 5;

function attachF95DownloadListener() {
  getReadyF95Session().on("will-download", (event, item, webContents) => {
    const context =
      resolveF95InstallContext(item) || adoptF95ActionContext(webContents);

    if (!context) {
      return;
    }

    if (context.cancelled) {
      item.cancel();
      return;
    }

    context.downloadItem = item;
    removeF95InstallContext(context);
    releaseF95DownloadPath(context);
    const targetPath = reserveF95DownloadPath(
      path.join(
        downloadsDir,
        sanitizePathSegment(item.getFilename() || "f95-download.bin"),
      ),
    );
    context.reservedPath = targetPath;
    context.targetPath = targetPath;
    item.setSavePath(targetPath);
    let resumeAttempts = 0;

    f95DownloadsStore.start({
      id: context.id,
      title: context.metadata.title,
      creator: context.metadata.creator,
      version: context.metadata.version,
      threadUrl: context.metadata.threadUrl,
      requestedUrl: context.request?.downloadUrl || context.requestedUrl,
      sourceHost: context.metadata.sourceHost,
      sourceLabel: context.metadata.downloadLabel,
      hostLabel: context.hostLabel,
      fileName: path.basename(targetPath),
      text: `Downloading ${context.metadata.title}`,
      totalBytes: item.getTotalBytes() || 0,
      receivedBytes: 0,
      percent: 0,
      speedBytesPerSecond: 0,
    });
    broadcastF95Downloads();

    sendF95DownloadProgress({
      phase: "downloading",
      text: `Downloading ${context.metadata.title}`,
      percent: 0,
      totalBytes: item.getTotalBytes() || 0,
      receivedBytes: 0,
      fileName: path.basename(targetPath),
    });

    item.on("updated", (updatedEvent, state) => {
      if (context.cancelled) {
        return;
      }

      if (state === "interrupted") {
        if (
          typeof item.canResume === "function" &&
          item.canResume() &&
          resumeAttempts < F95_SESSION_DOWNLOAD_MAX_RESUMES
        ) {
          resumeAttempts += 1;
          const delayMs = 2000 * resumeAttempts;
          f95DownloadsStore.progress(context.id, {
            text: `Connection interrupted. Resuming in ${Math.ceil(delayMs / 1000)}s (attempt ${resumeAttempts}/${F95_SESSION_DOWNLOAD_MAX_RESUMES})`,
            speedBytesPerSecond: 0,
          });
          broadcastF95Downloads();
          setTimeout(() => {
            if (
              !context.cancelled &&
              item.getState() === "interrupted" &&
              item.canResume()
            ) {
              item.resume();
            }
          }, delayMs);
          return;
        }

        context.downloadItem = null;
        context.abortController = null;
        releaseF95DownloadPath(context);
        markF95DownloadFailed(
          context,
          new MirrorError(
            `The connection to ${describeF95DownloadHost(context)} was interrupted and could not be resumed.`,
            { code: "network" },
          ),
          "download",
          {
            totalBytes: item.getTotalBytes() || 0,
            receivedBytes: item.getReceivedBytes() || 0,
          },
        );
        return;
      }

      const totalBytes = item.getTotalBytes() || 0;
      const receivedBytes = item.getReceivedBytes() || 0;
      const percent =
        totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
      const speedBytesPerSecond =
        typeof item.getCurrentBytesPerSecond === "function"
          ? item.getCurrentBytesPerSecond() || 0
          : 0;

      f95DownloadsStore.progress(context.id, {
        title: context.metadata.title,
        fileName: path.basename(targetPath),
        text: `Downloading ${context.metadata.title}`,
        percent,
        totalBytes,
        receivedBytes,
        speedBytesPerSecond,
      });
      broadcastF95Downloads();

      sendF95DownloadProgress({
        phase: "downloading",
        text: `Downloading ${context.metadata.title}`,
        percent,
        totalBytes,
        receivedBytes,
        fileName: path.basename(targetPath),
      });
    });

    item.once("done", async (doneEvent, state) => {
      context.downloadItem = null;

      if (context.cancelled || state === "cancelled") {
        context.abortController = null;
        releaseF95DownloadPath(context);
        await fs.promises.unlink(targetPath).catch(() => {});
        if (context.cancelled) {
          markF95DownloadCancelled(context);
        } else {
          markF95DownloadFailed(
            context,
            new MirrorError("The download was cancelled outside F95Launcher.", {
              code: "download_failed",
            }),
          );
        }
        return;
      }

      if (state !== "completed") {
        context.abortController = null;
        releaseF95DownloadPath(context);
        markF95DownloadFailed(
          context,
          new MirrorError(
            `The download from ${describeF95DownloadHost(context)} was ${state}.`,
            { code: state === "interrupted" ? "network" : "download_failed" },
          ),
          "download",
          {
            totalBytes: item.getTotalBytes() || 0,
            receivedBytes: item.getReceivedBytes() || 0,
          },
        );
        return;
      }

      await finalizeF95DownloadedPackage({
        context,
        targetPath,
        totalBytes: item.getTotalBytes() || 0,
        receivedBytes: item.getReceivedBytes() || 0,
        mimeType:
          typeof item.getMimeType === "function" ? item.getMimeType() : "",
      });
    });
  });
}

// Initialize config.ini
const defaultConfig = {
  Interface: {
    language: "English",
    gameStartup: "Do Nothing",
    showDebugConsole: false,
    minimizeToTray: false,
    openAtLogin: false,
    startMinimized: false,
  },
  Library: {
    rootPath: dataDir,
    gameFolder: "",
    autoScanOnStartup: true,
    autoBackup: true,
  },
  Metadata: {
    downloadPreviews: true,
  },
  Performance: {
    maxHeapSize: 4096,
  },
  Notifications: {
    appUpdates: true,
    libraryUpdates: true,
    installs: true,
  },
  AppUpdates: {
    autoDownload: true,
  },
  LiveUpdates: {
    allGames: false,
  },
  Onboarding: {
    completed: false,
    completedAt: "",
  },
  Appearance: {
    bannerTemplate: "",
  },
  F95Mirrors: {},
};

// ────────────────────────────────────────────────
// IPC HANDLERS
// ────────────────────────────────────────────────

ipcMain.handle("add-game", async (event, game) => {
  const recordId = await addGame(game);
  return recordId;
});

ipcMain.handle("count-versions", async (_, recordId) => {
  return await countVersions(recordId);
});

// Removes one version row from the library (the folder on disk is kept).
ipcMain.handle("delete-version", async (_, payload) => {
  const recordId = Number(payload?.recordId);
  const version = typeof payload?.version === "string" ? payload.version : null;
  if (!Number.isInteger(recordId) || recordId <= 0 || version === null) {
    return {
      success: false,
      wasLastVersion: false,
      error: "This version is no longer in your library.",
    };
  }

  try {
    const countBefore = await countVersions(recordId);
    const result = await deleteVersion(recordId, version);
    const countAfter = countBefore - (result.changes > 0 ? 1 : 0);

    if (result.changes > 0) {
      mainWindow?.webContents.send("game-updated", recordId);
    }

    return {
      success: result.changes > 0,
      wasLastVersion: countAfter === 0,
      ...(result.changes > 0
        ? {}
        : { error: "This version is no longer in your library." }),
    };
  } catch (error) {
    console.error("[library.repair] Failed to remove a version:", error);
    return {
      success: false,
      wasLastVersion: false,
      error: "The version could not be removed. Try again.",
    };
  }
});

ipcMain.handle("delete-game-completely", async (_, recordId) => {
  try {
    const game = await getGame(recordId, appPaths);
    const installDirectory = getPreferredInstalledPath(game);
    const saveSnapshot =
      databaseConnection && game
        ? await getSaveProfileSnapshot(
            appPaths,
            databaseConnection,
            recordId,
          ).catch((error) => {
            console.warn(
              "[save.profiles] Failed to load save profile snapshot before delete:",
              error,
            );
            return null;
          })
        : null;

    if (installDirectory && fs.existsSync(installDirectory)) {
      await backupGameSaves({
        appPaths,
        threadUrl: game?.siteUrl || "",
        atlasId: game?.atlas_id || "",
        title: game?.displayTitle || game?.title || "",
        creator: game?.displayCreator || game?.creator || "",
        installDirectory,
        profiles: saveSnapshot?.profiles || [],
      });
    }
  } catch (error) {
    console.warn("[save.vault] Failed to back up saves before delete:", error);
  }

  const result = await deleteGameCompletely(recordId, appPaths);

  if (result.success) {
    broadcastGameDeleted(recordId);
  }

  return result;
});

ipcMain.handle("remove-library-game", async (_, payload) => {
  try {
    const result = await removeLibraryGame(payload || {}, {
      appPaths,
      libraryRoot: getConfiguredLibraryFolder(),
      databaseConnection,
      getGame,
      getGames,
      getSaveProfileSnapshot,
      deleteGameCompletely,
    });

    if (result?.success) {
      broadcastGameDeleted(result.recordId);
    }

    return result;
  } catch (error) {
    console.error("[library.remove] Failed to remove game:", error);
    return {
      success: false,
      code: "INTERNAL_REMOVE_ERROR",
      error: "F95Launcher could not remove the selected game.",
    };
  }
});

ipcMain.handle("get-game", async (event, recordId) => {
  console.log("Resolved writable root", appPaths.root);
  return await loadLibraryGame(recordId);
});

ipcMain.handle("get-games", async (event, { offset, limit }) => {
  const games = await getGames(appPaths, offset, limit);
  return annotateLibraryPresence(games);
});

ipcMain.handle("set-game-favorite", async (_event, payload) => {
  const recordId = Number(payload?.recordId);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return {
      success: false,
      error: "Invalid game identifier.",
    };
  }

  const isFavorite = Boolean(payload?.isFavorite);

  try {
    await setGameFavorite(recordId, isFavorite);
    const game = await loadLibraryGame(recordId);

    if (!game) {
      return {
        success: false,
        error: "Game was not found after update.",
      };
    }

    return {
      success: true,
      game,
    };
  } catch (error) {
    console.error("[library.favorite] Failed to update game favorite:", error);
    return {
      success: false,
      error: "F95Launcher could not update Favorites for this game.",
    };
  }
});

// Legacy channel. It used to delete only the games row and left versions,
// mappings and images orphaned; it now performs the complete removal.
ipcMain.handle("remove-game", async (event, record_id) => {
  const result = await deleteGameCompletely(record_id, appPaths);
  if (result.success) {
    broadcastGameDeleted(record_id);
  }
  return result;
});

ipcMain.handle("unzip-game", async (event, { zipPath, extractPath }) => {
  try {
    return await extractArchiveSafely({
      archivePath: zipPath,
      destinationPath: extractPath,
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("get-app-update-state", async () => {
  return appUpdater.getState();
});

ipcMain.handle("check-app-update", async () => {
  return runAppUpdateCheck("renderer");
});

ipcMain.handle("download-app-update", async () => {
  return appUpdater.downloadUpdate();
});

ipcMain.handle("install-app-update", async () => {
  return appUpdater.installUpdate();
});

ipcMain.handle("check-updates", async () => {
  return runAppUpdateCheck("legacy-renderer");
});

ipcMain.handle("check-db-updates", async () => {
  return runLibraryUpdateRefresh("renderer");
});

ipcMain.handle("minimize-window", () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) focusedWindow.minimize();
});

ipcMain.handle("maximize-window", () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) {
    if (focusedWindow.isMaximized()) {
      focusedWindow.unmaximize();
    } else {
      focusedWindow.maximize();
    }
  }
});

ipcMain.handle("close-window", async () => {
  console.log("IPC close-window called");
  try {
    const windows = BrowserWindow.getAllWindows();
    const importSourceWindow = windows.find((w) =>
      w.webContents.getURL().includes("import-source.html"),
    );
    if (importSourceWindow) {
      console.log("Closing import-source window");
      importSourceWindow.close();
      console.log("import-source window closed");
      return { success: true };
    }
    console.log("No import-source window found, closing focused window");
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.close();
      console.log("Focused window closed");
      return { success: true };
    }
    return {
      success: false,
      error: "No import-source or focused window found",
    };
  } catch (err) {
    console.error("Error in close-window:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("select-file", async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  } catch (err) {
    console.error("Error selecting file:", err);
    return null;
  }
});

ipcMain.handle("select-directory", async (event, options = {}) => {
  const parentWindow =
    BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined;
  const defaultPath = String(options?.defaultPath || "").trim();
  const result = await dialog.showOpenDialog(parentWindow, {
    title: String(options?.title || "Choose a folder"),
    buttonLabel: String(options?.buttonLabel || "Use this folder"),
    defaultPath:
      defaultPath && fs.existsSync(defaultPath) ? defaultPath : undefined,
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle("get-version", () => app.getVersion());

ipcMain.handle("open-settings", () => {
  if (!settingsWindow) {
    createSettingsWindow();
  } else {
    settingsWindow.focus();
  }
});
ipcMain.handle("get-unique-filter-options", async () => {
  return await getUniqueFilterOptions();
});

ipcMain.handle("get-settings", async () => {
  return appConfig || defaultConfig;
});

function broadcastSettingsChanged() {
  BrowserWindow.getAllWindows().forEach((windowInstance) => {
    if (!windowInstance.isDestroyed()) {
      windowInstance.webContents.send("settings-changed", appConfig);
    }
  });
}

ipcMain.handle("update-settings", async (event, payload) => {
  try {
    appConfig = applySettingsPatch(
      appConfig || defaultConfig,
      String(payload?.section || ""),
      payload?.values || {},
    );
    saveConfig();
    trayController.refresh();
    applyLoginItemSettings();
    appUpdater.applySettings();
    broadcastSettingsChanged();
    return { success: true, config: appConfig };
  } catch (error) {
    console.error("[settings] Failed to update settings:", error);
    return { success: false, error: getErrorMessage(error, "Failed to save.") };
  }
});

function getFolderInsightDeps() {
  return {
    appRoot: app.isPackaged ? path.dirname(app.getPath("exe")) : "",
  };
}

ipcMain.handle("get-app-info", async () => ({
  version: app.getVersion(),
  platform: process.platform,
  isPackaged: app.isPackaged,
  isFreshInstall: !configExistedAtStartup,
  paths: {
    data: appPaths.data,
    logs: appPaths.logs,
    cache: appPaths.cache,
    downloads: downloadsDir,
    fallbackGames: appPaths.games,
  },
  defaults: {
    gameExtensions: DEFAULT_GAME_EXTENSIONS,
    extractionExtensions: DEFAULT_ARCHIVE_EXTENSIONS,
  },
}));

ipcMain.handle("inspect-folder", async (event, targetPath, options) => {
  try {
    if (options?.purpose === "scan") {
      return await inspectScanFolder(String(targetPath || ""));
    }
    return await inspectFolder(String(targetPath || ""), getFolderInsightDeps());
  } catch (error) {
    console.error("[settings] Failed to inspect folder:", error);
    return {
      path: String(targetPath || ""),
      status: "error",
      warnings: [
        {
          code: "inspect_failed",
          level: "error",
          message: getErrorMessage(error, "This folder can't be checked."),
        },
      ],
    };
  }
});

ipcMain.handle("suggest-library-folders", async () => {
  try {
    return await suggestLibraryFolders({
      ...getFolderInsightDeps(),
      currentFolder: appConfig?.Library?.gameFolder || "",
    });
  } catch (error) {
    console.error("[settings] Failed to suggest library folders:", error);
    return [];
  }
});

ipcMain.handle("detect-game-folders", async () => {
  try {
    const sourcesResult = await listScanSources(appPaths);
    return await detectGameFolders({
      extraRoots: [appConfig?.Library?.gameFolder || ""],
      existingSources: (sourcesResult?.sources || []).map(
        (source) => source.path,
      ),
    });
  } catch (error) {
    console.error("[settings] Failed to detect game folders:", error);
    return [];
  }
});

ipcMain.handle("relaunch-app", () => {
  app.relaunch();
  trayController.prepareForQuit();
  app.quit();
});

ipcMain.handle("save-settings", async (event, settings) => {
  try {
    appConfig = settings;
    writeFileAtomicSync(configPath, ini.stringify(settings));
    trayController.refresh();
    return { success: true };
  } catch (err) {
    console.error("Error writing to config.ini:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-save-profile-snapshot", async (_, recordId) => {
  try {
    if (!databaseConnection) {
      throw new Error("Database connection is not ready.");
    }

    const snapshot = await getSaveProfileSnapshot(
      appPaths,
      databaseConnection,
      recordId,
    );
    return {
      success: true,
      snapshot,
    };
  } catch (error) {
    console.error(
      "[save.profiles] Failed to get save profile snapshot:",
      error,
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      snapshot: null,
    };
  }
});

ipcMain.handle("refresh-save-profiles", async (_, recordId) => {
  try {
    if (!databaseConnection) {
      throw new Error("Database connection is not ready.");
    }

    const snapshot = await refreshSaveProfiles(
      appPaths,
      databaseConnection,
      recordId,
    );
    scheduleCloudSaveReconcile(recordId, "manual-refresh");
    return {
      success: true,
      snapshot,
    };
  } catch (error) {
    console.error("[save.profiles] Failed to refresh save profiles:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      snapshot: null,
    };
  }
});

ipcMain.handle("get-f95-auth-status", async () => {
  return getF95AuthState(getReadyF95Session());
});

ipcMain.handle("get-f95-downloads", async () => {
  return {
    items: f95DownloadsStore.list(),
    activeCount: f95DownloadsStore.activeCount(),
  };
});

ipcMain.handle("get-f95-thread-install-state", async (event, payload) => {
  try {
    return await getF95ThreadInstallState(payload || {});
  } catch (error) {
    console.error(
      "[f95.install] Failed to resolve thread install state:",
      error,
    );
    return {
      inLibrary: false,
      installed: false,
      recordId: null,
      title: "",
      creator: "",
      version: "",
      gamePath: "",
      siteUrl: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("add-f95-thread-to-library", async (event, payload) => {
  try {
    const authState = await getF95AuthState(getReadyF95Session());
    if (!authState.isAuthenticated) {
      return {
        success: false,
        error: "F95 login is required before linking a thread to the library.",
        result: null,
      };
    }

    const result = await addF95ThreadToLibrary(payload || {});
    return {
      success: true,
      result,
    };
  } catch (error) {
    console.error("[f95.library] Failed to add thread to library:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      result: null,
    };
  }
});

ipcMain.handle("inspect-f95-thread", async (event, payload) => {
  try {
    return await inspectF95ThreadPayload(String(payload?.threadUrl || ""));
  } catch (error) {
    console.error("[f95.thread] Failed to inspect thread:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      threadUrl: String(payload?.threadUrl || ""),
      links: [],
      variants: [],
      preferredLinkUrl: "",
      recommendation: null,
    };
  }
});

ipcMain.handle("open-f95-login", async () => {
  createF95LoginWindow({
    BrowserWindow,
    appConfig,
  });
  return getF95AuthState(getReadyF95Session());
});

ipcMain.handle("logout-f95", async () => {
  const authState = await clearF95Session(getReadyF95Session());
  await broadcastF95AuthState();
  return authState;
});

ipcMain.handle("install-f95-thread", async (event, payload) => {
  const authState = await getF95AuthState(getReadyF95Session());
  if (!authState.isAuthenticated) {
    return {
      success: false,
      error: "F95 login is required before starting installs.",
    };
  }

  const request = buildF95DownloadRequest(payload);
  if (!request.downloadUrl) {
    return {
      success: false,
      error: "No download URL was provided.",
    };
  }

  pruneF95DownloadContexts();
  const context = createF95DownloadContext(request);
  supersedeF95DownloadEntries(context);
  return runF95DownloadContext(context, { sender: event.sender });
});

ipcMain.handle("cancel-f95-download", async (event, id) => {
  try {
    const downloadId = String(id || "").trim();
    const entry = f95DownloadsStore.get(downloadId);
    if (!entry) {
      return { success: false, error: "Download not found." };
    }

    if (!entry.canCancel) {
      return {
        success: false,
        error:
          entry.status === "installing"
            ? "This download is already being installed and can no longer be cancelled."
            : "This download is not running.",
      };
    }

    const context = f95DownloadContexts.get(downloadId);
    if (context) {
      context.cancelled = true;
      stopF95MirrorActionFlow(context);
      try {
        context.abortController?.abort();
      } catch (error) {
        console.warn("[f95.download] Failed to abort download:", error);
      }
      if (context.downloadItem) {
        try {
          context.downloadItem.cancel();
        } catch (error) {
          console.warn("[f95.download] Failed to cancel download item:", error);
        }
      }
    }

    markF95DownloadCancelled(
      context || { id: downloadId, metadata: { title: entry.title } },
    );
    return { success: true };
  } catch (error) {
    console.error("[f95.download] Failed to cancel download:", error);
    return {
      success: false,
      error: getErrorMessage(error, "Failed to cancel the download."),
    };
  }
});

ipcMain.handle("retry-f95-download", async (event, id) => {
  const authState = await getF95AuthState(getReadyF95Session());
  if (!authState.isAuthenticated) {
    return {
      success: false,
      error: "F95 login is required before starting installs.",
    };
  }

  const downloadId = String(id || "").trim();
  const entry = f95DownloadsStore.get(downloadId);
  const context = f95DownloadContexts.get(downloadId);
  if (!entry || !context?.request?.downloadUrl) {
    return {
      success: false,
      error:
        "This download can no longer be retried. Start it again from the game thread.",
    };
  }

  if (!entry.canRetry) {
    return {
      success: false,
      error: entry.canCancel || entry.status === "installing"
        ? "This download is still running."
        : "This download can no longer be retried.",
    };
  }

  return runF95DownloadContext(context);
});

ipcMain.handle("open-f95-download-action", async (event, id) => {
  const downloadId = String(id || "").trim();
  const entry = f95DownloadsStore.get(downloadId);
  const context = f95DownloadContexts.get(downloadId);
  if (!entry || !context?.request?.downloadUrl) {
    return {
      success: false,
      error: "This download can no longer be resumed. Start it again from the game thread.",
    };
  }
  if (!["error", "cancelled", "action"].includes(entry.status)) {
    return { success: false, error: "This download is still running." };
  }
  try {
    return startF95MirrorActionFlow(
      context,
      entry.actionUrl || context.actionFlow?.actionUrl || context.request.downloadUrl,
    );
  } catch (error) {
    console.error("[f95.download] Failed to open the browser step:", error);
    return {
      success: false,
      error: getErrorMessage(error, "The browser window could not be opened."),
    };
  }
});

const MANUAL_INSTALL_STATUSES = new Set(["error", "action", "cancelled"]);
const MANUAL_PACKAGE_EXTENSIONS = [
  "zip", "7z", "rar", "exe", "apk", "tar", "gz", "tgz", "bz2", "xz", "zst",
  "jar", "swf", "msi",
];

function findF95DownloadForManualStep(id) {
  const downloadId = String(id || "").trim();
  const entry = f95DownloadsStore.get(downloadId);
  if (!entry) {
    return {
      error:
        "This download can no longer be resumed. Start it again from the game thread.",
    };
  }
  if (!MANUAL_INSTALL_STATUSES.has(entry.status)) {
    return { error: "This download is still running." };
  }
  // Entries restored after a restart have no live context; rebuild enough
  // of one to install a file, a folder or the kept package.
  const context = f95DownloadContexts.get(downloadId) || createF95ContextFromEntry(entry);
  return { entry, context };
}

/**
 * Retry the install of the package kept after a failed attempt, optionally
 * with an archive password. Nothing is downloaded again.
 */
ipcMain.handle("retry-f95-install", async (event, payload) => {
  const id = typeof payload === "string" ? payload : payload?.id;
  const password = typeof payload === "object" && payload ? String(payload.password || "") : "";
  const found = findF95DownloadForManualStep(id);
  if (!found.context) {
    return { success: false, error: found.error };
  }
  const { entry, context } = found;
  const packagePath = String(entry.packagePath || "");
  if (!packagePath) {
    return {
      success: false,
      error: "There is no downloaded package to install. Retry the download or pick the file yourself.",
    };
  }
  if (!fs.existsSync(packagePath)) {
    f95DownloadsStore.clearPackage(entry.id);
    broadcastF95Downloads();
    return {
      success: false,
      error: "The downloaded package is no longer on disk. Download it again.",
    };
  }
  void installF95RetainedPackage(context, packagePath, { password });
  return { success: true, queued: true, id: context.id, fileName: path.basename(packagePath) };
});

/**
 * The user unpacked the package by hand: pick the game folder and register
 * it for this download's thread.
 */
ipcMain.handle("install-f95-download-from-folder", async (event, id) => {
  const found = findF95DownloadForManualStep(id);
  if (!found.context) {
    return { success: false, error: found.error };
  }
  const { context } = found;
  const dialogOptions = {
    title: `Pick the unpacked game folder for ${context.metadata.title}`,
    defaultPath: getConfiguredLibraryFolder(),
    buttonLabel: "Install",
    properties: /** @type {Array<"openDirectory">} */ (["openDirectory"]),
  };
  const picked = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (picked.canceled || !picked.filePaths?.length) {
    return { success: false, cancelled: true };
  }
  const recheck = findF95DownloadForManualStep(id);
  if (!recheck.context) {
    return { success: false, error: recheck.error };
  }
  const folderPath = picked.filePaths[0];
  if (path.resolve(folderPath) === path.resolve(getConfiguredLibraryFolder())) {
    return {
      success: false,
      error: "Pick the folder of this game, not the whole library folder.",
    };
  }
  void installF95PackageFromFolder(context, folderPath);
  return { success: true, queued: true, id: context.id, folderName: path.basename(folderPath) };
});

/**
 * The mirror cannot be finished in the embedded window (bot detection such
 * as Cloudflare Turnstile or Adscore): open its page in the user's own
 * browser and wait for the downloaded file (`install-f95-download-from-file`).
 */
ipcMain.handle("open-f95-download-in-browser", async (event, id) => {
  const found = findF95DownloadForManualStep(id);
  if (!found.context) {
    return { success: false, error: found.error };
  }
  const { entry, context } = found;
  const targetUrl =
    entry.actionUrl ||
    context.actionFlow?.actionUrl ||
    context.request.downloadUrl;
  if (!/^https?:\/\//i.test(targetUrl)) {
    return { success: false, error: "This mirror link cannot be opened in a browser." };
  }
  const hostLabel = describeF95DownloadHost(context);
  try {
    stopF95MirrorActionFlow(context);
    context.abortController = null;
    await shell.openExternal(targetUrl);
  } catch (error) {
    console.error(
      "[f95.download] Failed to open the mirror in the system browser:",
      error,
    );
    return {
      success: false,
      error: getErrorMessage(error, "The link could not be opened in your browser."),
    };
  }

  f95DownloadsStore.awaitingAction(context.id, {
    mode: "file",
    actionUrl: targetUrl,
    hostLabel,
    text: `Download the file from ${hostLabel} in your browser, then pick it here and it gets installed.`,
  });
  broadcastF95Downloads();
  return { success: true, id: context.id, actionUrl: targetUrl, hostLabel };
});

/**
 * Let the user pick the package they downloaded themselves; the install
 * then continues in the background exactly like an app download.
 */
ipcMain.handle("install-f95-download-from-file", async (event, id) => {
  const found = findF95DownloadForManualStep(id);
  if (!found.context) {
    return { success: false, error: found.error };
  }
  const { context } = found;
  const dialogOptions = {
    title: `Pick the file you downloaded for ${context.metadata.title}`,
    defaultPath: app.getPath("downloads"),
    buttonLabel: "Install",
    properties: /** @type {Array<"openFile">} */ (["openFile"]),
    filters: [
      { name: "Game archives and installers", extensions: MANUAL_PACKAGE_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  };
  const picked = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (picked.canceled || !picked.filePaths?.length) {
    return { success: false, cancelled: true };
  }

  // The entry may have moved on while the dialog was open.
  const recheck = findF95DownloadForManualStep(id);
  if (!recheck.context) {
    return { success: false, error: recheck.error };
  }

  let inspected;
  try {
    inspected = await inspectManualPackage(picked.filePaths[0]);
  } catch (error) {
    return { success: false, error: describeManualPackageError(error) };
  }

  void installF95PackageFromFile(context, inspected);
  return {
    success: true,
    queued: true,
    id: context.id,
    fileName: inspected.fileName,
  };
});

ipcMain.handle("clear-f95-download-history", async () => {
  const retained = f95DownloadsStore
    .list()
    .filter((entry) => entry.packagePath && !isActiveStatus(entry.status));
  const removedIds = f95DownloadsStore.clearHistory();
  for (const removedId of removedIds) {
    const context = f95DownloadContexts.get(removedId);
    releaseF95DownloadPath(context);
    f95DownloadContexts.delete(removedId);
  }
  for (const entry of retained) {
    if (removedIds.includes(entry.id)) {
      removeF95RetainedPackage(entry);
    }
  }
  broadcastF95Downloads();
  return { success: true, removed: removedIds.length };
});

ipcMain.handle("show-f95-download-in-folder", async (event, id) => {
  try {
    const downloadId = String(id || "").trim();
    const context = f95DownloadContexts.get(downloadId);
    const entry = f95DownloadsStore.get(downloadId);
    const candidatePaths = [
      entry?.packagePath || "",
      context?.targetPath || "",
      context?.targetPath ? `${context.targetPath}.part` : "",
    ].filter(Boolean);

    for (const candidatePath of candidatePaths) {
      if (fs.existsSync(candidatePath)) {
        shell.showItemInFolder(candidatePath);
        return { success: true };
      }
    }

    await fs.promises.mkdir(downloadsDir, { recursive: true });
    const openError = await shell.openPath(downloadsDir);
    if (openError) {
      return { success: false, error: openError };
    }
    return { success: true };
  } catch (error) {
    console.error("[f95.download] Failed to reveal download:", error);
    return {
      success: false,
      error: getErrorMessage(error, "Failed to open the downloads folder."),
    };
  }
});

ipcMain.handle("get-scan-sources", async () => {
  return listScanSources(appPaths);
});

ipcMain.handle("add-scan-source", async (event, sourcePath) => {
  return createScanSource(appPaths, sourcePath);
});

ipcMain.handle("update-scan-source", async (event, params) => {
  return patchScanSource(appPaths, params);
});

ipcMain.handle("remove-scan-source", async (event, sourceId) => {
  return deleteScanSource(appPaths, sourceId);
});

ipcMain.handle("get-scan-jobs", async (event, limit) => {
  return {
    success: true,
    jobs: await getRecentScanJobs(
      appPaths,
      typeof limit === "number" ? limit : 10,
    ),
  };
});

ipcMain.handle("get-scan-candidates", async (event, limit) => {
  return {
    success: true,
    candidates: await getRecentScanCandidates(
      appPaths,
      typeof limit === "number" ? limit : 20,
    ),
  };
});

ipcMain.handle("open-importer", async () => {
  console.log("IPC open-importer called");
  try {
    createImporterWindow();
    return { success: true };
  } catch (err) {
    console.error("Error in open-importer:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("start-scan", async (event, params) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const sessionResult = beginScanSession(event.sender, "importer_single_scan");

  if (!sessionResult.success) {
    return sessionResult;
  }

  try {
    let atlasMatcher = null;
    try {
      if (databaseConnection) {
        atlasMatcher = await createAtlasScanMatcher(databaseConnection);
      }
    } catch (matcherError) {
      console.error(
        "Failed to build catalog matcher for importer scan:",
        matcherError,
      );
    }

    return await startScan(
      {
        ...params,
        atlasMatcher,
        scanSession: sessionResult.session,
      },
      window,
    );
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    endScanSession(event.sender);
  }
});

ipcMain.handle("start-scan-sources", async (event, params) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const sessionResult = beginScanSession(event.sender, "importer_sources_scan");

  if (!sessionResult.success) {
    return sessionResult;
  }

  try {
    return await startEnabledSourcesScan(window, appPaths, {
      ...params,
      scanSession: sessionResult.session,
    });
  } catch (err) {
    console.error("Error in start-scan-sources:", err);
    return { success: false, error: err.message };
  } finally {
    endScanSession(event.sender);
  }
});

ipcMain.handle("cancel-scan", async (event) => {
  const result = cancelScanSession(event.sender);

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    cancelled: true,
  };
});

ipcMain.handle("get-steam-game-data", async (event, steamId) => {
  return await getSteamGameData(steamId);
});

ipcMain.handle("search-atlas", async (event, params) => {
  return await searchAtlas(params.title, params.creator);
});

ipcMain.handle("search-site-catalog", async (event, params) => {
  try {
    return await searchSiteCatalog(params?.filters || {}, {
      limit: params?.limit,
    });
  } catch (err) {
    console.error("Error in search-site-catalog:", err);
    return {
      results: [],
      total: 0,
      limit: Number(params?.limit) || 120,
      limited: false,
      error: err.message,
    };
  }
});

ipcMain.handle("search-atlas-by-f95-id", async (event, f95Id) => {
  console.log(`IPC search-atlas-by-f95-id received f95Id: ${f95Id}`);
  try {
    const result = await searchAtlasByF95Id(f95Id);
    console.log(
      `IPC search-atlas-by-f95-id result for ${f95Id}: ${JSON.stringify(result)}`,
    );
    return result;
  } catch (err) {
    console.error(`Error in search-atlas-by-f95-id for ${f95Id}:`, err);
    return [];
  }
});

ipcMain.handle("add-atlas-mapping", async (event, { recordId, atlasId }) => {
  try {
    return await addAtlasMapping(recordId, atlasId);
  } catch (err) {
    console.error("Error in add-atlas-mapping:", err);
    return [];
  }
});

ipcMain.handle("find-f95-id", async (event, atlasId) => {
  try {
    return await findF95Id(atlasId);
  } catch (err) {
    console.error("Error in find-f95-id:", err);
    return "";
  }
});

ipcMain.handle("get-atlas-data", async (event, atlasId) => {
  try {
    return await getAtlasData(atlasId);
  } catch (err) {
    console.error("Error in get-atlas-data:", err);
    return {};
  }
});

ipcMain.handle(
  "check-record-exist",
  async (event, { title, creator, engine, version, path }) => {
    try {
      const existsByDetails = await checkRecordExist(
        title,
        creator,
        engine,
        version,
        path,
      );
      if (existsByDetails) return true;
      return await checkPathExist(path, title);
    } catch (err) {
      console.error("check-record-exist error:", err);
      return false;
    }
  },
);

ipcMain.handle("log", async (event, message) => {
  console.log(`Renderer: ${message}`);
});

ipcMain.handle("update-progress", async (event, progress) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.webContents.send("update-progress", progress);
  }
});

// Banner Template Handlers
ipcMain.handle("get-available-banner-templates", async () => {
  try {
    if (!fs.existsSync(appPaths.bannerTemplates)) {
      fs.mkdirSync(appPaths.bannerTemplates, { recursive: true });
      console.log(`Created templates directory: ${appPaths.bannerTemplates}`);
    }
    const files = fs
      .readdirSync(appPaths.bannerTemplates)
      .filter((file) => file.endsWith(".js"));
    return files.map((file) => path.basename(file, ".js"));
  } catch (err) {
    console.error("Error reading templates directory:", err);
    return [];
  }
});

function readLegacyBannerTemplate() {
  try {
    if (!fs.existsSync(configPath)) {
      return "";
    }
    const match = fs
      .readFileSync(configPath, "utf-8")
      .match(/^bannerTemplate=(.*)$/m);
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

ipcMain.handle("get-selected-banner-template", async () => {
  return (
    String(appConfig?.Appearance?.bannerTemplate || "").trim() ||
    readLegacyBannerTemplate() ||
    "Default"
  );
});

ipcMain.handle("set-selected-banner-template", async (event, template) => {
  try {
    const requested = String(template || "").trim() || "Default";
    const available = fs.existsSync(appPaths.bannerTemplates)
      ? fs
          .readdirSync(appPaths.bannerTemplates)
          .filter((file) => file.endsWith(".js"))
          .map((file) => path.basename(file, ".js"))
      : [];
    if (requested !== "Default" && !available.includes(requested)) {
      return { success: false, error: "This banner template was not found." };
    }

    appConfig = {
      ...(appConfig || defaultConfig),
      Appearance: {
        ...(appConfig?.Appearance || {}),
        bannerTemplate: requested,
      },
    };
    saveConfig();
    broadcastSettingsChanged();
    return { success: true };
  } catch (err) {
    console.error("Error saving selected banner template:", err);
    return { success: false, error: err.message };
  }
});

// Open external URL
ipcMain.handle("open-external-url", async (event, url) => {
  try {
    if (!url || typeof url !== "string" || !url.startsWith("http")) {
      console.warn("Invalid URL attempted to open:", url);
      return { success: false, error: "Invalid URL" };
    }
    await shell.openExternal(url);
    console.log("Opened external URL:", url);
    return { success: true };
  } catch (err) {
    console.error("Error opening external URL:", url, err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("open-f95-browser-url", async (_, payload) => {
  try {
    const targetUrl = String(payload?.url || "").trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      return { success: false, error: "Invalid browser URL." };
    }

    createF95BrowserWindow({
      BrowserWindow,
      appConfig,
      url: targetUrl,
      title: String(payload?.title || "F95 Browser"),
      reuseKey: "__f95BrowserWindow",
      onNavigation: broadcastF95BrowserNavigation,
    });

    return { success: true };
  } catch (error) {
    console.error("[f95.browser] Failed to open browser window:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// Default game folder management
ipcMain.handle("get-default-game-folder", async () => {
  return appConfig?.Library?.gameFolder || null;
});

ipcMain.handle("set-default-game-folder", async (event, newPath) => {
  const requestedPath = String(newPath || "").trim();
  if (!requestedPath || !path.isAbsolute(requestedPath)) {
    return { success: false, error: "Choose a full folder path." };
  }

  try {
    const insight = await inspectFolder(requestedPath, getFolderInsightDeps());
    if (insight.status === "error") {
      return {
        success: false,
        error: insight.warnings[0]?.message || "This folder can't be used.",
        insight,
      };
    }

    await fs.promises.mkdir(insight.path, { recursive: true });
    appConfig = applySettingsPatch(appConfig || defaultConfig, "Library", {
      gameFolder: insight.path,
    });
    saveConfig();
    broadcastSettingsChanged();
    return {
      success: true,
      path: insight.path,
      insight: { ...insight, exists: true },
    };
  } catch (err) {
    console.error("Failed to save default game folder:", err);
    return {
      success: false,
      error: getErrorMessage(err, "Failed to save the games folder."),
    };
  }
});

ipcMain.handle("save-emulator-config", async (event, emulator) => {
  try {
    await initializeDatabase(appPaths);
    await saveEmulatorConfig(emulator);
    return { success: true };
  } catch (err) {
    console.error("Error saving emulator config:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-emulator-config", async () => {
  try {
    await initializeDatabase(appPaths);
    return await getEmulatorConfig();
  } catch (err) {
    console.error("Error fetching emulator config:", err);
    return [];
  }
});

ipcMain.handle("remove-emulator-config", async (event, extension) => {
  try {
    await initializeDatabase(appPaths);
    await removeEmulatorConfig(extension);
    return { success: true };
  } catch (err) {
    console.error("Error removing emulator config:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("show-context-menu", (event, template) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) {
    console.error("No sender window found for context menu");
    return;
  }

  const processedTemplate = processTemplate(template, event.sender);
  const menu = Menu.buildFromTemplate(processedTemplate);
  menu.popup({ window: senderWindow });
});

ipcMain.handle("get-previews", async (event, recordId) => {
  console.log("Handling get-previews for recordId:", recordId);
  try {
    const previews = await getPreviews(recordId, appPaths);
    return Array.isArray(previews) ? previews : [];
  } catch (err) {
    console.error("Error fetching preview URLs:", err);
    return [];
  }
});

ipcMain.handle("update-banners", async (event, recordId) => {
  console.log("Handling update-banners for recordId:", recordId);
  try {
    const atlas_id = await GetAtlasIDbyRecord(recordId);
    await downloadImages(recordId, atlas_id, () => {}, true, false, 1, false);

    const bannerPath = await getBanner(recordId, appPaths, "large");
    event.sender.send("game-updated", recordId);
    return bannerPath;
  } catch (err) {
    console.error("Error downloading banner:", err);
    throw err;
  }
});

ipcMain.handle("update-previews", async (event, recordId) => {
  console.log("Handling update-previews for recordId:", recordId);
  try {
    const atlasId = await GetAtlasIDbyRecord(recordId);
    await downloadImages(
      recordId,
      atlasId,
      () => {},
      false,
      true,
      DEFAULT_PREVIEW_LIMIT,
      false,
    );

    const previewUrls = await getPreviews(recordId, appPaths);
    event.sender.send("game-updated", recordId);
    return Array.isArray(previewUrls) ? previewUrls : [];
  } catch (err) {
    console.error("Error downloading previews:", err);
    throw err;
  }
});

ipcMain.handle("refresh-library-previews", async (event) => {
  try {
    return await refreshLibraryPreviewsInternal(event.sender);
  } catch (error) {
    console.error("Error refreshing library screenshots:", error);
    return {
      success: false,
      totalGames: 0,
      processed: 0,
      refreshed: 0,
      skipped: 0,
      failed: 0,
      error: error.message,
    };
  }
});

ipcMain.handle(
  "convert-and-save-banner",
  async (event, { recordId, filePath }) => {
    console.log(
      "Handling convert-and-save-banner for recordId:",
      recordId,
      "filePath:",
      filePath,
    );
    try {
      const outputPath = path.join(imagesDir, `${recordId}`, "banner_sc.webp");
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      await sharp(filePath).webp({ quality: 80 }).toFile(outputPath);
      console.log("Banner converted and saved:", outputPath);
      return `file://${outputPath.replace(/\\/g, "/")}`;
    } catch (err) {
      console.error("Error converting and saving banner:", err);
      throw err;
    }
  },
);

// Edits the stored title / creator / engine of a library record (details
// panel "Edit"). Returns { success, error? } instead of throwing.
ipcMain.handle("update-game", async (event, game) => {
  const recordId = Number(game?.record_id);
  const title = typeof game?.title === "string" ? game.title.trim() : "";
  const creator = typeof game?.creator === "string" ? game.creator.trim() : "";
  const engine = typeof game?.engine === "string" ? game.engine.trim() : "";
  if (!Number.isInteger(recordId) || recordId <= 0 || !title) {
    return { success: false, error: "Enter a title for this game." };
  }
  if (title.length > 300 || creator.length > 300 || engine.length > 100) {
    return { success: false, error: "One of the values is too long." };
  }

  try {
    await updateGame({
      record_id: recordId,
      title,
      creator: creator || "Unknown",
      engine: engine || "Unknown",
    });
    mainWindow?.webContents.send("game-updated", recordId);
    return { success: true };
  } catch (err) {
    console.error("[library.details] Error updating game:", err);
    const isDuplicate = /UNIQUE constraint failed/i.test(String(err?.message || ""));
    return {
      success: false,
      error: isDuplicate
        ? "Another game in your library already has this title, creator and engine."
        : "The changes could not be saved. Try again.",
    };
  }
});

ipcMain.handle("update-version", async (event, version, record_id) => {
  console.log("Handling update-version:", version);
  try {
    await updateVersion(version, record_id);
    console.log("Version updated in database");
  } catch (err) {
    console.error("Error updating version:", err);
    throw err;
  }
});

ipcMain.handle("delete-banner", async (event, recordId) => {
  await initializeDatabase(appPaths);
  console.log("Handling delete-banner for recordId:", recordId);
  try {
    await deleteBanner(recordId, appPaths);
    mainWindow.webContents.send("game-updated", recordId);
    return { success: true };
  } catch (err) {
    console.error("Error deleting banner:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("delete-previews", async (event, recordId) => {
  await initializeDatabase(appPaths);
  console.log("Handling delete-previews for recordId:", recordId);
  try {
    await deletePreviews(recordId, appPaths);
    mainWindow.webContents.send("game-updated", recordId);
    return { success: true };
  } catch (err) {
    console.error("Error deleting previews:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("open-directory", async (event, path) => {
  try {
    console.log("Opening directory:", path);
    const targetPath =
      path && fs.existsSync(path) && fs.statSync(path).isDirectory()
        ? path
        : require("path").dirname(path);
    await shell.openPath(targetPath);
    return { success: true };
  } catch (err) {
    console.error("Error opening directory:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("launch-game", async (_, payload) => {
  try {
    await launchGame(payload || {});
    // Games run outside the app: watch their save folders and back up once
    // they go quiet after a change.
    saveStorage?.watchAfterLaunch(payload?.recordId);
    return { success: true };
  } catch (error) {
    console.error("Error launching game:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("get-steam-data", async (event, steam_id) => {
  console.log("Handling get-steam-data:", steam_id);
  try {
    await getSteamGameData(steam_id);
    console.log("Steam Game data updated in database");
  } catch (err) {
    console.error("Error updating Steam Game Data:", err);
    throw err;
  }
});

ipcMain.handle("find-steam-id", async (event, title, developer) => {
  console.log("Handling find-steam-id:", title, developer);
  try {
    await findSteamId(title, developer);
    console.log("Steam Game id found");
  } catch (err) {
    console.error("Error checking Steam ID:", err);
    throw err;
  }
});

ipcMain.handle("start-steam-scan", async (event, params) => {
  return await startSteamScan(getDb(), params, event);
});

ipcMain.handle("select-steam-directory", async () => {
  console.log("IPC select-steam-directory called");
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Steam Directory",
      defaultPath: path.join("C:", "Program Files (x86)", "Steam"),
    });
    if (result.canceled) {
      console.log("User canceled Steam directory selection");
      return null;
    }
    const selectedPath = result.filePaths[0];
    console.log(`User selected Steam directory: ${selectedPath}`);
    return selectedPath;
  } catch (err) {
    console.error("Error selecting Steam directory:", err);
    return null;
  }
});

// ────────────────────────────────────────────────
// FAST CROSS-DEVICE COPY WITH BATCHED PROGRESS & RATE
// ────────────────────────────────────────────────

async function copyFolderWithProgress(source, destination, onProgress) {
  let totalBytes = 0;
  let copiedBytes = 0;
  let lastReportedPercent = 0;
  let startTime = Date.now();
  let lastCopiedBytes = 0;

  const MAX_CONCURRENT = 32; // Tune this: 16–64 depending on system
  const RETRY_DELAY = 100; // ms
  const MAX_RETRIES = 5;

  // Calculate total size
  async function calculateSize(dir) {
    const stat = await fs.promises.stat(dir);
    if (stat.isFile()) {
      totalBytes += stat.size;
      return;
    }
    const files = await fs.promises.readdir(dir);
    await Promise.all(files.map((file) => calculateSize(path.join(dir, file))));
  }

  await calculateSize(source);
  onProgress?.({ type: "total", bytes: totalBytes });

  // Queue-based concurrent copy
  async function copyRecursive(src, dest) {
    const stat = await fs.promises.stat(src);
    if (stat.isDirectory()) {
      await fs.promises.mkdir(dest, { recursive: true });
      const files = await fs.promises.readdir(src);
      // Process in batches to limit concurrency
      for (let i = 0; i < files.length; i += MAX_CONCURRENT) {
        const batch = files.slice(i, i + MAX_CONCURRENT);
        await Promise.all(
          batch.map((file) =>
            copyRecursive(path.join(src, file), path.join(dest, file)),
          ),
        );
      }
    } else {
      // File copy with retry on EMFILE
      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          return await new Promise((resolve, reject) => {
            const readStream = fs.createReadStream(src);
            const writeStream = fs.createWriteStream(dest);

            readStream.on("data", (chunk) => {
              copiedBytes += chunk.length;

              const currentPercent = Math.floor(
                (copiedBytes / totalBytes) * 100,
              );
              const now = Date.now();

              if (currentPercent > lastReportedPercent) {
                const elapsed = (now - startTime) / 1000;
                const currentSpeed =
                  elapsed > 0 ? (copiedBytes - lastCopiedBytes) / elapsed : 0;
                const speedText =
                  currentSpeed > 1024 * 1024 * 1024
                    ? `${(currentSpeed / 1024 ** 3).toFixed(2)} GB/s`
                    : currentSpeed > 1024 * 1024
                      ? `${(currentSpeed / 1024 ** 2).toFixed(1)} MB/s`
                      : `${(currentSpeed / 1024).toFixed(1)} KB/s`;

                onProgress?.({
                  type: "progress",
                  percent: currentPercent,
                  copied: copiedBytes,
                  total: totalBytes,
                  speed: speedText,
                });

                lastReportedPercent = currentPercent;
                lastCopiedBytes = copiedBytes;
              }
            });

            readStream.on("end", () => resolve());
            readStream.on("error", reject);
            writeStream.on("error", reject);

            readStream.pipe(writeStream);
          });
        } catch (err) {
          if (err.code === "EMFILE" && retries < MAX_RETRIES) {
            retries++;
            console.warn(`EMFILE retry ${retries}/${MAX_RETRIES} for ${src}`);
            await new Promise((r) => setTimeout(r, RETRY_DELAY * retries)); // exponential backoff
            continue;
          }
          throw err;
        }
      }
    }
  }

  try {
    await copyRecursive(source, destination);
    const finalPercent = 100;
    const totalElapsed = (Date.now() - startTime) / 1000;
    const avgSpeed = totalElapsed > 0 ? copiedBytes / totalElapsed : 0;
    const avgSpeedText =
      avgSpeed > 1024 * 1024 * 1024
        ? `${(avgSpeed / 1024 ** 3).toFixed(2)} GB/s`
        : avgSpeed > 1024 * 1024
          ? `${(avgSpeed / 1024 ** 2).toFixed(1)} MB/s`
          : `${(avgSpeed / 1024).toFixed(1)} KB/s`;

    onProgress?.({
      type: "done",
      percent: finalPercent,
      copied: copiedBytes,
      total: totalBytes,
      speed: avgSpeedText,
    });
  } catch (err) {
    console.error("Copy failed:", err);
    onProgress?.({ type: "error", message: err.message });
    throw err;
  }
}

// ────────────────────────────────────────────────
// IMPORT GAMES HANDLER
// ────────────────────────────────────────────────

const importGamesInternal = async (params) => {
  const {
    games,
    deleteAfter,
    scanSize,
    downloadBannerImages,
    downloadPreviewImages,
    previewLimit,
    downloadVideos,
    gameExt,
    moveToDefaultFolder = false,
    format = "",
  } = params;

  const gamesDir = appPaths.games;
  if (!fs.existsSync(gamesDir)) fs.mkdirSync(gamesDir, { recursive: true });

  const total = games.length;
  let progress = 0;

  mainWindow.webContents.send("import-progress", {
    text: `Starting import of ${total} games...`,
    progress,
    total,
  });

  let targetLibrary = null;
  if (moveToDefaultFolder) {
    targetLibrary = appConfig?.Library?.gameFolder;
    if (!targetLibrary || !fs.existsSync(targetLibrary)) {
      console.warn("Move requested but no valid default library folder set");
      mainWindow.webContents.send("import-warning", {
        message: "Move to library skipped — no default folder configured",
      });
    }
  }

  const results = [];
  const existingGamesByPath = buildLibraryPathIndex(
    await getGames(appPaths, 0, null),
  );

  for (const game of games) {
    try {
      let resolvedGame = { ...game };

      mainWindow.webContents.send("import-progress", {
        text: `Importing game '${resolvedGame.title}' ${progress + 1}/${total}`,
        progress,
        total,
      });

      if (resolvedGame.atlasId) {
        try {
          const atlasData = await getAtlasData(resolvedGame.atlasId);
          resolvedGame = mergeImportedGameMetadata(resolvedGame, atlasData);
        } catch (metadataError) {
          console.warn("Failed to enrich imported game metadata from the catalog:", {
            atlasId: resolvedGame.atlasId,
            error:
              metadataError instanceof Error
                ? metadataError.message
                : String(metadataError),
          });
        }
      }

      let gamePath = resolvedGame.folder;
      let execPath = resolvedGame.selectedValue
        ? path.join(gamePath, game.selectedValue)
        : "";
      let size = 0;

      // ── Structured move if requested ──
      // ── Structured move if requested ──
      if (moveToDefaultFolder && targetLibrary && format.trim()) {
        try {
          const formatStr = format.trim();
          const parts = formatStr
            .split("/")
            .map((p) => p.replace(/[{}]/g, "").trim());

          const pathSegments = [];
          for (const part of parts) {
            let value = "";
            if (part.toLowerCase() === "creator")
              value = resolvedGame.creator || "Unknown";
            else if (part.toLowerCase() === "title")
              value = resolvedGame.title || "Untitled";
            else if (part.toLowerCase() === "version")
              value = resolvedGame.version || "v1";
            else if (part.toLowerCase() === "engine")
              value = resolvedGame.engine || "Unknown";
            else value = "Unknown";

            value = value
              .replace(/[/\\:*?"<>|]/g, "_")
              .replace(/\s+/g, " ")
              .trim();

            if (!value || value === ".") value = "Unknown";

            pathSegments.push(value);
          }

          const relativeDest = path.join(...pathSegments);
          let destPath = path.join(targetLibrary, relativeDest);

          // Handle name conflict
          let counter = 1;
          const originalDest = destPath;
          while (fs.existsSync(destPath)) {
            destPath = `${originalDest} (${counter++})`;
          }

          await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

          // Preserve ORIGINAL source path
          const originalSource = gamePath;

          let copySuccess = false;

          // Copy with progress
          await copyFolderWithProgress(originalSource, destPath, (prog) => {
            let text = `Moving ${resolvedGame.title}`;
            if (prog.type === "total") {
              text += ` (${(prog.bytes / 1024 ** 3).toFixed(2)} GB total)`;
            } else if (prog.type === "progress") {
              text += `: ${prog.percent}% (${(prog.copied / 1024 ** 3).toFixed(2)} / ${(prog.total / 1024 ** 3).toFixed(2)} GB)`;
            } else if (prog.type === "done") {
              text += ` — complete`;
              copySuccess = true; // Flag success for delete
            } else if (prog.type === "error") {
              text += ` — error: ${prog.message}`;
              copySuccess = false;
            }

            mainWindow.webContents.send("import-progress", {
              text,
              progress,
              total,
              subProgress: prog.percent || 0,
              subTotal: 100,
            });
          });

          // Only delete if copy reached 100% success
          if (deleteAfter && copySuccess) {
            try {
              if (
                await fs.promises
                  .access(originalSource)
                  .then(() => true)
                  .catch(() => false)
              ) {
                await fs.promises.rm(originalSource, {
                  recursive: true,
                  force: true,
                });
                console.log(
                  `Deleted original source after 100% copy: ${originalSource}`,
                );
                mainWindow.webContents.send("import-progress", {
                  text: `Moved ${resolvedGame.title} and deleted original folder`,
                  progress,
                  total,
                });
              } else {
                console.log(`Original source already gone: ${originalSource}`);
              }
            } catch (delErr) {
              console.error(
                `Failed to delete original source ${originalSource}:`,
                delErr,
              );
              mainWindow.webContents.send("import-progress", {
                text: `Moved ${resolvedGame.title} but failed to delete original: ${delErr.message}`,
                progress,
                total,
              });
            }
          } else if (deleteAfter && !copySuccess) {
            console.log(
              `Delete skipped — copy was not 100% successful for ${resolvedGame.title}`,
            );
            mainWindow.webContents.send("import-progress", {
              text: `Moved ${resolvedGame.title} (partial copy — original kept)`,
              progress,
              total,
            });
          } else {
            mainWindow.webContents.send("import-progress", {
              text: `Moved ${resolvedGame.title} (original kept)`,
              progress,
              total,
            });
          }

          // Update gamePath to new location for DB
          gamePath = destPath;
          execPath = path.join(gamePath, resolvedGame.selectedValue || "");

          console.log(`Moved ${resolvedGame.title} to: ${destPath}`);
        } catch (moveErr) {
          console.error("Structured move failed:", moveErr);
          mainWindow.webContents.send("import-progress", {
            text: `Move failed for ${resolvedGame.title}: ${moveErr.message}`,
            progress,
            total,
          });
        }
      }
      if (resolvedGame.isArchive) {
        const extractPath = path.join(
          gamesDir,
          `${resolvedGame.title}-${resolvedGame.version}`,
        );
        if (!fs.existsSync(extractPath))
          fs.mkdirSync(extractPath, { recursive: true });
        const extractionResult = await extractArchiveSafely({
          archivePath: resolvedGame.folder,
          destinationPath: extractPath,
        });
        if (!extractionResult.success) {
          throw new Error(extractionResult.error);
        }
        if (deleteAfter) fs.unlinkSync(resolvedGame.folder);
        gamePath = extractPath;

        const execs = findExecutables(extractPath, gameExt);
        if (execs.length > 0) {
          const detection = detectGameEngine(extractPath, { executables: execs });
          const selected = selectPreferredExecutable(execs, {
            title: resolvedGame.title,
            creator: resolvedGame.creator,
            preferredExecutables: detection.preferredExecutables,
            ignoredExecutables: detection.ignoredExecutables,
          });
          execPath = path.join(extractPath, selected);
          if (detection.engine) {
            resolvedGame.engine = detection.engine;
          }
          resolvedGame.executables = execs.map((e) => ({ key: e, value: e }));
          resolvedGame.selectedValue = selected;
        }
      }

      if (scanSize) {
        size = await getFolderSizeAsync(gamePath);
      }

      const add = {
        title: resolvedGame.title,
        creator: resolvedGame.creator,
        engine: resolvedGame.engine,
        description: resolvedGame.description || "Imported game",
      };
      const versionPayload = {
        ...resolvedGame,
        folder: gamePath,
        execPath,
        folderSize: size,
      };
      const existingGame = findPreferredGameByPath(
        existingGamesByPath,
        gamePath,
      );
      let recordId;

      if (existingGame?.record_id) {
        console.log("Updating existing game for imported path");
        // A rescan must not downgrade a record that already has good
        // metadata (catalog match, user edits) just because the folder name
        // parses badly; the folder's files and version are still refreshed.
        const refreshed = mergeRefreshedGameMetadata(existingGame, {
          ...resolvedGame,
          folder: gamePath,
        });
        add.title = refreshed.title;
        add.creator = refreshed.creator;
        add.engine = refreshed.engine;
        versionPayload.version = refreshed.version;
        resolvedGame.version = refreshed.version;
        await updateGame({
          record_id: existingGame.record_id,
          title: add.title,
          creator: add.creator,
          engine: add.engine,
        });
        await deleteVersionsForRecordPath(existingGame.record_id, gamePath);
        await addVersion(versionPayload, existingGame.record_id);
        recordId = existingGame.record_id;
      } else {
        console.log("Adding Game");
        recordId = await addGame(add);
        console.log("game added");
        console.log("adding version");
        await addVersion(versionPayload, recordId);
      }
      console.log("added version");
      existingGamesByPath.set(normalizePathKey(gamePath), [
        {
          record_id: recordId,
          title: add.title,
          creator: add.creator,
          engine: add.engine,
          atlas_id: resolvedGame.atlasId || existingGame?.atlas_id || null,
          f95_id: resolvedGame.f95Id || existingGame?.f95_id || null,
          versions: [{ game_path: gamePath }],
        },
      ]);
      try {
        await markImportedCandidate(appPaths, resolvedGame.folder, recordId);
      } catch (scanCandidateErr) {
        console.warn("Failed to mark scan candidate as imported:", {
          folder: resolvedGame.folder,
          recordId,
          error:
            scanCandidateErr instanceof Error
              ? scanCandidateErr.message
              : String(scanCandidateErr),
        });
      }
      console.log("adding mapping");
      console.log("recordId:", recordId, "atlasId:", resolvedGame.atlasId);
      if (
        resolvedGame.atlasId &&
        existingGame?.atlas_id !== resolvedGame.atlasId
      ) {
        try {
          await addAtlasMapping(recordId, resolvedGame.atlasId);
          console.log("mapping added");
        } catch (err) {
          console.warn("Failed to add catalog mapping:", err);
        }
      }

      if (resolvedGame.f95Id || resolvedGame.siteUrl) {
        const resolvedF95Id =
          resolvedGame.f95Id || extractF95IdFromUrl(resolvedGame.siteUrl);
        if (resolvedF95Id) {
          await upsertF95ZoneMapping(
            recordId,
            resolvedF95Id,
            resolvedGame.siteUrl || "",
          );
        }
      }

      if (databaseConnection && existingGame?.record_id) {
        await refreshSaveProfiles(appPaths, databaseConnection, recordId).catch(
          (error) => {
            console.warn(
              "[save.profiles] Failed to refresh save profiles after import update:",
              error,
            );
          },
        );
        scheduleCloudSaveReconcile(recordId, "post-import-update");
      }

      if (size > 0)
        await updateFolderSize(recordId, resolvedGame.version, size);
      results.push({
        success: true,
        recordId,
        atlasId: resolvedGame.atlasId,
        title: resolvedGame.title,
      });
      mainWindow.webContents.send("game-imported", recordId);

      progress++;
      mainWindow.webContents.send("import-progress", {
        text: `Imported game '${resolvedGame.title}' ${progress}/${total}`,
        progress,
        total,
      });
    } catch (err) {
      console.error("Error importing game:", err);
      results.push({ success: false, error: err.message });
      progress++;
      mainWindow.webContents.send("import-progress", {
        text: `Error importing game '${game.title || "Unknown"}' ${progress}/${total}: ${err.message}`,
        progress,
        total,
      });
    }
  }

  mainWindow.webContents.send("import-progress", {
    text: `Game import complete: ${results.filter((r) => r.success).length} successful`,
    progress,
    total,
  });
  mainWindow.webContents.send("import-complete");

  // Phase 2: Image downloads
  if (downloadBannerImages || downloadPreviewImages) {
    progress = 0;
    const gamesWithImages = results
      .filter((r) => r.success && r.atlasId)
      .map((r) => ({
        title: r.title || "Unknown Game",
        atlasId: r.atlasId,
        recordId: r.recordId,
      }));
    const imageTotal = gamesWithImages.length;

    mainWindow.webContents.send("import-progress", {
      text: `Starting image download for ${imageTotal} games...`,
      progress,
      total: imageTotal,
    });

    for (const game of gamesWithImages) {
      try {
        const bannerUrl = await getBannerUrl(game.atlasId);
        const screenUrls = await getScreensUrlList(game.atlasId);
        const previewCount = downloadPreviewImages
          ? resolvePreviewDownloadCount(previewLimit, screenUrls.length)
          : 0;
        const totalImages =
          (downloadBannerImages && bannerUrl ? 2 : 0) + previewCount;

        mainWindow.webContents.send("import-progress", {
          text: `Downloading images for '${game.title}' ${progress + 1}/${imageTotal}, 0/${totalImages}`,
          progress,
          total: imageTotal,
        });

        await downloadImages(
          game.recordId,
          game.atlasId,
          (current, totalImages) => {
            mainWindow.webContents.send("import-progress", {
              text: `Downloading images for '${game.title}' ${progress + 1}/${imageTotal}, ${current}/${totalImages}`,
              progress,
              total: imageTotal,
            });
          },
          downloadBannerImages,
          downloadPreviewImages,
          previewLimit,
          downloadVideos,
        );

        mainWindow.webContents.send("game-updated", game.recordId);

        progress++;
        mainWindow.webContents.send("import-progress", {
          text: `Completed image download for '${game.title}' ${progress}/${imageTotal}, ${totalImages} images downloaded`,
          progress,
          total: imageTotal,
        });
      } catch (err) {
        console.error("Error downloading images for game:", err);
        progress++;
        mainWindow.webContents.send("import-progress", {
          text: `Error downloading images for '${game.title}' ${progress}/${imageTotal}: ${err.message}`,
          progress,
          total: imageTotal,
        });
      }
    }

    mainWindow.webContents.send("import-progress", {
      text: `Image download complete for ${progress} games`,
      progress,
      total: imageTotal,
    });
  }

  mainWindow.webContents.send("import-complete");
  return results;
};

async function runLibraryDuplicateCleanup() {
  const cleanup = await reconcileLibraryDuplicateGamePaths({
    appPaths,
    getGames,
    deleteGameCompletely,
    dryRun: false,
  });

  if (cleanup.removed.length > 0) {
    mainWindow.webContents.send("import-progress", {
      text: `Cleaned up ${cleanup.removed.length} duplicate library record(s) with identical install paths.`,
      progress: 0,
      total: 0,
    });
  }

  if (cleanup.failed.length > 0) {
    console.warn(
      "[library.duplicates] Failed to remove some duplicate records",
      {
        failed: cleanup.failed,
      },
    );
    mainWindow.webContents.send("import-warning", {
      message: `Failed to clean up ${cleanup.failed.length} duplicate library record(s).`,
    });
  }

  return cleanup;
}

ipcMain.handle("import-games", async (event, params) => {
  return importGamesInternal(params);
});

function getDefaultLibraryScanParams() {
  const librarySettings = appConfig?.Library || {};

  return {
    format: "",
    gameExt: (
      librarySettings.gameExtensions || "exe,swf,flv,f4v,rag,cmd,bat,jar,html"
    )
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    archiveExt: (librarySettings.extractionExtensions || "zip,7z,rar")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    isCompressed: false,
    deleteAfter: false,
    scanSize: false,
    downloadBannerImages: true,
    downloadPreviewImages: true,
    previewLimit: DEFAULT_PREVIEW_LIMIT,
    downloadVideos: false,
  };
}

function sendLibraryScanProgress(text, progress = 0, total = 1) {
  mainWindow?.webContents.send("import-progress", { text, progress, total });
}

/**
 * Folders the library already owns: a rescan refreshes them in place instead
 * of parking them in the review queue when the catalog match is not confident.
 */
function buildKnownLibraryPathLookup(games) {
  const index = buildLibraryPathIndex(games);
  return (folder) => index.has(normalizePathKey(folder));
}

function buildLibraryScanSummaryText(input) {
  const parts = [];
  if (input.imported > 0) {
    parts.push(`${input.imported} new game(s) added`);
  }
  if (input.importedUnmatched > 0) {
    parts.push(
      `${input.importedUnmatched} of them added without a catalog match`,
    );
  }
  if (input.refreshed > 0) {
    parts.push(`${input.refreshed} installed game(s) refreshed`);
  }
  if (input.reviewQueued > 0) {
    parts.push(`${input.reviewQueued} candidate(s) need review`);
  }
  if (input.duplicateRecordsRemoved > 0) {
    parts.push(`${input.duplicateRecordsRemoved} duplicate(s) cleaned`);
  }
  if (input.missingCount > 0) {
    parts.push(
      `${input.missingCount} library game(s) have missing files (use the "Files missing" filter)`,
    );
  }
  if (input.warningsCount > 0) {
    parts.push(`${input.warningsCount} warning(s)`);
  }
  if (parts.length === 0) {
    parts.push(
      input.scanned > 0
        ? "everything is already up to date"
        : "no new games found",
    );
  }
  return `Scan complete. ${parts.join(", ")}.`;
}

ipcMain.handle("scan-library", async (event, request) => {
  const scanRequest = normalizeLibraryScanRequest(request);

  if (scanRequest.resetLibrary && !scanRequest.confirmed) {
    return {
      success: false,
      error: "Rebuilding the library needs an explicit confirmation.",
      errorCode: "LIBRARY_RESET_NOT_CONFIRMED",
      mode: scanRequest.mode,
      warningsCount: 0,
      imported: 0,
      scanned: 0,
    };
  }

  const sessionResult = beginScanSession(event.sender, "library_scan");

  if (!sessionResult.success) {
    return sessionResult;
  }

  libraryScanInProgress = true;
  const scanRelay = {
    webContents: {
      send(channel, payload) {
        if (channel === "scan-progress") {
          mainWindow.webContents.send("import-progress", {
            text: payload.currentSourcePath
              ? `Scanning source ${payload.currentSourceIndex}/${payload.sourceCount}: ${payload.currentSourcePath}`
              : "Scanning configured sources...",
            progress: payload.value,
            total: payload.total || 1,
          });
          return;
        }

        if (channel === "scan-warning") {
          mainWindow.webContents.send("import-progress", {
            text: payload.message || "Scanner warning",
            progress: 0,
            total: 1,
          });
          return;
        }

        if (channel === "scan-complete" || channel === "scan-complete-final") {
          return;
        }

        mainWindow.webContents.send(channel, payload);
      },
    },
  };

  let libraryReset = null;

  try {
    if (scanRequest.resetLibrary) {
      sendLibraryScanProgress("Backing up and clearing the library index...");

      const resetResult = await resetLibraryIndex({
        appPaths,
        db: databaseConnection,
      });
      if (!resetResult.success) {
        return {
          success: false,
          error: resetResult.error.message,
          errorCode: resetResult.error.code,
          mode: scanRequest.mode,
          warningsCount: 0,
          imported: 0,
          scanned: 0,
        };
      }

      libraryReset = {
        clearedGames: resetResult.cleared.games || 0,
        clearedVersions: resetResult.cleared.versions || 0,
        backupPath: resetResult.backupPath,
      };
      console.log("[library.reset] Library index cleared", {
        ...libraryReset,
        cleared: resetResult.cleared,
        removedImageDirectories: resetResult.removedImageDirectories.length,
      });
      mainWindow?.webContents.send("library-reset", libraryReset);
      broadcastGamesLibrarySynced({ reason: "library-reset" });
      // The live checker keeps the record ids of its last run in memory;
      // after the wipe they belong to nobody (or to new games).
      libraryLiveUpdateChecker?.forget?.();
      sendLibraryScanProgress(
        `Library index cleared: ${libraryReset.clearedGames} game(s) removed, backup saved. Scanning from scratch...`,
      );
    } else if (scanRequest.resetCache) {
      sendLibraryScanProgress("Resetting library scan cache...");

      const resetResult = await resetScanCache(appPaths);
      if (!resetResult.success) {
        return {
          success: false,
          error: resetResult.error.message,
          mode: scanRequest.mode,
          warningsCount: 0,
          imported: 0,
          scanned: 0,
        };
      }

      sendLibraryScanProgress(
        `Library scan cache reset: ${resetResult.clearedCandidates} candidates, ${resetResult.clearedJobs} jobs and ${resetResult.clearedLiveVersions || 0} cached thread versions cleared`,
      );
      mainWindow?.webContents.send("scan-cache-reset", {
        clearedCandidates: resetResult.clearedCandidates,
        clearedJobs: resetResult.clearedJobs,
      });
    }

    const knownPathLookup = scanRequest.forceRescan
      ? buildKnownLibraryPathLookup(await getGames(appPaths, 0, null))
      : null;
    const defaultLibraryScanParams = getDefaultLibraryScanParams();
    const scanResult = await startEnabledSourcesScan(scanRelay, appPaths, {
      ...defaultLibraryScanParams,
      forceRescan: scanRequest.forceRescan,
      scanSession: sessionResult.session,
    });

    if (
      !scanResult.success &&
      (!scanResult.games || scanResult.games.length === 0) &&
      !scanResult.cancelled
    ) {
      // Nothing was imported; the renderer still needs to reload (the index
      // may have been wiped by a rebuild).
      mainWindow?.webContents.send("import-complete");
      broadcastGamesLibrarySynced({ reason: "library-scan" });
      return { ...scanResult, mode: scanRequest.mode, libraryReset };
    }

    if (scanResult.cancelled) {
      sendLibraryScanProgress("Library rescan cancelled");
      mainWindow?.webContents.send("import-complete");
      broadcastGamesLibrarySynced({ reason: "library-scan" });
      return {
        success: false,
        cancelled: true,
        mode: scanRequest.mode,
        warningsCount: scanResult.warningsCount || 0,
        imported: 0,
        scanned: scanResult.games?.length || 0,
        libraryReset,
      };
    }

    const scannedGames = Array.isArray(scanResult.games) ? scanResult.games : [];
    const { importableGames, reviewGames } = splitAutoImportableScanGames(
      scannedGames,
      knownPathLookup ? { isKnownPath: knownPathLookup } : {},
    );

    let importResults = [];
    if (importableGames.length > 0) {
      if (reviewGames.length > 0) {
        sendLibraryScanProgress(
          `${reviewGames.length} candidate(s) need review and will not be auto-imported.`,
          0,
          scannedGames.length,
        );
      }

      importResults = await importGamesInternal({
        games: importableGames,
        deleteAfter: false,
        scanSize: false,
        downloadBannerImages: defaultLibraryScanParams.downloadBannerImages,
        downloadPreviewImages: defaultLibraryScanParams.downloadPreviewImages,
        previewLimit: defaultLibraryScanParams.previewLimit,
        downloadVideos: false,
        gameExt: defaultLibraryScanParams.gameExt,
        moveToDefaultFolder: false,
        format: "",
      });
    } else {
      // importGamesInternal announces "import-complete" itself; without an
      // import the renderer would keep the stale (or wiped) list.
      mainWindow?.webContents.send("import-complete");
    }

    const duplicateCleanup = await runLibraryDuplicateCleanup();
    const presenceCounts = countLibraryInstallStates(await loadLibraryGames());

    let imported = 0;
    let importedUnmatched = 0;
    let refreshed = 0;
    importResults.forEach((result, index) => {
      if (!result?.success) {
        return;
      }
      if (importableGames[index]?.refreshExisting) {
        refreshed += 1;
      } else {
        imported += 1;
        if (importableGames[index]?.importUnmatched) {
          importedUnmatched += 1;
        }
      }
    });
    const duplicateMerges = summarizeDuplicateCleanup(duplicateCleanup);

    const importedAny = importResults.some((result) => result?.success);
    const summary = {
      // A source that failed while others were imported is a partial result,
      // not a failed rebuild: report it as success with a warning text.
      success: scanResult.success || importedAny,
      partialFailure: !scanResult.success && importedAny,
      error:
        !scanResult.success && importedAny
          ? `Some scan sources failed (${scanResult.errorsCount || 0} error(s)); games from the other sources were imported.`
          : scanResult.error || "",
      mode: scanRequest.mode,
      warningsCount: scanResult.warningsCount || 0,
      scanned: scannedGames.length,
      imported,
      importedUnmatched,
      refreshed,
      reviewQueued: reviewGames.length,
      errorsCount: scanResult.errorsCount || 0,
      duplicateRecordsRemoved: duplicateCleanup.removed.length,
      duplicateMerges,
      installedCount: presenceCounts.installed,
      missingCount: presenceCounts.missing,
      notInstalledCount: presenceCounts.not_installed,
      libraryReset,
    };

    if (summary.missingCount > 0) {
      console.warn("[library.scan] Library games with missing install folders:", {
        missingCount: summary.missingCount,
      });
    }

    sendLibraryScanProgress(
      buildLibraryScanSummaryText(summary),
      imported + refreshed,
      scannedGames.length || 0,
    );
    broadcastGamesLibrarySynced({ reason: "library-scan" });

    return summary;
  } finally {
    libraryScanInProgress = false;
    endScanSession(event.sender);
  }
});

function getLibraryGameExtensions() {
  return parseConfiguredExtensions(
    appConfig?.Library?.gameExtensions,
    DEFAULT_GAME_EXTENSIONS,
  );
}

// Locate folder, choose launcher, library backups, catalog link and live
// thread checks (see main/libraryMaintenanceIpc.js for the contracts).
saveStorage = createSaveStorageController({
  ipcMain,
  dialog,
  app,
  safeStorage: safeStorage || null,
  getParentWindow: (event) =>
    BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined,
  appPaths,
  getConfig: () => appConfig || defaultConfig,
  setStorageSection: (section) => {
    appConfig = { ...(appConfig || defaultConfig), SaveStorage: section };
    saveConfig();
    broadcastSettingsChanged();
  },
  getDatabaseConnection: () => databaseConnection,
  getSaveProfileSnapshot: (recordId) =>
    getSaveProfileSnapshot(appPaths, databaseConnection, recordId),
  refreshSaveProfiles: (recordId) =>
    refreshSaveProfiles(appPaths, databaseConnection, recordId),
  listGames: () => getGames(appPaths, 0, null),
  upsertSaveSyncState: (input) => upsertSaveSyncState(databaseConnection, input),
  broadcast: (channel, payload) => {
    BrowserWindow.getAllWindows().forEach((windowInstance) => {
      if (!windowInstance.isDestroyed()) {
        windowInstance.webContents.send(channel, payload);
      }
    });
  },
});

registerSaveTransferIpc({
  ipcMain,
  dialog,
  shell,
  app,
  getParentWindow: (event) =>
    BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined,
  appPaths,
  getDatabaseConnection: () => databaseConnection,
  getSaveProfileSnapshot: (recordId) =>
    getSaveProfileSnapshot(appPaths, databaseConnection, recordId),
  refreshSaveProfiles: (recordId) =>
    refreshSaveProfiles(appPaths, databaseConnection, recordId),
  listGames: () => getGames(appPaths, 0, null),
});

registerLibraryMaintenanceIpc({
  ipcMain,
  dialog,
  getParentWindow: (event) =>
    BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined,
  getMainWindow: () => mainWindow,
  appPaths,
  getDatabaseConnection: () => databaseConnection,
  getGames,
  getGame,
  loadLibraryGame,
  getConfiguredLibraryFolder,
  getGameExtensions: getLibraryGameExtensions,
  isLibraryScanRunning: () => libraryScanInProgress,
  updateVersionLocation,
  updateVersionExecutable,
  catalogDeps: {
    addAtlasMapping,
    getAtlasData,
    getF95ZoneDataByAtlasId,
    upsertF95ZoneMapping,
    updateGame,
  },
  downloadImages,
  previewLimit: DEFAULT_PREVIEW_LIMIT,
  refreshSaveProfiles: (recordId) =>
    refreshSaveProfiles(appPaths, databaseConnection, recordId),
  broadcastGamesLibrarySynced,
  getLiveUpdateChecker: () => libraryLiveUpdateChecker,
});

// ────────────────────────────────────────────────
// UTIL FUNCTIONS
// ────────────────────────────────────────────────

function loadConfig() {
  try {
    configExistedAtStartup = fs.existsSync(configPath);
    if (configExistedAtStartup) {
      const configData = fs.readFileSync(configPath, "utf8");
      appConfig = ini.parse(configData);
    } else {
      appConfig = defaultConfig;
      writeFileAtomicSync(configPath, ini.stringify(appConfig));
    }

    appConfig = {
      ...defaultConfig,
      ...appConfig,
      Interface: {
        ...defaultConfig.Interface,
        ...(appConfig?.Interface || {}),
      },
      Library: {
        ...defaultConfig.Library,
        ...(appConfig?.Library || {}),
      },
      Metadata: {
        ...defaultConfig.Metadata,
        ...(appConfig?.Metadata || {}),
      },
      Performance: {
        ...defaultConfig.Performance,
        ...(appConfig?.Performance || {}),
      },
      Notifications: {
        ...defaultConfig.Notifications,
        ...(appConfig?.Notifications || {}),
      },
      AppUpdates: {
        ...defaultConfig.AppUpdates,
        ...(appConfig?.AppUpdates || {}),
      },
      LiveUpdates: {
        ...defaultConfig.LiveUpdates,
        ...(appConfig?.LiveUpdates || {}),
      },
      Onboarding: {
        ...defaultConfig.Onboarding,
        ...(appConfig?.Onboarding || {}),
      },
      Appearance: {
        ...defaultConfig.Appearance,
        ...(appConfig?.Appearance || {}),
      },
      F95Mirrors: {
        ...(defaultConfig.F95Mirrors || {}),
        ...(appConfig?.F95Mirrors || {}),
      },
    };
    appConfig.Metadata.downloadPreviews = true;
  } catch (err) {
    console.error("Error loading config.ini:", err);
    appConfig = defaultConfig;
  }
}

function saveConfig() {
  writeFileAtomicSync(configPath, ini.stringify(appConfig));
}

function getF95MirrorPreferenceKey(threadUrl) {
  return extractF95IdFromUrl(threadUrl) || String(threadUrl || "").trim();
}

function getPreferredF95Mirror(threadUrl) {
  const preferenceKey = getF95MirrorPreferenceKey(threadUrl);
  if (!preferenceKey) {
    return null;
  }

  const rawValue = appConfig?.F95Mirrors?.[preferenceKey];
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    console.warn("[f95.mirrors] Failed to parse stored mirror preference:", {
      preferenceKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function storePreferredF95Mirror(input) {
  const preferenceKey = getF95MirrorPreferenceKey(input?.threadUrl || "");
  if (!preferenceKey) {
    return;
  }

  if (!appConfig.F95Mirrors || typeof appConfig.F95Mirrors !== "object") {
    appConfig.F95Mirrors = {};
  }

  appConfig.F95Mirrors[preferenceKey] = JSON.stringify({
    host: input?.host || "",
    label: input?.label || "",
    variantId: input?.variantId || "",
    threadUrl: input?.threadUrl || "",
    updatedAt: Date.now(),
  });

  try {
    saveConfig();
  } catch (error) {
    console.error("[f95.mirrors] Failed to persist mirror preference:", error);
  }
}

function pickPreferredThreadLink(threadUrl, links) {
  const preferredMirror = getPreferredF95Mirror(threadUrl);
  if (!preferredMirror || !Array.isArray(links) || links.length === 0) {
    return null;
  }

  return (
    links.find(
      (link) =>
        preferredMirror.variantId &&
        preferredMirror.host &&
        link.variantId === preferredMirror.variantId &&
        normalizeHostname(link.host) ===
          normalizeHostname(preferredMirror.host),
    ) ||
    links.find(
      (link) =>
        preferredMirror.label &&
        preferredMirror.host &&
        link.label === preferredMirror.label &&
        normalizeHostname(link.host) ===
          normalizeHostname(preferredMirror.host),
    ) ||
    links.find(
      (link) =>
        preferredMirror.host &&
        normalizeHostname(link.host) ===
          normalizeHostname(preferredMirror.host),
    ) ||
    null
  );
}

function getVersionsMissingStoredFolderSize(limit = 200) {
  return new Promise((resolve, reject) => {
    getDb().all(
      `
        SELECT record_id, version, game_path
        FROM versions
        WHERE (folder_size IS NULL OR folder_size <= 0)
          AND game_path IS NOT NULL
          AND TRIM(game_path) <> ''
        ORDER BY date_added DESC
        LIMIT ?
      `,
      [limit],
      (error, rows) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(Array.isArray(rows) ? rows : []);
      },
    );
  });
}

async function backfillMissingVersionFolderSizes(limit = 200) {
  const rows = await getVersionsMissingStoredFolderSize(limit);
  if (!rows.length) {
    return {
      scanned: 0,
      updated: 0,
    };
  }

  const updatedRecordIds = new Set();
  let updated = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const recordId = Number(row?.record_id);
    const version = String(row?.version || "").trim();
    const gamePath = String(row?.game_path || "").trim();

    if (!recordId || !version || !gamePath || !fs.existsSync(gamePath)) {
      continue;
    }

    let size = 0;
    try {
      size = await getFolderSizeAsync(gamePath);
    } catch (error) {
      console.warn("[library.size] Failed to read game folder size:", {
        recordId,
        version,
        gamePath,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (!Number.isFinite(size) || size <= 0) {
      continue;
    }

    try {
      await updateFolderSize(recordId, version, size);
      updated += 1;
      updatedRecordIds.add(recordId);
    } catch (error) {
      console.warn("[library.size] Failed to persist game folder size:", {
        recordId,
        version,
        size,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if ((index + 1) % 5 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  for (const recordId of updatedRecordIds) {
    mainWindow?.webContents.send("game-updated", recordId);
  }

  return {
    scanned: rows.length,
    updated,
  };
}

async function downloadImages(
  recordId,
  atlasId,
  onImageProgress,
  downloadBannerImages,
  downloadPreviewImages,
  previewLimit,
  downloadVideos,
) {
  const imgDir = path.join(imagesDir, recordId.toString());
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  let imageProgress = 0;
  const bannerUrl = downloadBannerImages ? await getBannerUrl(atlasId) : null;
  const screenUrls = downloadPreviewImages
    ? await getScreensUrlList(atlasId)
    : [];
  const previewCount = downloadPreviewImages
    ? resolvePreviewDownloadCount(previewLimit, screenUrls.length)
    : 0;
  const totalImages = (bannerUrl ? 3 : 0) + previewCount;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  if (bannerUrl) {
    console.log(`Downloading banner from URL: ${bannerUrl}`);
    try {
      const ext = path.extname(new URL(bannerUrl).pathname).toLowerCase();
      const baseName = path.basename("banner", ext);
      const imagePath = path.join(imgDir, baseName);

      let imageBytes;
      let downloaded = false;
      if ([".gif", ".mp4", ".webm"].includes(ext) && downloadVideos) {
        const animatedPath = `${imagePath}${ext}`;
        if (!fs.existsSync(animatedPath)) {
          const response = await axios.get(bannerUrl, {
            responseType: "arraybuffer",
          });
          imageBytes = Buffer.from(response.data);
          fs.writeFileSync(animatedPath, imageBytes);
          downloaded = true;
        }
        await updateBanners(
          recordId,
          toStoredImagePath(appPaths, animatedPath),
          "animated",
        );
        imageProgress++;
        onImageProgress(imageProgress, totalImages);
      }

      const highResPath = `${imagePath}_mc.webp`;
      if (!fs.existsSync(highResPath)) {
        if (!imageBytes) {
          const response = await axios.get(bannerUrl, {
            responseType: "arraybuffer",
          });
          imageBytes = Buffer.from(response.data);
          downloaded = true;
        }
        await sharp(imageBytes)
          .webp({ quality: 90 })
          .resize({ width: 1260, withoutEnlargement: true })
          .toFile(highResPath);
      }
      await updateBanners(
        recordId,
        toStoredImagePath(appPaths, highResPath),
        "small",
      );
      imageProgress++;
      onImageProgress(imageProgress, totalImages);

      const lowResPath = `${imagePath}_sc.webp`;
      if (!fs.existsSync(lowResPath)) {
        if (!imageBytes) {
          const response = await axios.get(bannerUrl, {
            responseType: "arraybuffer",
          });
          imageBytes = Buffer.from(response.data);
          downloaded = true;
        }
        await sharp(imageBytes)
          .webp({ quality: 90 })
          .resize({ width: 600, withoutEnlargement: true })
          .toFile(lowResPath);
      }
      await updateBanners(
        recordId,
        toStoredImagePath(appPaths, lowResPath),
        "large",
      );
      imageProgress++;
      onImageProgress(imageProgress, totalImages);

      console.log("Banner images updated");
      if (downloaded) {
        // Pause between downloads so image hosts are not hammered.
        await delay(500);
      }
    } catch (err) {
      console.error("Error downloading or converting banner:", err);
    }
  }

  for (let i = 0; i < previewCount; i++) {
    const url = screenUrls[i]?.trim();
    if (!url) continue;

    console.log(`Downloading screen ${i + 1} from URL: ${url}`);
    try {
      const ext = path.extname(new URL(url).pathname).toLowerCase();
      const baseName = path.basename(url, ext);
      const imagePath = path.join(imgDir, baseName);

      let imageBytes;
      let downloaded = false;
      if ([".gif", ".mp4", ".webm"].includes(ext) && downloadVideos) {
        const animatedPath = `${imagePath}${ext}`;
        if (!fs.existsSync(animatedPath)) {
          const response = await axios.get(url, {
            responseType: "arraybuffer",
          });
          imageBytes = Buffer.from(response.data);
          fs.writeFileSync(animatedPath, imageBytes);
          downloaded = true;
        }
        await updatePreviews(
          recordId,
          toStoredImagePath(appPaths, animatedPath),
        );
      }

      const targetPath = `${imagePath}_pr.webp`;
      if (!fs.existsSync(targetPath)) {
        if (!imageBytes) {
          const response = await axios.get(url, {
            responseType: "arraybuffer",
          });
          imageBytes = Buffer.from(response.data);
          downloaded = true;
        }
        await sharp(imageBytes)
          .webp({ quality: 90 })
          .resize({ width: 1260, withoutEnlargement: true })
          .toFile(targetPath);
      }
      await updatePreviews(recordId, toStoredImagePath(appPaths, targetPath));
      imageProgress++;
      onImageProgress(imageProgress, totalImages);

      console.log(`Screen ${i + 1} updated`);
      if (downloaded) {
        await delay(500);
      }
    } catch (err) {
      console.error(`Error downloading or converting screen ${i + 1}:`, err);
    }
  }
}

function getCachedPreviewCount(recordId) {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT COUNT(*) as preview_count FROM previews WHERE record_id = ?`,
      [recordId],
      (err, row) => {
        if (err) {
          console.error("Error counting cached previews:", err);
          reject(err);
          return;
        }

        resolve(Number(row?.preview_count) || 0);
      },
    );
  });
}

async function refreshLibraryPreviewsInternal(sender) {
  const installedGames = await getGames(appPaths, 0, null);
  const targets = buildLibraryPreviewRefreshTargets(installedGames);
  const totalGames = targets.length;

  if (totalGames === 0) {
    sender.send("import-progress", {
      text: "No library games with site screenshots were found.",
      progress: 0,
      total: 1,
    });
    return {
      success: true,
      totalGames: 0,
      processed: 0,
      refreshed: 0,
      skipped: 0,
      failed: 0,
    };
  }

  let processed = 0;
  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  sender.send("import-progress", {
    text: `Starting screenshot refresh for ${totalGames} games...`,
    progress: 0,
    total: totalGames,
  });

  for (const target of targets) {
    try {
      const remoteScreens = await getScreensUrlList(target.atlasId);
      const cachedPreviewCount = await getCachedPreviewCount(target.recordId);

      if (
        !shouldRefreshCachedPreviews({
          cachedPreviewCount,
          remotePreviewCount: remoteScreens.length,
        })
      ) {
        skipped++;
        processed++;
        sender.send("import-progress", {
          text: `Screenshots already complete for '${target.title}' ${processed}/${totalGames}`,
          progress: processed,
          total: totalGames,
        });
        continue;
      }

      sender.send("import-progress", {
        text: `Refreshing screenshots for '${target.title}' ${processed + 1}/${totalGames}`,
        progress: processed,
        total: totalGames,
      });

      await downloadImages(
        target.recordId,
        target.atlasId,
        (current, totalImages) => {
          sender.send("import-progress", {
            text: `Refreshing screenshots for '${target.title}' ${processed + 1}/${totalGames}, ${current}/${totalImages}`,
            progress: processed,
            total: totalGames,
          });
        },
        false,
        true,
        DEFAULT_PREVIEW_LIMIT,
        false,
      );

      sender.send("game-updated", target.recordId);
      refreshed++;
      processed++;
      sender.send("import-progress", {
        text: `Refreshed screenshots for '${target.title}' ${processed}/${totalGames}`,
        progress: processed,
        total: totalGames,
      });
    } catch (error) {
      console.error("Error refreshing library previews:", error);
      failed++;
      processed++;
      sender.send("import-progress", {
        text: `Failed to refresh screenshots for '${target.title}' ${processed}/${totalGames}: ${error.message}`,
        progress: processed,
        total: totalGames,
      });
    }
  }

  sender.send("import-progress", {
    text:
      failed > 0
        ? `Screenshot refresh finished: ${refreshed} updated, ${skipped} skipped, ${failed} failed`
        : `Screenshot refresh complete: ${refreshed} updated, ${skipped} already complete`,
    progress: processed,
    total: totalGames,
  });

  return {
    success: failed === 0,
    totalGames,
    processed,
    refreshed,
    skipped,
    failed,
    error:
      failed > 0
        ? `${failed} game${failed === 1 ? "" : "s"} failed during screenshot refresh`
        : "",
  };
}

async function launchGame({ execPath, extension, recordId }) {
  if (recordId) {
    const steamId = await getSteamIDbyRecord(recordId);
    if (steamId) {
      await shell.openExternal(`steam://run/${steamId}`);
      return { success: true };
    }
  }
  if (!execPath) {
    throw new Error("No executable is configured for this installed version.");
  }
  if (!fs.existsSync(execPath)) {
    throw new Error(`Could not find the game executable at ${execPath}`);
  }
  const emulator = await getEmulatorByExtension(extension);
  if (emulator) {
    const args = emulator.parameters ? emulator.parameters.split(" ") : [];
    args.push(execPath);
    const child = cp.spawn(emulator.program_path, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { success: true };
  } else {
    const launchError = await shell.openPath(execPath);
    if (launchError) {
      throw new Error(launchError);
    }
    return { success: true };
  }
}

function forwardContextMenuCommand(targetWebContents, data) {
  if (!targetWebContents || targetWebContents.isDestroyed()) {
    console.error("Context menu command target is unavailable", data);
    return;
  }

  targetWebContents.send("context-menu-command", data);
}

async function handleContextAction(targetWebContents, data) {
  if (!data || typeof data.action === "undefined") {
    console.error("handleContextAction: Invalid or missing data object", data);
    return;
  }

  switch (data.action) {
    case "launch":
      await launchGame(data);
      break;
    case "openFolder":
      await shell.openPath(data.gamePath);
      break;
    case "openUrl":
      await shell.openExternal(data.url);
      break;
    // "View Details" opens the details panel of the main window.
    case "properties":
    case "removeGame":
    case "updateGame":
    case "locateGame":
    case "chooseExecutable":
    case "addToFavorites":
    case "removeFromFavorites":
    case "rescanLibrary":
    case "refreshLibrary":
    case "refreshLibraryPreviews":
    case "resetCacheAndRescanLibrary":
    case "resetLibrary":
      forwardContextMenuCommand(targetWebContents, data);
      break;
    default:
      console.error(`Unknown action: ${data.action}`);
  }
}

function processTemplate(items, targetWebContents) {
  return items.map((item) => {
    const newItem = { ...item };
    if (newItem.submenu) {
      newItem.submenu = processTemplate(newItem.submenu, targetWebContents);
    }
    if (newItem.data) {
      const id = contextMenuId++;
      contextMenuData.set(id, newItem.data);
      newItem.click = () => {
        const data = contextMenuData.get(id);
        Promise.resolve(handleContextAction(targetWebContents, data)).catch(
          (error) => {
            console.error("Context menu action failed:", error);
          },
        );
        contextMenuData.delete(id);
      };
      delete newItem.data;
    }
    return newItem;
  });
}

// ────────────────────────────────────────────────
// STEAM FUNCTIONS
// ────────────────────────────────────────────────

async function getSteamGameData(steamId) {
  try {
    const steamResponse = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${steamId}`,
    );
    const steamJson = await steamResponse.json();
    if (!steamJson[steamId] || !steamJson[steamId].success) {
      return null;
    }
    const data = steamJson[steamId].data;

    const spyResponse = await fetch(
      `https://steamspy.com/api.php?request=appdetails&appid=${steamId}`,
    );
    const spy = await spyResponse.json();

    const langHtml = data.supported_languages || "";
    const languages = langHtml
      .replace(/<strong>\*<\/strong>/g, "*")
      .split(",")
      .map((l) => l.trim());
    const voiceLangs = languages
      .filter((l) => l.endsWith("*"))
      .map((l) => l.replace(/\*$/, "").trim());
    const textLangs = languages.map((l) => l.replace(/\*$/, "").trim());

    const osArr = [];
    if (data.platforms.windows) osArr.push("Windows");
    if (data.platforms.mac) osArr.push("Mac");
    if (data.platforms.linux) osArr.push("Linux");

    const possibleEngines = ["Unity", "Unreal Engine", "Godot", "RPG Maker"];
    const engine =
      Object.keys(spy.tags || {}).find((tag) =>
        possibleEngines.includes(tag),
      ) || "";

    const censored =
      data.required_age > 0 ||
      (data.content_descriptors &&
        data.content_descriptors.ids &&
        data.content_descriptors.ids.length > 0)
        ? "yes"
        : "no";

    const game = {
      steam_id: parseInt(steamId),
      title: data.name || "",
      category: data.categories
        ? data.categories.map((c) => c.description).join(",")
        : "",
      engine: engine,
      developer: data.developers ? data.developers.join(",") : "",
      publisher: data.publishers ? data.publishers.join(",") : "",
      overview: data.detailed_description || "",
      censored: censored,
      language: textLangs.join(","),
      translations: textLangs.join(","),
      genre: data.genres ? data.genres.map((g) => g.description).join(",") : "",
      tags: spy.tags ? Object.keys(spy.tags).join(",") : "",
      voice: voiceLangs.join(","),
      os: osArr.join(","),
      releaseState: data.release_date.coming_soon ? "upcoming" : "released",
      release_date: data.release_date.date || "",
      header: data.header_image || "",
      library_hero: `https://steamcdn-a.akamaihd.net/steam/apps/${steamId}/library_hero.jpg`,
      logo: `https://steamcdn-a.akamaihd.net/steam/apps/${steamId}/library_600x900.jpg`,
      screenshots: data.screenshots
        ? data.screenshots.map((s) => s.path_full).join(",")
        : "",
      last_record_update: new Date().toISOString(),
    };

    return game;
  } catch (error) {
    console.error("Error fetching game data:", error);
    return null;
  }
}

async function findSteamId(title, developer) {
  try {
    const query = encodeURIComponent(`${title} ${developer}`);
    const searchResponse = await fetch(
      `https://store.steampowered.com/api/storesearch/?term=${query}&l=english&cc=US`,
    );
    const searchJson = await searchResponse.json();

    if (searchJson.total === 0) {
      return null;
    }

    for (const item of searchJson.items) {
      if (item.name.toLowerCase() === title.toLowerCase()) {
        const detailsResponse = await fetch(
          `https://store.steampowered.com/api/appdetails?appids=${item.id}`,
        );
        const detailsJson = await detailsResponse.json();
        if (!detailsJson[item.id] || !detailsJson[item.id].success) {
          continue;
        }
        const data = detailsJson[item.id].data;
        if (
          data.developers &&
          data.developers.some(
            (d) => d.toLowerCase() === developer.toLowerCase(),
          )
        ) {
          return item.id;
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Error finding Steam ID:", error);
    return null;
  }
}

// ────────────────────────────────────────────────
// APP LIFECYCLE
// ────────────────────────────────────────────────

// A second instance would open the same SQLite database and config.ini
// concurrently; focus the running window instead.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (typeof trayController.showMainWindow === "function") {
      trayController.showMainWindow();
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

process.on("uncaughtException", (error) => {
  console.error("[main] Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[main] Unhandled promise rejection:", reason);
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }
  loadConfig();
  applyLoginItemSettings();
  databaseConnection = await initializeDatabase(appPaths);
  hydrateF95DownloadsStore();
  saveStorage?.start().catch((error) => {
    console.error("[save.storage] Failed to start save storage:", error);
  });
  f95Session = getReadyF95Session();
  attachF95DownloadListener();
  f95Session.cookies.on("changed", () => {
    broadcastF95AuthState().catch((error) => {
      console.error("[f95.auth] Failed to broadcast auth state:", error);
    });
  });
  createWindow();
  libraryLiveUpdateChecker = createLibraryLiveUpdateChecker();
  libraryLiveUpdateChecker.start();
  setTimeout(() => {
    libraryLiveUpdateChecker?.runNow({ reason: "startup" }).catch((error) => {
      console.error("[library.live] Startup thread check failed:", error);
    });
  }, LIVE_CHECK_STARTUP_DELAY_MS);
  setTimeout(() => {
    backfillMissingVersionFolderSizes()
      .then((result) => {
        if (result.updated > 0) {
          console.log(
            `[library.size] Backfilled folder size for ${result.updated} version records (scanned ${result.scanned}).`,
          );
        }
      })
      .catch((error) => {
        console.warn("[library.size] Folder-size backfill failed:", error);
      });
  }, 1200);
  broadcastF95AuthState().catch((error) => {
    console.error("[f95.auth] Failed to initialize auth state:", error);
  });
  runAppUpdateCheck("startup")
    .catch((error) => {
      console.error("Failed to initialize app updater:", error);
    })
    .finally(() => {
      appUpdateRecheckJob.start();
    });
  libraryAutoBackupJob.start({ initialDelayMs: AUTO_BACKUP_STARTUP_DELAY_MS });
  powerMonitor.on("resume", () => {
    // The network needs a moment after wake-up; then re-check everything the
    // launcher would have checked had it been running.
    appUpdateRecheckJob.kick("resume", RESUME_RECHECK_DELAY_MS);
    setTimeout(() => {
      libraryLiveUpdateChecker?.runNow({ reason: "resume" }).catch((error) => {
        console.error("[library.live] Thread check after wake-up failed:", error);
      });
      saveStorage?.scheduleSyncAll?.("resume");
    }, RESUME_RECHECK_DELAY_MS);
  });
});

const RESUME_RECHECK_DELAY_MS = 60 * 1000;

async function runScheduledLibraryBackupIfEnabled() {
  const config = appConfig || defaultConfig;
  if (config?.Library?.autoBackup === false || !databaseConnection) {
    return null;
  }
  return runScheduledLibraryBackup({
    listBackups: () => listLibraryBackups({ appPaths }),
    createBackup: ({ fileNamePrefix }) =>
      backupDatabaseFile({
        appPaths,
        db: databaseConnection,
        logger: console,
        fileNamePrefix,
      }),
  });
}

app.on("before-quit", () => {
  flushF95DownloadsPersist();
  trayController.prepareForQuit();
});

app.on("will-quit", () => {
  appUpdateRecheckJob.stop();
  libraryAutoBackupJob.stop();
  libraryLiveUpdateChecker?.stop();
  if (f95LoginLiveCheckTimer) {
    clearTimeout(f95LoginLiveCheckTimer);
    f95LoginLiveCheckTimer = null;
  }
  trayController.destroy();
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    return;
  }
  if (isMinimizeToTrayEnabled(appConfig)) {
    return;
  }
  app.quit();
});
