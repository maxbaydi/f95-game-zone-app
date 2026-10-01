const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const { openDatabase } = require("../src/main/db/openDatabase");
const {
  LIBRARY_RESET_TABLES,
  LIBRARY_RESET_PRESERVED_TABLES,
  resetLibraryIndex,
} = require("../src/main/libraryReset");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "app-library-reset-"));
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

async function seedLibrary(db, appPaths) {
  const now = new Date().toISOString();
  await runAsync(db, `INSERT INTO f95_catalog (f95_id, title, creator, engine, version, site_url) VALUES (555, 'Sample Game', 'Sample Dev', 'renpy', '0.9', 'https://f95zone.to/threads/app-game.555/')`);
  await runAsync(db, `INSERT INTO f95_catalog_sync (key, value) VALUES ('fullDone', '1')`);
  await runAsync(db, `INSERT INTO scan_sources (path, is_enabled, created_at, updated_at) VALUES ('C:\\Games', 1, ?, ?)`, [now, now]);
  await runAsync(db, `INSERT INTO emulators (extension, program_path, parameters) VALUES ('swf', 'C:\\flash.exe', '')`);
  await runAsync(db, `INSERT INTO tags (tag_id, tag) VALUES (1, 'fantasy')`);

  const game = await runAsync(db, `INSERT INTO games (title, creator, engine, last_played_r, total_playtime) VALUES ('Sample Game', 'Sample Dev', 'renpy', 0, 0)`);
  const recordId = game.lastID;
  await runAsync(db, `INSERT INTO versions (record_id, version, game_path, exec_path, in_place, date_added, last_played, version_playtime, folder_size) VALUES (?, '0.9', 'C:\\Games\\Sample', 'C:\\Games\\Sample\\game.exe', 1, 1, 0, 0, 0)`, [recordId]);
  await runAsync(db, `INSERT INTO f95_zone_mappings (record_id, f95_id, site_url) VALUES (?, 555, 'https://f95zone.to/threads/app-game.555/')`, [recordId]);
  await runAsync(db, `INSERT INTO tag_mappings (record_id, tag_id) VALUES (?, 1)`, [recordId]);
  await runAsync(db, `INSERT INTO banners (record_id, path, type) VALUES (?, 'cache/images/${recordId}/banner_mc.webp', 'small')`, [recordId]);
  await runAsync(db, `INSERT INTO previews (record_id, path) VALUES (?, 'cache/images/${recordId}/preview_0.webp')`, [recordId]);
  await runAsync(db, `INSERT INTO save_profiles (record_id, provider, root_path, strategy_type, strategy_payload, confidence, reasons_json, detected_at, last_seen_at) VALUES (?, 'local', 'C:\\Games\\Sample\\game\\saves', 'renpy', '{}', 90, '[]', ?, ?)`, [recordId, now, now]);
  await runAsync(db, `INSERT INTO save_sync_state (record_id, cloud_identity, sync_status, updated_at) VALUES (?, 'f95-555', 'idle', ?)`, [recordId, now]);
  await runAsync(db, `INSERT INTO scan_jobs (mode, status, started_at, source_count, games_found, errors_count) VALUES ('scan_sources', 'success', ?, 1, 1, 0)`, [now]);
  await runAsync(db, `INSERT INTO scan_candidates (folder_path, title, creator, first_seen_at, last_seen_at) VALUES ('C:\\Games\\Sample', 'Sample Game', 'Sample Dev', ?, ?)`, [now, now]);
  await runAsync(db, `INSERT INTO cloud_library_delete_queue (request_key, cloud_project_key, preferred_identity_key, requested_at) VALUES ('req-1', 'proj', 'f95:1', ?)`, [now]);
  await runAsync(db, `INSERT INTO library_live_versions (record_id, thread_url, version, title, checked_at) VALUES (?, 'https://f95zone.to/threads/app-game.555/', '1.1', 'Sample Game', ?)`, [recordId, now]);

  const imageDir = path.join(appPaths.images, String(recordId));
  fs.mkdirSync(imageDir, { recursive: true });
  fs.writeFileSync(path.join(imageDir, "banner_mc.webp"), "x");

  return { recordId, imageDir };
}

