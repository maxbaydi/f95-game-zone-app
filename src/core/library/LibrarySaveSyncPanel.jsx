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
      className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] ${toneClass}`}
    >
      {children}
    </span>
  );
};

const SAVE_PROVIDER_LABELS = {
  renpy_appdata: "Ren'Py save data",
  unity_locallow: "Unity save data",
  unreal_localappdata: "Unreal save data",
  godot_appdata: "Godot save data",
  html_appdata: "HTML app storage",
  flash_sharedobjects: "Flash shared objects",
  gamemaker_localappdata: "GameMaker save data",
  documents: "Documents saves",
  saved_games: "Saved Games folder",
};

const getProfileLabel = (profile) => {
  if (profile?.provider && SAVE_PROVIDER_LABELS[profile.provider]) {
    return SAVE_PROVIDER_LABELS[profile.provider];
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

const SaveActionButton = ({
  icon,
  label,
  busyLabel,
  busy,
  disabled,
  onClick,
  primary,
  title,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex items-center gap-1 border px-2 py-1 text-xs transition disabled:opacity-60 ${
      primary
        ? "border-accent/50 bg-accent text-onAccent hover:brightness-110"
        : "border-border bg-secondary text-text hover:bg-selected"
    }`}
    title={title || label}
  >
    <span
      className={`material-symbols-outlined text-[16px] leading-none ${busy ? "animate-spin" : ""}`}
      aria-hidden
    >
      {busy ? "progress_activity" : icon}
    </span>
    {busy ? busyLabel || label : label}
  </button>
);

