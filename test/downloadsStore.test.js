const test = require("node:test");
const assert = require("node:assert/strict");

const { createDownloadsStore } = require("../src/main/f95/downloadsStore");

test("downloads store keeps active downloads in a stable queue order during progress updates", async () => {
  const store = createDownloadsStore();

  store.queue({
    id: "download-1",
    title: "Game One",
    text: "Queued Game One",
  });

  await new Promise((resolve) => setTimeout(resolve, 5));

  store.queue({
    id: "download-2",
    title: "Game Two",
    text: "Queued Game Two",
  });

  store.start({
    id: "download-1",
    title: "Game One",
    text: "Downloading Game One",
  });
  store.start({
    id: "download-2",
    title: "Game Two",
    text: "Downloading Game Two",
  });

  store.progress("download-2", {
    receivedBytes: 512,
    totalBytes: 1024,
    percent: 50,
  });
  store.progress("download-1", {
    receivedBytes: 256,
    totalBytes: 1024,
    percent: 25,
  });
  store.progress("download-2", {
    receivedBytes: 768,
    totalBytes: 1024,
    percent: 75,
  });

  const orderedIds = store
    .list()
    .filter((entry) => entry.status === "downloading")
    .map((entry) => entry.id);

  assert.deepEqual(orderedIds, ["download-1", "download-2"]);
});

test("downloads store still shows newest history items first after completion", async () => {
  const store = createDownloadsStore();

  store.complete("download-1", {
    title: "Older",
    text: "Installed Older",
  });

  await new Promise((resolve) => setTimeout(resolve, 5));

  store.complete("download-2", {
    title: "Newer",
    text: "Installed Newer",
  });

  const orderedIds = store
    .list()
    .filter((entry) => entry.status === "completed")
    .map((entry) => entry.id);

  assert.deepEqual(orderedIds, ["download-2", "download-1"]);
});

test("downloads store shows resolving entries immediately and counts them as active", () => {
  const store = createDownloadsStore();

  const entry = store.resolving({
    id: "download-1",
    title: "Game One",
    hostLabel: "MEGA",
    hasRetryPayload: true,
  });

  assert.equal(entry.status, "resolving");
  assert.equal(entry.hostLabel, "MEGA");
  assert.equal(entry.canCancel, true);
  assert.equal(entry.canRetry, false);
  assert.equal(entry.errorCode, "");
  assert.equal(entry.actionUrl, "");
  assert.equal(store.activeCount(), 1);
  assert.equal(
    Object.prototype.hasOwnProperty.call(entry, "hasRetryPayload"),
    false,
  );
});

test("downloads store exposes errorCode/actionUrl and canRetry for failed entries with a retry payload", () => {
  const store = createDownloadsStore();
  store.resolving({ id: "a", title: "A", hasRetryPayload: true });
  store.resolving({ id: "b", title: "B" });

  store.fail("a", {
    error: "Captcha needed",
    errorCode: "captcha_required",
    actionUrl: "https://f95zone.to/masked/x",
  });
  store.fail("b", { error: "boom", errorCode: "download_failed" });

  const failedA = store.get("a");
  assert.equal(failedA.status, "error");
  assert.equal(failedA.errorCode, "captcha_required");
  assert.equal(failedA.actionUrl, "https://f95zone.to/masked/x");
  assert.equal(failedA.canRetry, true);
  assert.equal(failedA.canCancel, false);
  assert.equal(store.get("b").canRetry, false);
  assert.equal(store.activeCount(), 0);
});

test("downloads store cancel is final for in-flight updates until the entry is retried", () => {
  const store = createDownloadsStore();
  store.resolving({ id: "a", title: "A", hasRetryPayload: true });
  store.start({ id: "a", title: "A" });

  const cancelled = store.cancel("a");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.text, "Cancelled A");
  assert.equal(cancelled.canRetry, true);
  assert.equal(cancelled.canCancel, false);

  store.progress("a", { receivedBytes: 10 });
  store.fail("a", { error: "aborted" });
  store.installing("a", {});
  assert.equal(store.get("a").status, "cancelled");

  const retried = store.resolving({ id: "a", title: "A" });
  assert.equal(retried.status, "resolving");
  assert.equal(retried.canRetry, false);
  assert.equal(retried.canCancel, true);
  assert.equal(store.activeCount(), 1);
});

test("downloads store retry clears the previous error details", () => {
  const store = createDownloadsStore();
  store.resolving({ id: "a", title: "A", hasRetryPayload: true });
  store.fail("a", {
    error: "quota",
    errorCode: "quota_exceeded",
    actionUrl: "https://example.com",
  });

  const retried = store.resolving({ id: "a", title: "A" });
  assert.equal(retried.error, "");
  assert.equal(retried.errorCode, "");
  assert.equal(retried.actionUrl, "");
});

