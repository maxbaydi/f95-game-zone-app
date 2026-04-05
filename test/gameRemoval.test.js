const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  initializeDatabase,
  getGame,
  getGames,
  deleteGameCompletely,
} = require("../src/database");
const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const { toStoredImagePath } = require("../src/main/assetPaths");
const { removeLibraryGame } = require("../src/main/gameRemoval");
const { getSaveProfileSnapshot } = require("../src/main/saveProfiles");
const {
  backupGameSaves,
  buildSaveVaultIdentity,
} = require("../src/main/saveVault");
const { upsertSaveSyncState } = require("../src/main/db/saveSyncStateStore");
const { GAME_REMOVAL_MODES } = require("../src/shared/gameRemoval");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-game-removal-"));
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
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row || null);
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

function createStoredImage(appPaths, recordId, fileName, contents) {
  const absolutePath = path.join(appPaths.images, String(recordId), fileName);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return toStoredImagePath(appPaths, absolutePath);
}

async function seedGameRecord(db, input) {
  await runAsync(
    db,
    `
      INSERT INTO games (record_id, title, creator, engine)
      VALUES (?, ?, ?, ?)
    `,
    [input.recordId, input.title, input.creator, input.engine],
  );

  await runAsync(
    db,
    `
      INSERT INTO versions
      (
        record_id,
        version,
        game_path,
        exec_path,
        in_place,
        last_played,
        version_playtime,
        folder_size,
        date_added
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.recordId,
      input.version,
      input.installDirectory,
      path.join(input.installDirectory, "game.exe"),
      1,
      0,
      0,
      128,
      Date.now(),
    ],
  );
}

test("removeLibraryGame deletes installed files but preserves detected saves in the vault", async () => {
  const tempRoot = makeTempDir();
  const appPaths = buildAppPaths(path.join(tempRoot, "profile"));
  const libraryRoot = path.join(tempRoot, "library");
  const installDirectory = path.join(libraryRoot, "Demo Game");
  const localSavePath = path.join(
    installDirectory,
    "game",
    "saves",
    "slot1.save",
  );
  const previousAppData = process.env.APPDATA;
  const appDataRoot = path.join(tempRoot, "AppData", "Roaming");
  const renpySaveRoot = path.join(appDataRoot, "RenPy", "Demo Game");
  const renpySaveFile = path.join(renpySaveRoot, "persistent");

  ensureAppDirs(appPaths);
  fs.mkdirSync(path.dirname(localSavePath), { recursive: true });
  fs.mkdirSync(renpySaveRoot, { recursive: true });
  fs.writeFileSync(localSavePath, "local-save", "utf8");
  fs.writeFileSync(path.join(installDirectory, "game.exe"), "binary", "utf8");
  fs.writeFileSync(renpySaveFile, "appdata-save", "utf8");
  process.env.APPDATA = appDataRoot;

  const db = await initializeDatabase(appPaths);

  try {
    await seedGameRecord(db, {
      recordId: 1,
      title: "Demo Game",
      creator: "Dev Team",
      engine: "Ren'Py",
      version: "0.1",
      installDirectory,
    });

    await runAsync(
      db,
      `INSERT INTO banners (record_id, path, type) VALUES (?, ?, ?)`,
      [1, createStoredImage(appPaths, 1, "banner.webp", "banner"), "small"],
    );
    await runAsync(db, `INSERT INTO previews (record_id, path) VALUES (?, ?)`, [
      1,
      createStoredImage(appPaths, 1, "preview.webp", "preview"),
    ]);
    await upsertSaveSyncState(db, {
      recordId: 1,
      cloudIdentity: "demo-identity",
      lastRemotePath: "user/demo/latest.zip",
      syncStatus: "uploaded",
    });

    const result = await removeLibraryGame(
      {
        recordId: 1,
        mode: GAME_REMOVAL_MODES.DELETE_FILES_KEEP_SAVES,
      },
      {
        appPaths,
        libraryRoot,
        databaseConnection: db,
        getGame,
        getGames,
        getSaveProfileSnapshot,
        deleteGameCompletely,
      },
    );

    assert.equal(result.success, true);
    assert.equal(fs.existsSync(installDirectory), false);
    assert.equal(fs.existsSync(renpySaveRoot), true);

    const identity = buildSaveVaultIdentity({
      title: "Demo Game",
      creator: "Dev Team",
    });
    assert.equal(
      fs.readFileSync(
        path.join(
          appPaths.backups,
          "save_vault",
          identity,
          "profiles",
          "local",
          "game",
          "saves",
          "slot1.save",
        ),
        "utf8",
      ),
      "local-save",
    );
    assert.equal(
      fs.readFileSync(
        path.join(
          appPaths.backups,
          "save_vault",
          identity,
          "profiles",
          "roaming",
          "RenPy",
          "Demo Game",
          "persistent",
        ),
        "utf8",
      ),
      "appdata-save",
    );

    const gameRow = await getAsync(
      db,
      `SELECT record_id FROM games WHERE record_id = ?`,
      [1],
    );
    const versionRow = await getAsync(
      db,
      `SELECT record_id FROM versions WHERE record_id = ?`,
      [1],
    );
    const syncStateRow = await getAsync(
      db,
      `SELECT record_id FROM save_sync_state WHERE record_id = ?`,
      [1],
    );
    const saveProfileRow = await getAsync(
      db,
      `SELECT record_id FROM save_profiles WHERE record_id = ?`,
      [1],
    );

    assert.equal(gameRow, null);
    assert.equal(versionRow, null);
    assert.equal(syncStateRow, null);
    assert.equal(saveProfileRow, null);
    assert.equal(fs.existsSync(path.join(appPaths.images, "1")), false);
  } finally {
    process.env.APPDATA = previousAppData;
    await closeAsync(db);
  }
});

test("removeLibraryGame full cleanup deletes install folders, detected saves, and local save vault copies", async () => {
  const tempRoot = makeTempDir();
  const appPaths = buildAppPaths(path.join(tempRoot, "profile"));
  const libraryRoot = path.join(tempRoot, "library");
  const installDirectory = path.join(libraryRoot, "Fresh Start");
  const localSavePath = path.join(
    installDirectory,
    "game",
    "saves",
    "slot2.save",
  );
  const previousAppData = process.env.APPDATA;
  const appDataRoot = path.join(tempRoot, "AppData", "Roaming");
  const renpySaveRoot = path.join(appDataRoot, "RenPy", "Fresh Start");
  const renpySaveFile = path.join(renpySaveRoot, "persistent");

  ensureAppDirs(appPaths);
  fs.mkdirSync(path.dirname(localSavePath), { recursive: true });
  fs.mkdirSync(renpySaveRoot, { recursive: true });
  fs.writeFileSync(localSavePath, "slot-two", "utf8");
  fs.writeFileSync(path.join(installDirectory, "game.exe"), "binary", "utf8");
  fs.writeFileSync(renpySaveFile, "persistent-two", "utf8");
  process.env.APPDATA = appDataRoot;

  const db = await initializeDatabase(appPaths);

  try {
    await seedGameRecord(db, {
      recordId: 2,
      title: "Fresh Start",
      creator: "Studio",
      engine: "Ren'Py",
      version: "1.0",
      installDirectory,
    });

    const snapshot = await getSaveProfileSnapshot(appPaths, db, 2);
    await backupGameSaves({
      appPaths,
      title: "Fresh Start",
      creator: "Studio",
      installDirectory,
      profiles: snapshot.profiles,
    });

    const identity = buildSaveVaultIdentity({
      title: "Fresh Start",
      creator: "Studio",
    });
    assert.equal(
      fs.existsSync(path.join(appPaths.backups, "save_vault", identity)),
      true,
    );

    const result = await removeLibraryGame(
      {
        recordId: 2,
        mode: GAME_REMOVAL_MODES.DELETE_FILES_AND_SAVES,
      },
      {
        appPaths,
        libraryRoot,
        databaseConnection: db,
        getGame,
        getGames,
        getSaveProfileSnapshot,
        deleteGameCompletely,
      },
    );

    assert.equal(result.success, true);
    assert.equal(fs.existsSync(installDirectory), false);
    assert.equal(fs.existsSync(renpySaveRoot), false);
    assert.equal(
      fs.existsSync(path.join(appPaths.backups, "save_vault", identity)),
      false,
    );
  } finally {
    process.env.APPDATA = previousAppData;
    await closeAsync(db);
  }
});
