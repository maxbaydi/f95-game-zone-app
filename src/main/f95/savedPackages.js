// @ts-check
const fs = require("fs");
const path = require("path");
const {
  DownloadValidationError,
  inspectDownloadedPackage,
  looksLikeHtmlDocument,
} = require("./downloadSupport");
const { sanitizePathSegment } = require("../install/installTarget");

/**
 * Save an original package in persistent storage, without extraction or
 * library registration. Cache and archive storage share the userData
 * volume: publishing a hard link is atomic and never replaces another
 * download. The source remains available if publication fails.
 * @param {{ filePath: string, archivesDir: string, mimeType?: string,
 *   archiveExtensions: string[], gameExtensions: string[] }} input
 */
async function saveDownloadedPackage(input) {
  const handle = await fs.promises.open(input.filePath, "r");
  const header = Buffer.alloc(4096);
  let bytesRead;
  try {
    ({ bytesRead } = await handle.read(header, 0, header.length, 0));
  } finally {
    await handle.close();
  }
  // An error page may be named game.zip. Never count it as a saved game.
  if (looksLikeHtmlDocument(header.subarray(0, bytesRead))) {
    throw new DownloadValidationError(
      "The mirror returned a web page instead of the game file.",
      {
        code: "html_payload",
      },
    );
  }
  const inspected = await inspectDownloadedPackage(input);
  const sourceName = path.basename(input.filePath);
  const sourceExtension = path.extname(sourceName).slice(1).toLowerCase();
  const fileName = sanitizePathSegment(
    inspected.normalizedExtension &&
      sourceExtension !== inspected.normalizedExtension
      ? `${sourceName}.${inspected.normalizedExtension}`
      : sourceName,
    "download",
  );
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  await fs.promises.mkdir(input.archivesDir, { recursive: true });
  for (let index = 0; ; index += 1) {
    const targetPath = path.join(
      input.archivesDir,
      index ? `${stem} (${index})${extension}` : fileName,
    );
    try {
      await fs.promises.link(input.filePath, targetPath);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "EEXIST")
        continue;
      throw error;
    }
    await fs.promises.unlink(input.filePath).catch((error) => {
      console.warn(
        "[f95.download] Saved package, but could not remove its cache copy:",
        error,
      );
    });
    console.info("[f95.download] Saved original package without installing:", {
      targetPath,
    });
    return { packagePath: targetPath, fileName: path.basename(targetPath) };
  }
}

module.exports = { saveDownloadedPackage };
