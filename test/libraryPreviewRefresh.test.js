const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLibraryPreviewRefreshTargets,
  shouldRefreshCachedPreviews,
} = require("../src/main/libraryPreviewRefresh");

test("buildLibraryPreviewRefreshTargets keeps only installed games with valid atlas mappings", () => {
  const result = buildLibraryPreviewRefreshTargets([
    {
      record_id: 101,
      atlas_id: 202,
      title: "Alpha",
    },
    {
      record_id: 102,
      atlas_id: null,
      title: "No Atlas",
    },
    {
      record_id: 0,
      atlas_id: 303,
      title: "Bad Record",
    },
    {
      record_id: 103,
      atlas_id: "404",
      displayTitle: "Display Title",
    },
  ]);

  assert.deepEqual(result, [
    {
      recordId: 101,
      atlasId: 202,
      title: "Alpha",
    },
    {
      recordId: 103,
      atlasId: 404,
      title: "Display Title",
    },
  ]);
});

test("shouldRefreshCachedPreviews only refreshes when remote media exceeds cached media", () => {
  assert.equal(
    shouldRefreshCachedPreviews({
      cachedPreviewCount: 5,
      remotePreviewCount: 18,
    }),
    true,
  );

  assert.equal(
    shouldRefreshCachedPreviews({
      cachedPreviewCount: 18,
      remotePreviewCount: 18,
    }),
    false,
  );

  assert.equal(
    shouldRefreshCachedPreviews({
      cachedPreviewCount: 0,
      remotePreviewCount: 0,
    }),
    false,
  );
});
