const test = require("node:test");
const assert = require("node:assert/strict");

const {
  REINSTALL_TERMINAL_STATUSES,
  selectMissingGames,
  partitionReinstallableGames,
  normalizeThreadKey,
  isTerminalDownloadStatus,
  createReinstallQueue,
  findDownloadForGame,
  advanceReinstallQueue,
} = require("../src/shared/missingGamesActions");

const missingA = {
  record_id: 1,
  title: "Alpha",
  installState: "missing",
  siteUrl: "https://f95zone.to/threads/alpha.1/",
};
const missingB = {
  record_id: 2,
  title: "Beta",
  installState: "missing",
  siteUrl: "https://f95zone.to/threads/beta.2",
};
const missingNoThread = { record_id: 3, title: "Gamma", installState: "missing", siteUrl: "" };
const installed = { record_id: 4, title: "Delta", installState: "installed", siteUrl: "x" };

test("selectMissingGames and partitionReinstallableGames split the library correctly", () => {
  const missing = selectMissingGames([missingA, installed, missingB, missingNoThread, null]);
  assert.deepEqual(missing.map((game) => game.record_id), [1, 2, 3]);

  const parts = partitionReinstallableGames(missing);
  assert.deepEqual(parts.reinstallable.map((game) => game.record_id), [1, 2]);
  assert.deepEqual(parts.unlinkable.map((game) => game.record_id), [3]);
});

test("normalizeThreadKey ignores case and trailing slashes", () => {
  assert.equal(normalizeThreadKey("https://F95zone.to/threads/Alpha.1/"), "https://f95zone.to/threads/alpha.1");
  assert.equal(normalizeThreadKey("  "), "");
  assert.equal(normalizeThreadKey(null), "");
});

test("terminal download statuses end a queue step", () => {
  assert.deepEqual([...REINSTALL_TERMINAL_STATUSES].sort(), ["action", "cancelled", "completed", "error"]);
  assert.equal(isTerminalDownloadStatus("completed"), true);
  assert.equal(isTerminalDownloadStatus("downloading"), false);
  assert.equal(isTerminalDownloadStatus(""), false);
});

test("findDownloadForGame matches by thread url and prefers the newest entry", () => {
  const downloads = [
    { id: "old", threadUrl: "https://f95zone.to/threads/alpha.1/", status: "error", updatedAt: 1 },
    { id: "new", threadUrl: "https://F95ZONE.to/threads/alpha.1", status: "downloading", updatedAt: 5 },
    { id: "other", threadUrl: "https://f95zone.to/threads/beta.2/", status: "completed", updatedAt: 9 },
  ];

  assert.equal(findDownloadForGame(downloads, missingA)?.id, "new");
  assert.equal(findDownloadForGame(downloads, missingB)?.id, "other");
  assert.equal(findDownloadForGame(downloads, missingNoThread), null);
  assert.equal(findDownloadForGame([], missingA), null);
});

test("advanceReinstallQueue hands out games one at a time and finishes them on terminal statuses", () => {
  const queue = createReinstallQueue([missingA, missingB]);
  assert.equal(queue.active, null);
  assert.equal(queue.pending.length, 2);

  const first = advanceReinstallQueue(queue, [], 10);
  assert.equal(first.next?.record_id, 1);
  assert.equal(first.queue.active?.record_id, 1);
  assert.equal(first.queue.pending.length, 1);
  assert.equal(first.finished, null);

  // Still downloading: nothing changes.
  const waiting = advanceReinstallQueue(first.queue, [
    { threadUrl: missingA.siteUrl, status: "downloading", updatedAt: 11 },
  ], 12);
  assert.equal(waiting.next, null);
  assert.equal(waiting.queue.active?.record_id, 1);

  // Completed: the game is finished and the next one starts.
  const done = advanceReinstallQueue(first.queue, [
    { threadUrl: missingA.siteUrl, status: "completed", updatedAt: 20 },
  ], 21);
  assert.equal(done.finished?.game.record_id, 1);
  assert.equal(done.finished?.status, "completed");
  assert.equal(done.next?.record_id, 2);
  assert.equal(done.queue.done.length, 1);

  const last = advanceReinstallQueue(done.queue, [
    { threadUrl: missingA.siteUrl, status: "completed", updatedAt: 20 },
    { threadUrl: missingB.siteUrl, status: "error", updatedAt: 30 },
  ], 31);
  assert.equal(last.finished?.status, "error");
  assert.equal(last.next, null);
  assert.equal(last.queue.active, null);
  assert.equal(last.queue.pending.length, 0);
  assert.equal(last.queue.isFinished, true);
});

test("advanceReinstallQueue ignores stale downloads recorded before the step started", () => {
  const queue = createReinstallQueue([missingA]);
  const started = advanceReinstallQueue(queue, [
    { threadUrl: missingA.siteUrl, status: "completed", updatedAt: 5 },
  ], 10);
  assert.equal(started.next?.record_id, 1);

  const stale = advanceReinstallQueue(started.queue, [
    { threadUrl: missingA.siteUrl, status: "completed", updatedAt: 5 },
  ], 11);
  assert.equal(stale.finished, null, "an old completed download must not finish the new step");
  assert.equal(stale.queue.active?.record_id, 1);
});

test("markReinstallStepFailed skips a game that could not be queued", () => {
  const { markReinstallStepFailed } = require("../src/shared/missingGamesActions");
  const queue = createReinstallQueue([missingA, missingB]);
  const started = advanceReinstallQueue(queue, [], 1);
  const failed = markReinstallStepFailed(started.queue, "no_mirror");
  assert.equal(failed.active, null);
  assert.deepEqual(failed.done.map((entry) => [entry.game.record_id, entry.status]), [[1, "no_mirror"]]);
  const next = advanceReinstallQueue(failed, [], 2);
  assert.equal(next.next?.record_id, 2);
});
