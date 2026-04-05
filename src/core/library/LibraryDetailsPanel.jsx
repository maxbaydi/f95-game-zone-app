const { useMemo } = window.React;

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

const LibraryDetailsPanel = ({
  game,
  previews,
  isLoading,
  onClose,
  onOpenPage,
  onPlayGame,
  onUpdateGame,
  onOpenFolder,
  onRemoveGame,
  onPreviewSelect,
  onOpenCloudAuth,
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
  const hasInstalledVersions = versionList.length > 0;

  return (
    <aside className="atlas-glass-panel w-[420px] shrink-0 border-l border-border shadow-glass">
      <div className="flex h-full flex-col">
        <div className="relative z-10 flex items-start justify-between gap-3 border-b border-border bg-black/15 px-4 py-2.5 backdrop-blur-sm">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.22em] opacity-50">
              Game Overview
            </div>
            <div className="truncate text-lg font-semibold leading-tight text-text">
              {isLoading ? "Loading..." : displayTitle}
            </div>
            <div className="truncate text-sm opacity-70">
              {isLoading ? "Fetching metadata..." : displayCreator}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-border bg-white/5 px-2 py-1 text-xs text-text shadow-glass-sm backdrop-blur-md transition hover:bg-white/10"
          >
            Close
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
              <div className="space-y-3">
                <div className="h-[200px] animate-pulse rounded-xl bg-secondary/50" />
                <div className="h-16 animate-pulse rounded-xl bg-secondary/40" />
                <div className="h-40 animate-pulse rounded-xl bg-secondary/30" />
              </div>
            ) : (
              <div className="space-y-5">
                <section className="overflow-hidden rounded-2xl border border-border bg-secondary/20">
                  {game.banner_url ? (
                    <img
                      src={game.banner_url}
                      alt={displayTitle}
                      className="h-[220px] w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-[220px] items-center justify-center bg-secondary/40 text-sm opacity-60">
                      No banner cached yet
                    </div>
                  )}
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
                    </div>
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
                        : "Not installed on this PC"}
                    </div>
                    {hasInstalledVersions ? (
                      <>
                        <div className="mt-1 text-xs opacity-70">
                          Installed: {game.newestInstalledVersion || "Unknown"}
                        </div>
                        <div className="text-xs opacity-70">
                          Site latest: {game.latestVersion || "Unknown"}
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
                        ) : (
                          <DetailPill tone="accent">Ready to install</DetailPill>
                        )}
                        <button
                          type="button"
                          onClick={() => onUpdateGame?.(game)}
                          className="bg-accent px-2 py-0.5 text-xs text-text hover:bg-selected disabled:opacity-40"
                          disabled={!game.siteUrl}
                        >
                          {hasInstalledVersions
                            ? game.latestVersion
                              ? `Update to ${game.latestVersion}`
                              : "Update now"
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
                      {versionList.map((version) => (
                        <div
                          key={`${version.version}-${version.game_path}`}
                          className="border border-border/70 bg-canvas/40 p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-text">
                                  {version.version || "Unknown"}
                                </span>
                                {version.version ===
                                  game.newestInstalledVersion && (
                                  <DetailPill tone="accent">Current</DetailPill>
                                )}
                              </div>
                              <div className="mt-1 break-all text-xs opacity-60">
                                {version.game_path}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-start gap-1.5">
                              <button
                                type="button"
                                onClick={() => onPlayGame?.(version, game)}
                                className="bg-accent px-2 py-0.5 text-xs text-text hover:bg-selected disabled:opacity-60"
                                disabled={!version.exec_path}
                              >
                                Play
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenFolder(version.game_path)}
                                className="bg-secondary px-2 py-0.5 text-xs hover:bg-selected"
                              >
                                Open
                              </button>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs opacity-75">
                            <div>
                              Added: {formatDetailDate(version.date_added)}
                            </div>
                            <div>
                              Size: {formatDetailBytes(version.folder_size)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border/40 pt-3">
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
                          className="tag-chevron material-symbols-outlined text-[16px] transition-transform duration-200"
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
                  onOpenCloudAuth={onOpenCloudAuth}
                />

                <section className="rounded-2xl border border-border bg-secondary/10 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] opacity-55">
                      Screenshots
                    </div>
                    <div className="text-xs opacity-60">
                      {previews.length > 0
                        ? `${previews.length} cached`
                        : "No cached shots"}
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
                            className="overflow-hidden rounded-xl border border-border bg-canvas/40 transition-transform hover:scale-[1.01]"
                          >
                            <img
                              src={previewUrl}
                              alt={`${displayTitle} screenshot ${index + 1}`}
                              className="h-[120px] w-full object-cover"
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
