const { useCallback, useEffect, useMemo, useState } = window.React;

const createCloudAuthPanelDefaultState = () => ({
  configured: false,
  authenticated: false,
  user: null,
  error: "",
  settings: {},
});

const createCloudBulkProgressState = () => ({
  active: false,
  mode: "",
  completed: 0,
  total: 0,
  currentTitle: "",
  summary: null,
});

const createCloudLibraryCatalogState = () => ({
  localEntries: [],
  remoteEntries: [],
  mergedEntries: [],
  remoteOnlyEntries: [],
  remoteExists: false,
  lastUpdatedAt: "",
  materialized: null,
});

const getCloudAuthPanelErrorMessage = (error, fallbackMessage) => {
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
};

const formatCloudPanelDate = (value) => {
  if (!value) {
    return "Never";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Never";
  }

  return parsed.toLocaleString();
};

const getBulkSummaryMessage = (summary) => {
  if (!summary) {
    return "";
  }

  const parts = [];
  if (summary.uploaded) {
    parts.push(`${summary.uploaded} uploaded`);
  }
  if (summary.restored) {
    parts.push(`${summary.restored} restored`);
  }
  if (summary.synced) {
    parts.push(`${summary.synced} already synced`);
  }
  if (summary.conflicts) {
    parts.push(`${summary.conflicts} conflicts`);
  }
  if (summary.skipped) {
    parts.push(`${summary.skipped} skipped`);
  }
  if (summary.failed) {
    parts.push(`${summary.failed} failed`);
  }

  return parts.join(" · ");
};

const CloudAuthFeatureCard = ({ title, description }) => (
  <div className="border border-border bg-black/15 p-3 text-sm">
    <div className="font-medium">{title}</div>
    <div className="mt-1 text-xs opacity-60">{description}</div>
  </div>
);

