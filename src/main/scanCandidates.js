// @ts-check

const { openDatabase } = require("./db/openDatabase");
const {
  listScanCandidates,
  markScanCandidateImported,
} = require("./db/scanCandidatesStore");

/**
 * @param {any} appPaths
 * @param {number=} limit
 */
async function getRecentScanCandidates(appPaths, limit = 20) {
  const db = await openDatabase(appPaths);
  return listScanCandidates(db, limit);
}

/**
 * @param {any} appPaths
 * @param {string} folderPath
 * @param {number} recordId
 */
async function markImportedCandidate(appPaths, folderPath, recordId) {
  const db = await openDatabase(appPaths);
  return markScanCandidateImported(db, folderPath, recordId);
}

module.exports = {
  getRecentScanCandidates,
  markImportedCandidate,
};
