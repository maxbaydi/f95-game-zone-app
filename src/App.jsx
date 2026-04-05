const { useState, useEffect, useRef, useCallback, useMemo } = window.React;
const { createRoot } = window.ReactDOM;
const { AutoSizer, Grid } = window.ReactVirtualized;

const SECTION_LIBRARY = "library";
const SECTION_UPDATES = "updates";
const SECTION_SEARCH = "search";

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

const IMPORT_PROGRESS_TERMINAL_TOAST_MS = 2000;
const PREVIEW_MODAL_IMAGE_MAX_HEIGHT_CSS = "min(78vh, 900px)";

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

const filterLocalGames = (games, query, updatesOnly = false) => {
  const normalizedQuery = (query || "").trim().toLowerCase();
  let result = [...games];

  if (updatesOnly) {
    result = result.filter((game) => game.isUpdateAvailable === true);
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

const App = () => {
  const [games, setGames] = useState([]);
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
  const selectedGameRef = useRef(null);
  const f95UpdateModalRef = useRef(createDefaultF95UpdateModalState());
  const f95CaptchaRetryKeyRef = useRef("");
  const deleteGameModalRef = useRef(createDefaultDeleteGameModalState());

  const refreshLibraryGrid = useCallback(() => {
    if (!gridRef.current) {
      return;
    }

    gridRef.current.recomputeGridSize?.();
    gridRef.current.forceUpdate?.();
  }, []);

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
    let mounted = true;

    const applyDownloadsSnapshot = (payload) => {
      if (!mounted || !payload) {
        return;
      }

      setF95Downloads({
        items: Array.isArray(payload.items) ? payload.items : [],
        activeCount: Number(payload.activeCount) || 0,
      });
    };

    window.electronAPI
      .getF95Downloads()
      .then(applyDownloadsSnapshot)
      .catch((error) => {
        console.error("Failed to load F95 downloads:", error);
      });

    window.electronAPI.onF95DownloadsChanged((payload) => {
      applyDownloadsSnapshot(payload);
    });

    return () => {
      mounted = false;
      window.electronAPI.removeAllListeners("f95-downloads-changed");
    };
  }, []);

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
            "F95 Game Zone App could not inspect save locations.",
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
          "F95 Game Zone App could not inspect save locations.",
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
            result?.error || "F95 Game Zone App could not remove this game.",
        }));
        return;
      }

      closeDeleteGameModal();

      if (result.warnings?.length) {
        window.alert(result.warnings.join("\n"));
      } else if (
        deleteGameModal.mode === DELETE_GAME_MODES.DELETE_FILES_KEEP_SAVES
      ) {
        window.alert(
          "Installed files were removed and detected saves were kept.",
        );
      } else if (
        deleteGameModal.mode === DELETE_GAME_MODES.DELETE_FILES_AND_SAVES
      ) {
        window.alert("Installed files and detected saves were removed.");
      }
    } catch (error) {
      console.error("Failed to delete game:", error);
      setDeleteGameModal((previous) => ({
        ...previous,
        isDeleting: false,
        error: error.message || "F95 Game Zone App could not remove this game.",
      }));
    }
  };

  const handleGameUpdate = async (game) => {
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

    try {
      const result = await window.electronAPI.installF95Thread({
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
        downloadLabel: selectedLink.label,
        downloadUrl: downloadUrlOverride || selectedLink.url,
      });

      if (!result?.success) {
        if (result?.code === "captcha_required") {
          setF95UpdateModal((previous) => ({
            ...previous,
            isInstalling: false,
            error:
              result?.error ||
              "This mirror needs captcha confirmation before Atlas can continue.",
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

      setDownloadsPanelOpen(true);
      closeF95UpdateModal();
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
    if (targetPath) {
      window.electronAPI.openDirectory(targetPath);
    }
  };

  const launchInstalledVersion = async (version, game) => {
    const extension = version?.exec_path
      ? version.exec_path.split(".").pop().toLowerCase()
      : "";
    const result = await window.electronAPI.launchGame({
      execPath: version?.exec_path || "",
      extension,
      recordId: game?.record_id || null,
    });

    if (!result?.success) {
      window.alert(
        result?.error ||
          "Could not start this game. Check the installed files and try again.",
      );
    }
  };

  const openSitePage = (targetUrl) => {
    if (targetUrl) {
      window.electronAPI.openExternalUrl(targetUrl);
    }
  };

  const addScanSource = async () => {
    const selectedPath = await window.electronAPI.selectDirectory();
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
    const selectedPath = await window.electronAPI.selectDirectory();
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

  const chooseLibraryFolder = async () => {
    const selectedPath = await window.electronAPI.selectDirectory();
    if (!selectedPath) {
      return { success: false, cancelled: true };
    }

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

    window.electronAPI
      .getConfig()
      .then((config) => {
        const newConfig = {
          ...config,
          Interface: {
            ...config.Interface,
            showGameList: newVisible,
          },
        };
        window.electronAPI.saveSettings(newConfig);
      })
      .catch((err) =>
        console.error("Failed to save game list visibility:", err),
      );
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
            setGames((prev) => {
              const newGames = prev.map((g) =>
                g.record_id === updatedGame.record_id ? updatedGame : g,
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
              current?.record_id === updatedGame.record_id
                ? updatedGame
                : current,
            );
            setSelectedGameDetails((current) =>
              current?.record_id === updatedGame.record_id
                ? updatedGame
                : current,
            );
            console.log(`Forcing grid update for recordId: ${recordId}`);
            refreshLibraryGrid();
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
    [],
  );

  // Handle resize with debounce for smoother updates
  const debounceResize = debounce(() => {
    const containerWidth =
      gameGridRef.current?.clientWidth || window.innerWidth - 260;
    const scrollbarWidth = getScrollbarWidth();
    const adjustedWidth = Math.max(0, containerWidth - scrollbarWidth);
    const newColumnCount = getColumnCount(adjustedWidth);
    setColumnCount(newColumnCount);
    refreshLibraryGrid();
  }, 16); // ~60fps for smoother resize

  useEffect(() => {
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
      })
      .catch((error) => {
        console.error("Failed to fetch games:", error);
        setGames([]);
        setTotalVersions(0);
      });

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

    window.electronAPI.getVersion().then((v) => setVersion(v));
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

    window.electronAPI.onGameDeleted(handleGameDeleted);
    window.electronAPI.onWindowStateChanged(handleWindowStateChanged);
    window.electronAPI.onDbUpdateProgress(handleDbUpdateProgress);
    window.electronAPI.onImportProgress(handleImportProgress);
    window.electronAPI.onGameImported(handleGameImported);
    const handleGamesLibrarySynced = () => {
      window.electronAPI
        .getGames()
        .then((allGames) => {
          const gamesArray = Array.isArray(allGames) ? allGames : [];
          setGames(gamesArray);
          setTotalVersions(
            gamesArray.reduce(
              (sum, game) => sum + (game.versionCount || 0),
              0,
            ),
          );
        })
        .catch((error) => {
          console.error(
            "Failed to refresh games after cloud library sync:",
            error,
          );
        });
    };
    const unsubscribeGamesLibrarySynced =
      typeof window.electronAPI.onGamesLibrarySynced === "function"
        ? window.electronAPI.onGamesLibrarySynced(handleGamesLibrarySynced)
        : null;
    window.electronAPI.onGameUpdated(handleGameUpdated);
    window.electronAPI.onImportComplete(handleImportComplete);
    window.electronAPI.onUpdateStatus(handleUpdateStatus);
    window.electronAPI.onF95BrowserNavigation(handleF95BrowserNavigation);

    //banner context menu
    window.electronAPI.onContextMenuCommand((event, data) => {
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

      if (data.action === "rescanLibrary") {
        rescanLibrary();
        return;
      }

      if (data.action === "resetCacheAndRescanLibrary") {
        rescanLibrary({ resetCache: true });
        return;
      }

      if (data.action === "refreshLibraryPreviews") {
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
            setIsLibraryScanRunning(false);
          });
      }
    });

    // Set up resize listener
    window.addEventListener("resize", debounceResize);
    debounceResize(); // Initial resize calculation

    // Cleanup
    return () => {
      window.electronAPI.removeUpdateStatusListener?.();
      window.removeEventListener("resize", debounceResize);
      window.electronAPI.onWindowStateChanged(() => {});
      window.electronAPI.onDbUpdateProgress(() => {});
      window.electronAPI.onImportProgress(() => {});
      window.electronAPI.onGameImported(() => {});
      window.electronAPI.onGameUpdated(() => {});
      window.electronAPI.onImportComplete(() => {});
      window.electronAPI.onUpdateStatus(() => {});
      window.electronAPI.removeAllListeners("f95-browser-navigation");
      unsubscribeGamesLibrarySynced?.();
    };
  }, [refreshLibraryGrid]);

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

    const unsubscribe = window.electronAPI.onCloudAuthChanged((state) => {
      applyCloudAuthState(state);
    });

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
    if (isLibraryScanRunning) {
      return;
    }

    const isResetRescan = Boolean(options?.resetCache);

    setIsLibraryScanRunning(true);
    setImportProgress({
      text: isResetRescan
        ? "Starting reset-cache library rescan..."
        : "Starting library rescan...",
      progress: 0,
      total: 1,
    });

    try {
      const result = await window.electronAPI.scanLibrary(options);

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
        return;
      }

      setImportProgress({
        text:
          result.warningsCount > 0
            ? `Library rescan complete: ${result.imported} imported from ${result.scanned} detected (${result.warningsCount} warnings)`
            : `Library rescan complete: ${result.imported} imported from ${result.scanned} detected`,
        progress: result.imported || 0,
        total: result.scanned || 1,
      });
    } catch (error) {
      console.error("Failed to rescan library:", error);
      setImportProgress({
        text: `Library rescan error: ${error.message}`,
        progress: 0,
        total: 1,
      });
    } finally {
      if (showDiscovery) {
        loadDiscoveryCandidates();
      }
      setIsLibraryScanRunning(false);
    }
  };

  const openRescanLibraryMenu = () => {
    if (isLibraryScanRunning) {
      return;
    }

    window.electronAPI.showContextMenu([
      {
        label: "Refresh Cached Screenshots",
        data: { action: "refreshLibraryPreviews" },
      },
      {
        label: "Reset Cache & Rescan Library",
        data: { action: "resetCacheAndRescanLibrary" },
      },
      {
        label: "Rescan Library",
        data: { action: "rescanLibrary" },
      },
    ]);
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
    }
  };

  const loadDiscoveryCandidates = async () => {
    await loadScanHubData();
  };

  const visibleLibraryGames = useMemo(
    () =>
      sortLibraryGames(
        filterLocalGames(
          games,
          libraryQuery,
          activeSection === SECTION_UPDATES,
        ),
        librarySortMode,
      ),
    [games, libraryQuery, activeSection, librarySortMode],
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

  useEffect(() => {
    if (previewModalIndex === null) {
      return;
    }
    const count = selectedGamePreviews.length;
    if (count === 0) {
      return;
    }
    const onKey = (e) => {
      if (e.key === "Escape") {
        setPreviewModalIndex(null);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPreviewModalIndex((i) => (i === null ? 0 : (i - 1 + count) % count));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setPreviewModalIndex((i) => (i === null ? 0 : (i + 1) % count));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewModalIndex, selectedGamePreviews.length]);

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
  const installedGameCount = useMemo(
    () =>
      games.filter(
        (game) => Array.isArray(game.versions) && game.versions.length > 0,
      ).length,
    [games],
  );

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
    const resizeTimeout = setTimeout(() => {
      debounceResize();
    }, 0);

    return () => clearTimeout(resizeTimeout);
  }, [
    activeSection,
    showGameList,
    selectedGame?.record_id,
    isSelectedGameLoading,
    visibleLibraryGames.length,
    siteSearchResults.length,
  ]);

  const getColumnCount = (width) => {
    const containerWidth =
      width || gameGridRef.current?.clientWidth || window.innerWidth - 260;
    const scrollbarWidth = getScrollbarWidth();
    const adjustedWidth = containerWidth - scrollbarWidth;
    return Math.max(
      1,
      Math.floor(adjustedWidth / (bannerSize.bannerWidth + 8)),
    );
  };

  const getScrollbarWidth = () => {
    if (gameGridRef.current) {
      return gameGridRef.current.offsetWidth - gameGridRef.current.clientWidth;
    }
    return 8;
  };

  const cellRenderer = ({ columnIndex, rowIndex, style }) => {
    const index = rowIndex * columnCount + columnIndex;
    if (index >= visibleLibraryGames.length) return null;
    const game = visibleLibraryGames[index];
    return (
      <div
        key={game.record_id}
        style={{
          ...style,
          display: "flex",
          justifyContent: "center",
          padding: "8px 4px",
          maxWidth: "100%",
        }}
      >
        <window.GameBanner
          game={game}
          onSelect={() => setSelectedGame(game)}
          onUpdateGame={handleGameUpdate}
        />
      </div>
    );
  };

  const sectionMeta =
    activeSection === SECTION_UPDATES
      ? {
          eyebrow: "Update Inbox",
          emptyTitle: "No pending updates",
          emptyDescription:
            "Current library entries are already on their latest known version.",
        }
      : activeSection === SECTION_SEARCH
        ? {
            eyebrow: "F95 Workspace",
            emptyTitle: "F95 session required",
            emptyDescription:
              "Log in to F95 to unlock the live search workspace, direct downloads and install-to-library flow.",
          }
        : {
            eyebrow: "User Library",
            emptyTitle: "Library is empty",
            emptyDescription:
              "Scan your configured sources to populate the library and discovery queue.",
          };

  const renderEmptyState = () => (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center text-text">
      <div className="atlas-glass-panel motion-reduce:animate-none max-w-lg animate-atlas-fade-up rounded-2xl px-10 py-12 shadow-glow-accent">
        <div className="text-lg font-semibold tracking-tight text-text">
          {sectionMeta.emptyTitle}
        </div>
        <div className="mt-3 max-w-md text-sm text-text/70">
          {sectionMeta.emptyDescription}
        </div>
      </div>
    </div>
  );

  return (
    <div className="atlas-app flex h-screen min-h-0 flex-col font-sans text-[13px] antialiased">
      <div className="flex h-[70px] shrink-0 select-none items-center [-webkit-app-region:drag] fixed top-0 z-50 w-full border-b border-border bg-primary/70 shadow-glass-sm backdrop-blur-xl">
        <div className="z-50 flex h-[70px] w-[60px] shrink-0 items-center justify-center bg-gradient-to-br from-accentBar via-accent to-[#1e6b7e] shadow-glow-accent">
          <svg
            className="w-[50px] h-[50px] text-atlasLogo"
            viewBox="0 0 24 24"
            style={{ shapeRendering: "geometricPrecision" }}
            fill="currentColor"
            dangerouslySetInnerHTML={{ __html: window.atlasLogo.path }}
          />
        </div>
        <div className="relative flex-1 [-webkit-app-region:drag] h-[70px] bg-gradient-to-r from-primary/98 via-primary/92 to-primary/98">
          <div className="absolute left-[48px] right-[200px] top-0 h-[2px] bg-gradient-to-r from-transparent via-accentBar/85 to-transparent"></div>
          <div className="flex h-[70px] w-full items-center">
            <div className="ml-5 flex shrink-0 items-center">
              <div className="cursor-pointer bg-gradient-to-r from-accent via-highlight to-glam/90 bg-clip-text font-semibold text-transparent [-webkit-app-region:no-drag]">
                {activeSection === SECTION_UPDATES
                  ? "Updates"
                  : activeSection === SECTION_SEARCH
                    ? "Search"
                    : "Games"}
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
                    : "Search library"
                }
              />
            </div>
          </div>
          <div className="pointer-events-none absolute right-[200px] top-1/2 z-0 -translate-y-1/2 select-none">
            <span className="whitespace-nowrap text-xs text-text/90">
              v{version}{" "}
              <span className="text-glam drop-shadow-[0_0_8px_rgba(201,166,90,0.45)]">
                α
              </span>
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
              <span className="material-symbols-outlined text-[20px] leading-none">
                {cloudAuthButtonIcon}
              </span>
            </button>
            <button
              type="button"
              aria-label="Minimize window"
              onClick={() => window.electronAPI.minimizeWindow()}
              className="flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-transparent text-text transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <i className="fas fa-minus fa-sm"></i>
            </button>
            <button
              type="button"
              aria-label={isMaximized ? "Restore window" : "Maximize window"}
              onClick={() => window.electronAPI.maximizeWindow()}
              className="flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-transparent text-text transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <i
                className={
                  isMaximized
                    ? "fas fa-window-restore fa-sm"
                    : "fas fa-window-maximize fa-sm"
                }
              ></i>
            </button>
            <button
              type="button"
              aria-label="Close window"
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
          {activeSection !== SECTION_SEARCH && showGameList && (
            <div className="atlas-glass-subtle w-[220px] shrink-0 overflow-y-auto border-r border-border">
              <div className="sticky top-0 z-10 border-b border-border bg-black/20 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-text/55 backdrop-blur-md">
                {activeSection === SECTION_UPDATES
                  ? "Update Titles"
                  : "Library Titles"}
              </div>
              {visibleLibraryGames.length === 0 ? (
                <div className="p-4 text-center text-sm text-text/65">
                  No games found
                </div>
              ) : (
                visibleLibraryGames.map((game) => (
                  <div
                    key={game.record_id}
                    className={`cursor-pointer border-b border-white/14 p-3 transition-all duration-200 hover:bg-white/5 ${
                      selectedGame?.record_id === game.record_id
                        ? "border-l-2 border-l-accent bg-selected shadow-glow-accent"
                        : "border-l-2 border-l-transparent"
                    }`}
                    onClick={() => setSelectedGame(game)}
                  >
                    <div className="truncate font-medium text-text">
                      {getDisplayTitle(game)}
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
              {activeSection !== SECTION_SEARCH && (
                <div className="atlas-glass-panel relative z-20 shrink-0 border-b border-border px-4 py-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 text-[10px] uppercase leading-none tracking-[0.2em] text-glam/90">
                      {sectionMeta.eyebrow}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 border border-border bg-black/25 px-2 py-1 text-[11px] text-text/90 shadow-glass-sm backdrop-blur-md">
                        <span className="uppercase tracking-[0.14em] text-text/60">
                          Sort
                        </span>
                        <select
                          value={librarySortMode}
                          onChange={(event) =>
                            setLibrarySortMode(event.target.value)
                          }
                          title={librarySortDescription}
                          className="min-w-[196px] bg-transparent text-xs text-text outline-none"
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
                      <button
                        type="button"
                        onClick={toggleGameList}
                        className="border border-border bg-white/5 px-2 py-1 text-xs text-text shadow-glass-sm backdrop-blur-md transition hover:bg-white/10 hover:shadow-glass"
                      >
                        {showGameList ? "Hide titles" : "Show titles"}
                      </button>
                      <div className="border border-border bg-black/25 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-text/90 backdrop-blur-sm">
                        {`${visibleLibraryGames.length} results`}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] text-text/60">
                    {librarySortDescription}
                  </div>
                </div>
              )}

              <div
                id="gameGrid"
                className="relative z-0 flex-1 overflow-y-auto overflow-x-hidden bg-transparent px-0.5 pt-6 pb-3"
                ref={gameGridRef}
              >
                {activeSection === SECTION_SEARCH ? (
                  <window.F95BrowserWorkspace />
                ) : visibleLibraryGames.length === 0 ? (
                  renderEmptyState()
                ) : (
                  <AutoSizer>
                    {({ height, width }) => {
                      const adjustedWidth = Math.max(
                        0,
                        width - getScrollbarWidth(),
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
                )}
              </div>
            </div>

            {activeSection !== SECTION_SEARCH &&
              (selectedGame || isSelectedGameLoading) && (
                <window.LibraryDetailsPanel
                  game={selectedGameDetails}
                  previews={selectedGamePreviews}
                  isLoading={isSelectedGameLoading}
                  onClose={closeSelectedGamePanel}
                  onOpenPage={openSelectedGamePage}
                  onPlayGame={launchInstalledVersion}
                  onUpdateGame={handleGameUpdate}
                  onOpenFolder={openGameFolder}
                  onRemoveGame={openDeleteGameModal}
                  onPreviewSelect={setPreviewModalIndex}
                  onOpenCloudAuth={() => setIsCloudAuthOpen(true)}
                />
              )}
          </div>
        </div>
      </div>

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
        onChooseLibraryFolder={chooseLibraryFolder}
      />

      <window.CloudAuthPanel
        layout="modal"
        isOpen={isCloudAuthOpen}
        onClose={() => setIsCloudAuthOpen(false)}
      />

      {previewModalIndex !== null && selectedGamePreviews.length > 0 && (
        <div
          className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md sm:p-6"
          onClick={() => setPreviewModalIndex(null)}
          role="presentation"
        >
          <div
            className="flex max-h-full w-full max-w-[min(96vw,1200px)] flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Screenshot viewer"
          >
            <div className="flex w-full min-h-0 flex-1 items-center justify-center gap-2 sm:gap-4">
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-primary/85 text-lg text-text shadow-glass backdrop-blur-xl transition hover:bg-primary sm:h-11 sm:w-11"
                aria-label="Previous screenshot"
                onClick={() =>
                  setPreviewModalIndex((i) => {
                    const n = selectedGamePreviews.length;
                    if (n === 0) {
                      return null;
                    }
                    const cur = i ?? 0;
                    return (cur - 1 + n) % n;
                  })
                }
              >
                ‹
              </button>
              <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
                <img
                  src={selectedGamePreviews[previewModalIndex]}
                  alt={`Screenshot ${previewModalIndex + 1} of ${selectedGamePreviews.length}`}
                  className="max-w-full rounded-2xl border border-border object-contain shadow-glass ring-1 ring-border motion-safe:animate-atlas-fade-up"
                  style={{ maxHeight: PREVIEW_MODAL_IMAGE_MAX_HEIGHT_CSS }}
                />
              </div>
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-primary/85 text-lg text-text shadow-glass backdrop-blur-xl transition hover:bg-primary sm:h-11 sm:w-11"
                aria-label="Next screenshot"
                onClick={() =>
                  setPreviewModalIndex((i) => {
                    const n = selectedGamePreviews.length;
                    if (n === 0) {
                      return null;
                    }
                    const cur = i ?? 0;
                    return (cur + 1) % n;
                  })
                }
              >
                ›
              </button>
            </div>
            <div className="text-xs tabular-nums text-text/75">
              {previewModalIndex + 1} / {selectedGamePreviews.length}
            </div>
          </div>
        </div>
      )}

      {/* Status / Progress Bars */}
      {dbUpdateStatus.text && (
        <div className="absolute bottom-[44px] left-1/2 z-[1500] flex w-[min(600px,calc(100%-2rem))] -translate-x-1/2 transform items-center justify-center border border-border bg-primary/80 p-2 shadow-glass backdrop-blur-xl">
          <div className="flex w-full max-w-[540px] items-center gap-3">
            <span className="min-w-0 flex-1 text-[11px] leading-snug text-text/90">
              {dbUpdateStatus.text}
            </span>
            <div className="relative w-[min(300px,45%)] shrink-0">
              <div className="h-4 overflow-hidden rounded-full bg-black/40 ring-1 ring-inset ring-border">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accentBar shadow-glow-accent transition-[width] duration-300"
                  style={{
                    width: `${(dbUpdateStatus.progress / (dbUpdateStatus.total || 1)) * 100}%`,
                  }}
                ></div>
              </div>
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-medium text-text">
                Update {dbUpdateStatus.progress}/{dbUpdateStatus.total}
              </span>
            </div>
          </div>
        </div>
      )}

      {importStatus.text && (
        <div className="absolute bottom-[52px] left-1/2 z-[1500] flex w-[min(600px,calc(100%-2rem))] -translate-x-1/2 transform items-center justify-center border border-border bg-primary/80 p-2 shadow-glass backdrop-blur-xl">
          <div className="flex w-full max-w-[540px] items-center gap-3">
            <span className="min-w-0 flex-1 text-[11px] leading-snug text-text/90">
              {importStatus.text}
            </span>
            <div className="relative w-[min(300px,45%)] shrink-0">
              <div className="h-4 overflow-hidden rounded-full bg-black/40 ring-1 ring-inset ring-border">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accentBar shadow-glow-accent transition-[width] duration-300"
                  style={{
                    width: `${(importStatus.progress / importStatus.total) * 100}%`,
                  }}
                ></div>
              </div>
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-medium text-text">
                File {importStatus.progress}/{importStatus.total}
              </span>
            </div>
          </div>
        </div>
      )}

      {importProgress.text && (
        <div className="absolute bottom-[56px] left-1/2 z-[1500] flex w-[min(800px,calc(100%-2rem))] -translate-x-1/2 transform items-center justify-center border border-border bg-primary/80 p-2 shadow-glass backdrop-blur-xl">
          <div className="flex w-full max-w-[760px] items-center gap-3">
            <span className="min-w-0 flex-1 text-[11px] leading-snug text-text/90">
              {importProgress.text}
            </span>
            <div className="relative w-[min(300px,38%)] shrink-0">
              <div className="h-4 overflow-hidden rounded-full bg-black/40 ring-1 ring-inset ring-border">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accentBar shadow-glow-accent transition-[width] duration-300"
                  style={{
                    width: `${(importProgress.progress / (importProgress.total || 1)) * 100}%`,
                  }}
                ></div>
              </div>
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-medium text-text">
                Game {importProgress.progress}/{importProgress.total}
              </span>
            </div>
          </div>
        </div>
      )}

      <window.DownloadsPanel
        isOpen={downloadsPanelOpen}
        items={f95Downloads.items}
        activeCount={f95Downloads.activeCount}
        onClose={() => setDownloadsPanelOpen(false)}
      />

      <window.F95UpdateModal
        isOpen={f95UpdateModal.isOpen}
        game={f95UpdateModal.game}
        thread={f95UpdateModal.thread}
        isLoading={f95UpdateModal.isLoading}
        isInstalling={f95UpdateModal.isInstalling}
        error={f95UpdateModal.error}
        captchaUrl={f95UpdateModal.captchaUrl}
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

      <div className="fixed bottom-0 z-50 grid min-h-[40px] w-full grid-cols-1 items-center gap-x-3 gap-y-2 border-t border-border bg-primary/75 px-2 py-1 shadow-glass-sm backdrop-blur-xl sm:h-[40px] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-4 sm:py-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={addGame}
            className="flex h-8 items-center px-2 text-xs text-text transition hover:bg-white/10 hover:text-highlight"
          >
            <i className="fas fa-plus mr-2 text-accent"></i>
            Add Game
          </button>
          <button
            type="button"
            onClick={() => setShowDiscovery((prev) => !prev)}
            className="flex h-8 items-center px-2 text-xs text-text transition hover:bg-white/10 hover:text-highlight"
          >
            <i className="fas fa-binoculars mr-2 text-accent"></i>
            Scan Hub
          </button>
          <button
            type="button"
            onClick={openRescanLibraryMenu}
            className="flex h-8 items-center px-2 text-xs text-text transition hover:bg-white/10 hover:text-highlight"
          >
            <i className="fas fa-sync-alt mr-2 text-accent"></i>
            Rescan Library
          </button>
          {canCancelLibraryScan && (
            <button
              type="button"
              onClick={cancelLibraryScan}
              className="flex h-8 items-center px-2 text-xs text-red-300 transition hover:bg-red-950/40 hover:text-red-100"
            >
              <i className="fas fa-ban mr-2"></i>
              Cancel Scan
            </button>
          )}
        </div>
        <div className="flex min-w-0 items-center justify-center gap-2 text-center text-[11px] text-text/80 sm:text-xs">
          <i className="fas fa-gamepad shrink-0 text-glam/90"></i>
          <span className="truncate">
            {`${games.length} in library · ${installedGameCount} installed · ${totalVersions} versions · ${updateAvailableCount} updates`}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          {appUpdateSummary && (
            <span className="max-w-[min(280px,40vw)] truncate text-[11px] text-text/65">
              {appUpdateSummary}
            </span>
          )}
          <button
            type="button"
            onClick={handleAppUpdateAction}
            disabled={
              appUpdateState.status === "checking" ||
              appUpdateState.status === "downloading"
            }
            className={`px-2 py-1 text-[11px] font-medium shadow-glass-sm transition ${
              appUpdateState.status === "downloaded"
                ? "bg-emerald-800/90 text-white hover:bg-emerald-700"
                : appUpdateState.status === "available"
                  ? "border border-accent/40 bg-accent/90 text-text hover:bg-accent"
                  : "border border-border bg-white/5 text-text hover:bg-white/10"
            } ${
              appUpdateState.status === "checking" ||
              appUpdateState.status === "downloading"
                ? "cursor-not-allowed opacity-60"
                : ""
            }`}
          >
            {appUpdateActionLabel}
          </button>
          <button
            type="button"
            onClick={() => setDownloadsPanelOpen((previous) => !previous)}
            className="flex h-8 items-center px-2 text-xs text-text transition hover:bg-white/10 hover:text-highlight"
          >
            <i className="fas fa-download mr-2 text-accent"></i>
            Downloads
            {f95Downloads.activeCount > 0 && (
              <span className="ml-2 bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-black">
                {f95Downloads.activeCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Updater placeholder */}
      <div className="hidden bg-canvas h-full w-full" id="updater">
        <div className="h-[200px] bg-tertiary"></div>
        <div className="flex-1 bg-primary border-t border-accent"></div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root"));
root.render(<App />);
