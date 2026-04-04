const F95UpdateModal = ({
  isOpen,
  game,
  thread,
  isLoading,
  isInstalling,
  error,
  selectedLinkUrl,
  onSelectLink,
  onConfirm,
  onClose,
}) => {
  if (!isOpen) {
    return null;
  }

  const links = Array.isArray(thread?.links) ? thread.links : [];
  const variants = Array.isArray(thread?.variants) ? thread.variants : [];
  const selectedLink =
    links.find((link) => link.url === selectedLinkUrl) || links[0] || null;

  return (
    <div className="absolute inset-0 z-[1700] flex items-center justify-center bg-black/65 px-6 py-10 backdrop-blur-md">
      <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-primary/95 shadow-2xl">
        <div className="border-b border-white/10 px-6 py-5">
          <div className="text-[11px] uppercase tracking-[0.22em] text-accent/80">
            Library Update
          </div>
          <div className="mt-2 text-2xl font-semibold text-text">
            {thread?.title || game?.displayTitle || game?.title || "Update"}
          </div>
          <div className="mt-2 text-sm text-text/65">
            {thread?.version && `Latest: ${thread.version}`}
            {game?.newestInstalledVersion &&
              `${thread?.version ? " • " : ""}Installed: ${game.newestInstalledVersion}`}
            {thread?.creator &&
              `${thread?.version || game?.newestInstalledVersion ? " • " : ""}Creator: ${thread.creator}`}
          </div>
        </div>

        <div className="max-h-[56vh] overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-8 text-center text-sm text-text/70">
              Checking the live F95 thread and loading mirrors...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-100">
              {error}
            </div>
          ) : links.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-8 text-center text-sm text-text/70">
              No mirrors were found for this thread.
            </div>
          ) : (
            <>
              <div className="mb-4 text-sm text-text/70">
                Choose the file for this update. Atlas now groups download links
                by platform and skips unrelated links instead of dumping every
                external URL into one list.
              </div>
              <div className="space-y-5">
                {(variants.length > 0 ? variants : [{ label: "Downloads", links }]).map(
                  (variant) => (
                    <div key={`${variant.id || "group"}-${variant.label}`}>
                      <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-text/55">
                        {variant.label}
                      </div>
                      <div className="space-y-3">
                        {(variant.links || []).map((link) => {
                          const isSelected = selectedLink?.url === link.url;
                          return (
                            <button
                              key={link.url}
                              type="button"
                              onClick={() => onSelectLink(link.url)}
                              className={`flex w-full items-start justify-between rounded-2xl border px-4 py-4 text-left transition ${
                                isSelected
                                  ? "border-accent/40 bg-accent/10 shadow-glow-accent"
                                  : "border-white/10 bg-white/5 hover:bg-white/10"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-text">
                                  {link.label || link.host}
                                </div>
                                <div className="mt-1 text-xs text-text/55">
                                  {link.url}
                                </div>
                              </div>
                              <div
                                className={`ml-4 shrink-0 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${
                                  isSelected
                                    ? "border-accent/40 bg-accent/15 text-text"
                                    : "border-white/10 bg-black/20 text-text/70"
                                }`}
                              >
                                {link.host}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ),
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-6 py-4">
          <div className="text-xs text-text/55">
            {selectedLink ? `Selected: ${selectedLink.host}` : "No mirror selected"}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-text transition hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading || isInstalling || !selectedLink}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black transition hover:bg-selected disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isInstalling ? "Starting..." : "Update Now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

window.F95UpdateModal = F95UpdateModal;
