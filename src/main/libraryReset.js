// @ts-check

const fs = require("fs");
const path = require("path");

/**
 * Tables that describe the local library index. They are wiped by a reset,
 * child tables first so foreign keys stay consistent.
 */
const LIBRARY_RESET_TABLES = Object.freeze([
  "tag_mappings",
  "atlas_mappings",
  "steam_mappings",
  "f95_zone_mappings",
  "save_profiles",
  "save_sync_state",
  "banners",
  "previews",
  "scan_candidates",
  "scan_jobs",
  "versions",
  "library_live_versions",
  "games",
]);

/**
 * Tables a reset must never touch: the downloaded Atlas/F95 catalog, the
 * user's scan folders, emulators, tags and pending account-library deletes.
 */
const LIBRARY_RESET_PRESERVED_TABLES = Object.freeze([
  "atlas_data",
  "f95_zone_data",
  "updates",
  "tags",
  "emulators",
  "scan_sources",
  "cloud_library_delete_queue",
]);

/** Sub-folder of `appPaths.backups` that holds library database snapshots. */
const LIBRARY_BACKUP_DIRECTORY_NAME = "library_index";

/**
 * @param {{ run: Function }} db
 * @param {string} sql
 * @param {unknown[]=} params
 * @returns {Promise<{ changes?: number, lastID?: number }>}
 */
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this || {});
    });
  });
}

/**
 * @param {{ all: Function }} db
 * @param {string} sql
 * @param {unknown[]=} params
 * @returns {Promise<any[]>}
 */
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatBackupStamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * @param {string} basePath
 * @returns {string}
 */
function ensureUnusedFilePath(basePath) {
  if (!fs.existsSync(basePath)) {
    return basePath;
  }

  const extension = path.extname(basePath);
  const stem = basePath.slice(0, basePath.length - extension.length);
  let attempt = 1;
  let candidate = basePath;
  while (fs.existsSync(candidate)) {
    candidate = `${stem}-${attempt++}${extension}`;
  }
  return candidate;
}

/**
 * Writes a consistent copy of the open database before anything is deleted.
 * `VACUUM INTO` produces a clean snapshot even while the connection is open;
 * a plain file copy is the fallback for SQLite builds without it.
 *
 * @param {{ appPaths: { db: string, backups: string }, db: any, now?: () => Date, logger?: { warn: Function }, fileNamePrefix?: string }} input
 * @returns {Promise<string>}
 */
async function backupDatabaseFile(input) {
  const now = typeof input.now === "function" ? input.now() : new Date();
  const backupDirectory = path.join(
    input.appPaths.backups,
    LIBRARY_BACKUP_DIRECTORY_NAME,
  );
  await fs.promises.mkdir(backupDirectory, { recursive: true });
  const targetPath = ensureUnusedFilePath(
    path.join(
      backupDirectory,
      `${input.fileNamePrefix || "library"}-${formatBackupStamp(now)}.db`,
    ),
  );

  try {
    await run(input.db, `VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
  } catch (error) {
    (input.logger || console).warn(
      "[library.reset] VACUUM INTO failed, copying the database file instead:",
      error instanceof Error ? error.message : String(error),
    );
    await fs.promises.rm(targetPath, { force: true }).catch(() => {});
    await fs.promises.copyFile(input.appPaths.db, targetPath);
  }

  const stats = await fs.promises.stat(targetPath);
  if (!stats.size) {
    throw new Error("The backup file is empty.");
  }

  return targetPath;
}

/**
 * @param {string} code
 * @param {string} message
 * @param {string=} backupPath
 */
function failure(code, message, backupPath = "") {
  return {
    success: /** @type {const} */ (false),
    error: { code, message },
    backupPath,
  };
}

/**
 * Wipes the local library index (games, versions, mappings, cached images,
 * save profile metadata, scan history) after backing the database up.
 *
 * The Atlas/F95 catalog, scan folders, emulators, the save vault on disk and
 * pending account-library deletes are preserved. Nothing inside game folders
 * is touched.
 *
 * @param {{
 *   appPaths: { db: string, backups: string, images: string },
 *   db: any,
 *   backupDatabase?: (input: { appPaths: any, db: any, now?: () => Date, logger?: any }) => Promise<string>,
 *   now?: () => Date,
 *   logger?: { warn: Function, info?: Function }
 * }} input
 */
async function resetLibraryIndex(input) {
  const logger = input.logger || console;
  const backupDatabase = input.backupDatabase || backupDatabaseFile;

  let backupPath = "";
  try {
    backupPath = await backupDatabase({
      appPaths: input.appPaths,
      db: input.db,
      now: input.now,
      logger,
    });
  } catch (error) {
    logger.warn(
      "[library.reset] Backup failed, the library was left untouched:",
      error instanceof Error ? error.message : String(error),
    );
    return failure(
      "LIBRARY_RESET_BACKUP_FAILED",
      "The library could not be backed up, so nothing was reset.",
    );
  }

  /** @type {number[]} */
  let recordIds = [];
  /** @type {Record<string, number>} */
  const cleared = {};

  try {
    const rows = await all(input.db, "SELECT record_id FROM games");
    recordIds = rows
      .map((row) => Number(row?.record_id))
      .filter((recordId) => Number.isInteger(recordId) && recordId > 0);

    await run(input.db, "BEGIN IMMEDIATE TRANSACTION");
    try {
      for (const table of LIBRARY_RESET_TABLES) {
        const result = await run(input.db, `DELETE FROM ${table}`);
        cleared[table] = Number(result?.changes || 0);
      }
      await run(input.db, "COMMIT");
    } catch (error) {
      await run(input.db, "ROLLBACK").catch(() => {});
      throw error;
    }
  } catch (error) {
    logger.warn(
      "[library.reset] Reset failed and was rolled back:",
      error instanceof Error ? error.message : String(error),
    );
    return failure(
      "LIBRARY_RESET_FAILED",
      "The library index could not be cleared. Your library was not changed.",
      backupPath,
    );
  }

  // Record ids restart from 1 after the wipe (no AUTOINCREMENT), so every
  // per-record image folder goes, including leftovers of games deleted
  // earlier: otherwise a new game could inherit an old banner.
  /** @type {string[]} */
  const removedImageDirectories = [];
  const imageFolderNames = new Set(recordIds.map((recordId) => String(recordId)));
  try {
    for (const entry of await fs.promises.readdir(input.appPaths.images, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory() && /^\d+$/.test(entry.name)) {
        imageFolderNames.add(entry.name);
      }
    }
  } catch {
    // No image cache yet.
  }
  for (const folderName of imageFolderNames) {
    const imageDirectory = path.join(input.appPaths.images, folderName);
    try {
      if (!fs.existsSync(imageDirectory)) {
        continue;
      }
      await fs.promises.rm(imageDirectory, { recursive: true, force: true });
      removedImageDirectories.push(imageDirectory);
    } catch (error) {
      logger.warn("[library.reset] Could not remove cached images:", {
        imageDirectory,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    success: /** @type {const} */ (true),
    backupPath,
    cleared,
    removedRecordIds: recordIds,
    removedImageDirectories,
  };
}

module.exports = {
  LIBRARY_BACKUP_DIRECTORY_NAME,
  LIBRARY_RESET_PRESERVED_TABLES,
  LIBRARY_RESET_TABLES,
  backupDatabaseFile,
  resetLibraryIndex,
};
