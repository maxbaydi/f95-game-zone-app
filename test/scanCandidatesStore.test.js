const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const { openDatabase } = require("../src/main/db/openDatabase");
const {
  upsertScanCandidates,
  markScanCandidateImported,
  listScanCandidates,
} = require("../src/main/db/scanCandidatesStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-stage0-candidates-"));
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

test("scan candidate store upserts and marks imported candidates", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);

  const created = await upsertScanCandidates(db, [
    {
      sourceId: 1,
      lastJobId: 7,
      folderPath: "C:/games/example",
      title: "Example Game",
      creator: "Creator",
      engine: "renpy",
      version: "0.1",
      executableName: "example.exe",
      atlasId: "100",
      f95Id: "200",
      isArchive: false,
      detectionScore: 85,
      detectionReasons: ["found game directory", "matched renpy runtime signature"],
      matchCount: 1,
      status: "detected",
    },
  ]);

  assert.equal(created.length, 1);
  assert.equal(created[0].status, "detected");
  assert.equal(created[0].detectionScore, 85);

  const updated = await upsertScanCandidates(db, [
    {
      sourceId: 2,
      lastJobId: 8,
      folderPath: "C:/games/example",
      title: "Example Game",
      creator: "Creator",
      engine: "renpy",
      version: "0.2",
      executableName: "example.exe",
      detectionScore: 90,
      detectionReasons: ["found typical Ren'Py files inside game directory"],
      matchCount: 2,
      status: "detected",
    },
  ]);

  assert.equal(updated[0].sourceId, 2);
  assert.equal(updated[0].version, "0.2");
  assert.equal(updated[0].matchCount, 2);

  const imported = await markScanCandidateImported(db, "C:/games/example", 42);

  assert.equal(imported?.status, "imported");
  assert.equal(imported?.libraryRecordId, 42);
  assert.ok(imported?.importedAt);

  const listed = await listScanCandidates(db, 5);

  assert.equal(listed.length, 1);
  assert.equal(listed[0].folderPath, "C:/games/example");
  assert.equal(listed[0].status, "imported");

  await closeAsync(db);
});
