const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const axios = require("axios");
const ini = require("ini");
const { initializeAppPaths } = require("./main/appPaths");
const { extractArchiveSafely } = require("./main/archive/extractArchive");
const { toStoredImagePath } = require("./main/assetPaths");
const { createAppUpdaterController } = require("./main/appUpdater");
const { mergeImportedGameMetadata } = require("./main/importMetadata");
const { resolveArchiveContentRoot } = require("./main/install/archiveLayout");
const {
  selectPreferredExecutable,
} = require("./main/install/selectExecutable");
const { getErrorMessage } = require("./main/errorMessage");
const {
  clearF95Session,
  createF95BrowserWindow,
  createF95LoginWindow,
  getF95AuthState,
  getF95Session,
} = require("./main/f95/session");
const { createDownloadsStore } = require("./main/f95/downloadsStore");
const {
  DIRECT_DOWNLOAD_USER_AGENT,
  resolveDownloadFileName,
  shouldUseDirectSessionDownload,
  streamResponseBodyToFile,
} = require("./main/f95/directDownload");
const {
  DownloadValidationError,
  inspectDownloadedPackage,
  MirrorActionRequiredError,
  normalizeEngineLabel,
  normalizeHostname,
  parseF95ThreadTitle,
  prepareF95DownloadUrl,
} = require("./main/f95/downloadSupport");
const { inspectF95Thread } = require("./main/f95/threadInspector");
const { backupGameSaves, restoreGameSaves } = require("./main/saveVault");
const { createCloudSaveService } = require("./main/cloudSaveSync");
const {
  buildCloudLibraryCatalogEntry,
  buildCloudLibraryEntryIdentity,
} = require("./main/cloudLibraryCatalog");
const {
  getSaveProfileSnapshot,
  refreshSaveProfiles,
} = require("./main/saveProfiles");
const { removeLibraryGame } = require("./main/gameRemoval");
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
  addVersion,
  updateVersion,
  addAtlasMapping,
  getGame,
  getGames,
  removeGame,
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
  db,
} = require("./database");
const { Menu } = require("electron");
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
let cloudSaveService = null;
let cloudSaveQueue = Promise.resolve();

app.commandLine.appendSwitch("force-color-profile", "srgb");

const appPaths = initializeAppPaths(app, {
  mainDir: __dirname,
});
const dataDir = appPaths.data;
const updatesDir = appPaths.updates;
const downloadsDir = appPaths.downloads;
const imagesDir = appPaths.images;
const configPath = appPaths.config;
const appUpdater = createAppUpdaterController({ app });
let f95Session = null;
const f95InstallQueue = [];
const f95InstallContexts = new Map();
const f95DownloadsStore = createDownloadsStore();
let f95DownloadSequence = 0;

const MAIN_WINDOW_DEFAULT_WIDTH = 1280;
const MAIN_WINDOW_DEFAULT_HEIGHT = 800;
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

// ────────────────────────────────────────────────
// WINDOW CREATION FUNCTIONS
// ────────────────────────────────────────────────

