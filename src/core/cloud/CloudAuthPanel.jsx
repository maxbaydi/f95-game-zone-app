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

const SteamIcon = ({ name, className = "" }) => (
  <span
    className={`material-symbols-outlined select-none leading-none ${className}`}
  >
    {name}
  </span>
);

const CloudSteamInfoCard = ({ title, desc }) => (
  <div className="group border border-[#32353c] bg-[#212429] p-4 transition-colors hover:border-[#4b5059]">
    <h3 className="mb-2 text-sm font-medium text-white transition-colors group-hover:text-[#1999ff]">
      {title}
    </h3>
    <p className="text-xs leading-relaxed text-[#8b929a]">{desc}</p>
  </div>
);

const CloudSteamActionButton = ({
  primary,
  title,
  desc,
  iconName,
  onClick,
  disabled,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`group flex h-full flex-col border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
      primary
        ? "border-[#1a9fff] bg-gradient-to-b from-[#1a9fff] to-[#0c80df] shadow-[0_0_15px_rgba(26,159,255,0.2)] hover:brightness-110"
        : "border-[#32353c] bg-[#212429] hover:border-[#4b5059] hover:bg-[#2a2d34]"
    }`}
  >
    <div
      className={`mb-3 transition-colors ${
        primary
          ? "text-white"
          : "text-[#8b929a] group-hover:text-white"
      }`}
    >
      <SteamIcon name={iconName} className="text-[20px]" />
    </div>
    <h4
      className={`mb-1 text-base font-medium ${
        primary
          ? "text-white"
          : "text-[#dcdedf] group-hover:text-white"
      }`}
    >
      {title}
    </h4>
    <p
      className={`mt-auto text-xs leading-relaxed ${
        primary ? "text-[#e0f0ff]" : "text-[#8b929a]"
      }`}
    >
      {desc}
    </p>
  </button>
);

