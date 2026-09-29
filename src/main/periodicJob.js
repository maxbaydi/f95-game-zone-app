// @ts-check

/**
 * A background job that repeats every `intervalMs` while the app runs and can
 * be kicked early (after the PC wakes up, after a sign-in). Runs never
 * overlap: a kick while a run is in progress is ignored, and the interval is
 * counted from the end of the last run. Timers are unref'd so a pending job
 * never keeps the process alive.
 *
 * @param {{
 *   name: string,
 *   intervalMs: number,
 *   run: (reason: string) => Promise<unknown> | unknown,
 *   isEnabled?: () => boolean,
 *   setTimer?: (callback: () => void, delay: number) => any,
 *   clearTimer?: (id: any) => void,
 *   now?: () => number,
 *   logger?: { warn?: Function, error?: Function },
 * }} options
 */
function createPeriodicJob(options) {
  const intervalMs = Math.max(60 * 1000, Number(options.intervalMs) || 0);
  const setTimer =
    typeof options.setTimer === "function"
      ? options.setTimer
      : (/** @type {() => void} */ callback, /** @type {number} */ delay) => {
          const timer = setTimeout(callback, delay);
          if (timer && typeof timer.unref === "function") {
            timer.unref();
          }
          return timer;
        };
  const clearTimer =
    typeof options.clearTimer === "function"
      ? options.clearTimer
      : (/** @type {any} */ id) => clearTimeout(id);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const logger = options.logger || console;

  /** @type {any} */
  let timerId = null;
  /** @type {Promise<unknown> | null} */
  let currentRun = null;
  /** @type {number | null} */
  let lastRunAt = null;
  /** @type {number | null} */
  let nextRunAt = null;
  let started = false;

  const isEnabled = () => {
    try {
      return typeof options.isEnabled === "function" ? options.isEnabled() !== false : true;
    } catch {
      return true;
    }
  };

  /**
   * @param {number} delay
   */
  function schedule(delay) {
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }
    if (!started) {
      nextRunAt = null;
      return;
    }
    const safeDelay = Math.max(0, Number(delay) || 0);
    nextRunAt = now() + safeDelay;
    timerId = setTimer(() => {
      timerId = null;
      void runNow("interval");
    }, safeDelay);
  }

  /**
   * @param {string} reason
   * @returns {Promise<unknown>}
   */
  function runNow(reason = "manual") {
    if (currentRun) {
      return currentRun;
    }
    if (!isEnabled()) {
      schedule(intervalMs);
      return Promise.resolve(null);
    }
    currentRun = Promise.resolve()
      .then(() => options.run(reason))
      .catch((error) => {
        if (typeof logger.warn === "function") {
          logger.warn(`[job:${options.name}] Run failed (${reason}):`, error instanceof Error ? error.message : String(error));
        }
        return null;
      })
      .finally(() => {
        currentRun = null;
        lastRunAt = now();
        schedule(intervalMs);
      });
    return currentRun;
  }

  return {
    /**
     * @param {{ initialDelayMs?: number }=} startOptions
     */
    start(startOptions = {}) {
      if (started) {
        return;
      }
      started = true;
      schedule(Number.isFinite(startOptions.initialDelayMs) ? Number(startOptions.initialDelayMs) : intervalMs);
    },
    stop() {
      started = false;
      schedule(0);
    },
    runNow,
    /**
     * A kick with a short delay (after the PC wakes up, the network is not
     * ready immediately): only when nothing is running already.
     * @param {string} reason
     * @param {number} delayMs
     */
    kick(reason, delayMs) {
      if (!started || currentRun) {
        return;
      }
      if (timerId !== null) {
        clearTimer(timerId);
        timerId = null;
      }
      const safeDelay = Math.max(0, Number(delayMs) || 0);
      nextRunAt = now() + safeDelay;
      timerId = setTimer(() => {
        timerId = null;
        void runNow(reason);
      }, safeDelay);
    },
    getState() {
      return {
        started,
        running: currentRun !== null,
        lastRunAt: lastRunAt === null ? "" : new Date(lastRunAt).toISOString(),
        nextRunAt: nextRunAt === null ? "" : new Date(nextRunAt).toISOString(),
      };
    },
  };
}

module.exports = {
  createPeriodicJob,
};
