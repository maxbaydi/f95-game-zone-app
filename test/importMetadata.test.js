const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isUnknownVersion,
  mergeImportedGameMetadata,
} = require("../src/main/importMetadata");

test("mergeImportedGameMetadata prefers atlas title and creator when available", () => {
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
