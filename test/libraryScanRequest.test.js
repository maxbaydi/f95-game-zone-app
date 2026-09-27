const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LIBRARY_SCAN_MODES,
  normalizeLibraryScanRequest,
  describeLibraryScanMode,
} = require("../src/main/libraryScanRequest");

test("defaults to an incremental scan", () => {
  assert.deepEqual(normalizeLibraryScanRequest(undefined), {
    mode: LIBRARY_SCAN_MODES.INCREMENTAL,
    resetCache: false,
    forceRescan: false,
    resetLibrary: false,
    confirmed: false,
  });
  assert.equal(normalizeLibraryScanRequest({}).mode, "incremental");
  assert.equal(normalizeLibraryScanRequest("nonsense").mode, "incremental");
});

test("legacy flags map to the new modes", () => {
  const resetCache = normalizeLibraryScanRequest({ resetCache: true });
  assert.equal(resetCache.mode, LIBRARY_SCAN_MODES.RESET_CACHE);
  assert.equal(resetCache.resetCache, true);
  assert.equal(resetCache.forceRescan, true);
  assert.equal(resetCache.resetLibrary, false);

  const refresh = normalizeLibraryScanRequest({ forceRescan: true });
  assert.equal(refresh.mode, LIBRARY_SCAN_MODES.REFRESH);
  assert.equal(refresh.resetCache, false);
  assert.equal(refresh.forceRescan, true);
});

test("explicit mode wins over legacy flags", () => {
  const request = normalizeLibraryScanRequest({ mode: "refresh", resetCache: true });
  assert.equal(request.mode, LIBRARY_SCAN_MODES.REFRESH);
  assert.equal(request.resetCache, false);
  assert.equal(request.forceRescan, true);
});

test("unknown modes fall back to incremental", () => {
  const request = normalizeLibraryScanRequest({ mode: "wipe_everything" });
  assert.equal(request.mode, LIBRARY_SCAN_MODES.INCREMENTAL);
  assert.equal(request.forceRescan, false);
});

test("reset_library requires confirmation and implies a cache reset and force rescan", () => {
  const unconfirmed = normalizeLibraryScanRequest({ mode: "reset_library" });
  assert.equal(unconfirmed.mode, LIBRARY_SCAN_MODES.RESET_LIBRARY);
  assert.equal(unconfirmed.resetLibrary, true);
  assert.equal(unconfirmed.confirmed, false);
  assert.equal(unconfirmed.resetCache, true);
  assert.equal(unconfirmed.forceRescan, true);

  const confirmed = normalizeLibraryScanRequest({ mode: "reset_library", confirm: true });
  assert.equal(confirmed.confirmed, true);

  const stringConfirm = normalizeLibraryScanRequest({ mode: "reset_library", confirm: "yes" });
  assert.equal(stringConfirm.confirmed, false);
});

test("describeLibraryScanMode gives a user-facing label for every mode", () => {
  for (const mode of Object.values(LIBRARY_SCAN_MODES)) {
    const label = describeLibraryScanMode(mode);
    assert.equal(typeof label, "string");
    assert.ok(label.length > 0, `label for ${mode}`);
  }
  assert.equal(describeLibraryScanMode("bogus"), describeLibraryScanMode("incremental"));
});
