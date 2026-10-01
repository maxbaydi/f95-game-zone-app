const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  DEFAULT_STATUS,
  buildListUrl,
  buildThreadUrl,
  decodeHtmlEntities,
  normalizeCatalogEntry,
  parseDefinitions,
  parseListResponse,
} = require("../src/main/catalog/f95CatalogParser");

const FIXTURES = path.join(__dirname, "fixtures", "f95", "catalog");
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

test("parseDefinitions reads prefix groups and tag names from the Latest Updates page", () => {
  const result = parseDefinitions(readFixture("latest_alpha.html"));
  assert.equal(result.ok, true, result.error);
  const { prefixes, tags } = result.definitions;
  assert.deepEqual(prefixes["7"], { id: 7, name: "Ren'Py", group: "Engine" });
  assert.deepEqual(prefixes["18"], { id: 18, name: "Completed", group: "Status" });
  assert.deepEqual(prefixes["13"], { id: 13, name: "VN", group: "Other" });
  assert.equal(prefixes["116"].name, "Godot");
  assert.equal(tags["107"], "3dcg");
  assert.ok(Object.keys(tags).length > 100);
  // Prefixes of other categories (comics, animations) are not games prefixes.
  assert.equal(prefixes["43"], undefined);
});

test("parseDefinitions reports pages without the block", () => {
  assert.equal(parseDefinitions("<html><body>login</body></html>").ok, false);
  assert.equal(parseDefinitions("var latestUpdates = {\"prefixes\":{}}").ok, false);
  assert.equal(parseDefinitions("var latestUpdates = {\"prefixes\":{\"games\":[").ok, false);
});

test("parseListResponse turns the real page 1 into catalog entries", () => {
  const definitions = parseDefinitions(readFixture("latest_alpha.html")).definitions;
  const result = parseListResponse(readFixture("list-games-date-page-1.json"), definitions);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.entries.length, 90);
  assert.equal(result.invalid, 0);
  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 306);
  assert.equal(result.count, 27455);

  const first = result.entries[0];
  assert.equal(first.f95Id, 311614);
  assert.equal(first.title, "Ms Morisson");
  assert.equal(first.creator, "Lounatick");
  assert.equal(first.version, "S1 Ep.6");
  assert.equal(first.engine, "Ren'Py");
  assert.equal(first.status, DEFAULT_STATUS);
  assert.deepEqual(first.prefixes, ["VN", "Ren'Py"]);
  assert.deepEqual(first.prefixIds, [13, 7]);
  assert.ok(first.tags.includes("milf"));
  assert.equal(first.tags.length, first.tagIds.length);
  assert.equal(first.coverUrl, "https://preview.f95zone.to/2026/08/6402159_Cover.jpg");
  assert.equal(first.screens.length, 6);
  assert.equal(first.rating, 3);
  assert.equal(first.likes, 126);
  assert.equal(first.views, 109742);
  assert.equal(first.updatedTs, 1790844480);
  assert.equal(first.siteUrl, "https://f95zone.to/threads/311614/");

  // Rows come newest first; every entry has an engine or "Others".
  const stamps = result.entries.map((entry) => entry.updatedTs);
  assert.ok(stamps.every((value, index) => index === 0 || value <= stamps[index - 1]));
  const completed = result.entries.find((entry) => entry.prefixIds.includes(18));
  assert.ok(completed);
  assert.equal(completed.status, "Completed");
});

test("parseListResponse handles the last page, the other sort orders and a search", () => {
  const definitions = parseDefinitions(readFixture("latest_alpha.html")).definitions;
  const beyond = parseListResponse(readFixture("list-games-date-page-beyond.json"), definitions);
  assert.equal(beyond.ok, true);
  assert.equal(beyond.page, 306, "a page past the end is clamped to the last page");
  assert.equal(beyond.entries.length, 5);
  assert.deepEqual(beyond.entries.map((entry) => entry.f95Id), [20, 16, 9, 1, 3]);

  for (const name of ["list-games-likes-page-1.json", "list-games-title-page-1.json", "list-games-search.json"]) {
    const parsed = parseListResponse(readFixture(name), definitions);
    assert.equal(parsed.ok, true, name);
    assert.ok(parsed.entries.length > 0, name);
    assert.equal(parsed.invalid, 0, name);
  }
});

test("parseListResponse reports site errors, login pages and broken bodies", () => {
  const siteError = parseListResponse(readFixture("meta-cat.json"), null);
  assert.equal(siteError.ok, false);
  assert.equal(siteError.code, "site-error");
  assert.match(siteError.error, /Missing category/);

  const login = parseListResponse('<html><body><form action="/login/login" name="login">Log in</form></body></html>', null);
  assert.equal(login.ok, false);
  assert.equal(login.code, "not-json");
  assert.match(login.error, /session/);

  assert.equal(parseListResponse("not json at all", null).code, "not-json");
  assert.equal(parseListResponse({ status: "ok", msg: "nope" }, null).code, "bad-shape");
  assert.equal(parseListResponse("null", null).code, "bad-shape");
});

test("normalizeCatalogEntry validates rows and falls back to built-in prefix names", () => {
  assert.equal(normalizeCatalogEntry({ thread_id: "x", title: "A" }, null), null);
  assert.equal(normalizeCatalogEntry({ thread_id: 5, title: "   " }, null), null);
  assert.equal(normalizeCatalogEntry(null, null), null);

  const entry = normalizeCatalogEntry(
    {
      thread_id: "42",
      title: " Ren&#039;Py   Story ",
      creator: "Dev &amp; Co",
      version: "v1.0",
      prefixes: [2, 22, 999, 2],
      tags: [107, "bad", 107],
      rating: "4.5",
      likes: "1,234",
      views: 10,
      cover: "not a url",
      screens: ["https://preview.f95zone.to/a.jpg", "javascript:alert(1)", 5],
      ts: "1700000000",
    },
    null,
  );
  assert.ok(entry);
  assert.equal(entry.title, "Ren'Py Story");
  assert.equal(entry.creator, "Dev & Co");
  assert.equal(entry.engine, "RPGM");
  assert.equal(entry.status, "Abandoned");
  assert.deepEqual(entry.prefixIds, [2, 22, 999]);
  assert.deepEqual(entry.prefixes, ["RPGM", "Abandoned"]);
  assert.deepEqual(entry.tagIds, [107]);
  assert.deepEqual(entry.tags, [], "tag names need the page definitions");
  assert.equal(entry.rating, 4.5);
  assert.equal(entry.likes, 1234);
  assert.equal(entry.views, 10);
  assert.equal(entry.coverUrl, "");
  assert.deepEqual(entry.screens, ["https://preview.f95zone.to/a.jpg"]);
  assert.equal(entry.updatedTs, 1700000000);
  assert.equal(entry.siteUrl, buildThreadUrl(42));
});

test("buildListUrl and decodeHtmlEntities", () => {
  assert.equal(
    buildListUrl({ page: 3 }),
    "https://f95zone.to/sam/latest_alpha/latest_data.php?cmd=list&cat=games&page=3&rows=90&sort=date",
  );
  assert.equal(buildListUrl({ page: 0, rows: 30, sort: "likes", search: "a b" }).includes("page=1&rows=30&sort=likes&search=a+b"), true);
  assert.equal(decodeHtmlEntities("Ren&#039;Py &amp; &#x41;&quot;"), "Ren'Py & A\"");
});
