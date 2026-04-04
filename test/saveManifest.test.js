const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSaveManifest,
  createSaveManifestHash,
} = require("../src/shared/saveManifest");

test("buildSaveManifest sorts entries and yields stable hash", () => {
  const left = buildSaveManifest({
    identity: "f95-123",
    profiles: [
      {
        provider: "local",
        rootPath: "C:/Games/Demo/game/saves",
        strategy: {
          type: "install-relative",
          payload: { relativePath: "game/saves" },
        },
        archiveRoot: "profiles/local/game/saves",
      },
    ],
    entries: [
      { path: "profiles/local/game/saves/z.save", size: 2, sha256: "b", mtimeMs: 2 },
      { path: "profiles/local/game/saves/a.save", size: 1, sha256: "a", mtimeMs: 1 },
    ],
  });

  const right = buildSaveManifest({
    identity: "f95-123",
    profiles: left.profiles,
    entries: [...left.entries].reverse(),
  });

  assert.deepEqual(
    left.entries.map((entry) => entry.path),
    ["profiles/local/game/saves/a.save", "profiles/local/game/saves/z.save"],
  );
  assert.equal(left.manifestHash, right.manifestHash);
  assert.equal(left.manifestHash, createSaveManifestHash(left));
});
