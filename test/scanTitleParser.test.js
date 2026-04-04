const test = require("node:test");
const assert = require("node:assert/strict");

const { parseScanTitle } = require("../src/shared/scanTitleParser");

test("parseScanTitle strips common F95 tags and extracts semantic version", () => {
  const parsed = parseScanTitle(
    "[Ren'Py] My Lovely Game [v0.5.1] [Completed] [Win]",
  );

  assert.equal(parsed.title, "My Lovely Game");
  assert.equal(parsed.version, "0.5.1");
});

test("parseScanTitle handles scene-like folder names with underscores and domain noise", () => {
  const parsed = parseScanTitle("f95zone.to_-_Summer_Time_Saga_v20.0.0-pc");

  assert.equal(parsed.title, "Summer Time Saga");
  assert.equal(parsed.version, "20.0.0");
});

test("parseScanTitle recognizes final builds and keeps a usable title", () => {
  const parsed = parseScanTitle("My-Game-Final-[Android]");

  assert.equal(parsed.title, "My Game");
  assert.equal(parsed.version, "Final");
});

test("parseScanTitle returns unknown version when no version marker exists", () => {
  const parsed = parseScanTitle("Plain Folder Name");

  assert.equal(parsed.title, "Plain Folder Name");
  assert.equal(parsed.version, "Unknown");
});
