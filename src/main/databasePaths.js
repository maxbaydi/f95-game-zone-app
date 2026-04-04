// @ts-check

const path = require("path");

/**
 * @param {string | { data?: string, db?: string }} dataDirOrPaths
 * @returns {{ data?: string, db: string }}
 */
function resolveDatabasePaths(dataDirOrPaths) {
  if (typeof dataDirOrPaths === "string") {
    return {
      data: dataDirOrPaths,
      db: path.join(dataDirOrPaths, "data.db"),
    };
  }

  return {
    ...dataDirOrPaths,
    db: dataDirOrPaths.db || path.join(dataDirOrPaths.data || "", "data.db"),
  };
}

module.exports = {
  resolveDatabasePaths,
};
