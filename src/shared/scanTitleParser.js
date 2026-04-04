"use strict";

const NOISE_TOKENS = new Set([
  "android",
  "bonus",
  "completed",
  "compressed",
  "extras",
  "f95",
  "f95zone",
  "f95zoneto",
  "linux",
  "mac",
  "mache",
  "mod",
  "mods",
  "pc",
  "ported",
  "renpy",
  "rpgm",
  "rpgmv",
  "rpgmz",
  "uncensored",
  "unity",
  "unreal",
  "walkthrough",
  "web",
  "win",
  "windows",
]);

/**
 * @param {string} value
 * @returns {string}
 */
function collapseWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} rawName
 * @returns {string}
 */
function extractVersionLabel(rawName) {
  const versionPatterns = [
    /(?:^|[^0-9A-Za-z])v(?:ersion)?[\s._-]*([0-9]+(?:\.[0-9A-Za-z]+)*)\b/i,
    /(?:^|[^0-9A-Za-z])(ep(?:isode)?[\s._-]*[0-9]+(?:\.[0-9A-Za-z]+)*)\b/i,
    /\b([0-9]+(?:\.[0-9A-Za-z]+){1,})\b/,
    /(?:^|[^0-9A-Za-z])(final)\b/i,
  ];

  for (const pattern of versionPatterns) {
    const match = rawName.match(pattern);
    if (match?.[1]) {
      const value = collapseWhitespace(match[1]);
      return /^final$/i.test(value) ? "Final" : value;
    }
  }

  return "";
}

/**
 * @param {string} rawName
 * @returns {string}
 */
function sanitizeRawName(rawName) {
  return collapseWhitespace(
    rawName
      .replace(/f95zone\.to/gi, " ")
      .replace(/f95-zone/gi, " ")
      .replace(/[[({][^)\]}]*[\])}]/g, " ")
      .replace(
        /(^|[^0-9A-Za-z])v(?:ersion)?[\s._-]*[0-9]+(?:\.[0-9A-Za-z]+)*\b/gi,
        " ",
      )
      .replace(
        /(^|[^0-9A-Za-z])(ep(?:isode)?[\s._-]*[0-9]+(?:\.[0-9A-Za-z]+)*)\b/gi,
        " ",
      )
      .replace(/(^|[^0-9A-Za-z])final\b/gi, " ")
      .replace(/[._-]+/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " "),
  );
}

/**
 * @param {string} rawName
 * @returns {{ title: string, version: string }}
 */
function parseScanTitle(rawName) {
  const version = extractVersionLabel(rawName) || "Unknown";
  const sanitized = sanitizeRawName(rawName);

  const filteredTokens = sanitized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !NOISE_TOKENS.has(token.toLowerCase()));

  const title =
    collapseWhitespace(filteredTokens.join(" ")) ||
    collapseWhitespace(sanitized);

  return {
    title: title || collapseWhitespace(rawName),
    version,
  };
}

module.exports = {
  parseScanTitle,
};
