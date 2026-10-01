// @ts-check

/**
 * Keeps the app's own metadata catalog (table f95_catalog) in step with the
 * F95 "Latest Updates" list. Two modes, chosen automatically:
 *
 *  - full: every page, newest first, with the next page stored after each
 *    one so an interrupted run (network, app closed) continues where it
 *    stopped instead of starting over;
 *  - incremental (once a full run has finished): pages from the top until a
 *    row older than the newest update already stored shows up, i.e. until
 *    the list reaches rows the catalog has seen in their current state.
 *
 * Every page is validated (parser), written in one transaction (store) and
 * followed by a pause; a failed request is retried with a growing delay,
 * and a failure that survives the retries keeps the pages already written.
 * Nothing runs without an F95 session, and two runs never overlap.
 */

const {
  CATALOG_CATEGORY,
  LATEST_PAGE_URL,
  buildListUrl,
  parseDefinitions,
  parseListResponse,
  resolveDefinitions,
} = require("./f95CatalogParser");
const store = require("../db/f95CatalogStore");

const CATALOG_SYNC_DEFAULTS = Object.freeze({
  delayBetweenPagesMs: 1200,
  retryAttempts: 4,
  retryBaseDelayMs: 2000,
  maxIncrementalPages: 40,
  definitionsMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
});

const LOG_SCOPE = "[catalog.sync]";

class CatalogSyncError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, retryable?: boolean, status?: number }} options
   */
  constructor(message, options) {
    super(message);
    this.name = "CatalogSyncError";
    this.code = options.code;
    this.retryable = Boolean(options.retryable);
    this.status = options.status || 0;
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || "unknown error");
}

/**
 * @typedef {{
 *   success: boolean,
 *   mode: "full" | "incremental" | "none",
 *   reason: string,
 *   pagesFetched: number,
 *   entriesWritten: number,
 *   added: number,
 *   changed: number,
 *   versionChanged: number,
 *   fullDone: boolean,
 *   totalPages: number,
 *   entryCount: number,
 *   skippedReason: string,
 *   error: string,
 *   message: string,
 *   startedAt: string,
 *   finishedAt: string,
 * }} CatalogSyncSummary
 */

/**
 * @param {{
 *   db: any,
 *   fetchText: (url: string, init?: { json?: boolean }) => Promise<{ status: number, text: string }>,
 *   hasSession: () => Promise<boolean> | boolean,
 *   logger?: { info?: Function, warn?: Function, error?: Function },
 *   now?: () => Date,
 *   sleep?: (ms: number) => Promise<void>,
 *   onProgress?: (payload: { text: string, progress: number, total: number }) => void,
 *   delayBetweenPagesMs?: number,
 *   retryAttempts?: number,
 *   retryBaseDelayMs?: number,
 *   maxIncrementalPages?: number,
 *   definitionsMaxAgeMs?: number,
 * }} deps
 */
