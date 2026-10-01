const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const database = require("../src/database");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "app-db-version-location-"));
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

function closeAsync(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

test("updateVersionLocation and updateVersionExecutable change one version row in place", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await database.initializeDatabase(appPaths);

  const recordId = await database.addGame({ title: "Moved Game", creator: "Dev", engine: "renpy" });
  await database.addVersion(
    { version: "0.5", folder: "C:\\Games\\Old", executables: [{ value: "game.exe" }], folderSize: 77 },
    recordId,
  );
  await database.addVersion(
    { version: "0.6", folder: "C:\\Games\\Newer", executables: [{ value: "game.exe" }] },
    recordId,
  );

  assert.equal(
    await database.updateVersionLocation(recordId, "0.5", "D:\\Moved\\Old", "D:\\Moved\\Old\\Game.exe"),
    1,
  );
  const afterMove = await database.getGame(recordId, appPaths);
  const moved = afterMove.versions.find((version) => version.version === "0.5");
  assert.equal(moved.game_path, "D:\\Moved\\Old");
  assert.equal(moved.exec_path, "D:\\Moved\\Old\\Game.exe");
  assert.equal(moved.folder_size, 77, "other columns are preserved");
  const untouched = afterMove.versions.find((version) => version.version === "0.6");
  assert.equal(untouched.game_path, "C:\\Games\\Newer");

  assert.equal(await database.updateVersionExecutable(recordId, "0.6", "C:\\Games\\Newer\\Real.exe"), 1);
  const afterExecutable = await database.getGame(recordId, appPaths);
  assert.equal(
    afterExecutable.versions.find((version) => version.version === "0.6").exec_path,
    "C:\\Games\\Newer\\Real.exe",
  );

  assert.equal(await database.updateVersionLocation(recordId, "9.9", "x", "y"), 0, "unknown version changes nothing");

  await closeAsync(db);
});

test("getCatalogEntryForRecord returns the catalog entry a record is linked to", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await database.initializeDatabase(appPaths);

  await runAsync(db, `INSERT INTO f95_catalog (f95_id, title, creator, engine, version, site_url) VALUES (555, 'Sample Game', 'Sample Dev', 'renpy', '0.9', 'https://f95zone.to/threads/app-game.555/')`);
  const recordId = await database.addGame({ title: "Sample Game", creator: "Sample Dev", engine: "renpy" });
  await database.upsertF95ZoneMapping(recordId, 555, "https://f95zone.to/threads/app-game.555/");

  const entry = await database.getCatalogEntryForRecord(recordId);
  assert.equal(entry.f95Id, 555);
  assert.equal(entry.siteUrl, "https://f95zone.to/threads/app-game.555/");
  assert.equal(await database.getF95IdForRecord(recordId), 555);
  assert.equal(await database.getCatalogEntryForRecord(999), null);
  assert.equal((await database.getCatalogEntry(555)).title, "Sample Game");

  await closeAsync(db);
});

test("live thread versions raise latestVersion above the catalog and are cleaned up with the game", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await database.initializeDatabase(appPaths);
  const { upsertLiveVersion, getLiveVersion } = require("../src/main/db/liveVersionsStore");

  await runAsync(db, `INSERT INTO f95_catalog (f95_id, title, creator, engine, version, site_url) VALUES (555, 'Sample Game', 'Sample Dev', 'renpy', '0.9', 'https://f95zone.to/threads/app-game.555/')`);
  const recordId = await database.addGame({ title: "Sample Game", creator: "Sample Dev", engine: "renpy" });
  await database.addVersion({ version: "0.9", folder: "C:\\Games\\Sample", executables: [{ value: "game.exe" }] }, recordId);
  await database.upsertF95ZoneMapping(recordId, 555, "https://f95zone.to/threads/app-game.555/");

  const before = await database.getGame(recordId, appPaths);
  assert.equal(before.latestVersion, "0.9");
  assert.equal(before.isUpdateAvailable, false);
  assert.equal(before.liveVersion, "");

  await upsertLiveVersion(db, {
    recordId,
    threadUrl: "https://f95zone.to/threads/app-game.555/",
    version: "1.1",
    title: "Sample Game [v1.1]",
    checkedAt: "2026-09-27T10:00:00.000Z",
    error: "",
  });

  const after = await database.getGame(recordId, appPaths);
  assert.equal(after.latestVersion, "1.1");
  assert.equal(after.catalogLatestVersion, "0.9");
  assert.equal(after.liveVersion, "1.1");
  assert.equal(after.liveCheckedAt, "2026-09-27T10:00:00.000Z");
  assert.equal(after.isUpdateAvailable, true);

  const listed = (await database.getGames(appPaths, 0, null)).find((game) => game.record_id === recordId);
  assert.equal(listed.latestVersion, "1.1");
  assert.equal(listed.isUpdateAvailable, true);

  // An older live version never lowers the catalog version.
  await upsertLiveVersion(db, { recordId, threadUrl: "", version: "0.5", title: "", checkedAt: "2026-09-27T11:00:00.000Z", error: "" });
  assert.equal((await database.getGame(recordId, appPaths)).latestVersion, "0.9");
  assert.equal((await getLiveVersion(db, recordId)).version, "0.5");

  await database.deleteGameCompletely(recordId, appPaths);
  assert.equal(await getLiveVersion(db, recordId), null);

  await closeAsync(db);
});
