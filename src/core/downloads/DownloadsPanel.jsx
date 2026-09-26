const formatDownloadBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${
    units[unitIndex]
  }`;
};

const formatDownloadSpeed = (bytesPerSecond) => {
  const value = Number(bytesPerSecond) || 0;
  if (value <= 0) {
    return "0 B/s";
  }

  return `${formatDownloadBytes(value)}/s`;
};

const formatDownloadEta = (item) => {
  const total = Number(item.totalBytes) || 0;
  const received = Number(item.receivedBytes) || 0;
  const speed = Number(item.speedBytesPerSecond) || 0;
  if (total <= 0 || speed <= 0 || received >= total) {
    return "";
  }

  const seconds = Math.round((total - received) / speed);
  if (seconds < 60) {
    return `${seconds}s left`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s left`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
};

const formatDownloadTimestamp = (value) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
};

const DOWNLOAD_STATUS_META = {
  resolving: {
    label: "Resolving",
    icon: "travel_explore",
    tone: "border-accent/30 bg-accent/10 text-text",
    bar: "bg-accent",
  },
  queued: {
    label: "Queued",
    icon: "schedule",
    tone: "border-border bg-white/5 text-text/85",
    bar: "bg-accent/60",
  },
  downloading: {
    label: "Downloading",
    icon: "downloading",
    tone: "border-accent/30 bg-accent/10 text-text",
    bar: "bg-gradient-to-r from-accent to-accentBar",
  },
  installing: {
    label: "Installing",
    icon: "inventory_2",
    tone: "border-sky-400/30 bg-sky-500/10 text-sky-100",
    bar: "bg-sky-500",
  },
  completed: {
    label: "Installed",
    icon: "check_circle",
    tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
    bar: "bg-emerald-500",
  },
  error: {
    label: "Failed",
    icon: "error",
    tone: "border-red-500/30 bg-red-500/10 text-red-100",
    bar: "bg-red-500",
  },
  cancelled: {
    label: "Cancelled",
    icon: "block",
    tone: "border-border bg-white/5 text-text/70",
    bar: "bg-text/30",
  },
};

const getDownloadStatusMeta = (status) =>
  DOWNLOAD_STATUS_META[status] || {
    label: status || "Unknown",
    icon: "help",
    tone: "border-border bg-white/5 text-text/85",
    bar: "bg-accent/60",
  };

const ACTIVE_DOWNLOAD_STATUSES = new Set([
  "resolving",
  "queued",
  "downloading",
  "installing",
]);

const useDownloadsLayer = (isOpen, props, options) =>
  window.AtlasMotion?.useModalLayer
    ? window.AtlasMotion.useModalLayer(isOpen, props, options)
    : { isMounted: Boolean(isOpen), state: "open", props, dialogRef: null };

const downloadsToast = () => window.AtlasToast || null;

const callDownloadsApi = async (method, ...args) => {
  const api = window.electronAPI;
  if (!api || typeof api[method] !== "function") {
    throw new Error("This action needs a newer F95Launcher build.");
  }
  return api[method](...args);
};

