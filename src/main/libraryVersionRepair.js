// @ts-check

const fs = require("fs");
const path = require("path");
const { findExecutables: defaultFindExecutables } = require("./install/findExecutables");
const {
  selectPreferredExecutable: defaultSelectPreferredExecutable,
} = require("./install/selectExecutable");

/**
 * Repairs for library versions whose files moved or whose launcher is unknown:
 * point a version at its new folder ("Locate") and pick the file that starts
 * the game ("Choose .exe"). Pure logic with injected FS/DB access; the IPC
 * handlers in main.js supply the real implementations.
 */

const REPAIR_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  FOLDER_MISSING: "FOLDER_MISSING",
  FOLDER_UNREADABLE: "FOLDER_UNREADABLE",
  FOLDER_IN_USE: "FOLDER_IN_USE",
  VERSION_NOT_FOUND: "VERSION_NOT_FOUND",
  UPDATE_FAILED: "UPDATE_FAILED",
  EXECUTABLE_OUTSIDE_FOLDER: "EXECUTABLE_OUTSIDE_FOLDER",
  EXECUTABLE_MISSING: "EXECUTABLE_MISSING",
});

const REPAIR_ERROR_MESSAGES = Object.freeze({
  INVALID_INPUT: "This game could not be found in your library.",
  FOLDER_MISSING: "That folder doesn't exist. Choose the folder where the game is now.",
  FOLDER_UNREADABLE: "F95Launcher can't open that folder. Check that the drive is connected and try again.",
  FOLDER_IN_USE: "That folder already belongs to another game in your library.",
  VERSION_NOT_FOUND: "This version is no longer in your library. Reopen the game and try again.",
  UPDATE_FAILED: "The change could not be saved. Try again.",
  EXECUTABLE_OUTSIDE_FOLDER: "Pick a file inside this game's folder.",
  EXECUTABLE_MISSING: "That file doesn't exist any more. Pick another one.",
});

/**
 * @param {keyof typeof REPAIR_ERROR_CODES} code
 * @returns {{ success: false, code: string, error: string }}
 */
