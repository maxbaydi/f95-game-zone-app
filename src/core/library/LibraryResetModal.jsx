const useLibraryResetModalLayer = (isOpen, props, options) =>
  window.AtlasMotion?.useModalLayer
    ? window.AtlasMotion.useModalLayer(isOpen, props, options)
    : { isMounted: Boolean(isOpen), state: "open", props, dialogRef: null };

const LibraryResetFact = ({ icon, tone = "neutral", children }) => (
  <li className="flex items-start gap-2 text-sm leading-6 text-text/80">
    <span
      className={`material-symbols-outlined mt-1 shrink-0 text-[18px] leading-none ${
        tone === "danger" ? "text-red-300" : tone === "ok" ? "text-emerald-300" : "text-text/60"
      }`}
      aria-hidden
    >
      {icon}
    </span>
    <span>{children}</span>
  </li>
);

/**
 * Confirmation for "Rebuild library from scratch": the local library index is
 * backed up and wiped, then every scan folder is scanned again. Game files,
 * saves and the catalog are never touched.
 */
const LibraryResetModal = (liveProps) => {
  const layer = useLibraryResetModalLayer(liveProps.isOpen, liveProps, {
    onClose: () => {
      if (!liveProps.isRunning) {
        liveProps.onClose?.();
      }
    },
  });
  const [acknowledged, setAcknowledged] = React.useState(false);

  React.useEffect(() => {
    if (!liveProps.isOpen) {
      setAcknowledged(false);
    }
  }, [liveProps.isOpen]);

  if (!layer.isMounted) {
    return null;
  }

  const { gameCount = 0, installedCount = 0, isRunning, error, onConfirm, onClose } =
    layer.props;

  return (
    <div
      className="atlas-overlay fixed inset-0 z-[1700] flex items-center justify-center bg-black/65 px-6 py-10 backdrop-blur-md"
      data-state={layer.state}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isRunning) {
          onClose?.();
        }
      }}
    >
      <div
        ref={layer.dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Rebuild library"
        className="atlas-dialog flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-border bg-primary/95 shadow-2xl outline-none"
        data-state={layer.state}
      >
        <div className="border-b border-border px-6 py-5">
          <div className="text-[11px] uppercase tracking-[0.22em] text-red-300/80">
            Library maintenance
          </div>
          <div className="mt-2 text-2xl font-semibold text-text">
            Rebuild the library from scratch?
          </div>
          <div className="mt-2 text-sm text-text/65">
            {gameCount > 0
              ? `${gameCount} game${gameCount === 1 ? "" : "s"} in your library (${installedCount} installed on this PC) will be forgotten and found again by scanning your folders.`
              : "Your library index is empty; a fresh scan of your folders will run."}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <ul className="space-y-2">
            <LibraryResetFact icon="delete_sweep" tone="danger">
              Removes every library entry, its versions, cached banners and
              screenshots, favorites and site links.
            </LibraryResetFact>
            <LibraryResetFact icon="shield" tone="ok">
              Keeps your game folders, your saves and the local save backups.
            </LibraryResetFact>
            <LibraryResetFact icon="save" tone="ok">
              A backup of the library is saved first, so this can be undone by
              support if something goes wrong.
            </LibraryResetFact>
            <LibraryResetFact icon="cloud_sync">
              Games from your account library are added back as "Not installed"
              after the next cloud sync.
            </LibraryResetFact>
          </ul>

          {error && (
            <div
              key={error}
              className="atlas-shake rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-100"
              role="alert"
            >
              {error}
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-white/5 px-4 py-3 text-sm text-text/85">
            <input
              type="checkbox"
              className="mt-1"
              checked={acknowledged}
              disabled={isRunning}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              I understand that the library will be rebuilt and that games
              which are not found in my scan folders will disappear from it.
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isRunning}
            className="rounded-lg border border-border bg-white/5 px-4 py-2 text-sm text-text transition hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!acknowledged || isRunning}
            className="inline-flex items-center gap-2 rounded-lg bg-red-500/85 px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? (
              <span className="atlas-spinner atlas-keep-motion" aria-hidden />
            ) : (
              <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden>
                restart_alt
              </span>
            )}
            {isRunning ? "Rebuilding..." : "Rebuild library"}
          </button>
        </div>
      </div>
    </div>
  );
};

window.LibraryResetModal = LibraryResetModal;
