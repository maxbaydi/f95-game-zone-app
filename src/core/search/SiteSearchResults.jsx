const formatSiteNumber = (value) => {
  const numericValue = Number(String(value || "0").replace(/,/g, ""));
  return Number.isFinite(numericValue) ? numericValue.toLocaleString() : "0";
};

const formatSiteDate = (value) => {
  if (!value) {
    return "Unknown";
  }

  const numericValue = Number(value);
  const date =
    Number.isFinite(numericValue) && numericValue > 0
      ? new Date(numericValue * 1000)
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleDateString();
};

const SiteResultPill = ({ children, tone = "neutral" }) => {
  const toneClass =
    tone === "accent"
      ? "border-accent/40 bg-accent/15"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/15"
        : "border-border bg-secondary/40";

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-text ${toneClass}`}
    >
      {children}
    </span>
  );
};

const SiteSearchResults = ({
  results,
  isLoading,
  error,
  total,
  limit,
  limited,
  onOpenPage,
  onOpenLibraryRecord,
}) => {
  if (isLoading) {
    return (
      <div className="space-y-4 p-5">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="atlas-skeleton motion-reduce:animate-none h-[220px] animate-atlas-shimmer rounded-2xl border border-border shadow-glass-sm"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="atlas-glass-panel max-w-lg rounded-2xl px-8 py-10 shadow-glass">
          <div className="text-lg font-semibold text-text">
            Site search failed
          </div>
          <div className="mt-3 max-w-xl text-sm text-text/70">{error}</div>
        </div>
      </div>
    );
  }

  if (!results.length) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="atlas-glass-panel max-w-lg rounded-2xl px-8 py-10 shadow-glass motion-safe:animate-atlas-fade-up">
          <div className="text-lg font-semibold text-text">
            No site entries matched
          </div>
          <div className="mt-3 max-w-xl text-sm text-text/70">
            Tighten or loosen the site filters. This screen now searches the
            F95 metadata catalog, not your installed library.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-5">
      {limited && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
          Showing the first {limit} matches out of {total}. Narrow the filters
          if you want a tighter result set.
        </div>
      )}

      <div className="space-y-4">
        {results.map((result) => (
          <article
            key={result.atlasId}
            className="overflow-hidden rounded-2xl border border-border bg-primary/70 shadow-lg"
          >
            <div className="flex min-h-[220px]">
              <div className="w-[280px] shrink-0 bg-secondary/30">
                {result.bannerUrl ? (
                  <img
                    src={result.bannerUrl}
                    alt={result.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-center text-sm opacity-55">
                    No site banner available
                  </div>
                )}
              </div>

              <div className="flex flex-1 flex-col px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-semibold text-text">
                        {result.title || "Unknown title"}
                      </h3>
                      {result.f95Id && (
                        <SiteResultPill tone="accent">
                          F95 #{result.f95Id}
                        </SiteResultPill>
                      )}
                      {result.isInstalled && (
                        <SiteResultPill tone="warning">
                          Installed
                        </SiteResultPill>
                      )}
                    </div>
                    <div className="mt-1 text-sm opacity-70">
                      {result.creator || "Unknown creator"}
                    </div>
                  </div>

                  <div className="text-right text-xs opacity-65">
                    <div>Release: {formatSiteDate(result.releaseDate)}</div>
                    <div>
                      Thread: {formatSiteDate(result.threadPublishDate)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {result.category && (
                    <SiteResultPill>{result.category}</SiteResultPill>
                  )}
                  {result.engine && (
                    <SiteResultPill>{result.engine}</SiteResultPill>
                  )}
                  {result.status && (
                    <SiteResultPill>{result.status}</SiteResultPill>
                  )}
                  {result.censored && (
                    <SiteResultPill>{result.censored}</SiteResultPill>
                  )}
                  {result.version && (
                    <SiteResultPill tone="accent">
                      {`v${result.version}`}
                    </SiteResultPill>
                  )}
                  {result.rating && (
                    <SiteResultPill>{`Rating ${result.rating}`}</SiteResultPill>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-4 gap-3 text-sm text-text/85">
                  <div className="rounded-xl border border-border/60 bg-canvas/30 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] opacity-50">
                      Likes
                    </div>
                    <div className="mt-1 font-medium">
                      {formatSiteNumber(result.likes)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-canvas/30 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] opacity-50">
                      Views
                    </div>
                    <div className="mt-1 font-medium">
                      {formatSiteNumber(result.views)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-canvas/30 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] opacity-50">
                      Replies
                    </div>
                    <div className="mt-1 font-medium">
                      {formatSiteNumber(result.replies)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-canvas/30 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] opacity-50">
                      Language
                    </div>
                    <div className="mt-1 font-medium truncate">
                      {result.language || "Unknown"}
                    </div>
                  </div>
                </div>

                <div className="mt-4 max-h-[72px] overflow-hidden text-sm leading-6 text-text/90">
                  {result.overview ||
                    "No overview cached for this site entry yet."}
                </div>

                {result.tagList?.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {result.tagList.slice(0, 8).map((tag) => (
                      <span
                        key={`${result.atlasId}-${tag}`}
                        className="rounded-full border border-border bg-canvas/30 px-2 py-1 text-xs text-text/85"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={() => onOpenPage(result.siteUrl)}
                    className="rounded bg-accent px-4 py-2 text-sm text-onAccent hover:brightness-110"
                    disabled={!result.siteUrl}
                  >
                    Open F95 Page
                  </button>
                  {result.libraryRecordId && (
                    <button
                      onClick={() =>
                        onOpenLibraryRecord(result.libraryRecordId)
                      }
                      className="rounded bg-secondary px-4 py-2 text-sm text-text hover:bg-selected"
                    >
                      Open In Library
                    </button>
                  )}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

window.SiteSearchResults = SiteSearchResults;