function repairFailure(code) {
  return {
    success: /** @type {const} */ (false),
    code: REPAIR_ERROR_CODES[code],
    error: REPAIR_ERROR_MESSAGES[code],
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string} targetPath
 * @returns {string}
 */
function toComparablePath(targetPath) {
  const resolved = path.resolve(targetPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPositiveInteger(value) {
  return Number.isInteger(value) && Number(value) > 0;
}

/**
 * Resolves a launcher path (relative to the game folder or absolute) and makes
 * sure it points to a file inside that folder.
 *
 * @param {string} gamePath
 * @param {string} executable
 * @returns {{ ok: true, relativePath: string, absolutePath: string } | { ok: false, error: string }}
 */
function resolveExecutableWithinFolder(gamePath, executable) {
  const folder = normalizeText(gamePath);
  const target = normalizeText(executable);
  if (!folder || !target) {
    return { ok: false, error: REPAIR_ERROR_MESSAGES.EXECUTABLE_OUTSIDE_FOLDER };
  }

  if (!path.isAbsolute(target) && target.split(/[\\/]+/).includes("..")) {
    return { ok: false, error: REPAIR_ERROR_MESSAGES.EXECUTABLE_OUTSIDE_FOLDER };
  }

  const resolvedFolder = path.resolve(folder);
  const resolvedTarget = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(resolvedFolder, target);
  // path.win32.relative compares case-insensitively and keeps the case of
  // the target, so `C:\\GAMES\\x\\Game.exe` stays `Game.exe`.
  const relativePath = path.relative(resolvedFolder, resolvedTarget);

  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath.split(/[\\/]+/).includes("..")
  ) {
    return { ok: false, error: REPAIR_ERROR_MESSAGES.EXECUTABLE_OUTSIDE_FOLDER };
  }

  return {
    ok: true,
    relativePath,
    absolutePath: path.join(folder, relativePath),
  };
}

/**
 * @param {string[] | unknown} value
 * @returns {string[]}
 */
function normalizeExecutableList(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter(Boolean);
}

/**
 * Launch candidates inside a game folder, relative to that folder.
 *
 * @param {{
 *   gamePath: string,
 *   gameExtensions?: string[],
 *   pathExists?: (targetPath: string) => boolean,
 *   findExecutables?: (dir: string, extensions: string[]) => string[]
 * }} input
 * @returns {{ success: true, executables: string[] } | { success: false, code: string, error: string }}
 */
function listGameExecutables(input) {
  const pathExists = input.pathExists || fs.existsSync;
  const findExecutables = input.findExecutables || defaultFindExecutables;
  const gamePath = normalizeText(input.gamePath);

  if (!gamePath || !pathExists(gamePath)) {
    return repairFailure("FOLDER_MISSING");
  }

  try {
    return {
      success: true,
      executables: normalizeExecutableList(
        findExecutables(gamePath, Array.isArray(input.gameExtensions) ? input.gameExtensions : []),
      ),
    };
  } catch {
    return repairFailure("FOLDER_UNREADABLE");
  }
}

/**
 * Points one version of a library record at the folder the user picked and
 * selects the most likely launcher in it. The version keeps its other data
 * (play time, size, date added).
 *
 * @param {{
 *   recordId: number,
 *   version: string,
 *   oldPath?: string,
 *   newPath: string,
 *   title?: string,
 *   creator?: string,
 *   gameExtensions?: string[],
 *   pathExists?: (targetPath: string) => boolean,
 *   findExecutables?: (dir: string, extensions: string[]) => string[],
 *   selectPreferredExecutable?: (executables: string[], hints: { title: string, creator: string }) => string,
 *   otherGamePaths?: string[],
 *   updateVersionLocation: (recordId: number, version: string, gamePath: string, execPath: string) => Promise<number | void> | number | void
 * }} input
 */
async function relocateGameVersion(input) {
  const pathExists = input.pathExists || fs.existsSync;
  const findExecutables = input.findExecutables || defaultFindExecutables;
  const selectPreferred =
    input.selectPreferredExecutable || defaultSelectPreferredExecutable;

  if (!isPositiveInteger(input.recordId) || typeof input.version !== "string") {
    return repairFailure("INVALID_INPUT");
  }

  const newPath = normalizeText(input.newPath);
  if (!newPath || !pathExists(newPath)) {
    return repairFailure("FOLDER_MISSING");
  }

  const newPathKey = toComparablePath(newPath);
  const belongsToAnotherGame = (Array.isArray(input.otherGamePaths) ? input.otherGamePaths : [])
    .map(normalizeText)
    .filter(Boolean)
    .some((otherPath) => toComparablePath(otherPath) === newPathKey);
  if (belongsToAnotherGame) {
    return repairFailure("FOLDER_IN_USE");
  }

  /** @type {string[]} */
  let executables = [];
  try {
    executables = normalizeExecutableList(
      findExecutables(newPath, Array.isArray(input.gameExtensions) ? input.gameExtensions : []),
    );
  } catch {
    return repairFailure("FOLDER_UNREADABLE");
  }

  const selected =
    executables.length > 0
      ? normalizeText(
          selectPreferred(executables, {
            title: String(input.title || ""),
            creator: String(input.creator || ""),
          }),
        )
      : "";
  const execPath = selected ? path.join(newPath, selected) : "";

  try {
    const changes = await input.updateVersionLocation(
      input.recordId,
      input.version,
      newPath,
      execPath,
    );
    if (typeof changes === "number" && changes === 0) {
      return repairFailure("VERSION_NOT_FOUND");
    }
  } catch {
    return repairFailure("UPDATE_FAILED");
  }

  return {
    success: /** @type {const} */ (true),
    gamePath: newPath,
    execPath,
    executable: selected,
    executables,
  };
}

/**
 * Stores the launcher the user picked for one version. The file must exist
 * and live inside the version's folder.
 *
 * @param {{
 *   recordId: number,
 *   version: string,
 *   gamePath: string,
 *   executable: string,
 *   pathExists?: (targetPath: string) => boolean,
 *   updateVersionExecutable: (recordId: number, version: string, execPath: string) => Promise<number | void> | number | void
 * }} input
 */
async function setGameExecutable(input) {
  const pathExists = input.pathExists || fs.existsSync;

  if (!isPositiveInteger(input.recordId) || typeof input.version !== "string") {
    return repairFailure("INVALID_INPUT");
  }

  const resolved = resolveExecutableWithinFolder(input.gamePath, input.executable);
  if (!resolved.ok) {
    return repairFailure("EXECUTABLE_OUTSIDE_FOLDER");
  }

  if (!pathExists(resolved.absolutePath)) {
    return repairFailure("EXECUTABLE_MISSING");
  }

  try {
    const changes = await input.updateVersionExecutable(
      input.recordId,
      input.version,
      resolved.absolutePath,
    );
    if (typeof changes === "number" && changes === 0) {
      return repairFailure("VERSION_NOT_FOUND");
    }
  } catch {
    return repairFailure("UPDATE_FAILED");
  }

  return {
    success: /** @type {const} */ (true),
    execPath: resolved.absolutePath,
    executable: resolved.relativePath,
  };
}

module.exports = {
  REPAIR_ERROR_CODES,
  REPAIR_ERROR_MESSAGES,
  listGameExecutables,
  relocateGameVersion,
  resolveExecutableWithinFolder,
  setGameExecutable,
};
