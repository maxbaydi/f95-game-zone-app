const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const { openDatabase } = require("../src/main/db/openDatabase");
const {
  createScanJob,
  finishScanJob,
  listScanJobs,
} = require("../src/main/db/scanJobsStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-stage0-jobs-"));
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

test("scan job store records and completes jobs", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);

  const created = await createScanJob(db, {
    mode: "scan_sources",
    status: "running",
    sourceCount: 2,
    notes: { sourceIds: [1, 2] },
  });

  assert.equal(created.mode, "scan_sources");
  assert.equal(created.status, "running");
  assert.equal(created.sourceCount, 2);

  const finished = await finishScanJob(db, created.id, {
    status: "success",
    gamesFound: 6,
    errorsCount: 0,
    notes: { sourceIds: [1, 2], sourcePaths: ["C:/a", "C:/b"] },
  });

  assert.equal(finished.status, "success");
  assert.equal(finished.gamesFound, 6);
  assert.equal(finished.errorsCount, 0);
  assert.ok(finished.finishedAt);

  const listed = await listScanJobs(db, 5);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);

  await closeAsync(db);
});
