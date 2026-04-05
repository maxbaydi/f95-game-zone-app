const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getCloudSyncErrorDetails,
  getCloudSyncMessageIfPresent,
} = require("../src/shared/cloudSyncErrors");

test("cloud sync errors convert storage size-limit failures into user-facing upload text", () => {
  const details = getCloudSyncErrorDetails(
    "The object exceeded the maximum allowed size",
    {
      action: "upload",
      archiveBytes: 63 * 1024 * 1024,
    },
  );

  assert.equal(details.code, "cloud_archive_too_large");
  assert.match(details.userMessage, /too large for the current cloud upload limit/i);
  assert.match(details.userMessage, /63 MB/i);
});

test("cloud sync errors convert missing restore objects into user-facing restore text", () => {
  const details = getCloudSyncErrorDetails("Object not found", {
    action: "restore",
  });

  assert.equal(details.code, "cloud_backup_missing");
  assert.equal(details.userMessage, "No cloud backup was found for this game yet.");
});

test("cloud sync errors hide raw auth failures behind a user-facing sign-in message", () => {
  const details = getCloudSyncErrorDetails("Invalid login credentials", {
    action: "upload",
  });

  assert.equal(details.code, "cloud_auth_failed");
  assert.match(details.userMessage, /sign-in failed/i);
  assert.doesNotMatch(details.userMessage, /invalid login credentials/i);
});

test("cloud sync errors fall back to a generic upload-safe message for unknown failures", () => {
  const details = getCloudSyncErrorDetails("Some backend exploded with code 9182", {
    action: "upload",
  });

  assert.equal(details.code, "cloud_sync_failed");
  assert.match(details.userMessage, /could not back up your saves/i);
  assert.match(details.userMessage, /local saves are still safe on this pc/i);
  assert.doesNotMatch(details.userMessage, /9182/i);
});

test("cloud sync message helper stays silent when there is no error", () => {
  assert.equal(getCloudSyncMessageIfPresent(""), "");
  assert.equal(getCloudSyncMessageIfPresent(null), "");
  assert.equal(getCloudSyncMessageIfPresent(undefined), "");
});

test("cloud sync message helper returns user-facing text when an error exists", () => {
  const message = getCloudSyncMessageIfPresent("Object not found", {
    action: "restore",
  });

  assert.equal(message, "No cloud backup was found for this game yet.");
});