function createF95CatalogSync(deps) {
  const logger = deps.logger || console;
  const now = typeof deps.now === "function" ? deps.now : () => new Date();
  const sleep =
    typeof deps.sleep === "function"
      ? deps.sleep
      : (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const delayBetweenPagesMs = Number.isFinite(deps.delayBetweenPagesMs)
    ? Math.max(0, Number(deps.delayBetweenPagesMs))
    : CATALOG_SYNC_DEFAULTS.delayBetweenPagesMs;
  const retryAttempts = Number.isInteger(deps.retryAttempts)
    ? Math.max(1, Number(deps.retryAttempts))
    : CATALOG_SYNC_DEFAULTS.retryAttempts;
  const retryBaseDelayMs = Number.isFinite(deps.retryBaseDelayMs)
    ? Math.max(0, Number(deps.retryBaseDelayMs))
    : CATALOG_SYNC_DEFAULTS.retryBaseDelayMs;
  const maxIncrementalPages = Number.isInteger(deps.maxIncrementalPages)
    ? Math.max(1, Number(deps.maxIncrementalPages))
    : CATALOG_SYNC_DEFAULTS.maxIncrementalPages;
  const definitionsMaxAgeMs = Number.isFinite(deps.definitionsMaxAgeMs)
    ? Math.max(0, Number(deps.definitionsMaxAgeMs))
    : CATALOG_SYNC_DEFAULTS.definitionsMaxAgeMs;

  /** @type {Promise<CatalogSyncSummary> | null} */
  let currentRun = null;
  /** @type {CatalogSyncSummary | null} */
  let lastSummary = null;
  let cancelRequested = false;

  /**
   * @param {"info" | "warn" | "error"} level
   * @param {string} message
   * @param {unknown=} details
   */
  function log(level, message, details) {
    const method = logger[level];
    if (typeof method !== "function") {
      return;
    }
    if (details === undefined) {
      method.call(logger, `${LOG_SCOPE} ${message}`);
    } else {
      method.call(logger, `${LOG_SCOPE} ${message}`, details);
    }
  }

  /**
   * @param {{ text: string, progress: number, total: number }} payload
   */
  function progress(payload) {
    if (typeof deps.onProgress !== "function") {
      return;
    }
    try {
      deps.onProgress(payload);
    } catch {
      // Progress listeners never break the sync.
    }
  }

  /**
   * One request with retries. Network errors, 429 and 5xx are retried;
   * a login page or a site error is final.
   * @param {string} url
   * @param {{ json: boolean }} options
   * @returns {Promise<string>}
   */
  async function fetchWithRetry(url, options) {
    let lastError = null;
    for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
      if (cancelRequested) {
        throw new CatalogSyncError("The catalog sync was cancelled.", { code: "cancelled" });
      }
      try {
        const response = await deps.fetchText(url, { json: options.json });
        const status = Number(response?.status) || 0;
        if (status === 429 || (status >= 500 && status <= 599)) {
          throw new CatalogSyncError(`F95 answered HTTP ${status}.`, { code: "http", retryable: true, status });
        }
        if (status === 401 || status === 403) {
          throw new CatalogSyncError(`F95 refused the request (HTTP ${status}): sign in again.`, {
            code: "session",
            status,
          });
        }
        if (status < 200 || status >= 300) {
          throw new CatalogSyncError(`F95 answered HTTP ${status}.`, { code: "http", status });
        }
        return String(response.text || "");
      } catch (error) {
        const syncError =
          error instanceof CatalogSyncError
            ? error
            : new CatalogSyncError(`F95 could not be reached: ${describeError(error)}`, {
                code: "network",
                retryable: true,
              });
        lastError = syncError;
        if (!syncError.retryable || attempt === retryAttempts) {
          throw syncError;
        }
        const delay = retryBaseDelayMs * 2 ** (attempt - 1);
        log("warn", `Request failed, retrying in ${delay} ms (${attempt}/${retryAttempts}):`, syncError.message);
        await sleep(delay);
      }
    }
    throw lastError || new CatalogSyncError("The request failed.", { code: "network" });
  }

  /**
   * Prefix and tag names: refreshed from the page when missing or old,
   * otherwise the stored copy is used.
   * @param {Awaited<ReturnType<typeof store.getCatalogSyncState>>} state
   */
  async function resolveCurrentDefinitions(state) {
    const storedAt = Date.parse(state.definitionsAt || "");
    const fresh =
      state.definitions &&
      Number.isFinite(storedAt) &&
      now().getTime() - storedAt < definitionsMaxAgeMs;
    if (fresh) {
      return state.definitions;
    }
    try {
      const html = await fetchWithRetry(LATEST_PAGE_URL, { json: false });
      const parsed = parseDefinitions(html, { category: CATALOG_CATEGORY });
      if (parsed.ok && parsed.definitions) {
        await store.saveCatalogSyncState(deps.db, {
          definitions: parsed.definitions,
          definitionsAt: now().toISOString(),
        });
        return parsed.definitions;
      }
      log("warn", "Could not read prefix definitions from the page:", parsed.error);
    } catch (error) {
      if (error instanceof CatalogSyncError && (error.code === "session" || error.code === "cancelled")) {
        throw error;
      }
      log("warn", "Could not load the Latest Updates page for definitions:", describeError(error));
    }
    return state.definitions || null;
  }

  /**
   * @param {number} page
   * @param {import("./f95CatalogParser").CatalogDefinitions | null} definitions
   */
  async function fetchPage(page, definitions) {
    const text = await fetchWithRetry(buildListUrl({ page }), { json: true });
    const parsed = parseListResponse(text, resolveDefinitions(definitions), { category: CATALOG_CATEGORY });
    if (!parsed.ok) {
      throw new CatalogSyncError(parsed.error, {
        code: parsed.code === "not-json" && /session/i.test(parsed.error) ? "session" : "bad-response",
      });
    }
    return parsed;
  }

  /**
   * @param {CatalogSyncSummary} summary
   * @param {import("./f95CatalogParser").CatalogEntry[]} entries
   */
  async function writePage(summary, entries) {
    const result = await store.upsertCatalogEntries(deps.db, entries, { now });
    summary.entriesWritten += result.written;
    summary.added += result.added;
    summary.changed += result.changed;
    summary.versionChanged += result.versionChanged;
    return result;
  }

  /**
   * @param {string} reason
   * @param {"auto" | "full" | "incremental"} requestedMode
   * @returns {Promise<CatalogSyncSummary>}
   */
  async function execute(reason, requestedMode) {
    const startedAt = now().toISOString();
    /** @type {CatalogSyncSummary} */
    const summary = {
      success: false,
      mode: "none",
      reason,
      pagesFetched: 0,
      entriesWritten: 0,
      added: 0,
      changed: 0,
      versionChanged: 0,
      fullDone: false,
      totalPages: 0,
      entryCount: 0,
      skippedReason: "",
      error: "",
      message: "",
      startedAt,
      finishedAt: "",
    };

    let hasSession = false;
    try {
      hasSession = Boolean(await deps.hasSession());
    } catch (error) {
      log("warn", "Could not read the F95 session state:", describeError(error));
    }
    if (!hasSession) {
      summary.skippedReason = "no-session";
      summary.message = "Sign in to F95 to update the game catalog.";
      summary.success = true;
      summary.finishedAt = now().toISOString();
      log("info", "Skipped: no F95 session.", { reason });
      return summary;
    }

    const state = await store.getCatalogSyncState(deps.db);
    summary.fullDone = state.fullDone;
    summary.totalPages = state.totalPages;
    summary.entryCount = state.entryCount;
    await store.saveCatalogSyncState(deps.db, { lastRunAt: startedAt });

    const mode = requestedMode === "auto" ? (state.fullDone ? "incremental" : "full") : requestedMode;
    summary.mode = mode;
    progress({ text: "Reading the F95 catalog…", progress: 0, total: 0 });

    try {
      const definitions = await resolveCurrentDefinitions(state);

      if (mode === "full") {
        await runFull(summary, definitions, state.fullNextPage, state.newestTs);
      } else {
        await runIncremental(summary, definitions, state.newestTs);
      }
      summary.success = true;
      await store.saveCatalogSyncState(deps.db, { lastSuccessAt: now().toISOString(), lastError: "" });
    } catch (error) {
      const message = describeError(error);
      summary.error = message;
      summary.success = false;
      summary.skippedReason = error instanceof CatalogSyncError ? error.code : "";
      await store.saveCatalogSyncState(deps.db, { lastError: message }).catch(() => {});
      log(error instanceof CatalogSyncError && error.code === "cancelled" ? "info" : "warn", "Run stopped:", {
        reason,
        mode,
        pagesFetched: summary.pagesFetched,
        error: message,
      });
    } finally {
      const after = await store.getCatalogSyncState(deps.db).catch(() => null);
      if (after) {
        summary.fullDone = after.fullDone;
        summary.totalPages = after.totalPages;
        summary.entryCount = after.entryCount;
      }
      summary.finishedAt = now().toISOString();
      if (!summary.message) {
        summary.message = summary.success
          ? summary.changed > 0
            ? `Catalog updated: ${summary.changed} entries changed (${summary.added} new).`
            : "The catalog is up to date."
          : `Catalog sync stopped: ${summary.error}`;
      }
      progress({ text: summary.message, progress: summary.pagesFetched, total: summary.totalPages });
    }
    return summary;
  }

  /**
   * @param {CatalogSyncSummary} summary
   * @param {import("./f95CatalogParser").CatalogDefinitions | null} definitions
   * @param {number} startPage
   * @param {number} knownNewestTs
   */
  async function runFull(summary, definitions, startPage, knownNewestTs) {
    let page = Math.max(1, startPage);
    let totalPages = 0;
    let newestTs = knownNewestTs;
    for (;;) {
      if (cancelRequested) {
        throw new CatalogSyncError("The catalog sync was cancelled.", { code: "cancelled" });
      }
      const parsed = await fetchPage(page, definitions);
      summary.pagesFetched += 1;
      totalPages = parsed.totalPages || totalPages;
      if (parsed.page && parsed.page < page) {
        // Asked past the end: the site clamps to its last page.
        break;
      }
      await writePage(summary, parsed.entries);
      for (const entry of parsed.entries) {
        newestTs = Math.max(newestTs, entry.updatedTs);
      }
      const done = totalPages > 0 ? page >= totalPages : parsed.entries.length === 0;
      await store.saveCatalogSyncState(deps.db, {
        fullNextPage: done ? 1 : page + 1,
        totalPages,
        newestTs,
        ...(done ? { fullDone: true } : {}),
      });
      progress({
        text: `Reading the F95 catalog: page ${page}${totalPages ? ` of ${totalPages}` : ""}`,
        progress: page,
        total: totalPages,
      });
      if (done) {
        break;
      }
      page += 1;
      if (delayBetweenPagesMs > 0) {
        await sleep(delayBetweenPagesMs);
      }
    }
    summary.fullDone = true;
    summary.totalPages = totalPages;
    log("info", "Full catalog sync finished.", { pages: summary.pagesFetched, written: summary.entriesWritten });
  }

  /**
   * @param {CatalogSyncSummary} summary
   * @param {import("./f95CatalogParser").CatalogDefinitions | null} definitions
   * @param {number} knownNewestTs
   */
  async function runIncremental(summary, definitions, knownNewestTs) {
    let page = 1;
    let newestTs = knownNewestTs;
    let totalPages = 0;
    for (;;) {
      if (cancelRequested) {
        throw new CatalogSyncError("The catalog sync was cancelled.", { code: "cancelled" });
      }
      const parsed = await fetchPage(page, definitions);
      summary.pagesFetched += 1;
      totalPages = parsed.totalPages || totalPages;
      await writePage(summary, parsed.entries);
      let reachedKnown = parsed.entries.length === 0;
      for (const entry of parsed.entries) {
        newestTs = Math.max(newestTs, entry.updatedTs);
        if (entry.updatedTs <= knownNewestTs) {
          reachedKnown = true;
        }
      }
      await store.saveCatalogSyncState(deps.db, { newestTs, totalPages });
      progress({
        text: `Checking F95 for updates: page ${page}`,
        progress: page,
        total: totalPages,
      });
      if (reachedKnown || (totalPages > 0 && page >= totalPages)) {
        break;
      }
      if (page >= maxIncrementalPages) {
        // Too much happened since the last run (weeks away): finish the rest
        // as a full pass from here, so nothing is skipped.
        log("info", "Incremental window exhausted; continuing as a full pass.", { page });
        await store.saveCatalogSyncState(deps.db, { fullDone: false, fullNextPage: page + 1 });
        summary.mode = "full";
        await runFull(summary, definitions, page + 1, newestTs);
        return;
      }
      page += 1;
      if (delayBetweenPagesMs > 0) {
        await sleep(delayBetweenPagesMs);
      }
    }
    log("info", "Incremental catalog sync finished.", {
      pages: summary.pagesFetched,
      changed: summary.changed,
      added: summary.added,
    });
  }

  return {
    /**
     * @param {{ reason?: string, mode?: "auto" | "full" | "incremental" }=} options
     */
    run(options = {}) {
      if (currentRun) {
        return currentRun;
      }
      cancelRequested = false;
      currentRun = execute(String(options.reason || "manual"), options.mode || "auto").then(
        (summary) => {
          lastSummary = summary;
          currentRun = null;
          return summary;
        },
        (error) => {
          currentRun = null;
          throw error;
        },
      );
      return currentRun;
    },
    cancel() {
      if (currentRun) {
        cancelRequested = true;
      }
    },
    isRunning: () => currentRun !== null,
    getLastSummary: () => lastSummary,
    getState: () => store.getCatalogSyncState(deps.db),
  };
}

module.exports = {
  CATALOG_SYNC_DEFAULTS,
  CatalogSyncError,
  createF95CatalogSync,
};
