const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");

const {
  buildSaveExportFileName,
  exportGameSavesToFile,
  importGameSavesFromFile,
  isLikelySaveFile,
  matchManifestProfile,
  planForeignSaveImport,
} = require("../src/main/saveTransfer");
const { extractArchiveSafely } = require("../src/main/archive/extractArchive");

/** @param {unknown} error */
const codeOf = (error) => /** @type {any} */ (error)?.code;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "app-save-transfer-"));
}

function writeFiles(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function listFiles(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relative);
      } else {
        out.push(relative);
      }
    }
  };
  if (fs.existsSync(root)) {
    walk(root, "");
  }
  return out.sort();
}

function makeRenpySnapshot(installDirectory, appDataSaves) {
  return {
    game: {
      record_id: 7,
      title: "Stained Blood",
      creator: "Obsidian Desire Labs",
      engine: "Ren'Py",
      siteUrl: "https://f95zone.to/threads/stained-blood-v0-2.284885/",
      versions: [{ game_path: installDirectory, date_added: 1 }],
    },
    profiles: [
      {
        provider: "local",
        rootPath: path.join(installDirectory, "game", "saves"),
        strategy: { type: "install-relative", payload: { relativePath: "game/saves" } },
        confidence: 100,
        reasons: ["found local save directory at game/saves"],
      },
      ...(appDataSaves
        ? [
            {
              provider: "renpy_appdata",
              rootPath: appDataSaves,
              strategy: { type: "renpy-appdata", payload: { folderName: "StainedBlood-123" } },
              confidence: 90,
              reasons: ["AppData"],
            },
          ]
        : []),
    ],
  };
}

test("buildSaveExportFileName is safe for the file system", () => {
  const name = buildSaveExportFileName(
    { title: "Lust: Epidemic / Part 2?", creator: "NLT*Media" },
    new Date("2026-09-29T10:00:00Z"),
  );
  assert.equal(name, "Lust_ Epidemic _ Part 2_ (NLT_Media) saves 2026-09-29.zip");
});

test("isLikelySaveFile recognises engine save files and skips junk", () => {
  assert.equal(isLikelySaveFile("1-1-LT1.save"), true);
  assert.equal(isLikelySaveFile("persistent"), true);
  assert.equal(isLikelySaveFile("file1.rpgsave"), true);
  assert.equal(isLikelySaveFile("Save01.rvdata2"), true);
  assert.equal(isLikelySaveFile("SaveGame0.sav"), true);
  assert.equal(isLikelySaveFile("slot_3.dat"), true);
  assert.equal(isLikelySaveFile("Thumbs.db"), false);
  assert.equal(isLikelySaveFile("manifest.json"), false);
  assert.equal(isLikelySaveFile("readme.md"), false);
});

test("export writes a manifest plus every tracked file and import restores them into a fresh install", async () => {
  const root = makeTempDir();
  const install = path.join(root, "Stained Blood");
  const appData = path.join(root, "RenPy", "StainedBlood-123");
  writeFiles(install, {
    "game/saves/1-1-LT1.save": "slot",
    "game/saves/persistent": "persist",
    "StainedBlood.exe": "MZ",
  });
  writeFiles(appData, { "persistent": "appdata-persist" });

  const archivePath = path.join(root, "export.zip");
  const exported = await exportGameSavesToFile({
    snapshot: makeRenpySnapshot(install, appData),
    targetPath: archivePath,
    appVersion: "1.5.0",
    identity: "f95-284885",
    now: () => new Date("2026-09-29T10:00:00Z"),
  });
  assert.equal(exported.fileCount, 3);
  assert.equal(exported.profiles.length, 2);

  const zip = new AdmZip(archivePath);
  const names = zip.getEntries().map((entry) => entry.entryName).sort();
  assert.deepEqual(names, [
    "manifest.json",
    "profiles/local/game/saves/1-1-LT1.save",
    "profiles/local/game/saves/persistent",
    "profiles/roaming/RenPy/StainedBlood-123/persistent",
  ]);
  const manifest = JSON.parse(zip.readAsText("manifest.json"));
  assert.equal(manifest.format, "f95launcher-saves");
  assert.equal(manifest.game.title, "Stained Blood");
  assert.equal(manifest.identity, "f95-284885");
  assert.equal(manifest.entries.length, 3);

  // A new machine: different install folder, different AppData folder name.
  const newInstall = path.join(root, "reinstalled");
  const newAppData = path.join(root, "RenPy2", "StainedBlood-999");
  fs.mkdirSync(newInstall, { recursive: true });
  fs.mkdirSync(newAppData, { recursive: true });
  const imported = await importGameSavesFromFile({
    snapshot: makeRenpySnapshot(newInstall, newAppData),
    archivePath,
    extractArchive: extractArchiveSafely,
    tempRoot: root,
  });
  assert.equal(imported.foreign, false);
  assert.equal(imported.importedFiles, 3);
  assert.deepEqual(listFiles(path.join(newInstall, "game", "saves")), ["1-1-LT1.save", "persistent"]);
  assert.equal(fs.readFileSync(path.join(newAppData, "persistent"), "utf8"), "appdata-persist");
  assert.deepEqual(
    imported.destinations.map((entry) => entry.how),
    ["same-strategy", "same-strategy"],
  );
  assert.deepEqual(
    imported.destinations.map((entry) => entry.rootPath).sort(),
    [path.join(newInstall, "game", "saves"), newAppData].sort(),
  );
  assert.equal(fs.readdirSync(root).some((name) => name.startsWith("f95-saves-import-")), false, "temp folder cleaned");
});

