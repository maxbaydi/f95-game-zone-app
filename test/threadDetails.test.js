const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { extractThreadDetails, hasThreadDetails, OVERVIEW_MAX_LENGTH } = require("../src/main/f95/threadDetails");

const POST = fs.readFileSync(path.join(__dirname, "fixtures", "f95", "catalog", "thread-311614.post.txt"), "utf8");

test("extractThreadDetails reads the real starter post", () => {
  const details = extractThreadDetails(POST);
  assert.match(details.overview, /^A sheltered young man falls for the woman next door/);
  assert.match(details.overview, /feeling truly alive\.$/, "the overview stops at the next label");
  assert.equal(details.overview.includes("Thread Updated"), false);
  assert.equal(details.overview.includes("​"), false, "zero-width characters are removed");
  assert.equal(details.threadUpdated, "2026-10-01");
  assert.equal(details.releaseDate, "2026-09-30");
  assert.equal(details.developer, "Lounatick", "link words after the dash are dropped");
  assert.equal(details.censored, "No");
  assert.equal(details.version, "Season 1 - Episode 6");
  assert.equal(details.os, "Windows, Linux, Mac, Android");
  assert.match(details.language, /^English, Italian, Spanish/);
  assert.equal(hasThreadDetails(details), true);
});

test("extractThreadDetails handles values on the next line, bold labels and missing sections", () => {
  const details = extractThreadDetails(`
**Overview**
First paragraph.

Second paragraph with a colon: inside.

**Release Date**
2025-01-02
Developer:
Someone (Patreon)
Censored: Yes (mosaic)
OS:
Windows
Language: English
Genre:
Spoiler
Adventure, Romance
Installation:
1. Extract and run.
DOWNLOAD
Win: MEGA
`);
  assert.equal(details.overview, "First paragraph.\n\nSecond paragraph with a colon: inside.");
  assert.equal(details.releaseDate, "2025-01-02");
  assert.equal(details.developer, "Someone");
  assert.equal(details.censored, "Yes (mosaic)");
  assert.equal(details.os, "Windows");
  assert.equal(details.language, "English");
  assert.equal(details.threadUpdated, "");
});

test("extractThreadDetails takes the text before the first label as the overview when the label is missing", () => {
  const details = extractThreadDetails(`A game about things.
It has two lines.

Thread Updated: 2024-05-05
Censored: None
OS: Windows, Mac
`);
  assert.equal(details.overview, "A game about things.\nIt has two lines.");
  assert.equal(details.threadUpdated, "2024-05-05");
  assert.equal(details.censored, "No");
  assert.equal(details.os, "Windows, Mac");
});

test("extractThreadDetails is empty for empty or unrelated text and caps long overviews", () => {
  assert.equal(hasThreadDetails(extractThreadDetails("")), false);
  assert.equal(hasThreadDetails(extractThreadDetails(null)), false);
  const unrelated = extractThreadDetails("Download\nMEGA - GOFILE\n");
  assert.equal(unrelated.overview, "");
  assert.equal(hasThreadDetails(unrelated), false);

  const long = extractThreadDetails(`Overview:\n${"word ".repeat(2000)}\nVersion: 1.0\n`);
  assert.ok(long.overview.length <= OVERVIEW_MAX_LENGTH);
  assert.ok(long.overview.endsWith("…"));
  assert.equal(long.version, "1.0");
});

test("a lone 'Updated' word inside the overview does not end it", () => {
  const details = extractThreadDetails(`Overview:
The story. Updated graphics and more.
Updated weekly.

Version: 0.3
`);
  assert.equal(details.overview, "The story. Updated graphics and more.\nUpdated weekly.");
  assert.equal(details.version, "0.3");
});
