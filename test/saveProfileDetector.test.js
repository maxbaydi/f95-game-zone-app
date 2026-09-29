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

test("detectSaveProfiles finds Documents/My Games, Saved Games and GameMaker folders by strong name matches", () => {
  const tempRoot = makeTempDir();
  const previous = {
    USERPROFILE: process.env.USERPROFILE,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    ATLAS_DOCUMENTS_DIR: process.env.ATLAS_DOCUMENTS_DIR,
    ATLAS_SAVED_GAMES_DIR: process.env.ATLAS_SAVED_GAMES_DIR,
  };
  const installRoot = path.join(tempRoot, "Crimson High");
  const documents = path.join(tempRoot, "Documents");
  const savedGames = path.join(tempRoot, "Saved Games");
  const localAppData = path.join(tempRoot, "AppData", "Local");
  fs.mkdirSync(installRoot, { recursive: true });
  fs.writeFileSync(path.join(installRoot, "data.win"), "");
  fs.mkdirSync(path.join(documents, "My Games", "Crimson High"), { recursive: true });
  fs.mkdirSync(path.join(documents, "Game"), { recursive: true });
  fs.mkdirSync(path.join(documents, "Crimson High"), { recursive: true });
  fs.mkdirSync(path.join(documents, "Studio X Projects"), { recursive: true });
  fs.mkdirSync(path.join(savedGames, "CrimsonHigh"), { recursive: true });
  fs.mkdirSync(path.join(localAppData, "Crimson_High"), { recursive: true });
  fs.writeFileSync(path.join(localAppData, "Crimson_High", "save.ini"), "");
  fs.mkdirSync(path.join(localAppData, "Microsoft"), { recursive: true });

  process.env.USERPROFILE = tempRoot;
  process.env.LOCALAPPDATA = localAppData;
  process.env.ATLAS_DOCUMENTS_DIR = documents;
  process.env.ATLAS_SAVED_GAMES_DIR = savedGames;
  try {
    const profiles = detectSaveProfiles({
      title: "Crimson High",
      creator: "Studio X",
      engine: "",
      primaryPath: installRoot,
      versions: [{ game_path: installRoot, exec_path: path.join(installRoot, "Game.exe") }],
    });
    const roots = profiles.map((profile) => profile.rootPath);
    assert.ok(roots.includes(path.join(documents, "My Games", "Crimson High")), "Documents/My Games");
    assert.ok(roots.includes(path.join(savedGames, "CrimsonHigh")), "Saved Games");
    assert.ok(roots.includes(path.join(localAppData, "Crimson_High")), "GameMaker LocalAppData");
    assert.equal(roots.includes(path.join(documents, "Game")), false, "generic names never match");
    assert.ok(roots.includes(path.join(documents, "Crimson High")), "Documents root, exact name");
    assert.equal(
      roots.includes(path.join(documents, "Studio X Projects")),
      false,
      "Documents root never matches by overlap",
    );
    assert.equal(roots.includes(path.join(localAppData, "Microsoft")), false);
    const documentsProfile = profiles.find(
      (profile) => profile.rootPath === path.join(documents, "My Games", "Crimson High"),
    );
    assert.deepEqual(documentsProfile.strategy, {
      type: "windows-known-folder",
      payload: { baseFolder: "documents", path: "My Games/Crimson High" },
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("detectSaveProfiles finds Flash shared objects mirroring the install path and KiriKiri/Wolf save folders", () => {
  const tempRoot = makeTempDir();
  const previousAppData = process.env.APPDATA;
  const appData = path.join(tempRoot, "Roaming");
  const installRoot = path.join(tempRoot, "Games", "Flashy");
  fs.mkdirSync(installRoot, { recursive: true });
  fs.writeFileSync(path.join(installRoot, "game.swf"), "");
  const parsed = path.parse(path.resolve(installRoot));
  const mirror = parsed.dir.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean).concat([parsed.base]);
  const sharedRoot = path.join(appData, "Macromedia", "Flash Player", "#SharedObjects", "ABCDEFGH", "localhost", ...mirror);
  fs.mkdirSync(path.join(sharedRoot, "game.swf"), { recursive: true });
  fs.writeFileSync(path.join(sharedRoot, "game.swf", "save.sol"), "");

  process.env.APPDATA = appData;
  try {
    const profiles = detectSaveProfiles({
      title: "Flashy",
      engine: "Flash",
      primaryPath: installRoot,
      versions: [],
    });
    const flash = profiles.find((profile) => profile.provider === "flash_sharedobjects");
    assert.ok(flash, "flash profile detected");
    assert.equal(flash.rootPath, sharedRoot);
    assert.equal(flash.strategy.payload.baseFolder, "appdata");
  } finally {
    process.env.APPDATA = previousAppData;
  }

  const kirikiri = path.join(tempRoot, "Kiri");
  fs.mkdirSync(path.join(kirikiri, "savedata"), { recursive: true });
  fs.writeFileSync(path.join(kirikiri, "data.xp3"), "");
  const kiriProfiles = detectSaveProfiles({ title: "Kiri", engine: "", primaryPath: kirikiri, versions: [] });
  assert.ok(kiriProfiles.some((profile) => profile.rootPath === path.join(kirikiri, "savedata")));

  const wolf = path.join(tempRoot, "Wolf");
  fs.mkdirSync(path.join(wolf, "save"), { recursive: true });
  fs.writeFileSync(path.join(wolf, "Data.wolf"), "");
  const wolfProfiles = detectSaveProfiles({ title: "Wolf", engine: "Wolf RPG", primaryPath: wolf, versions: [] });
  assert.ok(wolfProfiles.some((profile) => profile.rootPath === path.join(wolf, "save")));
});
