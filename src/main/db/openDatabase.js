// @ts-check

const sqlite3 = require("sqlite3").verbose();
const { resolveDatabasePaths } = require("../databasePaths");
const { runMigrations } = require("./runMigrations");

let db = null;
let initializedDbPath = null;
let databaseInitialization = null;

/**
 * @param {string | { data?: string, db?: string }} dataDirOrPaths
 * @param {{ sqliteModule?: typeof sqlite3 }=} options
 * @returns {Promise<import("sqlite3").Database>}
 */
function openDatabase(dataDirOrPaths, options = {}) {
  const databasePaths = resolveDatabasePaths(dataDirOrPaths);
  const sqliteModule = options.sqliteModule || sqlite3;

  if (db && initializedDbPath === databasePaths.db) {
    return databaseInitialization || Promise.resolve(db);
  }

  if (databaseInitialization && initializedDbPath === databasePaths.db) {
    return databaseInitialization;
  }

  initializedDbPath = databasePaths.db;
  databaseInitialization = new Promise((resolve, reject) => {
    /** @type {import("sqlite3").Database | null} */
    let databaseInstance = null;

    databaseInstance = new sqliteModule.Database(databasePaths.db, async (err) => {
      if (err) {
        console.error("Database error:", err);
        databaseInitialization = null;
        reject(err);
        return;
      }

      db = databaseInstance;

      try {
        await runMigrations(db);
        resolve(db);
      } catch (migrationError) {
        databaseInitialization = null;
        reject(migrationError);
      }
    });
  });

  return databaseInitialization;
}

module.exports = {
  openDatabase,
};