const DownloadItemRow = ({ item, index, onOpenLibraryRecord }) => {
  const [pendingAction, setPendingAction] = React.useState("");
  const meta = getDownloadStatusMeta(item.status);
  const percent = Math.max(0, Math.min(100, Number(item.percent) || 0));
  const totalBytes = Number(item.totalBytes) || 0;
  const receivedBytes = Number(item.receivedBytes) || 0;
  const hasTransferStats = totalBytes > 0;
  const isActive = ACTIVE_DOWNLOAD_STATUSES.has(item.status);
  const isIndeterminate =
    item.status === "resolving" ||
    item.status === "installing" ||
    (item.status === "downloading" && totalBytes <= 0) ||
    (item.status === "queued" && percent <= 0);
  const canCancel =
    item.canCancel ??
    (item.status === "resolving" ||
      item.status === "queued" ||
      item.status === "downloading");
  const canRetry =
    item.canRetry ?? (item.status === "error" || item.status === "cancelled");
  const eta = item.status === "downloading" ? formatDownloadEta(item) : "";
  const hostLabel = item.hostLabel || item.sourceLabel || item.sourceHost || "";

  const runItemAction = async (actionKey, action) => {
    if (pendingAction) {
      return;
    }
    setPendingAction(actionKey);
    try {
      await action();
    } catch (error) {
      downloadsToast()?.error(
        window.AtlasUI?.errorMessage(error, "The action failed.") ||
          String(error),
        { title: item.title || "Download" },
      );
    } finally {
      setPendingAction("");
    }
  };

  const handleCancel = () =>
    runItemAction("cancel", async () => {
      const result = await callDownloadsApi("cancelF95Download", item.id);
      if (!result?.success) {
        throw new Error(result?.error || "The download could not be cancelled.");
      }
    });

  const handleRetry = () =>
    runItemAction("retry", async () => {
      const result = await callDownloadsApi("retryF95Download", item.id);
      if (result?.success) {
        downloadsToast()?.info("The mirror is being resolved again.", {
          title: `Retrying ${item.title || "download"}`,
          duration: 3000,
        });
        return;
      }
      if (result?.code === "captcha_required" && result?.actionUrl) {
        downloadsToast()?.warning(
          result.error ||
            "This mirror needs a captcha. Solve it in the browser window, then retry.",
          {
            title: "Captcha required",
            duration: 0,
            actions: [
              {
                label: "Solve captcha",
                onClick: () =>
                  window.electronAPI.openF95BrowserUrl?.({
                    url: result.actionUrl,
                    title: "F95 Mirror Verification",
                  }),
              },
            ],
          },
        );
        return;
      }
      throw new Error(result?.error || "The download could not be restarted.");
    });

  const handleShowInFolder = () =>
    runItemAction("folder", async () => {
      const result = await callDownloadsApi("showF95DownloadInFolder", item.id);
      if (result && result.success === false) {
        throw new Error(result.error || "The download folder could not be opened.");
      }
    });

  const handleSolveCaptcha = () =>
    runItemAction("captcha", async () => {
      await window.electronAPI.openF95BrowserUrl?.({
        url: item.actionUrl,
        title: "F95 Mirror Verification",
      });
    });

  return (
    <div
      className="atlas-list-enter rounded-2xl border border-border bg-black/20 px-4 py-4 transition-[border-color,background-color] duration-500 hover:border-accent/30 hover:bg-black/30"
      style={{ "--atlas-index": Math.min(index, 10) }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={`material-symbols-outlined mt-0.5 shrink-0 text-[20px] ${
              item.status === "error"
                ? "text-red-300"
                : item.status === "completed"
                  ? "text-emerald-300"
                  : item.status === "cancelled"
                    ? "text-text/45"
                    : "text-accent"
            } ${isActive ? "animate-pulse atlas-keep-motion" : "atlas-pop"}`}
            aria-hidden
          >
            {meta.icon}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-text" title={item.title}>
              {item.title || item.fileName || "Unnamed download"}
            </div>
            <div className="mt-1 truncate text-xs text-text/55" title={item.fileName || hostLabel}>
              {item.fileName || hostLabel || "Preparing mirror"}
            </div>
          </div>
        </div>
        <div
          key={item.status}
          className={`atlas-badge-enter shrink-0 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${meta.tone}`}
        >
          {meta.label}
        </div>
      </div>

      <div className="mt-3 text-sm text-text/80">{item.text || "Waiting"}</div>

      <div
        className={`mt-3 h-2 overflow-hidden rounded-full bg-black/35 ring-1 ring-inset ring-white/10 ${
          isIndeterminate && isActive
            ? "atlas-progress-indeterminate atlas-keep-motion"
            : ""
        }`}
      >
        <div
          className={`atlas-progress-fill h-full rounded-full ${meta.bar} ${
            item.status === "downloading" && !isIndeterminate
              ? "atlas-progress-fill--active atlas-keep-motion"
              : ""
          }`}
          style={{
            width: `${
              isIndeterminate && isActive
                ? 0
                : item.status === "completed"
                  ? 100
                  : percent
            }%`,
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-text/60">
        {!isIndeterminate && <div>{percent}%</div>}
        {hasTransferStats && (
          <div>
            {formatDownloadBytes(receivedBytes)} /{" "}
            {formatDownloadBytes(totalBytes)}
          </div>
        )}
        {item.status === "downloading" && (
          <div>{formatDownloadSpeed(item.speedBytesPerSecond)}</div>
        )}
        {eta && <div className="text-text/75">{eta}</div>}
        {hostLabel && <div>{hostLabel}</div>}
        {!isActive && item.updatedAt && (
          <div>{formatDownloadTimestamp(item.updatedAt)}</div>
        )}
      </div>

      {item.error && (
        <div
          className="atlas-rise-enter mt-3 flex items-start gap-1.5 text-xs text-red-200/90"
          role="alert"
        >
          <span className="material-symbols-outlined shrink-0 text-[15px]" aria-hidden>
            info
          </span>
          <span className="min-w-0 break-words">{item.error}</span>
        </div>
      )}

      {(canCancel || canRetry || item.status === "completed" || item.actionUrl) && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {item.actionUrl && item.status === "error" && (
            <button
              type="button"
              onClick={handleSolveCaptcha}
              disabled={Boolean(pendingAction)}
              className="inline-flex items-center gap-1 border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-100 transition hover:bg-amber-500/20 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                verified_user
              </span>
              Open mirror
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={Boolean(pendingAction)}
              className="inline-flex items-center gap-1 border border-red-500/35 bg-red-500/10 px-2.5 py-1 text-xs text-red-100 transition hover:bg-red-500/20 disabled:opacity-50"
            >
              {pendingAction === "cancel" ? (
                <span className="atlas-spinner atlas-keep-motion" aria-hidden />
              ) : (
                <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                  close
                </span>
              )}
              Cancel
            </button>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={Boolean(pendingAction)}
              className="group inline-flex items-center gap-1 border border-accent/45 bg-accent/15 px-2.5 py-1 text-xs text-text transition hover:bg-accent/25 disabled:opacity-50"
            >
              {pendingAction === "retry" ? (
                <span className="atlas-spinner atlas-keep-motion" aria-hidden />
              ) : (
                <span className="material-symbols-outlined text-[14px] leading-none transition-transform duration-700 group-hover:-rotate-180" aria-hidden>
                  refresh
                </span>
              )}
              Retry
            </button>
          )}
          {item.status === "completed" && item.recordId && onOpenLibraryRecord && (
            <button
              type="button"
              onClick={() => onOpenLibraryRecord(item.recordId)}
              className="inline-flex items-center gap-1 border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-100 transition hover:bg-emerald-500/20"
            >
              <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                sports_esports
              </span>
              Show in library
            </button>
          )}
          {!isActive && (
            <button
              type="button"
              onClick={handleShowInFolder}
              disabled={Boolean(pendingAction)}
              className="inline-flex items-center gap-1 border border-border bg-white/5 px-2.5 py-1 text-xs text-text transition hover:bg-white/10 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                folder_open
              </span>
              Folder
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const DownloadsPanel = (liveProps) => {
  const layer = useDownloadsLayer(liveProps.isOpen, liveProps, {
    onClose: () => liveProps.onClose?.(),
    manageFocus: false,
  });
  const [isClearing, setIsClearing] = React.useState(false);

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("atlas-downloads-open", Boolean(liveProps.isOpen));
    return () => root.classList.remove("atlas-downloads-open");
  }, [liveProps.isOpen]);

  if (!layer.isMounted) {
    return null;
  }

  const { items = [], activeCount = 0, onClose, onOpenLibraryRecord } =
    layer.props;
  const finishedCount = items.filter(
    (item) => !ACTIVE_DOWNLOAD_STATUSES.has(item.status),
  ).length;

  const clearHistory = async () => {
    if (isClearing) {
      return;
    }
    setIsClearing(true);
    try {
      const result = await callDownloadsApi("clearF95DownloadHistory");
      if (result && result.success === false) {
        throw new Error(result.error || "History could not be cleared.");
      }
    } catch (error) {
      downloadsToast()?.error(
        window.AtlasUI?.errorMessage(error, "History could not be cleared.") ||
          String(error),
        { title: "Downloads" },
      );
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <>
      <div
        className="atlas-overlay fixed inset-0 z-[1650] bg-black/20"
        data-state={layer.state}
        onClick={onClose}
        role="presentation"
      />
      <div
        className="atlas-popover fixed bottom-[52px] right-3 z-[1700] w-[min(520px,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-border bg-primary/90 shadow-2xl backdrop-blur-xl"
        data-state={layer.state}
        role="dialog"
        aria-label="Downloads"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-accent/80">
              Downloads
            </div>
            <div
              key={activeCount}
              className="atlas-fade-enter mt-1 text-sm font-medium text-text"
            >
              {activeCount > 0
                ? `${activeCount} active`
                : "No active downloads"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {finishedCount > 0 && (
              <button
                type="button"
                onClick={clearHistory}
                disabled={isClearing}
                className="atlas-fade-enter inline-flex items-center gap-1 rounded-lg border border-border bg-white/5 px-3 py-1.5 text-xs text-text transition hover:bg-white/10 disabled:opacity-50"
                title="Remove finished, failed and cancelled entries"
              >
                {isClearing ? (
                  <span className="atlas-spinner atlas-keep-motion" aria-hidden />
                ) : (
                  <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                    delete_sweep
                  </span>
                )}
                Clear history
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-white/5 px-3 py-1.5 text-xs text-text transition hover:bg-white/10"
              title="Close (Esc)"
            >
              Close
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="atlas-fade-enter flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-text/65">
            <span className="material-symbols-outlined text-[36px] text-text/30" aria-hidden>
              download_done
            </span>
            Background downloads will appear here.
          </div>
        ) : (
          <div className="max-h-[420px] overflow-y-auto px-3 py-3">
            <div className="space-y-3">
              {items.map((item, index) => (
                <DownloadItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  onOpenLibraryRecord={onOpenLibraryRecord}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

window.DownloadsPanel = DownloadsPanel;