const CloudSteamStatCard = ({ value, label }) => (
  <div className="flex flex-col justify-between border border-[#2a2d34] bg-[#1a1d24] p-4">
    <div className="mb-3 text-3xl font-light tracking-tight text-white">
      {value}
    </div>
    <div className="text-xs leading-relaxed text-[#8b929a]">{label}</div>
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
        getCloudAuthPanelErrorMessage(
          error,
          "Cloud save action failed.",
        ),
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

  const alertBlock =
    statusMessage || userFacingError ? (
      <div
        className={`mx-8 mb-4 border p-3 text-sm ${
          userFacingError
            ? "border-red-500/40 bg-red-500/10 text-red-200"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
        }`}
      >
        {userFacingError || statusMessage}
      </div>
    ) : null;

  return (
    <div className="relative flex flex-col font-sans text-[#dcdedf]">
      <div className="absolute left-0 top-0 z-10 h-px w-full bg-gradient-to-r from-transparent via-[#1999ff]/50 to-transparent" />

      <div className="relative px-8 pb-4 pt-8">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-6 top-6 p-1.5 text-[#8b929a] transition-colors hover:bg-[#32353c] hover:text-white"
            aria-label="Close"
            title="Close"
          >
            <SteamIcon name="close" className="text-[20px]" />
          </button>
        ) : null}

        <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-[#1999ff]">
          Cloud Saves
        </h4>
        <h1 className="mb-3 text-2xl font-light text-white">Account access</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[#8b929a]">
          One account handles save backups and the cross-device library catalog
          without leaking infrastructure details into the UI.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 px-8 py-4 md:grid-cols-4">
        <CloudSteamInfoCard
          title="Back up all saves"
          desc="Push every detected local save set to the cloud without stopping on one bad game."
        />
        <CloudSteamInfoCard
          title="Sync across PCs"
          desc="Reconcile installed saves on this machine against the latest cloud copy."
        />
        <CloudSteamInfoCard
          title="Keep the library"
          desc="Library entries sync additively so a second PC does not start from zero."
        />
        <CloudSteamInfoCard
          title="Install later"
          desc="Remote library entries can exist without local files until you choose to install them."
        />
      </div>

      {!authState.configured ? (
        <>
          <div className="mx-8 mb-6 border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            Cloud saves are temporarily unavailable.
          </div>
          {alertBlock}
        </>
      ) : authState.authenticated && authState.user ? (
        <>
          <div className="mx-8 my-4 border border-[#264030] bg-[#1b2822] p-6">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-[#3b634c] bg-gradient-to-br from-[#2a4736] to-[#14221a] shadow-inner">
                  <SteamIcon
                    name="check_circle"
                    className="text-[24px] text-[#54a575]"
                  />
                </div>
                <div className="min-w-0">
                  <h2 className="mb-1 flex flex-wrap items-center gap-2 text-lg font-medium text-white">
                    <span className="font-normal">Signed in as</span>
                    <span className="font-bold break-all">
                      {authState.user.email}
                    </span>
                  </h2>
                  <p className="text-sm text-[#6c8c79]">
                    Your saves and library catalog are linked to this account.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="flex shrink-0 items-center gap-2 border border-[#2d4737] bg-[#213328] px-4 py-1.5 text-sm text-[#8ca897] transition-all hover:bg-[#2b4234] hover:text-white disabled:opacity-60"
                onClick={() =>
                  handleAuthAction(() => window.electronAPI.signOutCloud())
                }
                disabled={isAuthBusy}
              >
                <SteamIcon name="logout" className="text-[16px]" />
                {isAuthBusy ? "Please wait…" : "Sign out"}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <CloudSteamActionButton
                primary
                iconName="cloud_upload"
                title="Back up all saves"
                desc="Upload every detected local save set on this PC."
                onClick={() => handleBulkAction("upload")}
                disabled={bulkProgress.active}
              />
              <CloudSteamActionButton
                iconName="refresh"
                title="Sync all saves"
                desc="Reconcile all installed games against cloud backups."
                onClick={() => handleBulkAction("sync")}
                disabled={bulkProgress.active}
              />
              <CloudSteamActionButton
                iconName="database"
                title="Refresh cloud library"
                desc="Merge this device with the account-wide library catalog."
                onClick={() => handleCatalogAction("sync")}
                disabled={catalogBusyAction !== "" || isCatalogLoading}
              />
            </div>

            {(bulkProgress.active || bulkProgress.summary) && (
              <div className="mt-4 border border-[#32353c] bg-[#141a17] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium text-white">
                    {bulkProgress.mode === "upload"
                      ? "Bulk backup"
                      : "Bulk save sync"}
                  </div>
                  <div className="text-xs text-[#8b929a]">
                    {bulkProgress.completed}/{bulkProgress.total}
                  </div>
                </div>
                <div className="mt-1 text-xs text-[#8b929a]">
                  {bulkProgress.active
                    ? bulkProgress.currentTitle ||
                      "Working through the library…"
                    : bulkSummaryText || "No changes were needed."}
                </div>
                {bulkSummaryText ? (
                  <div className="mt-2 text-xs text-[#dcdedf]/90">
                    {bulkSummaryText}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="relative mx-8 mb-6 mt-2 overflow-hidden border border-[#32353c] bg-[#212429] p-6">
            <SteamIcon
              name="cloud"
              className="pointer-events-none absolute -bottom-6 -right-6 text-[192px] text-[#2a2d34] opacity-20"
            />

            <div className="relative z-10 mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-widest text-[#8b929a]">
                  Cloud library
                </h3>
                <p className="text-sm text-[#8b929a]">
                  Last synced:{" "}
                  <span className="text-[#dcdedf]">
                    {formatCloudPanelDate(catalogState.lastUpdatedAt)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleCatalogAction("read")}
                disabled={catalogBusyAction !== "" || isCatalogLoading}
                className="flex items-center gap-2 border border-[#3d4148] bg-[#2a2d34] px-4 py-2 text-sm text-white shadow-sm transition-all hover:border-[#4b5059] hover:bg-[#32353c] disabled:opacity-60"
              >
                <SteamIcon name="refresh" className="text-[16px]" />
                {isCatalogLoading ? "Loading…" : "Refresh"}
              </button>
            </div>

            <div className="relative z-10 grid grid-cols-1 gap-4 md:grid-cols-4">
              <CloudSteamStatCard
                value={String(catalogState.mergedEntries.length)}
                label="Total account library entries after merge."
              />
              <CloudSteamStatCard
                value={String(catalogState.localEntries.length)}
                label="Entries already known on this device."
              />
              <CloudSteamStatCard
                value={String(catalogState.remoteEntries.length)}
                label="Entries currently stored in the cloud catalog."
              />
              <CloudSteamStatCard
                value={String(catalogState.remoteOnlyEntries.length)}
                label="Entries that existed in cloud before this device pulled them in."
              />
            </div>
          </div>

          <div className="flex items-start gap-4 border-t border-[#26282e] bg-[#14161a] px-8 py-5">
            <SteamIcon
              name="checklist"
              className="mt-0.5 shrink-0 text-[20px] text-[#4b5059]"
            />
            <div className="min-w-0 flex-1">
              <h4 className="mb-1 text-sm font-medium text-white">
                Library entries not installed on this PC
              </h4>
              {catalogState.materialized &&
                (catalogState.materialized.added > 0 ||
                  catalogState.materialized.updated > 0 ||
                  catalogState.materialized.failed > 0) && (
                  <p className="mb-2 text-xs text-[#8b929a]">
                    Added {catalogState.materialized.added || 0}, refreshed{" "}
                    {catalogState.materialized.updated || 0}, failed{" "}
                    {catalogState.materialized.failed || 0}.
                  </p>
                )}
              {catalogState.remoteOnlyEntries.length === 0 ? (
                <p className="text-sm text-[#8b929a]">
                  Nothing extra is waiting in the cloud catalog right now.
                </p>
              ) : (
                <div className="mt-2 max-h-[220px] space-y-2 overflow-y-auto pr-1">
                  {catalogState.remoteOnlyEntries.map((entry) => (
                    <div
                      key={entry.identityKey}
                      className="border border-[#32353c] bg-[#1a1d24] px-3 py-2"
                    >
                      <div className="font-medium text-white">
                        {entry.title || "Unknown"}
                      </div>
                      <div className="text-xs text-[#8b929a]">
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
          </div>

          {alertBlock}
        </>
      ) : (
        <>
          <div className="mx-8 my-4 border border-[#32353c] bg-[#212429] p-6">
            <div className="inline-flex border border-[#32353c] bg-[#1a1d24] p-1">
              <button
                type="button"
                className={`px-3 py-2 text-sm transition ${
                  authMode === "sign-in"
                    ? "bg-[#1a9fff] text-white"
                    : "text-[#8b929a] hover:bg-[#2a2d34]"
                }`}
                onClick={() => setAuthMode("sign-in")}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`px-3 py-2 text-sm transition ${
                  authMode === "sign-up"
                    ? "bg-[#1a9fff] text-white"
                    : "text-[#8b929a] hover:bg-[#2a2d34]"
                }`}
                onClick={() => setAuthMode("sign-up")}
              >
                Create account
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <div>
                <label className="mb-1 block text-sm text-[#dcdedf]">
                  Email
                </label>
                <input
                  type="email"
                  className="w-full border border-[#32353c] bg-[#1a1d24] p-3 text-[#dcdedf] outline-none focus:border-[#1999ff]/60"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-[#dcdedf]">
                  Password
                </label>
                <input
                  type="password"
                  className="w-full border border-[#32353c] bg-[#1a1d24] p-3 text-[#dcdedf] outline-none focus:border-[#1999ff]/60"
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
                  className="bg-gradient-to-b from-[#1a9fff] to-[#0c80df] px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
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
                    ? "Please wait…"
                    : authMode === "sign-up"
                      ? "Create account"
                      : "Sign in"}
                </button>
                <span className="text-xs text-[#8b929a]">
                  {authMode === "sign-up"
                    ? "Use a valid email so account confirmation works when required."
                    : "Use the same account everywhere you want save continuity."}
                </span>
              </div>
            </div>
          </div>

          {alertBlock}
        </>
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
        className="fixed inset-0 z-[1750] flex items-center justify-center bg-black/80 p-4"
        onClick={() => onClose?.()}
        role="presentation"
      >
        <div
          className="relative flex max-h-[90vh] w-full max-w-[900px] flex-col overflow-y-auto border border-[#32353c] bg-[#1a1d24] shadow-2xl"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Cloud saves"
        >
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="relative mx-auto flex w-full max-w-[900px] flex-col overflow-hidden border border-[#32353c] bg-[#1a1d24] shadow-2xl">
        {content}
      </div>
    </div>
  );
};

window.CloudAuthPanel = CloudAuthPanel;