test("export without any save file is refused instead of writing an empty archive", async () => {
  const root = makeTempDir();
  const install = path.join(root, "Empty");
  fs.mkdirSync(install, { recursive: true });
  await assert.rejects(
    () =>
      exportGameSavesToFile({
        snapshot: makeRenpySnapshot(install, ""),
        targetPath: path.join(root, "empty.zip"),
        identity: "x",
      }),
    (error) => codeOf(error) === "no_save_files",
  );
  assert.equal(fs.existsSync(path.join(root, "empty.zip")), false);
});

test("a zip the user made of the saves folder lands in the detected save folder", async () => {
  const root = makeTempDir();
  const install = path.join(root, "Game");
  fs.mkdirSync(path.join(install, "game", "saves"), { recursive: true });
  const zip = new AdmZip();
  zip.addFile("saves/1-2-LT1.save", Buffer.from("a"));
  zip.addFile("saves/persistent", Buffer.from("b"));
  zip.addFile("saves/Thumbs.db", Buffer.from("junk"));
  const archivePath = path.join(root, "my-saves.zip");
  zip.writeZip(archivePath);

  const imported = await importGameSavesFromFile({
    snapshot: makeRenpySnapshot(install, ""),
    archivePath,
    extractArchive: extractArchiveSafely,
    tempRoot: root,
  });
  assert.equal(imported.foreign, true);
  assert.equal(imported.importedFiles, 2);
  assert.equal(imported.skippedFiles, 1);
  assert.equal(imported.destinations[0].rootPath, path.join(install, "game", "saves"));
  assert.deepEqual(listFiles(path.join(install, "game", "saves")), ["1-2-LT1.save", "persistent"]);
});

test("foreign RPG Maker root saves go next to the executable and the engine default is used when nothing is detected", () => {
  const install = "C:/Games/Quest";
  const rpg = planForeignSaveImport({
    files: [{ relativePath: "Save01.rvdata2" }, { relativePath: "Save02.rvdata2" }],
    profiles: [
      {
        provider: "local",
        rootPath: install,
        strategy: {
          type: "install-file-patterns",
          payload: { relativePath: "", filePatterns: ["Save*.rvdata2"] },
        },
        confidence: 100,
      },
    ],
    installDirectory: install,
    engineFamily: "rpgmaker",
  });
  assert.equal(rpg.destination, install);
  assert.equal(rpg.files.length, 2);

  const unreal = planForeignSaveImport({
    files: [{ relativePath: "MyGame/Saved/SaveGames/Slot1.sav" }],
    profiles: [],
    installDirectory: install,
    engineFamily: "unreal",
  });
  assert.equal(unreal.destination, path.join(install, "Saved", "SaveGames"));
  assert.equal(unreal.files[0].relativePath, "Slot1.sav");

  const nested = planForeignSaveImport({
    files: [
      { relativePath: "Stained Blood/game/saves/1-1-LT1.save" },
      { relativePath: "Stained Blood/game/saves/persistent" },
    ],
    profiles: [],
    installDirectory: install,
    engineFamily: "renpy",
  });
  assert.equal(nested.strip, "Stained Blood/game/saves/");
  assert.deepEqual(
    nested.files.map((file) => file.relativePath),
    ["1-1-LT1.save", "persistent"],
  );
  assert.equal(nested.destination, path.join(install, "game", "saves"));
});

test("an archive without save-like files is rejected before anything is written", async () => {
  const root = makeTempDir();
  const install = path.join(root, "Game");
  fs.mkdirSync(path.join(install, "game", "saves"), { recursive: true });
  const zip = new AdmZip();
  zip.addFile("readme.md", Buffer.from("hello"));
  const archivePath = path.join(root, "not-saves.zip");
  zip.writeZip(archivePath);

  await assert.rejects(
    () =>
      importGameSavesFromFile({
        snapshot: makeRenpySnapshot(install, ""),
        archivePath,
        extractArchive: extractArchiveSafely,
        tempRoot: root,
      }),
    (error) => codeOf(error) === "no_save_files",
  );
  assert.deepEqual(listFiles(path.join(install, "game", "saves")), []);
});

test("matchManifestProfile prefers the same strategy, then the same provider", () => {
  const local = [
    { provider: "local", rootPath: "/a/game/saves", strategy: { type: "install-relative", payload: { relativePath: "game/saves" } } },
    { provider: "renpy_appdata", rootPath: "/r/X-1", strategy: { type: "renpy-appdata", payload: { folderName: "X-1" } } },
  ];
  assert.equal(
    matchManifestProfile({ provider: "local", strategy: { type: "install-relative", payload: { relativePath: "game/saves" } } }, local).profile.rootPath,
    "/a/game/saves",
  );
  assert.equal(
    matchManifestProfile({ provider: "renpy_appdata", strategy: { type: "renpy-appdata", payload: { folderName: "X-2" } } }, local).how,
    "same-provider",
  );
  assert.equal(
    matchManifestProfile({ provider: "unity_locallow", strategy: { type: "windows-known-folder", payload: {} } }, local).profile,
    null,
  );
});
