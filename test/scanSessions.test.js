const test = require("node:test");
const assert = require("node:assert/strict");

const {
  beginScanSession,
  cancelScanSession,
  endScanSession,
  isScanCancelled,
} = require("../src/main/scanSessions");

test("scan session blocks duplicate scans for the same renderer target", () => {
  const target = { id: 1101 };

  const first = beginScanSession(target, "test_scan");
  const duplicate = beginScanSession(target, "test_scan");

  assert.equal(first.success, true);
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.errorCode, "SCAN_ALREADY_RUNNING");

  endScanSession(target);
});

test("scan session supports cancellation and cleanup", () => {
  const target = { id: 1102 };

  const started = beginScanSession(target, "test_scan");
  assert.equal(started.success, true);
  assert.equal(isScanCancelled(started.session), false);

  const cancelled = cancelScanSession(target);
  assert.equal(cancelled.success, true);
  assert.equal(isScanCancelled(cancelled.session), true);

  endScanSession(target);

  const afterCleanup = cancelScanSession(target);
  assert.equal(afterCleanup.success, false);
  assert.equal(afterCleanup.errorCode, "SCAN_NOT_RUNNING");
});
