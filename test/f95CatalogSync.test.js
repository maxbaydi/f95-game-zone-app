const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");

const { runMigrations } = require("../src/main/db/runMigrations");
const store = require("../src/main/db/f95CatalogStore");
const { createF95CatalogSync } = require("../src/main/catalog/f95CatalogSync");
const { buildListUrl, LATEST_PAGE_URL } = require("../src/main/catalog/f95CatalogParser");

const FIXTURES = path.join(__dirname, "fixtures", "f95", "catalog");
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const PAGE_HTML = readFixture("latest_alpha.html");
const PAGE_1 = JSON.parse(readFixture("list-games-date-page-1.json"));
const PAGE_2 = JSON.parse(readFixture("list-games-date-page-2.json"));

async function openMigrated() {
  const db = new sqlite3.Database(":memory:");
  await runMigrations(db);
  return db;
}

/**
 * A fake site with `pages` list pages (rows shifted in time so every page
 * is distinct), answering like latest_data.php does.
 */
function makeSite({ pages = 3, rowsPerPage = 90 } = {}) {
  const rows = [...PAGE_1.msg.data, ...PAGE_2.msg.data];
  const allRows = [];
  for (let page = 0; page < pages; page += 1) {
    for (let index = 0; index < rowsPerPage; index += 1) {
      const base = rows[(page * rowsPerPage + index) % rows.length];
      allRows.push({
        ...base,
        thread_id: 1000 + page * rowsPerPage + index,
        ts: 2000000000 - (page * rowsPerPage + index) * 60,
      });
    }
  }
  const site = {
    requests: [],
    failures: new Map(),
    allRows,
    bump(count) {
      // `count` threads get a new version and move to the top.
      for (let index = 0; index < count; index += 1) {
        const row = allRows[allRows.length - 1 - index];
        row.version = `${row.version}+1`;
        row.ts = 2000000000 + 60 * (index + 1);
      }
      allRows.sort((left, right) => right.ts - left.ts);
    },
    async fetchText(url) {
      site.requests.push(url);
      const planned = site.failures.get(url);
      if (planned && planned.length > 0) {
        const failure = planned.shift();
        if (failure instanceof Error) {
          throw failure;
        }
        return failure;
      }
      if (url === LATEST_PAGE_URL) {
        return { status: 200, text: PAGE_HTML };
      }
      const page = Number(new URL(url).searchParams.get("page")) || 1;
      const total = Math.ceil(allRows.length / rowsPerPage);
      const effective = Math.min(page, total);
      const data = allRows.slice((effective - 1) * rowsPerPage, effective * rowsPerPage);
      return {
        status: 200,
        text: JSON.stringify({ status: "ok", msg: { data, pagination: { page: effective, total }, count: allRows.length } }),
      };
    },
  };
  return site;
}

function makeSync(db, site, overrides = {}) {
  const progress = [];
  const sync = createF95CatalogSync({
    db,
    fetchText: site.fetchText,
    hasSession: () => true,
    logger: { info() {}, warn() {}, error() {} },
    sleep: async () => {},
    onProgress: (payload) => progress.push(payload),
    delayBetweenPagesMs: 0,
    retryBaseDelayMs: 0,
    ...overrides,
  });
  return { sync, progress };
}

test("the first run walks every page, stores the cursor and finishes with fullDone", async () => {
  const db = await openMigrated();
  const site = makeSite({ pages: 3 });
  const { sync, progress } = makeSync(db, site);

  const summary = await sync.run({ reason: "startup" });
  assert.equal(summary.success, true, summary.error);
  assert.equal(summary.mode, "full");
  assert.equal(summary.pagesFetched, 3);
  assert.equal(summary.entriesWritten, 270);
  assert.equal(summary.added, 270);
  assert.equal(summary.fullDone, true);
  assert.equal(summary.totalPages, 3);
  assert.equal(summary.entryCount, 270);
  assert.match(summary.message, /270 entries changed/);
  assert.equal(site.requests[0], LATEST_PAGE_URL, "definitions come first");
  assert.deepEqual(site.requests.slice(1), [1, 2, 3].map((page) => buildListUrl({ page })));

  const state = await store.getCatalogSyncState(db);
  assert.equal(state.fullDone, true);
  assert.equal(state.fullNextPage, 1);
  assert.equal(state.newestTs, 2000000000);
  assert.ok(state.definitions.prefixes["7"]);
  assert.equal(state.lastError, "");
  assert.ok(state.lastSuccessAt);
  assert.ok(progress.some((entry) => /page 2 of 3/.test(entry.text)));
  const stored = await store.getCatalogEntry(db, 1000);
  assert.equal(stored.engine, "Ren'Py");
  db.close();
});

test("a run that fails half-way keeps its pages and resumes from the stored cursor", async () => {
  const db = await openMigrated();
  const site = makeSite({ pages: 4 });
  site.failures.set(buildListUrl({ page: 3 }), [new Error("socket hang up"), new Error("socket hang up"), new Error("socket hang up"), new Error("socket hang up")]);
  const { sync } = makeSync(db, site, { retryAttempts: 4 });

  const first = await sync.run();
  assert.equal(first.success, false);
  assert.equal(first.skippedReason, "network");
  assert.equal(first.pagesFetched, 2);
  assert.equal(await store.countCatalogEntries(db), 180);
  let state = await store.getCatalogSyncState(db);
  assert.equal(state.fullDone, false);
  assert.equal(state.fullNextPage, 3);
  assert.match(state.lastError, /socket hang up/);
  assert.equal(site.requests.filter((url) => url === buildListUrl({ page: 3 })).length, 4, "four attempts");

  const second = await sync.run();
  assert.equal(second.success, true, second.error);
  assert.equal(second.mode, "full");
  assert.equal(second.pagesFetched, 2, "pages 3 and 4 only");
  assert.equal(await store.countCatalogEntries(db), 360);
  state = await store.getCatalogSyncState(db);
  assert.equal(state.fullDone, true);
  assert.equal(state.lastError, "");
  assert.equal(site.requests.filter((url) => url === LATEST_PAGE_URL).length, 1, "definitions are cached");
  db.close();
});

