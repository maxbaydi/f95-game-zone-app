const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  FEATURES,
  MAX_FEATURE_USES,
  createFeatureUsageCounter,
  featureForChannel,
  instrumentIpcHandlers,
} = require("../src/main/featureUsage");
const { createUsageStatsReporter } = require("../src/main/usageStats");
const { createD1 } = require("./helpers/fakeD1");

const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "stats-worker", "schema.sql"), "utf8");
const ID_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ID_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NOW = Date.parse("2026-10-04T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const loadWorker = () => import("../stats-worker/src/stats.js");
const loadCatalog = () => import("../stats-worker/src/features.js");

function makeCounter(statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "feature-usage-")), "feature-usage.json")) {
  let enabled = true;
  const counter = createFeatureUsageCounter({ statePath, isEnabled: () => enabled });
  return { counter, statePath, setEnabled: (value) => { enabled = value; } };
}

function fakeIpcMain() {
  const handlers = new Map();
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) };
}

const ping = (body) =>
  new Request("https://stats.example/v1/ping", { method: "POST", body: JSON.stringify(body) });
const goodPing = (id, features) => ({ id, version: "1.8.3", platform: "win32", arch: "x64", features });

test("only catalogued features are counted, and the renderer may report only where the user goes", () => {
  const { counter } = makeCounter();
  assert.equal(counter.record("library.launch"), true);
  assert.equal(counter.record("library.launch"), true);
  assert.equal(counter.record("games.some-title"), false);
  assert.equal(counter.record(""), false);
  assert.equal(counter.recordRenderer("section.search"), true);
  assert.equal(counter.recordRenderer("settings.page-saves"), true);
  assert.equal(counter.recordRenderer("library.launch"), false, "actions are counted in main, not reported by the page");
  assert.equal(counter.recordRenderer("section.<img src=x>"), false);
  assert.deepEqual(counter.pending(), { "library.launch": 2, "section.search": 1, "settings.page-saves": 1 });
});

test("user actions are recognised by IPC channel; reads and automatic runs are not", () => {
  assert.equal(featureForChannel("launch-game"), "library.launch");
  assert.equal(featureForChannel("delete-version"), "library.remove");
  assert.equal(featureForChannel("remove-library-game"), "library.remove");
  assert.equal(featureForChannel("install-f95-thread"), "downloads.install");
  assert.equal(featureForChannel("sync-save-storage-game"), "saves.sync");
  assert.equal(featureForChannel("get-games"), "");
  assert.equal(featureForChannel("check-app-update"), "");
  assert.equal(featureForChannel("scan-library", { mode: "incremental", reason: "startup" }), "");
  assert.equal(featureForChannel("scan-library", { mode: "refresh" }), "library.rescan");
  for (const channel of ["launch-game", "connect-save-storage", "open-importer", "check-live-updates"]) {
    assert.ok(FEATURES.includes(featureForChannel(channel)), channel);
  }
});

test("instrumented IPC handlers count the action and pass results and errors through", async () => {
  const { counter } = makeCounter();
  const ipcMain = fakeIpcMain();
  instrumentIpcHandlers(ipcMain, counter);
  ipcMain.handle("launch-game", async (_event, payload) => ({ launched: payload.id }));
  ipcMain.handle("get-games", async () => ["a"]);
  ipcMain.handle("set-game-favorite", async () => {
    throw new Error("db locked");
  });

  assert.deepEqual(await ipcMain.handlers.get("launch-game")({}, { id: 7 }), { launched: 7 });
  assert.deepEqual(await ipcMain.handlers.get("get-games")({}), ["a"]);
  await assert.rejects(ipcMain.handlers.get("set-game-favorite")({}), /db locked/);
  assert.deepEqual(counter.pending(), { "library.launch": 1, "library.favorite": 1 });

  // A broken counter must never break the action itself.
  const brittle = fakeIpcMain();
  instrumentIpcHandlers(brittle, { recordChannel: () => { throw new Error("boom"); } });
  brittle.handle("launch-game", async () => "ok");
  assert.equal(await brittle.handlers.get("launch-game")({}), "ok");
});

test("nothing is counted or kept on disk while statistics are off", () => {
  const { counter, statePath, setEnabled } = makeCounter();
  setEnabled(false);
  assert.equal(counter.record("library.launch"), false);
  counter.flush();
  assert.equal(fs.existsSync(statePath), false);

  setEnabled(true);
  counter.record("library.launch");
  counter.flush();
  assert.equal(fs.existsSync(statePath), true);

  setEnabled(false);
  counter.flush();
  assert.equal(fs.existsSync(statePath), false, "switching off drops the unsent counts");
  assert.deepEqual(counter.pending(), {});
});

