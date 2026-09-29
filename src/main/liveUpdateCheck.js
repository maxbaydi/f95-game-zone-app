// @ts-check

/**
 * Background check of the live F95 threads of installed games (ADR 0009).
 *
 * The Atlas catalog is refreshed in batches and can lag behind the site for
 * days; the thread title always carries the current version. The checker
 * opens the threads of installed games (favorites first) one at a time with a
 * pause between them, stores the version it read and never runs twice at the
 * same time. Without an F95 session nothing is inspected.
 */

const HOUR_MS = 60 * 60 * 1000;
const LOG_SCOPE = "[library.live]";

const LIVE_UPDATE_DEFAULTS = Object.freeze({
  favoritesOnly: true,
  intervalMs: 6 * HOUR_MS,
  staleAfterMs: 6 * HOUR_MS,
  delayBetweenMs: 1500,
  limit: 40,
});

/**
 * @param {any} game
 * @returns {boolean}
 */
function isInstalledGame(game) {
  if (typeof game?.installState === "string" && game.installState) {
    return game.installState === "installed";
  }
  return Array.isArray(game?.versions) && game.versions.length > 0;
}

/**
 * @param {unknown} value
 * @returns {number | null} time in ms, null when missing or invalid
 */
function parseTime(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const time = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}

/**
 * Games whose thread should be checked now: installed, with a thread link,
 * favorites first (only favorites when `favoritesOnly`), skipping games that
 * were checked less than `staleAfterMs` ago unless `force`.
 *
 * @param {any[] | null | undefined} games
 * @param {{
 *   favoritesOnly?: boolean,
 *   limit?: number,
 *   staleAfterMs?: number,
 *   now?: number,
 *   force?: boolean
 * }=} options
 * @returns {any[]}
 */
function selectLiveUpdateTargets(games, options = {}) {
  const favoritesOnly = options.favoritesOnly !== false;
  const limit =
    Number.isInteger(options.limit) && Number(options.limit) > 0
      ? Number(options.limit)
      : LIVE_UPDATE_DEFAULTS.limit;
  const staleAfterMs =
    Number(options.staleAfterMs) >= 0 && options.staleAfterMs !== undefined
      ? Number(options.staleAfterMs)
      : LIVE_UPDATE_DEFAULTS.staleAfterMs;
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const force = options.force === true;

  const candidates = (Array.isArray(games) ? games : []).filter((game) => {
    if (!game || typeof game !== "object") {
      return false;
    }
    if (!isInstalledGame(game) || !String(game.siteUrl || "").trim()) {
      return false;
    }
    if (favoritesOnly && !game.isFavorite) {
      return false;
    }
    if (!force) {
      const checkedAt = parseTime(game.liveCheckedAt);
      if (checkedAt !== null && now - checkedAt < staleAfterMs) {
        return false;
      }
    }
    return true;
  });

  const favorites = candidates.filter((game) => Boolean(game.isFavorite));
  const others = candidates.filter((game) => !game.isFavorite);
  return [...favorites, ...others].slice(0, limit);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeCheckError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return "The thread could not be checked.";
}

/**
 * @typedef {{
 *   reason: string,
 *   startedAt: string,
 *   finishedAt: string,
 *   checked: number,
 *   updated: number,
 *   failed: number,
 *   skippedReason: string,
 *   checkedRecordIds: number[]
 * }} LiveUpdateRunSummary
 */

/**
 * @param {{
 *   listGames: () => Promise<any[]> | any[],
 *   inspectThread: (threadUrl: string) => Promise<any>,
 *   saveResult: (result: { recordId: number, threadUrl: string, version: string, title: string, checkedAt: string, error: string }) => Promise<unknown> | unknown,
 *   isAuthenticated: () => Promise<boolean> | boolean,
 *   intervalMs?: number,
 *   staleAfterMs?: number,
 *   delayBetweenMs?: number,
 *   limit?: number,
 *   favoritesOnly?: boolean | (() => boolean),
 *   now?: () => number,
 *   setTimer?: (callback: () => any, delay: number) => any,
 *   clearTimer?: (id: any) => void,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   logger?: { info?: Function, warn?: Function, error?: Function },
 *   onRunFinished?: (summary: LiveUpdateRunSummary) => unknown
 * }} options
 */
