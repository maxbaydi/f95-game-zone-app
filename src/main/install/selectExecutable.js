const path = require("path");

const GENERIC_EXECUTABLE_NAMES = [
  "renpy",
  "python",
  "pythonw",
  "unitycrashhandler64",
  "unitycrashhandler32",
  "unitycrashhandler",
  "crashpad_handler",
  "notification_helper",
  "dxwebsetup",
  "vcredist",
  "vcredistx64",
  "vcredistx86",
  "vc_redist",
  "unins000",
  "uninstall",
  "nw",
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

function scoreExecutable(relativePath, context = {}) {
  const normalizedPath = String(relativePath || "").replace(/\\/g, "/");
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

  if (extension === ".html") {
    score += 5;
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
  extractVersionParts,
  scoreExecutable,
  selectPreferredExecutable,
};
