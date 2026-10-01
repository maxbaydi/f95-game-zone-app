const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const { openDatabase } = require("../src/main/db/openDatabase");
const { backupDatabaseFile, resetLibraryIndex } = require("../src/main/libraryReset");
const {
  listLibraryBackups,
  restoreLibraryBackup,
  isPathInsideLibraryBackups,
} = require("../src/main/libraryBackups");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "app-library-backups-"));
}

function runAsync(db, sql, params = []) {
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

function getAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function closeAsync(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

async function countRows(db, table) {
  const row = await getAsync(db, `SELECT COUNT(*) AS count FROM ${table}`);
  return Number(row?.count || 0);
}

async function seedLibrary(db) {
  const now = new Date().toISOString();
  await runAsync(db, `INSERT INTO f95_catalog (f95_id, title, creator, engine, version, site_url) VALUES (555, 'Sample Game', 'Sample Dev', 'renpy', '0.9', 'https://f95zone.to/threads/555/')`);
  await runAsync(db, `INSERT INTO scan_sources (path, is_enabled, created_at, updated_at) VALUES ('C:\\Games', 1, ?, ?)`, [now, now]);
  const game = await runAsync(db, `INSERT INTO games (title, creator, engine, last_played_r, total_playtime, is_favorite) VALUES ('Sample Game', 'Sample Dev', 'renpy', 0, 0, 1)`);
  const recordId = game.lastID;
  await runAsync(db, `INSERT INTO versions (record_id, version, game_path, exec_path, in_place, date_added, last_played, version_playtime, folder_size) VALUES (?, '0.9', 'C:\\Games\\Sample', 'C:\\Games\\Sample\\game.exe', 1, 1, 0, 0, 0)`, [recordId]);
  await runAsync(db, `INSERT INTO f95_zone_mappings (record_id, f95_id, site_url) VALUES (?, 555, 'https://f95zone.to/threads/555/')`, [recordId]);
  await runAsync(db, `INSERT INTO banners (record_id, path, type) VALUES (?, 'cache/images/${recordId}/banner_mc.webp', 'small')`, [recordId]);
  await runAsync(db, `INSERT INTO save_sync_state (record_id, cloud_identity, sync_status, updated_at) VALUES (?, 'f95-555', 'idle', ?)`, [recordId, now]);
  return recordId;
}

test("listLibraryBackups lists snapshots newest first with their game count", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);
  await seedLibrary(db);

  const older = await backupDatabaseFile({ appPaths, db, now: () => new Date(2026, 0, 1, 10, 0, 0) });
  await runAsync(db, `INSERT INTO games (title, creator, engine, last_played_r, total_playtime) VALUES ('Second', 'Dev', 'unity', 0, 0)`);
  const newer = await backupDatabaseFile({ appPaths, db, now: () => new Date(2026, 0, 2, 10, 0, 0) });
  fs.writeFileSync(path.join(path.dirname(newer), "notes.txt"), "ignored");

  const backups = await listLibraryBackups({ appPaths });

  assert.deepEqual(backups.map((entry) => entry.path), [newer, older]);
  assert.deepEqual(backups.map((entry) => entry.gameCount), [2, 1]);
  assert.ok(backups[0].sizeBytes > 0);
  assert.ok(backups[0].createdAt);
  assert.equal(backups[0].fileName, path.basename(newer));

  await closeAsync(db);
});

test("listLibraryBackups returns an empty list when no backup was ever made", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);

  assert.deepEqual(await listLibraryBackups({ appPaths }), []);
});

test("restoreLibraryBackup brings the library back after a reset and keeps a safety copy", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);
  const recordId = await seedLibrary(db);

  const backupPath = await backupDatabaseFile({ appPaths, db, now: () => new Date(2026, 0, 1, 10, 0, 0) });
  const reset = await resetLibraryIndex({ appPaths, db, now: () => new Date(2026, 0, 1, 11, 0, 0) });
  assert.equal(reset.success, true);
  assert.equal(await countRows(db, "games"), 0);

  const result = await restoreLibraryBackup({
    appPaths,
    db,
    backupPath,
    now: () => new Date(2026, 0, 1, 12, 0, 0),
  });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.ok(fs.existsSync(result.safetyBackupPath), "safety backup exists");
  assert.notEqual(result.safetyBackupPath, backupPath);
  assert.equal(result.restored.games, 1);
  assert.equal(result.restored.versions, 1);
  assert.equal(result.restored.f95_zone_mappings, 1);
  assert.equal(result.restored.banners, 1);
  assert.equal(result.restored.save_sync_state, 1);
  assert.deepEqual(result.recordIds, [recordId]);

  const game = await getAsync(db, "SELECT title, is_favorite FROM games WHERE record_id = ?", [recordId]);
  assert.deepEqual(game, { title: "Sample Game", is_favorite: 1 });
  assert.equal(await countRows(db, "f95_catalog"), 1, "catalog untouched");
  assert.equal(await countRows(db, "scan_sources"), 1, "scan folders untouched");

  // The database is usable afterwards (the backup file is detached again).
  const restoredAgain = await restoreLibraryBackup({ appPaths, db, backupPath });
  assert.equal(restoredAgain.success, true);
  assert.equal(await countRows(db, "games"), 1);

  await closeAsync(db);
});

