const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAppUpdateNotificationPayload,
  createAppUpdateNotificationController,
  getAppUpdateNotificationKey,
} = require("../src/main/appUpdateNotificationController");
const { FakeNotification } = require("./helpers/fakeNotification");

test("app update notification helpers build stable payloads", () => {
  assert.equal(
    getAppUpdateNotificationKey({
      status: "available",
      availableVersion: "1.2.0",
    }),
    "available:1.2.0",
  );

  assert.deepEqual(
    buildAppUpdateNotificationPayload({
      status: "available",
      availableVersion: "1.2.0",
      supportsDownload: true,
    }),
    {
      title: "F95Launcher — App update available",
      body: "Version 1.2.0 is available. Open F95Launcher to download it.",
    },
  );

  assert.deepEqual(
    buildAppUpdateNotificationPayload({
      status: "downloaded",
      availableVersion: "1.2.0",
    }),
    {
      title: "F95Launcher — App update ready",
      body: "Version 1.2.0 is ready to install. Open F95Launcher to restart and apply it.",
    },
  );
});

test("app update notification controller deduplicates repeated states but not ready-to-install transition", () => {
  FakeNotification.instances.length = 0;
  let activateCount = 0;

  const controller = createAppUpdateNotificationController({
    Notification: FakeNotification,
    iconPath: "C:\\icon.ico",
    onActivate: () => {
      activateCount += 1;
    },
  });

  assert.equal(
    controller.handleStateChange(
      {
        status: "available",
        availableVersion: "1.3.0",
        supportsDownload: true,
      },
      {
        status: "checking",
        availableVersion: null,
      },
    ),
    true,
  );
  assert.equal(FakeNotification.instances.length, 1);
  assert.equal(FakeNotification.instances[0].shown, true);

  assert.equal(
    controller.handleStateChange(
      {
        status: "available",
        availableVersion: "1.3.0",
        supportsDownload: true,
      },
      {
        status: "available",
        availableVersion: "1.3.0",
        supportsDownload: true,
      },
    ),
    false,
  );
  assert.equal(FakeNotification.instances.length, 1);

  assert.equal(
    controller.handleStateChange(
      {
        status: "downloaded",
        availableVersion: "1.3.0",
      },
      {
        status: "available",
        availableVersion: "1.3.0",
        supportsDownload: true,
      },
    ),
    true,
  );
  assert.equal(FakeNotification.instances.length, 2);

  FakeNotification.instances[1].trigger("click");
  assert.equal(activateCount, 1);
});
