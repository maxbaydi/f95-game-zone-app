const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  INSTALL_ID_PATTERN,
  createUsageStatsReporter,
  normalizeUsageStatsEndpoint,
  resolveUsageStatsEndpoint,
} = require("../src/main/usageStats");
const { applySettingsPatch } = require("../src/main/settingsPatch");

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-10-04T08:00:00Z");
const FIXED_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function makeReporter(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-stats-"));
  const statePath = path.join(dir, "usage-stats.json");
  const calls = [];
  let time = START;
  let enabled = true;
  let respond = () => ({ ok: true, status: 204 });
  const reporter = createUsageStatsReporter({
    statePath,
    endpoint: "https://stats.example/",
    appVersion: "v1.9.0",
    platform: "win32",
    arch: "x64",
    isEnabled: () => enabled,
    now: () => time,
    randomUUID: () => FIXED_ID,
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return respond();
    },
    ...overrides,
  });
  return {
    reporter,
    statePath,
    calls,
    advance: (ms) => {
      time += ms;
    },
    setEnabled: (value) => {
      enabled = value;
    },
    setResponse: (fn) => {
      respond = fn;
    },
  };
}

test("the first run creates a random id and sends exactly four fields", async () => {
  const { reporter, calls, statePath } = makeReporter();

  const result = await reporter.reportIfDue();

  assert.deepEqual(result, { sent: true, reason: "sent", day: "2026-10-04" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://stats.example/v1/ping");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].body, {
    id: FIXED_ID,
    version: "1.9.0",
    platform: "win32",
    arch: "x64",
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, "utf8")), {
    installId: FIXED_ID,
    lastReportDay: "2026-10-04",
  });
});

test("one ping per UTC day, with the same id on the next day", async () => {
  const { reporter, calls, advance } = makeReporter();

  await reporter.reportIfDue();
  advance(10 * 60 * 60 * 1000);
  assert.deepEqual(await reporter.reportIfDue(), { sent: false, reason: "already-sent" });
  advance(DAY_MS);
  assert.equal((await reporter.reportIfDue()).sent, true);

  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.id, calls[0].body.id);
});

test("a failed request is retried later with the id kept", async () => {
  const { reporter, calls, statePath, setResponse } = makeReporter();
  setResponse(() => ({ ok: false, status: 500 }));

  await assert.rejects(reporter.reportIfDue(), /HTTP 500/);
  assert.deepEqual(reporter.readState(), { installId: FIXED_ID, lastReportDay: "" });

  setResponse(() => {
    throw new Error("offline");
  });
  await assert.rejects(reporter.reportIfDue(), /offline/);

  setResponse(() => ({ ok: true, status: 204 }));
  assert.equal((await reporter.reportIfDue()).sent, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.body.id === FIXED_ID));
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).lastReportDay, "2026-10-04");
});

test("nothing is sent when the switch is off or the build has no endpoint", async () => {
  const off = makeReporter();
  off.setEnabled(false);
  assert.deepEqual(await off.reporter.reportIfDue(), { sent: false, reason: "disabled" });
  assert.equal(off.reporter.isActive(), false);
  assert.equal(off.calls.length, 0);
  assert.equal(fs.existsSync(off.statePath), false);

  const noEndpoint = makeReporter({ endpoint: "" });
  assert.deepEqual(await noEndpoint.reporter.reportIfDue(), {
    sent: false,
    reason: "no-endpoint",
  });
  assert.equal(noEndpoint.calls.length, 0);
});

test("a damaged state file is replaced instead of breaking the ping", async () => {
  const { reporter, statePath, calls } = makeReporter();
  fs.writeFileSync(statePath, "{not json");
  assert.equal((await reporter.reportIfDue()).sent, true);
  assert.equal(calls[0].body.id, FIXED_ID);
});

test("the default id generator makes version 4 UUIDs", async () => {
  const { reporter, calls } = makeReporter({ randomUUID: undefined });
  await reporter.reportIfDue();
  assert.match(calls[0].body.id, INSTALL_ID_PATTERN);
});

test("only https endpoints (or local http for testing) are used", () => {
  assert.equal(normalizeUsageStatsEndpoint("https://stats.example.workers.dev/"), "https://stats.example.workers.dev");
  assert.equal(normalizeUsageStatsEndpoint("http://localhost:8787"), "http://localhost:8787");
  assert.equal(normalizeUsageStatsEndpoint("http://stats.example"), "");
  assert.equal(normalizeUsageStatsEndpoint("ftp://stats.example"), "");
  assert.equal(normalizeUsageStatsEndpoint("not a url"), "");
  assert.equal(normalizeUsageStatsEndpoint(""), "");
});

test("dev runs report only when the environment variable asks for it", () => {
  const packageEndpoint = "https://stats.example";
  assert.equal(resolveUsageStatsEndpoint({ isPackaged: true, env: {}, packageEndpoint }), packageEndpoint);
  assert.equal(resolveUsageStatsEndpoint({ isPackaged: false, env: {}, packageEndpoint }), "");
  assert.equal(
    resolveUsageStatsEndpoint({
      isPackaged: false,
      env: { F95LAUNCHER_USAGE_STATS_URL: "http://localhost:8787/" },
      packageEndpoint,
    }),
    "http://localhost:8787",
  );
  assert.equal(resolveUsageStatsEndpoint({ isPackaged: true, env: {}, packageEndpoint: "" }), "");
});

test("packaged builds report to the deployed stats worker", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const packageEndpoint = packageJson.usageStats?.endpoint;
  assert.equal(packageEndpoint, "https://f95launcher-stats.maxbayqoor.workers.dev");
  assert.equal(normalizeUsageStatsEndpoint(packageEndpoint), packageEndpoint);
  assert.equal(resolveUsageStatsEndpoint({ isPackaged: true, env: {}, packageEndpoint }), packageEndpoint);
});

test("the renderer may only flip the switch, never touch the install id", () => {
  const next = applySettingsPatch({}, "UsageStats", { enabled: "false" });
  assert.deepEqual(next.UsageStats, { enabled: false });
  assert.throws(
    () => applySettingsPatch({}, "UsageStats", { installId: FIXED_ID }),
    /Unknown setting/,
  );
});
