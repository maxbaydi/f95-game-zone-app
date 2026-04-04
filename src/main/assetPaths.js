// @ts-check

const path = require("path");

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeSeparators(value) {
  return value.replace(/\\/g, "/");
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripFileProtocol(value) {
  return value.replace(/^file:\/\//, "");
}

/**
 * @param {{ images: string, root: string }} appPaths
 * @param {string} storedPath
 * @returns {string}
 */
function resolveStoredImagePath(appPaths, storedPath) {
  const rawPath = stripFileProtocol(storedPath || "");
  if (!rawPath) {
    return "";
  }

  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  const normalized = normalizeSeparators(rawPath).replace(/^\.?\//, "");

  if (normalized.startsWith("cache/images/")) {
    return path.join(appPaths.images, ...normalized.slice("cache/images/".length).split("/"));
  }

  if (normalized.startsWith("data/images/")) {
    return path.join(appPaths.images, ...normalized.slice("data/images/".length).split("/"));
  }

  if (normalized.startsWith("images/")) {
    return path.join(appPaths.images, ...normalized.slice("images/".length).split("/"));
  }

  return path.join(appPaths.root, ...normalized.split("/"));
}

/**
 * @param {{ images: string }} appPaths
 * @param {string} absoluteFilePath
 * @returns {string}
 */
function toStoredImagePath(appPaths, absoluteFilePath) {
  const relativePath = path.relative(appPaths.images, absoluteFilePath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return normalizeSeparators(absoluteFilePath);
  }

  return normalizeSeparators(path.posix.join("cache/images", ...relativePath.split(path.sep)));
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function toRendererPath(filePath) {
  return normalizeSeparators(stripFileProtocol(filePath));
}

module.exports = {
  resolveStoredImagePath,
  toStoredImagePath,
  toRendererPath,
};