test("unsent counts survive a restart; junk in the file is ignored and counts are capped", () => {
  const first = makeCounter();
  first.counter.record("library.launch");
  first.counter.record("saves.sync");
  first.counter.flush();
  assert.deepEqual(makeCounter(first.statePath).counter.pending(), { "library.launch": 1, "saves.sync": 1 });

  fs.writeFileSync(
    first.statePath,
    JSON.stringify({ counts: { "library.launch": 1e9, "bad key": 5, "library.favorite": -1, "library.backup": "3", "games.title": 2 } }),
  );
  assert.deepEqual(makeCounter(first.statePath).counter.pending(), { "library.launch": MAX_FEATURE_USES });

  fs.writeFileSync(first.statePath, "{ not json");
  assert.deepEqual(makeCounter(first.statePath).counter.pending(), {});
});

test("the daily ping carries the counts and clears only what was sent", async () => {
  const { counter } = makeCounter();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-stats-"));
  const bodies = [];
  let status = 500;
  const reporter = createUsageStatsReporter({
    statePath: path.join(dir, "usage-stats.json"),
    endpoint: "https://stats.example",
    appVersion: "1.8.3",
    platform: "win32",
    arch: "x64",
    isEnabled: () => true,
    now: () => NOW,
    randomUUID: () => ID_A,
    features: counter,
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      counter.record("library.launch"); // used while the request is in flight
      return { ok: status < 300, status };
    },
  });
  counter.record("library.launch");
  counter.record("saves.sync");

  await assert.rejects(reporter.reportIfDue(), /HTTP 500/);
  assert.deepEqual(counter.pending(), { "library.launch": 2, "saves.sync": 1 }, "a failed ping keeps the counts");

  status = 204;
  assert.equal((await reporter.reportIfDue()).sent, true);
  assert.deepEqual(bodies[1].features, { "library.launch": 2, "saves.sync": 1 });
  assert.deepEqual(counter.pending(), { "library.launch": 1 });
});

test("the worker keeps well-formed feature counts and drops everything else", async () => {
  const { parsePing, MAX_FEATURES_PER_PING } = await loadWorker();
  const parsed = parsePing(
    JSON.stringify(
      goodPing(ID_A, {
        "library.launch": 3,
        "Library.Launch": 1,
        "library.favorite": 0,
        "library.rescan": 2.5,
        nodot: 1,
        "library.backup": MAX_FEATURE_USES + 1,
        "a.b.c.d": 1,
        "saves.sync": "4",
      }),
    ),
  );
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.features, { "library.launch": 3 });
  assert.deepEqual(parsePing(JSON.stringify(goodPing(ID_A))).value.features, {});
  assert.deepEqual(parsePing(JSON.stringify(goodPing(ID_A, ["library.launch"]))).value.features, {});

  const many = {};
  for (let index = 0; index < MAX_FEATURES_PER_PING + 10; index += 1) {
    many[`x.f${index}`] = 1;
  }
  assert.equal(Object.keys(parsePing(JSON.stringify(goodPing(ID_A, many))).value.features).length, MAX_FEATURES_PER_PING);
});

test("feature uses add up per install and day; stats count users, uses and reporting installs", async () => {
  const { handleRequest, buildStats } = await loadWorker();
  const DB = createD1();
  await DB.exec(SCHEMA);
  const env = { DB, STATS_TOKEN: "t" };

  const send = async (body, at) => assert.equal((await handleRequest(ping(body), env, at)).status, 204);
  await send(goodPing(ID_A, { "library.launch": 2, "library.favorite": 1 }), NOW - DAY_MS);
  await send(goodPing(ID_A, { "library.launch": 1 }), NOW);
  await send(goodPing(ID_A, { "library.launch": 4 }), NOW + 1000);
  await send(goodPing(ID_B, { "library.launch": 5, "saves.sync": 2 }), NOW);
  await send({ id: ID_B, version: "1.8.2", platform: "win32", arch: "x64" }, NOW);

  assert.deepEqual(
    await DB.rows("SELECT day, feature, uses FROM feature_daily WHERE id = ?1 ORDER BY day, feature", [ID_A]),
    [
      { day: "2026-10-03", feature: "library.favorite", uses: 1 },
      { day: "2026-10-03", feature: "library.launch", uses: 2 },
      { day: "2026-10-04", feature: "library.launch", uses: 5 },
    ],
  );

  const month = await buildStats(DB, "2026-10-04", 30);
  assert.equal(month.features.reporting, 2);
  assert.deepEqual(month.features.items, [
    { name: "library.launch", users: 2, uses: 12 },
    { name: "saves.sync", users: 1, uses: 2 },
    { name: "library.favorite", users: 1, uses: 1 },
  ]);
  const today = await buildStats(DB, "2026-10-04", 1);
  assert.deepEqual(today.features.items.map((item) => item.name), ["library.launch", "saves.sync"]);
  await DB.close();
});

