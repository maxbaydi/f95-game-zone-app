const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTIVE_STATUSES,
  CANCELLABLE_STATUSES,
  createDownloadsStore,
  isActiveStatus,
} = require("../src/main/f95/downloadsStore");

function seed(store) {
  store.resolving({
    id: "dl-1",
    title: "Game",
    hostLabel: "Buzzheavier",
    requestedUrl: "https://buzzheavier.com/abc",
    hasRetryPayload: true,
  });
  return store;
}

test("action status is active and cancellable but not retryable", () => {
  assert.equal(ACTIVE_STATUSES.has("action"), true);
  assert.equal(CANCELLABLE_STATUSES.has("action"), true);
  assert.equal(isActiveStatus("action"), true);

  const store = seed(createDownloadsStore());
  const entry = store.awaitingAction("dl-1", {
    actionUrl: "https://buzzheavier.com/abc",
    text: "Finish the browser check for Buzzheavier",
  });
  assert.equal(entry.status, "action");
  assert.equal(entry.actionUrl, "https://buzzheavier.com/abc");
  assert.equal(entry.text, "Finish the browser check for Buzzheavier");
  assert.equal(entry.canCancel, true);
  assert.equal(entry.canRetry, false);
  assert.equal(entry.error, "", "no error is shown while the user works in the browser");
  assert.equal(entry.errorCode, "");
  assert.equal(store.activeCount(), 1);
});

test("awaitingAction keeps the descriptor and progress fields of the entry", () => {
  const store = seed(createDownloadsStore());
  store.awaitingAction("dl-1", { actionUrl: "https://buzzheavier.com/abc" });
  const entry = store.get("dl-1");
  assert.equal(entry.title, "Game");
  assert.equal(entry.hostLabel, "Buzzheavier");
  assert.equal(entry.percent, 0);
  assert.equal(entry.speedBytesPerSecond, 0);
});

test("awaitingAction is ignored for cancelled and missing entries", () => {
  const store = seed(createDownloadsStore());
  store.cancel("dl-1");
  const entry = store.awaitingAction("dl-1", { actionUrl: "https://x" });
  assert.equal(entry.status, "cancelled");
  assert.equal(store.awaitingAction("missing", { actionUrl: "https://x" }), null);
});

test("the transfer starting after the browser step clears the action state", () => {
  const store = seed(createDownloadsStore());
  store.awaitingAction("dl-1", { actionUrl: "https://buzzheavier.com/abc" });
  const started = store.start({ id: "dl-1", title: "Game", text: "Connecting" });
  assert.equal(started.status, "downloading");
  assert.equal(started.actionUrl, "");
  assert.equal(started.canCancel, true);
});

test("giving up on the browser step turns into a retryable error with the action URL", () => {
  const store = seed(createDownloadsStore());
  store.awaitingAction("dl-1", { actionUrl: "https://buzzheavier.com/abc" });
  const failed = store.fail("dl-1", {
    error: "Finish the check in the browser, then retry.",
    errorCode: "captcha_required",
    actionUrl: "https://buzzheavier.com/abc",
  });
  assert.equal(failed.status, "error");
  assert.equal(failed.canRetry, true);
  assert.equal(failed.actionUrl, "https://buzzheavier.com/abc");
});

test("cancelling while waiting for the browser step works like any active cancel", () => {
  const store = seed(createDownloadsStore());
  store.awaitingAction("dl-1", { actionUrl: "https://buzzheavier.com/abc" });
  const cancelled = store.cancel("dl-1");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.actionUrl, "");
  assert.equal(store.activeCount(), 0);
});

test("action entries sort with the other waiting entries, before history", () => {
  const store = createDownloadsStore();
  store.complete("done", { title: "Done" });
  store.resolving({ id: "dl-2", title: "Later" });
  store.awaitingAction("dl-2", { actionUrl: "https://x" });
  store.resolving({ id: "dl-3", title: "Resolving" });
  const ids = store.list().map((entry) => entry.id);
  assert.equal(ids.indexOf("dl-2") < ids.indexOf("done"), true);
  assert.equal(ids.indexOf("dl-3") < ids.indexOf("done"), true);
});
