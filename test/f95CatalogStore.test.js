const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");

const { runMigrations } = require("../src/main/db/runMigrations");
const store = require("../src/main/db/f95CatalogStore");
const { parseDefinitions, parseListResponse } = require("../src/main/catalog/f95CatalogParser");

const FIXTURES = path.join(__dirname, "fixtures", "f95", "catalog");
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function openMigrated() {
  const db = new sqlite3.Database(":memory:");
  await runMigrations(db);
  return db;
}

function loadPageEntries(name) {
  const definitions = parseDefinitions(readFixture("latest_alpha.html")).definitions;
  const parsed = parseListResponse(readFixture(name), definitions);
  assert.equal(parsed.ok, true, parsed.error);
  return parsed.entries;
}

test("migration 012 carries Atlas mappings and catalog rows over, then drops the Atlas tables", async () => {
  const db = new sqlite3.Database(":memory:");
  // Apply everything up to 011, seed the old tables, then apply 012.
  const migrations = require("../src/main/db/migrations");
  const before = migrations.filter((migration) => migration.version <= 11);
  for (const migration of before) {
    for (const statement of migration.statements) {
      await run(db, statement);
    }
  }
  await run(db, "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const migration of before) {
    await run(db, "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [migration.version, migration.name, "x"]);
  }
  await run(db, "INSERT INTO games (title, creator, engine, last_played_r, total_playtime) VALUES ('A', 'Dev', 'renpy', 0, 0)");
  await run(db, "INSERT INTO games (title, creator, engine, last_played_r, total_playtime) VALUES ('B', 'Dev', 'renpy', 0, 0)");
  await run(db, "INSERT INTO games (title, creator, engine, last_played_r, total_playtime) VALUES ('C', 'Dev', 'renpy', 0, 0)");
  await run(db, "INSERT INTO atlas_data (atlas_id, title, creator, engine, version, status) VALUES (10, 'Alpha', 'Dev', 'Ren''Py', '0.5', 'Completed')");
  await run(db, "INSERT INTO atlas_data (atlas_id, title, creator, engine, version) VALUES (11, 'Beta', 'Dev', 'Unity', '1.0')");
  await run(db, "INSERT INTO atlas_data (atlas_id, title, creator, engine, version) VALUES (12, 'No thread', 'Dev', 'Unity', '1.0')");
  await run(db, "INSERT INTO f95_zone_data (f95_id, atlas_id, site_url, banner_url, tags) VALUES (500, 10, 'https://f95zone.to/threads/alpha.500/', 'https://img/a.jpg', 'milf, rpg')");
  await run(db, "INSERT INTO f95_zone_data (f95_id, atlas_id, site_url, banner_url, tags) VALUES (501, 11, 'https://f95zone.to/threads/beta.501/', '', '')");
  await run(db, "INSERT INTO atlas_mappings (record_id, atlas_id) VALUES (1, 10)");
  await run(db, "INSERT INTO atlas_mappings (record_id, atlas_id) VALUES (2, 11)");
  await run(db, "INSERT INTO atlas_mappings (record_id, atlas_id) VALUES (3, 12)");
  // Record 2 already has a thread mapping of its own: it must win.
  await run(db, "INSERT INTO f95_zone_mappings (record_id, f95_id, site_url) VALUES (2, 777, 'https://f95zone.to/threads/other.777/')");

  await runMigrations(db);

  const mappings = await all(db, "SELECT record_id, f95_id, site_url FROM f95_zone_mappings ORDER BY record_id");
  assert.deepEqual(mappings, [
    { record_id: 1, f95_id: 500, site_url: "https://f95zone.to/threads/alpha.500/" },
    { record_id: 2, f95_id: 777, site_url: "https://f95zone.to/threads/other.777/" },
  ]);
  const seeded = await all(db, "SELECT f95_id, title, engine, status, tags, cover_url, updated_ts FROM f95_catalog ORDER BY f95_id");
  assert.deepEqual(seeded, [
    { f95_id: 500, title: "Alpha", engine: "Ren'Py", status: "Completed", tags: "milf, rpg", cover_url: "https://img/a.jpg", updated_ts: 0 },
    { f95_id: 501, title: "Beta", engine: "Unity", status: "", tags: "", cover_url: "", updated_ts: 0 },
  ]);
  const tables = (await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((row) => row.name);
  for (const dropped of ["atlas_data", "atlas_mappings", "atlas_previews", "atlas_tags", "f95_zone_data", "f95_zone_screens", "f95_zone_tags", "updates"]) {
    assert.equal(tables.includes(dropped), false, `${dropped} must be dropped`);
  }
  assert.ok(tables.includes("f95_catalog"));
  assert.ok(tables.includes("f95_catalog_sync"));
  db.close();
});

test("upsertCatalogEntries writes a real page, reports added/changed and ignores unchanged rows", async () => {
  const db = await openMigrated();
  const entries = loadPageEntries("list-games-date-page-1.json");

  const first = await store.upsertCatalogEntries(db, entries, { now: () => new Date("2026-10-01T10:00:00Z") });
  assert.deepEqual(first, { written: 90, added: 90, changed: 90, versionChanged: 0 });
  assert.equal(await store.countCatalogEntries(db), 90);

  const again = await store.upsertCatalogEntries(db, entries, { now: () => new Date("2026-10-01T11:00:00Z") });
  assert.deepEqual(again, { written: 90, added: 0, changed: 0, versionChanged: 0 });
  const stored = await store.getCatalogEntry(db, 311614);
  assert.equal(stored.firstSeenAt, "2026-10-01T10:00:00.000Z");
  assert.equal(stored.lastSeenAt, "2026-10-01T10:00:00.000Z", "an unchanged row keeps its stamps");

  const bumped = { ...entries[0], version: "S1 Ep.7", updatedTs: entries[0].updatedTs + 60 };
  const third = await store.upsertCatalogEntries(db, [bumped, entries[1]], { now: () => new Date("2026-10-02T00:00:00Z") });
  assert.deepEqual(third, { written: 2, added: 0, changed: 1, versionChanged: 1 });
  const updated = await store.getCatalogEntry(db, 311614);
  assert.equal(updated.version, "S1 Ep.7");
  assert.equal(updated.firstSeenAt, "2026-10-01T10:00:00.000Z");
  assert.equal(updated.lastSeenAt, "2026-10-02T00:00:00.000Z");
  assert.deepEqual(updated.screens, entries[0].screens);
  assert.deepEqual(updated.tags, entries[0].tags);
  assert.equal(updated.siteUrl, "https://f95zone.to/threads/311614/");

  const junk = /** @type {any[]} */ ([{ f95Id: 0, title: "x" }, null]);
  assert.deepEqual(await store.upsertCatalogEntries(db, junk), { written: 0, added: 0, changed: 0, versionChanged: 0 });
  db.close();
});

test("lookups: by id, by record, search and matcher rows", async () => {
  const db = await openMigrated();
  await store.upsertCatalogEntries(db, loadPageEntries("list-games-date-page-1.json"));
  await run(db, "INSERT INTO games (title, creator, engine, last_played_r, total_playtime) VALUES ('Ms Morisson', 'Lounatick', 'renpy', 0, 0)");
  await run(db, "INSERT INTO f95_zone_mappings (record_id, f95_id, site_url) VALUES (1, 311614, '')");

  assert.equal(await store.getCatalogEntry(db, "nope"), null);
  assert.equal(await store.getCatalogEntry(db, 1), null);
  assert.equal((await store.getCatalogEntryForRecord(db, 1)).title, "Ms Morisson");
  assert.equal(await store.getCatalogEntryForRecord(db, 2), null);
  assert.equal(await store.getF95IdForRecord(db, 1), 311614);
  assert.equal(await store.getF95IdForRecord(db, 2), 0);
  const many = await store.getCatalogEntries(db, [311614, 311614, "x", 1]);
  assert.equal(many.size, 1);

  const byTitle = await store.searchCatalogEntries(db, { title: "morisson" });
  assert.equal(byTitle[0].f95Id, 311614);
  const byBoth = await store.searchCatalogEntries(db, { title: "Ms Morisson", creator: "Lounatick" });
  assert.equal(byBoth.length, 1);
  const wrongCreator = await store.searchCatalogEntries(db, { title: "Ms Morisson", creator: "Nobody" });
  assert.equal(wrongCreator[0]?.f95Id, 311614, "falls back to the title when the creator does not match");
  const compact = await store.searchCatalogEntries(db, { title: "MsMorisson" });
  assert.equal(compact[0]?.f95Id, 311614, "compact folder-style names match the title");
  assert.deepEqual(await store.searchCatalogEntries(db, {}), []);
  assert.deepEqual(await store.searchCatalogEntries(db, { title: "%" }), []);

  const matcherRows = await store.listCatalogEntriesForMatcher(db);
  assert.equal(matcherRows.length, 90);
  assert.deepEqual(Object.keys(matcherRows[0]).sort(), ["creator", "engine", "f95_id", "site_url", "title", "version"]);

  const options = await store.getCatalogFilterOptions(db);
  assert.deepEqual(options.categories, ["games"]);
  assert.ok(options.engines.includes("Ren'Py"));
  assert.ok(options.statuses.includes("Ongoing"));
  assert.ok(options.tags.includes("milf"));

  assert.equal(await store.setCatalogOverview(db, 311614, "Story"), true);
  assert.equal((await store.getCatalogEntry(db, 311614)).overview, "Story");
  assert.equal(await store.setCatalogOverview(db, 99, "x"), false);
  const listed = await store.listCatalogEntries(db);
  assert.equal(listed.length, 90);
  assert.equal(listed[0].f95Id, 311614, "newest first");
  db.close();
});

test("sync state round-trips with defaults", async () => {
  const db = await openMigrated();
  const initial = await store.getCatalogSyncState(db);
  assert.equal(initial.fullDone, false);
  assert.equal(initial.fullNextPage, 1);
  assert.equal(initial.newestTs, 0);
  assert.equal(initial.definitions, null);
  assert.equal(initial.entryCount, 0);

  await store.saveCatalogSyncState(db, {
    fullDone: true,
    fullNextPage: 12,
    totalPages: 306,
    newestTs: 1790844480,
    lastError: "",
    definitions: { prefixes: { 7: { id: 7, name: "Ren'Py", group: "Engine" } }, tags: { 1: "a" } },
    lastSuccessAt: undefined,
  });
  const saved = await store.getCatalogSyncState(db);
  assert.equal(saved.fullDone, true);
  assert.equal(saved.fullNextPage, 12);
  assert.equal(saved.totalPages, 306);
  assert.equal(saved.newestTs, 1790844480);
  assert.deepEqual(saved.definitions.prefixes["7"], { id: 7, name: "Ren'Py", group: "Engine" });

  await store.saveCatalogSyncState(db, { fullDone: false, definitions: null });
  const cleared = await store.getCatalogSyncState(db);
  assert.equal(cleared.fullDone, false);
  assert.equal(cleared.definitions, null);
  assert.equal(cleared.fullNextPage, 12, "untouched keys stay");
  db.close();
});
