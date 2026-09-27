const test = require("node:test");
const assert = require("node:assert/strict");

const { linkGameToCatalog, needsCatalogLink } = require("../src/main/catalogLink");

function makeDeps(overrides = {}) {
  const calls = { mapping: [], f95: [], updates: [] };
  const deps = {
    addAtlasMapping: async (recordId, atlasId) => {
      calls.mapping.push([recordId, atlasId]);
    },
    getAtlasData: async () => ({
      title: "Catalog Title",
      creator: "Catalog Dev",
      engine: "Ren'Py",
      version: "0.9",
    }),
    getF95ZoneDataByAtlasId: async () => ({
      f95_id: 555,
      site_url: "https://f95zone.to/threads/catalog-title.555/",
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

test("linkGameToCatalog attaches the catalog entry, its thread and refreshes unknown metadata", async () => {
  const { deps, calls } = makeDeps();
  const result = await linkGameToCatalog({
    recordId: 12,
    atlasId: 100,
    game: { record_id: 12, title: "folder-name-0.5", creator: "Unknown", engine: "Unknown" },
    deps,
  });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.atlasId, 100);
  assert.equal(result.f95Id, "555");
  assert.equal(result.siteUrl, "https://f95zone.to/threads/catalog-title.555/");
  assert.equal(result.metadataUpdated, true);
  assert.deepEqual(calls.mapping, [[12, 100]]);
  assert.deepEqual(calls.f95, [[12, "555", "https://f95zone.to/threads/catalog-title.555/"]]);
  assert.deepEqual(calls.updates, [
    { record_id: 12, title: "Catalog Title", creator: "Catalog Dev", engine: "Ren'Py" },
  ]);
});

test("linkGameToCatalog works when the catalog entry has no F95 thread", async () => {
  const { deps, calls } = makeDeps({ getF95ZoneDataByAtlasId: async () => null });
  const result = await linkGameToCatalog({
    recordId: 5,
    atlasId: 7,
    game: { record_id: 5, title: "Known", creator: "Known Dev", engine: "unity" },
    deps,
  });

  assert.equal(result.success, true);
  assert.equal(result.f95Id, "");
  assert.equal(result.siteUrl, "");
  assert.deepEqual(calls.f95, []);
  assert.equal(result.metadataUpdated, true, "the user picked the catalog entry, so its metadata wins");
  assert.deepEqual(calls.updates[0], { record_id: 5, title: "Catalog Title", creator: "Catalog Dev", engine: "Ren'Py" });
});

test("linkGameToCatalog validates its input and reports mapping failures", async () => {
  const { deps } = makeDeps({
    addAtlasMapping: async () => {
      throw new Error("atlas_id 9 does not exist in atlas_data table");
    },
  });

  const invalid = await linkGameToCatalog({ recordId: 0, atlasId: 9, game: {}, deps });
  assert.equal(invalid.success, false);
  assert.equal(invalid.code, "INVALID_INPUT");

  const failed = await linkGameToCatalog({ recordId: 3, atlasId: 9, game: { record_id: 3 }, deps });
  assert.equal(failed.success, false);
  assert.equal(failed.code, "CATALOG_LINK_FAILED");
});

test("needsCatalogLink is true only for records without any catalog or thread identity", () => {
  assert.equal(needsCatalogLink({ atlas_id: 100 }), false);
  assert.equal(needsCatalogLink({ atlas_id: null, f95_id: "555" }), false);
  assert.equal(needsCatalogLink({ atlas_id: null, f95_id: "", siteUrl: "https://f95zone.to/threads/x.1/" }), false);
  assert.equal(needsCatalogLink({ atlas_id: null, f95_id: "", siteUrl: "" }), true);
  assert.equal(needsCatalogLink(null), false);
});
