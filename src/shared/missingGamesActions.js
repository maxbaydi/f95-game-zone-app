(function attachMissingGamesActions(globalScope) {
  /**
   * Bulk actions for library games whose files are missing on this PC:
   * which games can be reinstalled from their thread, and a one-at-a-time
   * reinstall queue driven by the download list. Pure functions, shared by the
   * renderer (window.missingGamesActions) and tests.
   */

  /** Download statuses that end one reinstall step. */
  const REINSTALL_TERMINAL_STATUSES = Object.freeze([
    "completed",
    "error",
    "cancelled",
    "action",
  ]);

  const TERMINAL_STATUS_SET = new Set(REINSTALL_TERMINAL_STATUSES);

  /**
   * The shared install-state helper: a global in the renderer, a module in
   * Node (main process and tests).
   *
   * @returns {any}
   */
  function getInstallStateApi() {
    if (globalScope && globalScope.libraryInstallState) {
      return globalScope.libraryInstallState;
    }
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      try {
        return require("./libraryInstallState");
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * @param {any} game
   * @returns {string}
   */
  function readInstallState(game) {
    const shared = getInstallStateApi();
    if (shared && typeof shared.getLibraryInstallState === "function") {
      return shared.getLibraryInstallState(game);
    }
    return String((game && game.installState) || "");
  }

  /**
   * @param {any[]} games
   * @returns {any[]}
   */
  function selectMissingGames(games) {
    return (Array.isArray(games) ? games : []).filter(
      (game) => game && typeof game === "object" && readInstallState(game) === "missing",
    );
  }

  /**
   * @param {any} game
   * @returns {boolean}
   */
  function hasThread(game) {
    return Boolean(String((game && game.siteUrl) || "").trim());
  }

  /**
   * Games with a linked thread can be reinstalled automatically; the others
   * have nowhere to download from.
   *
   * @param {any[]} games
   * @returns {{ reinstallable: any[], unlinkable: any[] }}
   */
  function partitionReinstallableGames(games) {
    const reinstallable = [];
    const unlinkable = [];
    for (const game of Array.isArray(games) ? games : []) {
      if (!game || typeof game !== "object") {
        continue;
      }
      if (hasThread(game)) {
        reinstallable.push(game);
      } else {
        unlinkable.push(game);
      }
    }
    return { reinstallable, unlinkable };
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function normalizeThreadKey(value) {
    return String(value == null ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/\/+$/, "");
  }

  /**
   * @param {unknown} status
   * @returns {boolean}
   */
  function isTerminalDownloadStatus(status) {
    return TERMINAL_STATUS_SET.has(String(status || ""));
  }

  /**
   * @param {any[]} games
   */
  function createReinstallQueue(games) {
    return {
      pending: (Array.isArray(games) ? games : []).filter(
        (game) => game && typeof game === "object",
      ),
      active: null,
      activeStartedAt: null,
      done: [],
      isFinished: false,
    };
  }

  /**
   * The newest download entry for the thread of `game`, or null.
   *
   * @param {any[]} downloads
   * @param {any} game
   * @param {number=} notBefore ignore entries last updated before this time
   * @returns {any | null}
   */
  function findDownloadForGame(downloads, game, notBefore) {
    const key = normalizeThreadKey(game && game.siteUrl);
    if (!key) {
      return null;
    }

    let best = null;
    for (const entry of Array.isArray(downloads) ? downloads : []) {
      if (!entry || normalizeThreadKey(entry.threadUrl) !== key) {
        continue;
      }
      const updatedAt = Number(entry.updatedAt) || 0;
      if (typeof notBefore === "number" && updatedAt < notBefore) {
        continue;
      }
      if (!best || updatedAt > (Number(best.updatedAt) || 0)) {
        best = entry;
      }
    }
    return best;
  }

  /**
   * @param {any} queue
   */
  function copyQueue(queue) {
    return {
      pending: Array.isArray(queue && queue.pending) ? [...queue.pending] : [],
      active: (queue && queue.active) || null,
      activeStartedAt:
        queue && typeof queue.activeStartedAt === "number" ? queue.activeStartedAt : null,
      done: Array.isArray(queue && queue.done) ? [...queue.done] : [],
      isFinished: Boolean(queue && queue.isFinished),
    };
  }

  /**
   * One tick of the reinstall queue. When the active game's download (started
   * at or after the step began) reached a terminal status, the game moves to
   * `done` and the next pending game becomes active and is returned as
   * `next`, so the caller can start its install. Never mutates `queue`.
   *
   * @param {any} queue
   * @param {any[]} downloads
   * @param {number} now
   * @returns {{ queue: any, next: any | null, finished: { game: any, status: string } | null }}
   */
  function advanceReinstallQueue(queue, downloads, now) {
    const nextQueue = copyQueue(queue);
    /** @type {{ game: any, status: string } | null} */
    let finished = null;

    if (nextQueue.active) {
      const notBefore =
        typeof nextQueue.activeStartedAt === "number" ? nextQueue.activeStartedAt : 0;
      const download = findDownloadForGame(downloads, nextQueue.active, notBefore);
      if (!download || !isTerminalDownloadStatus(download.status)) {
        return { queue: nextQueue, next: null, finished: null };
      }

      finished = { game: nextQueue.active, status: String(download.status) };
      nextQueue.done = [...nextQueue.done, finished];
      nextQueue.active = null;
      nextQueue.activeStartedAt = null;
    }

    let next = null;
    if (nextQueue.pending.length > 0) {
      next = nextQueue.pending[0];
      nextQueue.pending = nextQueue.pending.slice(1);
      nextQueue.active = next;
      nextQueue.activeStartedAt = Number(now) || 0;
      nextQueue.isFinished = false;
    } else {
      nextQueue.isFinished = true;
    }

    return { queue: nextQueue, next, finished };
  }

  /**
   * Ends the active step without a download (no mirror, thread unavailable,
   * install could not be queued).
   *
   * @param {any} queue
   * @param {string} status
   */
  function markReinstallStepFailed(queue, status) {
    const nextQueue = copyQueue(queue);
    if (!nextQueue.active) {
      return nextQueue;
    }

    nextQueue.done = [
      ...nextQueue.done,
      { game: nextQueue.active, status: String(status || "error") },
    ];
    nextQueue.active = null;
    nextQueue.activeStartedAt = null;
    return nextQueue;
  }

  /**
   * Groups finished steps for the summary shown to the user.
   *
   * @param {any} queue
   * @returns {{ completed: any[], failed: any[], needsAction: any[], noMirror: any[] }}
   */
  function summarizeReinstallQueue(queue) {
    const summary = { completed: [], failed: [], needsAction: [], noMirror: [] };
    for (const entry of Array.isArray(queue && queue.done) ? queue.done : []) {
      if (!entry || !entry.game) {
        continue;
      }
      if (entry.status === "completed") {
        summary.completed.push(entry.game);
      } else if (entry.status === "action") {
        summary.needsAction.push(entry.game);
      } else if (entry.status === "no_mirror") {
        summary.noMirror.push(entry.game);
      } else {
        summary.failed.push(entry.game);
      }
    }
    return summary;
  }

  const api = {
    REINSTALL_TERMINAL_STATUSES,
    selectMissingGames,
    partitionReinstallableGames,
    normalizeThreadKey,
    isTerminalDownloadStatus,
    createReinstallQueue,
    findDownloadForGame,
    advanceReinstallQueue,
    markReinstallStepFailed,
    summarizeReinstallQueue,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.missingGamesActions = api;
  }
})(globalThis);
