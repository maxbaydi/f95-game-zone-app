const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  detectRenpySaveProfiles,
  isRenpyLikeGame,
} = require("../src/main/detectors/renpySaveDetector");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-renpy-saves-"));
}

test("detectRenpySaveProfiles finds install-relative and AppData Ren'Py save roots", () => {
  const root = makeTempDir();
  const installRoot = path.join(root, "Stained Blood");
  const appDataRenpyRoot = path.join(root, "AppData", "Roaming", "RenPy");

  fs.mkdirSync(path.join(installRoot, "game", "saves"), { recursive: true });
  fs.mkdirSync(path.join(installRoot, "renpy"), { recursive: true });
  fs.writeFileSync(path.join(installRoot, "game", "script.rpa"), "");

  fs.mkdirSync(path.join(appDataRenpyRoot, "StainedBlood"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(appDataRenpyRoot, "StainedBlood", "persistent"),
    "",
  );

  const profiles = detectRenpySaveProfiles(
    {
      title: "Stained Blood",
      engine: "Ren'Py",
      primaryPath: installRoot,
      versions: [],
    },
    { appDataRenpyRoot },
  );

  assert.equal(profiles.length, 2);
  assert.equal(
    profiles.some(
      (profile) =>
        profile.strategy.type === "install-relative" &&
        profile.strategy.payload.relativePath === "game/saves",
    ),
    true,
  );
  assert.equal(
    profiles.some(
      (profile) =>
        profile.strategy.type === "renpy-appdata" &&
        profile.strategy.payload.folderName === "StainedBlood",
    ),
    true,
  );
});

test("isRenpyLikeGame falls back to install markers when engine metadata is missing", () => {
  const root = makeTempDir();
  fs.mkdirSync(path.join(root, "renpy"), { recursive: true });
  fs.mkdirSync(path.join(root, "game"), { recursive: true });
  fs.writeFileSync(path.join(root, "game", "script.rpy"), "");

  assert.equal(
    isRenpyLikeGame({
      engine: "",
      primaryPath: root,
    }),
    true,
  );
});
