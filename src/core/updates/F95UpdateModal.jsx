const useF95UpdateModalLayer = (isOpen, props, options) =>
  window.AppMotion?.useModalLayer
    ? window.AppMotion.useModalLayer(isOpen, props, options)
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
    attemptEvents,
    selectedLinkUrl,
    needsLogin,
    onSignIn,
    onSelectLink,
    onSolveCaptcha,
    onConfirm,
    onClose,
  } = layer.props;

  const mirrorUi = window.f95MirrorUi || {};
  const links = Array.isArray(thread?.links) ? thread.links : [];
  const recommendedLinkUrl =
    thread?.recommendation?.linkUrl || thread?.preferredLinkUrl || "";
  const selectedLink =
    links.find((link) => link.url === selectedLinkUrl) ||
    links.find((link) => link.url === recommendedLinkUrl) ||
    links[0] ||
    null;
  // "Update" only when the files are really on this PC; a record whose folder
  // vanished gets a fresh install (the old folder cannot be updated in place).
  const installState = window.libraryInstallState?.getLibraryInstallState
    ? window.libraryInstallState.getLibraryInstallState(game)
    : Array.isArray(game?.versions) && game.versions.length > 0
      ? "installed"
      : "not_installed";
  const hasInstalledVersions = installState === "installed";
  const hasMissingFiles = installState === "missing";
  const selectedIsBrowserOnly = Boolean(
    selectedLink && mirrorUi.isBrowserOnly?.(selectedLink),
  );
  const hostName = selectedLink
    ? window.getF95MirrorDisplayName?.(selectedLink) || "mirror"
    : "mirror";
  const confirmLabel = captchaUrl
    ? hasInstalledVersions
      ? "Retry Update"
      : "Retry Install"
    : mirrorUi.getActionLabel?.(selectedLink, {
        isUpdate: hasInstalledVersions,
      }) || (hasInstalledVersions ? "Update Now" : "Install Now");

  return (
    <div
      className="app-overlay fixed inset-0 z-[1700] flex items-center justify-center bg-black/65 px-6 py-10 backdrop-blur-md"
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
        className="app-dialog flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-border bg-primary/95 shadow-2xl outline-none"
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
          <div className="mt-2 pr-10 text-2xl font-semibold text-text">
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
          {hasMissingFiles && (
            <div className="mt-2 text-xs text-amber-200/85">
              The folder of this game is missing on this PC
              {game?.lastKnownVersion ? ` (last installed: ${game.lastKnownVersion})` : ""}
              , so it will be installed fresh into your library folder.
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {needsLogin ? (
            <div className="app-fade-enter flex flex-col items-center gap-4 rounded-2xl border border-accent/30 bg-accent/10 px-5 py-8 text-center">
              <span className="material-symbols-outlined text-[36px] leading-none text-accent" aria-hidden>
                login
              </span>
              <div className="max-w-md text-sm text-text/85">
                Sign in to F95 to see the mirrors for this game. The list opens
                here by itself once you're signed in.
              </div>
              <button
                type="button"
                onClick={onSignIn}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-onAccent transition hover:shadow-glow-accent hover:brightness-110"
              >
                <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden>
                  login
                </span>
                Sign in to F95
              </button>
            </div>
          ) : isLoading ? (
            <div className="app-fade-enter space-y-4 rounded-2xl border border-border bg-white/5 px-5 py-6 text-sm text-text/70">
              <div className="flex items-center justify-center gap-2">
                <span
                  className="app-spinner app-keep-motion text-accent"
                  aria-hidden
                />
                Checking the live F95 thread and picking the best mirror...
              </div>
              <div className="space-y-3">
                <div className="app-skeleton h-28 w-full" />
                <div className="app-skeleton h-11 w-full" />
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div
                  key={error}
                  className="app-shake rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-100"
                  role="alert"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="material-symbols-outlined shrink-0 text-[18px] text-red-300"
                      aria-hidden
                    >
                      error
                    </span>
                    <div>
                      {error}
                      {thread && links.length > 1 && !captchaUrl && (
                        <div className="mt-1 text-xs text-red-100/75">
                          Pick another mirror below and try again.
                        </div>
                      )}
                    </div>
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
                        After the check F95Launcher continues on its own.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {thread && links.length === 0 && (
                <div className="rounded-2xl border border-border bg-white/5 px-5 py-8 text-center text-sm text-text/70">
                  No mirrors were found for this thread.
                </div>
              )}

              {thread && links.length > 0 && (
                <div className="app-view-enter">
                  <window.F95MirrorPicker
                    key={thread.threadUrl || "thread"}
                    thread={thread}
                    selectedLinkUrl={selectedLink?.url || ""}
                    onSelectLink={(link) => onSelectLink(link.url)}
                    disabled={isInstalling}
                    attemptEvents={attemptEvents}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <div
            key={selectedLink?.url || "none"}
            className="app-fade-enter min-w-0 text-xs text-text/55"
          >
            {needsLogin
              ? "Mirrors are shown after you sign in to F95."
              : selectedLink
                ? selectedIsBrowserOnly
                  ? `${hostName} opens in a browser window; press Download there and the file is installed for you.`
                  : `${hostName} downloads and installs automatically.`
                : "No mirror selected"}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isInstalling}
              className="rounded-lg border border-border bg-white/5 px-4 py-2 text-sm text-text transition hover:bg-white/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={needsLogin || isLoading || isInstalling || !selectedLink}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-onAccent transition hover:shadow-glow-accent hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isInstalling ? (
                <span className="app-spinner app-keep-motion" aria-hidden />
              ) : (
                <span
                  className="material-symbols-outlined text-[18px] leading-none"
                  aria-hidden
                >
                  {captchaUrl
                    ? "refresh"
                    : selectedIsBrowserOnly
                      ? "open_in_browser"
                      : "download"}
                </span>
              )}
              {isInstalling ? "Connecting to the mirror..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

window.F95UpdateModal = F95UpdateModal;
