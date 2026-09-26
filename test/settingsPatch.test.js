const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_ARCHIVE_EXTENSIONS,
  applySettingsPatch,
  normalizeExtensionList,
} = require("../src/main/settingsPatch");

test("applySettingsPatch merges one section without touching the rest", () => {
  const config = {
    Interface: { minimizeToTray: false, language: "English" },
    CloudSync: { publishableKey: "secret" },
  };

  const next = applySettingsPatch(config, "Interface", {
    minimizeToTray: "true",
  });

  assert.deepEqual(next.Interface, {
    minimizeToTray: true,
    language: "English",
  });
  assert.equal(next.CloudSync, config.CloudSync);
  assert.equal(config.Interface.minimizeToTray, false);
});

test("applySettingsPatch rejects unknown sections and keys", () => {
  assert.throws(
    () => applySettingsPatch({}, "CloudSync", { publishableKey: "x" }),
    /Unknown settings section/,
  );
  assert.throws(
    () => applySettingsPatch({}, "Interface", { rootPath: "/tmp" }),
    /Unknown setting: Interface.rootPath/,
  );
});

test("applySettingsPatch normalizes values by type", () => {
  const next = applySettingsPatch({}, "Library", {
    gameFolder: "  D:\\Games  ",
    extractionExtensions: "",
  });

  assert.equal(next.Library.gameFolder, "D:\\Games");
  assert.equal(next.Library.extractionExtensions, DEFAULT_ARCHIVE_EXTENSIONS);
  assert.equal(
    applySettingsPatch({}, "Onboarding", { completed: 0 }).Onboarding.completed,
    false,
  );
});

test("normalizeExtensionList cleans dots, case, separators and duplicates", () => {
  assert.equal(
    normalizeExtensionList(".EXE, html  swf;exe", "zip"),
    "exe,html,swf",
  );
  assert.equal(normalizeExtensionList("../../evil, ok", "zip"), "ok");
  assert.equal(normalizeExtensionList(null, "zip"), "zip");
});

test("applySettingsPatch only accepts known animation levels", () => {
  assert.equal(
    applySettingsPatch({}, "Interface", { motion: "Reduced" }).Interface.motion,
    "reduced",
  );
  assert.equal(
    applySettingsPatch({}, "Interface", { motion: "wild" }).Interface.motion,
    "auto",
  );
});
