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
    ["Windows / Linux", "Mac"],
  );
  assert.equal(result.variants[0].links.length, 2);
  assert.equal(result.variants[1].links.length, 2);
});

test("normalizeThreadDownloadLinks ignores screenshot attachments even when the container text includes download labels", () => {
  const result = normalizeThreadDownloadLinks([
    {
      url: "https://f95zone.to/attachments/screenshot-png.12345/",
      label: "01.png",
      lineText: "DOWNLOAD Win/Linux: GOFILE - PIXELDRAIN 01.png",
      contextText:
        "DOWNLOAD Win/Linux: GOFILE - PIXELDRAIN Mac: GOFILE 01.png 02.png",
      isLightboxImage: true,
      order: 0,
    },
    {
      url: "https://pixeldrain.com/u/windows-build",
      label: "PIXELDRAIN",
      lineText: "Win/Linux: GOFILE - PIXELDRAIN",
      contextText: "DOWNLOAD Win/Linux: GOFILE - PIXELDRAIN",
      order: 1,
    },
  ]);

  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].host, "pixeldrain.com");
});

test("normalizeThreadDownloadLinks drops developer/store garbage and unresolved f95zone links", () => {
  const result = normalizeThreadDownloadLinks([
    {
      url: "https://boosty.to/smfutastudio",
      label: "Boosty",
      lineText: "Developer: SMFUTASTUDIO - BOOSTY",
      contextText: "Developer: SMFUTASTUDIO - BOOSTY",
      order: 0,
    },
    {
      url: "https://smfutastudio.com/store",
      label: "SMFUTASTUDIO",
      lineText: "Store: SMFUTASTUDIO",
      contextText: "Store: SMFUTASTUDIO",
      order: 1,
    },
    {
      url: "https://f95zone.to/threads/las-futas.123456/",
      label: "F95 Thread",
      lineText: "Mac: F95ZONE",
      contextText: "DOWNLOAD Mac: F95ZONE",
      order: 2,
    },
    {
      url: "https://f95zone.to/masked/abc123/",
      label: "DATANODES",
      lineText: "Mac: DATANODES",
      contextText: "DOWNLOAD Mac: DATANODES",
      order: 3,
    },
    {
      url: "https://datanodes.to/download/demo",
      label: "DATANODES",
      lineText: "Win/Linux: DATANODES",
      contextText: "DOWNLOAD Win/Linux: DATANODES",
      order: 4,
    },
  ]);

  assert.equal(result.links.length, 2);
  assert.deepEqual(
    result.links.map((link) => link.host),
    ["datanodes.to", "datanodes.to"],
  );
  assert.deepEqual(
    result.variants.map((variant) => variant.id).sort(),
    ["mac", "windows-linux"],
  );
});

test("normalizeThreadDownloadLinks does not create fake variant headers from provider snippets", () => {
  const result = normalizeThreadDownloadLinks([
    {
      url: "https://mega.nz/file/win-build",
      label: "MEGA",
      lineText: "Win: GDRIVE - MEDIAFIRE - MEGA - PIXELDRAIN - BUZZHEAVIER - DATANODES",
      contextText:
        "DOWNLOAD Win: GDRIVE - MEDIAFIRE - MEGA - PIXELDRAIN - BUZZHEAVIER - DATANODES",
      order: 0,
    },
    {
      url: "https://pixeldrain.com/u/win-build",
      label: "PIXELDRAIN",
      lineText: "- BUZZHEAVIER -",
      contextText:
        "DOWNLOAD Win: GDRIVE - MEDIAFIRE - MEGA - PIXELDRAIN - BUZZHEAVIER - DATANODES",
      order: 1,
    },
    {
      url: "https://datanodes.to/download/win-build",
      label: "DATANODES",
      lineText: ": GDRIVE -",
      contextText:
        "DOWNLOAD Win: GDRIVE - MEDIAFIRE - MEGA - PIXELDRAIN - BUZZHEAVIER - DATANODES",
      order: 2,
    },
  ]);

  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].id, "windows");
  assert.equal(result.variants[0].label, "Windows");
  assert.equal(result.variants[0].links.length, 3);
});

