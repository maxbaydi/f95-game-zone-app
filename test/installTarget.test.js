const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  chooseInstallDirectory,
  sanitizePathSegment,
} = require("../src/main/install/installTarget");

const LIBRARY = path.join("C:", "Library");

/**
 * @param {string[]} existing
 */
function existsIn(existing) {
  const known = new Set(existing.map((entry) => entry.toLowerCase()));
  return (targetPath) => known.has(String(targetPath).toLowerCase());
}

test("reuses the newest existing install folder of the library record", () => {
  const result = chooseInstallDirectory({
    existingGame: {
      versions: [
        { game_path: "C:\\Games\\Old", date_added: 1 },
        { game_path: "C:\\Games\\New", date_added: 5 },
      ],
    },
    libraryFolder: LIBRARY,
    folderName: "Game",
    pathExists: existsIn(["C:\\Games\\Old", "C:\\Games\\New"]),
  });

  assert.equal(result.installDirectory, "C:\\Games\\New");
  assert.equal(result.reusedExisting, true);
  assert.deepEqual(result.staleInstallPaths, []);
});

test("falls back to an older copy that still exists and lists the missing one as stale", () => {
  const result = chooseInstallDirectory({
    existingGame: {
      versions: [
        { game_path: "C:\\Games\\New", date_added: 5 },
        { game_path: "C:\\Games\\Old", date_added: 1 },
      ],
    },
    libraryFolder: LIBRARY,
    folderName: "Game",
    pathExists: existsIn(["C:\\Games\\Old"]),
  });

  assert.equal(result.installDirectory, "C:\\Games\\Old");
  assert.equal(result.reusedExisting, true);
  assert.deepEqual(result.staleInstallPaths, ["C:\\Games\\New"]);
});

test("installs into the library folder when every recorded folder is missing", () => {
  const result = chooseInstallDirectory({
    existingGame: {
      versions: [
        { game_path: "D:\\Gone\\Game", date_added: 5 },
        { game_path: "E:\\Gone\\Game", date_added: 1 },
      ],
    },
    libraryFolder: LIBRARY,
    folderName: "Game",
    pathExists: existsIn([]),
  });

  assert.equal(result.installDirectory, path.join(LIBRARY, "Game"));
  assert.equal(result.reusedExisting, false);
  assert.deepEqual(result.staleInstallPaths, ["D:\\Gone\\Game", "E:\\Gone\\Game"]);
});

test("picks a unique folder when the fresh target already exists on disk", () => {
  const result = chooseInstallDirectory({
    existingGame: null,
    libraryFolder: LIBRARY,
    folderName: "Game",
    pathExists: existsIn([path.join(LIBRARY, "Game"), path.join(LIBRARY, "Game (1)")]),
  });

  assert.equal(result.installDirectory, path.join(LIBRARY, "Game (2)"));
  assert.equal(result.reusedExisting, false);
  assert.deepEqual(result.staleInstallPaths, []);
});

test("a record without versions installs fresh", () => {
  const result = chooseInstallDirectory({
    existingGame: { record_id: 3, versions: [] },
    libraryFolder: LIBRARY,
    folderName: "Stub Game",
    pathExists: existsIn([]),
  });

  assert.equal(result.installDirectory, path.join(LIBRARY, "Stub Game"));
  assert.equal(result.reusedExisting, false);
});

test("sanitizes the folder name and ignores versions without a path", () => {
  const result = chooseInstallDirectory({
    existingGame: { versions: [{ game_path: "", date_added: 9 }] },
    libraryFolder: LIBRARY,
    folderName: "My: Game? <v1>",
    pathExists: existsIn([]),
  });

  assert.equal(result.installDirectory, path.join(LIBRARY, "My_ Game_ _v1_"));
  assert.deepEqual(result.staleInstallPaths, []);
});

test("sanitizePathSegment falls back when nothing usable is left", () => {
  assert.equal(sanitizePathSegment("???"), "___");
  assert.equal(sanitizePathSegment("   "), "Unknown");
  assert.equal(sanitizePathSegment("", "Fallback"), "Fallback");
  assert.equal(sanitizePathSegment("a\u0000b"), "ab");
});
