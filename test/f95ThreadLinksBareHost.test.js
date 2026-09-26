/**
 * Thread posts often mention a host by name with a link to its home page
 * ("uploaded to catbox.moe"). Such a link is not a mirror: it has no file
 * behind it and the resolver can only fail on it.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyThreadDownloadLink,
  normalizeThreadDownloadLinks,
} = require("../src/main/f95/threadLinks");

function rawLink(url, extra = {}) {
  return {
    url,
    label: extra.label || new URL(url).hostname,
    lineText: extra.lineText || "Win: MEGA - CATBOX - MIXDROP",
    contextText: extra.lineText || "Win: MEGA - CATBOX - MIXDROP",
    order: extra.order || 0,
  };
}

test("a bare host home page is not a mirror link", () => {
  for (const url of [
    "https://catbox.moe/",
    "https://catbox.moe",
    "https://www.sendspace.com/",
    "https://dailyuploads.net/",
    "https://fileditch.com/#",
    "https://terabox.com/?",
  ]) {
    assert.equal(classifyThreadDownloadLink(rawLink(url)), null, url);
  }
});

test("real file links on the same hosts are still classified", () => {
  const link = classifyThreadDownloadLink(
    rawLink("https://files.catbox.moe/abc123.zip", { label: "CATBOX" }),
  );
  assert.ok(link);
  assert.equal(link.host, "files.catbox.moe");

  const xfs = classifyThreadDownloadLink(
    rawLink("https://dailyuploads.net/pq3vaxi0jpdt", { label: "DAILYUPLOADS" }),
  );
  assert.ok(xfs);
  assert.equal(xfs.hostLabel, "DailyUploads");

  const masked = classifyThreadDownloadLink(
    rawLink("https://f95zone.to/masked/mega.nz/1/2/abc", { label: "MEGA" }),
  );
  assert.ok(masked);
});

test("hash-only file links (MEGA) keep working", () => {
  const link = classifyThreadDownloadLink(
    rawLink("https://mega.nz/file/W0UAgJaK#XOYyTETrIy8daz3", { label: "MEGA" }),
  );
  assert.ok(link);
});

test("normalizeThreadDownloadLinks drops bare hosts but keeps the variant", () => {
  const { variants, links } = normalizeThreadDownloadLinks([
    rawLink("https://catbox.moe/", { label: "CATBOX", order: 1 }),
    rawLink("https://files.catbox.moe/real.zip", { label: "CATBOX", order: 2 }),
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://files.catbox.moe/real.zip");
  assert.equal(variants.length, 1);
});
