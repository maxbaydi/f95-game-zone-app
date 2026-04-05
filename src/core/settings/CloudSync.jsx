const CloudSync = () => {
  const [authMode, setAuthMode] = React.useState("sign-in");
  const [authState, setAuthState] = React.useState({
    configured: false,
    authenticated: false,
    user: null,
    error: "",
    settings: {},
  });
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");
  const [isAuthBusy, setIsAuthBusy] = React.useState(false);

  const loadState = React.useCallback(async () => {
    try {
      const authResult = await window.electronAPI.getCloudAuthState();

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
      console.error("Failed to load cloud sync settings:", error);
      setErrorMessage("Failed to load cloud sync settings.");
    }
  }, []);

  React.useEffect(() => {
    loadState();

    const unsubscribe = window.electronAPI.onCloudAuthChanged((state) => {
      setAuthState(state || {});
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
        setErrorMessage(result?.error || "Cloud authentication failed.");
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
      setErrorMessage(error.message || "Could not complete that action.");
    } finally {
      setIsAuthBusy(false);
    }
  };

  return (
    <div className="p-5 text-text space-y-5">
      <section className="border border-border rounded p-4 bg-primary/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Cloud Saves</h3>
            <p className="text-xs opacity-60 mt-1">
              Sign in once and F95 Game Zone App will use your account for save backups and restore.
            </p>
          </div>
          <div className="text-xs opacity-70 text-right">
            <div>
              Service: {authState.configured ? "ready" : "unavailable"}
            </div>
          </div>
        </div>
      </section>

      <section className="border border-border rounded p-4 bg-primary/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Account</h3>
            <p className="text-xs opacity-60 mt-1">
              Use your email and password to keep your save history tied to your account across machines.
            </p>
          </div>
          <div className="text-xs opacity-70 text-right">
            <div>
              {authState.configured ? "Cloud saves are ready" : "Cloud saves are unavailable"}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded border border-border bg-black/15 p-3 text-sm">
            <div className="font-medium">Back up to cloud</div>
            <div className="mt-1 text-xs opacity-60">
              Send your current local saves to your account backup.
            </div>
          </div>
          <div className="rounded border border-border bg-black/15 p-3 text-sm">
            <div className="font-medium">Restore to this PC</div>
            <div className="mt-1 text-xs opacity-60">
              Pull your latest cloud backup back onto the current machine.
            </div>
          </div>
          <div className="rounded border border-border bg-black/15 p-3 text-sm">
            <div className="font-medium">Protect local progress</div>
            <div className="mt-1 text-xs opacity-60">
              The app keeps a local safety backup before a restore replaces anything.
            </div>
          </div>
        </div>

        {!authState.configured ? (
          <div className="mt-4 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            Cloud saves are temporarily unavailable.
          </div>
        ) : authState.authenticated && authState.user ? (
          <div className="mt-4 rounded border border-green-500/30 bg-green-500/10 p-3">
            <div className="font-medium">Signed in as {authState.user.email}</div>
            <div className="text-xs opacity-70 mt-1">
              Your cloud backups will be linked to this account.
            </div>
            <button
              className="mt-3 bg-secondary px-4 py-2 rounded hover:bg-selected disabled:opacity-60"
              onClick={() =>
                handleAuthAction(() => window.electronAPI.signOutCloud())
              }
              disabled={isAuthBusy}
            >
              {isAuthBusy ? "Please wait..." : "Sign Out"}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="inline-flex rounded-lg border border-border bg-black/20 p-1">
              <button
                type="button"
                className={`rounded-md px-3 py-2 text-sm transition ${
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
                className={`rounded-md px-3 py-2 text-sm transition ${
                  authMode === "sign-up"
                    ? "bg-accent text-text"
                    : "text-text/75 hover:bg-white/5"
                }`}
                onClick={() => setAuthMode("sign-up")}
              >
                Create Account
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm mb-1">Email</label>
                <input
                  type="email"
                  className="w-full bg-secondary border border-border text-text rounded p-2"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Password</label>
                <input
                  type="password"
                  className="w-full bg-secondary border border-border text-text rounded p-2"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={
                    authMode === "sign-up" ? "new-password" : "current-password"
                  }
                  placeholder="Enter your password"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  className="bg-accent text-text px-4 py-2 rounded hover:bg-hover disabled:opacity-60"
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
                <span className="self-center text-xs opacity-60">
                  {authMode === "sign-up"
                    ? "Use a valid email so you can confirm your account if needed."
                    : "Use the same account on every machine you want to sync."}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {(statusMessage || errorMessage || authState.error) && (
        <div
          className={`rounded border p-3 text-sm ${
            errorMessage || authState.error
              ? "border-red-500/40 bg-red-500/10 text-red-200"
              : "border-green-500/30 bg-green-500/10 text-green-100"
          }`}
        >
          {errorMessage || authState.error || statusMessage}
        </div>
      )}
    </div>
  );
};

window.CloudSync = CloudSync;
