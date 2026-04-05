const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCompactScanKey,
  compareVersionLabels,
  extractSignificantTokens,
  normalizeEngineName,
} = require("../src/shared/scanMatchUtils");

test("extractSignificantTokens drops platform and packaging noise", () => {
  assert.deepEqual(
    extractSignificantTokens("Summer_Time_Saga_v20.0.0-pc-x64"),
    ["summer", "time", "saga", "v20"],
  );
});

test("buildCompactScanKey normalizes punctuation and casing", () => {
  assert.equal(
    buildCompactScanKey("[Ren'Py] My Lovely Game"),
    "renpymylovelygame",
  );
});

test("compareVersionLabels differentiates exact, prefix and conflicts", () => {
  assert.deepEqual(compareVersionLabels("v0.24.1", "0.24.1"), {
    score: 18,
    matchType: "exact",
  });
  assert.deepEqual(compareVersionLabels("v0.24.1", "0.24"), {
    score: 12,
    matchType: "prefix",
  });
  assert.deepEqual(compareVersionLabels("v0.24.1", "1.0"), {
    score: -6,
    matchType: "conflict",
  });
});

test("normalizeEngineName maps common aliases to canonical values", () => {
  assert.equal(normalizeEngineName("Ren'Py"), "renpy");
  assert.equal(normalizeEngineName("RPG Maker MV"), "rpgm");
  assert.equal(normalizeEngineName("Unreal Engine"), "unreal");
  assert.equal(normalizeEngineName("Unknown"), "");
});
