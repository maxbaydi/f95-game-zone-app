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

test("downloads store keeps browser handoffs active until they are removed", () => {
  const store = createDownloadsStore();

  store.wait({
    id: "handoff-1",
    title: "Browser Game",
    sourceHost: "mega.nz",
  });

  const [waitingEntry] = store.list();
  assert.equal(waitingEntry.status, "waiting");
  assert.match(waitingEntry.text, /browser/i);
  assert.equal(store.activeCount(), 1);

  store.start({ id: "handoff-1", title: "Browser Game" });
  assert.equal(store.list()[0].status, "downloading");

  store.remove("handoff-1");
  assert.equal(store.list().length, 0);
  assert.equal(store.activeCount(), 0);
});
