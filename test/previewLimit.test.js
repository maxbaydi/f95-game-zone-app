const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_PREVIEW_LIMIT,
  MAX_PREVIEW_LIMIT,
  resolvePreviewDownloadCount,
} = require("../src/main/previewLimit");

test("preview limit defaults to 20", () => {
  assert.equal(DEFAULT_PREVIEW_LIMIT, "20");
  assert.equal(MAX_PREVIEW_LIMIT, 20);
});

test("resolvePreviewDownloadCount caps old unlimited values to 20", () => {
  assert.equal(resolvePreviewDownloadCount("Unlimited", 50), 20);
});

test("resolvePreviewDownloadCount caps explicit numeric requests to 20", () => {
  assert.equal(resolvePreviewDownloadCount("200", 50), 20);
});

test("resolvePreviewDownloadCount respects smaller available counts", () => {
  assert.equal(resolvePreviewDownloadCount("20", 7), 7);
});
