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
 * @param {any} db
 * @param {string} sql
 * @returns {Promise<number>}
 */
function runDelete(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, [], function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(Number(this?.changes || 0));
    });
  });
}

/**
 * Clears persisted scan history (candidates, jobs) and the cached live
 * thread versions without touching installed library records, so the next
 * scan and thread check start from a blank slate.
 *
 * @param {any} appPaths
 * @returns {Promise<{ success: true, clearedCandidates: number, clearedJobs: number, clearedLiveVersions: number } | { success: false, error: { code: string, message: string } }>}
 */
async function resetScanCache(appPaths) {
  try {
    console.log("[scan.cache] Reset requested");
    const db = await openDatabase(appPaths);

    const { deleted: clearedCandidates } = await clearScanCandidates(db);
    const { deleted: clearedJobs } = await clearScanJobs(db);
    const clearedLiveVersions = await runDelete(
      db,
      "DELETE FROM library_live_versions",
    ).catch(() => 0);

    console.log("[scan.cache] Reset complete", {
      clearedCandidates,
      clearedJobs,
      clearedLiveVersions,
    });

    return {
      success: true,
      clearedCandidates,
      clearedJobs,
      clearedLiveVersions,
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
