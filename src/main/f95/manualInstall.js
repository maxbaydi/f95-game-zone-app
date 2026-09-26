/**
 * "Install from a downloaded file": the fallback for mirrors whose download
 * cannot finish inside the embedded browser. Cloudflare Turnstile answers
 * error 600010 in Electron windows and Adscore flags them as bots (Mixdrop,
 * DataNodes, Krakenfiles, Send.cm, UsersDrive ...), so the user downloads
 * the package in their own browser and hands the file to the app, which
 * then installs it for the same downloads-panel entry.
 *
 * This module stages the file; the install itself is the regular
 * `finalizeF95DownloadedPackage` path in main.js.
 */
const fs = require("fs");
const path = require("path");

const { MirrorError } = require("./hosts/common");

const PACKAGE_EXTENSION_PATTERN =
  /\.(zip|7z|rar|tar|gz|tgz|bz2|xz|zst|exe|apk|jar|swf|msi)$/i;
const UNFINISHED_DOWNLOAD_PATTERN = /\.(crdownload|part|partial|download|tmp|opdownload)$/i;

/**
 * @param {string} fileName
 */
function isLikelyInstallPackage(fileName) {
  const name = String(fileName || "").trim();
  if (!name || UNFINISHED_DOWNLOAD_PATTERN.test(name)) {
    return false;
  }
  return PACKAGE_EXTENSION_PATTERN.test(name);
}

async function moveOrCopy(sourcePath, targetPath, keepOriginal) {
  if (keepOriginal) {
    await fs.promises.copyFile(sourcePath, targetPath);
    return;
  }
  try {
    await fs.promises.rename(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== "EXDEV" && error?.code !== "EPERM") {
      throw error;
    }
    // Different volume: copy, then remove the original only once the copy
    // is complete.
    await fs.promises.copyFile(sourcePath, targetPath);
    await fs.promises.unlink(sourcePath).catch(() => {});
  }
}

/**
 * Check a user-picked file before anything is moved: it has to look like an
 * install package and be a complete, non-empty file.
 * @param {string} sourcePathInput
 * @returns {Promise<{sourcePath: string, fileName: string, totalBytes: number}>}
 */
async function inspectManualPackage(sourcePathInput) {
  const sourcePath = String(sourcePathInput || "").trim();
  const fileName = path.basename(sourcePath);
  if (!isLikelyInstallPackage(fileName)) {
    throw new MirrorError(
      `${fileName || "This file"} is not an archive or installer F95Launcher can install (zip, 7z, rar, exe, apk ...). Unfinished browser downloads are refused.`,
      { code: "unsupported_payload" },
    );
  }

  let stats;
  try {
    stats = await fs.promises.stat(sourcePath);
  } catch {
    throw new MirrorError(`${fileName} was not found. Pick the downloaded file again.`, {
      code: "not_found",
    });
  }
  if (!stats.isFile() || stats.size <= 0) {
    throw new MirrorError(`${fileName} is empty. Wait for the browser download to finish, then try again.`, {
      code: "empty_download",
    });
  }
  return { sourcePath, fileName, totalBytes: stats.size };
}

/**
 * Move (or copy) a user-supplied package into the downloads folder. A copy
 * that fails half-way (disk full) is removed again so no truncated package
 * is left behind.
 * @param {{
 *   sourcePath: string,
 *   downloadsDir: string,
 *   reservePath: (candidatePath: string) => string,
 *   keepOriginal?: boolean,
 * }} input
 * @returns {Promise<{targetPath: string, fileName: string, totalBytes: number}>}
 */
async function stageManualPackage(input) {
  const inspected = await inspectManualPackage(input?.sourcePath);
  await fs.promises.mkdir(input.downloadsDir, { recursive: true });
  const targetPath = input.reservePath(
    path.join(input.downloadsDir, inspected.fileName),
  );
  try {
    await moveOrCopy(inspected.sourcePath, targetPath, Boolean(input.keepOriginal));
  } catch (error) {
    await fs.promises.unlink(targetPath).catch(() => {});
    throw error;
  }

  return {
    targetPath,
    fileName: path.basename(targetPath),
    totalBytes: inspected.totalBytes,
  };
}

/**
 * @param {any} error
 */
function describeManualPackageError(error) {
  switch (error?.code) {
    case "unsupported_payload":
      return "Pick the game archive or installer you downloaded (zip, 7z, rar, exe, apk). Unfinished browser downloads cannot be used.";
    case "empty_download":
      return "The file is empty. Wait for the browser download to finish, then pick it again.";
    case "not_found":
      return "The file was not found or no longer exists.";
    default:
      return String(error?.userMessage || error?.message || "The file could not be used.");
  }
}

module.exports = {
  describeManualPackageError,
  inspectManualPackage,
  isLikelyInstallPackage,
  stageManualPackage,
};
