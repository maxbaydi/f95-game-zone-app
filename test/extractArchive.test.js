const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");

const {
  extractArchiveSafely,
  isUnsafeArchiveEntryName,
  listArchiveEntries,
  normalizeArchiveEntryName,
  validateArchiveEntries,
} = require("../src/main/archive/extractArchive");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-archive-test-"));
}

test("archive path validation blocks traversal and absolute entry names", () => {
  assert.equal(
    normalizeArchiveEntryName("./game/script.rpyc"),
    "game/script.rpyc",
  );
  assert.equal(isUnsafeArchiveEntryName("../evil.txt"), true);
  assert.equal(isUnsafeArchiveEntryName("C:/evil.txt"), true);
  assert.equal(isUnsafeArchiveEntryName("/evil.txt"), true);
  assert.equal(isUnsafeArchiveEntryName("game/../evil.txt"), true);
  assert.equal(isUnsafeArchiveEntryName("game/content.txt"), false);

  const validation = validateArchiveEntries([
    "game/content.txt",
    "../evil.txt",
  ]);

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.invalidEntries, ["../evil.txt"]);
});

test("extractArchiveSafely extracts a normal zip archive", async () => {
  const tempDir = makeTempDir();
  const archivePath = path.join(tempDir, "game.zip");
  const destinationPath = path.join(tempDir, "out");
  const archive = new AdmZip();

  archive.addFile("game/readme.txt", Buffer.from("hello", "utf8"));
  archive.writeZip(archivePath);

  const result = await extractArchiveSafely({
    archivePath,
    destinationPath,
  });

  assert.equal(result.success, true);
  assert.equal(
    fs.readFileSync(path.join(destinationPath, "game", "readme.txt"), "utf8"),
    "hello",
  );
});

test("extractArchiveSafely rejects unsupported archive formats", async () => {
  const tempDir = makeTempDir();
  const archivePath = path.join(tempDir, "unsafe.txt");
  const destinationPath = path.join(tempDir, "out");

  fs.writeFileSync(archivePath, "bad", "utf8");

  await assert.rejects(
    () =>
      extractArchiveSafely({
        archivePath,
        destinationPath,
      }),
    /unsupported archive format/i,
  );
});

test("listArchiveEntries reads 7z entries using bundled binary", async (t) => {
  const archivePath = path.join(
    __dirname,
    "..",
    "node_modules",
    "node-7z",
    "test",
    "zip.7z",
  );

  if (!fs.existsSync(archivePath)) {
    t.skip("node-7z 7z fixture is not available in this environment");
    return;
  }

  const entries = await listArchiveEntries(archivePath);

  assert.equal(
    entries.some((entry) => entry.replace(/\\/g, "/") === "zip/file1.txt"),
    true,
  );
});

test("extractArchiveSafely extracts a 7z archive with bundled 7-Zip", async (t) => {
  const archivePath = path.join(
    __dirname,
    "..",
    "node_modules",
    "node-7z",
    "test",
    "zip.7z",
  );

  if (!fs.existsSync(archivePath)) {
    t.skip("node-7z 7z fixture is not available in this environment");
    return;
  }

  const tempDir = makeTempDir();
  const destinationPath = path.join(tempDir, "out");

  const result = await extractArchiveSafely({
    archivePath,
    destinationPath,
  });

  assert.equal(result.success, true);
  assert.equal(
    fs.existsSync(path.join(destinationPath, "zip", "file1.txt")),
    true,
  );
});
