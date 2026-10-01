const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");

const {
  resolveExecutableWithinFolder,
  listGameExecutables,
  relocateGameVersion,
  setGameExecutable,
} = require("../src/main/libraryVersionRepair");

// Absolute on every platform (a literal `C:\...` is relative on Linux). The
// file system is never touched: `pathExists` is always injected.
const ROOT = path.resolve(os.tmpdir(), "f95launcher-version-repair");
const GAME_DIR = path.join(ROOT, "Games", "Sample");
const OTHER_GAME_DIR = path.join(ROOT, "Games", "Other");
const MOVED_DIR = path.join(ROOT, "Moved");
const OUTSIDE_EXE = path.join(ROOT, "Windows", "cmd.exe");
// Folder comparisons ignore case on Windows only.
const respelled = (value) => (process.platform === "win32" ? value.toUpperCase() : value);

/**
 * @param {string[]} existing
 */
function existsIn(existing) {
  const known = new Set(existing.map((entry) => path.resolve(entry).toLowerCase()));
  return (targetPath) => known.has(path.resolve(String(targetPath)).toLowerCase());
}

test("resolveExecutableWithinFolder accepts relative and absolute paths inside the folder", () => {
  const relative = resolveExecutableWithinFolder(GAME_DIR, "game.exe");
  assert.equal(relative.ok, true);
  assert.equal(relative.relativePath, "game.exe");
  assert.equal(relative.absolutePath, path.join(GAME_DIR, "game.exe"));

  const nested = resolveExecutableWithinFolder(GAME_DIR, path.join(GAME_DIR, "bin", "Game.exe"));
  assert.equal(nested.ok, true);
  assert.equal(nested.relativePath, path.join("bin", "Game.exe"));
});

test("resolveExecutableWithinFolder rejects traversal, outside paths and empty input", () => {
  assert.equal(resolveExecutableWithinFolder(GAME_DIR, "..\\Other\\x.exe").ok, false);
  assert.equal(resolveExecutableWithinFolder(GAME_DIR, OUTSIDE_EXE).ok, false);
  assert.equal(resolveExecutableWithinFolder(GAME_DIR, "").ok, false);
  assert.equal(resolveExecutableWithinFolder("", "game.exe").ok, false);
  assert.equal(resolveExecutableWithinFolder(GAME_DIR, GAME_DIR).ok, false, "the folder itself is not an executable");
});

test("listGameExecutables returns relative candidates or a clear error for a missing folder", () => {
  const found = listGameExecutables({
    gamePath: GAME_DIR,
    gameExtensions: ["exe"],
    pathExists: existsIn([GAME_DIR]),
    findExecutables: (dir, extensions) => {
      assert.equal(dir, GAME_DIR);
      assert.deepEqual(extensions, ["exe"]);
      return ["Game.exe", path.join("lib", "helper.exe")];
    },
  });
  assert.deepEqual(found, {
    success: true,
    executables: ["Game.exe", path.join("lib", "helper.exe")],
  });

  const missing = listGameExecutables({
    gamePath: GAME_DIR,
    gameExtensions: ["exe"],
    pathExists: existsIn([]),
    findExecutables: () => {
      throw new Error("should not be called");
    },
  });
  assert.equal(missing.success, false);
  assert.equal(missing.code, "FOLDER_MISSING");
});

test("relocateGameVersion moves the version to the new folder and picks the preferred executable", async () => {
  const calls = [];
  const newPath = path.join(MOVED_DIR, "Sample");
  const result = await relocateGameVersion({
    recordId: 7,
    version: "0.5",
    oldPath: GAME_DIR,
    newPath,
    title: "Sample",
    creator: "Dev",
    gameExtensions: ["exe"],
    pathExists: existsIn([newPath]),
    findExecutables: () => ["renpy.exe", "Sample.exe"],
    selectPreferredExecutable: (executables, hints) => {
      assert.deepEqual(hints, { title: "Sample", creator: "Dev" });
      return "Sample.exe";
    },
    otherGamePaths: [],
    updateVersionLocation: async (...args) => {
      calls.push(args);
      return 1;
    },
  });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.gamePath, newPath);
  assert.equal(result.execPath, path.join(newPath, "Sample.exe"));
  assert.equal(result.executable, "Sample.exe");
  assert.deepEqual(result.executables, ["renpy.exe", "Sample.exe"]);
  assert.deepEqual(calls, [[7, "0.5", newPath, path.join(newPath, "Sample.exe")]]);
});

