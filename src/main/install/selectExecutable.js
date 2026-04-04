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

    return String(left).localeCompare(String(right));
  })[0];
}

module.exports = {
  scoreExecutable,
  selectPreferredExecutable,
};
