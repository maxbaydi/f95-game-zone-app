const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const AdmZip = require("adm-zip");
const sevenZipBin = require("7zip-bin");

const {
  ARCHIVE_ERROR_CODES,
  classifyToolOutput,
  detectArchiveFormatFromBuffer,
  detectArchiveFormatFromName,
  extractArchiveSafely,
  inspectArchive,
  inspectArchiveVolumes,
  isSupportedArchiveName,
  isUnsafeArchiveEntryName,
  listArchiveEntries,
  mapFsError,
  normalizeArchiveEntryName,
  parse7zListing,
  validateArchiveEntries,
} = require("../src/main/archive/extractArchive");

const FIXTURES = path.join(__dirname, "fixtures", "archives");

/** @param {unknown} error */
const codeOf = (error) => /** @type {any} */ (error)?.code;
/** @param {unknown} error */
const messageOf = (error) => String(/** @type {any} */ (error)?.message || "");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "app-archive-test-"));
}

function bundled7zAvailable() {
  const binary = sevenZipBin.path7za;
  if (!binary || !fs.existsSync(binary)) {
    return false;
  }
  try {
    fs.accessSync(binary, fs.constants.X_OK);
    return true;
  } catch {
    try {
      fs.chmodSync(binary, 0o755);
      return true;
    } catch {
      return false;
    }
  }
}

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out.push(path.relative(root, full).replace(/\\/g, "/"));
      }
    }
  };
  walk(root);
  return out.sort();
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

test("archive formats are detected from magic bytes and from file names", () => {
  assert.equal(detectArchiveFormatFromBuffer(Buffer.from("PK\u0003\u0004rest")), "zip");
  assert.equal(
    detectArchiveFormatFromBuffer(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0])),
    "7z",
  );
  assert.equal(
    detectArchiveFormatFromBuffer(Buffer.from("Rar!\u001a\u0007\u0001\u0000")),
    "rar",
  );
  assert.equal(detectArchiveFormatFromBuffer(Buffer.from([0x1f, 0x8b, 0x08, 0])), "gzip");
  assert.equal(detectArchiveFormatFromBuffer(Buffer.from("BZh91AY")), "bzip2");
  assert.equal(detectArchiveFormatFromBuffer(Buffer.from("plain text")), "");

  assert.equal(detectArchiveFormatFromName("Game-1.0.tar.gz"), "gzip");
  assert.equal(detectArchiveFormatFromName("Game.tgz"), "gzip");
  assert.equal(detectArchiveFormatFromName("Game.7z.001"), "7z");
  assert.equal(detectArchiveFormatFromName("Game.part1.rar"), "rar");
  assert.equal(detectArchiveFormatFromName("Game.apk"), "zip");
  assert.equal(detectArchiveFormatFromName("Game.exe"), "");
  assert.equal(isSupportedArchiveName("Game.tar.xz"), true);
  assert.equal(isSupportedArchiveName("Game.exe"), false);
});

test("multi-part archives are recognised and missing parts are reported", () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "Game.part1.rar"), "x");
  fs.writeFileSync(path.join(dir, "Game.part3.rar"), "x");
  const rar = inspectArchiveVolumes(path.join(dir, "Game.part1.rar"));
  assert.equal(rar.isMultipart, true);
  assert.equal(rar.role, "first");
  assert.deepEqual(rar.missingVolumes, ["Game.part2.rar"]);

  fs.writeFileSync(path.join(dir, "Big.7z.001"), "x");
  fs.writeFileSync(path.join(dir, "Big.7z.002"), "x");
  const split = inspectArchiveVolumes(path.join(dir, "Big.7z.001"));
  assert.equal(split.isMultipart, true);
  assert.deepEqual(split.missingVolumes, []);
  assert.equal(inspectArchiveVolumes(path.join(dir, "Big.7z.002")).role, "other");

  fs.writeFileSync(path.join(dir, "Plain.zip"), "x");
  assert.equal(inspectArchiveVolumes(path.join(dir, "Plain.zip")).isMultipart, false);
  fs.writeFileSync(path.join(dir, "Plain.z01"), "x");
  assert.equal(inspectArchiveVolumes(path.join(dir, "Plain.zip")).isMultipart, true);
});

