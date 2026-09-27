const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LIBRARY_INSTALL_STATES,
  LIBRARY_INSTALL_FILTERS,
  LIBRARY_INSTALL_FILTER_OPTIONS,
  getLibraryInstallState,
  matchesLibraryInstallFilter,
  describeLibraryInstallState,
  countLibraryInstallStates,
} = require("../src/shared/libraryInstallState");

test("getLibraryInstallState trusts an explicit installState from the main process", () => {
  assert.equal(
    getLibraryInstallState({ installState: "missing", versions: [{ game_path: "x" }] }),
    LIBRARY_INSTALL_STATES.MISSING,
  );
  assert.equal(getLibraryInstallState({ installState: "bogus", versions: [] }), "not_installed");
});

test("getLibraryInstallState derives the state from versions when not annotated", () => {
  assert.equal(getLibraryInstallState({ versions: [] }), "not_installed");
  assert.equal(getLibraryInstallState(null), "not_installed");
  assert.equal(
    getLibraryInstallState({ versions: [{ game_path: "C:\\a" }] }),
    "installed",
  );
  assert.equal(
    getLibraryInstallState({ versions: [{ game_path: "C:\\a", isPresent: false }] }),
    "missing",
  );
  assert.equal(
    getLibraryInstallState({
      versions: [
        { game_path: "C:\\a", isPresent: false },
        { game_path: "C:\\b", isPresent: true },
      ],
    }),
    "installed",
  );
});

test("matchesLibraryInstallFilter selects games by install state", () => {
  const installed = { installState: "installed", versions: [] };
  const missing = { installState: "missing", versions: [] };
  const stub = { installState: "not_installed", versions: [] };

  for (const game of [installed, missing, stub]) {
    assert.equal(matchesLibraryInstallFilter(game, LIBRARY_INSTALL_FILTERS.ALL), true);
    assert.equal(matchesLibraryInstallFilter(game, ""), true);
    assert.equal(matchesLibraryInstallFilter(game, "unknown-filter"), true);
  }

  assert.equal(matchesLibraryInstallFilter(installed, LIBRARY_INSTALL_FILTERS.INSTALLED), true);
  assert.equal(matchesLibraryInstallFilter(missing, LIBRARY_INSTALL_FILTERS.INSTALLED), false);
  assert.equal(matchesLibraryInstallFilter(missing, LIBRARY_INSTALL_FILTERS.MISSING), true);
  assert.equal(matchesLibraryInstallFilter(stub, LIBRARY_INSTALL_FILTERS.MISSING), false);
  assert.equal(matchesLibraryInstallFilter(stub, LIBRARY_INSTALL_FILTERS.NOT_INSTALLED), true);
  assert.equal(matchesLibraryInstallFilter(installed, LIBRARY_INSTALL_FILTERS.NOT_INSTALLED), false);
});

test("describeLibraryInstallState gives product wording for every state", () => {
  assert.equal(describeLibraryInstallState({ installState: "installed" }), "Installed");
  assert.equal(describeLibraryInstallState({ installState: "missing" }), "Files missing");
  assert.equal(describeLibraryInstallState({ installState: "not_installed" }), "Not installed");
});

test("filter options list every filter exactly once with labels", () => {
  const values = LIBRARY_INSTALL_FILTER_OPTIONS.map((option) => option.value);
  assert.deepEqual([...values].sort(), Object.values(LIBRARY_INSTALL_FILTERS).sort());
  assert.equal(new Set(values).size, values.length);
  for (const option of LIBRARY_INSTALL_FILTER_OPTIONS) {
    assert.ok(option.label);
  }
});

test("countLibraryInstallStates totals games per state", () => {
  const counts = countLibraryInstallStates([
    { installState: "installed" },
    { installState: "installed" },
    { installState: "missing" },
    { versions: [] },
    null,
  ]);

  assert.deepEqual(counts, { installed: 2, missing: 1, not_installed: 1 });
});
