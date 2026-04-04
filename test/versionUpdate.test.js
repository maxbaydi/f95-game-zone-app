const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVersionUpdateState,
  getNewestInstalledVersion,
} = require("../src/shared/versionUpdate");

test("version update state reports an update when latest metadata is newer", () => {
  const result = buildVersionUpdateState("0.5.0", [{ version: "0.3.1" }]);

  assert.equal(result.hasUpdate, true);
  assert.equal(result.newestInstalledVersion, "0.3.1");
  assert.equal(result.latestVersion, "0.5.0");
});

test("version update state compares against the newest installed version only", () => {
  const result = buildVersionUpdateState("0.5", [
    { version: "0.3" },
    { version: "0.6" },
  ]);

  assert.equal(result.hasUpdate, false);
  assert.equal(result.newestInstalledVersion, "0.6");
});

test("version update state treats latest final builds as an update", () => {
  const result = buildVersionUpdateState("Final", [{ version: "0.9" }]);

  assert.equal(result.hasUpdate, true);
  assert.equal(result.newestInstalledVersion, "0.9");
});

test("version update state suppresses updates when a final build is already installed", () => {
  const result = buildVersionUpdateState("0.9", [
    { version: "0.8" },
    { version: "Final" },
  ]);

  assert.equal(result.hasUpdate, false);
  assert.equal(result.hasFinalInstalled, true);
  assert.equal(result.newestInstalledVersion, "Final");
});

test("newest installed version falls back to the highest numeric version", () => {
  const newestVersion = getNewestInstalledVersion([
    { version: "0.4" },
    { version: "0.12" },
    { version: "0.9" },
  ]);

  assert.equal(newestVersion, "0.12");
});