test("tool output is mapped onto archive error codes", () => {
  const encrypted = classifyToolOutput("ERROR: Wrong password? : game.zip", { tool: "7-Zip" });
  assert.equal(encrypted.code, ARCHIVE_ERROR_CODES.ENCRYPTED);
  const wrong = classifyToolOutput("ERROR: Wrong password? : game.zip", {
    tool: "7-Zip",
    password: "abc",
  });
  assert.equal(wrong.code, ARCHIVE_ERROR_CODES.WRONG_PASSWORD);
  assert.equal(
    classifyToolOutput("ERROR: Data Error : game/file.bin\nUnexpected end of archive", { tool: "7-Zip" }).code,
    ARCHIVE_ERROR_CODES.INCOMPLETE,
  );
  assert.equal(
    classifyToolOutput("ERROR: CRC Failed : game/file.bin", { tool: "7-Zip" }).code,
    ARCHIVE_ERROR_CODES.CORRUPT,
  );
  assert.equal(
    classifyToolOutput("ERROR: There is not enough space on the disk.", { tool: "7-Zip" }).code,
    ARCHIVE_ERROR_CODES.DISK_FULL,
  );
  assert.equal(
    classifyToolOutput("ERROR: Missing volume : game.part2.rar", { tool: "7-Zip" }).code,
    ARCHIVE_ERROR_CODES.MISSING_VOLUME,
  );
  assert.equal(
    classifyToolOutput("The process cannot access the file because it is being used by another process.", { tool: "7-Zip" }).code,
    ARCHIVE_ERROR_CODES.FILE_LOCKED,
  );
  assert.equal(classifyToolOutput("", { tool: "7-Zip", exitCode: 2 }).code, ARCHIVE_ERROR_CODES.EXTRACT_FAILED);

  assert.equal(mapFsError({ code: "ENOSPC", message: "no space" }, "fs").code, ARCHIVE_ERROR_CODES.DISK_FULL);
  assert.equal(mapFsError({ code: "EBUSY", message: "busy" }, "fs").code, ARCHIVE_ERROR_CODES.FILE_LOCKED);
  assert.equal(mapFsError({ code: "ENAMETOOLONG", message: "long" }, "fs").code, ARCHIVE_ERROR_CODES.PATH_TOO_LONG);
  assert.equal(mapFsError({ code: "ENOENT", message: "gone" }, "fs").code, ARCHIVE_ERROR_CODES.ARCHIVE_NOT_FOUND);
});

test("7-Zip technical listings are parsed into entries", () => {
  const listing = [
    "Path = game",
    "Folder = +",
    "Size = 0",
    "Attributes = D",
    "",
    "Path = game\\script.rpy",
    "Size = 12",
    "Attributes = A",
    "Encrypted = +",
    "",
  ].join("\n");
  const entries = parse7zListing(listing);
  assert.deepEqual(entries, [
    { name: "game", size: 0, directory: true, encrypted: false },
    { name: "game/script.rpy", size: 12, directory: false, encrypted: true },
  ]);
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
  assert.equal(result.format, "zip");
  assert.equal(
    fs.readFileSync(path.join(destinationPath, "game", "readme.txt"), "utf8"),
    "hello",
  );
});

/**
 * adm-zip and 7-Zip both normalise "../" away when writing, so the traversal
 * archive is assembled by hand: one stored entry, central directory, EOCD.
 */
function writeStoredZip(archivePath, entryName, content) {
  const name = Buffer.from(entryName, "utf8");
  const data = Buffer.from(content, "utf8");
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 10);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 12);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + name.length + data.length;
  const centralSize = central.length + name.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  fs.writeFileSync(
    archivePath,
    Buffer.concat([local, name, data, central, name, eocd]),
  );
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("extractArchiveSafely refuses archives with unsafe entry names", async () => {
  const tempDir = makeTempDir();
  const archivePath = path.join(tempDir, "evil.zip");
  writeStoredZip(archivePath, "../evil.txt", "x");
  assert.deepEqual(await listArchiveEntries(archivePath), ["../evil.txt"]);

  await assert.rejects(
    () => extractArchiveSafely({ archivePath, destinationPath: path.join(tempDir, "out") }),
    (error) => codeOf(error) === ARCHIVE_ERROR_CODES.UNSAFE_PATHS,
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
    (error) =>
      /unsupported archive format/i.test(messageOf(error)) &&
      codeOf(error) === ARCHIVE_ERROR_CODES.UNSUPPORTED_FORMAT,
  );
});

