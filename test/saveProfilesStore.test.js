const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const { openDatabase } = require("../src/main/db/openDatabase");
const {
  getSaveProfiles,
  replaceSaveProfiles,
} = require("../src/main/db/saveProfilesStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-save-profiles-store-"));
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
    db.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

test("save profile store replaces and reads persisted profiles", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);

  await runAsync(
    db,
    "INSERT INTO games (record_id, title, creator, engine) VALUES (?, ?, ?, ?)",
    [1, "Demo", "Dev", "Ren'Py"],
  );

  const inserted = await replaceSaveProfiles(db, 1, [
    {
      provider: "local",
      rootPath: "C:/Games/Demo/game/saves",
      strategy: {
        type: "install-relative",
        payload: { relativePath: "game/saves" },
      },
      confidence: 100,
      reasons: ["found local save directory at game/saves"],
    },
  ]);

  assert.equal(inserted.length, 1);

  const profiles = await getSaveProfiles(db, 1);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].strategy.type, "install-relative");
  assert.equal(profiles[0].strategy.payload.relativePath, "game/saves");

  await closeAsync(db);
});
