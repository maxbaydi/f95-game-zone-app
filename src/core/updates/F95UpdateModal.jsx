const F95UpdateModal = ({
  isOpen,
  game,
  thread,
  isLoading,
  isInstalling,
  error,
  captchaUrl,
  actionKind,
  handoff,
  attemptEvents,
  selectedLinkUrl,
  onSelectLink,
  onSolveCaptcha,
  onOpenInBrowser,
  onReopenHandoff,
  onConfirm,
  onClose,
}) => {
  if (!isOpen) {
    return null;
  }

  const mirrorUi = window.f95MirrorUi || {};
  const links = Array.isArray(thread?.links) ? thread.links : [];
  const recommendedLinkUrl =
    thread?.recommendation?.linkUrl || thread?.preferredLinkUrl || "";
  const selectedLink =
    links.find((link) => link.url === selectedLinkUrl) ||
    links.find((link) => link.url === recommendedLinkUrl) ||
    links[0] ||
    null;
  const hasInstalledVersions =
    Array.isArray(game?.versions) && game.versions.length > 0;
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
  const actionButtonLabel =
    actionKind === "captcha" ? "Solve Captcha" : "Open Verification Page";

  return (
    <div className="fixed inset-0 z-[1700] flex items-center justify-center bg-black/65 px-6 py-10 backdrop-blur-md">
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-border bg-primary/95 shadow-2xl">
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {isLoading && (
            <div className="flex items-center justify-center gap-3 rounded-2xl border border-border bg-white/5 px-5 py-8 text-sm text-text/70">
              <span className="material-symbols-outlined animate-spin text-[20px] leading-none text-accent">
                progress_activity
              </span>
              Checking the live F95 thread and picking the best mirror...
            </div>
          )}

          {handoff && (
            <div className="border border-accent/40 bg-accent/10 px-5 py-4 text-sm text-text">
              <div className="flex items-center gap-2 font-semibold">
                <span className="material-symbols-outlined animate-atlas-pulse-soft text-[20px] leading-none text-accent">
                  open_in_browser
                </span>
                Waiting for your download from {handoff.hostName}
              </div>
              <div className="mt-2 text-text/75">
                The {handoff.hostName} page is open in the browser window. Press
                its Download button. F95Launcher picks up the file and installs
                it automatically, and you can follow it in Downloads.
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onReopenHandoff}
                  className="rounded-lg border border-accent/40 bg-white/5 px-4 py-2 text-sm text-text transition hover:bg-white/10"
                >
                  Open the page again
                </button>
              </div>
            </div>
          )}

          {!isLoading && error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-100">
              <div>{error}</div>
              {captchaUrl ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={onSolveCaptcha}
                    className="rounded-lg border border-red-200/20 bg-white/5 px-4 py-2 text-sm text-red-50 transition hover:bg-white/10"
                  >
                    {actionButtonLabel}
                  </button>
                  <div className="text-xs text-red-100/80">
                    After the check F95Launcher continues on its own. If the
                    host shows a Download button instead, just press it and the
                    file is installed for you.
                  </div>
                </div>
              ) : (
                thread &&
                selectedLink &&
                !selectedIsBrowserOnly &&
                !isInstalling && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={onOpenInBrowser}
                      className="rounded-lg border border-red-200/20 bg-white/5 px-4 py-2 text-sm text-red-50 transition hover:bg-white/10"
                    >
                      Download {hostName} in the browser instead
                    </button>
                    <div className="text-xs text-red-100/80">
                      Press Download on the page and F95Launcher installs the
                      file for you.
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {!isLoading && thread && links.length === 0 && (
            <div className="rounded-2xl border border-border bg-white/5 px-5 py-8 text-center text-sm text-text/70">
              No mirrors were found for this thread.
            </div>
          )}

          {!isLoading && thread && links.length > 0 && (
            <window.F95MirrorPicker
              key={thread.threadUrl || "thread"}
              thread={thread}
              selectedLinkUrl={selectedLink?.url || ""}
              onSelectLink={(link) => onSelectLink(link.url)}
              disabled={isInstalling}
              attemptEvents={attemptEvents}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <div className="min-w-0 text-xs text-text/55">
            {selectedLink
              ? selectedIsBrowserOnly
                ? `${hostName} opens in the browser; the download is installed automatically.`
                : `${hostName} downloads and installs automatically.`
              : "No mirror selected"}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-white/5 px-4 py-2 text-sm text-text transition hover:bg-white/10"
            >
              {handoff ? "Close" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading || isInstalling || !selectedLink}
              className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-onAccent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                className={`material-symbols-outlined text-[18px] leading-none ${
                  isInstalling ? "animate-spin" : ""
                }`}
              >
                {isInstalling
                  ? "progress_activity"
                  : selectedIsBrowserOnly && !captchaUrl
                    ? "open_in_browser"
                    : "download"}
              </span>
              {isInstalling ? "Starting..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

window.F95UpdateModal = F95UpdateModal;