test("resetLibraryIndex clears library tables, keeps catalog data and backs the database up first", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);
  const { recordId, imageDir } = await seedLibrary(db, appPaths);
  const orphanImageDir = path.join(appPaths.images, "42");
  fs.mkdirSync(orphanImageDir, { recursive: true });
  fs.writeFileSync(path.join(orphanImageDir, "banner_mc.webp"), "old");
  const keptImageDir = path.join(appPaths.images, "templates");
  fs.mkdirSync(keptImageDir, { recursive: true });

  const result = await resetLibraryIndex({ appPaths, db });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.ok(result.backupPath);
  assert.ok(fs.existsSync(result.backupPath), "backup file exists");
  assert.ok(result.backupPath.startsWith(appPaths.backups), "backup lives under app backups");

  for (const table of LIBRARY_RESET_TABLES) {
    assert.equal(await countRows(db, table), 0, `${table} is empty`);
  }
  assert.equal(result.cleared.games, 1);
  assert.equal(result.cleared.versions, 1);
  assert.equal(result.cleared.scan_candidates, 1);
  assert.equal(result.cleared.scan_jobs, 1);
  assert.equal(result.cleared.library_live_versions, 1);

  for (const table of LIBRARY_RESET_PRESERVED_TABLES) {
    assert.ok((await countRows(db, table)) >= 1, `${table} is preserved`);
  }
  assert.equal(await countRows(db, "cloud_library_delete_queue"), 1);
  assert.equal(await countRows(db, "scan_sources"), 1);
  assert.equal(await countRows(db, "f95_catalog"), 1);

  assert.equal(fs.existsSync(imageDir), false, "image folder of the record was removed");
  assert.equal(fs.existsSync(orphanImageDir), false, "leftover image folders go too (ids restart at 1)");
  assert.equal(fs.existsSync(keptImageDir), true, "non-record folders are untouched");
  assert.deepEqual(
    [...result.removedImageDirectories].sort(),
    [imageDir, orphanImageDir].sort(),
  );
  assert.equal(result.removedRecordIds.length, 1);
  assert.equal(result.removedRecordIds[0], recordId);

  // The backup is a real SQLite database that still contains the old library.
  const backup = new sqlite3.Database(result.backupPath, sqlite3.OPEN_READONLY);
  const backupGames = await getAsync(backup, "SELECT COUNT(*) AS count FROM games");
  assert.equal(Number(backupGames?.count), 1);
  await closeAsync(backup);

  // A fresh record can be added after the reset and gets a new id.
  const inserted = await runAsync(
    db,
    `INSERT INTO games (title, creator, engine, last_played_r, total_playtime) VALUES ('Second', 'Dev', 'unity', 0, 0)`,
  );
  assert.ok(inserted.lastID > 0);

  await closeAsync(db);
});

test("resetLibraryIndex on an empty library succeeds and reports zero counts", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);

  const result = await resetLibraryIndex({ appPaths, db });

  assert.equal(result.success, true);
  assert.equal(result.cleared.games, 0);
  assert.deepEqual(result.removedImageDirectories, []);
  assert.ok(fs.existsSync(result.backupPath));

  await closeAsync(db);
});

test("resetLibraryIndex refuses to touch the database when the backup cannot be written", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);
  await seedLibrary(db, appPaths);

  const result = await resetLibraryIndex({
    appPaths,
    db,
    backupDatabase: async () => {
      throw new Error("disk full");
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, "LIBRARY_RESET_BACKUP_FAILED");
  assert.equal(await countRows(db, "games"), 1, "games untouched");
  assert.equal(await countRows(db, "versions"), 1, "versions untouched");

  await closeAsync(db);
});

test("resetLibraryIndex keeps the reset atomic when a delete statement fails", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);
  await seedLibrary(db, appPaths);

  const failingDb = {
    run(sql, params, callback) {
      const done = typeof params === "function" ? params : callback;
      if (/DELETE FROM versions/i.test(String(sql))) {
        done.call({ changes: 0 }, new Error("simulated failure"));
        return;
      }
      return db.run(sql, typeof params === "function" ? [] : params, done);
    },
    all: db.all.bind(db),
    get: db.get.bind(db),
    exec: db.exec ? db.exec.bind(db) : undefined,
    serialize: db.serialize.bind(db),
  };

  const result = await resetLibraryIndex({
    appPaths,
    db: failingDb,
    backupDatabase: async () => path.join(appPaths.backups, "fake.db"),
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, "LIBRARY_RESET_FAILED");
  assert.equal(await countRows(db, "games"), 1, "games rolled back");
  assert.equal(await countRows(db, "tag_mappings"), 1, "tag mappings rolled back");

  await closeAsync(db);
});
