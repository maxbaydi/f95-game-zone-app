const test = require("node:test");
const assert = require("node:assert/strict");

const {
  selectLiveUpdateTargets,
  createLiveUpdateChecker,
  LIVE_UPDATE_DEFAULTS,
} = require("../src/main/liveUpdateCheck");
const { pickNewerVersion } = require("../src/shared/versionUpdate");

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-09-27T12:00:00Z");

const games = [
  { record_id: 1, title: "Fav fresh", isFavorite: true, installState: "installed", siteUrl: "https://f95zone.to/threads/a.1/", liveCheckedAt: new Date(NOW - HOUR).toISOString() },
  { record_id: 2, title: "Fav stale", isFavorite: true, installState: "installed", siteUrl: "https://f95zone.to/threads/b.2/", liveCheckedAt: new Date(NOW - 10 * HOUR).toISOString() },
  { record_id: 3, title: "Fav never", isFavorite: true, installState: "installed", siteUrl: "https://f95zone.to/threads/c.3/" },
  { record_id: 4, title: "Plain installed", isFavorite: false, installState: "installed", siteUrl: "https://f95zone.to/threads/d.4/" },
  { record_id: 5, title: "Fav missing files", isFavorite: true, installState: "missing", siteUrl: "https://f95zone.to/threads/e.5/" },
  { record_id: 6, title: "Fav no thread", isFavorite: true, installState: "installed", siteUrl: "" },
  { record_id: 7, title: "Stub", isFavorite: false, installState: "not_installed", siteUrl: "https://f95zone.to/threads/g.7/" },
];

test("selectLiveUpdateTargets picks installed favorites with a thread that were not checked recently", () => {
  const targets = selectLiveUpdateTargets(games, { now: NOW, staleAfterMs: 6 * HOUR });
  assert.deepEqual(targets.map((game) => game.record_id), [2, 3]);
});

test("selectLiveUpdateTargets can include every installed game, favorites first, and honours limit and force", () => {
  const all = selectLiveUpdateTargets(games, { now: NOW, staleAfterMs: 6 * HOUR, favoritesOnly: false });
  assert.deepEqual(all.map((game) => game.record_id), [2, 3, 4]);

  const forced = selectLiveUpdateTargets(games, { now: NOW, staleAfterMs: 6 * HOUR, force: true });
  assert.deepEqual(forced.map((game) => game.record_id), [1, 2, 3]);

  const limited = selectLiveUpdateTargets(games, { now: NOW, staleAfterMs: 6 * HOUR, favoritesOnly: false, limit: 2 });
  assert.deepEqual(limited.map((game) => game.record_id), [2, 3]);
  assert.deepEqual(selectLiveUpdateTargets(null, {}), []);
});

test("pickNewerVersion prefers the higher version and tolerates empty values", () => {
  assert.equal(pickNewerVersion("0.5", "0.9"), "0.9");
  assert.equal(pickNewerVersion("1.2", "0.9"), "1.2");
  assert.equal(pickNewerVersion("", "0.9"), "0.9");
  assert.equal(pickNewerVersion("0.9", ""), "0.9");
  assert.equal(pickNewerVersion("", ""), "");
  assert.equal(pickNewerVersion("0.9", "Final"), "Final");
  assert.equal(pickNewerVersion("v0.9", "0.9"), "v0.9", "equal versions keep the first value");
});

function createHarness(options = {}) {
  const timers = [];
  const saved = [];
  const inspected = [];
  let clock = NOW;
  const checker = createLiveUpdateChecker({
    listGames: async () => options.games || games,
    inspectThread: async (threadUrl) => {
      inspected.push(threadUrl);
      if (options.inspect) {
        return options.inspect(threadUrl);
      }
      return { success: true, version: "9.9", title: "Live title" };
    },
    saveResult: async (result) => {
      saved.push(result);
    },
    isAuthenticated: options.isAuthenticated || (async () => true),
    now: () => clock,
    setTimer: (callback, delay) => {
      const id = timers.length + 1;
      timers.push({ id, callback, delay, cleared: false });
      return id;
    },
    clearTimer: (id) => {
      const timer = timers.find((entry) => entry.id === id);
      if (timer) {
        timer.cleared = true;
      }
    },
    sleep: async () => {},
    intervalMs: 6 * HOUR,
    staleAfterMs: 6 * HOUR,
    logger: { info() {}, warn() {}, error() {} },
    onRunFinished: options.onRunFinished,
  });
  return {
    checker,
    timers,
    saved,
    inspected,
    advance(ms) {
      clock += ms;
    },
  };
}

