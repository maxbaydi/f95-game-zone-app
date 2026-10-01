const {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} = window.React;

const LIBRARY_DETAILS_PANEL_WIDTH_STORAGE_KEY =
  "app-library-details-panel-width";
// Key written by builds before the UI layer was renamed.
const LIBRARY_DETAILS_PANEL_WIDTH_LEGACY_STORAGE_KEY =
  "atlas-library-details-panel-width";
const LIBRARY_DETAILS_PANEL_WIDTH_DEFAULT_PX = 420;
const LIBRARY_DETAILS_PANEL_WIDTH_MIN_PX = 280;
const LIBRARY_DETAILS_PANEL_WIDTH_MAX_PX = 900;
const LIBRARY_DETAILS_PANEL_WIDTH_PERSIST_DELAY_MS = 160;

const getLibraryDetailsPanelMaxWidthPx = () =>
  Math.min(
    LIBRARY_DETAILS_PANEL_WIDTH_MAX_PX,
    Math.max(
      LIBRARY_DETAILS_PANEL_WIDTH_MIN_PX,
      typeof window !== "undefined" ? window.innerWidth - 160 : LIBRARY_DETAILS_PANEL_WIDTH_MAX_PX,
    ),
  );

const readStoredLibraryDetailsPanelWidthPx = () => {
  try {
    const raw =
      localStorage.getItem(LIBRARY_DETAILS_PANEL_WIDTH_STORAGE_KEY) ??
      localStorage.getItem(LIBRARY_DETAILS_PANEL_WIDTH_LEGACY_STORAGE_KEY);
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) {
      const max = getLibraryDetailsPanelMaxWidthPx();
      return Math.min(
        max,
        Math.max(LIBRARY_DETAILS_PANEL_WIDTH_MIN_PX, n),
      );
    }
  } catch {
    /* ignore */
  }
  return LIBRARY_DETAILS_PANEL_WIDTH_DEFAULT_PX;
};

const formatDetailDate = (value) => {
  if (!value) {
    return "Unknown";
  }

  const date =
    typeof value === "number"
      ? new Date(value * 1000)
      : new Date(Number(value) ? Number(value) * 1000 : value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleDateString();
};

const formatDetailBytes = (value) => {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) {
    return "Unknown";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let scaled = size;

  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  return `${scaled.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const SCREENSHOTS_GRID_MAX_HEIGHT_PX = 420;

const splitGameTags = (value) => {
  if (!value || typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 14);
};

const DetailPill = ({ children, tone = "neutral" }) => {
  const toneClass =
    tone === "accent"
      ? "border-accent/45 bg-accent/25 text-text shadow-glow-accent"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/15 text-amber-50"
        : tone === "danger"
          ? "border-red-500/45 bg-red-500/15 text-red-100"
          : "border-border/85 bg-white/5 text-text backdrop-blur-sm";

  return (
    <span
      className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] ${toneClass}`}
    >
      {children}
    </span>
  );
};

const DetailRow = ({ label, value }) => (
  <div className="flex items-start justify-between gap-4 border-b border-border/40 py-2 text-sm last:border-b-0">
    <span className="shrink-0 uppercase tracking-[0.16em] opacity-50">
      {label}
    </span>
    <span className="text-right text-text">{value || "Unknown"}</span>
  </div>
);

const DetailsImage = ({ src, alt, className, fallback }) =>
  window.AppImage ? (
    <window.AppImage
      src={src}
      alt={alt}
      className={className}
      fallback={fallback}
      draggable={false}
    />
  ) : src ? (
    <img src={src} alt={alt} className={className} />
  ) : (
    fallback
  );

// "5 min ago", "2 h ago", "3 days ago"; "" for missing or invalid values.
const formatDetailRelativeTime = (value, nowMs = Date.now()) => {
  const time =
    typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(time)) {
    return "";
  }

  const minutes = Math.round(Math.max(0, nowMs - time) / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
};

window.formatDetailRelativeTime = formatDetailRelativeTime;

const detailsToast = () => window.AppUI?.toast || window.AppToast || null;

const detailsConfirm = (options) =>
  window.AppUI?.confirm
    ? window.AppUI.confirm(options)
    : Promise.resolve(window.confirm(options?.message || options?.title || ""));

const DETAILS_EXECUTABLE_LIST_LIMIT = 30;
const DETAILS_ENGINE_SUGGESTIONS = [
  "Ren'Py",
  "RPGM",
  "Unity",
  "Unreal Engine",
  "HTML",
  "Flash",
  "Java",
  "QSP",
  "RAGS",
  "Tads",
  "WebGL",
  "Wolf RPG",
  "ADRIFT",
  "Others",
];

/**
 * Inline "Which file starts the game?" picker for a version whose launcher
 * is unknown: files found in the folder, plus Browse… for anything else.
 */