test("extractArchiveSafely reports a missing archive", async () => {
  const tempDir = makeTempDir();
  await assert.rejects(
    () =>
      extractArchiveSafely({
        archivePath: path.join(tempDir, "missing.zip"),
        destinationPath: path.join(tempDir, "out"),
      }),
    (error) => codeOf(error) === ARCHIVE_ERROR_CODES.ARCHIVE_NOT_FOUND,
  );
});

test("a truncated zip is reported as damaged, not as an unknown error", async (t) => {
  if (!bundled7zAvailable()) {
    t.skip("bundled 7-Zip is not runnable here");
    return;
  }
  const tempDir = makeTempDir();
  const archivePath = path.join(tempDir, "game.zip");
  const archive = new AdmZip();
  archive.addFile("game/big.bin", Buffer.alloc(200000, 7));
  archive.writeZip(archivePath);
  const bytes = fs.readFileSync(archivePath);
  fs.writeFileSync(archivePath, bytes.subarray(0, Math.floor(bytes.length / 2)));

  await assert.rejects(
    () => extractArchiveSafely({ archivePath, destinationPath: path.join(tempDir, "out") }),
    (error) =>
      [ARCHIVE_ERROR_CODES.CORRUPT, ARCHIVE_ERROR_CODES.INCOMPLETE].includes(codeOf(error)),
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

  if (!fs.existsSync(archivePath) || !bundled7zAvailable()) {
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

  if (!fs.existsSync(archivePath) || !bundled7zAvailable()) {
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
  assert.equal(result.format, "7z");
  assert.equal(
    fs.existsSync(path.join(destinationPath, "zip", "file1.txt")),
    true,
  );
});

test("password-protected 7z archives ask for a password and accept the right one", async (t) => {
  if (!bundled7zAvailable()) {
    t.skip("bundled 7-Zip is not runnable here");
    return;
  }
  const tempDir = makeTempDir();
  const sourceDir = path.join(tempDir, "src");
  fs.mkdirSync(path.join(sourceDir, "game"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "game", "script.rpy"), "label start:\n");
  const archivePath = path.join(tempDir, "secret.7z");
  cp.execFileSync(sevenZipBin.path7za, ["a", "-psecret", "-mhe=on", archivePath, "game"], {
    cwd: sourceDir,
    stdio: "ignore",
  });

  await assert.rejects(
    () => extractArchiveSafely({ archivePath, destinationPath: path.join(tempDir, "out1") }),
    (error) => codeOf(error) === ARCHIVE_ERROR_CODES.ENCRYPTED,
  );
  await assert.rejects(
    () =>
      extractArchiveSafely({
        archivePath,
        destinationPath: path.join(tempDir, "out2"),
        password: "wrong",
      }),
    (error) => codeOf(error) === ARCHIVE_ERROR_CODES.WRONG_PASSWORD,
  );
  const result = await extractArchiveSafely({
    archivePath,
    destinationPath: path.join(tempDir, "out3"),
    password: "secret",
  });
  assert.equal(result.success, true);
  assert.equal(result.encrypted, true);
  assert.deepEqual(listFiles(path.join(tempDir, "out3")), ["game/script.rpy"]);
});

test("zip archives with encrypted entries are reported as password-protected", async (t) => {
  if (!bundled7zAvailable()) {
    t.skip("bundled 7-Zip is not runnable here");
    return;
  }
  const tempDir = makeTempDir();
  const sourceDir = path.join(tempDir, "src");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "game.exe"), "MZ");
  const archivePath = path.join(tempDir, "secret.zip");
  cp.execFileSync(sevenZipBin.path7za, ["a", "-ppass", "-tzip", archivePath, "game.exe"], {
    cwd: sourceDir,
    stdio: "ignore",
  });

  const inspection = await inspectArchive(archivePath);
  assert.equal(inspection.encrypted, true);
  await assert.rejects(
    () => extractArchiveSafely({ archivePath, destinationPath: path.join(tempDir, "out") }),
    (error) => codeOf(error) === ARCHIVE_ERROR_CODES.ENCRYPTED,
  );
  const result = await extractArchiveSafely({
    archivePath,
    destinationPath: path.join(tempDir, "out2"),
    password: "pass",
  });
  assert.equal(result.success, true);
  assert.deepEqual(listFiles(path.join(tempDir, "out2")), ["game.exe"]);
});

test("tar.gz packages are unpacked in two passes", async (t) => {
  if (!bundled7zAvailable()) {
    t.skip("bundled 7-Zip is not runnable here");
    return;
  }
  const tempDir = makeTempDir();
  const sourceDir = path.join(tempDir, "src");
  fs.mkdirSync(path.join(sourceDir, "Game", "lib"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "Game", "Game.sh"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(sourceDir, "Game", "lib", "a.so"), "so");
  const tarPath = path.join(tempDir, "Game.tar");
  cp.execFileSync(sevenZipBin.path7za, ["a", "-ttar", tarPath, "Game"], {
    cwd: sourceDir,
    stdio: "ignore",
  });
  const archivePath = path.join(tempDir, "Game.tar.gz");
  cp.execFileSync(sevenZipBin.path7za, ["a", "-tgzip", archivePath, tarPath], {
    stdio: "ignore",
  });

  const result = await extractArchiveSafely({
    archivePath,
    destinationPath: path.join(tempDir, "out"),
  });
  assert.equal(result.success, true);
  assert.equal(result.format, "gzip");
  assert.deepEqual(listFiles(path.join(tempDir, "out")), ["Game/Game.sh", "Game/lib/a.so"]);
});

test("RAR archives are unpacked with the bundled unrar (no system tool needed)", async () => {
  const tempDir = makeTempDir();
  const destinationPath = path.join(tempDir, "out");
  const result = await extractArchiveSafely({
    archivePath: path.join(FIXTURES, "FolderTest.rar"),
    destinationPath,
    toolCandidates: [],
  });
  assert.equal(result.success, true);
  assert.equal(result.format, "rar");
  assert.equal(result.tool, "unrar");
  assert.deepEqual(listFiles(destinationPath), [
    "Folder1/Folder Space/long.txt",
    "Folder1/Folder 中文/2中文.txt",
  ]);
});

test("RAR archives with encrypted headers need the password and accept it", async () => {
  const tempDir = makeTempDir();
  const archivePath = path.join(FIXTURES, "HeaderEnc1234.rar");

  await assert.rejects(
    () =>
      extractArchiveSafely({
        archivePath,
        destinationPath: path.join(tempDir, "out1"),
        toolCandidates: [],
      }),
    (error) => codeOf(error) === ARCHIVE_ERROR_CODES.ENCRYPTED,
  );
  await assert.rejects(
    () =>
      extractArchiveSafely({
        archivePath,
        destinationPath: path.join(tempDir, "out2"),
        password: "wrong",
        toolCandidates: [],
      }),
    (error) => codeOf(error) === ARCHIVE_ERROR_CODES.WRONG_PASSWORD,
  );
  const result = await extractArchiveSafely({
    archivePath,
    destinationPath: path.join(tempDir, "out3"),
    password: "1234",
    toolCandidates: [],
  });
  assert.equal(result.success, true);
  assert.deepEqual(listFiles(path.join(tempDir, "out3")), ["1File.txt", "2中文.txt"]);
});

test("RAR archives with encrypted entries are reported before anything is written", async () => {
  const tempDir = makeTempDir();
  const destinationPath = path.join(tempDir, "out");
  await assert.rejects(
    () =>
      extractArchiveSafely({
        archivePath: path.join(FIXTURES, "FileEncByName.rar"),
        destinationPath,
        toolCandidates: [],
      }),
    (error) => codeOf(error) === ARCHIVE_ERROR_CODES.ENCRYPTED,
  );
  assert.equal(fs.existsSync(destinationPath), false);
});

test("a RAR whose parts are missing is refused with the list of missing parts", async () => {
  const tempDir = makeTempDir();
  const first = path.join(tempDir, "Game.part1.rar");
  fs.copyFileSync(path.join(FIXTURES, "FolderTest.rar"), first);
  fs.writeFileSync(path.join(tempDir, "Game.part3.rar"), "x");
  await assert.rejects(
    () => extractArchiveSafely({ archivePath: first, destinationPath: path.join(tempDir, "out") }),
    (error) => codeOf(error) === ARCHIVE_ERROR_CODES.MISSING_VOLUME &&
      /Game\.part2\.rar/.test(messageOf(error)),
  );
});
