const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");

const {
  extractArchiveSafely,
  isUnsafeArchiveEntryName,
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
