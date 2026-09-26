/**
 * "Finish this step in the browser" flow for one download.
 *
 * Some mirrors need a human once: a captcha, a Cloudflare check, a
 * link-protector page. Instead of failing and asking the user to press
 * Retry afterwards, the app opens the mirror page in the embedded browser
 * (same session as the downloader, so cookies such as cf_clearance are
 * shared) and quietly re-resolves the mirror after every navigation and on
 * a timer. The first successful resolution hands the prepared download back
 * to the caller, which starts the transfer; a file download the user
 * triggers inside the window is adopted by the caller as well.
 *
 * Pure module: the Electron window is injected as an adapter so the flow can
 * be unit-tested with fake timers and a fake window.
 */
const {
  DownloadCancelledError,
  MirrorActionRequiredError,
  MirrorError,
  isTransientError,
} = require("./hosts/common");

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_NAVIGATION_DEBOUNCE_MS = 1200;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * @typedef {{
 *   onNavigated: (callback: (info: {url?: string}) => void) => (() => void) | void,
 *   onClosed: (callback: () => void) => (() => void) | void,
 *   close: () => void,
 *   isOpen: () => boolean,
 *   webContentsId?: number,
 * }} ActionWindow
 */

/**
 * @param {{
 *   actionUrl: string,
 *   openWindow: (url: string) => ActionWindow,
 *   resolveMirror: (signal: AbortSignal) => Promise<any>,
 *   onResolved: (prepared: any) => void,
 *   onGaveUp: (error: Error) => void,
 *   onStatus?: (text: string) => void,
 *   hostLabel?: string,
 *   pollIntervalMs?: number,
 *   navigationDebounceMs?: number,
 *   timeoutMs?: number,
 *   timers?: {setTimeout: Function, clearTimeout: Function},
 *   logger?: {warn: Function},
 * }} input
 */
function createMirrorActionFlow(input) {
  const timers = input.timers || { setTimeout, clearTimeout };
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const navigationDebounceMs =
    input.navigationDebounceMs ?? DEFAULT_NAVIGATION_DEBOUNCE_MS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const hostLabel = input.hostLabel || "This mirror";

  let actionUrl = String(input.actionUrl || "");
  /** @type {ActionWindow | null} */
  let window = null;
  let active = false;
  let attemptInFlight = false;
  let attemptQueued = false;
  let controller = new AbortController();
  let pollTimer = null;
  let debounceTimer = null;
  let timeoutTimer = null;
  /** @type {Array<() => void>} */
  let unsubscribers = [];

  const report = (text) => {
    if (typeof input.onStatus === "function") {
      try {
        input.onStatus(text);
      } catch {
        // Status reporting must never break the flow.
      }
    }
  };

  const clearTimers = () => {
    for (const timer of [pollTimer, debounceTimer, timeoutTimer]) {
      if (timer !== null) {
        timers.clearTimeout(timer);
      }
    }
    pollTimer = null;
    debounceTimer = null;
    timeoutTimer = null;
  };

  const unsubscribe = () => {
    for (const dispose of unsubscribers.splice(0)) {
      try {
        dispose();
      } catch {
        // ignore
      }
    }
  };

  /**
   * @param {{closeWindow?: boolean}} [options]
   */
  const finish = (options = {}) => {
    if (!active) {
      return;
    }
    active = false;
    clearTimers();
    unsubscribe();
    controller.abort(new DownloadCancelledError());
    if (options.closeWindow !== false && window && window.isOpen()) {
      try {
        window.close();
      } catch {
        // ignore
      }
    }
  };

  const giveUp = (error) => {
    finish();
    input.onGaveUp(error);
  };

  const schedulePoll = () => {
    if (!active || pollTimer !== null || pollIntervalMs <= 0) {
      return;
    }
    pollTimer = timers.setTimeout(() => {
      pollTimer = null;
      void attempt();
    }, pollIntervalMs);
  };

  const attempt = async () => {
    if (!active) {
      return;
    }
    if (attemptInFlight) {
      attemptQueued = true;
      return;
    }
    attemptInFlight = true;
    const attemptController = controller;
    try {
      const prepared = await input.resolveMirror(attemptController.signal);
      if (!active || attemptController.signal.aborted) {
        return;
      }
      finish();
      input.onResolved(prepared);
      return;
    } catch (error) {
      if (!active || attemptController.signal.aborted) {
        return;
      }
      if (error instanceof MirrorActionRequiredError) {
        const nextUrl = String(error.actionUrl || "").trim();
        if (nextUrl && nextUrl !== actionUrl && window) {
          actionUrl = nextUrl;
          openWindow(nextUrl);
        }
      } else if (error instanceof DownloadCancelledError) {
        return;
      } else if (!isTransientError(error)) {
        giveUp(error);
        return;
      } else if (input.logger) {
        input.logger.warn("[mirror.action] transient error while waiting:", error);
      }
    } finally {
      attemptInFlight = false;
    }
    if (attemptQueued) {
      attemptQueued = false;
      void attempt();
      return;
    }
    schedulePoll();
  };

  const scheduleAttemptAfterNavigation = () => {
    if (!active) {
      return;
    }
    if (debounceTimer !== null) {
      timers.clearTimeout(debounceTimer);
    }
    debounceTimer = timers.setTimeout(() => {
      debounceTimer = null;
      void attempt();
    }, navigationDebounceMs);
  };

  const openWindow = (url) => {
    unsubscribe();
    window = input.openWindow(url);
    const offNavigated = window.onNavigated(() => scheduleAttemptAfterNavigation());
    const offClosed = window.onClosed(() => {
      if (!active) {
        return;
      }
      giveUp(
        new MirrorActionRequiredError(
          `${hostLabel} still needs the browser step. Open the mirror again to finish it, then the download continues on its own.`,
          { code: "captcha_required", actionUrl, hostLabel },
        ),
      );
    });
    if (typeof offNavigated === "function") {
      unsubscribers.push(offNavigated);
    }
    if (typeof offClosed === "function") {
      unsubscribers.push(offClosed);
    }
  };

  return {
    start() {
      if (active) {
        return;
      }
      active = true;
      controller = new AbortController();
      report(
        `${hostLabel} needs a quick step in the browser window. Finish it there — the download continues automatically.`,
      );
      openWindow(actionUrl);
      if (timeoutMs > 0) {
        timeoutTimer = timers.setTimeout(() => {
          timeoutTimer = null;
          giveUp(
            new MirrorError(
              `${hostLabel} was not unlocked within ${Math.round(timeoutMs / 60000)} minutes. Open the mirror again to retry.`,
              { code: "action_timeout", actionUrl },
            ),
          );
        }, timeoutMs);
      }
      schedulePoll();
    },
    stop() {
      finish();
    },
    /** The user started the file download inside the window: hand over. */
    adoptDownload() {
      finish({ closeWindow: false });
    },
    isActive: () => active,
    /** @param {number} webContentsId */
    matchesWebContents(webContentsId) {
      return Boolean(
        active &&
          window &&
          window.webContentsId !== undefined &&
          window.webContentsId === webContentsId,
      );
    },
    get actionUrl() {
      return actionUrl;
    },
  };
}

module.exports = {
  DEFAULT_NAVIGATION_DEBOUNCE_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  createMirrorActionFlow,
};
