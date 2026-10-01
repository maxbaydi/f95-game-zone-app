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

const EMPTY_THREAD_INSTALL_STATE = {
  checking: false,
  inLibrary: false,
  installed: false,
  installState: "",
  recordId: null,
  title: "",
  creator: "",
  version: "",
  gamePath: "",
  siteUrl: "",
};

// How long a passing note (queued, added to library, …) stays on screen.
// Notes that wait for the user (captcha, errors) never time out.
const STATUS_NOTICE_DURATION = 7000;
// A finished or failed transfer keeps its toolbar chip briefly so the outcome
// is visible without opening the downloads panel.
const TRANSFER_CHIP_LINGER = 6000;

const splitUrlForDisplay = (value) => {
  try {
    const parsed = new URL(value);
    const pathname = decodeURIComponent(
      `${parsed.pathname}${parsed.search}`.replace(/\/$/, ""),
    );
    return { host: parsed.hostname.replace(/^www\./, ""), path: pathname };
  } catch (_) {
    return { host: "", path: String(value || "") };
  }
};

const TRANSFER_PHASE_META = {
  downloading: { icon: "", label: "Downloading", tone: "accent" },
  installing: { icon: "", label: "Installing", tone: "accent" },
  completed: { icon: "check_circle", label: "Installed", tone: "success" },
  error: { icon: "error", label: "Failed", tone: "error" },
  cancelled: { icon: "block", label: "Cancelled", tone: "muted" },
};

const CHIP_TONES = {
  accent: "border-accent/40 bg-accent/10 text-text hover:bg-accent/20",
  success:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20",
  error: "border-red-500/40 bg-red-500/10 text-red-100 hover:bg-red-500/20",
  muted: "border-border bg-white/5 text-text/70 hover:bg-white/10",
};

const ToolbarIconButton = ({
  icon,
  label,
  onClick,
  disabled = false,
  active = false,
  className = "",
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    aria-pressed={active || undefined}
    className={`flex h-8 w-8 flex-none items-center justify-center text-text/80 transition hover:bg-white/10 hover:text-text disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent ${
      active ? "bg-white/10 text-accent" : ""
    } ${className}`}
  >
    <span
      className="material-symbols-outlined text-[20px] leading-none"
      aria-hidden
    >
      {icon}
    </span>
  </button>
);

// One compact floating card. Reuses the app-wide toast styling so the
// workspace notes look like every other notification in F95Launcher, but
// they stay inside the browser area instead of the global toast stack.
const WorkspaceNotice = ({ notice, onDismiss }) => {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!(notice.duration > 0)) {
      return undefined;
    }
    const timer = setTimeout(() => {
      dismissRef.current?.();
    }, notice.duration);
    return () => clearTimeout(timer);
  }, [notice.key, notice.message, notice.duration]);

  const iconName =
    notice.icon ||
    {
      success: "check_circle",
      error: "error",
      warning: "shield",
      info: "info",
      loading: "",
    }[notice.type] ||
    "info";

  return (
    <div
      className="atlas-toast pointer-events-auto"
      data-type={notice.type}
      role={notice.type === "error" ? "alert" : "status"}
      data-notice={notice.key}
    >
      {notice.type === "loading" ? (
        <span
          className="atlas-toast__icon atlas-spinner atlas-keep-motion"
          style={{ width: 16, height: 16, marginTop: 2, color: "#66c0f4" }}
          aria-hidden
        />
      ) : (
        <span
          className="atlas-toast__icon material-symbols-outlined"
          aria-hidden
        >
          {iconName}
        </span>
      )}
      <div className="atlas-toast__body">
        {notice.title && (
          <div className="atlas-toast__title">{notice.title}</div>
        )}
        {notice.message && (
          <div className="atlas-toast__message">{notice.message}</div>
        )}
        {Array.isArray(notice.actions) && notice.actions.length > 0 && (
          <div className="atlas-toast__actions">
            {notice.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                className="atlas-toast__action disabled:cursor-not-allowed disabled:opacity-60"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {notice.dismissible !== false && (
        <button
          type="button"
          onClick={onDismiss}
          className="atlas-toast__close"
          aria-label="Dismiss"
          data-no-ripple=""
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 16 }}
            aria-hidden
          >
            close
          </span>
        </button>
      )}
      {notice.duration > 0 && (
        <div
          className="atlas-toast__timer atlas-keep-motion"
          style={{ animationDuration: `${notice.duration}ms` }}
        />
      )}
    </div>
  );
};

