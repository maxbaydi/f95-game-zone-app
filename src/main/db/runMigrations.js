// @ts-check

const migrations = require("./migrations");

/**
 * @param {import("sqlite3").Database | { run: Function, all: Function }} db
 * @param {string} sql
 * @param {unknown[]=} params
 * @returns {Promise<unknown>}
 */
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve(this);
    });
  });
}

/**
 * @param {import("sqlite3").Database | { all: Function }} db
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
 * @returns {{ info: Function, error: Function }}
 */
function createMigrationLogger() {
  return {
    info(message, details) {
      if (details) {
        console.log("[db.migrations]", message, details);
        return;
      }

      console.log("[db.migrations]", message);
    },
    error(message, details) {
      if (details) {
        console.error("[db.migrations]", message, details);
        return;
      }

      console.error("[db.migrations]", message);
    },
  };
}

/**
 * @param {import("sqlite3").Database | { run: Function, all: Function }} db
 * @returns {Promise<void>}
 */
async function ensureMigrationTable(db) {
  await run(
    db,
    `
      CREATE TABLE IF NOT EXISTS schema_migrations
      (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `,
  );
}

/**
 * @param {import("sqlite3").Database | { run: Function, all: Function }} db
 * @returns {Promise<Set<number>>}
 */
async function getAppliedVersions(db) {
  const rows = await all(
    db,
    "SELECT version FROM schema_migrations ORDER BY version ASC",
  );

  return new Set(rows.map((row) => Number(row.version)));
}

/**
 * @param {import("sqlite3").Database | { run: Function, all: Function }} db
 * @param {{ version: number, name: string, statements: string[] }} migration
 * @param {{ info: Function, error: Function }} logger
 * @returns {Promise<void>}
 */
async function applyMigration(db, migration, logger) {
  logger.info("Applying migration", {
    version: migration.version,
    name: migration.name,
  });

  await run(db, "BEGIN TRANSACTION");

  try {
    for (const statement of migration.statements) {
      await run(db, statement);
    }

    await run(
      db,
      `
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (?, ?, ?)
      `,
      [migration.version, migration.name, new Date().toISOString()],
    );

    await run(db, "COMMIT");

    logger.info("Migration applied", {
      version: migration.version,
      name: migration.name,
    });
  } catch (error) {
    await run(db, "ROLLBACK").catch(() => {});
    logger.error("Migration failed", {
      version: migration.version,
      name: migration.name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * @param {import("sqlite3").Database | { run: Function, all: Function }} db
 * @returns {Promise<void>}
 */
async function runMigrations(db) {
  const logger = createMigrationLogger();

  await ensureMigrationTable(db);
  const appliedVersions = await getAppliedVersions(db);

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    await applyMigration(db, migration, logger);
  }
}

module.exports = {
  runMigrations,
};