function createLiveUpdateChecker(options) {
  const intervalMs =
    Number(options.intervalMs) > 0 ? Number(options.intervalMs) : LIVE_UPDATE_DEFAULTS.intervalMs;
  const staleAfterMs =
    Number(options.staleAfterMs) >= 0 && options.staleAfterMs !== undefined
      ? Number(options.staleAfterMs)
      : LIVE_UPDATE_DEFAULTS.staleAfterMs;
  const delayBetweenMs =
    Number(options.delayBetweenMs) >= 0 && options.delayBetweenMs !== undefined
      ? Number(options.delayBetweenMs)
      : LIVE_UPDATE_DEFAULTS.delayBetweenMs;
  const limit =
    Number.isInteger(options.limit) && Number(options.limit) > 0
      ? Number(options.limit)
      : LIVE_UPDATE_DEFAULTS.limit;
  // A function is read on every run so a settings change applies without a
  // restart ("check all installed games" vs. favorites only).
  const resolveDefaultFavoritesOnly = () => {
    if (typeof options.favoritesOnly === "function") {
      try {
        return options.favoritesOnly() !== false;
      } catch {
        return true;
      }
    }
    return options.favoritesOnly !== false;
  };
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const setTimer =
    typeof options.setTimer === "function"
      ? options.setTimer
      : (/** @type {() => any} */ callback, /** @type {number} */ delay) => {
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
  const sleep =
    typeof options.sleep === "function"
      ? options.sleep
      : (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const logger = options.logger || console;

  /** @type {Promise<LiveUpdateRunSummary> | null} */
  let currentRun = null;
  /** @type {LiveUpdateRunSummary | null} */
  let lastRun = null;
  /** @type {any} */
  let timerId = null;
  /** @type {number | null} */
  let nextRunAt = null;
  let started = false;
  // Bumped by forget(): a run started before a library reset must not store
  // results under record ids that no longer exist (or belong to new games).
  let generation = 0;

  /**
   * @param {string} level
   * @param {string} message
   * @param {unknown=} details
   */
  const log = (level, message, details) => {
    const method = /** @type {any} */ (logger)[level];
    if (typeof method === "function") {
      method.call(logger, `${LOG_SCOPE} ${message}`, details === undefined ? "" : details);
    }
  };

  /**
   * @param {{ reason: string, force: boolean, favoritesOnly: boolean }} request
   * @returns {Promise<LiveUpdateRunSummary>}
   */
  async function executeRun(request) {
    /** @type {LiveUpdateRunSummary} */
    const summary = {
      reason: request.reason,
      startedAt: new Date(now()).toISOString(),
      finishedAt: "",
      checked: 0,
      updated: 0,
      failed: 0,
      skippedReason: "",
      checkedRecordIds: [],
    };

    let authenticated = false;
    try {
      authenticated = Boolean(await options.isAuthenticated());
    } catch (error) {
      log("warn", "Could not read the F95 session state:", describeCheckError(error));
      authenticated = false;
    }

    if (!authenticated) {
      summary.skippedReason = "not_authenticated";
      summary.finishedAt = new Date(now()).toISOString();
      log("info", "Skipped: no F95 session.", { reason: request.reason });
      return summary;
    }

    const runGeneration = generation;
    const games = await options.listGames();
    const targets = selectLiveUpdateTargets(games, {
      favoritesOnly: request.favoritesOnly,
      limit,
      staleAfterMs,
      now: now(),
      force: request.force,
    });
    log("info", "Run started.", {
      reason: request.reason,
      targets: targets.length,
      force: request.force,
      favoritesOnly: request.favoritesOnly,
    });

    for (let index = 0; index < targets.length; index += 1) {
      if (index > 0 && delayBetweenMs > 0) {
        await sleep(delayBetweenMs);
      }

      const game = targets[index];
      const recordId = Number(game.record_id);
      const threadUrl = String(game.siteUrl || "").trim();
      summary.checked += 1;
      summary.checkedRecordIds.push(recordId);

      let result;
      try {
        const payload = await options.inspectThread(threadUrl);
        if (!payload || payload.success === false) {
          throw new Error(
            (payload && typeof payload.error === "string" && payload.error) ||
              "The thread could not be read.",
          );
        }
        result = {
          recordId,
          threadUrl,
          version: String(payload.version || "").trim(),
          title: String(payload.title || "").trim(),
          checkedAt: new Date(now()).toISOString(),
          error: "",
        };
        if (result.version && result.version !== String(game.liveVersion || "")) {
          summary.updated += 1;
        }
      } catch (error) {
        summary.failed += 1;
        result = {
          recordId,
          threadUrl,
          version: "",
          title: "",
          checkedAt: new Date(now()).toISOString(),
          error: describeCheckError(error),
        };
        log("warn", "Thread check failed:", { recordId, error: result.error });
      }

      if (runGeneration !== generation) {
        summary.skippedReason = "library_reset";
        log("info", "Run abandoned: the library was reset meanwhile.", {
          reason: request.reason,
        });
        break;
      }

      try {
        await options.saveResult(result);
      } catch (error) {
        log("error", "Could not store the thread check:", {
          recordId,
          error: describeCheckError(error),
        });
      }
    }

    summary.finishedAt = new Date(now()).toISOString();
    log("info", "Run finished.", {
      reason: summary.reason,
      checked: summary.checked,
      updated: summary.updated,
      failed: summary.failed,
    });
    return summary;
  }

  /**
   * Starts a run, or returns the run that is already in progress.
   *
   * @param {{ reason?: string, force?: boolean, favoritesOnly?: boolean }=} request
   * @returns {Promise<LiveUpdateRunSummary>}
   */
  function runNow(request = {}) {
    if (currentRun) {
      return currentRun;
    }

    const normalizedRequest = {
      reason: String(request.reason || "manual"),
      force: request.force === true,
      favoritesOnly:
        typeof request.favoritesOnly === "boolean"
          ? request.favoritesOnly
          : resolveDefaultFavoritesOnly(),
    };

    currentRun = executeRun(normalizedRequest)
      .catch((error) => {
        log("error", "Run failed:", describeCheckError(error));
        /** @type {LiveUpdateRunSummary} */
        const failedSummary = {
          reason: normalizedRequest.reason,
          startedAt: new Date(now()).toISOString(),
          finishedAt: new Date(now()).toISOString(),
          checked: 0,
          updated: 0,
          failed: 0,
          skippedReason: "error",
          checkedRecordIds: [],
        };
        return failedSummary;
      })
      .then(async (summary) => {
        lastRun = summary;
        currentRun = null;
        if (typeof options.onRunFinished === "function") {
          try {
            await options.onRunFinished(summary);
          } catch (error) {
            log("error", "Run follow-up failed:", describeCheckError(error));
          }
        }
        return summary;
      });

    return currentRun;
  }

  function scheduleNext() {
    if (!started) {
      return;
    }
    if (timerId !== null) {
      clearTimer(timerId);
    }
    nextRunAt = now() + intervalMs;
    timerId = setTimer(async () => {
      timerId = null;
      nextRunAt = null;
      try {
        await runNow({ reason: "interval" });
      } finally {
        scheduleNext();
      }
    }, intervalMs);
  }

  function start() {
    if (started) {
      return;
    }
    started = true;
    scheduleNext();
  }

  function stop() {
    started = false;
    if (timerId !== null) {
      clearTimer(timerId);
    }
    timerId = null;
    nextRunAt = null;
  }

  function getState() {
    return {
      running: Boolean(currentRun),
      lastRun,
      nextRunAt,
    };
  }

  /**
   * The library index was wiped: drop the last summary (its record ids are
   * meaningless now) and make a run in progress stop storing results.
   */
  function forget() {
    generation += 1;
    lastRun = null;
  }

  return {
    forget,
    getState,
    runNow,
    start,
    stop,
  };
}

module.exports = {
  LIVE_UPDATE_DEFAULTS,
  createLiveUpdateChecker,
  selectLiveUpdateTargets,
};
