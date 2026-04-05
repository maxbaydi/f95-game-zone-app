const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  backupGameSaves,
  buildSaveVaultIdentity,
  restoreGameSaves,
} = require("../src/main/saveVault");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-save-vault-test-"));
}

test("buildSaveVaultIdentity prefers F95 thread id", () => {
  const identity = buildSaveVaultIdentity({
    threadUrl:
      "https://f95zone.to/threads/stained-blood-v0-2-obsidian-desire-labs.284885/",
    title: "Stained Blood",
    creator: "Obsidian Desire Labs",
  });

  assert.equal(identity, "f95-284885");
});

test("backupGameSaves and restoreGameSaves preserve tracked local save directories", async () => {
  const tempRoot = makeTempDir();
  const appPaths = {
    backups: path.join(tempRoot, "backups"),
  };
  const installDirectory = path.join(tempRoot, "install");
  const reinstalledDirectory = path.join(tempRoot, "reinstall");
  const saveFilePath = path.join(installDirectory, "game", "saves", "slot1.save");

  fs.mkdirSync(path.dirname(saveFilePath), { recursive: true });
  fs.writeFileSync(saveFilePath, "save-data", "utf8");

  const backupResult = await backupGameSaves({
    appPaths,
    threadUrl:
      "https://f95zone.to/threads/stained-blood-v0-2-obsidian-desire-labs.284885/",
    title: "Stained Blood",
    creator: "Obsidian Desire Labs",
    installDirectory,
  });

  assert.deepEqual(backupResult.backedUpPaths, ["game/saves"]);

  fs.mkdirSync(reinstalledDirectory, { recursive: true });
  const restoreResult = await restoreGameSaves({
    appPaths,
    threadUrl:
      "https://f95zone.to/threads/stained-blood-v0-2-obsidian-desire-labs.284885/",
    title: "Stained Blood",
    creator: "Obsidian Desire Labs",
    installDirectory: reinstalledDirectory,
  });

  assert.deepEqual(restoreResult.restoredPaths, ["game/saves"]);
  assert.equal(
    fs.readFileSync(
      path.join(reinstalledDirectory, "game", "saves", "slot1.save"),
      "utf8",
    ),
    "save-data",
  );
});

test("backupGameSaves and restoreGameSaves preserve Ren'Py AppData profiles", async () => {
  const tempRoot = makeTempDir();
  const previousAppData = process.env.APPDATA;
  const appDataRoot = path.join(tempRoot, "AppData", "Roaming");
  const appPaths = {
    backups: path.join(tempRoot, "backups"),
  };
  const profileRoot = path.join(appDataRoot, "RenPy", "StainedBlood");
  const saveFilePath = path.join(profileRoot, "persistent");

  process.env.APPDATA = appDataRoot;
  fs.mkdirSync(profileRoot, { recursive: true });
  fs.writeFileSync(saveFilePath, "persistent-data", "utf8");

  try {
    const backupResult = await backupGameSaves({
      appPaths,
      threadUrl:
        "https://f95zone.to/threads/stained-blood-v0-2-obsidian-desire-labs.284885/",
      title: "Stained Blood",
      creator: "Obsidian Desire Labs",
      installDirectory: path.join(tempRoot, "install"),
      profiles: [
        {
          provider: "renpy_appdata",
          rootPath: profileRoot,
          strategy: {
            type: "renpy-appdata",
            payload: {
              folderName: "StainedBlood",
            },
          },
          confidence: 90,
          reasons: ["AppData folder exactly matches title"],
        },
      ],
    });

    assert.equal(backupResult.backedUpProfiles.length, 1);

    fs.rmSync(profileRoot, { recursive: true, force: true });

    const restoreResult = await restoreGameSaves({
      appPaths,
      threadUrl:
        "https://f95zone.to/threads/stained-blood-v0-2-obsidian-desire-labs.284885/",
      title: "Stained Blood",
      creator: "Obsidian Desire Labs",
      installDirectory: path.join(tempRoot, "reinstall"),
    });

    assert.equal(restoreResult.restoredPaths.length, 1);
    assert.equal(
      fs.readFileSync(path.join(profileRoot, "persistent"), "utf8"),
      "persistent-data",
    );
  } finally {
    process.env.APPDATA = previousAppData;
  }
});

