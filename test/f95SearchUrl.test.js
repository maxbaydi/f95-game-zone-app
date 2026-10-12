const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseDefinitions } = require("../src/main/catalog/f95CatalogParser");
const {
  F95_SEARCH_URL,
  buildF95SearchUrl,
} = require("../src/shared/f95SearchUrl");
const definitions = parseDefinitions(
  fs.readFileSync(
    path.join(__dirname, "fixtures/f95/catalog/latest_alpha.html"),
    "utf8",
  ),
).definitions.tags;

test("F95 navigation carries every selected tag with the site's actual IDs and AND/OR syntax", () => {
  for (const logic of ["AND", "OR"]) {
    const result = buildF95SearchUrl(
      { tags: [" Sandbox ", "romance", "SANDBOX"], tagLogic: logic },
      definitions,
    );
    assert.equal(result.success, true);
    assert.equal(
      result.url,
      `${F95_SEARCH_URL}#/cat=games/page=1/tags=2257,330/tagtype=${logic.toLowerCase()}`,
    );
  }
});

test("F95 title query is encoded without changing tag filters or injecting hash options", () => {
  const text = "Coast /tags=44 & #love 日本語";
  const result = buildF95SearchUrl(
    { tags: ["sandbox"], text: ` ${text} ` },
    definitions,
  );
  assert.equal(
    result.url,
    `${F95_SEARCH_URL}#/cat=games/page=1/tags=2257/tagtype=and/search=${encodeURIComponent(text)}`,
  );
  const queryOnly = buildF95SearchUrl({ text: "Starfall" });
  assert.equal(
    queryOnly.url,
    `${F95_SEARCH_URL}#/cat=games/page=1/search=Starfall`,
  );
  assert.equal(buildF95SearchUrl().url, F95_SEARCH_URL);
});

test("unknown or unresolvable tags prevent a silently broadened website search", () => {
  const result = buildF95SearchUrl(
    { tags: ["sandbox", "Local tag"] },
    definitions,
  );
  assert.equal(result.success, false);
  assert.equal(result.url, "");
  assert.deepEqual(result.missingTags, ["local tag"]);
  assert.equal(buildF95SearchUrl({ tags: ["sandbox"] }, {}).success, false);
  assert.equal(
    buildF95SearchUrl(
      { tags: ["sandbox"] },
      { "2257/creator=other": "sandbox" },
    ).success,
    false,
  );
});
