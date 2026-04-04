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
