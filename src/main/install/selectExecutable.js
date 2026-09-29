const path = require("path");

/**
 * Helper binaries that ship next to games and are never the launcher.
 * Matched against the compact base name (prefix / suffix / exact).
 */
const GENERIC_EXECUTABLE_NAMES = [
  "renpy",
  "python",
  "pythonw",
  "unitycrashhandler64",
  "unitycrashhandler32",
  "unitycrashhandler",
  "crashpad_handler",
  "crashpadhandler",
  "crashreportclient",
  "unrealcefsubprocess",
  "epicwebhelper",
  "ue4prereqsetup",
  "ueprereqsetup",
  "notification_helper",
  "notificationhelper",
  "dxwebsetup",
  "dxsetup",
  "vcredist",
  "vcredistx64",
  "vcredistx86",
  "vc_redist",
  "oalinst",
  "unins000",
  "uninstall",
  "uninst",
  "nw",
  "nwjc",
  "payload",
  "config",
  "chromedriver",
  "7za",
  "7z",
];

/**
 * Folders that only hold redistributables, runtimes or tooling.
 */
const IGNORED_PATH_SEGMENTS = [
  "/redist/",
  "/_commonredist/",
  "/commonredist/",
  "/vcredist/",
  "/directx/",
  "/dotnet/",
  "/dotnetfx/",
  "/prerequisites/",
  "/thirdparty/",
  "/engine/binaries/",
  "/__macosx/",
  "/tools/",
];

function compactToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function compareVersionParts(leftParts, rightParts) {
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
}

function extractVersionParts(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/\\/g, "/");
  const versionPattern = /(?:^|[^a-z0-9])v?(\d+(?:[._-]\d+){1,5})(?=[^a-z0-9]|$)/g;
  const candidates = [];
  let match = null;

  while ((match = versionPattern.exec(normalized))) {
    const parts = String(match[1] || "")
      .split(/[._-]+/)
      .map((entry) => Number.parseInt(entry, 10))
      .filter((entry) => Number.isFinite(entry));

    if (parts.length > 0) {
      candidates.push(parts);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => compareVersionParts(right, left))[0];
}

function normalizeRelativePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .toLowerCase();
}

/**
 * @param {string} relativePath
 * @param {{
 *   title?: string,
 *   creator?: string,
 *   preferredExecutables?: string[],
 *   ignoredExecutables?: string[],
 * }=} context
 */
function scoreExecutable(relativePath, context = {}) {
  const normalizedPath = String(relativePath || "").replace(/\\/g, "/");
  const lowerPath = normalizedPath.toLowerCase();
  const extension = path.posix.extname(normalizedPath).toLowerCase();
  const baseName = path.posix.basename(normalizedPath, extension);
  const compactBaseName = compactToken(baseName);
  const compactTitle = compactToken(context.title);
  const compactCreator = compactToken(context.creator);
  const depth = normalizedPath.split("/").filter(Boolean).length - 1;
  let score = 100 - depth * 12;

  if (extension === ".exe") {
    score += 20;
  }

  if (extension === ".html" || extension === ".htm") {
    score += 5;
    if (compactBaseName === "index") {
      score += 40;
    }
  }

  if (compactTitle) {
    if (compactBaseName === compactTitle) {
      score += 250;
    } else if (compactBaseName.includes(compactTitle)) {
      score += 150;
    } else if (compactToken(normalizedPath).includes(compactTitle)) {
      score += 70;
    }
  }

  if (compactCreator && compactBaseName.includes(compactCreator)) {
    score += 10;
  }

  if (normalizedPath.includes("/renpy/") || normalizedPath.includes("/lib/")) {
    score -= 45;
  }

  if (IGNORED_PATH_SEGMENTS.some((segment) => `/${lowerPath}`.includes(segment))) {
    score -= 200;
  }

  const preferred = (context.preferredExecutables || []).map(normalizeRelativePath);
  if (preferred.includes(lowerPath) || preferred.includes(path.posix.basename(lowerPath))) {
    score += 300;
  }

  const ignored = (context.ignoredExecutables || []).map(normalizeRelativePath);
  if (ignored.includes(path.posix.basename(lowerPath)) || ignored.includes(lowerPath)) {
    score -= 400;
  }

  if (
    GENERIC_EXECUTABLE_NAMES.some(
      (name) =>
        compactBaseName === name ||
        compactBaseName.startsWith(name) ||
        compactBaseName.endsWith(name),
    )
  ) {
    score -= 220;
  }

  return score;
}

function selectPreferredExecutable(executables, context = {}) {
  const values = Array.isArray(executables)
    ? executables.filter((entry) => Boolean(entry))
    : [];

  if (values.length === 0) {
    return "";
  }

  return [...values].sort((left, right) => {
    const scoreDifference =
      scoreExecutable(right, context) - scoreExecutable(left, context);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    const leftVersion = extractVersionParts(left);
    const rightVersion = extractVersionParts(right);

    if (leftVersion && rightVersion) {
      const versionDifference = compareVersionParts(rightVersion, leftVersion);
      if (versionDifference !== 0) {
        return versionDifference;
      }
    } else if (!leftVersion && rightVersion) {
      return 1;
    } else if (leftVersion && !rightVersion) {
      return -1;
    }

    return String(left).localeCompare(String(right));
  })[0];
}

module.exports = {
  GENERIC_EXECUTABLE_NAMES,
  extractVersionParts,
  scoreExecutable,
  selectPreferredExecutable,
};
