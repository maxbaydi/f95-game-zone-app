const formatSyncDate = (value) => {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Never";
  }

  return date.toLocaleString();
};

const SaveSyncPill = ({ children, tone = "neutral" }) => {
  const toneClass =
    tone === "accent"
      ? "border-accent/45 bg-accent/25 text-text shadow-glow-accent"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/15 text-amber-50"
        : "border-border/85 bg-white/5 text-text backdrop-blur-sm";

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] ${toneClass}`}
    >
      {children}
    </span>
  );
};

const getProfileLabel = (profile) => {
  if (profile?.strategy?.type === "renpy-appdata") {
    return "Ren'Py save data";
  }

  if (profile?.strategy?.type === "install-relative") {
    return "Game folder saves";
  }

  return "Detected save location";
};

const getSyncStatusLabel = (syncStatus) => {
  if (syncStatus === "uploaded") {
    return "Backed up";
  }

  if (syncStatus === "restored") {
    return "Restored";
  }

  if (syncStatus === "error") {
    return "Needs attention";
  }

  return "Ready";
};

const LibrarySaveSyncPanel = ({ game }) => {
  const [snapshot, setSnapshot] = window.React.useState(null);
  const [authState, setAuthState] = window.React.useState({
    configured: false,
    authenticated: false,
    user: null,
    error: "",
    settings: {},
  });
  const [isLoading, setIsLoading] = window.React.useState(true);
  const [busyAction, setBusyAction] = window.React.useState("");
  const [message, setMessage] = window.React.useState("");
  const [errorMessage, setErrorMessage] = window.React.useState("");

  const loadPanelState = window.React.useCallback(
    async (refreshProfiles = false) => {
      if (!game?.record_id) {
        setSnapshot(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage("");

      try {
        const [snapshotResult, authResult] = await Promise.all([
          refreshProfiles
            ? window.electronAPI.refreshSaveProfiles(game.record_id)
            : window.electronAPI.getSaveProfileSnapshot(game.record_id),
          window.electronAPI.getCloudAuthState(),
        ]);

        if (!snapshotResult?.success) {
          setErrorMessage(
            snapshotResult?.error || "Failed to load local save profiles.",
          );
          setSnapshot(null);
        } else {
          setSnapshot(snapshotResult.snapshot);
        }

        if (authResult?.success && authResult.state) {
          setAuthState(authResult.state);
        } else {
          setAuthState({
            configured: false,
            authenticated: false,
            user: null,
            error: authResult?.error || "",
            settings: {},
          });
        }
      } catch (error) {
        console.error("Failed to load save sync panel state:", error);
        setErrorMessage(error.message || "Failed to load save sync state.");
      } finally {
        setIsLoading(false);
      }
    },
    [game?.record_id],
  );

  window.React.useEffect(() => {
    loadPanelState(false);

    const unsubscribe = window.electronAPI.onCloudAuthChanged((state) => {
      setAuthState(state || {});
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [loadPanelState]);

  const handleAction = async (actionName, action) => {
    setBusyAction(actionName);
    setMessage("");
    setErrorMessage("");

    try {
      const result = await action();
      if (!result?.success) {
        setErrorMessage(result?.error || "Cloud save action failed.");
        return;
      }

      if (actionName === "upload") {
        setMessage("Your saves were backed up.");
      } else if (actionName === "restore") {
        setMessage("Your latest backup was restored.");
      } else {
        setMessage("Save files were scanned again.");
      }

      await loadPanelState(false);
    } catch (error) {
      console.error("Cloud save action failed:", error);
      setErrorMessage(error.message || "Cloud save action failed.");
    } finally {
      setBusyAction("");
    }
  };

  const profiles = snapshot?.profiles || [];
  const syncState = snapshot?.syncState || null;
  const hasRemoteArchive = Boolean(syncState?.lastRemotePath);

  return (
    <section className="rounded-2xl border border-border bg-secondary/10 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] opacity-55">
            Cloud Saves
          </div>
          <div className="mt-1 text-sm text-text/85">
            Find save files for this game, back them up, and restore them when needed.
          </div>
        </div>
        <button
          onClick={() => window.electronAPI.openSettings()}
          className="rounded bg-secondary px-3 py-2 text-sm hover:bg-selected"
        >
          {authState.authenticated ? "Manage Account" : "Sign In"}
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm opacity-60">Loading cloud save status...</div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-canvas/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <SaveSyncPill tone="accent">
                {profiles.length} save {profiles.length === 1 ? "location" : "locations"} found
              </SaveSyncPill>
              <SaveSyncPill>
                {authState.authenticated
                  ? "Signed in"
                  : authState.configured
                    ? "Sign in required"
                    : "Cloud unavailable"}
              </SaveSyncPill>
              <SaveSyncPill
                tone={syncState?.syncStatus === "error" ? "warning" : "neutral"}
              >
                {getSyncStatusLabel(syncState?.syncStatus)}
              </SaveSyncPill>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 text-xs opacity-75">
              <div>Last backup: {formatSyncDate(syncState?.lastUploadedAt)}</div>
              <div>Last restore: {formatSyncDate(syncState?.lastDownloadedAt)}</div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() =>
                  handleAction("refresh", () =>
                    window.electronAPI.refreshSaveProfiles(game.record_id),
                  )
                }
                className="rounded bg-secondary px-3 py-2 text-sm hover:bg-selected disabled:opacity-60"
                disabled={busyAction !== ""}
              >
                {busyAction === "refresh" ? "Scanning..." : "Find Save Files"}
              </button>
              <button
                onClick={() =>
                  handleAction("upload", () =>
                    window.electronAPI.uploadCloudSaves(game.record_id),
                  )
                }
                className="rounded bg-accent px-3 py-2 text-sm text-text hover:bg-selected disabled:opacity-60"
                disabled={
                  busyAction !== "" ||
                  !authState.authenticated ||
                  profiles.length === 0
                }
              >
                {busyAction === "upload" ? "Backing Up..." : "Back Up Now"}
              </button>
              <button
                onClick={() =>
                  handleAction("restore", () =>
                    window.electronAPI.restoreCloudSaves(game.record_id),
                  )
                }
                className="rounded bg-secondary px-3 py-2 text-sm hover:bg-selected disabled:opacity-60"
                disabled={
                  busyAction !== "" ||
                  !authState.authenticated ||
                  !hasRemoteArchive
                }
              >
                {busyAction === "restore" ? "Restoring..." : "Restore Backup"}
              </button>
            </div>
          </div>

          {profiles.length === 0 ? (
            <div className="text-sm opacity-60">
              No save files were found yet. The app checks the game folder and common
              Ren&apos;Py save locations automatically.
            </div>
          ) : (
            <div className="space-y-2">
              {profiles.map((profile) => (
                <div
                  key={`${profile.rootPath}-${profile.strategy?.type}`}
                  className="rounded-xl border border-border/70 bg-canvas/40 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <SaveSyncPill>{getProfileLabel(profile)}</SaveSyncPill>
                    <SaveSyncPill>Auto-detected</SaveSyncPill>
                  </div>
                  <div className="mt-2 break-all text-xs opacity-70">
                    {profile.rootPath}
                  </div>
                  {Array.isArray(profile.reasons) && profile.reasons.length > 0 && (
                    <div className="mt-2 text-xs opacity-60">
                      {profile.reasons.join(" | ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {(message || errorMessage || syncState?.lastError || authState.error) && (
            <div
              className={`rounded border p-3 text-sm ${
                errorMessage || syncState?.lastError || authState.error
                  ? "border-red-500/40 bg-red-500/10 text-red-200"
                  : "border-green-500/30 bg-green-500/10 text-green-100"
              }`}
            >
              {errorMessage || syncState?.lastError || authState.error || message}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

window.LibrarySaveSyncPanel = LibrarySaveSyncPanel;
