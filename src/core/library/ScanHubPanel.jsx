const { useEffect, useState } = window.React;

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

const ScanHubStatCell = ({ label, value, tone = "neutral" }) => {
  const toneClass =
    tone === "accent"
      ? "text-accentBar"
      : tone === "warning"
        ? "text-amber-200/90"
        : "text-text";

  return (
    <div className="min-w-0 px-2 py-2 text-center">
      <div className="text-[10px] uppercase tracking-[0.16em] opacity-55">
        {label}
      </div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
    </div>
  );
};

const getScanHubErrorMessage = (result, fallbackMessage) => {
  if (typeof result?.error === "string" && result.error.trim()) {
    return result.error.trim();
  }

  if (
    typeof result?.error?.message === "string" &&
    result.error.message.trim()
  ) {
    return result.error.message.trim();
  }

  return fallbackMessage;
};

const ScanHubPanel = ({
  isVisible,
  isLoading,
  sources,
  jobs,
  candidates,
  isScanRunning,
  defaultGameFolder,
  onRefresh,
  onClose,
  onRescan,
  onCancelScan,
  onOpenFolder,
  onAddSource,
  onToggleSource,
  onReplaceSource,
  onRemoveSource,
  onChooseLibraryFolder,
}) => {
  const [feedback, setFeedback] = useState({
    tone: "",
    text: "",
  });
  const [busyAction, setBusyAction] = useState("");

  useEffect(() => {
    if (!isVisible) {
      setFeedback({ tone: "", text: "" });
      setBusyAction("");
    }
  }, [isVisible]);

  if (!isVisible) {
    return null;
  }

  const enabledSources = sources.filter((source) => source.isEnabled);
  const latestJob = jobs[0];
  const hasLibraryFolder = Boolean(String(defaultGameFolder || "").trim());
  const runAction = async (actionKey, action, successMessage) => {
    setBusyAction(actionKey);
    setFeedback({ tone: "", text: "" });

    try {
      const result = await action();
      if (result?.cancelled) {
        return result;
      }

      if (!result?.success) {
        setFeedback({
          tone: "error",
          text: getScanHubErrorMessage(result, "Action failed."),
        });
        return result;
      }

      setFeedback({
        tone: "success",
        text:
          typeof successMessage === "function"
            ? successMessage(result)
            : successMessage,
      });
      return result;
    } catch (error) {
      console.error("Scan Hub action failed:", error);
      setFeedback({
        tone: "error",
        text:
          (typeof error?.message === "string" && error.message.trim()) ||
          "Action failed.",
      });
      return { success: false, error };
    } finally {
      setBusyAction((previous) => (previous === actionKey ? "" : previous));
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] bg-onAccent/75">
      <div className="absolute bottom-[40px] right-0 top-[70px] flex w-[min(620px,100%)] min-h-0 flex-col border-l border-border bg-primary shadow-glass">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-secondary px-3 py-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] opacity-55">
              Library Scan
            </div>
            <div className="text-base font-semibold leading-tight text-text">
              Scan Hub
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() =>
                runAction("add-source", onAddSource, "Scan source added.")
              }
              disabled={busyAction === "add-source"}
              className="bg-secondary px-2 py-1 text-xs hover:bg-selected disabled:opacity-60"
            >
              {busyAction === "add-source" ? "Adding…" : "Add Source"}
            </button>
            {isScanRunning ? (
              <button
                type="button"
                onClick={onCancelScan}
                className="bg-red-700 px-2 py-1 text-xs text-white hover:bg-red-800"
              >
                Cancel Scan
              </button>
            ) : (
              <button
                type="button"
                onClick={onRescan}
                className="bg-accent px-2 py-1 text-xs text-onAccent hover:brightness-110"
              >
                Rescan Library
              </button>
            )}
            <button
              type="button"
              onClick={onRefresh}
              className="bg-secondary px-2 py-1 text-xs hover:bg-selected"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="bg-secondary px-2 py-1 text-xs hover:bg-selected"
            >
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-8">
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-14 animate-pulse bg-secondary/40" />
              <div className="h-28 animate-pulse bg-secondary/30" />
              <div className="h-36 animate-pulse bg-secondary/20" />
            </div>
          ) : (
            <div className="space-y-3">
              {feedback.text && (
                <div
                  className={`border p-2 text-sm ${
                    feedback.tone === "error"
                      ? "border-red-500/35 bg-red-500/10 text-red-100"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                  }`}
                >
                  {feedback.text}
                </div>
              )}

              <div className="border border-border/70 bg-secondary/5">
                <div className="grid grid-cols-3 divide-x divide-border/40">
                  <ScanHubStatCell
                    label="Enabled sources"
                    value={enabledSources.length}
                    tone="accent"
                  />
                  <ScanHubStatCell
                    label="Recent jobs"
                    value={jobs.length}
                    tone="neutral"
                  />
                  <ScanHubStatCell
                    label="Candidates"
                    value={candidates.length}
                    tone={candidates.length > 0 ? "warning" : "neutral"}
                  />
                </div>

                <div className="border-t border-border/40 px-2 py-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] opacity-55">
                      Library folder
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          runAction(
                            "library-folder",
                            onChooseLibraryFolder,
                            (result) =>
                              `Library folder set to ${result.path || defaultGameFolder}.`,
                          )
                        }
                        disabled={busyAction === "library-folder"}
                        className="bg-accent px-2 py-0.5 text-xs text-onAccent hover:brightness-110 disabled:opacity-60"
                      >
                        {busyAction === "library-folder"
                          ? "Saving…"
                          : hasLibraryFolder
                            ? "Change folder"
                            : "Choose folder"}
                      </button>
                      {hasLibraryFolder && (
                        <button
                          type="button"
                          onClick={() => onOpenFolder(defaultGameFolder)}
                          className="bg-secondary px-2 py-0.5 text-xs hover:bg-selected"
                        >
                          Open
                        </button>
                      )}
                    </div>
                  </div>
                  {hasLibraryFolder ? (
                    <>
                      <div className="mt-1 break-all font-mono text-[11px] opacity-80">
                        {defaultGameFolder}
                      </div>
                      <div className="mt-1 text-[10px] leading-snug opacity-50">
                        Profile data stays in the app profile; this path is for
                        installs only.
                      </div>
                    </>
                  ) : (
                    <div className="mt-1 text-xs opacity-60">
                      No default library folder selected.
                    </div>
                  )}
                </div>

                <div className="border-t border-border/40 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] opacity-55">
                    Scan sources
                  </div>
                  {sources.length === 0 ? (
                    <div className="mt-1 text-xs opacity-60">
                      No scan sources configured.
                    </div>
                  ) : (
                    <div className="mt-2 divide-y divide-border/30">
                      {sources.map((source) => (
                        <div
                          key={source.id}
                          className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium text-text">
                                {source.isEnabled ? "Enabled" : "Disabled"}
                              </span>
                              <span
                                className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                                  source.isEnabled
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                                    : "border-border/70 bg-white/5 text-text/70"
                                }`}
                              >
                                {source.isEnabled ? "Active" : "Paused"}
                              </span>
                            </div>
                            <div className="mt-0.5 break-all text-[11px] opacity-65">
                              {source.path}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => onOpenFolder(source.path)}
                              className="bg-secondary px-2 py-0.5 text-xs hover:bg-selected"
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                runAction(
                                  `toggle-source-${source.id}`,
                                  () => onToggleSource(source),
                                  source.isEnabled
                                    ? "Source paused."
                                    : "Source enabled.",
                                )
                              }
                              disabled={
                                busyAction === `toggle-source-${source.id}`
                              }
                              className="bg-secondary px-2 py-0.5 text-xs hover:bg-selected disabled:opacity-60"
                            >
                              {busyAction === `toggle-source-${source.id}`
                                ? "…"
                                : source.isEnabled
                                  ? "Disable"
                                  : "Enable"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                runAction(
                                  `replace-source-${source.id}`,
                                  () => onReplaceSource(source),
                                  "Source path updated.",
                                )
                              }
                              disabled={
                                busyAction === `replace-source-${source.id}`
                              }
                              className="bg-secondary px-2 py-0.5 text-xs hover:bg-selected disabled:opacity-60"
                            >
                              {busyAction === `replace-source-${source.id}`
                                ? "…"
                                : "Replace"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                runAction(
                                  `remove-source-${source.id}`,
                                  () => onRemoveSource(source.id),
                                  "Source removed.",
                                )
                              }
                              disabled={
                                busyAction === `remove-source-${source.id}`
                              }
                              className="bg-red-700/70 px-2 py-0.5 text-xs text-white hover:bg-red-700 disabled:opacity-60"
                            >
                              {busyAction === `remove-source-${source.id}`
                                ? "…"
                                : "Remove"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-border/40 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] opacity-55">
                    Recent jobs
                  </div>
                  {jobs.length === 0 ? (
                    <div className="mt-1 text-xs opacity-60">
                      No scan jobs recorded.
                    </div>
                  ) : (
                    <div className="mt-2 divide-y divide-border/30">
                      {jobs.map((job) => (
                        <div
                          key={job.id}
                          className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0"
                        >
                          <div>
                            <div className="font-medium capitalize text-text">
                              {job.status}
                            </div>
                            <div className="text-[11px] opacity-65">
                              {formatScanHubDate(
                                job.finishedAt || job.startedAt,
                              )}
                            </div>
                          </div>
                          <div className="text-right text-[11px] opacity-70">
                            <div>{job.gamesFound || 0} detected</div>
                            <div>{job.errorsCount || 0} errors</div>
                          </div>
                          {job.notes?.sourcePaths?.length > 0 && (
                            <div className="basis-full space-y-0.5 text-[11px] opacity-60">
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
                    <div className="mt-2 border-t border-border/30 pt-2 text-[10px] opacity-50">
                      Last activity:{" "}
                      {formatScanHubDate(
                        latestJob.finishedAt || latestJob.startedAt,
                      )}
                    </div>
                  )}
                </div>

                <div className="border-t border-border/40 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] opacity-55">
                    Discovery queue
                  </div>
                  {candidates.length === 0 ? (
                    <div className="mt-1 text-xs opacity-60">
                      No scan candidates stored.
                    </div>
                  ) : (
                    <div className="mt-2 divide-y divide-border/30">
                      {candidates.map((candidate) => (
                        <div
                          key={candidate.id}
                          className="py-2 first:pt-0 last:pb-0"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-text">
                                {candidate.title}
                              </div>
                              <div className="text-xs opacity-70">
                                {candidate.creator || "Unknown creator"}
                              </div>
                              <div className="mt-0.5 text-[11px] opacity-60">
                                {candidate.engine || "Unknown engine"} · v
                                {candidate.version || "?"} ·{" "}
                                {candidate.detectionScore || 0}%
                              </div>
                              <div className="mt-1 break-all text-[11px] opacity-55">
                                {candidate.folderPath}
                              </div>
                              {candidate.detectionReasons?.length > 0 && (
                                <div className="mt-1 text-[11px] opacity-55">
                                  {candidate.detectionReasons
                                    .slice(0, 3)
                                    .join(" · ")}
                                </div>
                              )}
                            </div>
                            <div className="shrink-0 text-right text-[11px] opacity-70">
                              <div className="capitalize">{candidate.status}</div>
                              <div>
                                {formatScanHubDate(candidate.lastSeenAt)}
                              </div>
                            </div>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                onOpenFolder(candidate.folderPath)
                              }
                              className="bg-secondary px-2 py-0.5 text-xs hover:bg-selected"
                            >
                              Open folder
                            </button>
                            {candidate.libraryRecordId && (
                              <span className="text-[11px] opacity-50">
                                #{candidate.libraryRecordId}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

window.ScanHubPanel = ScanHubPanel;
