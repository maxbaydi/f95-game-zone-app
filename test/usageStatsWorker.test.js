const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "..", "stats-worker", "schema.sql"),
  "utf8",
);
const ID_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ID_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ID_C = "16fd2706-8baf-433b-82eb-8c7fada847da";
const TOKEN = "secret-token";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-04T12:00:00Z");

function loadWorker() {
  return import("../stats-worker/src/stats.js");
}

// The subset of the D1 binding the worker uses, backed by an in-memory
// SQLite database so the real SQL runs.
function createD1() {
  const db = new sqlite3.Database(":memory:");
  const run = (sql, params) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(error) {
        if (error) {
          reject(error);
          return;
        }
        resolve({ success: true, meta: { changes: this.changes } });
      });
    });
  const all = (sql, params) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ success: true, results: rows });
      });
    });
  const statement = (sql, params) => ({
    bind: (...next) => statement(sql, next),
    run: () => run(sql, params),
    all: () => all(sql, params),
    first: async () => (await all(sql, params)).results[0] ?? null,
  });
  return {
    prepare: (sql) => statement(sql, []),
    async batch(statements) {
      await run("BEGIN", []);
      try {
        const results = [];
        for (const item of statements) {
          results.push(await item.run());
        }
        await run("COMMIT", []);
        return results;
      } catch (error) {
        await run("ROLLBACK", []);
        throw error;
      }
    },
    exec: (sql) =>
      new Promise((resolve, reject) => {
        db.exec(sql, (error) => (error ? reject(error) : resolve()));
      }),
    rows: (sql, params = []) => all(sql, params).then((result) => result.results),
    close: () => new Promise((resolve) => db.close(() => resolve())),
  };
}

async function createEnv() {
  const DB = createD1();
  await DB.exec(SCHEMA);
  return { DB, STATS_TOKEN: TOKEN, GITHUB_REPO: "maxbaydi/f95-game-zone-app" };
}