test("runNow checks stale favorites one by one and stores versions and errors", async () => {
  const harness = createHarness({
    inspect: (threadUrl) => {
      if (threadUrl.includes("/c.3/")) {
        throw new Error("Timed out while loading the F95 thread.");
      }
      return { success: true, version: "9.9", title: "Live title" };
    },
  });

  const summary = await harness.checker.runNow({ reason: "test" });

  assert.deepEqual(harness.inspected, ["https://f95zone.to/threads/b.2/", "https://f95zone.to/threads/c.3/"]);
  assert.equal(summary.checked, 2);
  assert.equal(summary.updated, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skippedReason, "");
  assert.equal(harness.saved.length, 2);
  assert.equal(harness.saved[0].recordId, 2);
  assert.equal(harness.saved[0].version, "9.9");
  assert.equal(harness.saved[0].title, "Live title");
  assert.equal(harness.saved[0].error, "");
  assert.equal(harness.saved[0].checkedAt, new Date(NOW).toISOString());
  assert.equal(harness.saved[1].recordId, 3);
  assert.equal(harness.saved[1].version, "", "a failed check keeps no version");
  assert.match(harness.saved[1].error, /Timed out/);

  const state = harness.checker.getState();
  assert.equal(state.running, false);
  assert.equal(state.lastRun?.checked, 2);
});

test("runNow is skipped without an F95 session and reports why", async () => {
  const harness = createHarness({ isAuthenticated: async () => false });
  const summary = await harness.checker.runNow({ reason: "startup" });

  assert.equal(summary.checked, 0);
  assert.equal(summary.skippedReason, "not_authenticated");
  assert.deepEqual(harness.inspected, []);
});

test("concurrent runNow calls share one run and the checker never overlaps itself", async () => {
  /** @type {((value: any) => void) | undefined} */
  let resolveInspect;
  const harness = createHarness({
    inspect: () => new Promise((resolve) => {
      resolveInspect = resolve;
    }),
    games: [games[2]],
  });

  const first = harness.checker.runNow({ reason: "a" });
  const second = harness.checker.runNow({ reason: "b" });
  assert.equal(harness.checker.getState().running, true);
  // The run first awaits isAuthenticated() and listGames(); wait until the
  // inspection is actually pending before resolving it.
  while (!resolveInspect) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  resolveInspect({ success: true, version: "1.0", title: "" });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(harness.inspected.length, 1);
});

test("start schedules periodic runs and stop clears the timer", async () => {
  const finished = [];
  const harness = createHarness({ onRunFinished: (summary) => finished.push(summary) });

  harness.checker.start();
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0].delay, 6 * HOUR);

  harness.advance(7 * HOUR);
  await harness.timers[0].callback();
  assert.equal(finished.length, 1);
  assert.equal(harness.timers.length, 2, "the next run is scheduled after a run");

  harness.checker.stop();
  assert.equal(harness.timers[1].cleared, true);
  assert.equal(harness.checker.getState().nextRunAt, null);
});

test("defaults are sane: favorites only, six hours, sequential delay", () => {
  assert.equal(LIVE_UPDATE_DEFAULTS.favoritesOnly, true);
  assert.equal(LIVE_UPDATE_DEFAULTS.intervalMs, 6 * HOUR);
  assert.ok(LIVE_UPDATE_DEFAULTS.delayBetweenMs >= 500);
  assert.ok(LIVE_UPDATE_DEFAULTS.limit >= 10);
});
