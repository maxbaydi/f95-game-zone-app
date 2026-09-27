const { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } =
  window.React;
const { createRoot } = window.ReactDOM;
const { AutoSizer, Grid } = window.ReactVirtualized;

// Motion/toast runtime from core/ui/atlas-react.js and core/ui/atlas-ui.js.
// The fallbacks keep the app usable if either script failed to load.
const appMotion = window.AtlasMotion || {
  usePresence: (isOpen) => ({
    isMounted: Boolean(isOpen),
    state: isOpen ? "open" : "closed",
  }),
  useSnapshot: (value) => value,
  useEscape: () => {},
};
const appToast = window.AtlasToast || {
  show: (options) => console.info(options),
  update: () => {},
  dismiss: () => {},
  success: (message) => console.info(message),
  info: (message) => console.info(message),
  warning: (message) => console.warn(message),
  error: (message) => window.alert(message),
  loading: (message) => console.info(message),
};
const AppSafe =
  window.AtlasSafe || (({ children }) => (children === undefined ? null : children));
const CARD_STAGGER_LIMIT = 18;
const LIST_STAGGER_LIMIT = 24;

const SECTION_LIBRARY = "library";
const SECTION_UPDATES = "updates";
const SECTION_SEARCH = "search";
const SECTION_SETTINGS = "settings";

const createDefaultSiteSearchFilters = () => ({
  text: "",
  type: "title",
  category: [],
  engine: [],
  status: [],
  censored: [],
  language: [],
  tags: [],
  sort: "date",
  dateLimit: 0,
  tagLogic: "AND",
  updateAvailable: false,
});

const DEFAULT_SITE_SEARCH_FILTERS = createDefaultSiteSearchFilters();

const createDefaultF95UpdateModalState = () => ({
  isOpen: false,
  isLoading: false,
  isInstalling: false,
  error: "",
  captchaUrl: "",
  game: null,
  thread: null,
  selectedLinkUrl: "",
});

const useF95InstallAttemptsHook =
  window.useF95InstallAttempts ||
  (() => ({
    attemptEvents: [],
    beginAttempts: () => {},
    resetAttempts: () => {},
  }));

const DELETE_GAME_MODES = window.DeleteGameModes || {
  LIBRARY_ONLY: "library_only",
  DELETE_FILES_KEEP_SAVES: "delete_files_keep_saves",
  DELETE_FILES_AND_SAVES: "delete_files_and_saves",
};

const createDefaultDeleteGameModalState = () => ({
  isOpen: false,
  isLoading: false,
  isDeleting: false,
  error: "",
  game: null,
  mode: DELETE_GAME_MODES.DELETE_FILES_KEEP_SAVES,
  installPaths: [],
  saveProfiles: [],
});

const createDefaultHeaderCloudAuthState = () => ({
  configured: false,
  authenticated: false,
  user: null,
  error: "",
  settings: {},
});

const getRendererErrorMessage = (error, fallbackMessage) => {
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
};

// Subscribes to a preload event without assuming the bridge has it (older
// builds, the browser preview). Returns an unsubscribe function.
const subscribeElectronEvent = (method, channel, callback) => {
  const api = window.electronAPI;
  if (!api || typeof api[method] !== "function") {
    console.warn(`[app] electronAPI.${method} is unavailable; skipping.`);
    return () => {};
  }

  try {
    const unsubscribe = api[method](callback);
    if (typeof unsubscribe === "function") {
      return unsubscribe;
    }
  } catch (error) {
    console.error(`[app] Failed to subscribe via ${method}:`, error);
    return () => {};
  }

  return () => {
    if (channel && typeof api.removeAllListeners === "function") {
      api.removeAllListeners(channel);
    }
  };
};

const getDisplayTitle = (game) =>
  game?.displayTitle || game?.title || "Unknown";
const getDisplayCreator = (game) =>
  game?.displayCreator || game?.creator || "Unknown";
const {
  LIBRARY_SORT_MODES = {
    INSTALLED_NEWEST: "installedNewest",
  },
  LIBRARY_SORT_OPTIONS = [],
  getLibrarySortDescription = () => "",
  sortLibraryGames = (games) => [...games],
} = window.librarySortUtils || {};
const { getCaptchaContinuationUrl: sharedGetF95CaptchaContinuationUrl } =
  window.f95CaptchaFlow || {};
const getF95CaptchaContinuationUrl =
  sharedGetF95CaptchaContinuationUrl ||
  ((actionUrl, currentUrl) => {
    const normalizedActionUrl = String(actionUrl || "").trim();
    const normalizedCurrentUrl = String(currentUrl || "").trim();
    if (
      !normalizedActionUrl ||
      !normalizedCurrentUrl ||
      normalizedActionUrl === normalizedCurrentUrl ||
      /^about:/i.test(normalizedCurrentUrl)
    ) {
      return "";
    }
    return normalizedCurrentUrl;
  });

const {
  LIBRARY_INSTALL_FILTERS = {
    ALL: "all",
    INSTALLED: "installed",
    MISSING: "missing",
    NOT_INSTALLED: "not_installed",
  },
  LIBRARY_INSTALL_FILTER_OPTIONS = [],
  matchesLibraryInstallFilter = () => true,
  countLibraryInstallStates = () => ({
    installed: 0,
    missing: 0,
    not_installed: 0,
  }),
} = window.libraryInstallState || {};

const LIBRARY_SCAN_MODE_START_TEXT = {
  incremental: "Starting library rescan (looking for new games)...",
  refresh: "Starting library rescan (refreshing installed games)...",
  reset_cache: "Starting reset-cache library rescan...",
  reset_library:
    "Starting library rebuild (backing up and clearing the index)...",
};

const IMPORT_PROGRESS_TERMINAL_TOAST_MS = 2000;
const GRID_SCROLLBAR_GUTTER_PX = 8;

const isTerminalImportProgressToast = (text) => {
  const t = String(text || "").trim();
  if (!t) {
    return false;
  }
  if (/^starting library rescan/i.test(t)) {
    return false;
  }
  if (
    /^scanning source \d+\//i.test(t) ||
    /^scanning configured sources/i.test(t)
  ) {
    return false;
  }
  if (/^cancelling library scan/i.test(t)) {
    return false;
  }
  return (
    /^scan complete\./i.test(t) ||
    /^library rescan complete:/i.test(t) ||
    /^library rescan cancelled$/i.test(t) ||
    /^library rescan finished with errors/i.test(t) ||
    /^library rescan error:/i.test(t) ||
    /^cancel failed:/i.test(t) ||
    /^no active scan to cancel$/i.test(t)
  );
};

const getGameInstallPaths = (game) => {
  const seenPaths = new Set();
  const installPaths = [];

  for (const version of Array.isArray(game?.versions) ? game.versions : []) {
    const targetPath = String(version?.game_path || "").trim();
    if (!targetPath || seenPaths.has(targetPath)) {
      continue;
    }

    seenPaths.add(targetPath);
    installPaths.push(targetPath);
  }

  return installPaths;
};

const filterLocalGames = (
  games,
  query,
  updatesOnly = false,
  installFilter = LIBRARY_INSTALL_FILTERS.ALL,
) => {
  const normalizedQuery = (query || "").trim().toLowerCase();
  let result = [...games];

  if (updatesOnly) {
    result = result.filter((game) => game.isUpdateAvailable === true);
  }

  if (installFilter && installFilter !== LIBRARY_INSTALL_FILTERS.ALL) {
    result = result.filter((game) =>
      matchesLibraryInstallFilter(game, installFilter),
    );
  }

  if (normalizedQuery) {
    result = result.filter((game) => {
      const title = getDisplayTitle(game).toLowerCase();
      const creator = getDisplayCreator(game).toLowerCase();
      return (
        title.includes(normalizedQuery) || creator.includes(normalizedQuery)
      );
    });
  }

  return result;
};

const countActiveFilters = (filters) => {
  let count = 0;

  if (filters.text) {
    count += 1;
  }

  if (filters.type !== "title") {
    count += 1;
  }

  if (filters.category.length > 0) {
    count += filters.category.length;
  }

  if (filters.engine.length > 0) {
    count += filters.engine.length;
  }

  if (filters.status.length > 0) {
    count += filters.status.length;
  }

  if (filters.censored.length > 0) {
    count += filters.censored.length;
  }

  if (filters.language.length > 0) {
    count += filters.language.length;
  }

  if (filters.tags.length > 0) {
    count += filters.tags.length;
  }

  if (filters.dateLimit > 0) {
    count += 1;
  }

  if (filters.updateAvailable) {
    count += 1;
  }

  return count;
};

const clampPercent = (value) => Math.max(0, Math.min(100, Number(value) || 0));

// Floating progress bar above the footer. Stays mounted while it animates out
// so the last message fades instead of vanishing.
const StatusDockBar = ({ status, counterLabel }) => {
  const isOpen = Boolean(status?.text);
  const presence = appMotion.usePresence(isOpen);
  const snapshot = appMotion.useSnapshot(status, isOpen);

  if (!presence.isMounted || !snapshot?.text) {
    return null;
  }

  const total = Number(snapshot.total) || 0;
  const progress = Number(snapshot.progress) || 0;
  const percent = total > 0 ? clampPercent((progress / total) * 100) : 0;
  const isError = /error|failed/i.test(snapshot.text);
  const isFinished =
    !isError && total > 0 && progress >= total && /complete|finished|done/i.test(snapshot.text);
  const isIndeterminate = !isError && !isFinished && (total <= 1 || progress <= 0);

  return (
    <div
      className="atlas-rise pointer-events-auto flex w-full items-center justify-center border border-border bg-primary/85 p-2 shadow-glass backdrop-blur-xl"
      data-state={presence.state}
      role="status"
    >
      <div className="flex w-full items-center gap-3">
        <span
          className={`material-symbols-outlined shrink-0 text-[18px] ${
            isError ? "text-red-300" : isFinished ? "text-emerald-300" : "text-accent"
          }`}
          aria-hidden
        >
          {isError ? "error" : isFinished ? "check_circle" : "sync"}
        </span>
        <span className="min-w-0 flex-1 text-[11px] leading-snug text-text/90">
          {snapshot.text}
        </span>
        <div className="relative w-[min(300px,40%)] shrink-0">
          <div
            className={`h-4 overflow-hidden bg-black/40 ring-1 ring-inset ring-border ${
              isIndeterminate ? "atlas-progress-indeterminate atlas-keep-motion" : ""
            }`}
          >
            <div
              className={`atlas-progress-fill h-full ${
                isError
                  ? "bg-red-500/80"
                  : isFinished
                    ? "bg-emerald-500/80"
                    : "atlas-progress-fill--active atlas-keep-motion bg-gradient-to-r from-accent to-accentBar shadow-glow-accent"
              }`}
              style={{ width: `${isIndeterminate ? 0 : percent}%` }}
            ></div>
          </div>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-medium tabular-nums text-text">
            {total > 0 ? `${counterLabel} ${progress}/${total}` : counterLabel}
          </span>
        </div>
      </div>
    </div>
  );
};