const DetailsExecutablePicker = ({ game, version, onChosen, onClose }) => {
  const [listState, setListState] = React.useState({
    isLoading: true,
    candidates: [],
    error: "",
  });
  const [busyValue, setBusyValue] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    setListState({ isLoading: true, candidates: [], error: "" });
    Promise.resolve(
      window.electronAPI.listGameExecutables({ gamePath: version.game_path }),
    )
      .then((result) => {
        if (!alive) {
          return;
        }
        setListState(
          result?.success
            ? {
                isLoading: false,
                candidates: Array.isArray(result.executables)
                  ? result.executables
                  : [],
                error: "",
              }
            : {
                isLoading: false,
                candidates: [],
                error: result?.error || "The game folder could not be read.",
              },
        );
      })
      .catch((error) => {
        console.error("[library.repair] Listing launchers failed:", error);
        if (alive) {
          setListState({
            isLoading: false,
            candidates: [],
            error: "The game folder could not be read.",
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [version.game_path]);

  const choose = async (executable) => {
    if (busyValue) {
      return;
    }
    setBusyValue(executable);
    try {
      const result = await window.electronAPI.setGameExecutable({
        recordId: game.record_id,
        version: version.version,
        gamePath: version.game_path,
        executable,
      });
      if (!result?.success) {
        setListState((previous) => ({
          ...previous,
          error: result?.error || "This file could not be used. Pick another one.",
        }));
        return;
      }
      detailsToast()?.success(`${executable} will be used to start the game.`, {
        title: "Ready to play",
      });
      onChosen?.(result.game || null);
    } catch (error) {
      console.error("[library.repair] Saving the launcher failed:", error);
      setListState((previous) => ({
        ...previous,
        error: "This file could not be used. Pick another one.",
      }));
    } finally {
      setBusyValue("");
    }
  };

  const browse = async () => {
    try {
      const picked = await window.electronAPI.pickGameExecutable({
        gamePath: version.game_path,
      });
      if (picked?.cancelled) {
        return;
      }
      if (!picked?.success || !picked.executable) {
        setListState((previous) => ({
          ...previous,
          error: picked?.error || "Pick a file inside this game's folder.",
        }));
        return;
      }
      await choose(picked.executable);
    } catch (error) {
      console.error("[library.repair] Picking a launcher failed:", error);
    }
  };

  const shownCandidates = listState.candidates.slice(0, DETAILS_EXECUTABLE_LIST_LIMIT);
  const hiddenCount = listState.candidates.length - shownCandidates.length;

  return (
    <div
      className="app-fade-enter mt-3 border border-accent/35 bg-accent/5 p-3"
      role="group"
      aria-label="Choose the file that starts the game"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-text">
          Which file starts the game?
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-text/60 transition hover:text-text"
        >
          Cancel
        </button>
      </div>
      {listState.error && (
        <div className="mb-2 text-xs text-red-200" role="alert">
          {listState.error}
        </div>
      )}
      {listState.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-text/60">
          <span className="app-spinner app-keep-motion text-[11px]" aria-hidden />
          Looking for launchers in the game folder…
        </div>
      ) : shownCandidates.length === 0 ? (
        <div className="text-xs text-text/60">
          No launchers were found in this folder. Use Browse… to pick the file.
        </div>
      ) : (
        <div className="flex max-h-[180px] flex-col gap-1 overflow-y-auto pr-0.5">
          {shownCandidates.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => choose(candidate)}
              disabled={Boolean(busyValue)}
              className="flex items-center gap-2 border border-border/70 bg-black/20 px-2 py-1 text-left text-xs text-text transition hover:border-accent/50 hover:bg-accent/10 disabled:opacity-50"
            >
              {busyValue === candidate ? (
                <span className="app-spinner app-keep-motion text-[10px]" aria-hidden />
              ) : (
                <span className="material-symbols-outlined text-[14px] leading-none text-accent" aria-hidden>
                  play_circle
                </span>
              )}
              <span className="min-w-0 flex-1 break-all">{candidate}</span>
            </button>
          ))}
          {hiddenCount > 0 && (
            <div className="px-1 text-[11px] text-text/50">
              {`${hiddenCount} more file(s) — use Browse… to pick one of them.`}
            </div>
          )}
        </div>
      )}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={browse}
          disabled={Boolean(busyValue)}
          className="inline-flex items-center gap-1 bg-secondary px-2 py-0.5 text-xs transition hover:bg-selected disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
            folder_open
          </span>
          Browse…
        </button>
      </div>
    </div>
  );
};

/**
 * Inline editor for the stored title / creator / engine of a library entry.
 */