test("downloads store clearHistory keeps active entries and drops finished ones", () => {
  const store = createDownloadsStore();
  store.resolving({ id: "active", title: "Active" });
  store.queue({ id: "queued", title: "Queued" });
  store.resolving({ id: "done", title: "Done" });
  store.complete("done", {});
  store.resolving({ id: "failed", title: "Failed" });
  store.fail("failed", { error: "x" });
  store.resolving({ id: "stopped", title: "Stopped" });
  store.cancel("stopped");

  const removed = store.clearHistory().sort();
  assert.deepEqual(removed, ["done", "failed", "stopped"]);
  assert.deepEqual(
    store.list().map((entry) => entry.id).sort(),
    ["active", "queued"],
  );
  assert.equal(store.activeCount(), 2);
});

test("downloads store status() only updates active entries", () => {
  const store = createDownloadsStore();
  store.resolving({ id: "a", title: "A" });
  store.status("a", { text: "Waiting 5s for the countdown" });
  assert.equal(store.get("a").text, "Waiting 5s for the countdown");

  store.fail("a", { error: "x", text: "failed" });
  store.status("a", { text: "late status" });
  assert.equal(store.get("a").text, "failed");
  assert.equal(store.status("missing", { text: "x" }), null);
});

test("downloads store orders active entries before history and remove() drops an entry", () => {
  const store = createDownloadsStore();
  store.resolving({ id: "a", title: "A" });
  store.complete("a", {});
  store.resolving({ id: "b", title: "B" });
  store.start({ id: "c", title: "C" });

  assert.deepEqual(
    store.list().map((entry) => entry.status),
    ["downloading", "resolving", "completed"],
  );
  assert.equal(store.remove("a"), true);
  assert.equal(store.remove("a"), false);
  assert.equal(store.get("a"), null);
});

test("a failed install keeps the package path and exposes retry flags", () => {
  const changes = [];
  const store = createDownloadsStore({ onChange: (entries) => changes.push(entries.length) });
  store.queue({ id: "dl-1", title: "Game", engine: "Unity" });
  store.installing("dl-1", { text: "Installing" });
  const failed = store.fail("dl-1", {
    error: "The archive is password-protected.",
    errorCode: "archive_encrypted",
    packagePath: "C:/downloads/game.rar",
    hint: "Enter the password from the thread.",
  });

  assert.equal(failed.status, "error");
  assert.equal(failed.packagePath, "C:/downloads/game.rar");
  assert.equal(failed.canInstallFromPackage, true);
  assert.equal(failed.needsPassword, true);
  assert.equal(failed.canInstallManually, true);
  assert.equal(failed.hint, "Enter the password from the thread.");
  assert.equal(failed.engine, "Unity");
  assert.ok(changes.length >= 3, "every change notifies the persistence hook");

  const installing = store.installing("dl-1", { text: "Unpacking with the password" });
  assert.equal(installing.packagePath, "C:/downloads/game.rar", "installing keeps the package");
  const done = store.complete("dl-1", { text: "Installed Game" });
  assert.equal(done.packagePath, "");
  assert.equal(done.canInstallFromPackage, false);
  assert.equal(done.needsPassword, false);

  store.fail("dl-1", { error: "boom", packagePath: "C:/downloads/game.rar" });
  assert.equal(store.clearPackage("dl-1").packagePath, "");
  assert.deepEqual(store.packagePaths(), []);
});

test("hydrate turns interrupted entries into failed ones and keeps packages that still exist", () => {
  const store = createDownloadsStore();
  const count = store.hydrate(
    [
      { id: "a", title: "A", status: "installing", packagePath: "/keep/a.zip", createdAt: 1, updatedAt: 1 },
      { id: "b", title: "B", status: "downloading", createdAt: 2, updatedAt: 2 },
      { id: "c", title: "C", status: "completed", recordId: 7, createdAt: 3, updatedAt: 3 },
      { id: "d", title: "D", status: "error", packagePath: "/gone/d.zip", error: "x", createdAt: 4, updatedAt: 4 },
      null,
      { title: "no id" },
    ],
    (packagePath) => packagePath === "/keep/a.zip",
  );
  assert.equal(count, 4);
  const byId = Object.fromEntries(store.list().map((entry) => [entry.id, entry]));
  assert.equal(byId.a.status, "error");
  assert.equal(byId.a.errorCode, "install_interrupted");
  assert.equal(byId.a.canInstallFromPackage, true);
  assert.equal(byId.a.canRetry, false, "no mirror context survives a restart");
  assert.equal(byId.b.status, "error");
  assert.equal(byId.b.errorCode, "download_interrupted");
  assert.equal(byId.b.canInstallManually, true);
  assert.equal(byId.c.status, "completed");
  assert.equal(byId.c.recordId, 7);
  assert.equal(byId.d.packagePath, "", "missing packages are dropped");
  assert.deepEqual(store.packagePaths(), ["/keep/a.zip"]);
  assert.equal(store.activeCount(), 0);
});
