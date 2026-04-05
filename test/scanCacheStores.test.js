const test = require("node:test");
const assert = require("node:assert/strict");
const sqlite3 = require("sqlite3");

const {
  clearScanCandidates,
  listScanCandidates,
  upsertScanCandidates,
} = require("../src/main/db/scanCandidatesStore");
const {
  clearScanJobs,
  createScanJob,
  listScanJobs,
} = require("../src/main/db/scanJobsStore");
const {
  shouldQueueScannedGame,
  shouldIgnoreCandidateDirectory,
} = require("../src/core/scanners/f95scanner");

function openMemoryDatabase() {
  return new sqlite3.Database(":memory:");
}

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, [], (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

test("clearScanCandidates removes persisted scan candidates", async () => {
  const db = openMemoryDatabase();

  await run(
    db,
    `
      CREATE TABLE scan_candidates
      (
        id INTEGER PRIMARY KEY,
        source_id INTEGER,
        last_job_id INTEGER,
        library_record_id INTEGER,
        folder_path TEXT UNIQUE,
        title TEXT,
        creator TEXT,
        engine TEXT,
        version TEXT,
        executable_name TEXT,
        atlas_id TEXT,
        f95_id TEXT,
        is_archive INTEGER,
        detection_score INTEGER,
        detection_reasons_json TEXT,
        match_status TEXT,
        match_score INTEGER,
        match_reasons_json TEXT,
        match_count INTEGER,
        status TEXT,
        first_seen_at TEXT,
        last_seen_at TEXT,
        imported_at TEXT
      )
    `,
  );

  await upsertScanCandidates(db, [
    {
      folderPath: "C:\\games\\sample",
      title: "Sample Game",
      creator: "Creator",
      status: "detected",
    },
  ]);

  const clearResult = await clearScanCandidates(db);
  const remaining = await listScanCandidates(db, 10);

  assert.equal(clearResult.deleted, 1);
  assert.deepEqual(remaining, []);
});

test("clearScanJobs removes persisted scan job history", async () => {
  const db = openMemoryDatabase();

  await run(
    db,
    `
      CREATE TABLE scan_jobs
      (
        id INTEGER PRIMARY KEY,
        mode TEXT,
        status TEXT,
        source_count INTEGER,
        games_found INTEGER,
        errors_count INTEGER,
        started_at TEXT,
        finished_at TEXT,
        notes_json TEXT
      )
    `,
  );

  await createScanJob(db, {
    mode: "scan_sources",
    status: "running",
    sourceCount: 2,
  });

  const clearResult = await clearScanJobs(db);
  const remaining = await listScanJobs(db, 10);

  assert.equal(clearResult.deleted, 1);
  assert.deepEqual(remaining, []);
});

test("shouldQueueScannedGame only bypasses duplicates for force rescans", () => {
  assert.equal(
    shouldQueueScannedGame({
      recordExist: false,
      forceRescan: false,
    }),
    true,
  );
  assert.equal(
    shouldQueueScannedGame({
      recordExist: true,
      forceRescan: false,
    }),
    false,
  );
  assert.equal(
    shouldQueueScannedGame({
      recordExist: true,
      forceRescan: true,
    }),
    true,
  );
});

test("shouldIgnoreCandidateDirectory skips nested runtime/helper paths", () => {
  assert.equal(
    shouldIgnoreCandidateDirectory(
      "C:\\games\\TheGildedLadder\\TheGildedLadder\\game\\fonts\\DIN",
      "C:\\games",
    ),
    true,
  );
  assert.equal(
    shouldIgnoreCandidateDirectory(
      "C:\\games\\Isekai_Bastard\\Rus\\Isekai Bastard_Data\\Managed",
      "C:\\games",
    ),
    true,
  );
  assert.equal(
    shouldIgnoreCandidateDirectory(
      "C:\\games\\Caribdis\\Eternum\\v0.8",
      "C:\\games",
    ),
    false,
  );
});
