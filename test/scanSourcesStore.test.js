const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const { openDatabase } = require("../src/main/db/openDatabase");
const {
  addScanSource,
  getScanSources,
  updateScanSource,
  removeScanSource,
} = require("../src/main/db/scanSourcesStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-stage0-sources-"));
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

test("scan source store supports add, update, list and remove", async () => {
  const root = makeTempDir();
  const appPaths = buildAppPaths(path.join(root, "profile"));
  const sourceA = path.join(root, "games-a");
  const sourceB = path.join(root, "games-b");

  fs.mkdirSync(sourceA, { recursive: true });
  fs.mkdirSync(sourceB, { recursive: true });
  ensureAppDirs(appPaths);

  const db = await openDatabase(appPaths);
  const created = await addScanSource(db, sourceA);

  assert.equal(created.path, sourceA);
  assert.equal(created.isEnabled, true);

  const updated = await updateScanSource(db, created.id, {
    path: sourceB,
    isEnabled: false,
  });

  assert.equal(updated.path, sourceB);
  assert.equal(updated.isEnabled, false);

  const listed = await getScanSources(db);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].path, sourceB);

  const removed = await removeScanSource(db, created.id);
  assert.deepEqual(removed, { success: true });
  assert.deepEqual(await getScanSources(db), []);

  await closeAsync(db);
});
