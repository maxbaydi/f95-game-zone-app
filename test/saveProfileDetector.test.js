const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  detectSaveProfiles,
} = require("../src/main/detectors/saveProfileDetector");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-save-profile-detector-"));
}

test("detectSaveProfiles finds RPG Maker root save files", () => {
  const installRoot = makeTempDir();
  fs.writeFileSync(path.join(installRoot, "Game.ini"), "[Game]");
  fs.writeFileSync(path.join(installRoot, "Save01.rvdata2"), "save");

  const profiles = detectSaveProfiles({
    title: "Old School Quest",
    engine: "RPG Maker VX Ace",
    primaryPath: installRoot,
    versions: [],
  });

  assert.equal(
    profiles.some(
      (profile) =>
        profile.strategy.type === "install-file-patterns" &&
        profile.rootPath === installRoot,
    ),
    true,
  );
});

test("detectSaveProfiles finds Unity LocalLow save roots", () => {
  const tempRoot = makeTempDir();
  const previousUserProfile = process.env.USERPROFILE;
  const installRoot = path.join(tempRoot, "Crimson High");
  const unityDataRoot = path.join(tempRoot, "AppData", "LocalLow", "Studio X", "Crimson High");

  process.env.USERPROFILE = tempRoot;
  fs.mkdirSync(path.join(installRoot, "CrimsonHigh_Data"), { recursive: true });
  fs.writeFileSync(path.join(installRoot, "UnityPlayer.dll"), "");
  fs.mkdirSync(unityDataRoot, { recursive: true });
  fs.writeFileSync(path.join(unityDataRoot, "slot1.json"), "{}");

  try {
    const profiles = detectSaveProfiles({
      title: "Crimson High",
      creator: "Studio X",
      engine: "Unity",
      primaryPath: installRoot,
      versions: [],
    });

    assert.equal(
      profiles.some(
        (profile) =>
          profile.provider === "unity_locallow" &&
          profile.rootPath === unityDataRoot,
      ),
      true,
    );
  } finally {
    process.env.USERPROFILE = previousUserProfile;
  }
});

test("detectSaveProfiles finds Unreal install and Local AppData save roots", () => {
  const tempRoot = makeTempDir();
  const previousLocalAppData = process.env.LOCALAPPDATA;
  const installRoot = path.join(tempRoot, "Velvet Impact");
  const installSaveRoot = path.join(installRoot, "Saved", "SaveGames");
  const localSaveRoot = path.join(
    tempRoot,
    "AppData",
    "Local",
    "VelvetImpact",
    "Saved",
    "SaveGames",
  );

  process.env.LOCALAPPDATA = path.join(tempRoot, "AppData", "Local");
  fs.mkdirSync(installSaveRoot, { recursive: true });
  fs.mkdirSync(path.join(installRoot, "Content", "Paks"), { recursive: true });
  fs.mkdirSync(localSaveRoot, { recursive: true });

  try {
    const profiles = detectSaveProfiles({
      title: "Velvet Impact",
      engine: "Unreal Engine",
      primaryPath: installRoot,
      versions: [],
    });

    assert.equal(
      profiles.some(
        (profile) =>
          profile.strategy.type === "install-relative" &&
          profile.rootPath === installSaveRoot,
      ),
      true,
    );
    assert.equal(
      profiles.some(
        (profile) =>
          profile.provider === "unreal_localappdata" &&
          profile.rootPath === localSaveRoot,
      ),
      true,
    );
  } finally {
    process.env.LOCALAPPDATA = previousLocalAppData;
  }
});

test("detectSaveProfiles finds Godot app_userdata saves", () => {
  const tempRoot = makeTempDir();
  const previousAppData = process.env.APPDATA;
  const installRoot = path.join(tempRoot, "Moonlit Grove");
  const godotSaveRoot = path.join(
    tempRoot,
    "AppData",
    "Roaming",
    "Godot",
    "app_userdata",
    "Moonlit Grove",
  );

  process.env.APPDATA = path.join(tempRoot, "AppData", "Roaming");
  fs.mkdirSync(installRoot, { recursive: true });
  fs.writeFileSync(path.join(installRoot, "Moonlit Grove.pck"), "");
  fs.mkdirSync(godotSaveRoot, { recursive: true });

  try {
    const profiles = detectSaveProfiles({
      title: "Moonlit Grove",
      engine: "Godot",
      primaryPath: installRoot,
      versions: [],
    });

    assert.equal(
      profiles.some(
        (profile) =>
          profile.provider === "godot_appdata" &&
          profile.rootPath === godotSaveRoot,
      ),
      true,
    );
  } finally {
    process.env.APPDATA = previousAppData;
  }
});

test("detectSaveProfiles finds packaged HTML app storage", () => {
  const tempRoot = makeTempDir();
  const previousLocalAppData = process.env.LOCALAPPDATA;
  const installRoot = path.join(tempRoot, "Browser Nights");
  const htmlStorageRoot = path.join(
    tempRoot,
    "AppData",
    "Local",
    "Browser Nights",
    "User Data",
    "Default",
    "Local Storage",
  );

  process.env.LOCALAPPDATA = path.join(tempRoot, "AppData", "Local");
  fs.mkdirSync(path.join(installRoot, "resources"), { recursive: true });
  fs.writeFileSync(path.join(installRoot, "resources", "app.asar"), "");
  fs.mkdirSync(htmlStorageRoot, { recursive: true });

  try {
    const profiles = detectSaveProfiles({
      title: "Browser Nights",
      engine: "HTML",
      primaryPath: installRoot,
      versions: [],
    });

    assert.equal(
      profiles.some(
        (profile) =>
          profile.provider === "html_appdata" &&
          profile.rootPath === htmlStorageRoot,
      ),
      true,
    );
  } finally {
    process.env.LOCALAPPDATA = previousLocalAppData;
  }
});
