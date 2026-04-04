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

const getDownloadStatusTone = (status) => {
  switch (status) {
    case "downloading":
      return "border-accent/30 bg-accent/10 text-text";
    case "queued":
      return "border-white/10 bg-white/5 text-text/85";
    case "installing":
      return "border-sky-400/30 bg-sky-500/10 text-sky-100";
    case "completed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
    case "error":
      return "border-red-500/30 bg-red-500/10 text-red-100";
    default:
      return "border-white/10 bg-white/5 text-text/85";
  }
};

const DownloadsPanel = ({ isOpen, items, activeCount, onClose }) => {
  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[1650] bg-black/20"
        onClick={onClose}
        role="presentation"
      />
      <div className="fixed bottom-[52px] right-3 z-[1700] w-[min(520px,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-white/10 bg-primary/90 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-accent/80">
              Downloads
            </div>
            <div className="mt-1 text-sm font-medium text-text">
              {activeCount > 0
                ? `${activeCount} active`
                : "No active downloads"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-text transition hover:bg-white/10"
          >
            Close
          </button>
        </div>

        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text/65">
            Background downloads will appear here.
          </div>
        ) : (
          <div className="max-h-[420px] overflow-y-auto px-3 py-3">
            <div className="space-y-3">
              {items.map((item) => {
                const percent = Math.max(
                  0,
                  Math.min(100, Number(item.percent) || 0),
                );
                const totalBytes = Number(item.totalBytes) || 0;
                const receivedBytes = Number(item.receivedBytes) || 0;
                const hasTransferStats = totalBytes > 0;

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-text">
                          {item.title || item.fileName || "Unnamed download"}
                        </div>
                        <div className="mt-1 text-xs text-text/55">
                          {item.fileName || item.sourceLabel || item.sourceHost}
                        </div>
                      </div>
                      <div
                        className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${getDownloadStatusTone(item.status)}`}
                      >
                        {item.status || "unknown"}
                      </div>
                    </div>

                    <div className="mt-3 text-sm text-text/80">
                      {item.text || "Waiting"}
                    </div>

                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/35 ring-1 ring-inset ring-white/10">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${
                          item.status === "error"
                            ? "bg-red-500"
                            : item.status === "completed"
                              ? "bg-emerald-500"
                              : item.status === "installing"
                                ? "bg-sky-500"
                                : "bg-gradient-to-r from-accent to-accentBar"
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text/60">
                      <div>{percent}%</div>
                      {hasTransferStats && (
                        <div>
                          {formatDownloadBytes(receivedBytes)} /{" "}
                          {formatDownloadBytes(totalBytes)}
                        </div>
                      )}
                      <div>{formatDownloadSpeed(item.speedBytesPerSecond)}</div>
                      {item.sourceHost && <div>{item.sourceHost}</div>}
                      {item.updatedAt && (
                        <div>{formatDownloadTimestamp(item.updatedAt)}</div>
                      )}
                    </div>

                    {item.error && (
                      <div className="mt-3 text-xs text-red-200/90">
                        {item.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

window.DownloadsPanel = DownloadsPanel;
