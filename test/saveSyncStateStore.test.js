const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const { openDatabase } = require("../src/main/db/openDatabase");
const {
  getSaveSyncState,
  upsertSaveSyncState,
} = require("../src/main/db/saveSyncStateStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-save-sync-state-"));
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

test("save sync state store upserts sync metadata per record", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);

  await runAsync(
    db,
    "INSERT INTO games (record_id, title, creator, engine) VALUES (?, ?, ?, ?)",
    [1, "Demo", "Dev", "Ren'Py"],
  );

  const upserted = await upsertSaveSyncState(db, {
    recordId: 1,
    cloudIdentity: "f95-123",
    lastRemotePath: "user-id/f95-123/latest.zip",
    syncStatus: "uploaded",
  });

  assert.equal(upserted.recordId, 1);
  assert.equal(upserted.cloudIdentity, "f95-123");
  assert.equal(upserted.syncStatus, "uploaded");

  const loaded = await getSaveSyncState(db, 1);
  assert.equal(loaded.lastRemotePath, "user-id/f95-123/latest.zip");

  await closeAsync(db);
});