function resolveMainWindowBounds() {
  const workArea =
    screen.getPrimaryDisplay()?.workAreaSize || {
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

  mainWindow = new BrowserWindow({
    width: mainWindowBounds.width,
    height: mainWindowBounds.height,
    minWidth: mainWindowBounds.minWidth,
    minHeight: mainWindowBounds.minHeight,
    icon: APP_WINDOW_ICON_PATH,
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

  mainWindow.loadFile(path.join(__dirname, "index.html"));
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

function createGameDetailsWindow(recordId) {
  const gameDetailsWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1400,
    minHeight: 900,
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

  gameDetailsWindow.loadFile(path.join(__dirname, "gamedetails.html"));

  gameDetailsWindow.webContents.on("did-finish-load", () => {
    console.log("Fetching game data for recordId:", recordId);
    getGame(recordId, appPaths)
      .then((game) => {
        setTimeout(() => {
          gameDetailsWindow.webContents.send("send-game-data", game);
        }, 400);
      })
      .catch((err) => {
        console.error("Failed to fetch game data:", err);
        gameDetailsWindow.webContents.send("send-game-data", null);
      });
  });

  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    gameDetailsWindow.webContents.openDevTools();
  }

  gameDetailsWindow.on("maximize", () => {
    gameDetailsWindow.webContents.send("window-state-changed", "maximized");
  });
  gameDetailsWindow.on("unmaximize", () => {
    gameDetailsWindow.webContents.send("window-state-changed", "restored");
  });

  gameDetailsWindow.on("closed", () => {
    //gameDetailsWindow = null;
  });
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

function sanitizePathSegment(value, fallback = "Unknown") {
  const normalized = String(value || "")
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
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

function getPreferredInstalledPath(game) {
  const versions = Array.isArray(game?.versions) ? [...game.versions] : [];
  versions.sort(
    (left, right) => (right.date_added || 0) - (left.date_added || 0),
  );

  for (const version of versions) {
    if (version?.game_path) {
      return version.game_path;
    }
  }

  return "";
}

function getLibraryIdentityKey(game) {
  return (
    buildCloudLibraryCatalogEntry(game)?.identityKey ||
    buildCloudLibraryEntryIdentity(game)
  );
}

function findMatchingLibraryGame(
  libraryGames,
  metadata,
  fallbackName = "",
) {
  const normalizedF95Id = extractF95IdFromUrl(metadata?.threadUrl || "");
  const normalizedTitle = normalizeLibraryMatchText(
    metadata?.title || fallbackName,
  );
  const normalizedCreator = normalizeLibraryMatchText(metadata?.creator || "");
  const requestedIdentityKey = buildCloudLibraryEntryIdentity({
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
      ) || null;
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
  const libraryGames = await getGames(appPaths, 0, null);
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
      recordId: null,
      title: parsedTitle.title || "",
      creator: parsedTitle.creator || "",
      version: "",
      gamePath: "",
    };
  }

  return {
    inLibrary: true,
    installed:
      Array.isArray(existingGame.versions) && existingGame.versions.length > 0,
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

async function resolveF95InstallTarget(metadata, fallbackName) {
  const libraryGames = await getGames(appPaths, 0, null);
  const existingGame = findMatchingLibraryGame(
    libraryGames,
    metadata,
    fallbackName,
  );

  const stableFolderName = sanitizePathSegment(metadata?.title, fallbackName);
  const desiredInstallPath = path.join(
    getConfiguredLibraryFolder(),
    stableFolderName,
  );

  if (existingGame) {
    const existingPath = getPreferredInstalledPath(existingGame);
    if (existingPath) {
      return {
        installDirectory: existingPath,
        existingGame,
      };
    }
  }

  return {
    installDirectory: fs.existsSync(desiredInstallPath)
      ? ensureUniquePath(desiredInstallPath)
      : desiredInstallPath,
    existingGame: existingGame || null,
  };
}

async function moveDirectoryIntoPlace(sourceDirectory, targetDirectory) {
  if (!fs.existsSync(targetDirectory)) {
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
    console.warn("[f95.download] Failed to resolve atlas mapping for thread:", {
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
    console.warn("[library.stub] Failed to load atlas metadata:", {
      atlasId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

async function buildF95ThreadLibraryMetadata(input) {
  const parsedTitle = parseF95ThreadTitle(input?.rawTitle || input?.title || "");
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
    engine: resolveEngineLabel(input?.engine, parsedTitle.engine, atlasData.engine),
    atlasId: atlasMetadata.atlasId || null,
    f95Id: atlasMetadata.f95Id || extractF95IdFromUrl(input?.threadUrl || ""),
  };
}

async function upsertLibraryGameFromMetadata(
  metadata,
  options = {},
) {
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
      console.warn("[library.stub] Failed to attach atlas mapping:", {
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

  const localGame =
    existingGame ||
    {
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

  if (options.scheduleCatalogSync !== false) {
    scheduleCloudLibraryCatalogSync(options.reason || "library-upsert");
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

async function materializeCloudLibraryCatalogEntries(entries, reason) {
  const libraryGames = await getGames(appPaths, 0, null);
  let added = 0;
  let updated = 0;
  let failed = 0;

  for (const entry of Array.isArray(entries) ? entries : []) {
    try {
      const result = await upsertLibraryGameFromMetadata(
        {
          threadUrl: entry?.siteUrl || "",
          siteUrl: entry?.siteUrl || "",
          title: entry?.title || "",
          creator: entry?.creator || "",
          engine: entry?.engine || "Unknown",
          atlasId: entry?.atlasId || null,
          f95Id: entry?.f95Id || "",
        },
        {
          libraryGames,
          emitEvent: true,
          scheduleCatalogSync: false,
          reason,
        },
      );

      if (result.added) {
        added += 1;
      } else {
        updated += 1;
      }
    } catch (error) {
      failed += 1;
      console.error("[cloud.library] Failed to materialize library entry:", {
        title: entry?.title || "",
        siteUrl: entry?.siteUrl || "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    added,
    updated,
    failed,
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

  const preferredLink = pickPreferredThreadLink(threadUrl, payload.links || []);

  return {
    ...payload,
    preferredLinkUrl: preferredLink?.url || "",
  };
}

function getReadyF95Session() {
  if (!f95Session) {
    f95Session = getF95Session();
  }

  return f95Session;
}

function getReadyCloudSaveService() {
  if (!cloudSaveService) {
    throw new Error("Cloud save service is not initialized yet.");
  }

  return cloudSaveService;
}

function queueCloudSaveTask(taskName, task) {
  cloudSaveQueue = cloudSaveQueue
    .catch(() => null)
    .then(async () => {
      try {
        return await task();
      } catch (error) {
        console.error(`[cloud.sync] ${taskName} failed:`, error);
        return null;
      }
    });

  return cloudSaveQueue;
}

function broadcastCloudBulkProgress(payload) {
  for (const windowInstance of [mainWindow, settingsWindow]) {
    if (!windowInstance || windowInstance.isDestroyed()) {
      continue;
    }

    windowInstance.webContents.send("cloud-bulk-progress", payload);
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Math.min(limit || 1, list.length || 1));
  let cursor = 0;

  async function runWorker() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      await worker(list[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, () => runWorker()),
  );
}

async function runBulkCloudSaveAction(mode, options = {}) {
  if (!databaseConnection) {
    throw new Error("Database connection is not ready.");
  }

  const authState = await getReadyCloudSaveService().getAuthState();
  if (!authState?.authenticated) {
    throw new Error("Sign in to cloud saves first.");
  }

  const installedGames = (await getGames(appPaths, 0, null)).filter(
    (game) => game?.record_id && Array.isArray(game?.versions) && game.versions.length > 0,
  );
  const total = installedGames.length;
  const summary = {
    mode,
    total,
    completed: 0,
    uploaded: 0,
    restored: 0,
    synced: 0,
    conflicts: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };

  const emitProgress = options.emitProgress !== false;
  if (emitProgress) {
    broadcastCloudBulkProgress({
      active: true,
      mode,
      completed: 0,
      total,
      currentTitle: "",
      summary,
    });
  }

  await mapWithConcurrency(installedGames, 3, async (game) => {
    let result = {
      recordId: game.record_id,
      title: game.displayTitle || game.title || "Unknown",
      outcome: "skipped",
      message: "",
    };

    try {
      if (mode === "upload") {
        const snapshot = await refreshSaveProfiles(
          appPaths,
          databaseConnection,
          game.record_id,
        );
        if (!snapshot?.profiles?.length) {
          result = {
            ...result,
            outcome: "skipped",
            message: "No save profiles found on this PC.",
          };
        } else {
          await getReadyCloudSaveService().uploadGameSaves({
            recordId: game.record_id,
            snapshot,
          });
          result = {
            ...result,
            outcome: "uploaded",
            message: "Uploaded local saves to cloud.",
          };
        }
      } else {
        const reconcileResult = await getReadyCloudSaveService().reconcileGameSaves({
          recordId: game.record_id,
        });
        const action = reconcileResult?.action || "noop";
        result = {
          ...result,
          outcome:
            action === "upload"
              ? "uploaded"
              : action === "restore"
                ? "restored"
                : action === "conflict"
                  ? "conflict"
                  : "synced",
          message: reconcileResult?.reason || "",
        };
      }
    } catch (error) {
      result = {
        ...result,
        outcome: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    summary.completed += 1;
    if (result.outcome === "uploaded") {
      summary.uploaded += 1;
    } else if (result.outcome === "restored") {
      summary.restored += 1;
    } else if (result.outcome === "conflict") {
      summary.conflicts += 1;
    } else if (result.outcome === "failed") {
      summary.failed += 1;
    } else if (result.outcome === "synced") {
      summary.synced += 1;
    } else {
      summary.skipped += 1;
    }
    summary.results.push(result);

    if (emitProgress) {
      broadcastCloudBulkProgress({
        active: summary.completed < total,
        mode,
        completed: summary.completed,
        total,
        currentTitle: result.title,
        summary,
      });
    }
  });

  if (emitProgress) {
    broadcastCloudBulkProgress({
      active: false,
      mode,
      completed: summary.completed,
      total,
      currentTitle: "",
      summary,
    });
  }

  return summary;
}

function scheduleCloudSaveReconcile(recordId, reason) {
  if (!recordId) {
    return Promise.resolve(null);
  }

  return queueCloudSaveTask(
    `auto reconcile record ${recordId} (${reason})`,
    async () => {
      const authState = await getReadyCloudSaveService().getAuthState();
      if (!authState?.authenticated) {
        return null;
      }

      return getReadyCloudSaveService().reconcileGameSaves({
        recordId,
      });
    },
  );
}

function scheduleCloudInstalledSavesReconcile(reason) {
  return queueCloudSaveTask(`auto reconcile library (${reason})`, async () => {
    return runBulkCloudSaveAction("sync", {
      emitProgress: false,
    });
  });
}

async function syncCloudLibraryCatalogNow(reason) {
  const authState = await getReadyCloudSaveService().getAuthState();
  if (!authState?.authenticated) {
    throw new Error("Cloud library sync requires a signed-in account.");
  }

  const result = await getReadyCloudSaveService().syncLibraryCatalog();
  const materialized = await materializeCloudLibraryCatalogEntries(
    result?.remoteOnlyEntries || [],
    `cloud-catalog-${reason}`,
  );

  console.info("[cloud.library] catalog sync", {
    reason,
    local: result?.localEntries?.length ?? 0,
    remote: result?.remoteEntries?.length ?? 0,
    remoteOnly: result?.remoteOnlyEntries?.length ?? 0,
    materialized,
  });

  broadcastGamesLibrarySynced({ materialized, reason });

  return {
    ...result,
    materialized,
  };
}

function scheduleCloudLibraryCatalogSync(reason) {
  return queueCloudSaveTask(`sync cloud library catalog (${reason})`, async () =>
    syncCloudLibraryCatalogNow(reason),
  );
}

async function broadcastCloudAuthState() {
  let authState = {
    configured: false,
    authenticated: false,
    user: null,
    error: "",
    settings: {},
  };

  try {
    authState = await getReadyCloudSaveService().getAuthState();
  } catch (error) {
    console.error("[cloud.auth] Failed to read auth state:", error);
    authState = {
      configured: false,
      authenticated: false,
      user: null,
      error: error instanceof Error ? error.message : String(error),
      settings: {},
    };
  }

  for (const windowInstance of [mainWindow, settingsWindow]) {
    if (!windowInstance || windowInstance.isDestroyed()) {
      continue;
    }

    windowInstance.webContents.send("cloud-auth-changed", authState);
  }

  return authState;
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

async function broadcastF95AuthState() {
  const authState = await getF95AuthState(getReadyF95Session());
  const loginWindow = BrowserWindow.getAllWindows().find(
    (windowInstance) => windowInstance.__atlasF95LoginWindow === true,
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

function queueF95InstallContext(metadata) {
  const normalizedUrl = normalizeF95DownloadUrl(metadata?.downloadUrl);
  const contextId = `f95-download-${++f95DownloadSequence}`;
  let sourceHost = metadata?.sourceHost || "";

  if (!sourceHost) {
    try {
      sourceHost = normalizedUrl
        ? normalizeHostname(new URL(normalizedUrl).hostname)
        : "";
    } catch (error) {
      sourceHost = "";
    }
  }

  const context = {
    id: contextId,
    requestedUrl: normalizedUrl,
    metadata: {
      id: contextId,
      title: metadata?.title || "F95 download",
      creator: metadata?.creator || "",
      version: metadata?.version || "",
      engine: resolveEngineLabel(metadata?.engine),
      threadUrl: metadata?.threadUrl || "",
      downloadLabel: metadata?.downloadLabel || "",
      sourceHost,
    },
  };

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
    requestedUrl: normalizedUrl,
    sourceHost,
    sourceLabel: context.metadata.downloadLabel,
    text: `Queued ${context.metadata.title} via ${sourceHost || "selected mirror"}`,
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

  return f95InstallQueue.shift() || null;
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

async function cancelFetchResponseBody(response) {
  try {
    if (response?.body && typeof response.body.cancel === "function") {
      await response.body.cancel();
    }
  } catch {
    // Ignore body cancellation failures for already-consumed or auto-closed bodies.
  }
}

async function finalizeF95DownloadedPackage({
  context,
  targetPath,
  totalBytes,
  receivedBytes,
  mimeType,
}) {
  try {
    const importResults = await importDownloadedF95Package(targetPath, {
      ...context.metadata,
      mimeType: mimeType || "",
    });
    const firstResult = Array.isArray(importResults) ? importResults[0] : null;
    if (firstResult && firstResult.success === false) {
      throw new Error(firstResult.error || "Unknown install error");
    }

    storePreferredF95Mirror({
      threadUrl: context.metadata.threadUrl,
      host: context.metadata.sourceHost,
      label: context.metadata.downloadLabel,
    });

    f95DownloadsStore.complete(context.id, {
      title: context.metadata.title,
      fileName: path.basename(targetPath),
      text: `Installed ${context.metadata.title}`,
      totalBytes: totalBytes || 0,
      receivedBytes: receivedBytes || 0,
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
  } catch (error) {
    const errorMessage = getErrorMessage(error, "Unknown install error.");
    console.error(
      "[f95.download] Failed to install downloaded package:",
      error,
    );
    if (error instanceof DownloadValidationError && error.cleanupFile) {
      await fs.promises.unlink(targetPath).catch(() => {});
    }
    f95DownloadsStore.fail(context.id, {
      title: context.metadata.title,
      fileName: path.basename(targetPath),
      text: `Install failed for ${context.metadata.title}: ${errorMessage}`,
      totalBytes: totalBytes || 0,
      receivedBytes: receivedBytes || 0,
      error: errorMessage,
    });
    broadcastF95Downloads();
    sendF95DownloadProgress({
      phase: "error",
      text: `Install failed for ${context.metadata.title}: ${errorMessage}`,
      percent: 100,
      totalBytes: totalBytes || 0,
      receivedBytes: receivedBytes || 0,
      fileName: path.basename(targetPath),
    });
  }
}

async function startDirectF95Download(context, preparedDownload) {
  let response = null;
  let targetPath = "";
  let totalBytes = 0;
  let receivedBytes = 0;
  let mimeType = "";
  let finalUrl = preparedDownload.resolvedUrl;

  try {
    f95DownloadsStore.start({
      id: context.id,
      title: context.metadata.title,
      creator: context.metadata.creator,
      version: context.metadata.version,
      threadUrl: context.metadata.threadUrl,
      requestedUrl: context.requestedUrl,
      sourceHost: context.metadata.sourceHost,
      sourceLabel: context.metadata.downloadLabel,
      fileName: "",
      text: `Connecting to ${context.metadata.sourceHost || "selected mirror"}`,
      totalBytes: 0,
      receivedBytes: 0,
      percent: 0,
      speedBytesPerSecond: 0,
    });
    broadcastF95Downloads();
    sendF95DownloadProgress({
      phase: "downloading",
      text: `Connecting to ${context.metadata.sourceHost || "selected mirror"}`,
      percent: 0,
      totalBytes: 0,
      receivedBytes: 0,
      fileName: "",
    });

    const fetchDirectResponse = async () => {
      const headers = {
        accept: "*/*",
        "user-agent": DIRECT_DOWNLOAD_USER_AGENT,
      };

      const trySessionFetch = async () => {
        if (typeof getReadyF95Session().fetch !== "function") {
          throw new Error("Session fetch is unavailable.");
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
          return await getReadyF95Session().fetch(
            preparedDownload.resolvedUrl,
            {
              method: "GET",
              redirect: "follow",
              headers,
              signal: controller.signal,
            },
          );
        } finally {
          clearTimeout(timeoutId);
        }
      };

      try {
        return await trySessionFetch();
      } catch (error) {
        console.warn(
          "[f95.download] Session fetch failed for direct mirror, falling back to global fetch:",
          error,
        );
        return fetch(preparedDownload.resolvedUrl, {
          method: "GET",
          redirect: "follow",
          headers,
        });
      }
    };

    response = await fetchDirectResponse();

    if (!response.ok) {
      throw new Error(`Mirror download failed with HTTP ${response.status}.`);
    }

    finalUrl = response.url || preparedDownload.resolvedUrl;
    mimeType = response.headers.get("content-type") || "";
    totalBytes =
      Number.parseInt(response.headers.get("content-length") || "0", 10) || 0;
    const resolvedFileName = resolveDownloadFileName({
      requestedUrl: preparedDownload.resolvedUrl,
      finalUrl,
      contentDisposition: response.headers.get("content-disposition") || "",
    });
    const fallbackFileName = `${sanitizePathSegment(
      context.metadata.title || "f95-download",
      "f95-download",
    )}.bin`;
    targetPath = ensureUniquePath(
      path.join(
        downloadsDir,
        sanitizePathSegment(
          resolvedFileName || fallbackFileName,
          fallbackFileName,
        ),
      ),
    );

    f95DownloadsStore.start({
      id: context.id,
      title: context.metadata.title,
      creator: context.metadata.creator,
      version: context.metadata.version,
      threadUrl: context.metadata.threadUrl,
      requestedUrl: context.requestedUrl,
      sourceHost: normalizeHostname(new URL(finalUrl).hostname),
      sourceLabel: context.metadata.downloadLabel,
      fileName: path.basename(targetPath),
      text: `Downloading ${context.metadata.title}`,
      totalBytes,
      receivedBytes: 0,
      percent: 0,
      speedBytesPerSecond: 0,
    });
    broadcastF95Downloads();
    sendF95DownloadProgress({
      phase: "downloading",
      text: `Downloading ${context.metadata.title}`,
      percent: 0,
      totalBytes,
      receivedBytes: 0,
      fileName: path.basename(targetPath),
    });

    let lastBroadcastAt = Date.now();
    let lastBroadcastBytes = 0;
    receivedBytes = await streamResponseBodyToFile({
      responseBody: response.body,
      targetPath,
      onProgress(nextReceivedBytes) {
        const now = Date.now();
        const shouldBroadcast =
          nextReceivedBytes === totalBytes || now - lastBroadcastAt >= 150;
        if (!shouldBroadcast) {
          return;
        }

        const elapsedMs = Math.max(now - lastBroadcastAt, 1);
        const deltaBytes = Math.max(nextReceivedBytes - lastBroadcastBytes, 0);
        const percent =
          totalBytes > 0
            ? Math.min(
                100,
                Math.round((nextReceivedBytes / Math.max(totalBytes, 1)) * 100),
              )
            : 0;
        const speedBytesPerSecond = Math.round((deltaBytes * 1000) / elapsedMs);

        lastBroadcastAt = now;
        lastBroadcastBytes = nextReceivedBytes;

        f95DownloadsStore.progress(context.id, {
          title: context.metadata.title,
          fileName: path.basename(targetPath),
          text: `Downloading ${context.metadata.title}`,
          percent,
          totalBytes,
          receivedBytes: nextReceivedBytes,
          speedBytesPerSecond,
        });
        broadcastF95Downloads();
        sendF95DownloadProgress({
          phase: "downloading",
          text: `Downloading ${context.metadata.title}`,
          percent,
          totalBytes,
          receivedBytes: nextReceivedBytes,
          fileName: path.basename(targetPath),
        });
      },
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error, "Unknown download error.");
    console.error("[f95.download] Direct session download failed:", error);
    if (targetPath) {
      await fs.promises.unlink(targetPath).catch(() => {});
    }
    await cancelFetchResponseBody(response);
    f95DownloadsStore.fail(context.id, {
      title: context.metadata.title,
      fileName: targetPath ? path.basename(targetPath) : "",
      text: `Download failed for ${context.metadata.title}: ${errorMessage}`,
      totalBytes,
      receivedBytes,
      error: errorMessage,
    });
    broadcastF95Downloads();
    sendF95DownloadProgress({
      phase: "error",
      text: `Download failed for ${context.metadata.title}: ${errorMessage}`,
      percent: 0,
      totalBytes,
      receivedBytes,
      fileName: targetPath ? path.basename(targetPath) : "",
    });
    return;
  }

  await finalizeF95DownloadedPackage({
    context,
    targetPath,
    totalBytes,
    receivedBytes,
    mimeType,
  });
}

async function persistF95InstalledGame(payload) {
  const atlasMetadata =
    payload.atlasMetadata ||
    (await prepareDownloadedGameMetadata(payload.metadata));
  const installedFolderSize =
    payload.installDirectory && fs.existsSync(payload.installDirectory)
      ? getFolderSize(payload.installDirectory)
      : 0;
  const gameRecord = {
    title: payload.title,
    creator: payload.metadata?.creator || "Unknown",
    version: payload.metadata?.version || "Downloaded",
    engine: resolveEngineLabel(payload.detectedEngine, payload.metadata?.engine),
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

    if (
      gameRecord.atlasId &&
      payload.existingGame.atlas_id !== gameRecord.atlasId
    ) {
      try {
        await addAtlasMapping(payload.existingGame.record_id, gameRecord.atlasId);
      } catch (error) {
        console.warn("[f95.install] Failed to update atlas mapping:", {
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
    scheduleCloudLibraryCatalogSync("post-install-update");

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
  if (importedRecordId) {
    scheduleCloudLibraryCatalogSync("post-install-import");
  }

  return importResults;
}

async function importDownloadedF95Package(downloadPath, metadata) {
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

    try {
      await extractArchiveSafely({
        archivePath: installSourcePath,
        destinationPath: extractionStagingDirectory,
      });
      const archiveContentRoot = await resolveArchiveContentRoot(
        extractionStagingDirectory,
      );

      await moveDirectoryIntoPlace(archiveContentRoot, installDirectory);
      if (archiveContentRoot !== extractionStagingDirectory) {
        await fs.promises
          .rm(extractionStagingDirectory, {
            recursive: true,
            force: true,
          })
          .catch(() => {});
      }
    } catch (error) {
      await fs.promises
        .rm(extractionStagingDirectory, {
          recursive: true,
          force: true,
        })
        .catch(() => {});
      throw error;
    } finally {
      await fs.promises.unlink(installSourcePath).catch(() => {});
    }

    const executables = findExecutables(installDirectory, gameExtensions);
    const selectedValue = selectPreferredExecutable(executables, {
      title,
      creator: metadata?.creator || "",
    });
    const detectedEngine = selectedValue
      ? Object.entries(engineMap).find(([, patterns]) =>
          patterns.some((pattern) =>
            selectedValue.toLowerCase().includes(pattern),
          ),
        )?.[0] || "Unknown"
      : "Unknown";

    await restoreGameSaves({
      ...saveVaultInput,
      overwrite: Boolean(installTarget.existingGame),
    }).catch((error) => {
      console.warn(
        "[save.vault] Failed to restore saves after archive install:",
        error,
      );
    });

    return persistF95InstalledGame({
      title,
      metadata,
      installDirectory,
      selectedValue,
      detectedEngine,
      executables: executables.map((value) => ({ key: value, value })),
      existingGame: installTarget.existingGame,
      gameExtensions,
      atlasMetadata,
    });
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
    Object.entries(engineMap).find(([, patterns]) =>
      patterns.some((pattern) =>
        relativeExecutable.toLowerCase().includes(pattern),
      ),
    )?.[0] || "Unknown";

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
    gameExtensions,
    atlasMetadata,
  });
}

function attachF95DownloadListener() {
  getReadyF95Session().on("will-download", (event, item) => {
    const context = resolveF95InstallContext(item);

    if (!context) {
      return;
    }

    const targetPath = ensureUniquePath(
      path.join(
        downloadsDir,
        sanitizePathSegment(item.getFilename() || "f95-download.bin"),
      ),
    );
    item.setSavePath(targetPath);

    f95DownloadsStore.start({
      id: context.id,
      title: context.metadata.title,
      creator: context.metadata.creator,
      version: context.metadata.version,
      threadUrl: context.metadata.threadUrl,
      requestedUrl: context.requestedUrl,
      sourceHost: context.metadata.sourceHost,
      sourceLabel: context.metadata.downloadLabel,
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
      if (state === "interrupted") {
        f95DownloadsStore.fail(context.id, {
          title: context.metadata.title,
          fileName: path.basename(targetPath),
          text: `Download interrupted for ${context.metadata.title}`,
          totalBytes: item.getTotalBytes() || 0,
          receivedBytes: item.getReceivedBytes() || 0,
          error: "interrupted",
        });
        broadcastF95Downloads();
        sendF95DownloadProgress({
          phase: "error",
          text: `Download interrupted for ${context.metadata.title}`,
          percent: 0,
          totalBytes: item.getTotalBytes() || 0,
          receivedBytes: item.getReceivedBytes() || 0,
          fileName: path.basename(targetPath),
        });
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
      if (state !== "completed") {
        f95DownloadsStore.fail(context.id, {
          title: context.metadata.title,
          fileName: path.basename(targetPath),
          text: `Download failed for ${context.metadata.title}: ${state}`,
          totalBytes: item.getTotalBytes() || 0,
          receivedBytes: item.getReceivedBytes() || 0,
          error: state,
        });
        broadcastF95Downloads();
        sendF95DownloadProgress({
          phase: "error",
          text: `Download failed for ${context.metadata.title}: ${state}`,
          percent: 0,
          totalBytes: item.getTotalBytes() || 0,
          receivedBytes: item.getReceivedBytes() || 0,
          fileName: path.basename(targetPath),
        });
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
    atlasStartup: "Do Nothing",
    gameStartup: "Do Nothing",
    showDebugConsole: false,
    minimizeToTray: false,
  },
  Library: {
    rootPath: dataDir,
    gameFolder: "",
  },
  Metadata: {
    downloadPreviews: true,
  },
  Performance: {
    maxHeapSize: 4096,
  },
  CloudSync: {
    enabled: true,
    projectRef: "jlwxwjgnujkenanohypr",
    supabaseUrl: "",
    publishableKey: "sb_publishable_HrdpFN4qdU010h9DNHR7OA_oZBZ1YLw",
    storageBucket: "atlas-cloud-saves",
  },
  F95Mirrors: {},
};

// ────────────────────────────────────────────────
// IPC HANDLERS
// ────────────────────────────────────────────────

ipcMain.handle("add-game", async (event, game) => {
  const recordId = await addGame(game);
  scheduleCloudLibraryCatalogSync("manual-add-game");
  return recordId;
});

ipcMain.handle("count-versions", async (_, recordId) => {
  return await countVersions(recordId);
});

ipcMain.handle("delete-version", async (_, { recordId, version }) => {
  const countBefore = await countVersions(recordId);
  const result = await deleteVersion(recordId, version);
  const countAfter = countBefore - (result.changes > 0 ? 1 : 0);

  return {
    success: result.changes > 0,
    wasLastVersion: countAfter === 0,
  };
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
      error: "F95 Game Zone App could not remove the selected game.",
    };
  }
});

ipcMain.handle("get-game", async (event, recordId) => {
  console.log("Resolved writable root", appPaths.root);
  return await getGame(recordId, appPaths);
});

ipcMain.handle("get-games", async (event, { offset, limit }) => {
  return await getGames(appPaths, offset, limit);
});

ipcMain.handle("remove-game", async (event, record_id) => {
  return removeGame(record_id);
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
  return appUpdater.checkForUpdates();
});

ipcMain.handle("download-app-update", async () => {
  return appUpdater.downloadUpdate();
});

ipcMain.handle("install-app-update", async () => {
  return appUpdater.installUpdate();
});

ipcMain.handle("check-updates", async () => {
  return appUpdater.checkForUpdates();
});

ipcMain.handle("check-db-updates", async () => {
  return checkDbUpdates(updatesDir, mainWindow);
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

ipcMain.handle("select-directory", async () => {
  const result = await dialog.showOpenDialog(importerWindow, {
    properties: ["openDirectory"],
  });
  return result.filePaths[0] || null;
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

ipcMain.handle("save-settings", async (event, settings) => {
  try {
    appConfig = settings;
    fs.writeFileSync(configPath, ini.stringify(settings));
    await broadcastCloudAuthState().catch((error) => {
      console.error(
        "[cloud.auth] Failed to refresh auth state after settings save:",
        error,
      );
    });
    return { success: true };
  } catch (err) {
    console.error("Error writing to config.ini:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-cloud-auth-state", async () => {
  try {
    const state = await getReadyCloudSaveService().getAuthState();
    return {
      success: true,
      state,
    };
  } catch (error) {
    console.error("[cloud.auth] Failed to get auth state:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      state: null,
    };
  }
});

ipcMain.handle("sign-in-cloud", async (_, payload) => {
  try {
    await getReadyCloudSaveService().signInWithPassword(payload || {});
    const state = await broadcastCloudAuthState();
    if (state?.authenticated) {
      scheduleCloudInstalledSavesReconcile("sign-in");
      scheduleCloudLibraryCatalogSync("sign-in");
    }
    return {
      success: true,
      state,
    };
  } catch (error) {
    console.error("[cloud.auth] Sign-in failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      state: null,
    };
  }
});

ipcMain.handle("sign-up-cloud", async (_, payload) => {
  try {
    const result = await getReadyCloudSaveService().signUpWithPassword(
      payload || {},
    );
    const state = await broadcastCloudAuthState();
    if (state?.authenticated) {
      scheduleCloudInstalledSavesReconcile("sign-up");
      scheduleCloudLibraryCatalogSync("sign-up");
    }
    return {
      success: true,
      state,
      requiresEmailConfirmation: !result?.session,
    };
  } catch (error) {
    console.error("[cloud.auth] Sign-up failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      state: null,
      requiresEmailConfirmation: false,
    };
  }
});

ipcMain.handle("sign-out-cloud", async () => {
  try {
    await getReadyCloudSaveService().signOut();
    const state = await broadcastCloudAuthState();
    return {
      success: true,
      state,
    };
  } catch (error) {
    console.error("[cloud.auth] Sign-out failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      state: null,
    };
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

ipcMain.handle("upload-cloud-saves", async (_, recordId) => {
  try {
    const result = await getReadyCloudSaveService().uploadGameSaves({
      recordId,
    });
    return {
      success: true,
      result,
    };
  } catch (error) {
    console.error("[cloud.sync] Upload failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      result: null,
    };
  }
});

ipcMain.handle("restore-cloud-saves", async (_, recordId) => {
  try {
    const result = await getReadyCloudSaveService().restoreGameSaves({
      recordId,
    });
    return {
      success: true,
      result,
    };
  } catch (error) {
    console.error("[cloud.sync] Restore failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      result: null,
    };
  }
});

ipcMain.handle("run-bulk-cloud-save-action", async (_, mode) => {
  try {
    const normalizedMode = mode === "upload" ? "upload" : "sync";
    const result = await runBulkCloudSaveAction(normalizedMode, {
      emitProgress: true,
    });
    return {
      success: true,
      result,
    };
  } catch (error) {
    console.error("[cloud.sync] Bulk action failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      result: null,
    };
  }
});

ipcMain.handle("get-cloud-library-catalog", async () => {
  try {
    const result = await getReadyCloudSaveService().getCloudLibraryCatalog();
    const materialized = await materializeCloudLibraryCatalogEntries(
      result?.remoteOnlyEntries || [],
      "cloud-catalog-panel-read",
    );
    if (
      materialized.added > 0 ||
      materialized.updated > 0 ||
      materialized.failed > 0
    ) {
      console.info("[cloud.library] catalog read materialized", {
        materialized,
      });
      broadcastGamesLibrarySynced({ materialized, reason: "panel-read" });
    }
    return {
      success: true,
      result: {
        ...result,
        materialized,
      },
    };
  } catch (error) {
    console.error("[cloud.library] Failed to load cloud catalog:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      result: null,
    };
  }
});

ipcMain.handle("sync-cloud-library-catalog", async () => {
  try {
    const result = await syncCloudLibraryCatalogNow("manual-panel-sync");
    return {
      success: true,
      result,
    };
  } catch (error) {
    console.error("[cloud.library] Failed to sync cloud catalog:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      result: null,
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

  const downloadUrl = normalizeF95DownloadUrl(payload?.downloadUrl);
  if (!downloadUrl) {
    return {
      success: false,
      error: "No download URL was provided.",
    };
  }

  let preparedDownload;
  try {
    preparedDownload = await prepareF95DownloadUrl(
      getReadyF95Session(),
      downloadUrl,
    );
  } catch (error) {
    console.error("[f95.download] Failed to resolve requested mirror:", error);
    if (
      error instanceof MirrorActionRequiredError ||
      error?.code === "captcha_required"
    ) {
      return {
        success: false,
        code: "captcha_required",
        error:
          error.userMessage ||
          "This mirror needs captcha confirmation before F95 Game Zone App can continue.",
        actionUrl: error.actionUrl || downloadUrl,
      };
    }
    return {
      success: false,
      error: getErrorMessage(
        error,
        "Failed to resolve the selected mirror.",
      ),
    };
  }

  const parsedThreadTitle = parseF95ThreadTitle(payload?.title || "");
  const resolvedTitle =
    parsedThreadTitle.title || sanitizePathSegment(payload?.title || "", "");
  const resolvedCreator =
    String(payload?.creator || "").trim() || parsedThreadTitle.creator || "";
  const resolvedVersion =
    String(payload?.version || "").trim() || parsedThreadTitle.version || "";
  const resolvedEngine = resolveEngineLabel(
    payload?.engine,
    parsedThreadTitle.engine,
  );

  const context = queueF95InstallContext({
    downloadUrl: preparedDownload.resolvedUrl,
    sourceHost: preparedDownload.sourceHost,
    threadUrl: payload?.threadUrl || "",
    title: resolvedTitle,
    creator: resolvedCreator,
    version: resolvedVersion,
    engine: resolvedEngine,
    downloadLabel: payload?.downloadLabel || "",
  });

  if (shouldUseDirectSessionDownload(preparedDownload.resolvedUrl)) {
    removeF95InstallContext(context);
    void startDirectF95Download(context, preparedDownload);
    return {
      success: true,
      queued: true,
      requestedUrl: context.requestedUrl,
      sourceHost: preparedDownload.sourceHost,
    };
  }

  try {
    getReadyF95Session().downloadURL(preparedDownload.resolvedUrl);
    return {
      success: true,
      queued: true,
      requestedUrl: context.requestedUrl,
      sourceHost: preparedDownload.sourceHost,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error, "Failed to start download.");
    removeF95InstallContext(context);
    f95DownloadsStore.fail(context.id, {
      title: context.metadata.title,
      text: `Failed to start download for ${context.metadata.title}`,
      error: errorMessage,
    });
    broadcastF95Downloads();

    return {
      success: false,
      error: errorMessage,
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
        "Failed to build Atlas matcher for importer scan:",
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

ipcMain.handle("get-selected-banner-template", async () => {
  try {
    if (!fs.existsSync(configPath)) {
      return "Default";
    }
    const configData = fs.readFileSync(configPath, "utf-8");
    const match = configData.match(/bannerTemplate=(.*)/);
    return match ? match[1].trim() : "Default";
  } catch (err) {
    console.error("Error reading selected banner template:", err);
    return "Default";
  }
});

ipcMain.handle("set-selected-banner-template", async (event, template) => {
  try {
    let configData = fs.existsSync(configPath)
      ? fs.readFileSync(configPath, "utf-8")
      : "";

    configData = configData.replace(/bannerTemplate=.*/g, "").trim();
    configData += (configData ? "\n" : "") + `bannerTemplate=${template}`;

    fs.writeFileSync(configPath, configData.trim());
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
      reuseKey: "__atlasF95BrowserWindow",
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
  if (!newPath || typeof newPath !== "string" || !fs.existsSync(newPath)) {
    return { success: false, error: "Invalid or non-existing path" };
  }

  try {
    if (!appConfig.Library) appConfig.Library = {};
    appConfig.Library.gameFolder = newPath;

    fs.writeFileSync(configPath, ini.stringify(appConfig));
    return { success: true, path: newPath };
  } catch (err) {
    console.error("Failed to save default game folder:", err);
    return { success: false, error: err.message };
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
    let progress = 0;
    let imageTotal = 1;
    await downloadImages(
      recordId,
      atlas_id,
      () => {
        event.sender.send("game-details-import-progress", {
          text: `Downloading images ${progress + 1}/${imageTotal}`,
          progress,
          total: imageTotal,
        });
      },
      true,
      false,
      1,
      false,
    );

    const bannerPath = await getBanner(recordId, appPaths, "large");
    event.sender.send("game-updated", recordId);
    progress++;
    event.sender.send("game-details-import-progress", {
      text: `Completed image download for ${progress}/${imageTotal}`,
      progress,
      total: imageTotal,
    });
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
    let progress = 0;
    let imageTotal = 1;
    await downloadImages(
      recordId,
      atlasId,
      (current, totalImages) => {
        event.sender.send("game-details-import-progress", {
          text: `Downloading previews  ${current}/${totalImages}`,
          current,
          total: totalImages,
        });
      },
      false,
      true,
      DEFAULT_PREVIEW_LIMIT,
      false,
    );

    const previewUrls = await getPreviews(recordId, appPaths);
    event.sender.send("game-updated", recordId);
    progress++;
    event.sender.send("game-details-import-progress", {
      text: `Completed previews download`,
      progress,
      total: imageTotal,
    });
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

ipcMain.handle("update-game", async (event, game) => {
  console.log("Handling update-game:", game);
  try {
    await updateGame(game);
    console.log("Game updated in database");
  } catch (err) {
    console.error("Error updating game:", err);
    throw err;
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
  return await startSteamScan(db, params, event);
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
          console.warn("Failed to enrich imported game metadata from Atlas:", {
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
          const selected = selectPreferredExecutable(execs, {
            title: resolvedGame.title,
            creator: resolvedGame.creator,
          });
          execPath = path.join(extractPath, selected);
          for (const [eng, patterns] of Object.entries(engineMap)) {
            if (patterns.some((p) => selected.toLowerCase().includes(p))) {
              resolvedGame.engine = eng;
              break;
            }
          }
          resolvedGame.executables = execs.map((e) => ({ key: e, value: e }));
          resolvedGame.selectedValue = selected;
        }
      }

      if (scanSize) {
        size = getFolderSize(gamePath);
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
      const existingGame = findPreferredGameByPath(existingGamesByPath, gamePath);
      let recordId;

      if (existingGame?.record_id) {
        console.log("Updating existing game for imported path");
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
      if (resolvedGame.atlasId && existingGame?.atlas_id !== resolvedGame.atlasId) {
        try {
          await addAtlasMapping(recordId, resolvedGame.atlasId);
          console.log("mapping added");
        } catch (err) {
          console.warn("Failed to add atlas mapping:", err);
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
  if (results.some((result) => result.success)) {
    scheduleCloudLibraryCatalogSync("post-import-batch");
  }

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
    console.warn("[library.duplicates] Failed to remove some duplicate records", {
      failed: cleanup.failed,
    });
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

function normalizeScanLibraryRequest(request) {
  const normalizedRequest =
    request && typeof request === "object" ? request : {};
  const resetCache = Boolean(normalizedRequest.resetCache);

  return {
    resetCache,
    forceRescan: resetCache || Boolean(normalizedRequest.forceRescan),
  };
}

ipcMain.handle("scan-library", async (event, request) => {
  const sessionResult = beginScanSession(event.sender, "library_scan");

  if (!sessionResult.success) {
    return sessionResult;
  }

  const scanRequest = normalizeScanLibraryRequest(request);

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

  try {
    if (scanRequest.resetCache) {
      mainWindow.webContents.send("import-progress", {
        text: "Resetting library scan cache...",
        progress: 0,
        total: 1,
      });

      const resetResult = await resetScanCache(appPaths);
      if (!resetResult.success) {
        return {
          success: false,
          error: resetResult.error.message,
          warningsCount: 0,
          imported: 0,
          scanned: 0,
        };
      }

      mainWindow.webContents.send("import-progress", {
        text: `Library scan cache reset: ${resetResult.clearedCandidates} candidates and ${resetResult.clearedJobs} jobs cleared`,
        progress: 0,
        total: 1,
      });
    }

    const defaultLibraryScanParams = getDefaultLibraryScanParams();
    const scanResult = await startEnabledSourcesScan(scanRelay, appPaths, {
      ...defaultLibraryScanParams,
      forceRescan: scanRequest.forceRescan,
      scanSession: sessionResult.session,
    });

    if (
      !scanResult.success &&
      (!scanResult.games || scanResult.games.length === 0)
    ) {
      return scanResult;
    }

    if (scanResult.cancelled) {
      mainWindow.webContents.send("import-progress", {
        text: "Library rescan cancelled",
        progress: 0,
        total: 1,
      });
      return {
        success: false,
        cancelled: true,
        warningsCount: scanResult.warningsCount || 0,
        imported: 0,
        scanned: scanResult.games?.length || 0,
      };
    }

    if (!scanResult.games || scanResult.games.length === 0) {
      const duplicateCleanup = await runLibraryDuplicateCleanup();
      mainWindow.webContents.send("import-progress", {
        text:
          scanResult.warningsCount > 0
            ? `Scan complete. No new games found. Warnings: ${scanResult.warningsCount}${duplicateCleanup.removed.length > 0 ? `. Duplicates cleaned: ${duplicateCleanup.removed.length}` : ""}`
            : `Scan complete. No new games found${duplicateCleanup.removed.length > 0 ? `. Duplicates cleaned: ${duplicateCleanup.removed.length}` : ""}.`,
        progress: 0,
        total: 0,
      });
      return {
        success: true,
        warningsCount: scanResult.warningsCount || 0,
        imported: 0,
        scanned: 0,
        duplicateRecordsRemoved: duplicateCleanup.removed.length,
      };
    }

    const { importableGames, reviewGames } = splitAutoImportableScanGames(
      scanResult.games,
    );

    if (importableGames.length === 0) {
      const duplicateCleanup = await runLibraryDuplicateCleanup();
      mainWindow.webContents.send("import-progress", {
        text:
          reviewGames.length > 0
            ? `Scan complete. ${reviewGames.length} candidate(s) need review before import.${duplicateCleanup.removed.length > 0 ? ` Duplicates cleaned: ${duplicateCleanup.removed.length}.` : ""}`
            : `Scan complete. No auto-importable games found.${duplicateCleanup.removed.length > 0 ? ` Duplicates cleaned: ${duplicateCleanup.removed.length}.` : ""}`,
        progress: 0,
        total: scanResult.games.length || 0,
      });

      return {
        success: true,
        warningsCount: scanResult.warningsCount || 0,
        scanned: scanResult.games.length,
        imported: 0,
        reviewQueued: reviewGames.length,
        errorsCount: scanResult.errorsCount || 0,
        duplicateRecordsRemoved: duplicateCleanup.removed.length,
      };
    }

    if (reviewGames.length > 0) {
      mainWindow.webContents.send("import-progress", {
        text: `${reviewGames.length} candidate(s) need review and will not be auto-imported.`,
        progress: 0,
        total: scanResult.games.length || 0,
      });
    }

    const importResults = await importGamesInternal({
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
    const duplicateCleanup = await runLibraryDuplicateCleanup();

    return {
      success: scanResult.success,
      warningsCount: scanResult.warningsCount || 0,
      scanned: scanResult.games.length,
      imported: importResults.filter((item) => item.success).length,
      reviewQueued: reviewGames.length,
      errorsCount: scanResult.errorsCount || 0,
      duplicateRecordsRemoved: duplicateCleanup.removed.length,
    };
  } finally {
    endScanSession(event.sender);
  }
});

// ────────────────────────────────────────────────
// UTIL FUNCTIONS
// ────────────────────────────────────────────────

const engineMap = {
  rpgm: [
    "rpgmv.exe",
    "rpgmk.exe",
    "rpgvx.exe",
    "rpgvxace.exe",
    "rpgmktranspatch.exe",
  ],
  renpy: ["renpy.exe", "renpy.sh"],
  unity: ["unityplayer.dll", "unitycrashhandler64.exe"],
  html: ["index.html"],
  flash: [".swf"],
};

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, "utf8");
      appConfig = ini.parse(configData);
    } else {
      appConfig = defaultConfig;
      fs.writeFileSync(configPath, ini.stringify(appConfig));
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
      CloudSync: {
        ...defaultConfig.CloudSync,
        ...(appConfig?.CloudSync || {}),
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
  fs.writeFileSync(configPath, ini.stringify(appConfig));
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

function getFolderSize(dir) {
  let size = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      fs.readdirSync(current).forEach((f) => stack.push(path.join(current, f)));
    } else {
      size += stat.size;
    }
  }
  return size;
}

function getVersionsMissingStoredFolderSize(limit = 200) {
  return new Promise((resolve, reject) => {
    db.all(
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
      size = getFolderSize(gamePath);
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

function findExecutables(dir, extensions) {
  const execs = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const items = fs.readdirSync(current, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(full);
      } else {
        const ext = path.extname(item.name).toLowerCase().slice(1);
        if (extensions.includes(ext)) {
          execs.push(full.replace(dir + path.sep, ""));
        }
      }
    }
  }
  return execs;
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
        require("electron")
          .webContents.getAllWebContents()
          .forEach((wc) => {
            wc.send("game-details-import-progress", {
              text: `Completed banner download ${imageProgress}/${totalImages}`,
              progress: imageProgress,
              total: totalImages,
            });
          });
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
        require("electron")
          .webContents.getAllWebContents()
          .forEach((wc) => {
            wc.send("game-details-import-progress", {
              text: `Completed preview download ${imageProgress}/${totalImages}`,
              progress: imageProgress,
              total: totalImages,
            });
          });
        await delay(500);
      }
    } catch (err) {
      console.error(`Error downloading or converting screen ${i + 1}:`, err);
    }
  }
}

function getCachedPreviewCount(recordId) {
  return new Promise((resolve, reject) => {
    db.get(
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
    case "properties":
      console.log("Creating GameDetailsWindow for recordId:", data.recordId);
      createGameDetailsWindow(data.recordId);
      break;
    case "removeGame":
    case "updateGame":
    case "rescanLibrary":
    case "resetCacheAndRescanLibrary":
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

app.whenReady().then(async () => {
  loadConfig();
  databaseConnection = await initializeDatabase(appPaths);
  cloudSaveService = createCloudSaveService({
    appPaths,
    getConfig: () => appConfig,
    getSaveProfileSnapshot: (recordId) =>
      getSaveProfileSnapshot(appPaths, databaseConnection, recordId),
    refreshSaveProfiles: (recordId) =>
      refreshSaveProfiles(appPaths, databaseConnection, recordId),
    listGames: () => getGames(appPaths, 0, null),
    upsertSaveSyncState: (input) =>
      upsertSaveSyncState(databaseConnection, input),
  });
  cloudSaveService.onAuthStateChange(() => {
    broadcastCloudAuthState().catch((error) => {
      console.error("[cloud.auth] Failed to broadcast auth state:", error);
    });
  });
  f95Session = getReadyF95Session();
  attachF95DownloadListener();
  f95Session.cookies.on("changed", () => {
    broadcastF95AuthState().catch((error) => {
      console.error("[f95.auth] Failed to broadcast auth state:", error);
    });
  });
  createWindow();
  setTimeout(() => {
    backfillMissingVersionFolderSizes().then((result) => {
      if (result.updated > 0) {
        console.log(
          `[library.size] Backfilled folder size for ${result.updated} version records (scanned ${result.scanned}).`,
        );
      }
    }).catch((error) => {
      console.warn("[library.size] Folder-size backfill failed:", error);
    });
  }, 1200);
  const initialCloudAuthState = await broadcastCloudAuthState().catch((error) => {
    console.error("[cloud.auth] Failed to initialize auth state:", error);
    return null;
  });
  if (initialCloudAuthState?.authenticated) {
    scheduleCloudInstalledSavesReconcile("startup");
    scheduleCloudLibraryCatalogSync("startup");
  }
  broadcastF95AuthState().catch((error) => {
    console.error("[f95.auth] Failed to initialize auth state:", error);
  });
  appUpdater.checkForUpdates().catch((error) => {
    console.error("Failed to initialize app updater:", error);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