test("restoreLibraryBackup copies only the columns both schemas share", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);

  // A backup written by an older release: games without is_favorite, no live versions table.
  const backupDir = path.join(appPaths.backups, "library_index");
  fs.mkdirSync(backupDir, { recursive: true });
  const legacyPath = path.join(backupDir, "library-legacy.db");
  const legacy = new sqlite3.Database(legacyPath);
  await runAsync(legacy, `CREATE TABLE games (record_id INTEGER PRIMARY KEY, title TEXT NOT NULL, creator TEXT NOT NULL, engine TEXT, last_played_r DATE DEFAULT 0, total_playtime INTEGER DEFAULT 0, description TEXT, last_played_version TEXT, legacy_only TEXT)`);
  await runAsync(legacy, `CREATE TABLE versions (record_id INTEGER, version TEXT, game_path TEXT, exec_path TEXT, in_place BOOLEAN, last_played DATE, version_playtime INTEGER, folder_size INTEGER, date_added INTEGER)`);
  await runAsync(legacy, `INSERT INTO games (record_id, title, creator, engine, legacy_only) VALUES (42, 'Legacy Game', 'Old Dev', 'rpgm', 'x')`);
  await runAsync(legacy, `INSERT INTO versions (record_id, version, game_path, exec_path, in_place, date_added) VALUES (42, '1.0', 'C:\\Games\\Legacy', 'C:\\Games\\Legacy\\Game.exe', 1, 1)`);
  await closeAsync(legacy);

  const result = await restoreLibraryBackup({ appPaths, db, backupPath: legacyPath });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.restored.games, 1);
  assert.equal(result.restored.versions, 1);
  assert.equal(result.restored.f95_zone_mappings, 0, "tables missing in the backup restore nothing");
  const game = await getAsync(db, "SELECT record_id, title, is_favorite FROM games");
  assert.deepEqual(game, { record_id: 42, title: "Legacy Game", is_favorite: 0 });

  await closeAsync(db);
});

test("restoreLibraryBackup refuses files outside the backups folder or missing files", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);
  await seedLibrary(db);

  const outsidePath = path.join(makeTempDir(), "evil.db");
  fs.writeFileSync(outsidePath, "not a database");
  const outside = await restoreLibraryBackup({ appPaths, db, backupPath: outsidePath });
  assert.equal(outside.success, false);
  assert.equal(outside.error.code, "LIBRARY_BACKUP_OUTSIDE_FOLDER");

  const missing = await restoreLibraryBackup({
    appPaths,
    db,
    backupPath: path.join(appPaths.backups, "library_index", "nope.db"),
  });
  assert.equal(missing.success, false);
  assert.equal(missing.error.code, "LIBRARY_BACKUP_NOT_FOUND");

  assert.equal(await countRows(db, "games"), 1, "library untouched");
  assert.equal(isPathInsideLibraryBackups(appPaths, path.join(appPaths.backups, "library_index", "a.db")), true);
  assert.equal(isPathInsideLibraryBackups(appPaths, path.join(appPaths.backups, "library_index", "..", "a.db")), false);

  await closeAsync(db);
});

test("restoreLibraryBackup rolls back when the backup file is not a database", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);
  await seedLibrary(db);

  const backupDir = path.join(appPaths.backups, "library_index");
  fs.mkdirSync(backupDir, { recursive: true });
  const brokenPath = path.join(backupDir, "library-broken.db");
  fs.writeFileSync(brokenPath, "definitely not sqlite");

  const result = await restoreLibraryBackup({ appPaths, db, backupPath: brokenPath });

  assert.equal(result.success, false);
  assert.equal(result.error.code, "LIBRARY_RESTORE_FAILED");
  assert.equal(await countRows(db, "games"), 1, "library untouched");
  assert.equal(await countRows(db, "versions"), 1);

  await closeAsync(db);
});
