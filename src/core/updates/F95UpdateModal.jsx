const F95UpdateModal = ({
  isOpen,
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
}) => {
  if (!isOpen) {
    return null;
  }

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
    <div className="fixed inset-0 z-[1700] flex items-center justify-center bg-black/65 px-6 py-10 backdrop-blur-md">
      <div className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-primary/95 shadow-2xl">
        <div className="border-b border-border px-6 py-5">
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
            <div className="rounded-2xl border border-border bg-white/5 px-5 py-8 text-center text-sm text-text/70">
              Checking the live F95 thread and loading mirrors...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-100">
              <div>{error}</div>
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
            <window.F95MirrorColumns
              variants={variants}
              links={links}
              selectedLinkUrl={selectedLink?.url || ""}
              onSelectLink={(link) => onSelectLink(link.url)}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <div className="text-xs text-text/55">
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
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-onAccent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isInstalling ? "Starting..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

window.F95UpdateModal = F95UpdateModal;
