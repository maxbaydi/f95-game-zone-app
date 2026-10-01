const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isUnknownVersion,
  mergeImportedGameMetadata,
  mergeRefreshedGameMetadata,
} = require("../src/main/importMetadata");

test("mergeImportedGameMetadata prefers the catalog title and creator when available", () => {
  const merged = mergeImportedGameMetadata(
    {
      title: "raw folder title",
      creator: "Unknown",
      engine: "renpy",
      version: "Unknown",
    },
    {
      title: "Beautiful Site Title",
      creator: "Trusted Dev",
      engine: "Ren'Py",
      version: "0.8",
    },
  );

  assert.equal(merged.title, "Beautiful Site Title");
  assert.equal(merged.creator, "Trusted Dev");
  assert.equal(merged.engine, "Ren'Py");
  assert.equal(merged.version, "0.8");
});

test("mergeImportedGameMetadata keeps explicit local version when it is known", () => {
  const merged = mergeImportedGameMetadata(
    {
      title: "Local Title",
      creator: "Local Creator",
      engine: "Unity",
      version: "0.3.1",
    },
    {
      title: "Site Title",
      creator: "Site Creator",
      engine: "Ren'Py",
      version: "0.8",
    },
  );

  assert.equal(merged.title, "Site Title");
  assert.equal(merged.creator, "Site Creator");
  assert.equal(merged.engine, "Ren'Py");
  assert.equal(merged.version, "0.3.1");
});

test("isUnknownVersion only treats empty and explicit unknown placeholders as unresolved", () => {
  assert.equal(isUnknownVersion(""), true);
  assert.equal(isUnknownVersion("Unknown"), true);
  assert.equal(isUnknownVersion("  unknown "), true);
  assert.equal(isUnknownVersion("1.0"), false);
  assert.equal(isUnknownVersion("0.5"), false);
});

test("mergeRefreshedGameMetadata keeps the stored identity when the rescan is not confident", () => {
  const existingGame = {
    record_id: 5,
    title: "Beautiful Site Title",
    creator: "Trusted Dev",
    engine: "Ren'Py",
    f95_id: 100,
    versions: [{ version: "0.8", game_path: "C:\\Games\\Beautiful" }],
  };
  const merged = mergeRefreshedGameMetadata(existingGame, {
    title: "beautiful-0.9-pc",
    creator: "Unknown",
    engine: "Unknown",
    version: "0.9",
    f95Id: "",
    autoMatched: false,
    folder: "C:\\Games\\Beautiful",
  });

  assert.equal(merged.title, "Beautiful Site Title");
  assert.equal(merged.creator, "Trusted Dev");
  assert.equal(merged.engine, "Ren'Py");
  assert.equal(merged.version, "0.9");
  assert.equal(merged.folder, "C:\\Games\\Beautiful");
});

test("mergeRefreshedGameMetadata takes the scanner values when it matched confidently", () => {
  const merged = mergeRefreshedGameMetadata(
    {
      title: "old folder name",
      creator: "Unknown",
      engine: "Unknown",
      versions: [{ version: "Unknown", game_path: "C:\\Games\\X" }],
    },
    {
      title: "Proper Title",
      creator: "Proper Dev",
      engine: "unity",
      version: "1.2",
      f95Id: "77",
      autoMatched: true,
      folder: "C:\\Games\\X",
    },
  );

  assert.equal(merged.title, "Proper Title");
  assert.equal(merged.creator, "Proper Dev");
  assert.equal(merged.engine, "unity");
  assert.equal(merged.version, "1.2");
});

test("mergeRefreshedGameMetadata upgrades unknown stored values but never downgrades known ones", () => {
  const merged = mergeRefreshedGameMetadata(
    {
      title: "Stored Title",
      creator: "Unknown",
      engine: "",
      versions: [{ version: "0.5", game_path: "C:\\Games\\Stored" }],
    },
    {
      title: "Stored-Title-0.5",
      creator: "Scanned Dev",
      engine: "renpy",
      version: "Unknown",
      autoMatched: false,
      folder: "C:\\Games\\Stored",
    },
  );

  assert.equal(merged.title, "Stored Title");
  assert.equal(merged.creator, "Scanned Dev");
  assert.equal(merged.engine, "renpy");
  assert.equal(merged.version, "0.5", "known stored version for the same folder is kept");
});

test("mergeRefreshedGameMetadata falls back to the scanner when nothing is stored", () => {
  const merged = mergeRefreshedGameMetadata(null, {
    title: "Scanned",
    creator: "Dev",
    engine: "html",
    version: "2.0",
    autoMatched: false,
    folder: "C:\\Games\\Scanned",
  });

  assert.equal(merged.title, "Scanned");
  assert.equal(merged.creator, "Dev");
  assert.equal(merged.engine, "html");
  assert.equal(merged.version, "2.0");
});
