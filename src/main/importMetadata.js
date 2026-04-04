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

module.exports = {
  isUnknownVersion,
  mergeImportedGameMetadata,
  normalizeText,
};
