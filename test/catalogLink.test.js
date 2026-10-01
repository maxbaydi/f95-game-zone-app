const test = require("node:test");
const assert = require("node:assert/strict");

const { linkGameToCatalog, needsCatalogLink } = require("../src/main/catalogLink");

function makeDeps(overrides = {}) {
  const calls = { f95: [], updates: [] };
  const deps = {
    getCatalogEntry: async (f95Id) => ({
      f95Id,
      title: "Catalog Title",
      creator: "Catalog Dev",
      engine: "Ren'Py",
      version: "0.9",
      siteUrl: "https://f95zone.to/threads/555/",
    }),
    upsertF95ZoneMapping: async (recordId, f95Id, siteUrl) => {
      calls.f95.push([recordId, f95Id, siteUrl]);
    },
    updateGame: async (payload) => {
      calls.updates.push(payload);
    },
    ...overrides,
  };
  return { deps, calls };
}

test("linkGameToCatalog attaches the thread of the entry and refreshes unknown metadata", async () => {
  const { deps, calls } = makeDeps();
  const result = await linkGameToCatalog({
    recordId: 12,
    f95Id: 555,
    game: { record_id: 12, title: "folder-name-0.5", creator: "Unknown", engine: "Unknown" },
    deps,
  });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.f95Id, "555");
  assert.equal(result.siteUrl, "https://f95zone.to/threads/555/");
  assert.equal(result.metadataUpdated, true);
  assert.deepEqual(calls.f95, [[12, "555", "https://f95zone.to/threads/555/"]]);
  assert.deepEqual(calls.updates, [
    { record_id: 12, title: "Catalog Title", creator: "Catalog Dev", engine: "Ren'Py" },
  ]);
});

test("linkGameToCatalog builds the thread url when the entry has none and skips unchanged metadata", async () => {
  const { deps, calls } = makeDeps({
    getCatalogEntry: async () => ({ f95Id: 7, title: "Known", creator: "Known Dev", engine: "unity", version: "", siteUrl: "" }),
  });
  const result = await linkGameToCatalog({
    recordId: 5,
    f95Id: 7,
    game: { record_id: 5, title: "Known", creator: "Known Dev", engine: "unity" },
    deps,
  });

  assert.equal(result.success, true);
  assert.equal(result.siteUrl, "https://f95zone.to/threads/7/");
  assert.deepEqual(calls.f95, [[5, "7", "https://f95zone.to/threads/7/"]]);
  assert.equal(result.metadataUpdated, false, "nothing changed, so nothing is written");
  assert.deepEqual(calls.updates, []);
});

test("linkGameToCatalog validates its input and reports missing entries and mapping failures", async () => {
  const missing = makeDeps({ getCatalogEntry: async () => null });
  const invalid = await linkGameToCatalog({ recordId: 0, f95Id: 9, game: {}, deps: missing.deps });
  assert.equal(invalid.success, false);
  assert.equal(invalid.code, "INVALID_INPUT");

  const notFound = await linkGameToCatalog({ recordId: 3, f95Id: 9, game: { record_id: 3 }, deps: missing.deps, logger: { warn() {} } });
  assert.equal(notFound.success, false);
  assert.equal(notFound.code, "CATALOG_LINK_FAILED");
  assert.deepEqual(missing.calls.f95, []);

  const broken = makeDeps({
    upsertF95ZoneMapping: async () => {
      throw new Error("locked");
    },
  });
  const failed = await linkGameToCatalog({ recordId: 3, f95Id: 9, game: { record_id: 3 }, deps: broken.deps, logger: { warn() {} } });
  assert.equal(failed.success, false);
  assert.equal(failed.code, "CATALOG_LINK_FAILED");
  assert.deepEqual(broken.calls.updates, []);
});

test("needsCatalogLink is true only for records without a thread identity", () => {
  assert.equal(needsCatalogLink({ f95_id: "555" }), false);
  assert.equal(needsCatalogLink({ f95_id: "", siteUrl: "https://f95zone.to/threads/x.1/" }), false);
  assert.equal(needsCatalogLink({ f95_id: "", siteUrl: "" }), true);
  assert.equal(needsCatalogLink({ f95_id: null, siteUrl: null }), true);
  assert.equal(needsCatalogLink(null), false);
});
