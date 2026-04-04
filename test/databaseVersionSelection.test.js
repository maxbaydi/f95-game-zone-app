const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const database = require("../src/database");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-db-version-select-"));
}

function closeAsync(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

test("addVersion prefers selectedValue over the first executable entry", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await database.initializeDatabase(appPaths);

  const recordId = await database.addGame({
    title: "Apartment #69",
    creator: "Luxee",
    engine: "Ren'Py",
  });

  await database.addVersion(
    {
      version: "v0.11",
      folder: "C:/Games/Apartment69",
      selectedValue: "Apartment69.exe",
      executables: [
        { key: "renpy/renpy.exe", value: "renpy/renpy.exe" },
        { key: "Apartment69.exe", value: "Apartment69.exe" },
      ],
      folderSize: 0,
    },
    recordId,
  );

  const game = await database.getGame(recordId, appPaths);

  assert.equal(
    game.versions[0].exec_path,
    path.join("C:/Games/Apartment69", "Apartment69.exe"),
  );

  await closeAsync(db);
});
