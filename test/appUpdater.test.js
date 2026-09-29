const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLatestReleaseUrl,
  compareVersions,
  createAppUpdaterController,
  normalizeReleaseNotes,
  normalizeVersion,
} = require("../src/main/appUpdater");

test("version helpers normalize and compare release tags", () => {
  assert.equal(normalizeVersion("v1.2.3"), "1.2.3");
  assert.equal(compareVersions("1.2.3", "1.2.2"), 1);
  assert.equal(compareVersions("1.2.0", "1.2"), 0);
  assert.equal(compareVersions("1.9.0", "1.10.0"), -1);
  assert.equal(
    buildLatestReleaseUrl("towerwatchman", "Atlas"),
    "https://api.github.com/repos/towerwatchman/Atlas/releases/latest",
  );
});

test("normalizeReleaseNotes supports both strings and note arrays", () => {
  assert.equal(normalizeReleaseNotes(" hello "), "hello");
  assert.equal(
    normalizeReleaseNotes([{ note: "first" }, { note: "second" }]),
    "first\n\nsecond",
  );
  assert.equal(normalizeReleaseNotes(null), null);
});

test("app updater controller reports dev-mode release availability through GitHub API fallback", async () => {
  const controller = createAppUpdaterController({
    app: {
      getVersion: () => "1.0.0",
      isPackaged: false,
    },
    httpGet: async () => ({
      tag_name: "v1.2.0",
      html_url: "https://github.com/towerwatchman/Atlas/releases/tag/v1.2.0",
      body: "Release notes",
    }),
    autoUpdaterInstance: {
      on() {
        return this;
      },
    },
  });

  const state = await controller.checkForUpdates();

  assert.equal(state.status, "available");
  assert.equal(state.availableVersion, "1.2.0");
  assert.equal(state.supportsDownload, false);
  assert.equal(
    state.releaseUrl,
    "https://github.com/towerwatchman/Atlas/releases/tag/v1.2.0",
  );
});

test("app updater downloads a found update by itself when auto-download is on", async () => {
  const handlers = {};
  let downloads = 0;
  const autoUpdaterInstance = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on(event, handler) {
      handlers[event] = handler;
      return this;
    },
    async checkForUpdates() {
      handlers["update-available"]({ version: "2.0.0" });
    },
    async downloadUpdate() {
      downloads += 1;
    },
  };
  let autoDownload = true;
  const controller = createAppUpdaterController({
    app: { getVersion: () => "1.0.0", isPackaged: true },
    autoUpdaterInstance,
    getAutoDownload: () => autoDownload,
  });

  await controller.checkForUpdates();
  await Promise.resolve();
  assert.equal(autoUpdaterInstance.autoDownload, false, "the controller drives downloads itself");
  assert.equal(autoUpdaterInstance.autoInstallOnAppQuit, true);
  assert.equal(downloads, 1);
  assert.equal(controller.getState().status, "available");

  autoDownload = false;
  await controller.checkForUpdates();
  await Promise.resolve();
  assert.equal(autoUpdaterInstance.autoInstallOnAppQuit, false);
  assert.equal(downloads, 1, "no automatic download once the setting is off");
});
