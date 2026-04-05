const { useCallback, useEffect, useState } = window.React;

const createCloudAuthPanelDefaultState = () => ({
  configured: false,
  authenticated: false,
  user: null,
  error: "",
  settings: {},
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

  useEffect(() => {
    loadState();

    const unsubscribe = window.electronAPI.onCloudAuthChanged((state) => {
      setAuthState(state || createCloudAuthPanelDefaultState());
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [loadState]);

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
              Sign in once and the app can back up and restore your saves across
              machines without exposing backend internals in the UI.
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

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <CloudAuthFeatureCard
            title="Back up to cloud"
            description="Upload the save set detected on this machine to your account."
          />
          <CloudAuthFeatureCard
            title="Restore safely"
            description="Pull the latest backup back to this PC with a local safety copy first."
          />
          <CloudAuthFeatureCard
            title="Keep progress linked"
            description="Use the same account on every machine where you want continuity."
          />
        </div>
      </section>

      {!authState.configured ? (
        <div className="border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          Cloud saves are temporarily unavailable.
        </div>
      ) : authState.authenticated && authState.user ? (
        <section className="border border-green-500/30 bg-green-500/10 p-5 shadow-glass-sm">
          <div className="text-lg font-semibold">
            Signed in as {authState.user.email}
          </div>
          <div className="mt-1 text-sm text-text/70">
            Your cloud backups are linked to this account.
          </div>
          <button
            type="button"
            className="mt-4 border border-border bg-secondary px-4 py-2 text-sm transition hover:bg-selected disabled:opacity-60"
            onClick={() =>
              handleAuthAction(() => window.electronAPI.signOutCloud())
            }
            disabled={isAuthBusy}
          >
            {isAuthBusy ? "Please wait..." : "Sign Out"}
          </button>
        </section>
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
          className="max-h-[90vh] w-full max-w-3xl overflow-y-auto border border-border bg-primary/92 p-5 shadow-2xl"
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