test("old feature rows are pruned together with the daily rows", async () => {
  const { pruneOldDays, recordPing, RETENTION_DAYS, shiftDay } = await loadWorker();
  const DB = createD1();
  await DB.exec(SCHEMA);
  const old = shiftDay("2026-10-04", -RETENTION_DAYS - 1);
  await recordPing(DB, goodPing(ID_A, { "library.launch": 1 }), old, "");
  await recordPing(DB, goodPing(ID_B, { "library.launch": 1 }), "2026-10-04", "");
  await pruneOldDays(DB, "2026-10-04");
  assert.deepEqual(await DB.rows("SELECT id FROM feature_daily"), [{ id: ID_B }]);
  await DB.close();
});

test("the dashboard ranks features by users, with shares, and lists the catalogued ones nobody used", async () => {
  const { buildFeatureRows } = await import("../stats-worker/src/dashboard.js");
  const rows = buildFeatureRows(
    {
      reporting: 4,
      items: [
        { name: "library.launch", users: 4, uses: 41 },
        { name: "x.unknown", users: 1, uses: 3 },
      ],
    },
    { "library.launch": "Запуск игры", "saves.sync": "Синхронизация" },
    { library: "Библиотека", saves: "Сохранения" },
  );
  assert.deepEqual(rows.used, [
    { name: "library.launch", label: "Запуск игры", group: "Библиотека", users: 4, share: 100, uses: 41, perUser: 10.3 },
    { name: "x.unknown", label: "x.unknown", group: "x", users: 1, share: 25, uses: 3, perUser: 3 },
  ]);
  assert.deepEqual(rows.unused, [{ name: "saves.sync", label: "Синхронизация", group: "Сохранения" }]);
  assert.deepEqual(buildFeatureRows(undefined, {}, {}), { used: [], unused: [] });
});

test("npm run stats lists features by users, or says when there is no data yet", () => {
  const { formatReport } = require("../scripts/usage-stats");
  const usage = { days: 30, totals: {}, versions: [], platforms: [], countries: [], daily: [] };
  const text = formatReport({
    downloads: null,
    usageConfigured: true,
    usage: {
      ...usage,
      features: {
        reporting: 4,
        items: [
          { name: "library.launch", users: 4, uses: 41 },
          { name: "saves.sync", users: 1, uses: 2 },
        ],
      },
    },
  });
  assert.match(text, /Функции за 30 дн\. \(данные от 4 польз\.\)/);
  assert.match(text, /library\.launch\s+4\s+100 %\s+41/);
  assert.match(text, /saves\.sync\s+1\s+25 %\s+2/);

  const empty = formatReport({ downloads: null, usageConfigured: true, usage: { ...usage, features: { reporting: 0, items: [] } } });
  assert.match(empty, /Функции: пока нет данных/);
});

test("every app feature has a dashboard label and group, and no label is stale", async () => {
  const { FEATURE_LABELS, FEATURE_GROUPS, FEATURE_PATTERN } = await loadCatalog();
  assert.deepEqual([...FEATURES].sort(), Object.keys(FEATURE_LABELS).sort());
  for (const feature of FEATURES) {
    assert.match(feature, FEATURE_PATTERN);
    assert.ok(FEATURE_GROUPS[feature.split(".")[0]], `group for ${feature}`);
  }

  const { renderDashboard } = await import("../stats-worker/src/dashboard.js");
  const html = renderDashboard({ repo: "maxbaydi/f95-game-zone-app" });
  assert.ok(html.includes("Что используют"));
  assert.ok(html.includes(JSON.stringify(FEATURE_LABELS["library.launch"])));
});
