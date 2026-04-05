// @ts-check

const { openDatabase } = require("./db/openDatabase");
const { clearScanCandidates } = require("./db/scanCandidatesStore");
const { clearScanJobs } = require("./db/scanJobsStore");

/**
 * @param {string} message
 * @param {string} code
 * @returns {{ success: false, error: { code: string, message: string } }}
 */
function failure(message, code) {
  return {
    success: false,
    error: {
      code,
      message,
    },
  };
}

/**
 * Clears persisted scan history without touching installed library records.
 *
 * @param {any} appPaths
 * @returns {Promise<{ success: true, clearedCandidates: number, clearedJobs: number } | { success: false, error: { code: string, message: string } }>}
 */
async function resetScanCache(appPaths) {
  try {
    console.log("[scan.cache] Reset requested");
    const db = await openDatabase(appPaths);

    const { deleted: clearedCandidates } = await clearScanCandidates(db);
    const { deleted: clearedJobs } = await clearScanJobs(db);

    console.log("[scan.cache] Reset complete", {
      clearedCandidates,
      clearedJobs,
    });

    return {
      success: true,
      clearedCandidates,
      clearedJobs,
    };
  } catch (error) {
    console.error("[scan.cache] Reset failed", error);
    return failure(
      "Failed to reset library scan cache",
      "SCAN_CACHE_RESET_FAILED",
    );
  }
}

module.exports = {
  resetScanCache,
};
