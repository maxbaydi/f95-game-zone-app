/**
 * Fallback for mirrors whose download cannot finish inside the embedded
 * browser (Cloudflare Turnstile answers error 600010 in Electron windows,
 * Adscore flags them): the user downloads in their own browser and hands the
 * file to the app. The helper moves the file into the downloads folder
 * without ever deleting the user's copy on failure.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  describeManualPackageError,
  inspectManualPackage,
  isLikelyInstallPackage,
  stageManualPackage,
} = require("../src/main/f95/manualInstall");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("isLikelyInstallPackage accepts archives and standalone installers only", () => {
  assert.equal(isLikelyInstallPackage("Game-v1.zip"), true);
  assert.equal(isLikelyInstallPackage("Game.part1.rar"), true);
  assert.equal(isLikelyInstallPackage("Setup.exe"), true);
  assert.equal(isLikelyInstallPackage("game.apk"), true);
  assert.equal(isLikelyInstallPackage("readme.txt"), false);
  assert.equal(isLikelyInstallPackage("Game.zip.crdownload"), false, "unfinished Chrome download");
  assert.equal(isLikelyInstallPackage("Game.zip.part"), false, "unfinished Firefox download");
  assert.equal(isLikelyInstallPackage(""), false);
});

test("stageManualPackage moves the file into the downloads folder and reports it", async () => {
  const source = tempDir("manual-src-");
  const downloads = tempDir("manual-dl-");
  const sourcePath = path.join(source, "Game-v1.zip");
  fs.writeFileSync(sourcePath, Buffer.from("PK\u0003\u0004test"));

  const staged = await stageManualPackage({
    sourcePath,
    downloadsDir: downloads,
    reservePath: (candidate) => candidate,
  });
  assert.equal(staged.targetPath, path.join(downloads, "Game-v1.zip"));
  assert.equal(staged.fileName, "Game-v1.zip");
  assert.equal(staged.totalBytes, 8);
  assert.equal(fs.existsSync(staged.targetPath), true);
  assert.equal(fs.existsSync(sourcePath), false, "moved, not copied, on the same volume");
});

test("stageManualPackage keeps the original when asked to copy", async () => {
  const source = tempDir("manual-src-");
  const downloads = tempDir("manual-dl-");
  const sourcePath = path.join(source, "Game.7z");
  fs.writeFileSync(sourcePath, Buffer.from("7z\xbc\xaf\x27\x1cdata", "binary"));

  const staged = await stageManualPackage({
    sourcePath,
    downloadsDir: downloads,
    reservePath: (candidate) => candidate,
    keepOriginal: true,
  });
  assert.equal(fs.existsSync(sourcePath), true);
  assert.equal(fs.readFileSync(staged.targetPath).length, fs.readFileSync(sourcePath).length);
});

test("stageManualPackage uses the reserved (unique) path and creates the folder", async () => {
  const source = tempDir("manual-src-");
  const downloads = path.join(tempDir("manual-dl-"), "nested", "downloads");
  const sourcePath = path.join(source, "Game.rar");
  fs.writeFileSync(sourcePath, "Rar!");

  const staged = await stageManualPackage({
    sourcePath,
    downloadsDir: downloads,
    reservePath: (candidate) => candidate.replace(/\.rar$/, " (1).rar"),
  });
  assert.equal(staged.targetPath, path.join(downloads, "Game (1).rar"));
  assert.equal(fs.existsSync(staged.targetPath), true);
});

test("stageManualPackage refuses files that are not install packages or are still downloading", async () => {
  const source = tempDir("manual-src-");
  const downloads = tempDir("manual-dl-");
  for (const name of ["notes.txt", "Game.zip.crdownload"]) {
    const sourcePath = path.join(source, name);
    fs.writeFileSync(sourcePath, "x");
    await assert.rejects(
      stageManualPackage({ sourcePath, downloadsDir: downloads, reservePath: (c) => c }),
      (/** @type {any} */ error) => error.code === "unsupported_payload",
    );
    assert.equal(fs.existsSync(sourcePath), true, "the user's file is untouched");
  }
});

test("stageManualPackage rejects an empty or missing file without touching anything", async () => {
  const source = tempDir("manual-src-");
  const downloads = tempDir("manual-dl-");
  const empty = path.join(source, "Game.zip");
  fs.writeFileSync(empty, "");
  await assert.rejects(
    stageManualPackage({ sourcePath: empty, downloadsDir: downloads, reservePath: (c) => c }),
    (/** @type {any} */ error) => error.code === "empty_download",
  );
  await assert.rejects(
    stageManualPackage({
      sourcePath: path.join(source, "missing.zip"),
      downloadsDir: downloads,
      reservePath: (c) => c,
    }),
    (/** @type {any} */ error) => error.code === "not_found",
  );
  assert.deepEqual(fs.readdirSync(downloads), []);
});

test("inspectManualPackage reports the file without touching it", async () => {
  const source = tempDir("manual-src-");
  const sourcePath = path.join(source, "Game-v2.zip");
  fs.writeFileSync(sourcePath, "PK-content");
  const inspected = await inspectManualPackage(`  ${sourcePath}  `);
  assert.deepEqual(inspected, { sourcePath, fileName: "Game-v2.zip", totalBytes: 10 });
  assert.equal(fs.existsSync(sourcePath), true);
  await assert.rejects(
    inspectManualPackage(source),
    (/** @type {any} */ error) => error.code === "unsupported_payload",
    "a folder is refused",
  );
});

test("describeManualPackageError turns codes into user-facing text", () => {
  assert.match(describeManualPackageError({ code: "unsupported_payload" }), /archive|installer/i);
  assert.match(describeManualPackageError({ code: "empty_download" }), /empty/i);
  assert.match(describeManualPackageError({ code: "not_found" }), /not found|no longer/i);
  assert.match(describeManualPackageError(new Error("disk full")), /disk full/);
});