const CloudAuthPanelContent = ({ onClose }) => {
  const { getCloudSyncMessageIfPresent: sharedGetCloudSyncMessageIfPresent } =
    window.cloudSyncErrors || {};
  const getCloudSyncMessageIfPresent =
    sharedGetCloudSyncMessageIfPresent ||
    ((error) => String(error?.message || error || "").trim());
  const [authMode, setAuthMode] = useState("sign-in");
  const [authState, setAuthState] = useState(
    createCloudAuthPanelDefaultState(),
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(
    createCloudBulkProgressState(),
  );
  const [catalogState, setCatalogState] = useState(
    createCloudLibraryCatalogState(),
  );
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [catalogBusyAction, setCatalogBusyAction] = useState("");
  const userFacingError =
    errorMessage ||
    getCloudSyncMessageIfPresent(authState.error, {
      action: "upload",
    });

  const loadState = useCallback(async () => {
    try {
      const authResult = await window.electronAPI.getCloudAuthState();

      if (authResult?.success && authResult.state) {
        setAuthState(authResult.state);
        return;
      }

      setAuthState({
        ...createCloudAuthPanelDefaultState(),
        error: getCloudAuthPanelErrorMessage(authResult?.error, ""),
      });
    } catch (error) {
      console.error("Failed to load cloud auth state:", error);
      setErrorMessage("Failed to load cloud save access.");
    }
  }, []);

  const loadCatalog = useCallback(
    async (mode = "read") => {
      if (!authState.authenticated) {
        setCatalogState(createCloudLibraryCatalogState());
        return;
      }

      setIsCatalogLoading(true);

      try {
        const initialResult =
          mode === "sync"
            ? await window.electronAPI.syncCloudLibraryCatalog()
            : await window.electronAPI.getCloudLibraryCatalog();

        if (!initialResult?.success || !initialResult?.result) {
          setErrorMessage(
            getCloudAuthPanelErrorMessage(
              initialResult?.error,
              "Failed to load your cloud library.",
            ),
          );
          return;
        }

        const finalResult =
          mode === "sync"
            ? await window.electronAPI.getCloudLibraryCatalog()
            : initialResult;

        if (!finalResult?.success || !finalResult?.result) {
          setErrorMessage(
            getCloudAuthPanelErrorMessage(
              finalResult?.error,
              "Failed to load your cloud library.",
            ),
          );
          return;
        }

        setCatalogState({
          ...createCloudLibraryCatalogState(),
          ...finalResult.result,
          materialized: initialResult.result?.materialized || null,
        });
      } catch (error) {
        console.error("Failed to load cloud library catalog:", error);
        setErrorMessage(
          getCloudAuthPanelErrorMessage(
            error,
            "Failed to load your cloud library.",
          ),
        );
      } finally {
        setIsCatalogLoading(false);
      }
    },
    [authState.authenticated],
  );

  useEffect(() => {
    loadState();

    const unsubscribeAuth = window.electronAPI.onCloudAuthChanged((state) => {
      setAuthState(state || createCloudAuthPanelDefaultState());
    });
    const unsubscribeBulk = window.electronAPI.onCloudBulkProgress((payload) => {
      setBulkProgress(payload || createCloudBulkProgressState());
    });

    return () => {
      if (typeof unsubscribeAuth === "function") {
        unsubscribeAuth();
      }
      if (typeof unsubscribeBulk === "function") {
        unsubscribeBulk();
      }
    };
  }, [loadState]);

  useEffect(() => {
    if (!authState.authenticated) {
      setCatalogState(createCloudLibraryCatalogState());
      setBulkProgress(createCloudBulkProgressState());
      return;
    }

    loadCatalog("read");
  }, [authState.authenticated, loadCatalog]);

  const handleAuthAction = async (action) => {
    setIsAuthBusy(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const result = await action();
      if (!result?.success) {
        setErrorMessage(
          getCloudAuthPanelErrorMessage(
            result?.error,
            "Cloud authentication failed.",
          ),
        );
        return;
      }

      if (result.state) {
        setAuthState(result.state);
      }

      if (result.requiresEmailConfirmation) {
        setStatusMessage(
          "Account created. Confirm your email, then sign in to start syncing saves.",
        );
      } else {
        setStatusMessage(
          result.state?.authenticated
            ? "You are signed in."
            : "You are signed out.",
        );
      }
    } catch (error) {
      console.error("Cloud auth action failed:", error);
      setErrorMessage(
        getCloudAuthPanelErrorMessage(error, "Could not complete that action."),
      );
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleBulkAction = async (mode) => {
    setErrorMessage("");
    setStatusMessage("");

    try {
      const result = await window.electronAPI.runBulkCloudSaveAction(mode);
      if (!result?.success) {
        setErrorMessage(
          getCloudAuthPanelErrorMessage(
            result?.error,
            "Cloud save action failed.",
          ),
        );
        return;
      }

      const summary = result.result || null;
      setBulkProgress({
        active: false,
        mode,
        completed: summary?.completed || 0,
        total: summary?.total || 0,
        currentTitle: "",
        summary,
      });
      setStatusMessage(
        mode === "upload"
          ? "Bulk backup finished."
          : "Bulk save sync finished.",
      );
    } catch (error) {
      console.error("Bulk cloud action failed:", error);
      setErrorMessage(
        getCloudAuthPanelErrorMessage(error, "Cloud save action failed."),
      );
    }
  };

  const handleCatalogAction = async (mode) => {
    setCatalogBusyAction(mode);
    setErrorMessage("");
    setStatusMessage("");

    try {
      await loadCatalog(mode);
      setStatusMessage(
        mode === "sync"
          ? "Cloud library sync finished."
          : "Cloud library refreshed.",
      );
    } finally {
      setCatalogBusyAction("");
    }
  };

  const bulkSummaryText = useMemo(
    () => getBulkSummaryMessage(bulkProgress.summary),
    [bulkProgress.summary],
  );

  return (
    <div className="space-y-5 text-text">
      <section className="border border-border bg-primary/50 p-5 shadow-glass">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-accent/80">
              Cloud Saves
            </div>
            <h3 className="mt-2 text-xl font-semibold">Account access</h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-text/70">
              One account handles save backups and the cross-device library
              catalog without leaking infrastructure details into the UI.
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-white/5 text-text transition hover:bg-white/10"
              aria-label="Close cloud auth"
              title="Close"
            >
              <span className="material-symbols-outlined text-[20px] leading-none">
                close
              </span>
            </button>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <CloudAuthFeatureCard
            title="Back up all saves"
            description="Push every detected local save set to the cloud without stopping on one bad game."
          />
          <CloudAuthFeatureCard
            title="Sync across PCs"
            description="Reconcile installed saves on this machine against the latest cloud copy."
          />
          <CloudAuthFeatureCard
            title="Keep the library"
            description="Library entries sync additively so a second PC does not start from zero."
          />
          <CloudAuthFeatureCard
            title="Install later"
            description="Remote library entries can exist without local files until you choose to install them."
          />
        </div>
      </section>

      {!authState.configured ? (
        <div className="border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          Cloud saves are temporarily unavailable.
        </div>
      ) : authState.authenticated && authState.user ? (
        <>
          <section className="border border-green-500/30 bg-green-500/10 p-5 shadow-glass-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">
                  Signed in as {authState.user.email}
                </div>
                <div className="mt-1 text-sm text-text/70">
                  Your saves and library catalog are linked to this account.
                </div>
              </div>
              <button
                type="button"
                className="border border-border bg-secondary px-4 py-2 text-sm transition hover:bg-selected disabled:opacity-60"
                onClick={() =>
                  handleAuthAction(() => window.electronAPI.signOutCloud())
                }
                disabled={isAuthBusy}
              >
                {isAuthBusy ? "Please wait..." : "Sign Out"}
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <button
                type="button"
                onClick={() => handleBulkAction("upload")}
                disabled={bulkProgress.active}
                className="border border-accent/50 bg-accent px-4 py-3 text-left text-sm font-medium text-text transition hover:bg-selected disabled:opacity-60"
              >
                <div>Back Up All Saves</div>
                <div className="mt-1 text-xs font-normal text-text/75">
                  Upload every detected local save set on this PC.
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleBulkAction("sync")}
                disabled={bulkProgress.active}
                className="border border-border bg-secondary px-4 py-3 text-left text-sm font-medium text-text transition hover:bg-selected disabled:opacity-60"
              >
                <div>Sync All Saves</div>
                <div className="mt-1 text-xs font-normal text-text/75">
                  Reconcile all installed games against cloud backups.
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleCatalogAction("sync")}
                disabled={catalogBusyAction !== "" || isCatalogLoading}
                className="border border-border bg-secondary px-4 py-3 text-left text-sm font-medium text-text transition hover:bg-selected disabled:opacity-60"
              >
                <div>Refresh Cloud Library</div>
                <div className="mt-1 text-xs font-normal text-text/75">
                  Merge this device with the account-wide library catalog.
                </div>
              </button>
            </div>

            {(bulkProgress.active || bulkProgress.summary) && (
              <div className="mt-4 border border-border/70 bg-canvas/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">
                    {bulkProgress.mode === "upload"
                      ? "Bulk backup"
                      : "Bulk save sync"}
                  </div>
                  <div className="text-xs opacity-70">
                    {bulkProgress.completed}/{bulkProgress.total}
                  </div>
                </div>
                <div className="mt-1 text-xs opacity-70">
                  {bulkProgress.active
                    ? bulkProgress.currentTitle || "Working through the library..."
                    : bulkSummaryText || "No changes were needed."}
                </div>
                {bulkSummaryText && (
                  <div className="mt-2 text-xs text-text/80">
                    {bulkSummaryText}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="border border-border bg-primary/35 p-5 shadow-glass-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-text/55">
                  Cloud Library
                </div>
                <div className="mt-1 text-sm text-text/75">
                  Last synced: {formatCloudPanelDate(catalogState.lastUpdatedAt)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleCatalogAction("read")}
                disabled={catalogBusyAction !== "" || isCatalogLoading}
                className="border border-border bg-secondary px-3 py-2 text-sm transition hover:bg-selected disabled:opacity-60"
              >
                {isCatalogLoading ? "Loading..." : "Refresh"}
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <CloudAuthFeatureCard
                title={`${catalogState.mergedEntries.length}`}
                description="Total account library entries after merge."
              />
              <CloudAuthFeatureCard
                title={`${catalogState.localEntries.length}`}
                description="Entries already known on this device."
              />
              <CloudAuthFeatureCard
                title={`${catalogState.remoteEntries.length}`}
                description="Entries currently stored in the cloud catalog."
              />
              <CloudAuthFeatureCard
                title={`${catalogState.remoteOnlyEntries.length}`}
                description="Entries that existed in cloud before this device pulled them in."
              />
            </div>

            <div className="mt-4 border border-border/70 bg-canvas/40 p-3">
              <div className="text-sm font-medium text-text">
                Library entries not installed on this PC
              </div>
              {catalogState.materialized &&
                (catalogState.materialized.added > 0 ||
                  catalogState.materialized.updated > 0 ||
                  catalogState.materialized.failed > 0) && (
                  <div className="mt-1 text-xs opacity-70">
                    Added {catalogState.materialized.added || 0}, refreshed{" "}
                    {catalogState.materialized.updated || 0}, failed{" "}
                    {catalogState.materialized.failed || 0}.
                  </div>
                )}
              {catalogState.remoteOnlyEntries.length === 0 ? (
                <div className="mt-2 text-sm opacity-60">
                  Nothing extra is waiting in the cloud catalog right now.
                </div>
              ) : (
                <div className="mt-3 max-h-[220px] space-y-2 overflow-y-auto pr-1">
                  {catalogState.remoteOnlyEntries.map((entry) => (
                    <div
                      key={entry.identityKey}
                      className="border border-border/60 bg-black/15 px-3 py-2"
                    >
                      <div className="font-medium text-text">
                        {entry.title || "Unknown"}
                      </div>
                      <div className="text-xs opacity-65">
                        {entry.creator || "Unknown creator"}
                        {entry.latestVersion
                          ? ` · Latest ${entry.latestVersion}`
                          : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      ) : (
        <section className="border border-border bg-primary/35 p-5 shadow-glass-sm">
          <div className="inline-flex border border-border bg-black/20 p-1">
            <button
              type="button"
              className={`px-3 py-2 text-sm transition ${
                authMode === "sign-in"
                  ? "bg-accent text-text"
                  : "text-text/75 hover:bg-white/5"
              }`}
              onClick={() => setAuthMode("sign-in")}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`px-3 py-2 text-sm transition ${
                authMode === "sign-up"
                  ? "bg-accent text-text"
                  : "text-text/75 hover:bg-white/5"
              }`}
              onClick={() => setAuthMode("sign-up")}
            >
              Create Account
            </button>
          </div>

          <div className="mt-5 grid gap-4">
            <div>
              <label className="mb-1 block text-sm">Email</label>
              <input
                type="email"
                className="w-full border border-border bg-secondary p-3 text-text"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm">Password</label>
              <input
                type="password"
                className="w-full border border-border bg-secondary p-3 text-text"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  authMode === "sign-up" ? "new-password" : "current-password"
                }
                placeholder="Enter your password"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="bg-accent px-4 py-2 text-sm font-medium text-text transition hover:bg-hover disabled:opacity-60"
                onClick={() =>
                  handleAuthAction(() =>
                    authMode === "sign-up"
                      ? window.electronAPI.signUpCloud({ email, password })
                      : window.electronAPI.signInCloud({ email, password }),
                  )
                }
                disabled={isAuthBusy || !email.trim() || !password}
              >
                {isAuthBusy
                  ? "Please wait..."
                  : authMode === "sign-up"
                    ? "Create Account"
                    : "Sign In"}
              </button>
              <span className="text-xs text-text/60">
                {authMode === "sign-up"
                  ? "Use a valid email so account confirmation works when required."
                  : "Use the same account everywhere you want save continuity."}
              </span>
            </div>
          </div>
        </section>
      )}

      {(statusMessage || userFacingError) && (
        <div
          className={`border p-3 text-sm ${
            userFacingError
              ? "border-red-500/40 bg-red-500/10 text-red-200"
              : "border-green-500/30 bg-green-500/10 text-green-100"
          }`}
        >
          {userFacingError || statusMessage}
        </div>
      )}
    </div>
  );
};

const CloudAuthPanel = ({
  layout = "panel",
  isOpen = true,
  onClose = null,
}) => {
  const isModal = layout === "modal";

  if (isModal && !isOpen) {
    return null;
  }

  const content = <CloudAuthPanelContent onClose={isModal ? onClose : null} />;

  if (isModal) {
    return (
      <div
        className="fixed inset-0 z-[1750] flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-md"
        onClick={() => onClose?.()}
        role="presentation"
      >
        <div
          className="max-h-[90vh] w-full max-w-4xl overflow-y-auto border border-border bg-primary/92 p-5 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Cloud save account"
        >
          {content}
        </div>
      </div>
    );
  }

  return <div className="p-5">{content}</div>;
};

window.CloudAuthPanel = CloudAuthPanel;