test("relocateGameVersion refuses missing folders and folders that belong to another game", async () => {
  const other = OTHER_GAME_DIR;
  const base = {
    recordId: 7,
    version: "0.5",
    oldPath: GAME_DIR,
    gameExtensions: ["exe"],
    findExecutables: () => ["a.exe"],
    selectPreferredExecutable: (list) => list[0],
    updateVersionLocation: async () => 1,
  };

  const missing = await relocateGameVersion({ ...base, newPath: other, pathExists: existsIn([]), otherGamePaths: [] });
  assert.equal(missing.success, false);
  assert.equal(missing.code, "FOLDER_MISSING");

  const inUse = await relocateGameVersion({
    ...base,
    newPath: other,
    pathExists: existsIn([other]),
    otherGamePaths: [respelled(other)],
  });
  assert.equal(inUse.success, false);
  assert.equal(inUse.code, "FOLDER_IN_USE");

  const empty = await relocateGameVersion({ ...base, newPath: "", pathExists: existsIn([]), otherGamePaths: [] });
  assert.equal(empty.success, false);
  assert.equal(empty.code, "FOLDER_MISSING");
});

test("relocateGameVersion keeps the version without an executable when none is found", async () => {
  const newPath = path.join(MOVED_DIR, "NoExe");
  let stored = null;
  const result = await relocateGameVersion({
    recordId: 3,
    version: "1.0",
    oldPath: GAME_DIR,
    newPath,
    gameExtensions: ["exe"],
    pathExists: existsIn([newPath]),
    findExecutables: () => [],
    selectPreferredExecutable: () => "",
    otherGamePaths: [],
    updateVersionLocation: async (recordId, version, gamePath, execPath) => {
      stored = { recordId, version, gamePath, execPath };
      return 1;
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.execPath, "");
  assert.deepEqual(result.executables, []);
  assert.deepEqual(stored, { recordId: 3, version: "1.0", gamePath: newPath, execPath: "" });
});

test("relocateGameVersion reports a failed database update instead of throwing", async () => {
  const newPath = path.join(MOVED_DIR, "Sample");
  const result = await relocateGameVersion({
    recordId: 7,
    version: "0.5",
    oldPath: GAME_DIR,
    newPath,
    gameExtensions: ["exe"],
    pathExists: existsIn([newPath]),
    findExecutables: () => ["a.exe"],
    selectPreferredExecutable: (list) => list[0],
    otherGamePaths: [],
    updateVersionLocation: async () => {
      throw new Error("locked");
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.code, "UPDATE_FAILED");
});

test("setGameExecutable stores the absolute path of a file inside the game folder", async () => {
  const exe = path.join(GAME_DIR, "bin", "Sample.exe");
  let stored = null;
  const result = await setGameExecutable({
    recordId: 9,
    version: "2.0",
    gamePath: GAME_DIR,
    executable: path.join("bin", "Sample.exe"),
    pathExists: existsIn([GAME_DIR, exe]),
    updateVersionExecutable: async (recordId, version, execPath) => {
      stored = { recordId, version, execPath };
      return 1;
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.execPath, exe);
  assert.equal(result.executable, path.join("bin", "Sample.exe"));
  assert.deepEqual(stored, { recordId: 9, version: "2.0", execPath: exe });
});

test("setGameExecutable rejects files outside the folder or missing on disk", async () => {
  const outside = await setGameExecutable({
    recordId: 9,
    version: "2.0",
    gamePath: GAME_DIR,
    executable: OUTSIDE_EXE,
    pathExists: existsIn([GAME_DIR, OUTSIDE_EXE]),
    updateVersionExecutable: async () => 1,
  });
  assert.equal(outside.success, false);
  assert.equal(outside.code, "EXECUTABLE_OUTSIDE_FOLDER");

  const missing = await setGameExecutable({
    recordId: 9,
    version: "2.0",
    gamePath: GAME_DIR,
    executable: "Sample.exe",
    pathExists: existsIn([GAME_DIR]),
    updateVersionExecutable: async () => 1,
  });
  assert.equal(missing.success, false);
  assert.equal(missing.code, "EXECUTABLE_MISSING");
});
