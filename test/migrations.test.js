const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const { openDatabase } = require("../src/main/db/openDatabase");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "app-stage0-migrations-"));
}

function allAsync(db, sql, params = []) {
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

function closeAsync(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

test("initializeDatabase applies schema migrations once and creates expected tables", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);

  const db = await openDatabase(appPaths);

  const migrations = await allAsync(
    db,
    "SELECT version, name FROM schema_migrations ORDER BY version ASC",
  );
  const gameColumns = await allAsync(db, "PRAGMA table_info(games)");
  const tables = await allAsync(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('cloud_library_delete_queue', 'games', 'versions', 'schema_migrations', 'scan_candidates', 'save_profiles', 'save_sync_state') ORDER BY name ASC",
  );

  assert.deepEqual(migrations, [
    { version: 1, name: "initial_schema" },
    { version: 2, name: "scan_sources" },
    { version: 3, name: "scan_jobs" },
    { version: 4, name: "scan_candidates" },
    { version: 5, name: "save_sync" },
    { version: 6, name: "scan_candidate_match_metadata" },
    { version: 7, name: "f95_zone_mapping_site_url" },
    { version: 8, name: "game_favorites" },
    { version: 9, name: "cloud_library_delete_queue" },
    { version: 10, name: "unescape_sql_quotes" },
    { version: 11, name: "library_live_versions" },
    { version: 12, name: "f95_catalog" },
    { version: 13, name: "f95_catalog_thread_details" },
    { version: 14, name: "f95_catalog_full_size_images" },
  ]);
  const favoriteColumn = gameColumns.find((column) => column.name === "is_favorite");
  assert.ok(favoriteColumn);
  assert.equal(Number(favoriteColumn.notnull), 1);
  assert.equal(Number(favoriteColumn.dflt_value), 0);
  assert.deepEqual(tables, [
    { name: "cloud_library_delete_queue" },
    { name: "games" },
    { name: "save_profiles" },
    { name: "save_sync_state" },
    { name: "scan_candidates" },
    { name: "schema_migrations" },
    { name: "versions" },
  ]);

  await closeAsync(db);

  const reopened = new sqlite3.Database(appPaths.db);
  const reopenedMigrations = await allAsync(
    reopened,
    "SELECT version, name FROM schema_migrations ORDER BY version ASC",
  );

  assert.deepEqual(reopenedMigrations, [
    { version: 1, name: "initial_schema" },
    { version: 2, name: "scan_sources" },
    { version: 3, name: "scan_jobs" },
    { version: 4, name: "scan_candidates" },
    { version: 5, name: "save_sync" },
    { version: 6, name: "scan_candidate_match_metadata" },
    { version: 7, name: "f95_zone_mapping_site_url" },
    { version: 8, name: "game_favorites" },
    { version: 9, name: "cloud_library_delete_queue" },
    { version: 10, name: "unescape_sql_quotes" },
    { version: 11, name: "library_live_versions" },
    { version: 12, name: "f95_catalog" },
    { version: 13, name: "f95_catalog_thread_details" },
    { version: 14, name: "f95_catalog_full_size_images" },
  ]);

  await closeAsync(reopened);
});
