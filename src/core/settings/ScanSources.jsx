const ScanSources = () => {
  const [sources, setSources] = React.useState([]);
  const [jobs, setJobs] = React.useState([]);
  const [candidates, setCandidates] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState("");

  const loadSources = async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const result = await window.electronAPI.getScanSources();

      if (!result.success) {
        setErrorMessage(result.error?.message || "Failed to load scan sources");
        setSources([]);
        return;
      }

      setSources(result.sources || []);

      const jobsResult = await window.electronAPI.getScanJobs(5);
      if (jobsResult.success) {
        setJobs(jobsResult.jobs || []);
      }

      const candidatesResult = await window.electronAPI.getScanCandidates(8);
      if (candidatesResult.success) {
        setCandidates(candidatesResult.candidates || []);
      }
    } catch (error) {
      console.error("Failed to load scan sources:", error);
      setErrorMessage("Failed to load scan sources");
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    loadSources();
  }, []);

  const handleAddSource = async () => {
    const selectedPath = await window.electronAPI.selectDirectory();
    if (!selectedPath) return;

    const result = await window.electronAPI.addScanSource(selectedPath);
    if (!result.success) {
      setErrorMessage(result.error?.message || "Failed to add scan source");
      return;
    }

    setErrorMessage("");
    setSources((previous) => [...previous, result.source]);
  };

  const handleToggleSource = async (source) => {
    const result = await window.electronAPI.updateScanSource({
      id: source.id,
      isEnabled: !source.isEnabled,
    });

    if (!result.success) {
      setErrorMessage(result.error?.message || "Failed to update scan source");
      return;
    }

    setErrorMessage("");
    setSources((previous) =>
      previous.map((item) => (item.id === source.id ? result.source : item)),
    );
  };

  const handleReplaceSource = async (source) => {
    const selectedPath = await window.electronAPI.selectDirectory();
    if (!selectedPath) return;

    const result = await window.electronAPI.updateScanSource({
      id: source.id,
      path: selectedPath,
    });

    if (!result.success) {
      setErrorMessage(result.error?.message || "Failed to update scan source");
      return;
    }

    setErrorMessage("");
    setSources((previous) =>
      previous.map((item) => (item.id === source.id ? result.source : item)),
    );
  };

  const handleRemoveSource = async (sourceId) => {
    const result = await window.electronAPI.removeScanSource(sourceId);

    if (!result.success) {
      setErrorMessage(result.error?.message || "Failed to remove scan source");
      return;
    }

    setErrorMessage("");
    setSources((previous) => previous.filter((item) => item.id !== sourceId));
  };

  return (
    <div className="p-5 text-text">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Scan Sources</h3>
          <p className="text-xs opacity-60 mt-1">
            Root folders that the app will use for recursive game discovery.
          </p>
        </div>
        <button
          className="bg-accent text-text px-4 py-2 rounded hover:bg-hover"
          onClick={handleAddSource}
        >
          Add Source
        </button>
      </div>

      {errorMessage && (
        <div className="mb-4 border border-red-500/40 bg-red-500/10 text-red-200 rounded p-3">
          {errorMessage}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm opacity-70">Loading scan sources...</div>
      ) : sources.length === 0 ? (
        <div className="border border-border rounded p-4 bg-primary/40">
          <div className="font-medium">No scan sources configured</div>
          <p className="text-xs opacity-60 mt-2">
            Add at least one root folder before wiring the recursive scanner to
            this model.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => (
            <div
              key={source.id}
              className="border border-border rounded p-4 bg-primary/40"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="font-medium break-all">{source.path}</div>
                  <div className="text-xs opacity-60 mt-2">
                    Added: {new Date(source.createdAt).toLocaleString()}
                  </div>
                  <div className="text-xs opacity-60 mt-1">
                    Updated: {new Date(source.updatedAt).toLocaleString()}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className={`px-3 py-1 rounded ${source.isEnabled ? "bg-green-700/60 hover:bg-green-700" : "bg-secondary hover:bg-selected"}`}
                    onClick={() => handleToggleSource(source)}
                  >
                    {source.isEnabled ? "Enabled" : "Disabled"}
                  </button>
                  <button
                    className="px-3 py-1 rounded bg-secondary hover:bg-selected"
                    onClick={() => handleReplaceSource(source)}
                  >
                    Replace
                  </button>
                  <button
                    className="px-3 py-1 rounded bg-red-700/60 hover:bg-red-700"
                    onClick={() => handleRemoveSource(source.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6">
        <h4 className="text-md font-semibold mb-2">Recent Scan Jobs</h4>
        {jobs.length === 0 ? (
          <div className="text-xs opacity-60">No scan jobs recorded yet.</div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="border border-border rounded p-3 bg-primary/30"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium">
                      {job.mode} / {job.status}
                    </div>
                    <div className="text-xs opacity-60 mt-1">
                      Sources: {job.sourceCount} | Games: {job.gamesFound} |
                      Errors: {job.errorsCount}
                      {job.notes?.warningsCount
                        ? ` | Warnings: ${job.notes.warningsCount}`
                        : ""}
                    </div>
                    {Array.isArray(job.notes?.diagnosticsSample) &&
                      job.notes.diagnosticsSample.length > 0 && (
                        <div className="text-xs opacity-60 mt-1 break-all">
                          Last issue: {job.notes.diagnosticsSample[0].message}
                        </div>
                      )}
                  </div>
                  <div className="text-xs opacity-60 text-right">
                    <div>{new Date(job.startedAt).toLocaleString()}</div>
                    {job.finishedAt && (
                      <div>
                        done: {new Date(job.finishedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        <h4 className="text-md font-semibold mb-2">
          Recent Detected Candidates
        </h4>
        {candidates.length === 0 ? (
          <div className="text-xs opacity-60">
            No persisted scan candidates yet.
          </div>
        ) : (
          <div className="space-y-2">
            {candidates.map((candidate) => (
              <div
                key={candidate.id}
                className="border border-border rounded p-3 bg-primary/30"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {candidate.title} / {candidate.creator}
                    </div>
                    <div className="text-xs opacity-60 mt-1 break-all">
                      {candidate.folderPath}
                    </div>
                    <div className="text-xs opacity-60 mt-1">
                      Engine: {candidate.engine || "Unknown"} | Version:{" "}
                      {candidate.version || "Unknown"} | Confidence:{" "}
                      {candidate.detectionScore || 0}%
                    </div>
                    {candidate.detectionReasons?.length > 0 && (
                      <div className="text-xs opacity-60 mt-1 break-words">
                        {candidate.detectionReasons.join(" | ")}
                      </div>
                    )}
                  </div>
                  <div className="text-xs opacity-60 text-right shrink-0">
                    <div>Status: {candidate.status}</div>
                    <div>{new Date(candidate.lastSeenAt).toLocaleString()}</div>
                    {candidate.importedAt && (
                      <div>
                        imported:{" "}
                        {new Date(candidate.importedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

window.ScanSources = ScanSources;
