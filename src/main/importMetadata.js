"use strict";

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string | null | undefined} version
 * @returns {boolean}
 */
function isUnknownVersion(version) {
  const normalized = normalizeText(version).toLowerCase();
  return !normalized || normalized === "unknown";
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
function isUnknownText(value) {
  const normalized = normalizeText(value).toLowerCase();
  return !normalized || normalized === "unknown";
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizePathKey(value) {
  const normalized = normalizeText(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * @param {{
 *   title?: string,
 *   creator?: string,
 *   engine?: string,
 *   version?: string
 * }} game
 * @param {{
 *   title?: string,
 *   creator?: string,
 *   engine?: string,
 *   version?: string
 * } | null | undefined} atlasData
 */
function mergeImportedGameMetadata(game, atlasData) {
  const resolvedTitle =
    normalizeText(atlasData?.title) || normalizeText(game.title);
  const resolvedCreator =
    normalizeText(atlasData?.creator) ||
    normalizeText(game.creator) ||
    "Unknown";
  const resolvedEngine =
    normalizeText(atlasData?.engine) || normalizeText(game.engine) || "Unknown";
  const localVersion = normalizeText(game.version);
  const atlasVersion = normalizeText(atlasData?.version);

  return {
    ...game,
    title: resolvedTitle || "Unknown",
    creator: resolvedCreator,
    engine: resolvedEngine,
    version:
      isUnknownVersion(localVersion) && atlasVersion
        ? atlasVersion
        : localVersion || "Unknown",
  };
}

/**
 * Merges a rescanned folder into the library record that already owns it.
 *
 * The scanner wins only when it matched the folder to the catalog with
 * confidence. Otherwise the stored title, creator and engine are kept (they
 * may have been fixed by the user or by an earlier confident match) and only
 * unknown stored values are upgraded. The version comes from the folder name;
 * when the folder does not reveal one, the version already stored for that
 * folder is kept instead of being downgraded to "Unknown".
 *
 * @param {{
 *   title?: string,
 *   creator?: string,
 *   engine?: string,
 *   versions?: Array<{ version?: string, game_path?: string }>
 * } | null | undefined} existingGame
 * @param {{
 *   title?: string,
 *   creator?: string,
 *   engine?: string,
 *   version?: string,
 *   atlasId?: string | number,
 *   autoMatched?: boolean,
 *   folder?: string
 * }} scannedGame
 */
function mergeRefreshedGameMetadata(existingGame, scannedGame) {
  const scanned =
    scannedGame && typeof scannedGame === "object" ? scannedGame : {};
  if (!existingGame || typeof existingGame !== "object") {
    return { ...scanned };
  }

  // A catalog id means the metadata was enriched from Atlas, either by a
  // confident automatic match or by the user picking the entry in the importer.
  const confident = Boolean(scanned.atlasId) || Boolean(scanned.autoMatched);

  /**
   * @param {string | undefined} scannedValue
   * @param {string | undefined} storedValue
   * @returns {string}
   */
  const pick = (scannedValue, storedValue) => {
    if (confident && !isUnknownText(scannedValue)) {
      return normalizeText(scannedValue);
    }
    if (!isUnknownText(storedValue)) {
      return normalizeText(storedValue);
    }
    if (!isUnknownText(scannedValue)) {
      return normalizeText(scannedValue);
    }
    return normalizeText(storedValue) || normalizeText(scannedValue) || "Unknown";
  };

  const folderKey = normalizePathKey(scanned.folder);
  const storedVersion = (Array.isArray(existingGame.versions)
    ? existingGame.versions
    : []
  ).find((version) => normalizePathKey(version?.game_path) === folderKey)?.version;
  const version = !isUnknownVersion(scanned.version)
    ? normalizeText(scanned.version)
    : !isUnknownVersion(storedVersion)
      ? normalizeText(storedVersion)
      : normalizeText(scanned.version) || "Unknown";

  return {
    ...scanned,
    title: pick(scanned.title, existingGame.title),
    creator: pick(scanned.creator, existingGame.creator),
    engine: pick(scanned.engine, existingGame.engine),
    version,
  };
}

module.exports = {
  isUnknownVersion,
  mergeImportedGameMetadata,
  mergeRefreshedGameMetadata,
  normalizeText,
};
