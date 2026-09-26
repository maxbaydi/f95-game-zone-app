const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const database = require("../src/database");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "f95-insert-json-"));
}

function getAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function allAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function openTestDatabase() {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "userData"));
  ensureAppDirs(appPaths);
  await database.initializeDatabase(appPaths);
  return database.getDb();
}

test("getDb returns the live handle after initializeDatabase", async () => {
  const db = await openTestDatabase();
  assert.ok(db && typeof db.all === "function");
  assert.equal(database.getDb(), db);
});

test("insertJsonData ignores columns the local table does not have (new Atlas fields)", async () => {
  const db = await openTestDatabase();
  const uncaught = [];
  const onUncaught = (error) => uncaught.push(error);
  process.on("uncaughtException", onUncaught);
  try {
    await database.insertJsonData(
      [
        {
          atlas_id: 101,
          id_name: "game-101",
          title: "Game 101",
          creator: "Studio",
          external_ids: '[{"site":"itch","id":"1"}]',
        },
        {
          atlas_id: 102,
          id_name: "game-102",
          title: "Game 102",
          creator: "Studio",
          external_ids: null,
        },
      ],
      "atlas_data",
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.off("uncaughtException", onUncaught);
  }

  assert.deepEqual(uncaught, []);
  const rows = await allAsync(
    db,
    "SELECT atlas_id, title, creator FROM atlas_data WHERE atlas_id IN (101, 102) ORDER BY atlas_id",
  );
  assert.deepEqual(rows, [
    { atlas_id: 101, title: "Game 101", creator: "Studio" },
    { atlas_id: 102, title: "Game 102", creator: "Studio" },
  ]);
});

test("insertJsonData uses the union of keys across rows and fills gaps with NULL", async () => {
  const db = await openTestDatabase();
  await database.insertJsonData(
    [
      { atlas_id: 201, id_name: "a-201", title: "A" },
      { atlas_id: 202, id_name: "a-202", title: "B", creator: "Someone" },
    ],
    "atlas_data",
  );
  const rows = await allAsync(
    db,
    "SELECT atlas_id, title, creator FROM atlas_data WHERE atlas_id IN (201, 202) ORDER BY atlas_id",
  );
  assert.deepEqual(rows, [
    { atlas_id: 201, title: "A", creator: null },
    { atlas_id: 202, title: "B", creator: "Someone" },
  ]);
});

test("insertJsonData replaces existing rows (INSERT OR REPLACE semantics kept)", async () => {
  const db = await openTestDatabase();
  await database.insertJsonData([{ atlas_id: 301, id_name: "r-301", title: "Old" }], "atlas_data");
  await database.insertJsonData([{ atlas_id: 301, id_name: "r-301", title: "New" }], "atlas_data");
  const row = await getAsync(db, "SELECT title FROM atlas_data WHERE atlas_id = 301");
  assert.deepEqual(row, { title: "New" });
});

test("insertJsonData rejects instead of crashing the process for an unknown table", async () => {
  await openTestDatabase();
  const uncaught = [];
  const onUncaught = (error) => uncaught.push(error);
  process.on("uncaughtException", onUncaught);
  try {
    await assert.rejects(
      database.insertJsonData([{ a: 1 }], "no_such_table"),
      /no_such_table/,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.off("uncaughtException", onUncaught);
  }
  assert.deepEqual(uncaught, []);
});

test("insertJsonData rejects when no column of the payload exists in the table", async () => {
  await openTestDatabase();
  await assert.rejects(
    database.insertJsonData([{ external_ids: "x", unknown: 1 }], "atlas_data"),
    /no known columns/i,
  );
});

test("insertJsonData with an empty payload is a no-op", async () => {
  await openTestDatabase();
  await database.insertJsonData([], "atlas_data");
});
