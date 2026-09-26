// Keeps renderer windows recoverable. The app's windows are frameless and
// transparent, so a crashed or hung renderer leaves an invisible window the
// user cannot even close. This reloads crashed renderers (within a budget),
// offers a native dialog when a window hangs or keeps crashing, and logs load
// failures that would otherwise be silent.

const DEFAULT_OPTIONS = {
  maxReloads: 3,
  reloadWindowMs: 60_000,
  reloadDelayMs: 1_200,
  unresponsiveDialogDelayMs: 10_000,
};

const RECOVERABLE_GONE_REASONS = new Set([
  "crashed",
  "oom",
  "abnormal-exit",
  "killed",
  "launch-failed",
  "integrity-failure",
]);

// Chromium net error for a navigation superseded by another one.
const ERR_ABORTED = -3;

function createReloadBudget({ maxReloads, reloadWindowMs, now }) {
  const attempts = [];
  return {
    tryConsume() {
      const current = now();
      while (attempts.length > 0 && current - attempts[0] > reloadWindowMs) {
        attempts.shift();
      }
      if (attempts.length >= maxReloads) {
        return false;
      }
      attempts.push(current);
      return true;
    },
    get used() {
      return attempts.length;
    },
  };
}

/**
 * @param {any} browserWindow Electron BrowserWindow (or a compatible fake)
 * @param {object} [options]
 * @param {string} [options.name] Label used in logs and dialogs
 * @param {{ showMessageBox?: Function }} [options.dialog] Electron dialog module
 * @param {{ info?: Function, warn?: Function, error?: Function }} [options.logger]
 * @param {() => number} [options.now]
 * @param {Function} [options.setTimeoutFn]
 * @param {Function} [options.clearTimeoutFn]
 * @param {() => void} [options.onGiveUp] Called when the reload budget is spent and the user picks "Close"
 * @param {number} [options.maxReloads]
 * @param {number} [options.reloadWindowMs]
 * @param {number} [options.reloadDelayMs]
 * @param {number} [options.unresponsiveDialogDelayMs]
 * @returns {() => void} detach function
 */
