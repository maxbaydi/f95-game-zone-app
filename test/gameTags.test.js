const test = require("node:test");
const assert = require("node:assert/strict");
const {
  splitGameTags,
  matchesGameTags,
  filterLibraryGamesByTags,
} = require("../src/shared/gameTags");

test("game tags preserve the full catalog list and remove empty duplicate chips", () => {
  const tags = Array.from({ length: 24 }, (_, index) => `tag ${index}`);
  assert.deepEqual(splitGameTags(`, ${tags.join(", ")}, TAG 0, ,`), tags);
  assert.deepEqual(splitGameTags([" sandbox ", "Sandbox", null, "humor"]), [
    "sandbox",
    "humor",
  ]);
  assert.deepEqual(splitGameTags(null), []);
});

test("AND and OR tag matching use whole labels without case or whitespace sensitivity", () => {
  assert.equal(
    matchesGameTags(" sandbox, HUMOR, rpg ", ["Sandbox", " humor "], "AND"),
    true,
  );
  assert.equal(
    matchesGameTags("sandbox, humor", ["sandbox", "romance"], "AND"),
    false,
  );
  assert.equal(
    matchesGameTags("sandbox, humor", ["sandbox", "romance"], "OR"),
    true,
  );
  assert.equal(matchesGameTags("sandbox, humor", ["sand"], "OR"), false);
  assert.equal(matchesGameTags(null, [], "AND"), true);
});

test("library tag filtering composes with a previously searched list and preserves game records", () => {
  const games = [
    { record_id: 1, f95_tags: "sandbox, humor" },
    { record_id: 2, f95_tags: "sandbox" },
    { record_id: 3, tags: "humor" },
    { record_id: 4, f95_tags: "", tags: "" },
  ];
  assert.deepEqual(
    filterLibraryGamesByTags(games, ["Sandbox", "humor"], "AND").map(
      (game) => game.record_id,
    ),
    [1],
  );
  assert.deepEqual(
    filterLibraryGamesByTags(games, ["sandbox", "humor"], "OR").map(
      (game) => game.record_id,
    ),
    [1, 2, 3],
  );
  assert.deepEqual(
    filterLibraryGamesByTags(
      games.filter((game) => game.record_id !== 1),
      ["sandbox"],
      "AND",
    ).map((game) => game.record_id),
    [2],
  );
  assert.equal(filterLibraryGamesByTags(games, [], "AND"), games);
  assert.equal(games.length, 4);
});
