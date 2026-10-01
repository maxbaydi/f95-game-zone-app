const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLibraryPreviewRefreshTargets,
  shouldRefreshCachedPreviews,
} = require("../src/main/libraryPreviewRefresh");

test("buildLibraryPreviewRefreshTargets keeps only installed games with a catalog thread", () => {
  const result = buildLibraryPreviewRefreshTargets([
    {
      record_id: 101,
      f95_id: 202,
      title: "Alpha",
    },
    {
      record_id: 102,
      f95_id: null,
      title: "No catalog",
    },
    {
      record_id: 0,
      f95_id: 303,
      title: "Bad Record",
    },
    {
      record_id: 103,
      f95_id: "404",
      displayTitle: "Display Title",
    },
  ]);

  assert.deepEqual(result, [
    {
      recordId: 101,
      f95Id: 202,
      title: "Alpha",
    },
    {
      recordId: 103,
      f95Id: 404,
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
