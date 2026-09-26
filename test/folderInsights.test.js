const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  classifyFolderWarnings,
  detectGameFolders,
  inspectFolder,
  inspectScanFolder,
  looksLikeGameEntries,
  suggestLibraryFolders,
} = require("../src/main/folderInsights");

const GIB = 1024 ** 3;

function makeTempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "folder-insights-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "");
}

const codes = (warnings) => warnings.map((warning) => warning.code).sort();

test("classifyFolderWarnings accepts a normal writable folder", () => {
  const warnings = classifyFolderWarnings(
    {
      targetPath: "D:\\Games\\F95Launcher",
      exists: true,
      writable: true,
      freeBytes: 500 * GIB,
    },
    { platform: "win32" },
  );

  assert.deepEqual(warnings, []);
});

test("classifyFolderWarnings flags risky Windows locations", () => {
  assert.deepEqual(
    codes(
      classifyFolderWarnings(
        {
          targetPath: "C:\\Program Files\\Games",
          exists: true,
          writable: false,
          freeBytes: 5 * GIB,
        },
        { platform: "win32" },
      ),
    ),
    ["low_space", "not_writable", "protected_location"],
  );

  assert.deepEqual(
    codes(
      classifyFolderWarnings(
        {
          targetPath: "C:\\Users\\sam\\OneDrive - Personal\\Games",
          exists: true,
          writable: true,
          freeBytes: 200 * GIB,
        },
        { platform: "win32" },
      ),
    ),
    ["cloud_synced"],
  );

  assert.deepEqual(
    codes(
      classifyFolderWarnings(
        {
          targetPath: "C:\\Apps\\F95Launcher\\games",
          exists: true,
          writable: true,
          freeBytes: 200 * GIB,
        },
        { platform: "win32", appRoot: "C:\\Apps\\F95Launcher" },
      ),
    ),
    ["inside_app_folder"],
  );
});

test("classifyFolderWarnings suggests a subfolder instead of a bare drive", () => {
  const [warning] = classifyFolderWarnings(
    { targetPath: "E:\\", exists: true, writable: true, freeBytes: 900 * GIB },
    { platform: "win32" },
  );

  assert.equal(warning.code, "drive_root");
  assert.equal(warning.level, "info");
  assert.equal(warning.suggestedPath, "E:\\Games\\F95Launcher");
});

test("inspectFolder reports a missing folder that will be created", async (t) => {
  const root = makeTempDir(t);
  const target = path.join(root, "new", "library");

  const insight = await inspectFolder(target, { appRoot: "/nonexistent-app" });

  assert.equal(insight.exists, false);
  assert.equal(insight.writable, true);
  assert.equal(typeof insight.freeBytes, "number");
  assert.ok(["ok", "warning"].includes(insight.status));
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(
    fs.readdirSync(root).filter((name) => name.startsWith(".f95launcher")),
    [],
  );
});

test("inspectFolder rejects relative or empty paths", async () => {
  const insight = await inspectFolder("games");

  assert.equal(insight.status, "error");
  assert.equal(insight.warnings[0].code, "invalid_path");
});

test("looksLikeGameEntries recognizes executables and engine folders but not helpers", () => {
  const entry = (name, kind) => ({
    name,
    isDirectory: () => kind === "dir",
    isFile: () => kind === "file",
  });

  assert.equal(looksLikeGameEntries([entry("Game.exe", "file")]), true);
  assert.equal(looksLikeGameEntries([entry("renpy", "dir")]), true);
  assert.equal(looksLikeGameEntries([entry("www", "dir")]), true);
  assert.equal(
    looksLikeGameEntries([
      entry("unins000.exe", "file"),
      entry("UnityCrashHandler64.exe", "file"),
      entry("game", "dir"),
    ]),
    false,
  );
});

test("detectGameFolders finds folders that already hold games", async (t) => {
  const home = makeTempDir(t);
  touch(path.join(home, "Downloads", "Summer Nights", "SummerNights.exe"));
  touch(path.join(home, "Downloads", "Tale", "renpy", "__init__.py"));
  touch(path.join(home, "Downloads", "notes", "readme.txt"));
  touch(path.join(home, "Games", "Other", "Game.exe"));
  touch(path.join(home, "Desktop", "shortcut.txt"));

  const folders = await detectGameFolders({
    platform: process.platform === "win32" ? "win32" : "linux",
    homeDir: home,
    drives: [],
    existingSources: [path.join(home, "Games")],
  });

  assert.deepEqual(
    folders.map((folder) => [
      path.basename(folder.path),
      folder.gameCount,
      folder.alreadyAdded,
    ]),
    [
      ["Downloads", 2, false],
      ["Games", 1, true],
    ],
  );
});

test("suggestLibraryFolders prefers a roomy second drive on Windows", async () => {
  const suggestions = await suggestLibraryFolders({
    platform: "win32",
    homeDir: "C:\\Users\\sam",
    drives: [
      {
        root: "C:\\",
        letter: "C",
        isSystem: true,
        freeBytes: 40 * GIB,
        totalBytes: 250 * GIB,
      },
      {
        root: "D:\\",
        letter: "D",
        isSystem: false,
        freeBytes: 800 * GIB,
        totalBytes: 1000 * GIB,
      },
      {
        root: "E:\\",
        letter: "E",
        isSystem: false,
        freeBytes: 5 * GIB,
        totalBytes: 60 * GIB,
      },
    ],
  });

  assert.deepEqual(
    suggestions.map((suggestion) => [suggestion.path, suggestion.recommended]),
    [
      ["D:\\Games\\F95Launcher", true],
      ["C:\\Users\\sam\\Games\\F95Launcher", false],
    ],
  );
});

test("suggestLibraryFolders keeps the current folder first without recommending it", async () => {
  const suggestions = await suggestLibraryFolders({
    platform: "win32",
    homeDir: "C:\\Users\\sam",
    currentFolder: "F:\\MyGames",
    drives: [
      {
        root: "C:\\",
        letter: "C",
        isSystem: true,
        freeBytes: 40 * GIB,
        totalBytes: 250 * GIB,
      },
    ],
  });

  assert.deepEqual(
    suggestions.map((suggestion) => [
      suggestion.path,
      Boolean(suggestion.isCurrent),
      suggestion.recommended,
    ]),
    [
      ["F:\\MyGames", true, false],
      ["C:\\Users\\sam\\Games\\F95Launcher", false, true],
    ],
  );
});

test("inspectScanFolder only checks that a scanned folder still exists", async (t) => {
  const root = makeTempDir(t);

  const present = await inspectScanFolder(root);
  const missing = await inspectScanFolder(path.join(root, "unplugged"));

  assert.equal(present.status, "ok");
  assert.equal(missing.status, "error");
  assert.equal(missing.warnings[0].code, "missing");
});
