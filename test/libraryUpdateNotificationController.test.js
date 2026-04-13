const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLibraryUpdateNotificationKey,
  buildLibraryUpdateNotificationPayload,
  createLibraryUpdateNotificationController,
} = require("../src/main/libraryUpdateNotificationController");

const { FakeNotification } = require("./helpers/fakeNotification");

test("library update notification key sorts stable record ids", () => {
  assert.equal(
    buildLibraryUpdateNotificationKey([
      { record_id: 2, isUpdateAvailable: true },
      { record_id: 10, isUpdateAvailable: true },
    ]),
    "10,2",
  );
  assert.equal(
    buildLibraryUpdateNotificationKey([
      { record_id: 1, isUpdateAvailable: false },
    ]),
    "",
  );
});

test("library update notification payload handles single and multiple games", () => {
  assert.equal(buildLibraryUpdateNotificationPayload([]), null);

  assert.deepEqual(
    buildLibraryUpdateNotificationPayload([
      { displayTitle: "Game A", isUpdateAvailable: true, record_id: 1 },
    ]),
    {
      title: "F95Launcher — Library update available",
      body: "Game A has a new version available in your library.",
    },
  );

  assert.deepEqual(
    buildLibraryUpdateNotificationPayload([
      { title: "A", isUpdateAvailable: true, record_id: 1 },
      { title: "B", isUpdateAvailable: true, record_id: 2 },
    ]),
    {
      title: "F95Launcher — Library updates available",
      body: "2 games in your library have new versions available.",
    },
  );
});

test("library update notification controller deduplicates by key", async () => {
  FakeNotification.instances.length = 0;
  let activateCount = 0;

  const controller = createLibraryUpdateNotificationController({
    Notification: FakeNotification,
    iconPath: "C:\\icon.ico",
    onClick: () => {
      activateCount += 1;
    },
  });

  const gamesBatch = [
    { record_id: 1, isUpdateAvailable: true, title: "One" },
  ];

  const first = await controller.syncFromAllGames({
    getGames: async () => gamesBatch,
    allowNotify: true,
  });
  assert.equal(first.notified, true);
  assert.equal(FakeNotification.instances.length, 1);

  const second = await controller.syncFromAllGames({
    getGames: async () => gamesBatch,
    allowNotify: true,
  });
  assert.equal(second.notified, false);
  assert.equal(FakeNotification.instances.length, 1);

  FakeNotification.instances[0].trigger("click");
  assert.equal(activateCount, 1);
});
