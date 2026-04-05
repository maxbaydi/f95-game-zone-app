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

const { getCloudSyncMessageIfPresent: sharedGetCloudSyncMessageIfPresent } =
  window.cloudSyncErrors || {};
const getCloudSyncMessageIfPresent =
  sharedGetCloudSyncMessageIfPresent ||
  ((error) => String(error?.message || error || "").trim());

const SaveSyncPill = ({ children, tone = "neutral" }) => {
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

const getProfileLabel = (profile) => {
  if (profile?.provider === "renpy_appdata") {
    return "Ren'Py save data";
  }

  if (profile?.provider === "unity_locallow") {
    return "Unity save data";
  }

  if (profile?.provider === "unreal_localappdata") {
    return "Unreal save data";
  }

  if (profile?.provider === "godot_appdata") {
    return "Godot save data";
  }

  if (profile?.provider === "html_appdata") {
    return "HTML app storage";
  }

  if (profile?.strategy?.type === "windows-known-folder") {
    return "App data saves";
  }

  if (profile?.strategy?.type === "install-relative") {
    return "Game folder saves";
  }

  if (profile?.strategy?.type === "install-file-patterns") {
    return "Game save files";
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

  if (syncStatus === "synced") {
    return "Synced";
  }

  if (syncStatus === "conflict") {
    return "Review needed";
  }

  if (syncStatus === "error") {
    return "Needs attention";
  }

  return "Ready";
};

const LibrarySaveSyncPanel = ({ game, onOpenCloudAuth }) => {
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
  const userFacingError =
    errorMessage ||
    getCloudSyncMessageIfPresent(syncState?.lastError || authState.error, {
      action: "upload",
    });

  return (
    <section className="border border-border bg-secondary/10 p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] opacity-55">
            Cloud Saves
          </div>
          <div className="mt-1 text-xs leading-snug text-text/75">
            Scan folders, back up to cloud, restore when needed.
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenCloudAuth?.()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-secondary text-text hover:bg-selected"
          title={authState.authenticated ? "Manage account" : "Sign in"}
          aria-label={authState.authenticated ? "Manage account" : "Sign in"}
        >
          <span className="material-symbols-outlined text-[20px] leading-none">
            {authState.authenticated
              ? "manage_accounts"
              : authState.configured
                ? "login"
                : "cloud_off"}
          </span>
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm opacity-60">Loading cloud save status...</div>
      ) : (
        <div className="space-y-3">
          <div className="border border-border/70 bg-canvas/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <SaveSyncPill tone="accent">
                {profiles.length} save{" "}
                {profiles.length === 1 ? "location" : "locations"} found
              </SaveSyncPill>
              <SaveSyncPill>
                {authState.authenticated
                  ? "Signed in"
                  : authState.configured
                    ? "Sign in required"
                    : "Cloud unavailable"}
              </SaveSyncPill>
              <SaveSyncPill
                tone={
                  syncState?.syncStatus === "error" ||
                  syncState?.syncStatus === "conflict"
                    ? "warning"
                    : "neutral"
                }
              >
                {getSyncStatusLabel(syncState?.syncStatus)}
              </SaveSyncPill>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] opacity-75">
              <div>
                Last backup: {formatSyncDate(syncState?.lastUploadedAt)}
              </div>
              <div>
                Last restore: {formatSyncDate(syncState?.lastDownloadedAt)}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  handleAction("refresh", () =>
                    window.electronAPI.refreshSaveProfiles(game.record_id),
                  )
                }
                className="inline-flex h-8 w-8 items-center justify-center border border-border bg-secondary text-text hover:bg-selected disabled:opacity-60"
                disabled={busyAction !== ""}
                title={
                  busyAction === "refresh" ? "Scanning…" : "Find save files"
                }
                aria-label={
                  busyAction === "refresh" ? "Scanning" : "Find save files"
                }
              >
                <span
                  className={`material-symbols-outlined text-[20px] leading-none ${busyAction === "refresh" ? "animate-spin" : ""}`}
                >
                  {busyAction === "refresh" ? "progress_activity" : "search"}
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleAction("upload", () =>
                    window.electronAPI.uploadCloudSaves(game.record_id),
                  )
                }
                className="inline-flex h-8 w-8 items-center justify-center border border-accent/50 bg-accent text-text hover:bg-selected disabled:opacity-60"
                disabled={
                  busyAction !== "" ||
                  !authState.authenticated ||
                  profiles.length === 0
                }
                title={busyAction === "upload" ? "Backing up…" : "Back up now"}
                aria-label={
                  busyAction === "upload" ? "Backing up" : "Back up now"
                }
              >
                <span
                  className={`material-symbols-outlined text-[20px] leading-none ${busyAction === "upload" ? "animate-spin" : ""}`}
                >
                  {busyAction === "upload"
                    ? "progress_activity"
                    : "cloud_upload"}
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleAction("restore", () =>
                    window.electronAPI.restoreCloudSaves(game.record_id),
                  )
                }
                className="inline-flex h-8 w-8 items-center justify-center border border-border bg-secondary text-text hover:bg-selected disabled:opacity-60"
                disabled={
                  busyAction !== "" ||
                  !authState.authenticated ||
                  !hasRemoteArchive
                }
                title={
                  busyAction === "restore" ? "Restoring…" : "Restore backup"
                }
                aria-label={
                  busyAction === "restore" ? "Restoring" : "Restore backup"
                }
              >
                <span
                  className={`material-symbols-outlined text-[20px] leading-none ${busyAction === "restore" ? "animate-spin" : ""}`}
                >
                  {busyAction === "restore"
                    ? "progress_activity"
                    : "cloud_download"}
                </span>
              </button>
            </div>

            {profiles.length === 0 ? (
              <div className="mt-3 border-t border-border/40 pt-3 text-xs opacity-60">
                No save locations yet — engine-specific save paths are scanned
                automatically.
              </div>
            ) : (
              <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
                {profiles.map((profile) => (
                  <div
                    key={`${profile.rootPath}-${profile.strategy?.type}`}
                    className="text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-text/90">
                        {getProfileLabel(profile)}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.1em] text-text/45">
                        auto
                      </span>
                    </div>
                    <div className="mt-0.5 break-all opacity-70">
                      {profile.rootPath}
                    </div>
                    {Array.isArray(profile.reasons) &&
                      profile.reasons.length > 0 && (
                        <div className="mt-1 text-[11px] opacity-55">
                          {profile.reasons.join(" · ")}
                        </div>
                      )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {(message || userFacingError) && (
            <div
              className={`border p-2 text-sm ${
                userFacingError
                  ? "border-red-500/40 bg-red-500/10 text-red-200"
                  : "border-green-500/30 bg-green-500/10 text-green-100"
              }`}
            >
              {userFacingError || message}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

window.LibrarySaveSyncPanel = LibrarySaveSyncPanel;
