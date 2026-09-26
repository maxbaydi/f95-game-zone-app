const { useEffect, useMemo, useRef, useState } = window.React;

const F95_SEARCH_URL = "https://f95zone.to/sam/latest_alpha/";
const F95_THREAD_PATTERN = /https:\/\/f95zone\.to\/threads\//i;
const { getCaptchaContinuationUrl: sharedGetCaptchaContinuationUrl } =
  window.f95CaptchaFlow || {};
const getCaptchaContinuationUrl =
  sharedGetCaptchaContinuationUrl ||
  ((actionUrl, currentUrl) => {
    const normalizedActionUrl = String(actionUrl || "").trim();
    const normalizedCurrentUrl = String(currentUrl || "").trim();
    if (
      !normalizedActionUrl ||
      !normalizedCurrentUrl ||
      normalizedActionUrl === normalizedCurrentUrl ||
      /^about:/i.test(normalizedCurrentUrl)
    ) {
      return "";
    }
    return normalizedCurrentUrl;
  });

const KEEP_F95_NAVIGATION_IN_PLACE_SCRIPT = String.raw`(() => {
  const isSameF95Host = (value) => {
    try {
      const resolvedUrl = new URL(value, location.href);
      return /(^|\.)f95zone\.to$/i.test(resolvedUrl.hostname);
    } catch {
      return false;
    }
  };

  const isOverlayManagedLink = (anchor) => {
    if (!anchor || typeof anchor.matches !== "function") {
      return false;
    }

    return anchor.matches(
      '.LbImage, .js-lbImage, [data-lb-id], [data-xf-click], [data-featherlight], .bbImageWrapper a',
    );
  };

  const rewriteAnchors = () => {
    document.querySelectorAll("a[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href") || anchor.href;
      if (
        !href ||
        href.startsWith("#") ||
        !isSameF95Host(href) ||
        isOverlayManagedLink(anchor)
      ) {
        return;
      }

      anchor.target = "_self";
      anchor.rel = "";
    });
  };

  rewriteAnchors();

  const observer = new MutationObserver(() => {
    rewriteAnchors();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();`;

const useWorkspaceInstallAttempts =
  window.useF95InstallAttempts ||
  (() => ({
    attemptEvents: [],
    beginAttempts: () => {},
    resetAttempts: () => {},
  }));