const LibrarySkeleton = () => (
  <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4 px-3 pb-3">
    <div className="atlas-skeleton h-4 w-40" />
    <div className="flex flex-wrap gap-4 px-1">
      {Array.from({ length: 12 }).map((_, index) => (
        <div
          key={index}
          className="atlas-card-enter border border-border/60 bg-black/20"
          style={{ width: 252, height: 208, "--atlas-index": index }}
        >
          <div className="atlas-skeleton h-[108px] w-full" />
          <div className="space-y-2 p-2.5">
            <div className="atlas-skeleton h-3 w-24" />
            <div className="atlas-skeleton h-4 w-44" />
            <div className="atlas-skeleton mt-6 h-5 w-full" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const App = () => {
  const [games, setGames] = useState([]);
  const [isGamesLoading, setIsGamesLoading] = useState(true);
  const [selectedGame, setSelectedGame] = useState(null);
  const [version, setVersion] = useState("0.0.0");
  const [importStatus, setImportStatus] = useState({
    text: "",
    progress: 0,
    total: 0,
  });
  const [dbUpdateStatus, setDbUpdateStatus] = useState({
    text: "",
    progress: 0,
    total: 0,
  });
  const [appUpdateState, setAppUpdateState] = useState({
    status: "idle",
    currentVersion: "0.0.0",
    availableVersion: null,
    percent: 0,
    error: null,
    checkedAt: null,
    releaseNotes: null,
    releaseUrl: null,
    supportsDownload: false,
    supportsInstall: false,
  });
  const [importProgress, setImportProgress] = useState({
    text: "",
    progress: 0,
    total: 0,
  });
  const [isMaximized, setIsMaximized] = useState(false);
  const [bannerSize, setBannerSize] = useState({
    bannerWidth: 252,
    bannerHeight: 208,
  });
  const [columnCount, setColumnCount] = useState(1);
  const [totalVersions, setTotalVersions] = useState(0);
  const [showGameList, setShowGameList] = useState(true);
  const [activeSection, setActiveSection] = useState(SECTION_LIBRARY);
  const [isLibraryScanRunning, setIsLibraryScanRunning] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [discoveryCandidates, setDiscoveryCandidates] = useState([]);
  const [isDiscoveryLoading, setIsDiscoveryLoading] = useState(false);
  const [scanSources, setScanSources] = useState([]);
  const [scanJobs, setScanJobs] = useState([]);
  const [selectedGameDetails, setSelectedGameDetails] = useState(null);
  const [selectedGamePreviews, setSelectedGamePreviews] = useState([]);
  const [isSelectedGameLoading, setIsSelectedGameLoading] = useState(false);
  const [previewModalIndex, setPreviewModalIndex] = useState(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySortMode, setLibrarySortMode] = useState(
    LIBRARY_SORT_MODES.INSTALLED_NEWEST || "installedNewest",
  );
  const [libraryInstallFilter, setLibraryInstallFilter] = useState(
    LIBRARY_INSTALL_FILTERS.ALL,
  );
  const [libraryResetModal, setLibraryResetModal] = useState({
    isOpen: false,
    isRunning: false,
    error: "",
  });
  const [siteSearchFilters, setSiteSearchFilters] = useState(
    createDefaultSiteSearchFilters,
  );
  const [siteSearchResults, setSiteSearchResults] = useState([]);
  const [siteSearchTotal, setSiteSearchTotal] = useState(0);
  const [siteSearchLimit, setSiteSearchLimit] = useState(120);
  const [isSiteSearchLimited, setIsSiteSearchLimited] = useState(false);
  const [isSiteSearchLoading, setIsSiteSearchLoading] = useState(false);
  const [siteSearchError, setSiteSearchError] = useState("");
  const [downloadsPanelOpen, setDownloadsPanelOpen] = useState(false);
  const [f95Downloads, setF95Downloads] = useState({
    items: [],
    activeCount: 0,
  });
  const [f95UpdateModal, setF95UpdateModal] = useState(
    createDefaultF95UpdateModalState,
  );
  const {
    attemptEvents: f95UpdateAttemptEvents,
    beginAttempts: beginF95UpdateAttempts,
    resetAttempts: resetF95UpdateAttempts,
  } = useF95InstallAttemptsHook();
  const [onboarding, setOnboarding] = useState({
    isOpen: false,
    step: "welcome",
  });
  const [settingsPageRequest, setSettingsPageRequest] = useState({
    page: "general",
    nonce: 0,
  });
  const [deleteGameModal, setDeleteGameModal] = useState(
    createDefaultDeleteGameModalState,
  );
  const [defaultGameFolder, setDefaultGameFolder] = useState("");
  const [cloudAuthState, setCloudAuthState] = useState(
    createDefaultHeaderCloudAuthState,
  );
  const [isCloudAuthOpen, setIsCloudAuthOpen] = useState(false);
  const gridRef = useRef(null);
  const gameGridRef = useRef(null);
  const resizeGridFrameRef = useRef(null);
  const selectedGameRef = useRef(null);
  const f95UpdateModalRef = useRef(createDefaultF95UpdateModalState());
  const f95CaptchaRetryKeyRef = useRef("");
  const deleteGameModalRef = useRef(createDefaultDeleteGameModalState());
  const isLibraryScanRunningRef = useRef(false);
  const showDiscoveryRef = useRef(false);
  const downloadStatusRef = useRef(null);
  const deferredLibraryQuery = useDeferredValue(libraryQuery);

  const refreshLibraryGrid = useCallback(() => {
    if (!gridRef.current) {
      return;
    }

    gridRef.current.recomputeGridSize?.();
  }, []);

  const getColumnCount = useCallback(
    (width) => {
      const containerWidth =
        width ??
        gameGridRef.current?.clientWidth ??
        Math.max(0, window.innerWidth - 260);
      const adjustedWidth = Math.max(
        0,
        containerWidth - GRID_SCROLLBAR_GUTTER_PX,
      );
      return Math.max(
        1,
        Math.floor(adjustedWidth / (bannerSize.bannerWidth + 8)),
      );
    },
    [bannerSize.bannerWidth],
  );

  const runGridResizeSync = useCallback(() => {
    const containerWidth =
      gameGridRef.current?.clientWidth ?? Math.max(0, window.innerWidth - 260);
    const nextColumnCount = getColumnCount(containerWidth);
    setColumnCount((current) =>
      current === nextColumnCount ? current : nextColumnCount,
    );
    refreshLibraryGrid();
  }, [getColumnCount, refreshLibraryGrid]);

  const scheduleGridResizeSync = useCallback(() => {
    if (resizeGridFrameRef.current !== null) {
      return;
    }
    resizeGridFrameRef.current = window.requestAnimationFrame(() => {
      resizeGridFrameRef.current = null;
      runGridResizeSync();
    });
  }, [runGridResizeSync]);

  // Debounce function for game refresh
  const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), delay);
    };
  };

  useEffect(() => {
    selectedGameRef.current = selectedGame;
  }, [selectedGame]);

  useEffect(() => {
    f95UpdateModalRef.current = f95UpdateModal;
    if (!f95UpdateModal.captchaUrl) {
      f95CaptchaRetryKeyRef.current = "";
    }
  }, [f95UpdateModal]);

  useEffect(() => {
    deleteGameModalRef.current = deleteGameModal;
  }, [deleteGameModal]);

  useEffect(() => {
    isLibraryScanRunningRef.current = isLibraryScanRunning;
  }, [isLibraryScanRunning]);

  useEffect(() => {
    showDiscoveryRef.current = showDiscovery;
  }, [showDiscovery]);

  useEffect(() => {
    return () => {
      if (resizeGridFrameRef.current === null) {
        return;
      }
      window.cancelAnimationFrame(resizeGridFrameRef.current);
      resizeGridFrameRef.current = null;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const announceDownloadTransitions = (items) => {
      const previousStatuses = downloadStatusRef.current;
      const nextStatuses = new Map(
        items.map((item) => [item.id, String(item.status || "")]),
      );
      downloadStatusRef.current = nextStatuses;

      // The first snapshot only seeds the map; history is not re-announced.
      if (!previousStatuses) {
        return;
      }

      for (const item of items) {
        const previousStatus = previousStatuses.get(item.id);
        const nextStatus = String(item.status || "");
        if (!previousStatus || previousStatus === nextStatus) {
          continue;
        }

        const title = item.title || item.fileName || "Download";
        if (nextStatus === "completed") {
          appToast.success(`${title} is installed and ready to play.`, {
            title: "Install complete",
          });
        } else if (nextStatus === "error") {
          appToast.error(item.error || item.text || "The download failed.", {
            title: `${title} failed`,
            actions: [
              {
                label: "Open downloads",
                onClick: () => setDownloadsPanelOpen(true),
              },
            ],
          });
        } else if (nextStatus === "installing") {
          appToast.info(`Unpacking ${title} into your library…`, {
            title: "Download finished",
            duration: 3000,
          });
        }
      }
    };

    const applyDownloadsSnapshot = (payload) => {
      if (!mounted || !payload) {
        return;
      }

      const items = Array.isArray(payload.items) ? payload.items : [];
      announceDownloadTransitions(items);
      setF95Downloads({
        items,
        activeCount: Number(payload.activeCount) || 0,
      });
    };

    window.electronAPI
      .getF95Downloads()
      .then(applyDownloadsSnapshot)
      .catch((error) => {
        console.error("Failed to load F95 downloads:", error);
      });

    const unsubscribeDownloads = subscribeElectronEvent(
      "onF95DownloadsChanged",
      "f95-downloads-changed",
      (payload) => {
        applyDownloadsSnapshot(payload);
      },
    );

    return () => {
      mounted = false;
      unsubscribeDownloads();
    };
  }, []);

  useEffect(() => {
    if (
      activeSection !== SECTION_LIBRARY ||
      isGamesLoading ||
      games.length > 0
    ) {
      return;
    }
    window.electronAPI
      .getScanSources()
      .then((result) => result?.success && setScanSources(result.sources || []))
      .catch(() => {});
  }, [activeSection, isGamesLoading, games.length]);

  useEffect(
    () =>
      subscribeElectronEvent(
        "onSettingsChanged",
        "settings-changed",
        (config) => {
          if (!config) {
            return;
          }
          setShowGameList(config.Interface?.showGameList !== false);
          setDefaultGameFolder(String(config.Library?.gameFolder || "").trim());
        },
      ),
    [],
  );

  const handleSiteFilterChange = (filters) => {
    setSiteSearchFilters(filters);
  };

  const openSearchWorkspace = () => {
    setActiveSection(SECTION_SEARCH);
  };

  const handleSearchTextChange = (value) => {
    if (activeSection === SECTION_SEARCH) {
      return;
    }

    setLibraryQuery(value);
  };

  const handleSidebarSelect = (sectionId) => {
    setActiveSection(sectionId);
  };

  const closeSelectedGamePanel = () => {
    setSelectedGame(null);
    setSelectedGameDetails(null);
    setSelectedGamePreviews([]);
  };

  const openSelectedGamePage = () => {
    if (selectedGameDetails?.siteUrl) {
      window.electronAPI.openExternalUrl(selectedGameDetails.siteUrl);
    }
  };

  const closeF95UpdateModal = () => {
    resetF95UpdateAttempts();
    setF95UpdateModal(createDefaultF95UpdateModalState());
  };

  const closeDeleteGameModal = () => {
    setDeleteGameModal(createDefaultDeleteGameModalState());
  };

  const openDeleteGameModal = async (gameInput) => {
    const targetGame = gameInput || selectedGameDetails || selectedGame;
    if (!targetGame?.record_id) {
      return;
    }

    const nextModalState = {
      isOpen: true,
      isLoading: true,
      isDeleting: false,
      error: "",
      game: targetGame,
      mode: DELETE_GAME_MODES.DELETE_FILES_KEEP_SAVES,
      installPaths: getGameInstallPaths(targetGame),
      saveProfiles: [],
    };

    setDeleteGameModal(nextModalState);

    try {
      const snapshotResult = await window.electronAPI.getSaveProfileSnapshot(
        targetGame.record_id,
      );

      setDeleteGameModal((previous) => ({
        ...previous,
        isLoading: false,
        error: snapshotResult?.success
          ? ""
          : snapshotResult?.error ||
            "Couldn't check where this game keeps its saves.",
        saveProfiles: snapshotResult?.success
          ? snapshotResult?.snapshot?.profiles || []
          : [],
      }));
    } catch (error) {
      console.error("Failed to load delete-game snapshot:", error);
      setDeleteGameModal((previous) => ({
        ...previous,
        isLoading: false,
        error:
          error.message ||
          "Couldn't check where this game keeps its saves.",
        saveProfiles: [],
      }));
    }
  };

  const confirmDeleteGame = async () => {
    if (!deleteGameModal.game?.record_id) {
      return;
    }

    setDeleteGameModal((previous) => ({
      ...previous,
      isDeleting: true,
      error: "",
    }));

    try {
      const result = await window.electronAPI.removeLibraryGame({
        recordId: deleteGameModal.game.record_id,
        mode: deleteGameModal.mode,
      });

      if (!result?.success) {
        setDeleteGameModal((previous) => ({
          ...previous,
          isDeleting: false,
          error:
            result?.error || "Couldn't remove this game.",
        }));
        return;
      }

      closeDeleteGameModal();

      const removedTitle = getDisplayTitle(deleteGameModal.game);
      if (result.warnings?.length) {
        appToast.warning(result.warnings.join("\n"), {
          title: `${removedTitle} removed with warnings`,
        });
      } else if (
        deleteGameModal.mode === DELETE_GAME_MODES.LIBRARY_ONLY
      ) {
        appToast.success(
          "It was removed from your library. Nothing on this PC was deleted.",
          { title: `${removedTitle} removed` },
        );
      } else if (
        deleteGameModal.mode === DELETE_GAME_MODES.DELETE_FILES_KEEP_SAVES
      ) {
        appToast.success("The game files were removed. Your progress was kept.", {
          title: `${removedTitle} deleted`,
        });
      } else if (
        deleteGameModal.mode === DELETE_GAME_MODES.DELETE_FILES_AND_SAVES
      ) {
        appToast.success("The game files and saves were removed.", {
          title: `${removedTitle} deleted`,
        });
      }
    } catch (error) {
      console.error("Failed to delete game:", error);
      setDeleteGameModal((previous) => ({
        ...previous,
        isDeleting: false,
        error: error.message || "Couldn't remove this game.",
      }));
    }
  };

  const handleGameUpdate = async (game) => {
    resetF95UpdateAttempts();

    if (!game?.siteUrl) {
      setF95UpdateModal({
        ...createDefaultF95UpdateModalState(),
        isOpen: true,
        error: "This game does not have a valid F95 thread URL for updates.",
        game,
      });
      return;
    }

    setF95UpdateModal({
      isOpen: true,
      isLoading: true,
      isInstalling: false,
      error: "",
      captchaUrl: "",
      game,
      thread: null,
      selectedLinkUrl: "",
    });

    try {
      const payload = await window.electronAPI.inspectF95Thread({
        threadUrl: game.siteUrl,
      });

      if (!payload?.success) {
        setF95UpdateModal({
          isOpen: true,
          isLoading: false,
          isInstalling: false,
          error: payload?.error || "Failed to inspect the live F95 thread.",
          captchaUrl: "",
          game,
          thread: null,
          selectedLinkUrl: "",
        });
        return;
      }

      const selectedLinkUrl =
        payload.preferredLinkUrl || payload.links?.[0]?.url || "";

      setF95UpdateModal({
        isOpen: true,
        isLoading: false,
        isInstalling: false,
        error: "",
        captchaUrl: "",
        game,
        thread: payload,
        selectedLinkUrl,
      });
    } catch (error) {
      console.error("Failed to prepare F95 update:", error);
      setF95UpdateModal({
        isOpen: true,
        isLoading: false,
        isInstalling: false,
        error: error.message || "Failed to prepare the update.",
        captchaUrl: "",
        game,
        thread: null,
        selectedLinkUrl: "",
      });
    }
  };

  const buildF95UpdateInstallPayload = (modalState, link) => {
    const variant = window.f95MirrorUi?.findVariant?.(
      modalState.thread?.variants,
      modalState.thread?.links,
      link.url,
    );
    return {
      threadUrl: modalState.thread.threadUrl,
      title:
        modalState.thread.title ||
        modalState.game.displayTitle ||
        modalState.game.title,
      creator:
        modalState.thread.creator ||
        modalState.game.displayCreator ||
        modalState.game.creator,
      version:
        modalState.thread.version || modalState.game.latestVersion || "",
      downloadLabel: link.label,
      downloadUrl: link.url,
      mirrorHost: link.host || "",
      variantId: link.variantId || variant?.id || "",
    };
  };

  const queueF95UpdateInstall = async (downloadUrlOverride = "") => {
    const modalState = f95UpdateModalRef.current;
    const selectedLink =
      modalState.thread?.links?.find(
        (link) => link.url === modalState.selectedLinkUrl,
      ) || null;

    if (!selectedLink || !modalState.thread || !modalState.game) {
      setF95UpdateModal((previous) => ({
        ...previous,
        error: "Choose a valid mirror before starting the update.",
      }));
      return;
    }

    setF95UpdateModal((previous) => ({
      ...previous,
      isInstalling: true,
      error: "",
      captchaUrl: "",
    }));
    beginF95UpdateAttempts(modalState.thread.threadUrl);

    try {
      const result = await window.electronAPI.installF95Thread({
        ...buildF95UpdateInstallPayload(modalState, selectedLink),
        downloadUrl: downloadUrlOverride || selectedLink.url,
        fallbackLinks: downloadUrlOverride
          ? []
          : window.f95MirrorUi?.buildFallbackLinks?.(
              modalState.thread,
              selectedLink,
            ) || [],
      });

      if (!result?.success) {
        if (result?.code === "captcha_required") {
          setF95UpdateModal((previous) => ({
            ...previous,
            isInstalling: false,
            error:
              result?.error ||
              "This mirror needs captcha confirmation before F95Launcher can continue.",
            captchaUrl: result?.actionUrl || selectedLink.url,
          }));
          return;
        }

        setF95UpdateModal((previous) => ({
          ...previous,
          isInstalling: false,
          error: result?.error || "Failed to queue the update.",
        }));
        return;
      }

      const requestedHostName =
        window.getF95MirrorDisplayName?.(selectedLink) ||
        selectedLink.label ||
        "The selected mirror";
      const usedHostName =
        window.getF95MirrorDisplayName?.({
          host: result.usedHost || selectedLink.host,
          label: result.usedLabel || selectedLink.label,
        }) ||
        result.hostLabel ||
        requestedHostName;
      const fallbackNote = result.fellBack
        ? `${requestedHostName} did not return the file, so F95Launcher switched to ${usedHostName}. `
        : "";

      setDownloadsPanelOpen(true);
      closeF95UpdateModal();
      if (result?.awaitingAction) {
        appToast.info(
          `${fallbackNote}${result.hostLabel || usedHostName} needs a quick step in the browser window that just opened. Finish it there and the download continues by itself.`,
          {
            title: "Your turn in the browser",
            duration: 8000,
          },
        );
      } else {
        appToast.info(
          `${fallbackNote}${usedHostName} is being prepared. Progress is shown in Downloads.`,
          {
            title: `Queued ${
              modalState.thread.title || getDisplayTitle(modalState.game)
            }`,
            duration: result.fellBack ? 7000 : undefined,
          },
        );
      }
    } catch (error) {
      console.error("Failed to queue game update:", error);
      setF95UpdateModal((previous) => ({
        ...previous,
        isInstalling: false,
        error: error.message || "Failed to queue the update.",
      }));
    }
  };

  const confirmF95Update = async () => {
    await queueF95UpdateInstall();
  };

  const openGameFolder = (targetPath) => {
    if (!targetPath) {
      return;
    }

    Promise.resolve(window.electronAPI.openDirectory(targetPath)).catch(
      (error) => {
        appToast.error(
          getRendererErrorMessage(error, "The folder could not be opened."),
          { title: "Open folder failed" },
        );
      },
    );
  };

  const launchInstalledVersion = async (version, game) => {
    if (version?.isPresent === false) {
      appToast.error(
        "The folder of this game no longer exists on this PC. Install it again to play.",
        { title: "Game files missing" },
      );
      return { success: false };
    }

    if (typeof window.launchAtlasGame === "function") {
      return window.launchAtlasGame({
        execPath: version?.exec_path || "",
        recordId: game?.record_id || null,
        title: getDisplayTitle(game),
      });
    }

    const extension = version?.exec_path
      ? version.exec_path.split(".").pop().toLowerCase()
      : "";
    try {
      const result = await window.electronAPI.launchGame({
        execPath: version?.exec_path || "",
        extension,
        recordId: game?.record_id || null,
      });

      if (!result?.success) {
        appToast.error(
          result?.error ||
            "Could not start this game. Check the installed files and try again.",
        );
      }
      return result;
    } catch (error) {
      appToast.error(getRendererErrorMessage(error, "Could not start this game."));
      return { success: false };
    }
  };

  const openSitePage = (targetUrl) => {
    if (targetUrl) {
      window.electronAPI.openExternalUrl(targetUrl);
    }
  };

  const addScanSource = async () => {
    const selectedPath = await window.electronAPI.selectDirectory({
      title: "Choose a folder that contains games",
      buttonLabel: "Scan this folder",
    });
    if (!selectedPath) {
      return { success: false, cancelled: true };
    }

    const result = await window.electronAPI.addScanSource(selectedPath);
    if (!result?.success) {
      return {
        success: false,
        error: getRendererErrorMessage(
          result?.error,
          "Failed to add scan source.",
        ),
      };
    }

    setScanSources((previous) => [...previous, result.source]);
    return { success: true, source: result.source };
  };

  const toggleScanSource = async (source) => {
    const result = await window.electronAPI.updateScanSource({
      id: source.id,
      isEnabled: !source.isEnabled,
    });

    if (!result?.success) {
      return {
        success: false,
        error: getRendererErrorMessage(
          result?.error,
          "Failed to update scan source.",
        ),
      };
    }

    setScanSources((previous) =>
      previous.map((item) => (item.id === source.id ? result.source : item)),
    );
    return { success: true, source: result.source };
  };

  const replaceScanSource = async (source) => {
    const selectedPath = await window.electronAPI.selectDirectory({
      title: "Choose the new location of this folder",
      defaultPath: source.path,
    });
    if (!selectedPath) {
      return { success: false, cancelled: true };
    }

    const result = await window.electronAPI.updateScanSource({
      id: source.id,
      path: selectedPath,
    });

    if (!result?.success) {
      return {
        success: false,
        error: getRendererErrorMessage(
          result?.error,
          "Failed to update scan source.",
        ),
      };
    }

    setScanSources((previous) =>
      previous.map((item) => (item.id === source.id ? result.source : item)),
    );
    return { success: true, source: result.source };
  };

  const removeScanSource = async (sourceId) => {
    const result = await window.electronAPI.removeScanSource(sourceId);

    if (!result?.success) {
      return {
        success: false,
        error: getRendererErrorMessage(
          result?.error,
          "Failed to remove scan source.",
        ),
      };
    }

    setScanSources((previous) =>
      previous.filter((item) => item.id !== sourceId),
    );
    return { success: true };
  };

  const saveLibraryFolder = async (selectedPath) => {
    const result = await window.electronAPI.setDefaultGameFolder(selectedPath);
    if (!result?.success) {
      return {
        success: false,
        error: getRendererErrorMessage(
          result?.error,
          "Failed to save library folder.",
        ),
      };
    }

    setDefaultGameFolder(result.path || selectedPath);
    return { success: true, path: result.path || selectedPath };
  };

  const openF95CaptchaWindow = async () => {
    const targetUrl = String(f95UpdateModal.captchaUrl || "").trim();
    if (!targetUrl) {
      return;
    }

    f95CaptchaRetryKeyRef.current = "";

    const result = await window.electronAPI.openF95BrowserUrl({
      url: targetUrl,
      title: "F95 Mirror Verification",
    });

    if (!result?.success) {
      setF95UpdateModal((previous) => ({
        ...previous,
        error:
          result?.error ||
          "F95 Game Zone App could not open the mirror verification window.",
      }));
    }
  };

  const openLibraryRecord = (recordId) => {
    const targetGame = games.find((game) => game.record_id === recordId);
    if (!targetGame) {
      return;
    }

    setActiveSection(SECTION_LIBRARY);
    setSelectedGame(targetGame);
  };

  const toggleGameList = () => {
    const newVisible = !showGameList;
    setShowGameList(newVisible);

    Promise.resolve(
      window.electronAPI.updateSettings("Interface", {
        showGameList: newVisible,
      }),
    )
      .then((result) => {
        if (result && result.success === false) {
          throw new Error(result.error || "Settings could not be saved.");
        }
      })
      .catch((err) => {
        console.error("Failed to save game list visibility:", err);
        appToast.warning("The title list preference could not be saved.");
      });
  };

  const isOnboardingCompleted = (config) => {
    const completed = config?.Onboarding?.completed;
    return completed === true || String(completed).toLowerCase() === "true";
  };

  const decideOnboarding = async (gameCount) => {
    const config = await window.electronAPI.getConfig().catch(() => null);
    if (!config || isOnboardingCompleted(config)) {
      return;
    }

    if (gameCount > 0) {
      // Existing users with a library don't need the first-run walkthrough.
      await window.electronAPI
        .updateSettings("Onboarding", {
          completed: true,
          completedAt: new Date().toISOString(),
        })
        .catch(() => {});
      return;
    }

    setOnboarding({ isOpen: true, step: "welcome" });
  };

  const openOnboarding = (step = "welcome") => {
    setOnboarding({ isOpen: true, step });
  };

  const openSettingsPage = (page) => {
    setSettingsPageRequest((previous) => ({
      page,
      nonce: previous.nonce + 1,
    }));
    setActiveSection(SECTION_SETTINGS);
  };

  const refreshLibrarySetupState = async () => {
    const [sourcesResult, folder] = await Promise.all([
      window.electronAPI.getScanSources().catch(() => null),
      window.electronAPI.getDefaultGameFolder().catch(() => ""),
    ]);
    setScanSources(sourcesResult?.success ? sourcesResult.sources || [] : []);
    setDefaultGameFolder(String(folder || "").trim());
  };

  const finishOnboarding = async ({ startScan, goTo, skipped } = {}) => {
    setOnboarding((previous) => ({ ...previous, isOpen: false }));
    await refreshLibrarySetupState();

    if (goTo === "search") {
      setActiveSection(SECTION_SEARCH);
    } else if (!skipped) {
      setActiveSection(SECTION_LIBRARY);
    }

    if (startScan) {
      void rescanLibrary();
    }
  };

  const loadScanHubData = async () => {
    setIsDiscoveryLoading(true);

    try {
      const [sourcesResult, jobsResult, candidatesResult, libraryFolderResult] =
        await Promise.all([
          window.electronAPI.getScanSources(),
          window.electronAPI.getScanJobs(8),
          window.electronAPI.getScanCandidates(30),
          window.electronAPI.getDefaultGameFolder(),
        ]);

      setScanSources(sourcesResult.success ? sourcesResult.sources || [] : []);
      setScanJobs(jobsResult.success ? jobsResult.jobs || [] : []);
      setDiscoveryCandidates(
        candidatesResult.success ? candidatesResult.candidates || [] : [],
      );
      setDefaultGameFolder(String(libraryFolderResult || "").trim());
    } catch (error) {
      console.error("Failed to load scan hub data:", error);
      setScanSources([]);
      setScanJobs([]);
      setDiscoveryCandidates([]);
      setDefaultGameFolder("");
    } finally {
      setIsDiscoveryLoading(false);
    }
  };

  const applyUpdatedGameToState = useCallback(
    (updatedGame) => {
      if (!updatedGame?.record_id) {
        return;
      }

      setGames((prev) => {
        const hasExisting = prev.some(
          (game) => game.record_id === updatedGame.record_id,
        );
        const newGames = hasExisting
          ? prev.map((game) =>
              game.record_id === updatedGame.record_id ? updatedGame : game,
            )
          : [...prev, updatedGame];

        setTotalVersions(
          newGames.reduce((sum, game) => sum + (game.versionCount || 0), 0),
        );

        return newGames;
      });
      setSelectedGame((current) =>
        current?.record_id === updatedGame.record_id ? updatedGame : current,
      );
      setSelectedGameDetails((current) =>
        current?.record_id === updatedGame.record_id ? updatedGame : current,
      );
      refreshLibraryGrid();
    },
    [refreshLibraryGrid],
  );

  // Debounced refresh for game updates
  const refreshGame = useCallback(
    debounce((recordId) => {
      console.log(`refreshGame called for recordId: ${recordId}`);
      window.electronAPI
        .getGame(recordId)
        .then((updatedGame) => {
          if (updatedGame) {
            console.log(`Updated game data for recordId ${recordId}:`, {
              record_id: updatedGame.record_id,
              title: updatedGame.title,
              banner_url: updatedGame.banner_url,
            });
            applyUpdatedGameToState(updatedGame);
            console.log(`Forcing grid update for recordId: ${recordId}`);
          } else {
            console.warn(`No game data returned for recordId: ${recordId}`);
          }
        })
        .catch((error) =>
          console.error(
            `Failed to update game for recordId ${recordId}:`,
            error,
          ),
        );
    }, 100),
    [applyUpdatedGameToState],
  );

  const setGameFavoriteState = useCallback(
    async (gameInput, isFavorite) => {
      const recordId = Number(gameInput?.record_id);
      if (!Number.isInteger(recordId) || recordId <= 0) {
        return;
      }

      try {
        const result = await window.electronAPI.setGameFavorite({
          recordId,
          isFavorite: Boolean(isFavorite),
        });

        if (!result?.success) {
          console.error(
            "[library.favorite] Failed to set favorite:",
            result?.error || "unknown error",
          );
          appToast.error(
            getRendererErrorMessage(result?.error, "Favorites could not be updated."),
            { title: "Favorites" },
          );
          return;
        }

        if (result?.game) {
          applyUpdatedGameToState(result.game);
          return;
        }

        refreshGame(recordId);
      } catch (error) {
        console.error("[library.favorite] Failed to set favorite:", error);
        appToast.error(
          getRendererErrorMessage(error, "Favorites could not be updated."),
          { title: "Favorites" },
        );
      }
    },
    [applyUpdatedGameToState, refreshGame],
  );

  const toggleGameFavorite = useCallback(
    (gameInput) => {
      if (!gameInput?.record_id) {
        return;
      }

      void setGameFavoriteState(gameInput, !Boolean(gameInput.isFavorite));
    },
    [setGameFavoriteState],
  );

  useEffect(() => {
    let gameGridResizeObserver = null;
    const runResizeSync = () => scheduleGridResizeSync();

    window.electronAPI
      .getDefaultGameFolder()
      .then((value) => setDefaultGameFolder(String(value || "").trim()))
      .catch((error) => {
        console.error("Failed to load default library folder:", error);
        setDefaultGameFolder("");
      });

    // Get Config
    window.electronAPI
      .getConfig()
      .then((config) => {
        const interfaceSettings = config.Interface || {};
        setShowGameList(interfaceSettings.showGameList ?? true);
        // If you still have showSidebar from earlier attempts, you can keep it or remove
      })
      .catch((error) => {
        console.error("Failed to load config:", error);
        setShowGameList(true);
      });

    // Fetch games only once on mount
    window.electronAPI
      .getGames()
      .then((allGames) => {
        const gamesArray = Array.isArray(allGames) ? allGames : [];
        console.log(`Initial fetch: ${gamesArray.length} games loaded`);
        setGames(gamesArray);
        setTotalVersions(
          gamesArray.reduce((sum, game) => sum + (game.versionCount || 0), 0),
        );
        void decideOnboarding(gamesArray.length);
      })
      .catch((error) => {
        console.error("Failed to fetch games:", error);
        setGames([]);
        setTotalVersions(0);
        appToast.error(
          getRendererErrorMessage(error, "The library database could not be read."),
          {
            title: "Library failed to load",
            actions: [
              { label: "Reload", onClick: () => window.location.reload() },
            ],
          },
        );
      })
      .finally(() => {
        setIsGamesLoading(false);
      });

    window.electronAPI
      .getScanSources()
      .then((result) =>
        setScanSources(result?.success ? result.sources || [] : []),
      )
      .catch(() => {});

    // Load banner size from template
    window.electronAPI
      .getTemplate?.()
      .then((template) => {
        if (template && template.bannerWidth && template.bannerHeight) {
          setBannerSize({
            bannerWidth: template.bannerWidth,
            bannerHeight: template.bannerHeight,
          });
        }
      })
      .catch((error) => {
        console.error("Failed to load template:", error);
      });

    window.electronAPI
      .getVersion()
      .then((v) => setVersion(v || "0.0.0"))
      .catch((error) => console.error("Failed to read app version:", error));
    window.electronAPI
      .getAppUpdateState()
      .then((state) => {
        if (state) {
          setAppUpdateState(state);
        }
      })
      .catch((error) => {
        console.error("Failed to get app update state:", error);
      });

    window.electronAPI.checkAppUpdate().catch((error) => {
      console.error("Failed to check app updates:", error);
    });

    window.electronAPI
      .checkDbUpdates()
      .then((result) => {
        if (!result.success) {
          setDbUpdateStatus({
            text: `Error: ${result.error}`,
            progress: 0,
            total: 100,
          });
          setTimeout(
            () => setDbUpdateStatus({ text: "", progress: 0, total: 0 }),
            2000,
          );
        } else if (result.total === 0) {
          setDbUpdateStatus({ text: result.message, progress: 0, total: 0 });
          setTimeout(
            () => setDbUpdateStatus({ text: "", progress: 0, total: 0 }),
            2000,
          );
        }
      })
      .catch((error) => {
        console.error("Failed to check database updates:", error);
        setDbUpdateStatus({
          text: `Error: ${error.message}`,
          progress: 0,
          total: 100,
        });
        setTimeout(
          () => setDbUpdateStatus({ text: "", progress: 0, total: 0 }),
          2000,
        );
      });

    // Set up IPC listeners
    const handleWindowStateChanged = (state) =>
      setIsMaximized(state === "maximized");
    const handleDbUpdateProgress = (progress) => {
      setDbUpdateStatus(progress);
      if (progress.progress >= progress.total && progress.total > 0) {
        setTimeout(
          () => setDbUpdateStatus({ text: "", progress: 0, total: 0 }),
          2000,
        );
      }
    };

    const handleImportProgress = (progress) => {
      setImportProgress(progress);
    };
    const handleGameImported = (event, recordId) => {
      console.log(`Game imported: recordId ${recordId}`);
      window.electronAPI
        .getGame(recordId)
        .then((game) => {
          if (game) {
            setGames((prev) => {
              const nextGames = prev.some(
                (existingGame) => existingGame.record_id === game.record_id,
              )
                ? prev.map((existingGame) =>
                    existingGame.record_id === game.record_id
                      ? game
                      : existingGame,
                  )
                : [...prev, game];
              const newGames = nextGames.sort((a, b) =>
                a.title.localeCompare(b.title),
              );
              setTotalVersions(
                newGames.reduce(
                  (sum, game) => sum + (game.versionCount || 0),
                  0,
                ),
              );
              return newGames;
            });
            setSelectedGame((current) =>
              current?.record_id === game.record_id ? game : current,
            );
            setSelectedGameDetails((current) =>
              current?.record_id === game.record_id ? game : current,
            );
          }
        })
        .catch((error) =>
          console.error(`Failed to get game for recordId ${recordId}:`, error),
        );
    };
    const handleGameUpdated = (event, recordId) => {
      console.log(`Game updated event received for recordId: ${recordId}`);
      refreshGame(recordId);
    };
    const handleImportComplete = () => {
      console.log("Import complete: fetching all games");
      window.electronAPI
        .getGames()
        .then((allGames) => {
          const gamesArray = Array.isArray(allGames) ? allGames : [];
          console.log(`Import complete: ${gamesArray.length} games loaded`);
          setGames(gamesArray);
          setTotalVersions(
            gamesArray.reduce((sum, game) => sum + (game.versionCount || 0), 0),
          );
          if (selectedGameRef.current?.record_id) {
            const refreshedSelection = gamesArray.find(
              (game) => game.record_id === selectedGameRef.current.record_id,
            );
            if (refreshedSelection) {
              setSelectedGame(refreshedSelection);
              setSelectedGameDetails(refreshedSelection);
            }
          }
        })
        .catch((error) => {
          console.error("Failed to fetch games on import complete:", error);
          setGames([]);
          setTotalVersions(0);
        });
      setTimeout(
        () => setImportProgress({ text: "", progress: 0, total: 0 }),
        IMPORT_PROGRESS_TERMINAL_TOAST_MS,
      );
      loadDiscoveryCandidates();
    };
    const handleUpdateStatus = (status) => {
      console.log("Update status:", status);
      setAppUpdateState(status);
    };
    const handleF95BrowserNavigation = (payload) => {
      const modalState = f95UpdateModalRef.current;
      if (
        !modalState?.isOpen ||
        !modalState?.captchaUrl ||
        modalState?.isInstalling
      ) {
        return;
      }

      const continuationUrl = getF95CaptchaContinuationUrl(
        modalState.captchaUrl,
        payload?.url,
      );

      if (!continuationUrl) {
        return;
      }

      const retryKey = `${modalState.captchaUrl}|${continuationUrl}`;
      if (f95CaptchaRetryKeyRef.current === retryKey) {
        return;
      }

      f95CaptchaRetryKeyRef.current = retryKey;
      setF95UpdateModal((previous) => ({
        ...previous,
        isInstalling: true,
        error: "",
      }));
      void queueF95UpdateInstall(continuationUrl);
    };

    const handleGameDeleted = (recordId) => {
      console.log(`Game deleted event received for recordId: ${recordId}`);
      setGames((prev) => {
        const newGames = prev.filter((g) => g.record_id !== recordId);
        setTotalVersions(
          newGames.reduce((sum, game) => sum + (game.versionCount || 0), 0),
        );
        return newGames;
      });

      // Optional: if this was the selected game, clear it
      if (selectedGameRef.current?.record_id === recordId) {
        setSelectedGame(null);
        setSelectedGameDetails(null);
        setSelectedGamePreviews([]);
      }

      if (deleteGameModalRef.current?.game?.record_id === recordId) {
        closeDeleteGameModal();
      }

      // Force grid refresh
      refreshLibraryGrid();
    };

    const handleLibraryReset = (payload) => {
      console.log("Library reset event received:", payload);
      setGames([]);
      setTotalVersions(0);
      setSelectedGame(null);
      setSelectedGameDetails(null);
      setSelectedGamePreviews([]);
    };

    const unsubscribers = [
      subscribeElectronEvent("onGameDeleted", "game-deleted", handleGameDeleted),
      subscribeElectronEvent("onLibraryReset", "library-reset", handleLibraryReset),
      subscribeElectronEvent(
        "onWindowStateChanged",
        "window-state-changed",
        handleWindowStateChanged,
      ),
      subscribeElectronEvent(
        "onDbUpdateProgress",
        "db-update-progress",
        handleDbUpdateProgress,
      ),
      subscribeElectronEvent(
        "onImportProgress",
        "import-progress",
        handleImportProgress,
      ),
      subscribeElectronEvent("onGameImported", "game-imported", handleGameImported),
    ];
    const handleGamesLibrarySynced = () => {
      window.electronAPI
        .getGames()
        .then((allGames) => {
          const gamesArray = Array.isArray(allGames) ? allGames : [];
          setGames(gamesArray);
          setTotalVersions(
            gamesArray.reduce((sum, game) => sum + (game.versionCount || 0), 0),
          );
        })
        .catch((error) => {
          console.error(
            "Failed to refresh games after cloud library sync:",
            error,
          );
        });
    };
    unsubscribers.push(
      subscribeElectronEvent(
        "onGamesLibrarySynced",
        "games-library-synced",
        handleGamesLibrarySynced,
      ),
      subscribeElectronEvent("onGameUpdated", "game-updated", handleGameUpdated),
      subscribeElectronEvent(
        "onImportComplete",
        "import-complete",
        handleImportComplete,
      ),
      subscribeElectronEvent("onUpdateStatus", "update-status", handleUpdateStatus),
      subscribeElectronEvent(
        "onF95BrowserNavigation",
        "f95-browser-navigation",
        handleF95BrowserNavigation,
      ),
    );

    //banner context menu
    const handleContextMenuCommand = (event, data) => {
      if (!data?.action) {
        return;
      }

      if (data.action === "properties") {
        window.electronAPI
          .getGame(data.recordId)
          .then((updatedGame) => {
            setSelectedGame(updatedGame);
          })
          .catch((error) =>
            console.error("Failed to get game for properties:", error),
          );
        return;
      }

      if (data.action === "removeGame") {
        window.electronAPI
          .getGame(data.recordId)
          .then((updatedGame) => {
            if (updatedGame) {
              setSelectedGame(updatedGame);
              openDeleteGameModal(updatedGame);
            }
          })
          .catch((error) =>
            console.error("Failed to prepare game removal:", error),
          );
        return;
      }

      if (data.action === "updateGame") {
        window.electronAPI
          .getGame(data.recordId)
          .then((updatedGame) => {
            if (updatedGame) {
              setSelectedGame(updatedGame);
              handleGameUpdate(updatedGame);
            }
          })
          .catch((error) =>
            console.error("Failed to prepare game update:", error),
          );
        return;
      }

      if (
        data.action === "addToFavorites" ||
        data.action === "removeFromFavorites"
      ) {
        const isFavorite = data.action === "addToFavorites";
        void setGameFavoriteState({ record_id: data.recordId }, isFavorite);
        return;
      }

      if (data.action === "rescanLibrary") {
        rescanLibrary();
        return;
      }

      if (data.action === "refreshLibrary") {
        rescanLibrary({ mode: "refresh" });
        return;
      }

      if (data.action === "resetCacheAndRescanLibrary") {
        rescanLibrary({ mode: "reset_cache" });
        return;
      }

      if (data.action === "resetLibrary") {
        openLibraryResetModal();
        return;
      }

      if (data.action === "refreshLibraryPreviews") {
        if (isLibraryScanRunningRef.current) {
          appToast.info("Wait for the current library task to finish.");
          return;
        }
        isLibraryScanRunningRef.current = true;
        setIsLibraryScanRunning(true);
        setImportProgress({
          text: "Starting screenshot refresh...",
          progress: 0,
          total: 1,
        });

        window.electronAPI
          .refreshLibraryPreviews()
          .then((result) => {
            if ((result?.totalGames || 0) === 0) {
              setImportProgress({
                text: "No library games with site screenshots were found.",
                progress: 0,
                total: 1,
              });
              return;
            }

            if (!result?.success) {
              setImportProgress({
                text: `Screenshot refresh finished: ${result?.refreshed || 0} updated, ${result?.skipped || 0} skipped, ${result?.failed || 0} failed`,
                progress: result?.processed || 0,
                total: result?.totalGames || 1,
              });
              return;
            }

            setImportProgress({
              text: `Screenshot refresh complete: ${result.refreshed} updated, ${result.skipped} already complete`,
              progress: result.processed || 0,
              total: result.totalGames || 1,
            });
          })
          .catch((error) => {
            console.error("Failed to refresh library screenshots:", error);
            setImportProgress({
              text: `Screenshot refresh failed: ${error.message}`,
              progress: 0,
              total: 1,
            });
          })
          .finally(() => {
            isLibraryScanRunningRef.current = false;
            setIsLibraryScanRunning(false);
          });
      }
    };
    unsubscribers.push(
      subscribeElectronEvent(
        "onContextMenuCommand",
        "context-menu-command",
        handleContextMenuCommand,
      ),
    );

    // Set up layout sync: window resize + container resize during details-panel drag
    window.addEventListener("resize", runResizeSync);
    if (typeof window.ResizeObserver === "function" && gameGridRef.current) {
      gameGridResizeObserver = new window.ResizeObserver(() => {
        runResizeSync();
      });
      gameGridResizeObserver.observe(gameGridRef.current);
    }
    runResizeSync();

    // Cleanup
    return () => {
      window.removeEventListener("resize", runResizeSync);
      gameGridResizeObserver?.disconnect();
      unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (error) {
          console.error("[app] Failed to unsubscribe:", error);
        }
      });
    };
  }, [scheduleGridResizeSync]);

  useEffect(() => {
    let mounted = true;

    const applyCloudAuthState = (state) => {
      if (!mounted) {
        return;
      }

      setCloudAuthState(state || createDefaultHeaderCloudAuthState());
    };

    window.electronAPI
      .getCloudAuthState()
      .then((result) => {
        if (!mounted) {
          return;
        }

        if (result?.success && result.state) {
          applyCloudAuthState(result.state);
          return;
        }

        applyCloudAuthState({
          ...createDefaultHeaderCloudAuthState(),
          error: getRendererErrorMessage(result?.error, ""),
        });
      })
      .catch((error) => {
        console.error("Failed to load cloud auth state:", error);
        applyCloudAuthState({
          ...createDefaultHeaderCloudAuthState(),
          error: getRendererErrorMessage(error, ""),
        });
      });

    const unsubscribe = subscribeElectronEvent(
      "onCloudAuthChanged",
      "cloud-auth-changed",
      (state) => {
        applyCloudAuthState(state);
      },
    );

    return () => {
      mounted = false;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  const addGame = async () => {
    window.electronAPI.openImporter();
  };

  const removeGame = async (id) => {
    try {
      await window.electronAPI.removeGame(id);
      setGames((prev) => {
        const newGames = prev.filter((g) => g.record_id !== id);
        setTotalVersions(
          newGames.reduce((sum, game) => sum + (game.versionCount || 0), 0),
        );
        return newGames;
      });
      if (selectedGame?.record_id === id) setSelectedGame(null);
    } catch (error) {
      console.error("Failed to remove game:", error);
    }
  };

  const rescanLibrary = async (options = {}) => {
    // Read the ref: this is also invoked from the context-menu listener that
    // was registered on mount and would otherwise see a stale state value.
    if (isLibraryScanRunningRef.current) {
      appToast.info("A library scan is already running.");
      return;
    }

    const mode =
      options?.mode ||
      (options?.resetCache
        ? "reset_cache"
        : options?.forceRescan
          ? "refresh"
          : "incremental");

    isLibraryScanRunningRef.current = true;
    setIsLibraryScanRunning(true);
    setImportProgress({
      text:
        LIBRARY_SCAN_MODE_START_TEXT[mode] ||
        LIBRARY_SCAN_MODE_START_TEXT.incremental,
      progress: 0,
      total: 1,
    });

    try {
      const result = await window.electronAPI.scanLibrary({
        ...options,
        mode,
      });

      if (!result.success) {
        setImportProgress({
          text: result.cancelled
            ? "Library rescan cancelled"
            : result.error
              ? `Library rescan failed: ${result.error}`
              : result.warningsCount > 0
                ? `Library rescan finished with errors and ${result.warningsCount} warnings`
                : "Library rescan finished with errors",
          progress: result.imported || 0,
          total: result.scanned || 1,
        });
        return result;
      }

      const summaryParts = [`${result.imported || 0} added`];
      if (result.refreshed > 0) {
        summaryParts.push(`${result.refreshed} refreshed`);
      }
      if (result.reviewQueued > 0) {
        summaryParts.push(`${result.reviewQueued} need review`);
      }
      if (result.missingCount > 0) {
        summaryParts.push(`${result.missingCount} with missing files`);
      }
      if (result.warningsCount > 0) {
        summaryParts.push(`${result.warningsCount} warnings`);
      }
      setImportProgress({
        text: `Library rescan complete: ${summaryParts.join(", ")} (${result.scanned || 0} detected)`,
        progress: (result.imported || 0) + (result.refreshed || 0),
        total: result.scanned || 1,
      });

      if (result.missingCount > 0) {
        appToast.warning(
          `${result.missingCount} game${result.missingCount === 1 ? "" : "s"} in your library point to folders that no longer exist. Use the "Files missing" filter to reinstall or remove them.`,
          { title: "Missing game files", duration: 8000 },
        );
      }
      return result;
    } catch (error) {
      console.error("Failed to rescan library:", error);
      setImportProgress({
        text: `Library rescan error: ${error.message}`,
        progress: 0,
        total: 1,
      });
      return null;
    } finally {
      if (showDiscoveryRef.current) {
        loadDiscoveryCandidates();
      }
      isLibraryScanRunningRef.current = false;
      setIsLibraryScanRunning(false);
    }
  };

  const openRescanLibraryMenu = () => {
    if (isLibraryScanRunning) {
      appToast.info("A library scan is already running.");
      return;
    }

    window.electronAPI.showContextMenu([
      {
        label: "Find New Games",
        data: { action: "rescanLibrary" },
      },
      {
        label: "Refresh Installed Games",
        data: { action: "refreshLibrary" },
      },
      { type: "separator" },
      {
        label: "Refresh Cached Screenshots",
        data: { action: "refreshLibraryPreviews" },
      },
      {
        label: "Reset Scan Cache & Rescan",
        data: { action: "resetCacheAndRescanLibrary" },
      },
      { type: "separator" },
      {
        label: "Rebuild Library From Scratch…",
        data: { action: "resetLibrary" },
      },
    ]);
  };

  const closeLibraryResetModal = () => {
    setLibraryResetModal({ isOpen: false, isRunning: false, error: "" });
  };

  const openLibraryResetModal = () => {
    if (isLibraryScanRunningRef.current) {
      appToast.info("A library scan is already running.");
      return;
    }
    setLibraryResetModal({ isOpen: true, isRunning: false, error: "" });
  };

  const confirmLibraryReset = async () => {
    setLibraryResetModal((previous) => ({
      ...previous,
      isRunning: true,
      error: "",
    }));
    const result = await rescanLibrary({ mode: "reset_library", confirm: true });
    if (result && !result.success && !result.cancelled) {
      setLibraryResetModal((previous) => ({
        ...previous,
        isRunning: false,
        error: result.error || "The library could not be rebuilt.",
      }));
      return;
    }
    closeLibraryResetModal();
  };

  const cancelLibraryScan = async () => {
    try {
      const result = await window.electronAPI.cancelScan();
      if (!result.success) {
        setImportProgress({
          text: result.error || "No active scan to cancel",
          progress: 0,
          total: 1,
        });
        return;
      }

      setImportProgress({
        text: "Cancelling library scan...",
        progress: 0,
        total: 1,
      });
    } catch (error) {
      console.error("Failed to cancel library scan:", error);
      setImportProgress({
        text: `Cancel failed: ${error.message}`,
        progress: 0,
        total: 1,
      });
    }
  };

  const handleAppUpdateAction = async () => {
    try {
      if (appUpdateState.status === "available") {
        if (appUpdateState.supportsDownload) {
          await window.electronAPI.downloadAppUpdate();
          return;
        }

        if (appUpdateState.releaseUrl) {
          await window.electronAPI.openExternalUrl(appUpdateState.releaseUrl);
          return;
        }
      }

      if (appUpdateState.status === "downloaded") {
        await window.electronAPI.installAppUpdate();
        return;
      }

      await window.electronAPI.checkAppUpdate();
    } catch (error) {
      console.error("Failed to perform app update action:", error);
      setAppUpdateState((previous) => ({
        ...previous,
        status: "error",
        error: error.message,
      }));
      appToast.error(getRendererErrorMessage(error, "The app update failed."), {
        title: "App update",
      });
    }
  };

  const loadDiscoveryCandidates = async () => {
    await loadScanHubData();
  };

  const sortedFilteredLibraryGames = useMemo(
    () =>
      sortLibraryGames(
        filterLocalGames(
          games,
          deferredLibraryQuery,
          activeSection === SECTION_UPDATES,
          activeSection === SECTION_LIBRARY
            ? libraryInstallFilter
            : LIBRARY_INSTALL_FILTERS.ALL,
        ),
        librarySortMode,
      ),
    [
      games,
      deferredLibraryQuery,
      activeSection,
      librarySortMode,
      libraryInstallFilter,
    ],
  );
  const favoriteLibraryGames = useMemo(
    () =>
      activeSection === SECTION_LIBRARY
        ? sortedFilteredLibraryGames.filter((game) => Boolean(game.isFavorite))
        : [],
    [activeSection, sortedFilteredLibraryGames],
  );
  const nonFavoriteLibraryGames = useMemo(
    () =>
      activeSection === SECTION_LIBRARY
        ? sortedFilteredLibraryGames.filter((game) => !Boolean(game.isFavorite))
        : sortedFilteredLibraryGames,
    [activeSection, sortedFilteredLibraryGames],
  );
  const visibleLibraryGames = useMemo(
    () =>
      activeSection === SECTION_LIBRARY
        ? [...favoriteLibraryGames, ...nonFavoriteLibraryGames]
        : sortedFilteredLibraryGames,
    [
      activeSection,
      favoriteLibraryGames,
      nonFavoriteLibraryGames,
      sortedFilteredLibraryGames,
    ],
  );
  const librarySortDescription = getLibrarySortDescription(librarySortMode);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      refreshLibraryGrid();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [refreshLibraryGrid, visibleLibraryGames, librarySortMode]);

  const canCancelLibraryScan =
    isLibraryScanRunning && /scan/i.test(importProgress.text || "");
  const cloudAuthButtonTitle = cloudAuthState.authenticated
    ? `Cloud saves connected as ${cloudAuthState.user?.email || "your account"}`
    : cloudAuthState.configured
      ? "Sign in to cloud saves"
      : "Cloud saves unavailable";
  const cloudAuthButtonIcon = cloudAuthState.authenticated
    ? "cloud_done"
    : cloudAuthState.configured
      ? "cloud"
      : "cloud_off";

  useEffect(() => {
    if (!isTerminalImportProgressToast(importProgress.text)) {
      return;
    }
    const id = setTimeout(() => {
      setImportProgress({ text: "", progress: 0, total: 0 });
    }, IMPORT_PROGRESS_TERMINAL_TOAST_MS);
    return () => clearTimeout(id);
  }, [importProgress.text]);

  useEffect(() => {
    if (activeSection !== SECTION_SEARCH || window.F95BrowserWorkspace) {
      return;
    }

    let cancelled = false;
    setIsSiteSearchLoading(true);
    setSiteSearchError("");

    const timer = setTimeout(() => {
      window.electronAPI
        .searchSiteCatalog(siteSearchFilters, siteSearchLimit)
        .then((result) => {
          if (cancelled) {
            return;
          }

          if (result?.error) {
            setSiteSearchResults([]);
            setSiteSearchTotal(0);
            setIsSiteSearchLimited(false);
            setSiteSearchError(result.error);
            return;
          }

          setSiteSearchResults(
            Array.isArray(result?.results) ? result.results : [],
          );
          setSiteSearchTotal(Number(result?.total) || 0);
          setSiteSearchLimit(Number(result?.limit) || siteSearchLimit);
          setIsSiteSearchLimited(Boolean(result?.limited));
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          console.error("Failed to search site catalog:", error);
          setSiteSearchResults([]);
          setSiteSearchTotal(0);
          setIsSiteSearchLimited(false);
          setSiteSearchError(error.message);
        })
        .finally(() => {
          if (!cancelled) {
            setIsSiteSearchLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeSection, siteSearchFilters, siteSearchLimit]);

  useEffect(() => {
    if (showDiscovery) {
      loadScanHubData();
    }
  }, [showDiscovery]);

  useEffect(() => {
    if (!selectedGame?.record_id) {
      setSelectedGameDetails(null);
      setSelectedGamePreviews([]);
      setIsSelectedGameLoading(false);
      return;
    }

    let cancelled = false;
    setIsSelectedGameLoading(true);

    Promise.all([
      window.electronAPI.getGame(selectedGame.record_id),
      window.electronAPI.getPreviews(selectedGame.record_id),
    ])
      .then(([gameDetails, previews]) => {
        if (cancelled) {
          return;
        }

        setSelectedGameDetails(gameDetails || null);
        setSelectedGamePreviews(Array.isArray(previews) ? previews : []);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        console.error("Failed to load selected game details:", error);
        setSelectedGameDetails(null);
        setSelectedGamePreviews([]);
      })
      .finally(() => {
        if (!cancelled) {
          setIsSelectedGameLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedGame?.record_id]);

  useEffect(() => {
    setPreviewModalIndex(null);
  }, [selectedGame?.record_id]);

  useEffect(() => {
    if (previewModalIndex === null) {
      return;
    }
    if (selectedGamePreviews.length === 0) {
      setPreviewModalIndex(null);
      return;
    }
    if (previewModalIndex >= selectedGamePreviews.length) {
      setPreviewModalIndex(selectedGamePreviews.length - 1);
    }
  }, [selectedGamePreviews, previewModalIndex]);

  const closePreviewModal = useCallback(() => {
    setPreviewModalIndex(null);
  }, []);

  const showPreviousPreview = useCallback(() => {
    setPreviewModalIndex((currentIndex) => {
      const count = selectedGamePreviews.length;
      if (count === 0) {
        return null;
      }
      const resolvedCurrent = currentIndex ?? 0;
      return (resolvedCurrent - 1 + count) % count;
    });
  }, [selectedGamePreviews.length]);

  const showNextPreview = useCallback(() => {
    setPreviewModalIndex((currentIndex) => {
      const count = selectedGamePreviews.length;
      if (count === 0) {
        return null;
      }
      const resolvedCurrent = currentIndex ?? 0;
      return (resolvedCurrent + 1) % count;
    });
  }, [selectedGamePreviews.length]);

  useEffect(() => {
    if (previewModalIndex === null) {
      return;
    }
    const count = selectedGamePreviews.length;
    if (count === 0) {
      return;
    }
    const onKey = (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        showPreviousPreview();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        showNextPreview();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    previewModalIndex,
    selectedGamePreviews.length,
    closePreviewModal,
    showPreviousPreview,
    showNextPreview,
  ]);

  useEffect(() => {
    if (previewModalIndex === null) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [previewModalIndex]);

  const handlePreviewStageClick = useCallback(
    (event) => {
      if (event.target === event.currentTarget) {
        closePreviewModal();
      }
    },
    [closePreviewModal],
  );

  useEffect(() => {
    if (
      activeSection !== SECTION_SEARCH &&
      selectedGame?.record_id &&
      !visibleLibraryGames.some(
        (game) => game.record_id === selectedGame.record_id,
      )
    ) {
      closeSelectedGamePanel();
    }
  }, [activeSection, visibleLibraryGames, selectedGame?.record_id]);

  const updateAvailableCount = useMemo(
    () => games.filter((game) => game.isUpdateAvailable).length,
    [games],
  );
  const libraryInstallCounts = useMemo(
    () => countLibraryInstallStates(games),
    [games],
  );
  const installedGameCount = libraryInstallCounts.installed;
  const missingGameCount = libraryInstallCounts.missing;
  const notInstalledGameCount = libraryInstallCounts.not_installed;

  const activeFilterCount = useMemo(
    () => countActiveFilters(siteSearchFilters),
    [siteSearchFilters],
  );

  const appUpdateActionLabel =
    appUpdateState.status === "checking"
      ? "Checking..."
      : appUpdateState.status === "downloading"
        ? `Downloading ${Math.round(appUpdateState.percent || 0)}%`
        : appUpdateState.status === "downloaded"
          ? "Install App Update"
          : appUpdateState.status === "available"
            ? appUpdateState.supportsDownload
              ? "Download App Update"
              : "Open Release"
            : "Check App Update";

  const appUpdateSummary =
    appUpdateState.status === "error"
      ? `App update error: ${appUpdateState.error || "unknown error"}`
      : appUpdateState.status === "downloaded"
        ? `App update ${appUpdateState.availableVersion || ""} is ready to install`
        : appUpdateState.status === "downloading"
          ? `Downloading app update ${Math.round(appUpdateState.percent || 0)}%`
          : appUpdateState.status === "available"
            ? appUpdateState.supportsDownload
              ? `App update ${appUpdateState.availableVersion || ""} is available`
              : `New release ${appUpdateState.availableVersion || ""} is available (download requires packaged build)`
            : appUpdateState.status === "not-available" &&
                appUpdateState.checkedAt
              ? "App is up to date"
              : "";

  useEffect(() => {
    scheduleGridResizeSync();
  }, [
    activeSection,
    showGameList,
    selectedGame?.record_id,
    isSelectedGameLoading,
    visibleLibraryGames.length,
    siteSearchResults.length,
    scheduleGridResizeSync,
  ]);

  const isPreviewOpen =
    previewModalIndex !== null && selectedGamePreviews.length > 0;
  const previewPresence = appMotion.usePresence(isPreviewOpen);
  const previewSnapshot = appMotion.useSnapshot(
    { index: previewModalIndex ?? 0, previews: selectedGamePreviews },
    isPreviewOpen,
  );
  appMotion.useEscape(isPreviewOpen, closePreviewModal);

  const isDetailsOpen =
    activeSection !== SECTION_SEARCH &&
    activeSection !== SECTION_SETTINGS &&
    Boolean(selectedGame || isSelectedGameLoading);
  const detailsPresence = appMotion.usePresence(isDetailsOpen);
  const detailsSnapshot = appMotion.useSnapshot(
    {
      game: selectedGameDetails,
      previews: selectedGamePreviews,
      isLoading: isSelectedGameLoading,
    },
    isDetailsOpen,
  );
  appMotion.useEscape(isDetailsOpen, closeSelectedGamePanel);

  const isScanActionVisible = canCancelLibraryScan;
  const cancelScanPresence = appMotion.usePresence(isScanActionVisible);

  const selectGame = useCallback((game) => {
    setSelectedGame(game);
  }, []);

  const cellRenderer = ({ columnIndex, rowIndex, style }) => {
    const index = rowIndex * columnCount + columnIndex;
    if (index >= visibleLibraryGames.length) return null;
    const game = visibleLibraryGames[index];
    return (
      <div
        key={game.record_id}
        className="atlas-card-enter"
        style={{
          ...style,
          display: "flex",
          justifyContent: "center",
          padding: "8px 4px",
          maxWidth: "100%",
          "--atlas-index": Math.min(columnIndex, CARD_STAGGER_LIMIT),
        }}
      >
        <window.GameBanner
          game={game}
          onSelect={() => selectGame(game)}
          onUpdateGame={handleGameUpdate}
          onToggleFavorite={toggleGameFavorite}
        />
      </div>
    );
  };

  const renderGameCardList = (gamesList, sectionKey) => (
    <div className="flex flex-wrap justify-start gap-y-4">
      {gamesList.map((game, index) => (
        <div
          key={`${sectionKey}-${game.record_id}`}
          className="atlas-card-enter flex justify-start px-1"
          style={{ "--atlas-index": Math.min(index, CARD_STAGGER_LIMIT) }}
        >
          <window.GameBanner
            game={game}
            onSelect={() => selectGame(game)}
            onUpdateGame={handleGameUpdate}
            onToggleFavorite={toggleGameFavorite}
          />
        </div>
      ))}
    </div>
  );

  const renderSectionControls = (resultsCount) => (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 border border-border bg-black/25 px-2 py-1 text-[11px] text-text/90 shadow-glass-sm backdrop-blur-md transition-colors hover:border-accent/40">
        <span className="uppercase tracking-[0.14em] text-text/60">Sort</span>
        <select
          value={librarySortMode}
          onChange={(event) => setLibrarySortMode(event.target.value)}
          title={librarySortDescription}
          className="min-w-[196px] cursor-pointer bg-transparent text-xs text-text outline-none"
        >
          {LIBRARY_SORT_OPTIONS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              className="bg-primary text-text"
            >
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {activeSection === SECTION_LIBRARY && LIBRARY_INSTALL_FILTER_OPTIONS.length > 0 && (
        <label
          className={`flex items-center gap-2 border px-2 py-1 text-[11px] text-text/90 shadow-glass-sm backdrop-blur-md transition-colors hover:border-accent/40 ${
            libraryInstallFilter !== LIBRARY_INSTALL_FILTERS.ALL
              ? "border-accent/60 bg-accent/10"
              : "border-border bg-black/25"
          }`}
        >
          <span className="uppercase tracking-[0.14em] text-text/60">Show</span>
          <select
            value={libraryInstallFilter}
            onChange={(event) => setLibraryInstallFilter(event.target.value)}
            title={
              LIBRARY_INSTALL_FILTER_OPTIONS.find(
                (option) => option.value === libraryInstallFilter,
              )?.description || ""
            }
            className="min-w-[150px] cursor-pointer bg-transparent text-xs text-text outline-none"
          >
            {LIBRARY_INSTALL_FILTER_OPTIONS.map((option) => (
              <option
                key={option.value}
                value={option.value}
                className="bg-primary text-text"
              >
                {option.label}
                {option.value === LIBRARY_INSTALL_FILTERS.MISSING && missingGameCount > 0
                  ? ` (${missingGameCount})`
                  : option.value === LIBRARY_INSTALL_FILTERS.NOT_INSTALLED && notInstalledGameCount > 0
                    ? ` (${notInstalledGameCount})`
                    : option.value === LIBRARY_INSTALL_FILTERS.INSTALLED
                      ? ` (${installedGameCount})`
                      : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={toggleGameList}
        className="flex items-center gap-1.5 border border-border bg-white/5 px-2 py-1 text-xs text-text shadow-glass-sm backdrop-blur-md transition hover:bg-white/10 hover:shadow-glass"
      >
        <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden>
          {showGameList ? "left_panel_close" : "left_panel_open"}
        </span>
        {showGameList ? "Hide titles" : "Show titles"}
      </button>
      <div
        key={resultsCount}
        className="atlas-fade-enter border border-border bg-black/25 px-2 py-1 text-[11px] uppercase tracking-[0.14em] tabular-nums text-text/90 backdrop-blur-sm"
      >
        {`${resultsCount} results`}
      </div>
    </div>
  );

  const hasLibraryQuery = Boolean(libraryQuery.trim());
  const sectionMeta =
    activeSection === SECTION_UPDATES
      ? {
          icon: "task_alt",
          eyebrow: "Update Inbox",
          emptyTitle: hasLibraryQuery ? "No matching updates" : "No pending updates",
          emptyDescription: hasLibraryQuery
            ? `Nothing in the update inbox matches “${libraryQuery.trim()}”.`
            : "Current library entries are already on their latest known version.",
        }
      : activeSection === SECTION_SEARCH
        ? {
            icon: "travel_explore",
            eyebrow: "F95 Workspace",
            emptyTitle: "F95 session required",
            emptyDescription:
              "Log in to F95 to unlock the live search workspace, direct downloads and install-to-library flow.",
          }
        : {
            icon: hasLibraryQuery ? "search_off" : "library_add",
            eyebrow: "User Library",
            emptyTitle: hasLibraryQuery ? "No games match your search" : "Library is empty",
            emptyDescription: hasLibraryQuery
              ? `Nothing in your library matches “${libraryQuery.trim()}”.`
              : "Scan your configured sources to populate the library and discovery queue.",
          };

  const renderEmptyState = () => (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center text-text">
      <div className="atlas-glass-panel max-w-lg animate-atlas-fade-up px-10 py-12 shadow-glow-accent motion-reduce:animate-none">
        <span
          className="material-symbols-outlined atlas-pop text-[44px] text-accent/80"
          aria-hidden
        >
          {sectionMeta.icon}
        </span>
        <div className="mt-2 text-lg font-semibold tracking-tight text-text">
          {sectionMeta.emptyTitle}
        </div>
        <div className="mt-3 max-w-md text-sm text-text/70">
          {sectionMeta.emptyDescription}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {hasLibraryQuery ? (
            <button
              type="button"
              onClick={() => setLibraryQuery("")}
              className="border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-text transition hover:bg-accent/25"
            >
              Clear search
            </button>
          ) : activeSection === SECTION_LIBRARY ? (
            <>
              <button
                type="button"
                onClick={() => setShowDiscovery(true)}
                className="border border-accent/60 bg-accent px-3 py-1.5 text-xs font-semibold text-onAccent transition hover:brightness-110"
              >
                Open Scan Hub
              </button>
              <button
                type="button"
                onClick={openSearchWorkspace}
                className="border border-border bg-white/5 px-3 py-1.5 text-xs font-semibold text-text transition hover:bg-white/10"
              >
                Find games on F95
              </button>
              <button
                type="button"
                onClick={addGame}
                className="border border-border bg-white/5 px-3 py-1.5 text-xs font-semibold text-text transition hover:bg-white/10"
              >
                Add a game manually
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setActiveSection(SECTION_LIBRARY)}
              className="border border-border bg-white/5 px-3 py-1.5 text-xs font-semibold text-text transition hover:bg-white/10"
            >
              Back to library
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const sectionTitle =
    activeSection === SECTION_UPDATES
      ? "Updates"
      : activeSection === SECTION_SEARCH
        ? "Search"
        : activeSection === SECTION_SETTINGS
          ? "Settings"
          : "Games";

  const renderSectionContent = () => {
    if (activeSection === SECTION_SETTINGS) {
      return (
        <AppSafe name="settings" title="Settings failed to load">
          <window.SettingsPanel
            initialPage={settingsPageRequest.page}
            pageRequest={settingsPageRequest.nonce}
            onRunSetup={() => openOnboarding("folder")}
            onScanNow={() => rescanLibrary()}
            isScanRunning={isLibraryScanRunning}
          />
        </AppSafe>
      );
    }

    if (activeSection === SECTION_SEARCH) {
      return (
        <AppSafe name="search" title="The F95 workspace failed to load">
          <window.F95BrowserWorkspace />
        </AppSafe>
      );
    }

    if (isGamesLoading && games.length === 0) {
      return <LibrarySkeleton />;
    }

    if (activeSection === SECTION_LIBRARY && games.length === 0) {
      return (
        <AppSafe name="getting-started" title="The setup guide failed to load">
          <window.LibraryGettingStarted
            gameFolder={defaultGameFolder}
            hasScanSources={scanSources.some((source) => source.isEnabled)}
            isScanRunning={isLibraryScanRunning}
            onFindGames={() => openOnboarding("scan")}
            onScanNow={() => rescanLibrary()}
            onBrowseF95={openSearchWorkspace}
            onAddGame={addGame}
            onOpenLibrarySettings={() => openSettingsPage("library")}
          />
        </AppSafe>
      );
    }

    if (visibleLibraryGames.length === 0) {
      return renderEmptyState();
    }

    if (activeSection === SECTION_LIBRARY) {
      return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4 px-1 pb-3">
          {favoriteLibraryGames.length > 0 && (
            <section className="atlas-rise-enter space-y-3 px-2">
              <div className="flex items-center gap-3 px-1">
                <span
                  className="material-symbols-outlined text-[16px] text-amber-300"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                  aria-hidden
                >
                  star
                </span>
                <div className="text-[11px] uppercase tracking-[0.18em] text-text/85">
                  {`Favorites (${favoriteLibraryGames.length})`}
                </div>
                <div className="h-px flex-1 bg-border/80" />
              </div>
              {renderGameCardList(favoriteLibraryGames, "favorites")}
            </section>
          )}

          <section className="space-y-3 px-2">
            <div className="flex flex-wrap items-center gap-2 px-1">
              <div className="text-[11px] uppercase tracking-[0.18em] text-text/85">
                {`All Games (${nonFavoriteLibraryGames.length})`}
              </div>
              <div className="h-px min-w-[20px] flex-1 bg-border/80" />
              {renderSectionControls(nonFavoriteLibraryGames.length)}
            </div>
            {nonFavoriteLibraryGames.length > 0 &&
              renderGameCardList(nonFavoriteLibraryGames, "library")}
          </section>
        </div>
      );
    }

    return (
      <div className="mx-auto flex h-full w-full max-w-[1360px] flex-col gap-3 px-1 pb-3">
        <section className="space-y-3 px-2">
          <div className="flex flex-wrap items-center gap-2 px-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-text/85">
              {`Updates (${visibleLibraryGames.length})`}
            </div>
            <div className="h-px min-w-[20px] flex-1 bg-border/80" />
            {renderSectionControls(visibleLibraryGames.length)}
          </div>
        </section>

        <div className="min-h-0 flex-1">
          <AutoSizer>
            {({ height, width }) => {
              const adjustedWidth = Math.max(
                0,
                width - GRID_SCROLLBAR_GUTTER_PX,
              );
              return (
                <Grid
                  ref={gridRef}
                  columnCount={columnCount}
                  columnWidth={() => {
                    if (columnCount > 1) {
                      return adjustedWidth / columnCount - 8;
                    } else {
                      return adjustedWidth / columnCount - 14;
                    }
                  }}
                  rowCount={Math.ceil(
                    visibleLibraryGames.length / columnCount,
                  )}
                  rowHeight={bannerSize.bannerHeight + 16}
                  height={height}
                  width={adjustedWidth}
                  cellRenderer={cellRenderer}
                  style={{ overflowX: "hidden" }}
                />
              );
            }}
          </AutoSizer>
        </div>
      </div>
    );
  };

  const appUpdateBusy =
    appUpdateState.status === "checking" ||
    appUpdateState.status === "downloading";
  const previewIndex = previewSnapshot.index ?? 0;
  const previewList = previewSnapshot.previews || [];

  return (
    <div className="atlas-app flex h-screen min-h-0 flex-col font-sans text-[13px] antialiased">
      <div className="flex h-[70px] shrink-0 select-none items-center [-webkit-app-region:drag] fixed top-0 z-50 w-full border-b border-border bg-primary shadow-glass-sm">
        <div className="z-50 flex h-[70px] w-[60px] shrink-0 items-center justify-center border-r border-border bg-gradient-to-b from-tertiary to-primary">
          <img
            src="./assets/images/logo.png"
            alt="F95Launcher"
            className="atlas-fade-enter h-[48px] w-[48px] object-contain"
            draggable={false}
          />
        </div>
        <div className="relative flex-1 [-webkit-app-region:drag] h-[70px] bg-primary">
          <div className="absolute left-[48px] right-[200px] top-0 h-px bg-gradient-to-r from-transparent via-accent/35 to-transparent"></div>
          <div className="flex h-[70px] w-full items-center">
            <div className="ml-5 flex min-w-[72px] shrink-0 items-center">
              <div
                key={sectionTitle}
                className="atlas-list-enter cursor-default font-semibold text-text [-webkit-app-region:no-drag]"
              >
                {sectionTitle}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 justify-center">
              <window.SearchBox
                value={activeSection === SECTION_SEARCH ? "" : libraryQuery}
                onChange={handleSearchTextChange}
                onAction={openSearchWorkspace}
                isSearchActive={activeSection === SECTION_SEARCH}
                placeholder={
                  activeSection === SECTION_SEARCH
                    ? "Use the embedded F95 page below for live search"
                    : activeSection === SECTION_UPDATES
                      ? "Search updates"
                      : "Search library"
                }
              />
            </div>
          </div>
          <div className="pointer-events-none absolute right-[200px] top-1/2 z-0 -translate-y-1/2 select-none">
            <span className="whitespace-nowrap text-xs text-text/90">
              v{version} <span className="text-accent/90">α</span>
            </span>
          </div>
          <div className="absolute right-2 top-0 z-20 flex h-full items-center [-webkit-app-region:no-drag] gap-0.5">
            <button
              type="button"
              title={cloudAuthButtonTitle}
              aria-label={cloudAuthButtonTitle}
              onClick={() => setIsCloudAuthOpen(true)}
              className={`mr-1 flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border text-text transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                cloudAuthState.authenticated
                  ? "border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
                  : cloudAuthState.configured
                    ? "border-accent/35 bg-accent/10 hover:bg-accent/20"
                    : "border-border bg-white/5 hover:bg-white/10"
              }`}
            >
              <span
                key={cloudAuthButtonIcon}
                className="material-symbols-outlined atlas-pop text-[20px] leading-none"
              >
                {cloudAuthButtonIcon}
              </span>
            </button>
            <button
              type="button"
              aria-label="Minimize window"
              title="Minimize"
              onClick={() => window.electronAPI.minimizeWindow()}
              className="flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-transparent text-text transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <i className="fas fa-minus fa-sm"></i>
            </button>
            <button
              type="button"
              aria-label={isMaximized ? "Restore window" : "Maximize window"}
              title={isMaximized ? "Restore" : "Maximize"}
              onClick={() => window.electronAPI.maximizeWindow()}
              className="flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-transparent text-text transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <i
                key={isMaximized ? "restore" : "maximize"}
                className={`atlas-pop ${
                  isMaximized
                    ? "fas fa-window-restore fa-sm"
                    : "fas fa-window-maximize fa-sm"
                }`}
              ></i>
            </button>
            <button
              type="button"
              aria-label="Close window"
              title="Close"
              onClick={() => window.electronAPI.closeWindow()}
              className="flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-transparent text-text transition-colors hover:bg-red-900/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
            >
              <i className="fas fa-times fa-sm"></i>
            </button>
          </div>
        </div>
      </div>

      <div className="fixed bottom-[40px] left-0 right-0 top-[70px] flex flex-1 bg-transparent">
        <window.Sidebar
          activeSection={activeSection}
          onSelectSection={handleSidebarSelect}
          updateCount={updateAvailableCount}
        />
        <div className="ml-[60px] flex flex-1 overflow-hidden">
          {activeSection !== SECTION_SEARCH &&
            activeSection !== SECTION_SETTINGS &&
            showGameList &&
            !(!isGamesLoading && games.length === 0) && (
            <div className="atlas-glass-subtle atlas-list-enter w-[220px] shrink-0 overflow-y-auto border-r border-border">
              <div className="sticky top-0 z-10 flex min-h-[5rem] items-center justify-between gap-2 border-b border-border bg-black/20 px-3 text-[11px] uppercase leading-none tracking-[0.2em] text-text/55 backdrop-blur-md">
                <span>
                  {activeSection === SECTION_UPDATES
                    ? "Update Titles"
                    : "Library Titles"}
                </span>
                <span
                  key={visibleLibraryGames.length}
                  className="atlas-fade-enter tabular-nums tracking-normal text-text/40"
                >
                  {visibleLibraryGames.length}
                </span>
              </div>
              {isGamesLoading && games.length === 0 ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="space-y-1.5 py-1">
                      <div className="atlas-skeleton h-3 w-4/5" />
                      <div className="atlas-skeleton h-2.5 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : visibleLibraryGames.length === 0 ? (
                <div className="atlas-fade-enter p-4 text-center text-sm text-text/65">
                  No games found
                </div>
              ) : (
                visibleLibraryGames.map((game, index) => (
                  <div
                    key={game.record_id}
                    role="button"
                    tabIndex={0}
                    aria-current={
                      selectedGame?.record_id === game.record_id
                        ? "true"
                        : undefined
                    }
                    className={`atlas-list-enter cursor-pointer border-b border-white/14 p-3 outline-none transition-[background-color,border-color,box-shadow,padding] duration-500 hover:bg-white/5 hover:pl-4 focus-visible:bg-white/10 ${
                      selectedGame?.record_id === game.record_id
                        ? "border-l-2 border-l-accent bg-selected pl-4 shadow-glow-accent"
                        : "border-l-2 border-l-transparent"
                    }`}
                    style={{
                      "--atlas-index": Math.min(index, LIST_STAGGER_LIMIT),
                    }}
                    onClick={() => selectGame(game)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectGame(game);
                      }
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0 flex-1 truncate font-medium text-text">
                        {getDisplayTitle(game)}
                      </div>
                      {game.isFavorite && (
                        <span
                          className="material-symbols-outlined shrink-0 text-[13px] text-amber-300"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                          aria-label="Favorite"
                        >
                          star
                        </span>
                      )}
                      {game.isUpdateAvailable && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 bg-glam shadow-glow-glam"
                          title="Update available"
                        />
                      )}
                    </div>
                    <div className="truncate text-xs text-text/55">
                      {getDisplayCreator(game)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="flex flex-1 overflow-hidden">
            <div className="isolate flex flex-1 flex-col overflow-hidden">
              <div
                id="gameGrid"
                className="relative z-0 flex-1 overflow-y-auto overflow-x-hidden bg-transparent px-0.5 pt-6 pb-3"
                ref={gameGridRef}
              >
                <div
                  key={activeSection}
                  className={`h-full ${
                    activeSection === SECTION_SEARCH
                      ? "atlas-fade-enter"
                      : "atlas-view-enter"
                  }`}
                >
                  {renderSectionContent()}
                </div>
              </div>
            </div>

            {detailsPresence.isMounted && (
              <AppSafe
                name="library-details"
                title="Game details failed to load"
                resetKey={selectedGame?.record_id}
              >
                <window.LibraryDetailsPanel
                  presenceState={detailsPresence.state}
                  game={detailsSnapshot.game}
                  previews={detailsSnapshot.previews || []}
                  isLoading={detailsSnapshot.isLoading}
                  onClose={closeSelectedGamePanel}
                  onOpenPage={openSelectedGamePage}
                  onPlayGame={launchInstalledVersion}
                  onUpdateGame={handleGameUpdate}
                  onOpenFolder={openGameFolder}
                  onToggleFavorite={toggleGameFavorite}
                  onRemoveGame={openDeleteGameModal}
                  onPreviewSelect={setPreviewModalIndex}
                  onOpenCloudAuth={() => setIsCloudAuthOpen(true)}
                />
              </AppSafe>
            )}
          </div>
        </div>
      </div>

      <AppSafe name="scan-hub" variant="silent">
        <window.ScanHubPanel
          isVisible={showDiscovery}
          isLoading={isDiscoveryLoading}
          sources={scanSources}
          jobs={scanJobs}
          candidates={discoveryCandidates}
          isScanRunning={canCancelLibraryScan}
          defaultGameFolder={defaultGameFolder}
          onRefresh={loadScanHubData}
          onClose={() => setShowDiscovery(false)}
          onRescan={rescanLibrary}
          onCancelScan={cancelLibraryScan}
          onOpenFolder={openGameFolder}
          onAddSource={addScanSource}
          onToggleSource={toggleScanSource}
          onReplaceSource={replaceScanSource}
          onRemoveSource={removeScanSource}
          onSaveLibraryFolder={saveLibraryFolder}
        />
      </AppSafe>

      <AppSafe name="onboarding" variant="silent">
        <window.OnboardingWizard
          isOpen={onboarding.isOpen}
          initialStep={onboarding.step}
          cloudAuthState={cloudAuthState}
          onOpenCloud={() => setIsCloudAuthOpen(true)}
          onFinish={finishOnboarding}
        />
      </AppSafe>

      <AppSafe name="cloud-auth" variant="silent">
        <window.CloudAuthPanel
          layout="modal"
          isOpen={isCloudAuthOpen}
          onClose={() => setIsCloudAuthOpen(false)}
        />
      </AppSafe>

      {previewPresence.isMounted && previewList.length > 0 && (
        <div
          className="fixed inset-0 z-[1600]"
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot viewer"
        >
          <button
            type="button"
            data-no-ripple
            className="atlas-overlay absolute inset-0 block h-full w-full cursor-default border-0 bg-black/90 p-0 backdrop-blur-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
            data-state={previewPresence.state}
            onClick={closePreviewModal}
            aria-label="Close screenshot viewer"
          />
          <div
            className="atlas-dialog pointer-events-none absolute inset-0 flex min-h-0 flex-col"
            data-state={previewPresence.state}
          >
            <div className="relative flex min-h-0 min-w-0 flex-1 items-stretch justify-center px-3 pb-20 pt-14 sm:px-5 sm:pb-24 sm:pt-16">
              <div
                key={`counter-${previewIndex}`}
                className="atlas-fade-enter pointer-events-auto absolute left-3 top-3 z-20 rounded-full border border-white/15 bg-black/55 px-3 py-1 text-xs tabular-nums text-white/90 shadow-lg backdrop-blur-md sm:left-4 sm:top-4"
              >
                {previewIndex + 1} / {previewList.length}
              </div>
              <button
                type="button"
                onClick={closePreviewModal}
                className="pointer-events-auto absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-md transition hover:bg-black/70 sm:right-4 sm:top-4"
                aria-label="Close"
                title="Close (Esc)"
              >
                <span className="material-symbols-outlined text-[22px] leading-none">
                  close
                </span>
              </button>

              <button
                type="button"
                className="pointer-events-auto absolute left-1 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 text-xl text-white shadow-lg backdrop-blur-md transition hover:bg-black/70 hover:shadow-glow-accent sm:left-3 sm:h-12 sm:w-12"
                aria-label="Previous screenshot"
                title="Previous (←)"
                onClick={showPreviousPreview}
              >
                <span className="material-symbols-outlined text-[26px] leading-none">
                  chevron_left
                </span>
              </button>
              <button
                type="button"
                className="pointer-events-auto absolute right-1 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 text-xl text-white shadow-lg backdrop-blur-md transition hover:bg-black/70 hover:shadow-glow-accent sm:right-3 sm:h-12 sm:w-12"
                aria-label="Next screenshot"
                title="Next (→)"
                onClick={showNextPreview}
              >
                <span className="material-symbols-outlined text-[26px] leading-none">
                  chevron_right
                </span>
              </button>

              <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
                <div
                  className="pointer-events-auto flex max-h-[min(82vh,920px)] max-w-[min(94vw,1500px)] min-h-0 min-w-0 items-center justify-center overflow-auto"
                  onClick={handlePreviewStageClick}
                >
                  <img
                    key={previewList[previewIndex]}
                    src={previewList[previewIndex]}
                    alt={`Screenshot ${previewIndex + 1} of ${previewList.length}`}
                    className="atlas-rise-enter max-h-full max-w-full object-contain shadow-2xl ring-1 ring-white/10"
                    draggable={false}
                  />
                </div>
              </div>

              <div className="pointer-events-auto absolute bottom-5 left-1/2 z-20 -translate-x-1/2 sm:bottom-6">
                <button
                  type="button"
                  onClick={() =>
                    window.electronAPI.openExternalUrl(previewList[previewIndex])
                  }
                  className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-4 py-2 text-xs text-white/95 shadow-lg backdrop-blur-md transition hover:border-white/25 hover:bg-black/70"
                  aria-label="Open original image"
                  title="Open original"
                >
                  <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden>
                    open_in_new
                  </span>
                  Open
                </button>
              </div>
            </div>
            <p className="pointer-events-none px-4 pb-3 text-center text-[11px] text-white/45">
              <span className="tabular-nums">← / →</span> switch •{" "}
              <span className="tabular-nums">Esc</span> close • click outside
              image
            </p>
          </div>
        </div>
      )}

      {/* Status / Progress dock */}
      <div className="pointer-events-none fixed bottom-[52px] left-1/2 z-[1500] flex w-[min(800px,calc(100%-2rem))] -translate-x-1/2 flex-col-reverse items-stretch gap-2">
        <StatusDockBar status={importProgress} counterLabel="Game" />
        <StatusDockBar status={importStatus} counterLabel="File" />
        <StatusDockBar status={dbUpdateStatus} counterLabel="Update" />
      </div>

      <AppSafe name="downloads" variant="silent">
        <window.DownloadsPanel
          isOpen={downloadsPanelOpen}
          items={f95Downloads.items}
          activeCount={f95Downloads.activeCount}
          onClose={() => setDownloadsPanelOpen(false)}
          onOpenLibraryRecord={openLibraryRecord}
        />
      </AppSafe>

      <AppSafe name="update-modal" variant="silent">
        <window.F95UpdateModal
          isOpen={f95UpdateModal.isOpen}
          game={f95UpdateModal.game}
          thread={f95UpdateModal.thread}
          isLoading={f95UpdateModal.isLoading}
          isInstalling={f95UpdateModal.isInstalling}
          error={f95UpdateModal.error}
          captchaUrl={f95UpdateModal.captchaUrl}
          attemptEvents={f95UpdateAttemptEvents}
          selectedLinkUrl={f95UpdateModal.selectedLinkUrl}
          onSelectLink={(selectedLinkUrl) =>
            setF95UpdateModal((previous) => ({
              ...previous,
              selectedLinkUrl,
            }))
          }
          onSolveCaptcha={openF95CaptchaWindow}
          onConfirm={confirmF95Update}
          onClose={closeF95UpdateModal}
        />
      </AppSafe>

      <AppSafe name="delete-modal" variant="silent">
        <window.LibraryResetModal
          isOpen={libraryResetModal.isOpen}
          isRunning={libraryResetModal.isRunning}
          error={libraryResetModal.error}
          gameCount={games.length}
          installedCount={installedGameCount}
          onConfirm={confirmLibraryReset}
          onClose={closeLibraryResetModal}
        />
        <window.DeleteGameModal
          isOpen={deleteGameModal.isOpen}
          game={deleteGameModal.game}
          installPaths={deleteGameModal.installPaths}
          saveProfiles={deleteGameModal.saveProfiles}
          mode={deleteGameModal.mode}
          isLoading={deleteGameModal.isLoading}
          isDeleting={deleteGameModal.isDeleting}
          error={deleteGameModal.error}
          onSelectMode={(mode) =>
            setDeleteGameModal((previous) => ({
              ...previous,
              mode,
            }))
          }
          onConfirm={confirmDeleteGame}
          onClose={closeDeleteGameModal}
        />
      </AppSafe>

      <div className="fixed bottom-0 z-50 grid min-h-[40px] w-full grid-cols-1 items-center gap-x-3 gap-y-2 border-t border-border bg-primary/75 px-2 py-1 shadow-glass-sm backdrop-blur-xl sm:h-[40px] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-4 sm:py-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={addGame}
            className="group flex h-8 items-center px-2 text-xs text-text transition hover:bg-white/10 hover:text-accent"
          >
            <i className="fas fa-plus mr-2 text-accent transition-transform duration-500 group-hover:rotate-90"></i>
            Add Game
          </button>
          <button
            type="button"
            onClick={() => setShowDiscovery((prev) => !prev)}
            aria-pressed={showDiscovery}
            className={`group flex h-8 items-center px-2 text-xs transition hover:bg-white/10 hover:text-accent ${
              showDiscovery ? "bg-white/10 text-accent" : "text-text"
            }`}
          >
            <i className="fas fa-binoculars mr-2 text-accent transition-transform duration-500 group-hover:-translate-y-0.5"></i>
            Scan Hub
          </button>
          <button
            type="button"
            onClick={openRescanLibraryMenu}
            disabled={isLibraryScanRunning}
            className="group flex h-8 items-center px-2 text-xs text-text transition hover:bg-white/10 hover:text-accent disabled:cursor-wait disabled:opacity-70"
          >
            <i
              className={`fas fa-sync-alt mr-2 text-accent ${
                isLibraryScanRunning
                  ? "animate-spin atlas-keep-motion"
                  : "transition-transform duration-700 group-hover:rotate-180"
              }`}
            ></i>
            {isLibraryScanRunning ? "Scanning…" : "Rescan Library"}
          </button>
          {cancelScanPresence.isMounted && (
            <button
              type="button"
              onClick={cancelLibraryScan}
              data-state={cancelScanPresence.state}
              className="atlas-rise flex h-8 items-center px-2 text-xs text-red-300 transition hover:bg-red-950/40 hover:text-red-100"
            >
              <i className="fas fa-ban mr-2"></i>
              Cancel Scan
            </button>
          )}
        </div>
        <div className="flex min-w-0 items-center justify-center gap-2 text-center text-[11px] text-text/80 sm:text-xs">
          <i className="fas fa-gamepad shrink-0 text-glam/90"></i>
          <span className="truncate tabular-nums">
            {isGamesLoading && games.length === 0
              ? "Loading library…"
              : `${games.length} in library · ${installedGameCount} installed${missingGameCount > 0 ? ` · ${missingGameCount} missing files` : ""}${notInstalledGameCount > 0 ? ` · ${notInstalledGameCount} not installed` : ""} · ${totalVersions} versions · ${updateAvailableCount} updates`}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          {appUpdateSummary && (
            <span
              key={appUpdateSummary}
              className="atlas-fade-enter max-w-[min(280px,40vw)] truncate text-[11px] text-text/65"
              title={appUpdateSummary}
            >
              {appUpdateSummary}
            </span>
          )}
          <button
            type="button"
            onClick={handleAppUpdateAction}
            disabled={appUpdateBusy}
            className={`relative flex items-center gap-1.5 overflow-hidden px-2 py-1 text-[11px] font-medium shadow-glass-sm transition ${
              appUpdateState.status === "downloaded"
                ? "atlas-attention bg-emerald-800/90 text-white hover:bg-emerald-700"
                : appUpdateState.status === "available"
                  ? "atlas-attention border border-accent/40 bg-accent/90 text-onAccent hover:bg-accent"
                  : "border border-border bg-white/5 text-text hover:bg-white/10"
            } ${appUpdateBusy ? "cursor-wait opacity-80" : ""}`}
          >
            {appUpdateBusy && <span className="atlas-spinner atlas-keep-motion text-[10px]" aria-hidden />}
            {appUpdateActionLabel}
            {appUpdateState.status === "downloading" && (
              <span
                className="atlas-progress-fill absolute bottom-0 left-0 h-[2px] bg-accent"
                style={{ width: `${clampPercent(appUpdateState.percent)}%` }}
                aria-hidden
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => setDownloadsPanelOpen((previous) => !previous)}
            aria-pressed={downloadsPanelOpen}
            className={`group flex h-8 items-center px-2 text-xs transition hover:bg-white/10 hover:text-accent ${
              downloadsPanelOpen ? "bg-white/10 text-accent" : "text-text"
            }`}
          >
            <i
              className={`fas fa-download mr-2 text-accent transition-transform duration-500 group-hover:translate-y-0.5 ${
                f95Downloads.activeCount > 0 ? "animate-pulse atlas-keep-motion" : ""
              }`}
            ></i>
            Downloads
            {f95Downloads.activeCount > 0 && (
              <span
                key={f95Downloads.activeCount}
                className="atlas-badge-enter ml-2 bg-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-onAccent"
              >
                {f95Downloads.activeCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root"));
const RootBoundary = window.AtlasErrorBoundary;
root.render(
  RootBoundary ? (
    <RootBoundary name="app" variant="screen">
      <App />
    </RootBoundary>
  ) : (
    <App />
  ),
);
