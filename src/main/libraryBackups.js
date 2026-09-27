// @ts-check

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const {
  LIBRARY_BACKUP_DIRECTORY_NAME,
  LIBRARY_RESET_TABLES,
  backupDatabaseFile,
} = require("./libraryReset");
const { resolveStoredImagePath } = require("./assetPaths");

const LOG_SCOPE = "[library.backups]";
const BACKUP_FILE_STAMP_PATTERN = /-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?\.db$/i;
const RESTORE_SCHEMA_NAME = "restore_src";

/**
 * @typedef {{
 *   path: string,
 *   fileName: string,
 *   createdAt: string,
 *   sizeBytes: number,
 *   gameCount: number | null
 * }} LibraryBackupEntry
 */

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
 * @param {{ backups: string }} appPaths
 * @returns {string}
 */
function getLibraryBackupDirectory(appPaths) {
  return path.join(appPaths.backups, LIBRARY_BACKUP_DIRECTORY_NAME);
}

/**
 * @param {string} targetPath
 * @returns {string}
 */
function toComparablePath(targetPath) {
  const resolved = path.resolve(targetPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * True when `targetPath` is a file directly inside the library backups folder
 * (no traversal, no sub-folders, no other location on disk).
 *
 * @param {{ backups: string }} appPaths
 * @param {string} targetPath
 * @returns {boolean}
 */
function isPathInsideLibraryBackups(appPaths, targetPath) {
  const candidate = typeof targetPath === "string" ? targetPath.trim() : "";
  if (!candidate || !appPaths?.backups) {
    return false;
  }

  const directory = toComparablePath(getLibraryBackupDirectory(appPaths));
  const resolved = path.resolve(candidate);
  return (
    toComparablePath(path.dirname(resolved)) === directory &&
    Boolean(path.basename(resolved))
  );
}

/**
 * Creation time of a snapshot: the stamp in its file name
 * (`library-YYYYMMDD-HHmmss.db`, local time) or the file time.
 *
 * @param {string} fileName
 * @param {fs.Stats} stats
 * @returns {Date}
 */
function resolveBackupDate(fileName, stats) {
  const match = BACKUP_FILE_STAMP_PATTERN.exec(fileName);
  if (match) {
    const [, year, month, day, hours, minutes, seconds] = match.map(Number);
    const stamped = new Date(year, month - 1, day, hours, minutes, seconds);
    if (!Number.isNaN(stamped.getTime())) {
      return stamped;
    }
  }
  return stats.mtime;
}

/**
 * Number of games in a snapshot, read through a read-only connection; null
 * when the file cannot be read as a library database.
 *
 * @param {string} filePath
 * @returns {Promise<number | null>}
 */
function readBackupGameCount(filePath) {
  return new Promise((resolve) => {
    /** @type {import("sqlite3").Database | null} */
    let connection = null;
    const finish = (/** @type {number | null} */ value) => {
      if (!connection) {
        resolve(value);
        return;
      }
      connection.close(() => resolve(value));
    };

    connection = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (openError) => {
      if (openError) {
        connection = null;
        resolve(null);
        return;
      }

      /** @type {import("sqlite3").Database} */ (connection).get(
        "SELECT COUNT(*) AS count FROM games",
        (queryError, row) => {
          const count = Number(/** @type {any} */ (row)?.count);
          finish(queryError || !Number.isFinite(count) ? null : count);
        },
      );
    });
  });
}

/**
 * Library database snapshots, newest first.
 *
 * @param {{ appPaths: { backups: string } }} input
 * @returns {Promise<LibraryBackupEntry[]>}
 */
async function listLibraryBackups(input) {
  const directory = getLibraryBackupDirectory(input.appPaths);
  /** @type {fs.Dirent[]} */
  let entries = [];
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== "ENOENT") {
      console.warn(`${LOG_SCOPE} Could not read the backups folder:`, {
        directory,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return [];
  }

  /** @type {Array<LibraryBackupEntry & { sortTime: number }>} */
  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".db") {
      continue;
    }

    const filePath = path.join(directory, entry.name);
    try {
      const stats = await fs.promises.stat(filePath);
      const createdAt = resolveBackupDate(entry.name, stats);
      backups.push({
        path: filePath,
        fileName: entry.name,
        createdAt: createdAt.toISOString(),
        sizeBytes: stats.size,
        gameCount: await readBackupGameCount(filePath),
        sortTime: createdAt.getTime(),
      });
    } catch (error) {
      console.warn(`${LOG_SCOPE} Skipping unreadable backup:`, {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  backups.sort(
    (left, right) =>
      right.sortTime - left.sortTime || right.fileName.localeCompare(left.fileName),
  );

  return backups.map((backup) => ({
    path: backup.path,
    fileName: backup.fileName,
    createdAt: backup.createdAt,
    sizeBytes: backup.sizeBytes,
    gameCount: backup.gameCount,
  }));
}

/**
 * @param {string} code
 * @param {string} message
 */
function restoreFailure(code, message) {
  return {
    success: /** @type {const} */ (false),
    error: { code, message },
  };
}

/**
 * @param {{ all: Function }} db
 * @param {string} schema
 * @param {string} table
 * @returns {Promise<string[]>}
 */
async function readColumns(db, schema, table) {
  const rows = await all(db, `PRAGMA ${schema}.table_info(${table})`);
  return rows.map((row) => String(row?.name || "")).filter(Boolean);
}

/**
 * @param {{ all: Function }} db
 * @returns {Promise<Map<number, string>>}
 */
async function readGameIdentities(db) {
  const rows = await all(db, "SELECT record_id, title, creator FROM games");
  /** @type {Map<number, string>} */
  const identities = new Map();
  for (const row of rows) {
    const recordId = Number(row?.record_id);
    if (Number.isInteger(recordId) && recordId > 0) {
      identities.set(
        recordId,
        `${String(row?.title || "")}\u0000${String(row?.creator || "")}`,
      );
    }
  }
  return identities;
}

/**
 * Cached images belong to a record id. After a restore the same id can name
 * a different game, so the image folders of records that were replaced by
 * something else are removed, and image rows that point to files that no
 * longer exist are dropped (the card falls back to the site banner and the
 * banner is downloaded again by the caller).
 *
 * @param {{
 *   db: any,
 *   appPaths: { images: string, root: string },
 *   previousGames: Map<number, string>,
 *   restoredGames: Map<number, string>,
 *   logger: { warn: Function }
 * }} input
 */
async function reconcileCachedImages(input) {
  /** @type {string[]} */
  const removedImageDirectories = [];
  for (const [recordId, identity] of input.previousGames) {
    if (input.restoredGames.get(recordId) === identity) {
      continue;
    }
    const imageDirectory = path.join(input.appPaths.images, String(recordId));
    try {
      if (fs.existsSync(imageDirectory)) {
        await fs.promises.rm(imageDirectory, { recursive: true, force: true });
        removedImageDirectories.push(imageDirectory);
      }
    } catch (error) {
      input.logger.warn(`${LOG_SCOPE} Could not remove cached images:`, {
        imageDirectory,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const table of ["banners", "previews"]) {
    try {
      const rows = await all(input.db, `SELECT rowid AS row_id, path FROM ${table}`);
      for (const row of rows) {
        const resolved = resolveStoredImagePath(input.appPaths, String(row?.path || ""));
        if (!resolved || !fs.existsSync(resolved)) {
          await run(input.db, `DELETE FROM ${table} WHERE rowid = ?`, [row.row_id]);
        }
      }
    } catch (error) {
      input.logger.warn(`${LOG_SCOPE} Could not tidy cached image rows:`, {
        table,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return removedImageDirectories;
}

/**
 * Replaces the local library index with the one stored in a snapshot.
 *
 * The current database is backed up first. The snapshot is attached, its
 * tables and columns are read before anything is deleted (a file that is not
 * a library database fails here), then every library table is cleared and
 * refilled in one transaction using only the columns both schemas share. Any
 * failure rolls the transaction back and leaves the library unchanged. The
 * catalog, scan folders, emulators and game files are never touched.
 *
 * @param {{
 *   appPaths: { db: string, backups: string, images: string, root: string },
 *   db: any,
 *   backupPath: string,
 *   backupDatabase?: (input: { appPaths: any, db: any, now?: () => Date, logger?: any }) => Promise<string>,
 *   now?: () => Date,
 *   logger?: { warn: Function, info?: Function }
 * }} input
 */
async function restoreLibraryBackup(input) {
  const logger = input.logger || console;
  const backupPath = typeof input.backupPath === "string" ? input.backupPath.trim() : "";

  if (!isPathInsideLibraryBackups(input.appPaths, backupPath)) {
    return restoreFailure(
      "LIBRARY_BACKUP_OUTSIDE_FOLDER",
      "Only library backups made by F95Launcher can be restored.",
    );
  }

  let isFile = false;
  try {
    isFile = (await fs.promises.stat(backupPath)).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    return restoreFailure(
      "LIBRARY_BACKUP_NOT_FOUND",
      "This backup no longer exists. Refresh the list and pick another one.",
    );
  }

  const backupDatabase = input.backupDatabase || backupDatabaseFile;
  let safetyBackupPath = "";
  try {
    safetyBackupPath = await backupDatabase({
      appPaths: input.appPaths,
      db: input.db,
      now: input.now,
      logger,
    });
  } catch (error) {
    logger.warn(
      `${LOG_SCOPE} Safety backup failed, the library was left untouched:`,
      error instanceof Error ? error.message : String(error),
    );
    return restoreFailure(
      "LIBRARY_RESTORE_BACKUP_FAILED",
      "Your current library could not be backed up first, so nothing was restored.",
    );
  }

  /** @type {Record<string, number>} */
  const restored = {};
  /** @type {Map<number, string>} */
  let previousGames = new Map();
  let attached = false;

  try {
    previousGames = await readGameIdentities(input.db);

    await run(input.db, `ATTACH DATABASE ? AS ${RESTORE_SCHEMA_NAME}`, [backupPath]);
    attached = true;

    const backupTables = new Set(
      (
        await all(
          input.db,
          `SELECT name FROM ${RESTORE_SCHEMA_NAME}.sqlite_master WHERE type = 'table'`,
        )
      ).map((row) => String(row?.name || "")),
    );
    if (!backupTables.has("games")) {
      throw new Error("The backup does not contain a library.");
    }

    /** @type {Map<string, string[]>} */
    const sharedColumns = new Map();
    for (const table of LIBRARY_RESET_TABLES) {
      if (!backupTables.has(table)) {
        continue;
      }
      const mainColumns = await readColumns(input.db, "main", table);
      const backupColumns = new Set(
        await readColumns(input.db, RESTORE_SCHEMA_NAME, table),
      );
      sharedColumns.set(
        table,
        mainColumns.filter((column) => backupColumns.has(column)),
      );
    }

    await run(input.db, "BEGIN IMMEDIATE TRANSACTION");
    try {
      for (const table of LIBRARY_RESET_TABLES) {
        await run(input.db, `DELETE FROM main.${table}`);
      }

      for (const table of [...LIBRARY_RESET_TABLES].reverse()) {
        const columns = sharedColumns.get(table) || [];
        if (columns.length === 0) {
          restored[table] = 0;
          continue;
        }
        const columnList = columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(", ");
        const result = await run(
          input.db,
          `INSERT INTO main.${table} (${columnList}) SELECT ${columnList} FROM ${RESTORE_SCHEMA_NAME}.${table}`,
        );
        restored[table] = Number(result?.changes || 0);
      }

      await run(input.db, "COMMIT");
    } catch (error) {
      await run(input.db, "ROLLBACK").catch(() => {});
      throw error;
    }
  } catch (error) {
    logger.warn(
      `${LOG_SCOPE} Restore failed and was rolled back:`,
      error instanceof Error ? error.message : String(error),
    );
    return {
      ...restoreFailure(
        "LIBRARY_RESTORE_FAILED",
        "This backup could not be restored. Your library was not changed.",
      ),
      safetyBackupPath,
    };
  } finally {
    if (attached) {
      await run(input.db, `DETACH DATABASE ${RESTORE_SCHEMA_NAME}`).catch((detachError) => {
        logger.warn(
          `${LOG_SCOPE} Could not detach the backup file:`,
          detachError instanceof Error ? detachError.message : String(detachError),
        );
      });
    }
  }

  const restoredGames = await readGameIdentities(input.db).catch(
    () => /** @type {Map<number, string>} */ (new Map()),
  );
  const removedImageDirectories = await reconcileCachedImages({
    db: input.db,
    appPaths: input.appPaths,
    previousGames,
    restoredGames,
    logger,
  });

  return {
    success: /** @type {const} */ (true),
    safetyBackupPath,
    restored,
    recordIds: [...restoredGames.keys()].sort((left, right) => left - right),
    removedImageDirectories,
  };
}

module.exports = {
  getLibraryBackupDirectory,
  isPathInsideLibraryBackups,
  listLibraryBackups,
  restoreLibraryBackup,
};
