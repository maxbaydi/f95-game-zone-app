const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");
const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const { saveDownloadedPackage } = require("../src/main/f95/savedPackages");
const { stageManualPackage } = require("../src/main/f95/manualInstall");
const {
  createDownloadsStore,
  MAX_HISTORY_ITEMS,
} = require("../src/main/f95/downloadsStore");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f95-saved-packages-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = buildAppPaths(root);
  ensureAppDirs(paths);
  const zip = new AdmZip();
  zip.addFile("Game.exe", Buffer.from("original game bytes"));
  zip.addFile("game/content.txt", Buffer.from("content"));
  const bytes = zip.toBuffer();
  const options = {
    archivesDir: paths.archives,
    archiveExtensions: ["zip", "rar", "7z"],
    gameExtensions: ["exe"],
  };
  return { paths, bytes, options };
}

test("saved packages remain byte-for-byte original, without extraction, after restart and history cleanup", async (t) => {
  const { paths, bytes, options } = fixture(t);
  const filePath = path.join(paths.downloads, "Game.zip");
  fs.writeFileSync(filePath, bytes);
  const saved = await saveDownloadedPackage({ ...options, filePath });
  assert.deepEqual(fs.readFileSync(saved.packagePath), bytes);
  assert.equal(fs.existsSync(filePath), false);
  assert.deepEqual(fs.readdirSync(paths.games), []);
  assert.deepEqual(fs.readdirSync(paths.archives), ["Game.zip"]);

  // Give each history transition a distinct time: trimming equal millisecond
  // timestamps does not promise which tied entry is evicted.
  let timestamp = 1_700_000_000_000;
  t.mock.method(Date, "now", () => timestamp++);
  const store = createDownloadsStore();
  store.resolving({ id: "saved", title: "Game", keepArchive: true });
  store.complete("saved", {
    ...saved,
    completionKind: "archive",
    savedArchivePath: saved.packagePath,
  });
  const restored = createDownloadsStore();
  restored.hydrate(JSON.parse(JSON.stringify(store.list())), (candidate) =>
    fs.existsSync(candidate),
  );
  assert.equal(restored.get("saved").canInstallFromPackage, true);
  assert.equal(restored.get("saved").canRetry, false);
  assert.equal(restored.get("saved").keepArchive, true);
  restored.clearHistory();
  assert.deepEqual(fs.readFileSync(saved.packagePath), bytes);
  // Automatic history trimming also leaves the persistent original alone.
  for (let index = 0; index <= MAX_HISTORY_ITEMS; index += 1)
    store.complete(`other-${index}`, {});
  assert.equal(store.get("saved"), null);
  assert.deepEqual(fs.readFileSync(saved.packagePath), bytes);
});

test("concurrent same-name downloads never overwrite earlier saved archives", async (t) => {
  const { paths, bytes, options } = fixture(t);
  fs.writeFileSync(path.join(paths.archives, "Game.zip"), "older archive");
  const firstPath = path.join(paths.downloads, "a", "Game.zip");
  const secondPath = path.join(paths.downloads, "b", "Game.zip");
  for (const filePath of [firstPath, secondPath]) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
  }
  const saved = await Promise.all(
    [firstPath, secondPath].map((filePath) =>
      saveDownloadedPackage({ ...options, filePath }),
    ),
  );
  assert.notEqual(saved[0].packagePath, saved[1].packagePath);
  assert.equal(
    fs.readFileSync(path.join(paths.archives, "Game.zip"), "utf8"),
    "older archive",
  );
  for (const item of saved)
    assert.deepEqual(fs.readFileSync(item.packagePath), bytes);
});

test("anonymous download names gain the detected archive extension", async (t) => {
  const { paths, bytes, options } = fixture(t);
  const filePath = path.join(paths.downloads, "download.bin");
  fs.writeFileSync(filePath, bytes);
  const saved = await saveDownloadedPackage({ ...options, filePath });
  assert.equal(saved.fileName, "download.bin.zip");
  assert.deepEqual(fs.readFileSync(saved.packagePath), bytes);
});

test("empty files and HTML error pages named zip are refused before publication", async (t) => {
  const { paths, options } = fixture(t);
  for (const [name, body, code] of [
    ["empty.zip", "", "empty_download"],
    ["error.zip", "<!doctype html><html>access denied</html>", "html_payload"],
  ]) {
    const filePath = path.join(paths.downloads, name);
    fs.writeFileSync(filePath, body);
    await assert.rejects(
      saveDownloadedPackage({ ...options, filePath }),
      (error) =>
        Boolean(
          error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === code,
        ),
    );
    assert.equal(
      fs.existsSync(filePath),
      true,
      "failed validation keeps the source for the caller to handle",
    );
  }
  assert.deepEqual(fs.readdirSync(paths.archives), []);
});

test("a later installation stages a disposable copy and preserves the saved original", async (t) => {
  const { paths, bytes, options } = fixture(t);
  const filePath = path.join(paths.downloads, "Game.zip");
  fs.writeFileSync(filePath, bytes);
  const saved = await saveDownloadedPackage({ ...options, filePath });
  const staged = await stageManualPackage({
    sourcePath: saved.packagePath,
    downloadsDir: paths.downloads,
    reservePath: (candidate) => candidate,
    keepOriginal: true,
  });
  const zip = new AdmZip(staged.targetPath);
  zip.extractAllTo(paths.games);
  fs.unlinkSync(staged.targetPath);
  assert.equal(
    fs.readFileSync(path.join(paths.games, "Game.exe"), "utf8"),
    "original game bytes",
  );
  assert.deepEqual(fs.readFileSync(saved.packagePath), bytes);
});