test("normalizeThreadDownloadLinks prefers explicit platform hint over noisy mixed line text", () => {
  const mixedLine =
    "Mac: BUZZHEAVIER - DATANODES - MEGA - PIXELDRAIN - VIKINGFILE Android (v0.08): MEGA - GOFILE - MIXDROP - WORKUPLOAD";

  const result = normalizeThreadDownloadLinks([
    {
      url: "https://f95zone.to/masked/mega.nz/1/2/a",
      label: "MEGA",
      lineText: mixedLine,
      contextText: mixedLine,
      platformHint: "Mac",
      order: 0,
    },
    {
      url: "https://f95zone.to/masked/gofile.io/1/2/b",
      label: "GOFILE",
      lineText: mixedLine,
      contextText: mixedLine,
      platformHint: "Android",
      order: 1,
    },
  ]);

  assert.deepEqual(
    result.variants.map((variant) => variant.id),
    ["mac", "android"],
  );
});

test("normalizeThreadDownloadLinks separates compressed platform sections and dedupes host labels within each section", () => {
  const result = normalizeThreadDownloadLinks([
    {
      url: "https://f95zone.to/masked/gofile.io/1/2/win-a",
      label: "GOFILE",
      lineText: "Win/Linux: GOFILE - PIXELDRAIN",
      contextText: "Win/Linux: GOFILE - PIXELDRAIN",
      platformHint: "Windows / Linux",
      sectionHint: "",
      order: 0,
    },
    {
      url: "https://f95zone.to/masked/pixeldrain.com/1/2/win-b",
      label: "PIXELDRAIN",
      lineText: "Win/Linux: GOFILE - PIXELDRAIN",
      contextText: "Win/Linux: GOFILE - PIXELDRAIN",
      platformHint: "Windows / Linux",
      sectionHint: "",
      order: 1,
    },
    {
      url: "https://f95zone.to/masked/mega.nz/1/2/win-c1",
      label: "MEGA",
      lineText: "Win/Linux: MEGA - PIXELDRAIN - PIXELDRAIN",
      contextText: "Compressed Win/Linux: MEGA - PIXELDRAIN - PIXELDRAIN",
      platformHint: "Windows / Linux",
      sectionHint: "Compressed",
      order: 2,
    },
    {
      url: "https://f95zone.to/masked/pixeldrain.com/1/2/win-c2",
      label: "PIXELDRAIN",
      lineText: "Win/Linux: MEGA - PIXELDRAIN - PIXELDRAIN",
      contextText: "Compressed Win/Linux: MEGA - PIXELDRAIN - PIXELDRAIN",
      platformHint: "Windows / Linux",
      sectionHint: "Compressed",
      order: 3,
    },
    {
      url: "https://f95zone.to/masked/pixeldrain.com/1/2/win-c3",
      label: "PIXELDRAIN",
      lineText: "Win/Linux: MEGA - PIXELDRAIN - PIXELDRAIN",
      contextText: "Compressed Win/Linux: MEGA - PIXELDRAIN - PIXELDRAIN",
      platformHint: "Windows / Linux",
      sectionHint: "Compressed",
      order: 4,
    },
  ]);

  assert.deepEqual(
    result.variants.map((variant) => variant.id),
    ["windows-linux", "compressed-windows-linux"],
  );
  assert.deepEqual(
    result.variants.map((variant) => variant.label),
    ["Windows / Linux", "Compressed Windows / Linux"],
  );
  assert.deepEqual(
    result.variants[1].links.map((link) => link.host),
    ["mega.nz", "pixeldrain.com"],
  );
});

test("normalizeThreadDownloadLinks keeps chapter releases as separate groups", () => {
  const result = normalizeThreadDownloadLinks([
    {
      url: "https://f95zone.to/masked/gofile.io/1/2/ch1",
      label: "GOFILE",
      lineText: "Win/Linux: GOFILE",
      contextText: "Win/Linux: GOFILE",
      platformHint: "Windows / Linux",
      releaseHint: "Chapter 1",
      order: 0,
    },
    {
      url: "https://f95zone.to/masked/gofile.io/1/2/ch2",
      label: "GOFILE",
      lineText: "Win/Linux: GOFILE",
      contextText: "Win/Linux: GOFILE",
      platformHint: "Windows / Linux",
      releaseHint: "Chapter 2",
      order: 1,
    },
  ]);

  assert.deepEqual(
    result.variants.map((variant) => variant.label),
    ["Chapter 1 · Windows / Linux", "Chapter 2 · Windows / Linux"],
  );
});

test("normalizeThreadDownloadLinks ignores non-download section lines even with release hint", () => {
  const result = normalizeThreadDownloadLinks([
    {
      url: "https://mega.nz/file/dev-build",
      label: "MEGA",
      lineText: "Developer: MEGA",
      contextText: "Developer: MEGA",
      releaseHint: "Chapter 1",
      order: 0,
    },
  ]);

  assert.equal(result.links.length, 0);
});
