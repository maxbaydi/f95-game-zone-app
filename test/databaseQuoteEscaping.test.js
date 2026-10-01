const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const { openDatabase } = require("../src/main/db/openDatabase");
const migrations = require("../src/main/db/migrations");
const database = require("../src/database");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "app-db-quotes-"));
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

test("games, versions and banners are stored with plain apostrophes and read back unchanged", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await database.initializeDatabase(appPaths);

  const recordId = await database.addGame({
    title: "Lily's Garden",
    creator: "O'Neil",
    engine: "Ren'Py",
  });
  const rawGame = await getAsync(db, "SELECT title, creator, engine FROM games WHERE record_id = ?", [recordId]);
  assert.deepEqual(rawGame, { title: "Lily's Garden", creator: "O'Neil", engine: "Ren'Py" });

  // Adding the same game again resolves to the same record instead of a duplicate.
  assert.equal(
    await database.addGame({ title: "Lily's Garden", creator: "O'Neil", engine: "Ren'Py" }),
    recordId,
  );

  const folder = path.join("C:", "Users", "O'Brien", "Games", "Lily's Garden");
  await database.addVersion(
    {
      version: "0.1'a",
      folder,
      executables: [{ key: "game.exe", value: "game.exe" }],
      selectedValue: "game.exe",
    },
    recordId,
  );
  const rawVersion = await getAsync(db, "SELECT version, game_path, exec_path FROM versions WHERE record_id = ?", [recordId]);
  assert.equal(rawVersion.version, "0.1'a");
  assert.equal(rawVersion.game_path, folder);
  assert.equal(rawVersion.exec_path, path.join(folder, "game.exe"));

  const game = await database.getGame(recordId, appPaths);
  assert.equal(game.title, "Lily's Garden");
  assert.equal(game.creator, "O'Neil");
  assert.equal(game.engine, "Ren'Py");
  assert.equal(game.versions[0].game_path, folder);

  const games = await database.getGames(appPaths, 0, null);
  assert.equal(games.find((entry) => entry.record_id === recordId)?.title, "Lily's Garden");

  assert.equal(
    await database.checkRecordExist("Lily's Garden", "O'Neil", "Ren'Py", "0.1'a", "nope"),
    true,
  );
  assert.equal(await database.checkPathExist(folder, "Lily's Garden"), true);

  await database.updateFolderSize(recordId, "0.1'a", 4321);
  assert.equal((await database.getGame(recordId, appPaths)).versions[0].folder_size, 4321);

  await database.updateGame({ record_id: recordId, title: "Lily's Garden 2", creator: "O'Neil", engine: "Ren'Py" });
  assert.equal((await database.getGame(recordId, appPaths)).title, "Lily's Garden 2");

  await database.updateBanners(recordId, "cache/images/1/it's.webp", "small");
  const rawBanner = await getAsync(db, "SELECT path FROM banners WHERE record_id = ?", [recordId]);
  assert.equal(rawBanner.path, "cache/images/1/it's.webp");

  await database.updatePreviews(recordId, "cache/images/1/preview's.webp");
  const rawPreview = await getAsync(db, "SELECT path FROM previews WHERE record_id = ?", [recordId]);
  assert.equal(rawPreview.path, "cache/images/1/preview's.webp");

  assert.equal(await database.deleteVersionsForRecordPath(recordId, folder), 1);
  assert.equal(await database.countVersions(recordId), 0);

  await closeAsync(db);
});

test("the unescape migration repairs rows written by the legacy escaping code", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);

  // Build a database at schema version 9 by hand, the way older releases left it.
  const legacy = new sqlite3.Database(appPaths.db);
  await runAsync(
    legacy,
    `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`,
  );
  for (const migration of migrations.filter((entry) => entry.version <= 9)) {
    for (const statement of migration.statements) {
      await runAsync(legacy, statement);
    }
    await runAsync(
      legacy,
      `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
      [migration.version, migration.name, new Date().toISOString()],
    );
  }

  // Legacy rows: the old code doubled every apostrophe before binding parameters.
  const inserted = await runAsync(
    legacy,
    `INSERT INTO games (title, creator, engine, last_played_r, total_playtime) VALUES (?, ?, ?, 0, 0)`,
    ["Lily''s Garden", "O''Neil", "Ren''Py"],
  );
  const recordId = inserted.lastID;
  await runAsync(
    legacy,
    `INSERT INTO versions (record_id, version, game_path, exec_path, in_place, date_added, last_played, version_playtime, folder_size) VALUES (?, ?, ?, ?, 1, 1, 0, 0, 0)`,
    [recordId, "0.1''a", "C:\\Users\\O''Brien\\Lily", "C:\\Users\\O''Brien\\Lily\\game.exe"],
  );
  await runAsync(legacy, `INSERT INTO banners (record_id, path, type) VALUES (?, ?, 'small')`, [recordId, "cache/images/1/it''s.webp"]);
  await runAsync(legacy, `INSERT INTO previews (record_id, path) VALUES (?, ?)`, [recordId, "cache/images/1/p''1.webp"]);
  // A row that is already clean must stay clean.
  await runAsync(
    legacy,
    `INSERT INTO games (title, creator, engine, last_played_r, total_playtime) VALUES (?, ?, ?, 0, 0)`,
    ["Plain Title", "Plain Dev", "unity"],
  );
  await closeAsync(legacy);

  const db = await openDatabase(appPaths);

  const migrated = await getAsync(db, "SELECT version, name FROM schema_migrations WHERE version = 10");
  assert.equal(migrated?.name, "unescape_sql_quotes");

  const game = await getAsync(db, "SELECT title, creator, engine FROM games WHERE record_id = ?", [recordId]);
  assert.deepEqual(game, { title: "Lily's Garden", creator: "O'Neil", engine: "Ren'Py" });

  const version = await getAsync(db, "SELECT version, game_path, exec_path FROM versions WHERE record_id = ?", [recordId]);
  assert.deepEqual(version, {
    version: "0.1'a",
    game_path: "C:\\Users\\O'Brien\\Lily",
    exec_path: "C:\\Users\\O'Brien\\Lily\\game.exe",
  });

  const banner = await getAsync(db, "SELECT path FROM banners WHERE record_id = ?", [recordId]);
  assert.equal(banner.path, "cache/images/1/it's.webp");
  const preview = await getAsync(db, "SELECT path FROM previews WHERE record_id = ?", [recordId]);
  assert.equal(preview.path, "cache/images/1/p'1.webp");

  const plain = await getAsync(db, "SELECT title, creator, engine FROM games WHERE title = 'Plain Title'");
  assert.deepEqual(plain, { title: "Plain Title", creator: "Plain Dev", engine: "unity" });

  await closeAsync(db);
});
