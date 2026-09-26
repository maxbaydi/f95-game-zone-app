const useF95UpdateModalLayer = (isOpen, props, options) =>
  window.AtlasMotion?.useModalLayer
    ? window.AtlasMotion.useModalLayer(isOpen, props, options)
    : { isMounted: Boolean(isOpen), state: "open", props, dialogRef: null };

const F95UpdateModal = (liveProps) => {
  const layer = useF95UpdateModalLayer(liveProps.isOpen, liveProps, {
    onClose: () => {
      if (!liveProps.isInstalling) {
        liveProps.onClose?.();
      }
    },
  });

  if (!layer.isMounted) {
    return null;
  }

  const {
    game,
    thread,
    isLoading,
    isInstalling,
    error,
    captchaUrl,
    selectedLinkUrl,
    onSelectLink,
    onSolveCaptcha,
    onConfirm,
    onClose,
  } = layer.props;

  const links = Array.isArray(thread?.links) ? thread.links : [];
  const variants = Array.isArray(thread?.variants) ? thread.variants : [];
  const getMirrorDisplayName =
    window.getF95MirrorDisplayName ||
    ((link) => String(link?.host || link?.label || "Mirror"));
  const selectedLink =
    links.find((link) => link.url === selectedLinkUrl) || links[0] || null;
  const hasInstalledVersions =
    Array.isArray(game?.versions) && game.versions.length > 0;
  const confirmLabel = captchaUrl
    ? hasInstalledVersions
      ? "Retry Update"
      : "Retry Install"
    : hasInstalledVersions
      ? "Update Now"
      : "Install Now";

  return (
    <div
      className="atlas-overlay fixed inset-0 z-[1700] flex items-center justify-center bg-black/65 px-6 py-10 backdrop-blur-md"
      data-state={layer.state}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isInstalling) {
          onClose?.();
        }
      }}
    >
      <div
        ref={layer.dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={hasInstalledVersions ? "Update game" : "Install game"}
        className="atlas-dialog max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-primary/95 shadow-2xl outline-none"
        data-state={layer.state}
      >
        <div className="relative border-b border-border px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            disabled={isInstalling}
            className="group absolute right-4 top-4 flex h-8 w-8 items-center justify-center border border-border bg-white/5 text-text transition hover:bg-white/10 disabled:opacity-40"
            aria-label="Close"
            title="Close (Esc)"
          >
            <span className="material-symbols-outlined text-[18px] leading-none transition-transform duration-500 group-hover:rotate-90">
              close
            </span>
          </button>
          <div className="text-[11px] uppercase tracking-[0.22em] text-accent/80">
            {hasInstalledVersions ? "Library Update" : "Library Install"}
          </div>
          <div className="mt-2 text-2xl font-semibold text-text">
            {thread?.title || game?.displayTitle || game?.title || "Update"}
          </div>
          <div className="mt-2 text-sm text-text/65">
            {thread?.version && `Latest: ${thread.version}`}
            {hasInstalledVersions &&
              game?.newestInstalledVersion &&
              `${thread?.version ? " • " : ""}Installed: ${game.newestInstalledVersion}`}
            {thread?.creator &&
              `${thread?.version || (hasInstalledVersions && game?.newestInstalledVersion) ? " • " : ""}Creator: ${thread.creator}`}
          </div>
        </div>

        <div className="max-h-[56vh] overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="atlas-fade-enter space-y-4 rounded-2xl border border-border bg-white/5 px-5 py-6 text-sm text-text/70">
              <div className="flex items-center justify-center gap-2">
                <span className="atlas-spinner atlas-keep-motion text-accent" aria-hidden />
                Checking the live F95 thread and loading mirrors...
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="space-y-2">
                    <div className="atlas-skeleton h-3 w-24" />
                    <div className="atlas-skeleton h-9 w-full" />
                    <div className="atlas-skeleton h-9 w-full" />
                  </div>
                ))}
              </div>
            </div>
          ) : error ? (
            <div
              key={error}
              className="atlas-shake rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-100"
              role="alert"
            >
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined shrink-0 text-[18px] text-red-300" aria-hidden>
                  error
                </span>
                <div>{error}</div>
              </div>
              {captchaUrl && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={onSolveCaptcha}
                    className="rounded-lg border border-red-200/20 bg-white/5 px-4 py-2 text-sm text-red-50 transition hover:bg-white/10"
                  >
                    Solve Captcha
                  </button>
                  <div className="text-xs text-red-100/80">
                    Finish the captcha in the browser window, then retry the
                    update here.
                  </div>
                </div>
              )}
            </div>
          ) : links.length === 0 ? (
            <div className="rounded-2xl border border-border bg-white/5 px-5 py-8 text-center text-sm text-text/70">
              No mirrors were found for this thread.
            </div>
          ) : (
            <div className="atlas-view-enter">
              <window.F95MirrorColumns
                variants={variants}
                links={links}
                selectedLinkUrl={selectedLink?.url || ""}
                onSelectLink={(link) => onSelectLink(link.url)}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <div
            key={selectedLink?.url || "none"}
            className="atlas-fade-enter text-xs text-text/55"
          >
            {selectedLink
              ? `Selected: ${getMirrorDisplayName(selectedLink)}`
              : "No mirror selected"}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-white/5 px-4 py-2 text-sm text-text transition hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading || isInstalling || !selectedLink}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-onAccent transition hover:shadow-glow-accent hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isInstalling ? (
                <span className="atlas-spinner atlas-keep-motion" aria-hidden />
              ) : (
                <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden>
                  {captchaUrl ? "refresh" : "download"}
                </span>
              )}
              {isInstalling ? "Resolving mirror..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

window.F95UpdateModal = F95UpdateModal;
