// @ts-check

const fs = require("fs");
const path = require("path");

/**
 * @param {string | null | undefined} value
 * @param {string=} fallback
 * @returns {string}
 */
function sanitizePathSegment(value, fallback = "Unknown") {
  const normalized = String(value || "")
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
}

/**
 * @param {string} basePath
 * @param {(targetPath: string) => boolean} pathExists
 * @returns {string}
 */
function ensureUniqueDirectoryPath(basePath, pathExists) {
  if (!pathExists(basePath)) {
    return basePath;
  }

  let attempt = 1;
  let candidatePath = basePath;
  while (pathExists(candidatePath)) {
    candidatePath = `${basePath} (${attempt++})`;
  }

  return candidatePath;
}

/**
 * Decides where a downloaded package is installed.
 *
 * An existing install folder of the same library record is reused only when it
 * still exists on disk: updating a game whose folder was deleted or lives on a
 * disconnected drive is a fresh install into the library folder, and the dead
 * folders are reported as `staleInstallPaths` so their version rows can be
 * retired once the new install succeeded.
 *
 * @param {{
 *   existingGame: { record_id?: number, versions?: Array<{ game_path?: string, date_added?: number }> } | null | undefined,
 *   libraryFolder: string,
 *   folderName: string,
 *   pathExists?: (targetPath: string) => boolean
 * }} input
 * @returns {{ installDirectory: string, reusedExisting: boolean, staleInstallPaths: string[] }}
 */
function chooseInstallDirectory(input) {
  const pathExists =
    typeof input.pathExists === "function"
      ? input.pathExists
      : (targetPath) => fs.existsSync(targetPath);
  const versions = Array.isArray(input.existingGame?.versions)
    ? [...input.existingGame.versions]
    : [];
  versions.sort(
    (left, right) => (right?.date_added || 0) - (left?.date_added || 0),
  );

  const seenPaths = new Set();
  const staleInstallPaths = [];
  let reusedPath = "";

  for (const version of versions) {
    const gamePath = String(version?.game_path || "").trim();
    if (!gamePath || seenPaths.has(gamePath)) {
      continue;
    }
    seenPaths.add(gamePath);

    if (pathExists(gamePath)) {
      if (!reusedPath) {
        reusedPath = gamePath;
      }
      continue;
    }

    staleInstallPaths.push(gamePath);
  }

  if (reusedPath) {
    return {
      installDirectory: reusedPath,
      reusedExisting: true,
      staleInstallPaths,
    };
  }

  const desiredPath = path.join(
    input.libraryFolder,
    sanitizePathSegment(input.folderName),
  );

  return {
    installDirectory: ensureUniqueDirectoryPath(desiredPath, pathExists),
    reusedExisting: false,
    staleInstallPaths,
  };
}

module.exports = {
  chooseInstallDirectory,
  ensureUniqueDirectoryPath,
  sanitizePathSegment,
};
