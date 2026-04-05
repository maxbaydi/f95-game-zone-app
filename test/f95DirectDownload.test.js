const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ReadableStream } = require("node:stream/web");

const {
  parseContentDispositionFilename,
  resolveDownloadFileName,
  shouldUseDirectSessionDownload,
  streamResponseBodyToFile,
} = require("../src/main/f95/directDownload");

test("parseContentDispositionFilename prefers RFC5987 filenames", () => {
  const filename = parseContentDispositionFilename(
    "attachment; filename=\"download.bin\"; filename*=UTF-8''Family%20Secrets%20v1.0.zip",
  );

  assert.equal(filename, "Family Secrets v1.0.zip");
});

test("resolveDownloadFileName falls back to the final URL path when headers are missing", () => {
  const filename = resolveDownloadFileName({
    requestedUrl: "https://drive.google.com/file/d/test/view",
    finalUrl: "https://files.example.com/releases/game-build.zip",
    contentDisposition: "",
  });

  assert.equal(filename, "game-build.zip");
});

test("shouldUseDirectSessionDownload only targets the Google Drive family", () => {
  assert.equal(
    shouldUseDirectSessionDownload(
      "https://drive.usercontent.google.com/uc?id=test&export=download",
    ),
    true,
  );
  assert.equal(
    shouldUseDirectSessionDownload("https://pixeldrain.com/api/file/AbCd123"),
    false,
  );
});

test("streamResponseBodyToFile writes the full payload and reports progress", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "atlas-direct-download-"),
  );
  const targetPath = path.join(tempDir, "payload.bin");
  const progressValues = [];

  try {
    const responseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("hello "));
        controller.enqueue(Buffer.from("world"));
        controller.close();
      },
    });

    const receivedBytes = await streamResponseBodyToFile({
      responseBody,
      targetPath,
      onProgress(value) {
        progressValues.push(value);
      },
    });

    assert.equal(receivedBytes, 11);
    assert.equal(fs.readFileSync(targetPath, "utf8"), "hello world");
    assert.deepEqual(progressValues, [6, 11]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