function ping(body, init = {}) {
  return new Request("https://stats.example/v1/ping", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

function stats(query = "", token = TOKEN) {
  return new Request(`https://stats.example/v1/stats${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

const goodPing = (id, version = "1.9.0", platform = "win32") => ({
  id,
  version,
  platform,
  arch: "x64",
});

test("a ping creates the install once per day and tracks its latest version", async () => {
  const { handleRequest } = await loadWorker();
  const env = await createEnv();

  assert.equal((await handleRequest(ping(goodPing(ID_A, "1.8.2")), env, NOW)).status, 204);
  assert.equal((await handleRequest(ping(goodPing(ID_A, "1.8.2")), env, NOW + 1000)).status, 204);
  assert.equal(
    (await handleRequest(ping(goodPing(ID_A, "1.9.0")), env, NOW + DAY_MS)).status,
    204,
  );

  assert.deepEqual(await env.DB.rows("SELECT * FROM installs"), [
    {
      id: ID_A,
      first_seen: "2026-10-04",
      last_seen: "2026-10-05",
      first_version: "1.8.2",
      version: "1.9.0",
      platform: "win32",
      arch: "x64",
      country: "",
    },
  ]);
  assert.deepEqual(
    await env.DB.rows("SELECT day, version FROM daily_active ORDER BY day"),
    [
      { day: "2026-10-04", version: "1.8.2" },
      { day: "2026-10-05", version: "1.9.0" },
    ],
  );
  await env.DB.close();
});

test("pings with a wrong shape are refused and nothing is stored", async () => {
  const { handleRequest } = await loadWorker();
  const env = await createEnv();
  const cases = [
    "not json",
    "[]",
    { ...goodPing(ID_A), id: "not-a-uuid" },
    { ...goodPing(ID_A), id: ID_A.toUpperCase() },
    { ...goodPing(ID_A), version: "latest" },
    { ...goodPing(ID_A), platform: "android" },
    { ...goodPing(ID_A), arch: "mips" },
  ];
  for (const body of cases) {
    const response = await handleRequest(ping(body), env, NOW);
    assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }

  const tooLarge = await handleRequest(
    ping({ ...goodPing(ID_A), padding: "x".repeat(4000) }),
    env,
    NOW,
  );
  assert.equal(tooLarge.status, 413);

  const wrongMethod = await handleRequest(
    new Request("https://stats.example/v1/ping"),
    env,
    NOW,
  );
  assert.equal(wrongMethod.status, 405);

  assert.deepEqual(await env.DB.rows("SELECT COUNT(*) AS n FROM installs"), [{ n: 0 }]);
  await env.DB.close();
});

test("fields beyond the four known ones are never stored", async () => {
  const { handleRequest } = await loadWorker();
  const env = await createEnv();
  const response = await handleRequest(
    ping({ ...goodPing(ID_A), email: "someone@example.com", games: ["x"] }),
    env,
    NOW,
  );
  assert.equal(response.status, 204);
  const [row] = await env.DB.rows("SELECT * FROM installs");
  assert.deepEqual(Object.keys(row).sort(), [
    "arch",
    "country",
    "first_seen",
    "first_version",
    "id",
    "last_seen",
    "platform",
    "version",
  ]);
  assert.ok(!JSON.stringify(row).includes("example.com"));
  await env.DB.close();
});

test("stats need the token and report daily, weekly and monthly users", async () => {
  const { handleRequest } = await loadWorker();
  const env = await createEnv();

  // A: used today and 3 days ago. B: first seen 10 days ago, used today.
  // C: used 40 days ago only.
  await handleRequest(ping(goodPing(ID_C, "1.2.7", "linux")), env, NOW - 40 * DAY_MS);
  await handleRequest(ping(goodPing(ID_B, "1.8.0")), env, NOW - 10 * DAY_MS);
  await handleRequest(ping(goodPing(ID_A, "1.8.2")), env, NOW - 3 * DAY_MS);
  await handleRequest(ping(goodPing(ID_A, "1.9.0")), env, NOW);
  await handleRequest(ping(goodPing(ID_B, "1.9.0")), env, NOW);

  assert.equal((await handleRequest(stats("", ""), env, NOW)).status, 401);
  assert.equal((await handleRequest(stats("", "wrong"), env, NOW)).status, 401);
  assert.equal(
    (await handleRequest(stats(), { ...env, STATS_TOKEN: "" }, NOW)).status,
    503,
  );

  const response = await handleRequest(stats("?days=7"), env, NOW);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.totals, {
    installs: 3,
    active1d: 2,
    active7d: 2,
    active30d: 2,
    new30d: 2,
  });
  assert.equal(body.today, "2026-10-04");
  assert.equal(body.daily.length, 7);
  assert.deepEqual(body.daily[0], { day: "2026-09-28", active: 0, new: 0 });
  assert.deepEqual(body.daily[3], { day: "2026-10-01", active: 1, new: 1 });
  assert.deepEqual(body.daily[6], { day: "2026-10-04", active: 2, new: 0 });
  assert.deepEqual(body.versions, [{ name: "1.9.0", users: 2 }]);
  assert.deepEqual(body.platforms, [{ name: "win32 x64", users: 2 }]);
  assert.deepEqual(body.countries, [{ name: "??", users: 2 }]);
  await env.DB.close();
});

test("the stats window is clamped to one year", async () => {
  const { handleRequest, MAX_STATS_DAYS, DEFAULT_STATS_DAYS } = await loadWorker();
  const env = await createEnv();
  const long = await (await handleRequest(stats("?days=5000"), env, NOW)).json();
  assert.equal(long.daily.length, MAX_STATS_DAYS);
  const fallback = await (await handleRequest(stats("?days=abc"), env, NOW)).json();
  assert.equal(fallback.daily.length, DEFAULT_STATS_DAYS);
  await env.DB.close();
});

test("the country comes from Cloudflare and an unknown one keeps the last known", async () => {
  const { normalizeCountry, recordPing } = await loadWorker();
  assert.equal(normalizeCountry("de"), "DE");
  assert.equal(normalizeCountry("XX"), "");
  assert.equal(normalizeCountry("T1"), "T1");
  assert.equal(normalizeCountry("<script>"), "");
  assert.equal(normalizeCountry(undefined), "");

  const env = await createEnv();
  await recordPing(env.DB, goodPing(ID_A), "2026-10-03", "DE");
  await recordPing(env.DB, goodPing(ID_A), "2026-10-04", "");
  assert.deepEqual(await env.DB.rows("SELECT country FROM installs"), [{ country: "DE" }]);
  await env.DB.close();
});

test("the daily cleanup drops per-day rows past the retention window", async () => {
  const { pruneOldDays, recordPing, RETENTION_DAYS, shiftDay } = await loadWorker();
  const env = await createEnv();
  await recordPing(env.DB, goodPing(ID_A), shiftDay("2026-10-04", -RETENTION_DAYS - 1), "");
  await recordPing(env.DB, goodPing(ID_B), shiftDay("2026-10-04", -RETENTION_DAYS), "");
  await pruneOldDays(env.DB, "2026-10-04");
  assert.deepEqual(await env.DB.rows("SELECT id FROM daily_active"), [{ id: ID_B }]);
  assert.deepEqual(await env.DB.rows("SELECT COUNT(*) AS n FROM installs"), [{ n: 2 }]);
  await env.DB.close();
});

test("the dashboard is served without data and with a locked-down policy", async () => {
  const { handleRequest } = await loadWorker();
  const { renderDashboard } = await import("../stats-worker/src/dashboard.js");
  const env = await createEnv();

  const response = await handleRequest(new Request("https://stats.example/"), env, NOW);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/html/);
  assert.match(response.headers.get("content-security-policy") || "", /default-src 'none'/);
  const html = await response.text();
  assert.ok(html.includes('var REPO = "maxbaydi/f95-game-zone-app";'));
  assert.ok(!html.includes(TOKEN));

  assert.ok(renderDashboard({ repo: '"</script><script>alert(1)//' }).includes('var REPO = "";'));
  assert.equal(
    (await handleRequest(new Request("https://stats.example/nope"), env, NOW)).status,
    404,
  );
  await env.DB.close();
});