function attachWindowResilience(browserWindow, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const name = settings.name || "window";
  const logger = settings.logger || console;
  const now = settings.now || Date.now;
  const setTimeoutFn = settings.setTimeoutFn || setTimeout;
  const clearTimeoutFn = settings.clearTimeoutFn || clearTimeout;
  const dialog = settings.dialog || null;
  const webContents = browserWindow?.webContents;

  if (!browserWindow || !webContents || typeof webContents.on !== "function") {
    return () => {};
  }

  const budget = createReloadBudget({
    maxReloads: settings.maxReloads,
    reloadWindowMs: settings.reloadWindowMs,
    now,
  });
  let reloadTimer = null;
  let unresponsiveTimer = null;
  let dialogOpen = false;
  let detached = false;

  const isAlive = () =>
    !detached &&
    !(typeof browserWindow.isDestroyed === "function" && browserWindow.isDestroyed()) &&
    !(typeof webContents.isDestroyed === "function" && webContents.isDestroyed());

  const reloadNow = () => {
    if (!isAlive()) {
      return;
    }
    try {
      webContents.reload();
    } catch (error) {
      logger.error?.(`[window:${name}] Reload failed:`, error);
    }
  };

  const askUser = async (message, detail, buttons) => {
    if (!dialog || typeof dialog.showMessageBox !== "function" || dialogOpen) {
      return -1;
    }
    dialogOpen = true;
    try {
      const result = await dialog.showMessageBox(browserWindow, {
        type: "warning",
        title: "F95Launcher",
        message,
        detail,
        buttons,
        defaultId: 0,
        cancelId: buttons.length - 1,
        noLink: true,
      });
      return typeof result?.response === "number" ? result.response : -1;
    } catch (error) {
      logger.error?.(`[window:${name}] Recovery dialog failed:`, error);
      return -1;
    } finally {
      dialogOpen = false;
    }
  };

  const scheduleReload = (reason) => {
    if (reloadTimer) {
      return true;
    }
    if (!budget.tryConsume()) {
      return false;
    }
    logger.warn?.(
      `[window:${name}] Reloading after ${reason} (attempt ${budget.used}/${settings.maxReloads}).`,
    );
    reloadTimer = setTimeoutFn(() => {
      reloadTimer = null;
      reloadNow();
    }, settings.reloadDelayMs);
    return true;
  };

  const handleBudgetSpent = async (reason) => {
    logger.error?.(
      `[window:${name}] Renderer failed repeatedly (${reason}); asking the user.`,
    );
    const response = await askUser(
      "The F95Launcher window keeps failing to load.",
      `Reason: ${reason}. You can try reloading it once more or close it.`,
      ["Reload", "Close"],
    );
    if (response === 0) {
      reloadNow();
    } else if (response === 1 && isAlive()) {
      if (typeof settings.onGiveUp === "function") {
        settings.onGiveUp();
      } else if (typeof browserWindow.close === "function") {
        browserWindow.close();
      }
    }
  };

  const onRenderProcessGone = (event, details) => {
    const reason = String(details?.reason || "unknown");
    logger.error?.(
      `[window:${name}] Renderer process gone: ${reason} (exit code ${details?.exitCode ?? "n/a"}).`,
    );
    if (!RECOVERABLE_GONE_REASONS.has(reason) || !isAlive()) {
      return;
    }
    if (!scheduleReload(`renderer ${reason}`)) {
      void handleBudgetSpent(`renderer ${reason}`);
    }
  };

  const onDidFailLoad = (
    event,
    errorCode,
    errorDescription,
    validatedURL,
    isMainFrame,
  ) => {
    if (errorCode === ERR_ABORTED || isMainFrame === false) {
      return;
    }
    logger.error?.(
      `[window:${name}] Failed to load ${validatedURL || "page"}: ${errorDescription} (${errorCode}).`,
    );
    if (!scheduleReload(`load failure ${errorCode}`)) {
      void handleBudgetSpent(`load failure: ${errorDescription || errorCode}`);
    }
  };

  const onUnresponsive = () => {
    logger.warn?.(`[window:${name}] Renderer became unresponsive.`);
    if (unresponsiveTimer) {
      return;
    }
    unresponsiveTimer = setTimeoutFn(async () => {
      unresponsiveTimer = null;
      if (!isAlive()) {
        return;
      }
      const response = await askUser(
        "F95Launcher is not responding.",
        "The window has been busy for a while. You can keep waiting or reload it.",
        ["Keep waiting", "Reload window"],
      );
      if (response === 1) {
        reloadNow();
      }
    }, settings.unresponsiveDialogDelayMs);
  };

  const onResponsive = () => {
    if (unresponsiveTimer) {
      clearTimeoutFn(unresponsiveTimer);
      unresponsiveTimer = null;
      logger.info?.(`[window:${name}] Renderer is responsive again.`);
    }
  };

  const onPreloadError = (event, preloadPath, error) => {
    logger.error?.(`[window:${name}] Preload script failed (${preloadPath}):`, error);
  };

  webContents.on("render-process-gone", onRenderProcessGone);
  webContents.on("did-fail-load", onDidFailLoad);
  webContents.on("preload-error", onPreloadError);
  if (typeof browserWindow.on === "function") {
    browserWindow.on("unresponsive", onUnresponsive);
    browserWindow.on("responsive", onResponsive);
  }

  const detach = () => {
    if (detached) {
      return;
    }
    detached = true;
    if (reloadTimer) {
      clearTimeoutFn(reloadTimer);
      reloadTimer = null;
    }
    if (unresponsiveTimer) {
      clearTimeoutFn(unresponsiveTimer);
      unresponsiveTimer = null;
    }
    const off = (emitter, eventName, listener) => {
      if (emitter && typeof emitter.removeListener === "function") {
        emitter.removeListener(eventName, listener);
      }
    };
    off(webContents, "render-process-gone", onRenderProcessGone);
    off(webContents, "did-fail-load", onDidFailLoad);
    off(webContents, "preload-error", onPreloadError);
    off(browserWindow, "unresponsive", onUnresponsive);
    off(browserWindow, "responsive", onResponsive);
  };

  if (typeof browserWindow.once === "function") {
    browserWindow.once("closed", detach);
  }

  return detach;
}

module.exports = {
  attachWindowResilience,
  createReloadBudget,
  RECOVERABLE_GONE_REASONS,
};