test("after a full run the sync reads only the pages with new updates", async () => {
  const db = await openMigrated();
  const site = makeSite({ pages: 4 });
  const { sync } = makeSync(db, site);
  await sync.run();
  site.requests.length = 0;

  const quiet = await sync.run({ reason: "interval" });
  assert.equal(quiet.mode, "incremental");
  assert.equal(quiet.pagesFetched, 1);
  assert.equal(quiet.changed, 0);
  assert.equal(quiet.message, "The catalog is up to date.");

  site.bump(100); // more than one page of fresh updates
  site.requests.length = 0;
  const busy = await sync.run({ reason: "interval" });
  assert.equal(busy.success, true, busy.error);
  assert.equal(busy.mode, "incremental");
  assert.equal(busy.pagesFetched, 2, "page 2 still holds a known row, so it stops there");
  assert.equal(busy.changed, 100);
  assert.equal(busy.versionChanged, 100);
  assert.equal(busy.added, 0);
  assert.equal((await store.getCatalogSyncState(db)).newestTs, 2000000000 + 60 * 100);
  db.close();
});

test("an incremental run that never reaches known rows continues as a full pass", async () => {
  const db = await openMigrated();
  const site = makeSite({ pages: 5 });
  const { sync } = makeSync(db, site, { maxIncrementalPages: 2 });
  await sync.run();
  site.bump(400); // everything moved
  site.requests.length = 0;

  const summary = await sync.run();
  assert.equal(summary.success, true, summary.error);
  assert.equal(summary.mode, "full");
  assert.equal(summary.pagesFetched, 5);
  assert.equal(summary.fullDone, true);
  assert.equal((await store.getCatalogSyncState(db)).fullNextPage, 1);
  db.close();
});

test("no session: nothing is fetched; a login page or a site error stops the run as a session problem", async () => {
  const db = await openMigrated();
  const site = makeSite({ pages: 1 });
  let session = false;
  const { sync } = makeSync(db, site, { hasSession: () => session });

  const skipped = await sync.run();
  assert.equal(skipped.success, true);
  assert.equal(skipped.skippedReason, "no-session");
  assert.equal(skipped.mode, "none");
  assert.equal(site.requests.length, 0);

  session = true;
  site.failures.set(buildListUrl({ page: 1 }), [
    { status: 200, text: '<html><body><form action="/login/login" name="login">Log in</form></body></html>' },
  ]);
  const expired = await sync.run();
  assert.equal(expired.success, false);
  assert.equal(expired.skippedReason, "session");
  assert.equal(await store.countCatalogEntries(db), 0);

  site.failures.set(buildListUrl({ page: 1 }), [{ status: 403, text: "" }]);
  const refused = await sync.run();
  assert.equal(refused.skippedReason, "session");

  site.failures.set(buildListUrl({ page: 1 }), [{ status: 200, text: JSON.stringify({ status: "error", msg: "Missing category" }) }]);
  const siteError = await sync.run();
  assert.equal(siteError.success, false);
  assert.equal(siteError.skippedReason, "bad-response");
  assert.match(siteError.error, /Missing category/);
  db.close();
});

test("HTTP 429 and 5xx are retried, other statuses are not; runs never overlap; cancel stops a run", async () => {
  const db = await openMigrated();
  const site = makeSite({ pages: 2 });
  site.failures.set(buildListUrl({ page: 1 }), [{ status: 429, text: "" }, { status: 503, text: "" }]);
  const { sync } = makeSync(db, site, { retryAttempts: 3 });

  const first = sync.run();
  const second = sync.run();
  assert.equal(first, second, "a second run while one is in progress returns the same promise");
  assert.equal(sync.isRunning(), true);
  const summary = await first;
  assert.equal(summary.success, true, summary.error);
  assert.equal(site.requests.filter((url) => url === buildListUrl({ page: 1 })).length, 3);
  assert.equal(sync.isRunning(), false);
  assert.equal(sync.getLastSummary().pagesFetched, 2);

  site.failures.set(buildListUrl({ page: 1 }), [{ status: 404, text: "" }]);
  const notFound = await sync.run({ mode: "full" });
  assert.equal(notFound.success, false);
  assert.equal(notFound.skippedReason, "http");
  assert.equal(site.requests.filter((url) => url === buildListUrl({ page: 1 })).length, 4, "404 is not retried");

  const slowSite = makeSite({ pages: 3 });
  const originalFetch = slowSite.fetchText;
  const cancellable = createF95CatalogSync({
    db: await openMigrated(),
    fetchText: async (url) => {
      const response = await originalFetch(url);
      if (url !== LATEST_PAGE_URL) {
        cancellable.cancel();
      }
      return response;
    },
    hasSession: () => true,
    logger: { info() {}, warn() {} },
    sleep: async () => {},
    delayBetweenPagesMs: 0,
  });
  const cancelled = await cancellable.run({ mode: "full" });
  assert.equal(cancelled.success, false);
  assert.equal(cancelled.skippedReason, "cancelled");
  assert.equal(cancelled.pagesFetched, 1);
  db.close();
});
