const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldAutoImportScanGame,
  splitAutoImportableScanGames,
} = require("../src/main/scanCandidateImportPolicy");

test("shouldAutoImportScanGame only allows matched scan results", () => {
  assert.equal(shouldAutoImportScanGame({ matchStatus: "matched" }), true);
  assert.equal(shouldAutoImportScanGame({ matchStatus: "ambiguous" }), false);
  assert.equal(shouldAutoImportScanGame({ matchStatus: "unmatched" }), false);
});

test("splitAutoImportableScanGames separates review queue from auto-imports", () => {
  const result = splitAutoImportableScanGames([
    { title: "Good", matchStatus: "matched" },
    { title: "Needs review", matchStatus: "ambiguous" },
    { title: "Bad", matchStatus: "unmatched" },
  ]);

  assert.deepEqual(
    result.importableGames.map((game) => game.title),
    ["Good"],
  );
  assert.deepEqual(
    result.reviewGames.map((game) => game.title),
    ["Needs review", "Bad"],
  );
});

test("known library folders are refreshed even when the Atlas match is not confident", () => {
  const result = splitAutoImportableScanGames(
    [
      { title: "Known", matchStatus: "unmatched", folder: "C:\\Games\\Known" },
      { title: "Known ambiguous", matchStatus: "ambiguous", folder: "C:\\Games\\Ambiguous" },
      { title: "Unknown new", matchStatus: "unmatched", folder: "C:\\Games\\New" },
      { title: "Matched new", matchStatus: "matched", folder: "C:\\Games\\Matched" },
    ],
    {
      isKnownPath: (folder) =>
        ["c:\\games\\known", "c:\\games\\ambiguous"].includes(String(folder).toLowerCase()),
    },
  );

  assert.deepEqual(
    result.importableGames.map((game) => game.title),
    ["Known", "Known ambiguous", "Matched new"],
  );
  assert.deepEqual(
    result.importableGames.map((game) => Boolean(game.refreshExisting)),
    [true, true, false],
  );
  assert.deepEqual(
    result.reviewGames.map((game) => game.title),
    ["Unknown new"],
  );
});

test("splitAutoImportableScanGames ignores a broken isKnownPath callback", () => {
  const result = splitAutoImportableScanGames(
    [{ title: "Unmatched", matchStatus: "unmatched", folder: "C:\\x" }],
    {
      isKnownPath: () => {
        throw new Error("boom");
      },
    },
  );

  assert.deepEqual(result.importableGames, []);
  assert.equal(result.reviewGames.length, 1);
});
