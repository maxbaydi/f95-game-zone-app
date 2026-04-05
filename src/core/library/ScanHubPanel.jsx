const formatScanHubDate = (value) => {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString();
};

const ScanHubSummaryCard = ({ label, value, tone = "neutral" }) => {
  const toneClass =
    tone === "accent"
      ? "border-accent/35 bg-accent/12 shadow-glow-accent"
      : tone === "warning"
        ? "border-amber-500/35 bg-amber-500/10"
        : "border-border bg-white/5 backdrop-blur-sm";

  return (
    <div className={`rounded-2xl border p-3 shadow-glass-sm ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] opacity-55">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-text">{value}</div>
    </div>
  );
};

const ScanHubPanel = ({
  isVisible,
  isLoading,
  sources,
  jobs,
  candidates,
  isScanRunning,
  onRefresh,
  onClose,
  onRescan,
  onCancelScan,
  onOpenFolder,
}) => {
  if (!isVisible) {
    return null;
  }

  const enabledSources = sources.filter((source) => source.isEnabled);
  const latestJob = jobs[0];

  return (
    <div className="fixed inset-0 z-[1200] bg-black/55 backdrop-blur-sm">
      <div className="absolute bottom-[44px] right-0 top-[70px] w-[540px] border-l border-border bg-primary/85 shadow-glass backdrop-blur-xl">
        <div className="flex items-start justify-between gap-4 border-b border-border bg-black/20 px-4 py-4 backdrop-blur-md">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] opacity-55">
              Library Scan
            </div>
            <div className="text-lg font-semibold text-text">
              Sources, jobs and discovery queue
            </div>
            <div className="text-xs opacity-65">
              Repeat scans live here now. No reason to hunt through importer UI.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isScanRunning ? (
              <button
                onClick={onCancelScan}
                className="rounded bg-red-700 px-3 py-2 text-sm text-white hover:bg-red-800"
              >
                Cancel Scan
              </button>
            ) : (
              <button
                onClick={onRescan}
                className="rounded bg-accent px-3 py-2 text-sm text-text hover:bg-selected"
              >
                Rescan Library
              </button>
            )}
            <button
              onClick={onRefresh}
              className="rounded bg-secondary px-3 py-2 text-sm hover:bg-selected"
            >
              Refresh
            </button>
            <button
              onClick={onClose}
              className="rounded bg-secondary px-3 py-2 text-sm hover:bg-selected"
            >
              Close
            </button>
          </div>
        </div>

        <div className="h-full overflow-y-auto px-4 py-4 pb-10">
          {isLoading ? (
            <div className="space-y-3">
              <div className="h-24 animate-pulse rounded-2xl bg-secondary/40" />
              <div className="h-40 animate-pulse rounded-2xl bg-secondary/30" />
              <div className="h-52 animate-pulse rounded-2xl bg-secondary/20" />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <ScanHubSummaryCard
                  label="Enabled Sources"
                  value={enabledSources.length}
                  tone="accent"
                />
                <ScanHubSummaryCard
                  label="Recent Jobs"
                  value={jobs.length}
                  tone="neutral"
                />
                <ScanHubSummaryCard
                  label="Detected Candidates"
                  value={candidates.length}
                  tone={candidates.length > 0 ? "warning" : "neutral"}
                />
              </div>

              <section className="rounded-2xl border border-border bg-secondary/10 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] opacity-55">
                      Scan Sources
                    </div>
                    <div className="text-sm opacity-70">
                      Configured folders used for repeat library scans
                    </div>
                  </div>
                </div>

                {sources.length === 0 ? (
                  <div className="text-sm opacity-60">
                    No scan sources configured yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sources.map((source) => (
                      <div
                        key={source.id}
                        className="rounded-xl border border-border/70 bg-canvas/40 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-text">
                              {source.isEnabled ? "Enabled" : "Disabled"}
                            </div>
                            <div className="mt-1 break-all text-xs opacity-65">
                              {source.path}
                            </div>
                          </div>
                          <button
                            onClick={() => onOpenFolder(source.path)}
                            className="rounded bg-secondary px-3 py-1 text-sm hover:bg-selected"
                          >
                            Open
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-border bg-secondary/10 p-4">
                <div className="mb-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] opacity-55">
                    Recent Jobs
                  </div>
                  <div className="text-sm opacity-70">
                    Latest known scan results across configured sources
                  </div>
                </div>

                {jobs.length === 0 ? (
                  <div className="text-sm opacity-60">
                    No scan jobs recorded yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {jobs.map((job) => (
                      <div
                        key={job.id}
                        className="rounded-xl border border-border/70 bg-canvas/40 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium capitalize text-text">
                              {job.status}
                            </div>
                            <div className="mt-1 text-xs opacity-65">
                              {formatScanHubDate(
                                job.finishedAt || job.startedAt,
                              )}
                            </div>
                          </div>
                          <div className="text-right text-xs opacity-70">
                            <div>{job.gamesFound || 0} detected</div>
                            <div>{job.errorsCount || 0} errors</div>
                          </div>
                        </div>
                        {job.notes?.sourcePaths?.length > 0 && (
                          <div className="mt-3 space-y-1 text-xs opacity-65">
                            {job.notes.sourcePaths
                              .slice(0, 3)
                              .map((sourcePath) => (
                                <div
                                  key={`${job.id}-${sourcePath}`}
                                  className="break-all"
                                >
                                  {sourcePath}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {latestJob && (
                  <div className="mt-3 text-xs opacity-60">
                    Last completed activity:{" "}
                    {formatScanHubDate(
                      latestJob.finishedAt || latestJob.startedAt,
                    )}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-border bg-secondary/10 p-4">
                <div className="mb-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] opacity-55">
                    Discovery Queue
                  </div>
                  <div className="text-sm opacity-70">
                    Recent detections waiting for review or already imported
                  </div>
                </div>

                {candidates.length === 0 ? (
                  <div className="text-sm opacity-60">
                    No persisted scan candidates yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {candidates.map((candidate) => (
                      <div
                        key={candidate.id}
                        className="rounded-xl border border-border/70 bg-canvas/40 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-text">
                              {candidate.title}
                            </div>
                            <div className="text-sm opacity-70">
                              {candidate.creator || "Unknown creator"}
                            </div>
                            <div className="mt-1 text-xs opacity-60">
                              {candidate.engine || "Unknown engine"} | v
                              {candidate.version || "?"} |{" "}
                              {candidate.detectionScore || 0}% confidence
                            </div>
                            <div className="mt-2 break-all text-xs opacity-60">
                              {candidate.folderPath}
                            </div>
                            {candidate.detectionReasons?.length > 0 && (
                              <div className="mt-2 text-xs opacity-60">
                                {candidate.detectionReasons
                                  .slice(0, 3)
                                  .join(" | ")}
                              </div>
                            )}
                          </div>
                          <div className="shrink-0 text-right text-xs opacity-70">
                            <div className="capitalize">{candidate.status}</div>
                            <div>{formatScanHubDate(candidate.lastSeenAt)}</div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => onOpenFolder(candidate.folderPath)}
                            className="rounded bg-secondary px-3 py-1 text-sm hover:bg-selected"
                          >
                            Open Folder
                          </button>
                          {candidate.libraryRecordId && (
                            <span className="text-xs opacity-60">
                              Linked to record #{candidate.libraryRecordId}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

window.ScanHubPanel = ScanHubPanel;