test("backupGameSaves and restoreGameSaves preserve root-level RPG Maker save files only", async () => {
  const tempRoot = makeTempDir();
  const appPaths = {
    backups: path.join(tempRoot, "backups"),
  };
  const installDirectory = path.join(tempRoot, "install");
  const reinstalledDirectory = path.join(tempRoot, "reinstall");

  fs.mkdirSync(installDirectory, { recursive: true });
  fs.writeFileSync(path.join(installDirectory, "Save01.rvdata2"), "save-one", "utf8");
  fs.writeFileSync(path.join(installDirectory, "Save02.rvdata2"), "save-two", "utf8");
  fs.writeFileSync(path.join(installDirectory, "game.exe"), "binary", "utf8");

  const backupResult = await backupGameSaves({
    appPaths,
    title: "Old School Quest",
    creator: "RPG Studio",
    installDirectory,
    profiles: [
      {
        provider: "local",
        rootPath: installDirectory,
        strategy: {
          type: "install-file-patterns",
          payload: {
            relativePath: "",
            filePatterns: ["Save*.rvdata2"],
          },
        },
        confidence: 100,
        reasons: ["found RPG Maker save files in the game root"],
      },
    ],
  });

  assert.equal(backupResult.backedUpProfiles.length, 1);

  fs.mkdirSync(reinstalledDirectory, { recursive: true });
  const restoreResult = await restoreGameSaves({
    appPaths,
    title: "Old School Quest",
    creator: "RPG Studio",
    installDirectory: reinstalledDirectory,
  });

  assert.equal(restoreResult.restoredPaths.length, 1);
  assert.equal(
    fs.readFileSync(path.join(reinstalledDirectory, "Save01.rvdata2"), "utf8"),
    "save-one",
  );
  assert.equal(
    fs.readFileSync(path.join(reinstalledDirectory, "Save02.rvdata2"), "utf8"),
    "save-two",
  );
  assert.equal(fs.existsSync(path.join(reinstalledDirectory, "game.exe")), false);
});

test("backupGameSaves and restoreGameSaves preserve LocalLow app data profiles", async () => {
  const tempRoot = makeTempDir();
  const previousUserProfile = process.env.USERPROFILE;
  const appPaths = {
    backups: path.join(tempRoot, "backups"),
  };
  const localLowRoot = path.join(
    tempRoot,
    "AppData",
    "LocalLow",
    "Studio X",
    "Crimson High",
  );

  process.env.USERPROFILE = tempRoot;
  fs.mkdirSync(localLowRoot, { recursive: true });
  fs.writeFileSync(path.join(localLowRoot, "slot1.json"), "{\"slot\":1}", "utf8");

  try {
    const backupResult = await backupGameSaves({
      appPaths,
      title: "Crimson High",
      creator: "Studio X",
      installDirectory: path.join(tempRoot, "install"),
      profiles: [
        {
          provider: "unity_locallow",
          rootPath: localLowRoot,
          strategy: {
            type: "windows-known-folder",
            payload: {
              baseFolder: "localLow",
              path: "Studio X/Crimson High",
            },
          },
          confidence: 88,
          reasons: ["found Unity persistent data directory in LocalLow"],
        },
      ],
    });

    assert.equal(backupResult.backedUpProfiles.length, 1);

    fs.rmSync(localLowRoot, { recursive: true, force: true });

    const restoreResult = await restoreGameSaves({
      appPaths,
      title: "Crimson High",
      creator: "Studio X",
      installDirectory: path.join(tempRoot, "reinstall"),
    });

    assert.equal(restoreResult.restoredPaths.length, 1);
    assert.equal(
      fs.readFileSync(path.join(localLowRoot, "slot1.json"), "utf8"),
      "{\"slot\":1}",
    );
  } finally {
    process.env.USERPROFILE = previousUserProfile;
  }
});