const DetailsMetadataEditor = ({ game, onSaved, onClose }) => {
  const [form, setForm] = React.useState({
    title: game?.title || "",
    creator: game?.creator || "",
    engine: game?.engine || "",
  });
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const updateField = (field) => (event) =>
    setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const save = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setError("Enter a title for this game.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const result = await window.electronAPI.updateGame({
        record_id: game.record_id,
        title: form.title,
        creator: form.creator,
        engine: form.engine,
      });
      if (!result?.success) {
        setError(result?.error || "The changes could not be saved. Try again.");
        return;
      }
      const updatedGame = await window.electronAPI.getGame(game.record_id);
      detailsToast()?.success("The game details were saved.", { title: "Saved" });
      onSaved?.(updatedGame || null);
    } catch (saveError) {
      console.error("[library.details] Saving details failed:", saveError);
      setError("The changes could not be saved. Try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const fieldClass =
    "w-full border border-border bg-black/25 px-2 py-1 text-sm text-text outline-none focus:border-accent/60";

  return (
    <form
      onSubmit={save}
      className="app-fade-enter space-y-2 border border-border/70 bg-canvas/40 p-3"
      aria-label="Edit game details"
    >
      {game?.atlas_id && (
        <div className="text-[11px] text-text/55">
          While this game is linked to the catalog, the catalog name is shown in
          the library.
        </div>
      )}
      <label className="block text-[11px] uppercase tracking-[0.14em] text-text/55">
        Title
        <input value={form.title} onChange={updateField("title")} className={`mt-1 normal-case tracking-normal ${fieldClass}`} />
      </label>
      <label className="block text-[11px] uppercase tracking-[0.14em] text-text/55">
        Creator
        <input value={form.creator} onChange={updateField("creator")} className={`mt-1 normal-case tracking-normal ${fieldClass}`} />
      </label>
      <label className="block text-[11px] uppercase tracking-[0.14em] text-text/55">
        Engine
        <input
          value={form.engine}
          onChange={updateField("engine")}
          list="details-engine-suggestions"
          className={`mt-1 normal-case tracking-normal ${fieldClass}`}
        />
        <datalist id="details-engine-suggestions">
          {DETAILS_ENGINE_SUGGESTIONS.map((engine) => (
            <option key={engine} value={engine} />
          ))}
        </datalist>
      </label>
      {error && (
        <div className="text-xs text-red-200" role="alert">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="bg-secondary px-2 py-0.5 text-xs transition hover:bg-selected disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-1 bg-accent px-2 py-0.5 text-xs text-onAccent transition hover:brightness-110 disabled:opacity-50"
        >
          {isSaving && <span className="app-spinner app-keep-motion text-[10px]" aria-hidden />}
          Save
        </button>
      </div>
    </form>
  );
};

const LibraryDetailsPanel = ({
  presenceState = "open",
  game,
  previews,
  isLoading,
  onClose,
  onOpenPage,
  onPlayGame,
  onUpdateGame,
  onOpenFolder,
  onToggleFavorite,
  onRemoveGame,
  onPreviewSelect,
  onOpenSaveStorage,
  onLocateVersion,
  onGameChanged,
  onLinkCatalog,
  onImageAction,
}) => {
  const versionList = useMemo(() => {
    if (!game?.versions?.length) {
      return [];
    }

    return [...game.versions].sort((left, right) => {
      if (left.version === game.newestInstalledVersion) {
        return -1;
      }

      if (right.version === game.newestInstalledVersion) {
        return 1;
      }

      return (right.date_added || 0) - (left.date_added || 0);
    });
  }, [game]);
  const tags = useMemo(() => splitGameTags(game?.f95_tags), [game?.f95_tags]);
  const displayTitle = game?.displayTitle || game?.title || "No game selected";
  const displayCreator = game?.displayCreator || game?.creator || "";
  // Install state on this PC (see shared/libraryInstallState): only games whose
  // folder still exists are "installed"; a vanished folder is "missing".
  const installState = window.libraryInstallState?.getLibraryInstallState
    ? window.libraryInstallState.getLibraryInstallState(game)
    : versionList.length > 0
      ? "installed"
      : "not_installed";
  const hasInstalledVersions = installState === "installed";
  const hasMissingFiles = installState === "missing";
  const isFavorite = Boolean(game?.isFavorite);

  const [panelWidthPx, setPanelWidthPx] = useState(
    readStoredLibraryDetailsPanelWidthPx,
  );
  const [isResizing, setIsResizing] = useState(false);
  const [launchingVersionKey, setLaunchingVersionKey] = useState("");
  const [pickerVersionKey, setPickerVersionKey] = useState("");
  const [removingVersionKey, setRemovingVersionKey] = useState("");
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const resizeDragRef = useRef(null);
  const needsCatalogLink = window.libraryInstallState?.needsCatalogLink
    ? window.libraryInstallState.needsCatalogLink(game)
    : Boolean(game && !game.atlas_id && !game.f95_id && !game.siteUrl);
  const liveCheckedLabel = formatDetailRelativeTime(game?.liveCheckedAt);
  const isLiveLatest =
    Boolean(game?.liveVersion) && game?.latestVersion === game?.liveVersion;
  const siteLatestHint = isLiveLatest
    ? ` (from the F95 thread${liveCheckedLabel ? `, checked ${liveCheckedLabel}` : ""})`
    : "";

  useEffect(() => {
    setPickerVersionKey("");
    setRemovingVersionKey("");
    setIsEditingDetails(false);
  }, [game?.record_id]);

  const handleRemoveVersion = async (version, versionKey) => {
    if (!game?.record_id || removingVersionKey) {
      return;
    }
    if (versionList.length <= 1) {
      onRemoveGame?.(game);
      return;
    }

    const label = version.version || "this version";
    const confirmed = await detailsConfirm({
      title: `Remove version ${label}?`,
      message:
        "Only this entry is removed from the library. The game folder on disk is not deleted.",
      confirmLabel: "Remove version",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setRemovingVersionKey(versionKey);
    try {
      const result = await window.electronAPI.deleteVersion({
        recordId: game.record_id,
        version: version.version,
      });
      if (!result?.success) {
        detailsToast()?.error(
          result?.error || "The version could not be removed. Try again.",
          { title: "Remove version" },
        );
        return;
      }
      const updatedGame = await window.electronAPI.getGame(game.record_id);
      if (updatedGame) {
        onGameChanged?.(updatedGame);
      }
      detailsToast()?.success(`Version ${label} was removed from the library.`, {
        title: "Version removed",
      });
    } catch (error) {
      console.error("[library.details] Removing a version failed:", error);
      detailsToast()?.error("The version could not be removed. Try again.", {
        title: "Remove version",
      });
    } finally {
      setRemovingVersionKey("");
    }
  };
  const favoriteIconRef = window.AppMotion?.useFlashClass
    ? window.AppMotion.useFlashClass(isFavorite, "app-pop")
    : null;

  const handlePlayVersion = async (version, versionKey) => {
    if (launchingVersionKey) {
      return;
    }
    setLaunchingVersionKey(versionKey);
    try {
      await onPlayGame?.(version, game);
    } finally {
      setLaunchingVersionKey("");
    }
  };

  useEffect(() => {
    const clamp = () => {
      setPanelWidthPx((previous) => {
        const max = getLibraryDetailsPanelMaxWidthPx();
        return Math.min(
          max,
          Math.max(LIBRARY_DETAILS_PANEL_WIDTH_MIN_PX, previous),
        );
      });
    };
    window.addEventListener("resize", clamp);
    clamp();
    return () => window.removeEventListener("resize", clamp);
  }, []);

  useEffect(() => {
    const persistTimeout = window.setTimeout(() => {
      try {
        localStorage.setItem(
          LIBRARY_DETAILS_PANEL_WIDTH_STORAGE_KEY,
          String(panelWidthPx),
        );
      } catch {
        /* ignore */
      }
    }, LIBRARY_DETAILS_PANEL_WIDTH_PERSIST_DELAY_MS);

    return () => {
      window.clearTimeout(persistTimeout);
    };
  }, [panelWidthPx]);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const applyClientX = (clientX) => {
      const start = resizeDragRef.current;
      if (!start) {
        return;
      }
      const dx = clientX - start.startX;
      const max = getLibraryDetailsPanelMaxWidthPx();
      const next = Math.min(
        max,
        Math.max(
          LIBRARY_DETAILS_PANEL_WIDTH_MIN_PX,
          start.startWidth - dx,
        ),
      );
      setPanelWidthPx(next);
    };

    const onMouseMove = (e) => applyClientX(e.clientX);
    const onMouseUp = () => {
      setIsResizing(false);
      resizeDragRef.current = null;
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 0) {
        return;
      }
      applyClientX(e.touches[0].clientX);
    };
    const onTouchEnd = () => {
      setIsResizing(false);
      resizeDragRef.current = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const handleResizePointerDown = useCallback(
    (e) => {
      if (e.button !== undefined && e.button !== 0) {
        return;
      }
      e.preventDefault();
      resizeDragRef.current = {
        startX: e.clientX,
        startWidth: panelWidthPx,
      };
      setIsResizing(true);
    },
    [panelWidthPx],
  );

  const handleResizeKeyDown = useCallback((e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPanelWidthPx((previous) =>
        Math.min(
          getLibraryDetailsPanelMaxWidthPx(),
          previous + 8,
        ),
      );
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPanelWidthPx((previous) =>
        Math.max(LIBRARY_DETAILS_PANEL_WIDTH_MIN_PX, previous - 8),
      );
    }
  }, []);

  return (
    <aside
      className="app-glass-panel app-panel-right relative h-full min-h-0 shrink-0 border-l border-border shadow-glass"
      data-state={presenceState}
      aria-label="Game details"
      style={{ width: panelWidthPx }}
    >
      <button
        type="button"
        data-no-ripple
        className={`absolute left-0 top-0 z-30 h-full w-3 -translate-x-1/2 cursor-ew-resize border-0 p-0 transition-colors duration-500 hover:bg-accent/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent ${
          isResizing ? "bg-accent/35" : "bg-transparent"
        }`}
        aria-label="Resize details panel"
        title="Drag to resize"
        aria-orientation="vertical"
        role="separator"
        tabIndex={0}
        style={{ touchAction: "none" }}
        onMouseDown={handleResizePointerDown}
        onTouchStart={(e) => {
          if (e.touches.length === 0) {
            return;
          }
          e.preventDefault();
          const touch = e.touches[0];
          resizeDragRef.current = {
            startX: touch.clientX,
            startWidth: panelWidthPx,
          };
          setIsResizing(true);
        }}
        onKeyDown={handleResizeKeyDown}
      />
      <div className="flex h-full min-w-0 flex-col">
        <div className="relative z-10 flex min-h-[5rem] items-center justify-between gap-3 border-b border-border bg-black/15 px-4 py-2.5 backdrop-blur-sm">
          <div
            key={isLoading ? "loading" : game?.record_id || "empty"}
            className="app-list-enter min-w-0"
          >
            {isLoading ? (
              <div className="space-y-2 py-1">
                <div className="app-skeleton h-5 w-52" />
                <div className="app-skeleton h-3.5 w-28" />
              </div>
            ) : (
              <>
                <div className="truncate text-lg font-semibold leading-tight text-text">
                  {displayTitle}
                </div>
                <div className="truncate text-sm leading-snug opacity-70">
                  {displayCreator}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="group shrink-0 border border-border bg-white/5 p-1.5 text-text shadow-glass-sm backdrop-blur-md transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="Close details"
            title="Close (Esc)"
          >
            <span className="material-symbols-outlined block text-[20px] leading-none transition-transform duration-500 group-hover:rotate-90">
              close
            </span>
          </button>
        </div>

        {!game && !isLoading ? (
          <div className="flex flex-1 items-center justify-center px-8 text-center text-sm opacity-60">
            Choose a game in the grid to inspect versions, screenshots and site
            metadata here.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {isLoading ? (
              <div className="app-fade-enter space-y-3">
                <div className="app-skeleton h-[200px]" />
                <div className="app-skeleton h-16" />
                <div className="app-skeleton h-40" />
              </div>
            ) : (
              <div
                key={game?.record_id || "details"}
                className="app-view-enter space-y-5"
              >
                <section className="overflow-hidden rounded-2xl border border-border bg-secondary/20">
                  <div className="group/banner relative h-[220px] overflow-hidden bg-secondary/40">
                    {(game.atlas_id || game.banner_url) && onImageAction && (
                      <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity duration-300 focus-within:opacity-100 group-hover/banner:opacity-100">
                        {game.atlas_id && (
                          <button
                            type="button"
                            onClick={() => onImageAction("refreshBanner", game)}
                            className="inline-flex h-7 w-7 items-center justify-center border border-border bg-black/60 text-text backdrop-blur-sm transition hover:bg-black/80"
                            aria-label="Download the banner again"
                            title="Download the banner again"
                          >
                            <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden>
                              refresh
                            </span>
                          </button>
                        )}
                        {game.banner_url && (
                          <button
                            type="button"
                            onClick={() => onImageAction("removeBanner", game)}
                            className="inline-flex h-7 w-7 items-center justify-center border border-border bg-black/60 text-text backdrop-blur-sm transition hover:bg-red-900/70"
                            aria-label="Remove the saved banner"
                            title="Remove the saved banner"
                          >
                            <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden>
                              hide_image
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                    <DetailsImage
                      src={game.banner_url}
                      alt={displayTitle}
                      className="h-[220px] w-full object-cover transition-transform duration-700 hover:scale-[1.03]"
                      fallback={
                        <div className="flex h-[220px] flex-col items-center justify-center gap-2 bg-secondary/40 text-sm opacity-60">
                          <span className="material-symbols-outlined text-[32px]" aria-hidden>
                            image_not_supported
                          </span>
                          No banner cached yet
                        </div>
                      }
                    />
                  </div>
                  <div className="space-y-3 px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <DetailPill tone="accent">
                        {game.engine || "Unknown engine"}
                      </DetailPill>
                      {game.status && <DetailPill>{game.status}</DetailPill>}
                      {game.category && (
                        <DetailPill>{game.category}</DetailPill>
                      )}
                      {game.rating && (
                        <span className="inline-flex items-center gap-0.5 border border-border/85 bg-white/5 px-1.5 py-0.5 text-[10px] text-text backdrop-blur-sm">
                          <span
                            className="material-symbols-outlined text-[14px] leading-none text-glam"
                            style={{ fontVariationSettings: "'FILL' 1" }}
                            aria-hidden
                          >
                            star
                          </span>
                          <span className="tabular-nums tracking-normal">
                            {game.rating}
                          </span>
                        </span>
                      )}
                      {needsCatalogLink && (
                        <span title="This game was added from its folder and isn't linked to the game catalog yet, so it gets no updates or banner.">
                          <DetailPill>Not matched</DetailPill>
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-1.5">
                        {!game.atlas_id && onLinkCatalog && (
                          <button
                            type="button"
                            onClick={() => onLinkCatalog(game)}
                            className="inline-flex items-center gap-1 border border-accent/50 bg-accent/15 px-2 py-0.5 text-[11px] text-text transition hover:bg-accent/25"
                            title="Find this game in the catalog to get its banner, name and update checks"
                          >
                            <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                              link
                            </span>
                            Link to catalog…
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setIsEditingDetails((previous) => !previous)}
                          aria-pressed={isEditingDetails}
                          className={`inline-flex h-6 w-6 items-center justify-center border transition-colors ${
                            isEditingDetails
                              ? "border-accent/60 bg-accent/20 text-text"
                              : "border-border bg-white/5 text-text/80 hover:bg-white/10"
                          }`}
                          aria-label="Edit title, creator and engine"
                          title="Edit title, creator and engine"
                        >
                          <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden>
                            edit
                          </span>
                        </button>
                      </div>
                    </div>
                    {isEditingDetails && (
                      <DetailsMetadataEditor
                        key={game.record_id}
                        game={game}
                        onSaved={(updatedGame) => {
                          setIsEditingDetails(false);
                          if (updatedGame) {
                            onGameChanged?.(updatedGame);
                          }
                        }}
                        onClose={() => setIsEditingDetails(false)}
                      />
                    )}
                  </div>
                </section>

                <section className="border border-border bg-secondary/10 p-4">
                  <div className="mb-3 text-[11px] uppercase tracking-[0.18em] opacity-55">
                    Installations
                  </div>

                  <div className="mb-3 border border-border/70 bg-canvas/40 p-3">
                    <div className="text-sm font-medium text-text">
                      {hasInstalledVersions
                        ? game.isUpdateAvailable
                          ? "Update available"
                          : "Installed version is current"
                        : hasMissingFiles
                          ? "Installed files are missing"
                          : "Not installed on this PC"}
                    </div>
                    {hasInstalledVersions ? (
                      <>
                        <div className="mt-1 text-xs opacity-70">
                          Installed: {game.newestInstalledVersion || "Unknown"}
                        </div>
                        <div className="text-xs opacity-70">
                          Site latest: {game.latestVersion || "Unknown"}
                          {game.latestVersion ? siteLatestHint : ""}
                        </div>
                        {!versionList.some(
                          (version) => version.isPresent !== false && version.exec_path,
                        ) && (
                          <div className="mt-1 text-xs text-amber-200/85">
                            Choose the file that starts the game with Choose .exe
                            below to play it.
                          </div>
                        )}
                      </>
                    ) : hasMissingFiles ? (
                      <>
                        <div className="mt-1 text-xs opacity-70">
                          Last installed: {game.lastKnownVersion || "Unknown"}
                          {game.latestVersion
                            ? ` · Site latest: ${game.latestVersion}${siteLatestHint}`
                            : ""}
                        </div>
                        <div className="text-xs opacity-70">
                          The game folder was deleted, moved or is on a
                          disconnected drive. Use Locate… on the version below
                          if you moved it, install it again, or remove it from
                          the library.
                        </div>
                      </>
                    ) : (
                      <div className="mt-1 text-xs opacity-70">
                        This library entry is linked to its thread and can be
                        installed from here.
                      </div>
                    )}
                    {(game.isUpdateAvailable || !hasInstalledVersions) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {hasInstalledVersions ? (
                          <DetailPill tone="warning">Needs update</DetailPill>
                        ) : hasMissingFiles ? (
                          <DetailPill tone="danger">Files missing</DetailPill>
                        ) : (
                          <DetailPill tone="accent">Ready to install</DetailPill>
                        )}
                        <button
                          type="button"
                          onClick={() => onUpdateGame?.(game)}
                          className="inline-flex items-center gap-1 bg-accent px-2 py-0.5 text-xs text-onAccent transition hover:shadow-glow-accent hover:brightness-110 disabled:opacity-40"
                          disabled={!game.siteUrl}
                          title={game.siteUrl ? undefined : "This entry has no F95 thread linked"}
                        >
                          <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                            {hasInstalledVersions ? "upgrade" : "download"}
                          </span>
                          {hasInstalledVersions
                            ? game.latestVersion
                              ? `Update to ${game.latestVersion}`
                              : "Update now"
                            : game.latestVersion
                              ? `Install ${game.latestVersion}`
                              : "Install"}
                        </button>
                      </div>
                    )}
                  </div>

                  {versionList.length === 0 ? (
                    <div className="text-sm opacity-60">
                      No installed files are stored for this library entry yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {versionList.map((version, versionIndex) => {
                        const versionKey = `${version.version}-${version.game_path}`;
                        const isLaunching = launchingVersionKey === versionKey;
                        const isVersionMissing = version.isPresent === false;
                        return (
                        <div
                          key={versionKey}
                          className="app-list-enter border border-border/70 bg-canvas/40 p-3 transition-colors duration-500 hover:border-accent/35"
                          style={{ "--app-index": versionIndex }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-text">
                                  {version.version || "Unknown"}
                                </span>
                                {!isVersionMissing &&
                                  version.version ===
                                    game.newestInstalledVersion && (
                                  <DetailPill tone="accent">Current</DetailPill>
                                )}
                                {isVersionMissing && (
                                  <DetailPill tone="danger">Folder missing</DetailPill>
                                )}
                              </div>
                              <div
                                className={`mt-1 break-all text-xs ${
                                  isVersionMissing ? "line-through opacity-45" : "opacity-60"
                                }`}
                              >
                                {version.game_path}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-start gap-1.5">
                              {isVersionMissing ? (
                                <button
                                  type="button"
                                  onClick={() => onLocateVersion?.(version, game)}
                                  disabled={!onLocateVersion}
                                  className="inline-flex items-center gap-1 bg-accent px-2 py-0.5 text-xs text-onAccent transition hover:shadow-glow-accent hover:brightness-110 disabled:opacity-60"
                                  title="Point this version to the folder where the game is now"
                                >
                                  <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                                    travel_explore
                                  </span>
                                  Locate…
                                </button>
                              ) : !version.exec_path ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPickerVersionKey((current) =>
                                      current === versionKey ? "" : versionKey,
                                    )
                                  }
                                  aria-expanded={pickerVersionKey === versionKey}
                                  className="inline-flex items-center gap-1 bg-accent px-2 py-0.5 text-xs text-onAccent transition hover:shadow-glow-accent hover:brightness-110"
                                  title="Choose the file that starts this game"
                                >
                                  <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                                    settings
                                  </span>
                                  Choose .exe
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handlePlayVersion(version, versionKey)}
                                  className="inline-flex items-center gap-1 bg-accent px-2 py-0.5 text-xs text-onAccent transition hover:shadow-glow-accent hover:brightness-110 disabled:opacity-60"
                                  disabled={Boolean(launchingVersionKey)}
                                  title={`Play ${version.version || ""}`.trim()}
                                >
                                  {isLaunching ? (
                                    <span className="app-spinner app-keep-motion text-[11px]" aria-hidden />
                                  ) : (
                                    <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                                      play_arrow
                                    </span>
                                  )}
                                  {isLaunching ? "Starting" : "Play"}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => onOpenFolder(version.game_path)}
                                className="inline-flex items-center gap-1 bg-secondary px-2 py-0.5 text-xs transition hover:bg-selected disabled:opacity-50"
                                disabled={isVersionMissing}
                                title={
                                  isVersionMissing
                                    ? "The install folder no longer exists"
                                    : "Open install folder"
                                }
                              >
                                <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                                  folder_open
                                </span>
                                Open
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveVersion(version, versionKey)}
                                disabled={Boolean(removingVersionKey)}
                                className="inline-flex h-[22px] w-[22px] items-center justify-center border border-red-500/35 bg-red-500/10 text-red-100 transition hover:bg-red-500/20 disabled:opacity-50"
                                aria-label={`Remove version ${version.version || ""} from the library`.replace(/\s+/g, " ")}
                                title="Remove this version from the library (the folder stays on disk)"
                              >
                                {removingVersionKey === versionKey ? (
                                  <span className="app-spinner app-keep-motion text-[10px]" aria-hidden />
                                ) : (
                                  <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                                    delete
                                  </span>
                                )}
                              </button>
                            </div>
                          </div>

                          {pickerVersionKey === versionKey &&
                            !isVersionMissing &&
                            !version.exec_path && (
                              <DetailsExecutablePicker
                                game={game}
                                version={version}
                                onChosen={(updatedGame) => {
                                  setPickerVersionKey("");
                                  if (updatedGame) {
                                    onGameChanged?.(updatedGame);
                                  }
                                }}
                                onClose={() => setPickerVersionKey("")}
                              />
                            )}

                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs opacity-75">
                            <div>
                              Added: {formatDetailDate(version.date_added)}
                            </div>
                            <div>
                              Size: {formatDetailBytes(version.folder_size)}
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border/40 pt-3">
                    <button
                      type="button"
                      onClick={() => onToggleFavorite?.(game)}
                      className={`inline-flex h-8 w-8 items-center justify-center border transition-colors ${
                        isFavorite
                          ? "border-amber-400/70 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
                          : "border-border bg-secondary text-text hover:bg-selected"
                      }`}
                      aria-label={
                        isFavorite
                          ? "Remove from Favorites"
                          : "Add to Favorites"
                      }
                      title={
                        isFavorite
                          ? "Remove from Favorites"
                          : "Add to Favorites"
                      }
                    >
                      <span
                        ref={favoriteIconRef}
                        className="material-symbols-outlined text-[20px] leading-none"
                        style={
                          isFavorite
                            ? { fontVariationSettings: "'FILL' 1" }
                            : undefined
                        }
                      >
                        star
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenPage}
                      disabled={!game.siteUrl}
                      className="inline-flex h-8 w-8 items-center justify-center border border-border bg-secondary text-text hover:bg-selected disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Open game page"
                      title="Open game page"
                    >
                      <span className="material-symbols-outlined text-[20px] leading-none">
                        open_in_new
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveGame?.(game)}
                      className="inline-flex h-8 w-8 items-center justify-center border border-red-500/40 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                      aria-label="Remove game"
                      title="Remove game"
                    >
                      <span className="material-symbols-outlined text-[20px] leading-none">
                        delete
                      </span>
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-secondary/10 p-4">
                  <div className="mb-3 text-[11px] uppercase tracking-[0.18em] opacity-55">
                    Site Details
                  </div>
                  <DetailRow label="Language" value={game.language} />
                  <DetailRow label="Translations" value={game.translations} />
                  <DetailRow label="Voice" value={game.voice} />
                  <DetailRow label="Platform" value={game.os} />
                  <DetailRow
                    label="Release"
                    value={formatDetailDate(game.release_date)}
                  />
                  {tags.length > 0 && (
                    <details className="tags-spoiler pt-3">
                      <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] uppercase tracking-[0.18em] opacity-55 [&::-webkit-details-marker]:hidden">
                        <span
                          className="tag-chevron material-symbols-outlined text-[16px] transition-transform duration-450"
                          aria-hidden
                        >
                          expand_more
                        </span>
                        Tags
                        <span className="normal-case tracking-normal text-text/45">
                          ({tags.length})
                        </span>
                      </summary>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className="border border-border bg-canvas/40 px-1.5 py-0.5 text-[11px]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </details>
                  )}
                  <div className="pt-4">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.18em] opacity-55">
                      Overview
                    </div>
                    <div className="max-h-[220px] overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-text/90">
                      {game.overview || "No site overview cached yet."}
                    </div>
                  </div>
                </section>

                <window.LibrarySaveSyncPanel
                  game={game}
                  onOpenSaveStorage={onOpenSaveStorage}
                />

                <section className="rounded-2xl border border-border bg-secondary/10 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] opacity-55">
                      Screenshots
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs opacity-60">
                        {previews.length > 0
                          ? `${previews.length} cached`
                          : "No cached shots"}
                      </div>
                      {onImageAction && game.atlas_id && (
                        <button
                          type="button"
                          onClick={() => onImageAction("refreshScreenshots", game)}
                          className="inline-flex h-6 w-6 items-center justify-center border border-border bg-white/5 text-text/80 transition hover:bg-white/10"
                          aria-label="Download screenshots again"
                          title="Download screenshots again"
                        >
                          <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden>
                            refresh
                          </span>
                        </button>
                      )}
                      {onImageAction && previews.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onImageAction("removeScreenshots", game)}
                          className="inline-flex h-6 w-6 items-center justify-center border border-border bg-white/5 text-text/80 transition hover:bg-red-900/60"
                          aria-label="Remove saved screenshots"
                          title="Remove saved screenshots"
                        >
                          <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden>
                            hide_image
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                  {previews.length === 0 ? (
                    <div className="text-sm opacity-60">
                      No screenshots downloaded for this game yet.
                    </div>
                  ) : (
                    <div
                      className="overflow-y-auto overflow-x-hidden pr-0.5"
                      style={{ maxHeight: SCREENSHOTS_GRID_MAX_HEIGHT_PX }}
                    >
                      <div className="grid grid-cols-2 gap-3 pb-1">
                        {previews.map((previewUrl, index) => (
                          <button
                            key={`${previewUrl}-${index}`}
                            type="button"
                            onClick={() => onPreviewSelect(index)}
                            className="app-card-enter group overflow-hidden rounded-xl border border-border bg-canvas/40 transition-[border-color,box-shadow] duration-500 hover:border-accent/50 hover:shadow-glow-accent"
                            style={{ "--app-index": Math.min(index, 12) }}
                            aria-label={`Open screenshot ${index + 1}`}
                          >
                            <DetailsImage
                              src={previewUrl}
                              alt={`${displayTitle} screenshot ${index + 1}`}
                              className="h-[120px] w-full object-cover transition-transform duration-700 group-hover:scale-105"
                              fallback={
                                <div className="flex h-[120px] items-center justify-center text-xs opacity-50">
                                  Image unavailable
                                </div>
                              }
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};

window.LibraryDetailsPanel = LibraryDetailsPanel;