const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let size = value;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${
    units[unitIndex]
  }`;
};

const F95BrowserWorkspace = () => {
  const hostRef = useRef(null);
  const webviewRef = useRef(null);
  const guestReadyRef = useRef(false);
  const authStatusRef = useRef(false);
  const captchaRetryKeyRef = useRef("");
  const [authState, setAuthState] = useState({
    isAuthenticated: false,
  });
  const [browserState, setBrowserState] = useState({
    url: F95_SEARCH_URL,
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  });
  const [browserKey, setBrowserKey] = useState(0);
  const [browserError, setBrowserError] = useState("");
  const [threadInfo, setThreadInfo] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [installError, setInstallError] = useState("");
  const [isInspectingThread, setIsInspectingThread] = useState(false);
  const [isStartingInstall, setIsStartingInstall] = useState(false);
  const useWorkspaceEscape = window.AtlasMotion?.useEscape || (() => {});
  useWorkspaceEscape(Boolean(threadInfo) && !isStartingInstall, () =>
    setThreadInfo(null),
  );
  const [downloadState, setDownloadState] = useState(null);
  const [pendingCaptchaAction, setPendingCaptchaAction] = useState(null);
  const [selectedLinkUrl, setSelectedLinkUrl] = useState("");
  const { attemptEvents, beginAttempts, resetAttempts } =
    useWorkspaceInstallAttempts();
  const [threadInstallState, setThreadInstallState] = useState({
    checking: false,
    inLibrary: false,
    installed: false,
    recordId: null,
    title: "",
    creator: "",
    version: "",
    gamePath: "",
    siteUrl: "",
  });

  const currentUrl = browserState.url || F95_SEARCH_URL;
  const threadLinks = Array.isArray(threadInfo?.links) ? threadInfo.links : [];
  const selectedThreadLink =
    threadLinks.find((link) => link.url === selectedLinkUrl) ||
    threadLinks.find((link) => link.url === threadInfo?.preferredLinkUrl) ||
    threadLinks[0] ||
    null;
  const isThreadPage = F95_THREAD_PATTERN.test(currentUrl);

  const withWebview = (callback) => {
    const webview = webviewRef.current;
    if (!webview) {
      return null;
    }

    return callback(webview);
  };

  useEffect(() => {
    let mounted = true;

    const applyAuthState = (nextState) => {
      if (!mounted || !nextState) {
        return;
      }

      const nextAuthState = Boolean(nextState.isAuthenticated);
      const authChanged = authStatusRef.current !== nextAuthState;
      authStatusRef.current = nextAuthState;
      setAuthState(nextState);

      if (authChanged) {
        setBrowserKey((previous) => previous + 1);
      }
    };

    window.electronAPI
      .getF95AuthStatus()
      .then(applyAuthState)
      .catch((error) => {
        console.error("Failed to load F95 auth state:", error);
      });

    window.electronAPI.onF95AuthChanged((nextState) => {
      applyAuthState(nextState);
    });

    window.electronAPI.onF95DownloadProgress((progressState) => {
      setDownloadState(progressState || null);
      // The "queued" / "your turn in the browser window" note is superseded
      // as soon as the progress line reports the transfer itself, otherwise
      // it lingers under a finished or failed download.
      if (
        [
          "downloading",
          "installing",
          "completed",
          "error",
          "cancelled",
        ].includes(progressState?.phase)
      ) {
        setStatusMessage("");
      }
    });

    return () => {
      mounted = false;
      window.electronAPI.removeAllListeners("f95-auth-changed");
      window.electronAPI.removeAllListeners("f95-download-progress");
    };
  }, []);

  useEffect(() => {
    setThreadInfo(null);
    setInstallError("");
    setBrowserError("");
    setPendingCaptchaAction(null);
    captchaRetryKeyRef.current = "";
  }, [browserKey, authState.isAuthenticated]);

  useEffect(() => {
    let cancelled = false;

    if (!authState.isAuthenticated || !isThreadPage) {
      setThreadInstallState({
        checking: false,
        inLibrary: false,
        installed: false,
        recordId: null,
        title: "",
        creator: "",
        version: "",
        gamePath: "",
        siteUrl: "",
      });
      return undefined;
    }

    setThreadInstallState((previous) => ({
      ...previous,
      checking: true,
    }));

    window.electronAPI
      .getF95ThreadInstallState({
        threadUrl: currentUrl,
        rawTitle: browserState.title || "",
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setThreadInstallState({
          checking: false,
          inLibrary: Boolean(payload?.inLibrary),
          installed: Boolean(payload?.installed),
          recordId: payload?.recordId ?? null,
          title: payload?.title || "",
          creator: payload?.creator || "",
          version: payload?.version || "",
          gamePath: payload?.gamePath || "",
          siteUrl: payload?.siteUrl || "",
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        console.error("Failed to resolve F95 thread install state:", error);
        setThreadInstallState({
          checking: false,
          inLibrary: false,
          installed: false,
          recordId: null,
          title: "",
          creator: "",
          version: "",
          gamePath: "",
          siteUrl: "",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    authState.isAuthenticated,
    isThreadPage,
    currentUrl,
    browserState.title,
    downloadState?.phase,
  ]);

  useEffect(() => {
    if (!authState.isAuthenticated) {
      if (hostRef.current) {
        hostRef.current.innerHTML = "";
      }
      guestReadyRef.current = false;
      webviewRef.current = null;
      return undefined;
    }

    const hostElement = hostRef.current;
    if (!hostElement) {
      return undefined;
    }

    hostElement.innerHTML = "";
    guestReadyRef.current = false;
    setBrowserError("");
    setBrowserState({
      url: F95_SEARCH_URL,
      title: "",
      loading: true,
      canGoBack: false,
      canGoForward: false,
    });

    const webview = document.createElement("webview");
    webview.setAttribute("src", F95_SEARCH_URL);
    webview.setAttribute("partition", "persist:f95-auth");
    webview.className = "h-full w-full";
    webview.style.width = "100%";
    webview.style.height = "100%";
    webview.style.display = "flex";
    webview.style.background = "#050608";
    hostElement.appendChild(webview);
    webviewRef.current = webview;

    const syncBrowserState = () => {
      if (!guestReadyRef.current) {
        return;
      }

      try {
        setBrowserState({
          url: webview.getURL() || F95_SEARCH_URL,
          title: webview.getTitle() || "",
          loading: webview.isLoading(),
          canGoBack: webview.canGoBack(),
          canGoForward: webview.canGoForward(),
        });
      } catch (error) {
        console.warn("Skipping early webview state sync:", error);
      }
    };

    const handleStartLoading = () => {
      setBrowserError("");
      setBrowserState((previous) => ({
        ...previous,
        loading: true,
      }));
    };

    const handleStopLoading = () => {
      syncBrowserState();
    };

    const handleDomReady = () => {
      guestReadyRef.current = true;
      webview
        .executeJavaScript(KEEP_F95_NAVIGATION_IN_PLACE_SCRIPT)
        .catch((error) => {
          console.warn("Failed to normalize in-webview F95 navigation:", error);
        });
      syncBrowserState();
    };

    const handleFailLoad = (event) => {
      if (event.errorCode === -3) {
        return;
      }

      setBrowserError(
        `F95 page failed to load: ${event.errorDescription || "unknown error"}`,
      );
      setBrowserState((previous) => ({
        ...previous,
        loading: false,
      }));
    };

    const handleCrash = () => {
      setBrowserError(
        "Embedded F95 page crashed. Reload the workspace or reopen Search.",
      );
      setBrowserState((previous) => ({
        ...previous,
        loading: false,
      }));
    };

    webview.addEventListener("did-start-loading", handleStartLoading);
    webview.addEventListener("did-stop-loading", handleStopLoading);
    webview.addEventListener("did-navigate", syncBrowserState);
    webview.addEventListener("did-navigate-in-page", syncBrowserState);
    webview.addEventListener("page-title-updated", syncBrowserState);
    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("did-fail-load", handleFailLoad);
    webview.addEventListener("render-process-gone", handleCrash);

    return () => {
      guestReadyRef.current = false;
      webview.removeEventListener("did-start-loading", handleStartLoading);
      webview.removeEventListener("did-stop-loading", handleStopLoading);
      webview.removeEventListener("did-navigate", syncBrowserState);
      webview.removeEventListener("did-navigate-in-page", syncBrowserState);
      webview.removeEventListener("page-title-updated", syncBrowserState);
      webview.removeEventListener("dom-ready", handleDomReady);
      webview.removeEventListener("did-fail-load", handleFailLoad);
      webview.removeEventListener("render-process-gone", handleCrash);

      if (hostElement.contains(webview)) {
        hostElement.removeChild(webview);
      }

      if (webviewRef.current === webview) {
        webviewRef.current = null;
      }
    };
  }, [authState.isAuthenticated, browserKey]);

  const progressLabel = useMemo(() => {
    if (!downloadState) {
      return "";
    }

    if (
      downloadState.totalBytes > 0 &&
      downloadState.receivedBytes >= 0 &&
      downloadState.phase === "downloading"
    ) {
      return `${formatBytes(downloadState.receivedBytes)} / ${formatBytes(
        downloadState.totalBytes,
      )}`;
    }

    return "";
  }, [downloadState]);

  const installButtonLabel = useMemo(() => {
    if (isInspectingThread || isStartingInstall) {
      return "Preparing...";
    }

    if (threadInstallState.checking && isThreadPage) {
      return "Checking...";
    }

    if (threadInstallState.installed) {
      return "Already Installed";
    }

    return "Install This Thread";
  }, [
    isInspectingThread,
    isStartingInstall,
    threadInstallState.checking,
    threadInstallState.installed,
    isThreadPage,
  ]);

  const addButtonLabel = useMemo(() => {
    if (isInspectingThread || isStartingInstall) {
      return "Working...";
    }

    if (threadInstallState.checking && isThreadPage) {
      return "Checking...";
    }

    if (threadInstallState.inLibrary) {
      return "In Library";
    }

    return "Add to Library";
  }, [
    isInspectingThread,
    isStartingInstall,
    threadInstallState.checking,
    threadInstallState.inLibrary,
    isThreadPage,
  ]);

  const openLoginWindow = async () => {
    setInstallError("");
    setStatusMessage(
      "Finish the login in the F95 window, then this page will refresh.",
    );

    try {
      const nextState = await window.electronAPI.openF95Login();
      setAuthState(nextState || authState);
    } catch (error) {
      console.error("Failed to open F95 login window:", error);
      setInstallError(error.message);
    }
  };

  const logout = async () => {
    setInstallError("");
    setStatusMessage("");

    try {
      const nextState = await window.electronAPI.logoutF95();
      setAuthState(nextState || { isAuthenticated: false });
      setThreadInfo(null);
      setDownloadState(null);
      setPendingCaptchaAction(null);
    } catch (error) {
      console.error("Failed to clear F95 session:", error);
      setInstallError(error.message);
    }
  };

  const navigateSearchHome = () => {
    withWebview((webview) => {
      webview.loadURL(F95_SEARCH_URL);
    });
  };

  const inspectCurrentThread = async () => {
    if (!isThreadPage) {
      setInstallError("Open a game thread first, then install it from here.");
      return;
    }

    setInstallError("");
    setStatusMessage("");
    setIsInspectingThread(true);

    try {
      const payload = await window.electronAPI.inspectF95Thread({
        threadUrl: currentUrl,
      });

      if (!payload?.success) {
        setThreadInfo(null);
        setInstallError(payload?.error || "Failed to extract download links.");
        return;
      }

      const onlyLink = payload.links.length === 1 ? payload.links[0] : null;
      if (onlyLink && !window.f95MirrorUi?.isBrowserOnly?.(onlyLink)) {
        await startInstall(payload, onlyLink);
        return;
      }

      resetAttempts();
      setSelectedLinkUrl(
        payload.preferredLinkUrl || payload.links[0]?.url || "",
      );
      setThreadInfo(payload);
    } catch (error) {
      console.error("Failed to inspect F95 thread:", error);
      setInstallError(error.message);
    } finally {
      setIsInspectingThread(false);
    }
  };

  const addCurrentThreadToLibrary = async () => {
    if (!isThreadPage) {
      setInstallError("Open a game thread first, then add it to the library.");
      return;
    }

    setInstallError("");
    setStatusMessage("");
    setIsInspectingThread(true);

    try {
      const result = await window.electronAPI.addF95ThreadToLibrary({
        threadUrl: currentUrl,
        rawTitle: browserState.title || "",
      });

      if (!result?.success || !result.result) {
        setInstallError(
          result?.error || "Failed to add this thread to the library.",
        );
        return;
      }

      const nextState = result.result.state || null;
      if (nextState) {
        setThreadInstallState((previous) => ({
          ...previous,
          ...nextState,
          checking: false,
        }));
      }

      setStatusMessage(
        nextState?.installed
          ? `${nextState.title || "This thread"} is already installed.`
          : `${nextState?.title || browserState.title || "This thread"} was added to your library.`,
      );
    } catch (error) {
      console.error("Failed to add F95 thread to library:", error);
      setInstallError(error.message);
    } finally {
      setIsInspectingThread(false);
    }
  };

  const buildInstallPayload = (payload, link) => {
    const variant = window.f95MirrorUi?.findVariant?.(
      payload.variants,
      payload.links,
      link.url,
    );
    return {
      threadUrl: payload.threadUrl,
      title: payload.title,
      creator: payload.creator,
      version: payload.version,
      engine: payload.engine,
      downloadLabel: link.label,
      downloadUrl: link.url,
      mirrorHost: link.host || "",
      variantId: link.variantId || variant?.id || "",
    };
  };

  const startInstall = async (payload, link, options = {}) => {
    setIsStartingInstall(true);
    setInstallError("");
    beginAttempts(payload.threadUrl);

    try {
      const result = await window.electronAPI.installF95Thread({
        ...buildInstallPayload(payload, link),
        downloadUrl: options.overrideUrl || link.url,
        fallbackLinks:
          window.f95MirrorUi?.buildFallbackLinks?.(payload, link) || [],
      });

      if (!result?.success) {
        if (result?.code === "captcha_required") {
          const captchaUrl = result?.actionUrl || link.url;
          setPendingCaptchaAction({
            payload,
            link,
            actionUrl: captchaUrl,
            actionKind: result?.actionKind || "captcha",
          });
          setThreadInfo(null);
          setStatusMessage(
            result?.actionKind === "verification"
              ? "This mirror wants a quick check in the browser below. After it, F95Launcher continues on its own, or just press Download on the page."
              : "This mirror needs a captcha before F95Launcher can continue. Finish it in the browser below and the install resumes automatically.",
          );
          withWebview((webview) => {
            webview.loadURL(captchaUrl);
          });
        } else {
          setInstallError(result?.error || "Failed to queue download.");
          if (
            !threadInfo &&
            Array.isArray(payload.links) &&
            payload.links.length > 0
          ) {
            setSelectedLinkUrl(link.url);
            setThreadInfo(payload);
          }
        }
        return;
      }

      const usedHostName = window.getF95MirrorDisplayName?.({
        host: result?.usedHost || link.host,
        label: result?.usedLabel || link.label,
      });
      const requestedHostName = window.getF95MirrorDisplayName?.(link);
      setThreadInfo(null);
      setPendingCaptchaAction(null);
      resetAttempts();
      const fallbackNote = result?.fellBack
        ? `${requestedHostName} did not return the file, so F95Launcher switched to ${usedHostName}. `
        : "";
      setStatusMessage(
        result?.awaitingAction
          ? `${fallbackNote}${result.hostLabel || usedHostName || "The mirror"} needs a quick step in the browser window that just opened. Finish it there and ${payload.title} downloads by itself.`
          : result?.fellBack
            ? `${fallbackNote}${payload.title} is downloading and installs in the background.`
            : `Queued ${payload.title} via ${
                usedHostName || result?.sourceHost || link.label
              }. Download and install will continue in the background.`,
      );
    } catch (error) {
      console.error("Failed to queue F95 install:", error);
      setInstallError(error.message);
    } finally {
      setIsStartingInstall(false);
    }
  };

  const retryPendingCaptchaInstall = async () => {
    if (!pendingCaptchaAction) {
      return;
    }

    const continuationUrl = getCaptchaContinuationUrl(
      pendingCaptchaAction.actionUrl,
      currentUrl,
    );

    await startInstall(
      pendingCaptchaAction.payload,
      pendingCaptchaAction.link,
      {
        overrideUrl: continuationUrl || pendingCaptchaAction.link.url,
      },
    );
  };

  const reopenCaptchaPage = () => {
    if (!pendingCaptchaAction?.actionUrl) {
      return;
    }

    withWebview((webview) => {
      webview.loadURL(pendingCaptchaAction.actionUrl);
    });
  };

  useEffect(() => {
    if (!pendingCaptchaAction) {
      captchaRetryKeyRef.current = "";
      return;
    }

    if (browserState.loading || isStartingInstall) {
      return;
    }

    const continuationUrl = getCaptchaContinuationUrl(
      pendingCaptchaAction.actionUrl,
      currentUrl,
    );

    if (!continuationUrl) {
      return;
    }

    const retryKey = `${pendingCaptchaAction.actionUrl}|${continuationUrl}`;
    if (captchaRetryKeyRef.current === retryKey) {
      return;
    }

    captchaRetryKeyRef.current = retryKey;
    setStatusMessage("Captcha confirmed. Resuming install...");
    void startInstall(pendingCaptchaAction.payload, pendingCaptchaAction.link, {
      overrideUrl: continuationUrl,
    });
  }, [
    pendingCaptchaAction,
    currentUrl,
    browserState.loading,
    isStartingInstall,
  ]);

  if (!authState.isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center bg-tertiary px-8">
        <div className="max-w-3xl rounded-3xl border border-border bg-primary/85 p-8 shadow-2xl">
          <div className="text-[11px] uppercase tracking-[0.22em] text-accent/80">
            F95 Workspace
          </div>
          <h2 className="mt-3 text-3xl font-semibold text-text">
            Real site search now lives behind the F95 session
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-text/75">
            `Latest Updates alpha` is login-only, so this page now uses a real
            authenticated F95 browser instead of the fake local catalog search.
            Once you log in, you can browse the live site here, open a thread,
            and queue download + install directly into your library.
          </p>

          <div className="mt-6 grid gap-3 text-sm text-text/80 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-secondary/40 p-4">
              Live F95 search
            </div>
            <div className="rounded-2xl border border-border bg-secondary/40 p-4">
              Shared login session
            </div>
            <div className="rounded-2xl border border-border bg-secondary/40 p-4">
              Download + auto install
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={openLoginWindow}
              className="rounded-xl bg-accent px-5 py-3 text-sm font-medium text-onAccent hover:brightness-110"
            >
              Log In To F95
            </button>
            <div className="text-sm text-text/60">
              A dedicated F95 login window will open on the same persistent
              session.
            </div>
          </div>

          {statusMessage && (
            <div className="mt-4 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-text">
              {statusMessage}
            </div>
          )}
          {installError && (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {installError}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="isolate flex h-full flex-col bg-tertiary">
      <div className="relative z-10 flex flex-wrap items-center gap-2 border-b border-border bg-primary/90 px-4 py-2">
        <button
          onClick={() =>
            withWebview((webview) => webview.canGoBack() && webview.goBack())
          }
          disabled={!browserState.canGoBack}
          className="rounded border border-border bg-secondary px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40 hover:bg-selected"
        >
          Back
        </button>
        <button
          onClick={() =>
            withWebview(
              (webview) => webview.canGoForward() && webview.goForward(),
            )
          }
          disabled={!browserState.canGoForward}
          className="rounded border border-border bg-secondary px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40 hover:bg-selected"
        >
          Forward
        </button>
        <button
          onClick={() => withWebview((webview) => webview.reload())}
          className="rounded border border-border bg-secondary px-3 py-2 text-sm hover:bg-selected"
        >
          Refresh
        </button>
        <button
          onClick={navigateSearchHome}
          className="rounded border border-border bg-secondary px-3 py-2 text-sm hover:bg-selected"
        >
          Latest Updates
        </button>
        <button
          onClick={() => window.electronAPI.openExternalUrl(currentUrl)}
          className="rounded border border-border bg-secondary px-3 py-2 text-sm hover:bg-selected"
        >
          Open Externally
        </button>
        <button
          onClick={inspectCurrentThread}
          disabled={
            !isThreadPage ||
            isInspectingThread ||
            isStartingInstall ||
            threadInstallState.checking ||
            threadInstallState.installed
          }
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-onAccent disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-110"
        >
          {installButtonLabel}
        </button>
        <button
          onClick={addCurrentThreadToLibrary}
          disabled={
            !isThreadPage ||
            isInspectingThread ||
            isStartingInstall ||
            threadInstallState.checking ||
            threadInstallState.inLibrary
          }
          className="rounded border border-border bg-secondary px-4 py-2 text-sm font-medium text-text disabled:cursor-not-allowed disabled:opacity-50 hover:bg-selected"
        >
          {addButtonLabel}
        </button>
        <button
          onClick={logout}
          className="ml-auto rounded border border-border bg-secondary px-3 py-2 text-sm hover:bg-selected"
        >
          Log Out
        </button>
      </div>

      <div className="relative z-10 flex items-center gap-2 border-b border-border bg-canvas/40 px-4 py-2 text-sm text-text/75">
        <div className="truncate font-medium text-text">
          {browserState.title || "F95"}
        </div>
        <div className="truncate opacity-55">{currentUrl}</div>
        {threadInstallState.inLibrary && (
          <div
            className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${
              threadInstallState.installed
                ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                : "border border-accent/30 bg-accent/10 text-text"
            }`}
          >
            {threadInstallState.installed ? "Installed" : "In Library"}
          </div>
        )}
        {browserState.loading && (
          <div className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-text">
            Loading
          </div>
        )}
      </div>

      {threadInstallState.inLibrary && isThreadPage && (
        <div
          className={`relative z-10 border-b px-4 py-2 text-sm ${
            threadInstallState.installed
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
              : "border-accent/30 bg-accent/10 text-text"
          }`}
        >
          {threadInstallState.title || "This thread"}
          {threadInstallState.installed
            ? threadInstallState.version
              ? ` is already installed in the library (${threadInstallState.version}).`
              : " is already installed in the library."
            : " is already linked in your library but not installed on this PC."}
        </div>
      )}

      {downloadState && (
        <div
          className={`relative z-10 border-b px-4 py-2 text-sm ${
            downloadState.phase === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-100"
              : downloadState.phase === "completed"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                : "border-accent/30 bg-accent/10 text-text"
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <div>{downloadState.text}</div>
            {progressLabel && <div className="opacity-70">{progressLabel}</div>}
            {typeof downloadState.percent === "number" && (
              <div className="opacity-70">{downloadState.percent}%</div>
            )}
          </div>
        </div>
      )}

      {statusMessage && (
        <div className="relative z-10 border-b border-border bg-secondary/40 px-4 py-2 text-sm text-text/75">
          {statusMessage}
        </div>
      )}

      {pendingCaptchaAction && (
        <div className="relative z-10 border-b border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[280px]">
              {pendingCaptchaAction.actionKind === "verification"
                ? "Finish the check in the page below. F95Launcher continues automatically, or press Download on the page and the file is installed for you."
                : "Finish the captcha in the page below. The install resumes automatically."}
            </div>
            <button
              onClick={reopenCaptchaPage}
              className="rounded border border-amber-300/30 bg-white/5 px-3 py-2 text-xs font-medium text-amber-50 transition hover:bg-white/10"
            >
              {pendingCaptchaAction.actionKind === "verification"
                ? "Open Check Page"
                : "Open Captcha Page"}
            </button>
            <button
              onClick={retryPendingCaptchaInstall}
              disabled={isStartingInstall}
              className="rounded bg-accent px-3 py-2 text-xs font-medium text-onAccent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isStartingInstall ? "Retrying..." : "Retry Install"}
            </button>
          </div>
        </div>
      )}

      {installError && !threadInfo && (
        <div
          key={installError}
          role="alert"
          className="atlas-shake relative z-10 flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-100"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden>
            error
          </span>
          <span className="min-w-0 flex-1">{installError}</span>
        </div>
      )}

      {browserError && (
        <div
          key={browserError}
          role="alert"
          className="atlas-rise-enter relative z-10 flex flex-wrap items-center gap-3 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-100"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden>
            wifi_off
          </span>
          <span className="min-w-0 flex-1">{browserError}</span>
          <button
            type="button"
            onClick={() => {
              setBrowserError("");
              withWebview((webview) => {
                try {
                  webview.reload();
                } catch (error) {
                  webview.loadURL(F95_SEARCH_URL);
                }
              });
            }}
            className="inline-flex items-center gap-1 border border-red-200/30 bg-white/5 px-3 py-1 text-xs font-medium text-red-50 transition hover:bg-white/10"
          >
            <span
              className="material-symbols-outlined text-[15px] leading-none"
              aria-hidden
            >
              refresh
            </span>
            Reload page
          </button>
        </div>
      )}

      <div
        className={`h-[2px] w-full ${
          browserState.loading
            ? "atlas-progress-indeterminate atlas-keep-motion"
            : ""
        }`}
        aria-hidden
      />

      <div className="relative flex-1">
        <div ref={hostRef} className="h-full w-full bg-black" />

        {!browserError && browserState.loading && (
          <div className="atlas-fade-enter pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/15">
            <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-primary/85 px-4 py-3 text-sm text-text shadow-glow-accent">
              <span
                className="atlas-spinner atlas-keep-motion text-accent"
                aria-hidden
              />
              Loading F95...
            </div>
          </div>
        )}

        {threadInfo && (
          <div
            className="atlas-overlay absolute inset-0 z-20 flex items-center justify-center bg-black/55 px-6 py-6 backdrop-blur-sm"
            data-state="open"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !isStartingInstall) {
                setThreadInfo(null);
                resetAttempts();
              }
            }}
          >
            <div
              className="atlas-dialog flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-border bg-primary shadow-2xl"
              data-state="open"
              role="dialog"
              aria-modal="true"
              aria-label="Thread install"
            >
              <div className="border-b border-border px-6 py-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-accent/80">
                  Thread Install
                </div>
                <div className="mt-2 text-2xl font-semibold text-text">
                  {threadInfo.title}
                </div>
                <div className="mt-2 text-sm text-text/65">
                  {threadInfo.version && `Version: ${threadInfo.version}`}
                  {threadInfo.creator &&
                    `${threadInfo.version ? " • " : ""}Creator: ${
                      threadInfo.creator
                    }`}
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
                {installError && (
                  <div
                    key={installError}
                    role="alert"
                    className="atlas-shake flex items-start gap-2 border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100"
                  >
                    <span
                      className="material-symbols-outlined text-[18px]"
                      aria-hidden
                    >
                      error
                    </span>
                    <div className="min-w-0 flex-1">
                      {installError}
                      {threadLinks.length > 1 && (
                        <div className="mt-1 text-xs text-red-100/75">
                          Pick another mirror below and try again.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <window.F95MirrorPicker
                  key={threadInfo.threadUrl || "thread"}
                  thread={threadInfo}
                  selectedLinkUrl={selectedThreadLink?.url || ""}
                  onSelectLink={(link) => {
                    setInstallError("");
                    setSelectedLinkUrl(link.url);
                  }}
                  disabled={isStartingInstall}
                  attemptEvents={attemptEvents}
                />
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
                {isStartingInstall && (
                  <div className="atlas-fade-enter mr-auto flex items-center gap-2 text-sm text-text/70">
                    <span
                      className="atlas-spinner atlas-keep-motion text-accent"
                      aria-hidden
                    />
                    Connecting to the selected mirror…
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setThreadInfo(null);
                    resetAttempts();
                  }}
                  disabled={isStartingInstall}
                  title="Cancel (Esc)"
                  className="rounded border border-border bg-secondary px-4 py-2 text-sm transition hover:bg-selected disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() =>
                    selectedThreadLink &&
                    startInstall(threadInfo, selectedThreadLink)
                  }
                  disabled={isStartingInstall || !selectedThreadLink}
                  className="flex items-center gap-2 rounded bg-accent px-5 py-2 text-sm font-semibold text-onAccent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isStartingInstall ? (
                    <span
                      className="atlas-spinner atlas-keep-motion"
                      aria-hidden
                    />
                  ) : (
                    <span
                      className="material-symbols-outlined text-[18px] leading-none"
                      aria-hidden
                    >
                      {window.f95MirrorUi?.isBrowserOnly?.(selectedThreadLink)
                        ? "open_in_browser"
                        : "download"}
                    </span>
                  )}
                  {isStartingInstall
                    ? "Starting..."
                    : window.f95MirrorUi?.getActionLabel?.(
                        selectedThreadLink,
                      ) || "Install"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

window.F95BrowserWorkspace = F95BrowserWorkspace;
