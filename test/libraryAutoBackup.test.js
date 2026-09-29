const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AUTO_BACKUP_PREFIX,
  runScheduledLibraryBackup,
} = require("../src/main/libraryAutoBackup");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-29T10:00:00Z");

function makeBackup(name, daysAgo) {
  return {
    path: `/backups/${name}`,
    fileName: name,
    createdAt: new Date(NOW - daysAgo * DAY).toISOString(),
  };
}

test("no automatic backup while the last one is younger than a week", async () => {
  const created = [];
  const result = await runScheduledLibraryBackup({
    listBackups: async () => [makeBackup(`${AUTO_BACKUP_PREFIX}-20260925-100000.db`, 4)],
    createBackup: async (input) => {
      created.push(input);
      return "/backups/new.db";
    },
    now: () => NOW,
  });
  assert.deepEqual(result, { created: "", skipped: "recent", removed: [] });
  assert.equal(created.length, 0);
});

test("a stale automatic backup triggers a new one and old automatic copies are rotated", async () => {
  const removed = [];
  const result = await runScheduledLibraryBackup({
    listBackups: async () => [
      makeBackup("library-20260901-100000.db", 28), // manual: never touched
      makeBackup(`${AUTO_BACKUP_PREFIX}-20260922-100000.db`, 7),
      makeBackup(`${AUTO_BACKUP_PREFIX}-20260915-100000.db`, 14),
      makeBackup(`${AUTO_BACKUP_PREFIX}-20260908-100000.db`, 21),
      makeBackup(`${AUTO_BACKUP_PREFIX}-20260901-100000.db`, 28),
    ],
    createBackup: async (input) => {
      assert.equal(input.fileNamePrefix, AUTO_BACKUP_PREFIX);
      return "/backups/library-auto-20260929-100000.db";
    },
    removeFile: async (filePath) => {
      removed.push(filePath);
    },
    keep: 3,
    now: () => NOW,
    logger: { info() {} },
  });
  assert.equal(result.created, "/backups/library-auto-20260929-100000.db");
  assert.deepEqual(result.removed, [
    `/backups/${AUTO_BACKUP_PREFIX}-20260908-100000.db`,
    `/backups/${AUTO_BACKUP_PREFIX}-20260901-100000.db`,
  ]);
  assert.deepEqual(removed, result.removed);
});

test("the first automatic backup is created when none exists", async () => {
  const result = await runScheduledLibraryBackup({
    listBackups: async () => [],
    createBackup: async () => "/backups/first.db",
    now: () => NOW,
    logger: { info() {} },
  });
  assert.equal(result.created, "/backups/first.db");
  assert.deepEqual(result.removed, []);
});
