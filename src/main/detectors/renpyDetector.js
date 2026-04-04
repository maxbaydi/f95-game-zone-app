// @ts-check

const fs = require("fs");
const path = require("path");

/**
 * @param {string} rootPath
 * @returns {Array<fs.Dirent>}
 */
function safeReadDir(rootPath) {
  try {
    return fs.readdirSync(rootPath, { withFileTypes: true });
  } catch (error) {
    return [];
  }
}

/**
 * @param {string} rootPath
 * @param {string[]} executableNames
 * @returns {{ matched: boolean, confidence: number, reasons: string[] }}
 */
function detectRenpyGame(rootPath, executableNames = []) {
  const entries = safeReadDir(rootPath);
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLowerCase());
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name.toLowerCase());
  const executableSet = new Set(executableNames.map((name) => path.basename(name).toLowerCase()));

  let confidence = 0;
  /** @type {string[]} */
  const reasons = [];

  if (executableSet.has("renpy.exe") || executableSet.has("renpy.sh")) {
    confidence += 40;
    reasons.push("found renpy launcher executable");
  }

  if (dirs.includes("game")) {
    confidence += 20;
    reasons.push("found game directory");
  }

  if (dirs.includes("renpy")) {
    confidence += 15;
    reasons.push("found renpy runtime directory");
  }

  if (files.some((file) => file.endsWith(".rpa"))) {
    confidence += 20;
    reasons.push("found .rpa archives");
  }

  if (files.some((file) => file.endsWith(".rpyc"))) {
    confidence += 10;
    reasons.push("found compiled .rpyc scripts");
  }

  if (dirs.includes("lib")) {
    const libEntries = safeReadDir(path.join(rootPath, "lib")).map((entry) =>
      entry.name.toLowerCase(),
    );
    if (libEntries.some((entry) => entry.startsWith("py3-windows"))) {
      confidence += 15;
      reasons.push("found py3-windows runtime library");
    }
  }

  const gameEntries = dirs.includes("game")
    ? safeReadDir(path.join(rootPath, "game")).map((entry) => entry.name.toLowerCase())
    : [];

  if (
    gameEntries.some(
      (entry) =>
        entry === "saves" ||
        entry.startsWith("script") ||
        entry.endsWith(".rpa") ||
        entry.endsWith(".rpyc"),
    )
  ) {
    confidence += 10;
    reasons.push("found typical Ren'Py files inside game directory");
  }

  if (
    executableNames.length > 0 &&
    dirs.includes("game") &&
    (files.some((file) => file.endsWith(".exe")) || executableSet.size > 0)
  ) {
    confidence += 10;
    reasons.push("found executable alongside Ren'Py-like layout");
  }

  return {
    matched: confidence >= 70,
    confidence,
    reasons,
  };
}

module.exports = {
  detectRenpyGame,
};
