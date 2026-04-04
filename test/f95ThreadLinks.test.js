const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeThreadDownloadLinks,
} = require("../src/main/f95/threadLinks");

test("normalizeThreadDownloadLinks filters social and store links out of download candidates", () => {
  const result = normalizeThreadDownloadLinks([
    {
      url: "https://twitter.com/example",
      label: "Twitter",
      lineText: "Follow us on Twitter",
      contextText: "Follow us on Twitter",
      order: 0,
    },
    {
      url: "https://store.steampowered.com/app/123",
      label: "Steam",
      lineText: "Steam page",
      contextText: "Steam page",
      order: 1,
    },
    {
      url: "https://pixeldrain.com/u/demo123",
      label: "PIXELDRAIN",
      lineText: "Win/Linux: PIXELDRAIN",
      contextText: "DOWNLOAD Win/Linux: PIXELDRAIN",
      order: 2,
    },
  ]);

  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].host, "pixeldrain.com");
});

test("normalizeThreadDownloadLinks groups mirrors by platform variants", () => {
  const result = normalizeThreadDownloadLinks([
    {
      url: "https://mega.nz/file/windows-build",
      label: "MEGA",
      lineText: "Win/Linux: BUZZHEAVIER - MEGA - PIXELDRAIN",
      contextText: "DOWNLOAD Win/Linux: BUZZHEAVIER - MEGA - PIXELDRAIN",
      order: 0,
    },
    {
      url: "https://pixeldrain.com/u/windows-build",
      label: "PIXELDRAIN",
      lineText: "Win/Linux: BUZZHEAVIER - MEGA - PIXELDRAIN",
      contextText: "DOWNLOAD Win/Linux: BUZZHEAVIER - MEGA - PIXELDRAIN",
      order: 1,
    },
    {
      url: "https://gofile.io/d/mac-build",
      label: "GOFILE",
      lineText: "Mac (v0.1): GOFILE - PIXELDRAIN",
      contextText: "DOWNLOAD Mac (v0.1): GOFILE - PIXELDRAIN",
      order: 2,
    },
    {
      url: "https://pixeldrain.com/u/mac-build",
      label: "PIXELDRAIN",
      lineText: "Mac (v0.1): GOFILE - PIXELDRAIN",
      contextText: "DOWNLOAD Mac (v0.1): GOFILE - PIXELDRAIN",
      order: 3,
    },
    {
      url: "https://f95zone.to/attachments/screenshot-png.12345/",
      label: "image.png",
      lineText: "Screenshots",
      contextText: "Screenshots",
      order: 4,
    },
  ]);

  assert.equal(result.links.length, 4);
  assert.deepEqual(
    result.variants.map((variant) => variant.label),
    ["Win/Linux", "Mac (v0.1)"],
  );
  assert.equal(result.variants[0].links.length, 2);
  assert.equal(result.variants[1].links.length, 2);
});
