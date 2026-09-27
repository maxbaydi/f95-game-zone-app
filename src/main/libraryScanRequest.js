// @ts-check

/**
 * Library scan modes:
 *
 * - `incremental`: find games in folders the library does not know yet
 * - `refresh`: re-check every folder and update the stored records in place
 * - `reset_cache`: drop the scan history first, then refresh (ADR 0004)
 * - `reset_library`: back up and wipe the local library index, then scan
 *   everything from scratch; needs `confirm: true` (ADR 0008)
 */
const LIBRARY_SCAN_MODES = Object.freeze({
  INCREMENTAL: "incremental",
  REFRESH: "refresh",
  RESET_CACHE: "reset_cache",
  RESET_LIBRARY: "reset_library",
});

const MODE_LABELS = Object.freeze({
  [LIBRARY_SCAN_MODES.INCREMENTAL]: "Find new games",
  [LIBRARY_SCAN_MODES.REFRESH]: "Refresh installed games",
  [LIBRARY_SCAN_MODES.RESET_CACHE]: "Reset scan cache and rescan",
  [LIBRARY_SCAN_MODES.RESET_LIBRARY]: "Rebuild the library from scratch",
});

/** @type {Set<string>} */
const KNOWN_MODES = new Set(Object.values(LIBRARY_SCAN_MODES));

/**
 * @typedef {{
 *   mode: string,
 *   resetCache: boolean,
 *   forceRescan: boolean,
 *   resetLibrary: boolean,
 *   confirmed: boolean
 * }} LibraryScanRequest
 */

/**
 * Accepts the new `{ mode }` payload as well as the legacy
 * `{ resetCache, forceRescan }` flags.
 *
 * @param {any} request
 * @returns {LibraryScanRequest}
 */
function normalizeLibraryScanRequest(request) {
  const input = request && typeof request === "object" ? request : {};
  const requestedMode = String(input.mode || "").trim().toLowerCase();

  /** @type {string} */
  let mode = LIBRARY_SCAN_MODES.INCREMENTAL;
  if (KNOWN_MODES.has(requestedMode)) {
    mode = requestedMode;
  } else if (input.resetCache) {
    mode = LIBRARY_SCAN_MODES.RESET_CACHE;
  } else if (input.forceRescan) {
    mode = LIBRARY_SCAN_MODES.REFRESH;
  }

  const resetLibrary = mode === LIBRARY_SCAN_MODES.RESET_LIBRARY;

  return {
    mode,
    resetCache: mode === LIBRARY_SCAN_MODES.RESET_CACHE || resetLibrary,
    forceRescan: mode !== LIBRARY_SCAN_MODES.INCREMENTAL,
    resetLibrary,
    confirmed: input.confirm === true,
  };
}

/**
 * @param {string} mode
 * @returns {string}
 */
function describeLibraryScanMode(mode) {
  return MODE_LABELS[String(mode || "")] || MODE_LABELS[LIBRARY_SCAN_MODES.INCREMENTAL];
}

module.exports = {
  LIBRARY_SCAN_MODES,
  describeLibraryScanMode,
  normalizeLibraryScanRequest,
};
