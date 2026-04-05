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