const LibrarySaveSyncPanel = ({ game, onOpenSaveStorage }) => {
  const storage = window.useSaveStorageState
    ? window.useSaveStorageState()
    : { state: null, refresh: () => Promise.resolve(null) };
  const storageState = storage.state;
  const storageReady = Boolean(storageState?.connected && !storageState?.locked);
  const [snapshot, setSnapshot] = window.React.useState(null);
  const [isLoading, setIsLoading] = window.React.useState(true);
  const [busyAction, setBusyAction] = window.React.useState("");
  const [message, setMessage] = window.React.useState("");
  const [errorMessage, setErrorMessage] = window.React.useState("");
  const [importPassword, setImportPassword] = window.React.useState("");
  const [needsImportPassword, setNeedsImportPassword] =
    window.React.useState(false);

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
        const snapshotResult = refreshProfiles
          ? await window.electronAPI.refreshSaveProfiles(game.record_id)
          : await window.electronAPI.getSaveProfileSnapshot(game.record_id);

        if (!snapshotResult?.success) {
          setErrorMessage(
            snapshotResult?.error || "Failed to load local save profiles.",
          );
          setSnapshot(null);
        } else {
          setSnapshot(snapshotResult.snapshot);
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
  }, [loadPanelState]);

  const callApi = async (method, ...args) => {
    const api = window.electronAPI;
    if (!api || typeof api[method] !== "function") {
      throw new Error("This action needs a newer F95Launcher build.");
    }
    return api[method](...args);
  };

  const describeImportResult = (result) => {
    const parts = [`${result.importedFiles} file(s) imported`];
    if (result.skippedFiles > 0) {
      parts.push(`${result.skippedFiles} skipped`);
    }
    if (result.backedUpPaths?.length) {
      parts.push("previous saves backed up to the local vault");
    }
    const destinations = (result.destinations || [])
      .map((entry) => entry.rootPath)
      .filter(Boolean);
    return `${parts.join(", ")}${destinations.length ? ` → ${destinations.join(", ")}` : ""}.`;
  };

  const handleAction = async (actionName, action) => {
    setBusyAction(actionName);
    setMessage("");
    setErrorMessage("");

    try {
      const result = await action();
      if (result?.cancelled) {
        return;
      }
      if (!result?.success) {
        if (actionName === "import" && result?.needsPassword) {
          setNeedsImportPassword(true);
        }
        setErrorMessage(result?.error || "Save action failed.");
        return;
      }

      if (actionName === "upload") {
        setMessage(
          storageReady
            ? `Your saves were backed up to ${storageState.label || "your storage"}.`
            : "Your saves were backed up to the cloud.",
        );
      } else if (actionName === "restore") {
        setMessage(
          storageReady
            ? `${result.result?.importedFiles ?? ""} file(s) restored from ${storageState.label || "your storage"}.`.trim()
            : "Your latest cloud backup was restored.",
        );
      } else if (actionName === "export") {
        setMessage(
          `${result.fileCount} save file(s) exported to ${result.archivePath}.`,
        );
      } else if (actionName === "import") {
        setNeedsImportPassword(false);
        setImportPassword("");
        setMessage(describeImportResult(result));
      } else if (actionName === "open") {
        return;
      } else {
        setMessage("Save files were scanned again.");
      }

      await loadPanelState(false);
    } catch (error) {
      console.error("Save action failed:", error);
      setErrorMessage(error.message || "Save action failed.");
    } finally {
      setBusyAction("");
    }
  };

  const profiles = snapshot?.profiles || [];
  const syncState = snapshot?.syncState || null;
  const storageLabel = storageState?.label || "your storage";
  const userFacingError =
    errorMessage || String(syncState?.lastError || "").trim();

  return (
    <section className="border border-border bg-secondary/10 p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] opacity-55">
            Saves
          </div>
          <div className="mt-1 text-xs leading-snug text-text/75">
            Export and import save files, or keep them in the cloud. Cloud sync
            is optional: everything else works without an account.
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenSaveStorage?.()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-secondary text-text hover:bg-selected"
          title={storageReady ? `Save storage: ${storageState.description || storageLabel}` : "Set up save storage"}
          aria-label={storageReady ? "Save storage settings" : "Set up save storage"}
        >
          <span className="material-symbols-outlined text-[20px] leading-none">
            {storageReady ? "cloud_done" : storageState?.locked ? "lock" : "cloud_off"}
          </span>
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm opacity-60">Loading save locations...</div>
      ) : (
        <div className="space-y-3">
          <div className="border border-border/70 bg-canvas/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <SaveSyncPill tone="accent">
                {profiles.length} save{" "}
                {profiles.length === 1 ? "location" : "locations"} found
              </SaveSyncPill>
              <SaveSyncPill tone={storageReady ? "accent" : "neutral"}>
                {storageReady
                  ? `Cloud: ${storageLabel}`
                  : storageState?.locked
                    ? "Cloud: locked"
                    : "Cloud: off"}
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

            <div className="mt-3 text-[10px] uppercase tracking-[0.18em] opacity-55">
              Files
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <SaveActionButton
                icon="search"
                label="Find save files"
                busyLabel="Scanning…"
                busy={busyAction === "refresh"}
                disabled={busyAction !== ""}
                onClick={() =>
                  handleAction("refresh", () =>
                    callApi("refreshSaveProfiles", game.record_id),
                  )
                }
              />
              <SaveActionButton
                icon="file_download"
                label="Export to file"
                busyLabel="Exporting…"
                busy={busyAction === "export"}
                disabled={busyAction !== "" || profiles.length === 0}
                primary
                title="Pack every detected save file into a zip you can keep or move to another PC"
                onClick={() =>
                  handleAction("export", () =>
                    callApi("exportGameSaves", game.record_id),
                  )
                }
              />
              <SaveActionButton
                icon="file_upload"
                label="Import from file"
                busyLabel="Importing…"
                busy={busyAction === "import"}
                disabled={busyAction !== ""}
                title="Restore saves from a zip made by F95Launcher or any archive of a saves folder. Current saves are backed up first."
                onClick={() =>
                  handleAction("import", () =>
                    callApi("importGameSaves", game.record_id, {
                      password: importPassword.trim(),
                    }),
                  )
                }
              />
            </div>
            {needsImportPassword && (
              <form
                className="mt-2 flex flex-wrap items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleAction("import", () =>
                    callApi("importGameSaves", game.record_id, {
                      password: importPassword.trim(),
                    }),
                  );
                }}
              >
                <input
                  type="text"
                  value={importPassword}
                  onChange={(event) => setImportPassword(event.target.value)}
                  placeholder="Archive password"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-[160px] flex-1 border border-border bg-black/30 px-2 py-1 text-xs text-text outline-none focus:border-accent/60"
                  aria-label="Archive password"
                />
                <SaveActionButton
                  icon="lock_open"
                  label="Import with password"
                  busy={busyAction === "import"}
                  disabled={busyAction !== "" || !importPassword.trim()}
                  onClick={() =>
                    handleAction("import", () =>
                      callApi("importGameSaves", game.record_id, {
                        password: importPassword.trim(),
                      }),
                    )
                  }
                />
              </form>
            )}

            <div className="mt-3 text-[10px] uppercase tracking-[0.18em] opacity-55">
              {storageReady ? `Cloud · ${storageLabel}` : "Cloud (optional)"}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {storageReady ? (
                <>
                  <SaveActionButton
                    icon="cloud_upload"
                    label={`Back up to ${storageLabel}`}
                    busyLabel="Backing up…"
                    busy={busyAction === "upload"}
                    disabled={busyAction !== "" || profiles.length === 0}
                    title="Pack the current saves and put them in your storage"
                    onClick={() =>
                      handleAction("upload", () =>
                        callApi("syncSaveStorageGame", game.record_id, "upload"),
                      )
                    }
                  />
                  <SaveActionButton
                    icon="cloud_download"
                    label={`Restore from ${storageLabel}`}
                    busyLabel="Restoring…"
                    busy={busyAction === "restore"}
                    disabled={busyAction !== ""}
                    title="Bring the backup from your storage onto this PC (current saves go to the local vault first)"
                    onClick={() =>
                      handleAction("restore", () =>
                        callApi("syncSaveStorageGame", game.record_id, "restore"),
                      )
                    }
                  />
                </>
              ) : (
                <SaveActionButton
                  icon={storageState?.locked ? "lock_open" : "add_link"}
                  label={storageState?.locked ? "Unlock save storage" : "Connect your cloud"}
                  disabled={busyAction !== ""}
                  title="OneDrive, Dropbox, Google Drive, a WebDAV server, an S3 bucket or your own Supabase project. Set up once, works on every PC."
                  onClick={() => onOpenSaveStorage?.()}
                />
              )}
              <span className="text-[11px] opacity-60">
                Last backup: {formatSyncDate(syncState?.lastUploadedAt)} · Last
                restore: {formatSyncDate(syncState?.lastDownloadedAt)}
              </span>
            </div>

            {profiles.length === 0 ? (
              <div className="mt-3 border-t border-border/40 pt-3 text-xs opacity-60">
                No save locations yet — engine-specific save paths (game
                folder, AppData, Documents, Saved Games) are scanned
                automatically. You can still import a save archive: it goes to
                the engine's default folder.
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
                      <button
                        type="button"
                        className="ml-auto inline-flex items-center gap-1 border border-border bg-secondary px-1.5 py-0.5 text-[11px] text-text hover:bg-selected disabled:opacity-60"
                        disabled={busyAction !== ""}
                        title="Open this folder"
                        onClick={() =>
                          handleAction("open", () =>
                            callApi(
                              "openSaveLocation",
                              game.record_id,
                              profile.rootPath,
                            ),
                          )
                        }
                      >
                        <span
                          className="material-symbols-outlined text-[14px] leading-none"
                          aria-hidden
                        >
                          folder_open
                        </span>
                        Open
                      </button>
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