const F95BrowserWorkspace = ({ onOpenDownloads, onOpenLibraryRecord } = {}) => {
  const hostRef = useRef(null);
  const webviewRef = useRef(null);
  const guestReadyRef = useRef(false);
  const authStatusRef = useRef(false);
  const captchaRetryKeyRef = useRef("");
  const demoPage = window.__f95LauncherDemo?.enabled
    ? window.__f95LauncherDemo.f95Page || null
    : null;
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
  // { text, tone: "info" | "success", sticky } — a passing note; sticky ones
  // stay until the transfer reports itself or the user closes them.
  const [statusNotice, setStatusNotice] = useState(null);
  const [installError, setInstallError] = useState("");
  const [isInspectingThread, setIsInspectingThread] = useState(false);
  const [isStartingInstall, setIsStartingInstall] = useState(false);
  const useWorkspaceEscape = window.AtlasMotion?.useEscape || (() => {});
  useWorkspaceEscape(Boolean(threadInfo) && !isStartingInstall, () =>
    setThreadInfo(null),
  );
  const [downloadState, setDownloadState] = useState(null);
  const [transferChipVisible, setTransferChipVisible] = useState(false);
  const [pendingCaptchaAction, setPendingCaptchaAction] = useState(null);
  const [selectedLinkUrl, setSelectedLinkUrl] = useState("");
  const { attemptEvents, beginAttempts, resetAttempts } =
    useWorkspaceInstallAttempts();
  const [threadInstallState, setThreadInstallState] = useState(
    EMPTY_THREAD_INSTALL_STATE,
  );

  const currentUrl = browserState.url || F95_SEARCH_URL;
  const threadLinks = Array.isArray(threadInfo?.links) ? threadInfo.links : [];
  const selectedThreadLink =
    threadLinks.find((link) => link.url === selectedLinkUrl) ||
    threadLinks.find((link) => link.url === threadInfo?.preferredLinkUrl) ||
    threadLinks[0] ||
    null;
  const isThreadPage = F95_THREAD_PATTERN.test(currentUrl);

  const setStatusMessage = (text, options = {}) => {
    if (!text) {
      setStatusNotice(null);
      return;
    }
    setStatusNotice({
      text,
      tone: options.tone || "info",
      sticky: Boolean(options.sticky),
      nonce: Date.now(),
    });
  };

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

    // Only this workspace's listeners are removed on unmount: the app shell
    // subscribes to the same channels (sign-in resumes the install dialog),
    // so removing every listener would silently break those.
    const unsubscribeAuth = window.electronAPI.onF95AuthChanged((nextState) => {
      applyAuthState(nextState);
    });

    const unsubscribeProgress = window.electronAPI.onF95DownloadProgress((progressState) => {
      if (!mounted) {
        return;
      }
      setDownloadState(progressState || null);
      setTransferChipVisible(Boolean(progressState));
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
        setStatusNotice(null);
      }
    });

    return () => {
      mounted = false;
      if (typeof unsubscribeAuth === "function") {
        unsubscribeAuth();
      } else {
        window.electronAPI.removeAllListeners?.("f95-auth-changed");
      }
      if (typeof unsubscribeProgress === "function") {
        unsubscribeProgress();
      } else {
        window.electronAPI.removeAllListeners?.("f95-download-progress");
      }
    };
  }, []);

  // Finished transfers leave the toolbar after a moment; the downloads panel
  // and the global toasts keep the full history.
  useEffect(() => {
    if (
      !transferChipVisible ||
      !["completed", "error", "cancelled"].includes(downloadState?.phase)
    ) {
      return undefined;
    }
    const timer = setTimeout(
      () => setTransferChipVisible(false),
      TRANSFER_CHIP_LINGER,
    );
    return () => clearTimeout(timer);
  }, [transferChipVisible, downloadState]);

  useEffect(() => {
    setThreadInfo(null);
    setInstallError("");
    setBrowserError("");
    setPendingCaptchaAction(null);
    captchaRetryKeyRef.current = "";
  }, [browserKey, authState.isAuthenticated]);

  // An error about the previous page is stale once the user moves on.
  useEffect(() => {
    setInstallError("");
  }, [currentUrl]);

  useEffect(() => {
    let cancelled = false;

    if (!authState.isAuthenticated || !isThreadPage) {
      setThreadInstallState(EMPTY_THREAD_INSTALL_STATE);
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
          installState: payload?.installState || "",
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
        setThreadInstallState(EMPTY_THREAD_INSTALL_STATE);
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

    // The browser preview (`index.html?demo=1`) has no <webview>; it shows a
    // static demo page so the workspace chrome can be screenshotted.
    if (demoPage) {
      const frame = document.createElement("iframe");
      frame.setAttribute("title", demoPage.title || "F95 demo page");
      frame.setAttribute("sandbox", "");
      frame.srcdoc = demoPage.html || "";
      frame.className = "h-full w-full border-0";
      frame.style.background = "#050608";
      hostElement.appendChild(frame);
      webviewRef.current = null;
      setBrowserState({
        url: demoPage.url || F95_SEARCH_URL,
        title: demoPage.title || "",
        loading: false,
        canGoBack: true,
        canGoForward: false,
      });
      return () => {
        if (hostElement.contains(frame)) {
          hostElement.removeChild(frame);
        }
      };
    }

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
      return "Preparing…";
    }

    if (threadInstallState.checking && isThreadPage) {
      return "Checking…";
    }

    if (threadInstallState.installed) {
      return "Installed";
    }

    if (threadInstallState.installState === "missing") {
      return "Install Again";
    }

    return "Install";
  }, [
    isInspectingThread,
    isStartingInstall,
    threadInstallState.checking,
    threadInstallState.installed,
    threadInstallState.installState,
    isThreadPage,
  ]);

  const addButtonLabel = useMemo(() => {
    if (threadInstallState.checking && isThreadPage) {
      return "Checking…";
    }

    if (threadInstallState.inLibrary) {
      return "In Library";
    }

    return "Add to Library";
  }, [threadInstallState.checking, threadInstallState.inLibrary, isThreadPage]);

  const openLoginWindow = async () => {
    setInstallError("");
    setStatusMessage(
      "Finish the login in the F95 window, then this page will refresh.",
      { sticky: true },
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
      setTransferChipVisible(false);
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
        { tone: "success" },
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
          // The captcha card below carries the instructions; no second note.
          setStatusMessage("");
          setPendingCaptchaAction({
            payload,
            link,
            actionUrl: captchaUrl,
            actionKind: result?.actionKind || "captcha",
          });
          setThreadInfo(null);
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
      if (result?.awaitingAction) {
        setStatusMessage(
          `${fallbackNote}${result.hostLabel || usedHostName || "The mirror"} needs a quick step in the browser window that just opened. Finish it there and ${payload.title} downloads by itself.`,
          { sticky: true },
        );
      } else {
        setStatusMessage(
          result?.fellBack
            ? `${fallbackNote}${payload.title} is downloading and installs in the background.`
            : `${payload.title} is queued via ${
                usedHostName || result?.sourceHost || link.label
              }. It downloads and installs in the background.`,
          { tone: "success" },
        );
      }
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
    setStatusMessage("Captcha confirmed. Resuming install…", { sticky: true });
    void startInstall(pendingCaptchaAction.payload, pendingCaptchaAction.link, {
      overrideUrl: continuationUrl,
    });
  }, [
    pendingCaptchaAction,
    currentUrl,
    browserState.loading,
    isStartingInstall,
  ]);

  const reloadPage = () => {
    setBrowserError("");
    withWebview((webview) => {
      try {
        webview.reload();
      } catch (error) {
        webview.loadURL(F95_SEARCH_URL);
      }
    });
  };

  const libraryBadge = useMemo(() => {
    if (!threadInstallState.inLibrary || !isThreadPage) {
      return null;
    }
    const title = threadInstallState.title || "This thread";
    if (threadInstallState.installed) {
      return {
        label: "Installed",
        icon: "check_circle",
        tone: "success",
        detail: threadInstallState.version
          ? `${title} is installed (${threadInstallState.version}). Click to open it in the library.`
          : `${title} is installed. Click to open it in the library.`,
      };
    }
    if (threadInstallState.installState === "missing") {
      return {
        label: "Files missing",
        icon: "folder_off",
        tone: "error",
        detail: `${title} was installed before, but its files are missing. Install it again from this thread.`,
      };
    }
    return {
      label: "In library",
      icon: "bookmark_added",
      tone: "accent",
      detail: `${title} is in your library but not installed on this PC.`,
    };
  }, [threadInstallState, isThreadPage]);

  const transferChip = useMemo(() => {
    if (!transferChipVisible || !downloadState) {
      return null;
    }
    const meta = TRANSFER_PHASE_META[downloadState.phase];
    if (!meta) {
      return null;
    }
    const percent =
      typeof downloadState.percent === "number" &&
      downloadState.phase === "downloading"
        ? Math.max(0, Math.min(100, Math.round(downloadState.percent)))
        : null;
    const busy = ["downloading", "installing"].includes(downloadState.phase);
    return {
      ...meta,
      busy,
      percent,
      text:
        percent !== null
          ? `${meta.label} ${percent}%`
          : downloadState.phase === "downloading" && progressLabel
            ? `${meta.label} ${progressLabel}`
            : meta.label,
      detail: [downloadState.text, progressLabel].filter(Boolean).join(" · "),
    };
  }, [transferChipVisible, downloadState, progressLabel]);

  // Floating notes, most urgent first. Each one maps to a piece of state so
  // dismissing a note clears the state behind it.
  const notices = useMemo(() => {
    const list = [];
    if (browserError) {
      list.push({
        key: "browser-error",
        type: "error",
        icon: "wifi_off",
        title: "Page did not load",
        message: browserError,
        actions: [{ label: "Reload page", onClick: reloadPage }],
        onDismiss: () => setBrowserError(""),
      });
    }
    if (pendingCaptchaAction) {
      const verification = pendingCaptchaAction.actionKind === "verification";
      list.push({
        key: "captcha",
        type: "warning",
        icon: "verified_user",
        title: verification ? "Quick check on the page" : "Captcha on the page",
        message: verification
          ? `Finish the check in the page below. ${pendingCaptchaAction.payload?.title || "The game"} then continues by itself, or press Download on the page.`
          : `Finish the captcha in the page below. ${pendingCaptchaAction.payload?.title || "The install"} resumes automatically.`,
        actions: [
          {
            label: verification ? "Open check page" : "Open captcha page",
            onClick: reopenCaptchaPage,
          },
          {
            label: isStartingInstall ? "Retrying…" : "Retry install",
            onClick: retryPendingCaptchaInstall,
            disabled: isStartingInstall,
          },
        ],
        onDismiss: () => setPendingCaptchaAction(null),
      });
    }
    if (installError && !threadInfo) {
      list.push({
        key: "install-error",
        type: "error",
        message: installError,
        onDismiss: () => setInstallError(""),
      });
    }
    if (statusNotice) {
      list.push({
        key: `status-${statusNotice.nonce}`,
        type: statusNotice.sticky ? "loading" : statusNotice.tone,
        message: statusNotice.text,
        duration: statusNotice.sticky ? 0 : STATUS_NOTICE_DURATION,
        onDismiss: () => setStatusNotice(null),
      });
    }
    return list;
  }, [
    browserError,
    pendingCaptchaAction,
    isStartingInstall,
    installError,
    threadInfo,
    statusNotice,
  ]);

  if (!authState.isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center bg-tertiary px-8">
        <div className="max-w-3xl border border-border bg-primary/85 p-8 shadow-2xl">
          <div className="text-[11px] uppercase tracking-[0.22em] text-accent/80">
            F95 Workspace
          </div>
          <h2 className="mt-3 text-3xl font-semibold text-text">
            Browse F95 and install games without leaving the launcher
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-text/75">
            `Latest Updates` on F95 is login-only, so this page embeds the
            real site behind your own F95 session. Once you log in, open any
            game thread here and F95Launcher downloads, unpacks and adds it to
            your library in the background.
          </p>

          <div className="mt-6 grid gap-3 text-sm text-text/80 md:grid-cols-3">
            {[
              ["travel_explore", "Live F95 search"],
              ["key", "One shared login session"],
              ["download_done", "Download + install in one click"],
            ].map(([icon, label]) => (
              <div
                key={label}
                className="flex items-center gap-3 border border-border bg-secondary/40 p-4"
              >
                <span
                  className="material-symbols-outlined text-[22px] text-accent"
                  aria-hidden
                >
                  {icon}
                </span>
                {label}
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={openLoginWindow}
              className="flex items-center gap-2 bg-accent px-5 py-3 text-sm font-medium text-onAccent hover:brightness-110"
            >
              <span
                className="material-symbols-outlined text-[18px] leading-none"
                aria-hidden
              >
                login
              </span>
              Log In To F95
            </button>
            <div className="text-sm text-text/60">
              A dedicated F95 login window opens on the same persistent
              session.
            </div>
          </div>

          {statusNotice && (
            <div className="mt-4 flex items-center gap-2 border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-text">
              <span
                className="atlas-spinner atlas-keep-motion text-accent"
                aria-hidden
              />
              {statusNotice.text}
            </div>
          )}
          {installError && (
            <div className="mt-4 border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {installError}
            </div>
          )}
        </div>
      </div>
    );
  }

  const displayUrl = splitUrlForDisplay(currentUrl);
  const primaryDisabled =
    !isThreadPage ||
    isInspectingThread ||
    isStartingInstall ||
    threadInstallState.checking ||
    threadInstallState.installed;
  const addDisabled =
    !isThreadPage ||
    isInspectingThread ||
    isStartingInstall ||
    threadInstallState.checking ||
    threadInstallState.inLibrary;

  return (
    <div className="isolate flex h-full flex-col bg-tertiary">
      <div
        className="relative z-10 flex h-11 items-center gap-1 border-b border-border bg-primary/95 px-2"
        role="toolbar"
        aria-label="F95 browser"
      >
        <ToolbarIconButton
          icon="arrow_back"
          label="Back"
          disabled={!browserState.canGoBack}
          onClick={() =>
            withWebview((webview) => webview.canGoBack() && webview.goBack())
          }
        />
        <ToolbarIconButton
          icon="arrow_forward"
          label="Forward"
          disabled={!browserState.canGoForward}
          onClick={() =>
            withWebview(
              (webview) => webview.canGoForward() && webview.goForward(),
            )
          }
        />
        <ToolbarIconButton
          icon={browserState.loading ? "close" : "refresh"}
          label={browserState.loading ? "Stop loading" : "Reload"}
          onClick={() =>
            withWebview((webview) =>
              browserState.loading ? webview.stop() : webview.reload(),
            )
          }
        />
        <ToolbarIconButton
          icon="home"
          label="Latest Updates"
          active={!isThreadPage && currentUrl.startsWith(F95_SEARCH_URL)}
          onClick={navigateSearchHome}
        />

        <div
          className="mx-1 flex h-8 min-w-0 flex-1 items-center gap-2 border border-border bg-canvas/60 px-3 text-xs"
          title={currentUrl}
        >
          <span
            className="material-symbols-outlined flex-none text-[16px] text-text/50"
            aria-hidden
          >
            {isThreadPage ? "forum" : "public"}
          </span>
          <span className="min-w-0 truncate font-medium text-text">
            {browserState.title || displayUrl.host || "F95"}
          </span>
          {displayUrl.path && (
            <span className="hidden min-w-0 truncate text-text/45 lg:inline">
              {displayUrl.path}
            </span>
          )}
          {libraryBadge && (
            <button
              type="button"
              title={libraryBadge.detail}
              onClick={() => {
                if (threadInstallState.recordId != null) {
                  onOpenLibraryRecord?.(threadInstallState.recordId);
                }
              }}
              className={`ml-auto flex flex-none items-center gap-1 border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                CHIP_TONES[libraryBadge.tone]
              } ${onOpenLibraryRecord ? "cursor-pointer" : "cursor-default"}`}
            >
              <span
                className="material-symbols-outlined text-[14px] leading-none"
                aria-hidden
              >
                {libraryBadge.icon}
              </span>
              {libraryBadge.label}
            </button>
          )}
        </div>

        {transferChip && (
          <button
            type="button"
            onClick={() => onOpenDownloads?.()}
            title={transferChip.detail || "Open downloads"}
            className={`atlas-rise-enter relative flex h-8 max-w-[220px] flex-none items-center gap-2 overflow-hidden border px-3 text-xs font-medium transition ${
              CHIP_TONES[transferChip.tone]
            }`}
          >
            {transferChip.busy ? (
              <span
                className="atlas-spinner atlas-keep-motion text-[12px] text-accent"
                aria-hidden
              />
            ) : (
              <span
                className="material-symbols-outlined text-[16px] leading-none"
                aria-hidden
              >
                {transferChip.icon}
              </span>
            )}
            <span className="truncate tabular-nums">{transferChip.text}</span>
            {transferChip.busy && (
              <span
                className={`absolute bottom-0 left-0 h-[2px] bg-accent ${
                  transferChip.percent === null
                    ? "atlas-progress-indeterminate atlas-keep-motion w-full"
                    : "atlas-progress-fill"
                }`}
                style={
                  transferChip.percent === null
                    ? undefined
                    : { width: `${transferChip.percent}%` }
                }
                aria-hidden
              />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={inspectCurrentThread}
          disabled={primaryDisabled}
          title={
            isThreadPage
              ? "Pick a mirror and install this thread into the library"
              : "Open a game thread to install it"
          }
          className="ml-1 flex h-8 flex-none items-center gap-1.5 bg-accent px-3 text-xs font-semibold text-onAccent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isInspectingThread || isStartingInstall ? (
            <span className="atlas-spinner atlas-keep-motion" aria-hidden />
          ) : (
            <span
              className="material-symbols-outlined text-[18px] leading-none"
              aria-hidden
            >
              {threadInstallState.installed ? "check" : "download"}
            </span>
          )}
          {installButtonLabel}
        </button>
        <button
          type="button"
          onClick={addCurrentThreadToLibrary}
          disabled={addDisabled}
          title={
            threadInstallState.inLibrary
              ? "This thread is already in your library"
              : "Add this thread to the library without downloading"
          }
          className="flex h-8 flex-none items-center gap-1.5 border border-border bg-secondary px-3 text-xs font-medium text-text transition hover:bg-selected disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span
            className="material-symbols-outlined text-[18px] leading-none"
            aria-hidden
          >
            {threadInstallState.inLibrary ? "bookmark_added" : "bookmark_add"}
          </span>
          <span className="hidden xl:inline">{addButtonLabel}</span>
        </button>

        <span className="mx-1 h-5 w-px flex-none bg-border" aria-hidden />

        <ToolbarIconButton
          icon="open_in_new"
          label="Open in system browser"
          onClick={() => window.electronAPI.openExternalUrl(currentUrl)}
        />
        <ToolbarIconButton
          icon="logout"
          label={
            authState.username
              ? `Log out (${authState.username})`
              : "Log out of F95"
          }
          onClick={logout}
        />

        <div
          className={`absolute inset-x-0 bottom-[-1px] h-[2px] ${
            browserState.loading
              ? "atlas-progress-indeterminate atlas-keep-motion"
              : ""
          }`}
          aria-hidden
        />
      </div>

      <div className="relative flex-1">
        <div ref={hostRef} className="h-full w-full bg-black" />

        {notices.length > 0 && (
          <div
            className="pointer-events-none absolute right-3 top-2 z-10 flex w-[min(380px,calc(100%-24px))] flex-col"
            aria-live="polite"
            aria-label="Browser notifications"
          >
            {notices.map((notice) => (
              <WorkspaceNotice
                key={notice.key}
                notice={notice}
                onDismiss={notice.onDismiss}
              />
            ))}
          </div>
        )}

        {!browserError && browserState.loading && !browserState.title && (
          <div className="atlas-fade-enter pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/15">
            <div className="flex items-center gap-2 border border-accent/30 bg-primary/85 px-4 py-3 text-sm text-text shadow-glow-accent">
              <span
                className="atlas-spinner atlas-keep-motion text-accent"
                aria-hidden
              />
              Loading F95…
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
              className="atlas-dialog flex max-h-full w-full max-w-5xl flex-col overflow-hidden border border-border bg-primary shadow-2xl"
              data-state="open"
              role="dialog"
              aria-modal="true"
              aria-label="Thread install"
            >
              <div className="flex items-start gap-4 border-b border-border px-6 py-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-accent/80">
                    Install from thread
                  </div>
                  <div className="mt-1 truncate text-xl font-semibold text-text">
                    {threadInfo.title}
                  </div>
                  <div className="mt-1 text-xs text-text/65">
                    {threadInfo.version && `Version ${threadInfo.version}`}
                    {threadInfo.creator &&
                      `${threadInfo.version ? " · " : ""}${threadInfo.creator}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setThreadInfo(null);
                    resetAttempts();
                  }}
                  disabled={isStartingInstall}
                  title="Close (Esc)"
                  aria-label="Close"
                  className="flex h-8 w-8 flex-none items-center justify-center text-text/70 transition hover:bg-white/10 hover:text-text disabled:opacity-40"
                >
                  <span
                    className="material-symbols-outlined text-[20px]"
                    aria-hidden
                  >
                    close
                  </span>
                </button>
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
                  className="border border-border bg-secondary px-4 py-2 text-sm transition hover:bg-selected disabled:opacity-50"
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
                  className="flex items-center gap-2 bg-accent px-5 py-2 text-sm font-semibold text-onAccent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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
                    ? "Starting…"
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
