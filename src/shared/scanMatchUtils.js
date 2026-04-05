"use strict";

const SCAN_NOISE_TOKENS = new Set([
  "android",
  "bonus",
  "build",
  "completed",
  "compressed",
  "demo",
  "eng",
  "english",
  "episode",
  "episodes",
  "extras",
  "f95",
  "f95zone",
  "f95zoneto",
  "final",
  "fix",
  "fixed",
  "hotfix",
  "linux",
  "mac",
  "mache",
  "mod",
  "mods",
  "multi",
  "patch",
  "patched",
  "pc",
  "ported",
  "public",
  "renpy",
  "renpy64",
  "rpgm",
  "rpgmaker",
  "rpgmv",
  "rpgmz",
  "rus",
  "russian",
  "sandbox",
  "steamrip",
  "uncensored",
  "unity",
  "unreal",
  "update",
  "walkthrough",
  "web",
  "win",
  "windows",
  "x64",
  "x86",
  "64bit",
  "32bit",
]);

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizeScanText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[._/\\-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function buildCompactScanKey(value) {
  return normalizeScanText(value).replace(/\s+/g, "");
}

/**
 * @param {string | null | undefined} value
 * @returns {string[]}
 */
function extractSignificantTokens(value) {
  return normalizeScanText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length > 1)
    .filter((token) => !SCAN_NOISE_TOKENS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

/**
 * @param {string | null | undefined} value
 * @returns {Set<string>}
 */
function buildTokenSet(value) {
  return new Set(extractSignificantTokens(value));
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizeVersionLabel(value) {
  const normalized = String(value || "").trim();

  if (!normalized || /^unknown$/i.test(normalized)) {
    return "";
  }

  if (/^final$/i.test(normalized)) {
    return "final";
  }

  const versionLike = /(^v?\d)|(\d+\.\d+)|((ep|episode|chapter|season)\s*\d+)/i.test(
    normalized,
  );
  if (!versionLike) {
    return "";
  }

  return normalized
    .replace(/^version[\s._-]*/i, "")
    .replace(/^ver[\s._-]*/i, "")
    .replace(/^v(?=\d)/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * @param {string | null | undefined} value
 * @returns {string[]}
 */
function extractVersionParts(value) {
  return normalizeVersionLabel(value)
    .split(/[._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizeEngineName(value) {
  const normalized = buildCompactScanKey(value);

  if (!normalized) {
    return "";
  }

  if (normalized === "renpy" || normalized === "renpy64") {
    return "renpy";
  }

  if (
    normalized === "rpgm" ||
    normalized === "rpgmaker" ||
    normalized === "rpgmv" ||
    normalized === "rpgmz" ||
    normalized.startsWith("rpgmaker")
  ) {
    return "rpgm";
  }

  if (normalized === "unrealengine") {
    return "unreal";
  }

  return normalized;
}

/**
 * @param {string | null | undefined} value
 * @returns {Map<string, number>}
 */
function buildBigramMap(value) {
  const normalized = buildCompactScanKey(value);
  const bigrams = new Map();

  if (!normalized) {
    return bigrams;
  }

  if (normalized.length === 1) {
    bigrams.set(normalized, 1);
    return bigrams;
  }

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const gram = normalized.slice(index, index + 2);
    bigrams.set(gram, (bigrams.get(gram) || 0) + 1);
  }

  return bigrams;
}

/**
 * @param {string | null | undefined} left
 * @param {string | null | undefined} right
 * @returns {number}
 */
function diceCoefficient(left, right) {
  const leftKey = buildCompactScanKey(left);
  const rightKey = buildCompactScanKey(right);

  if (!leftKey || !rightKey) {
    return 0;
  }

  if (leftKey === rightKey) {
    return 1;
  }

  const leftBigrams = buildBigramMap(leftKey);
  const rightBigrams = buildBigramMap(rightKey);
  let intersection = 0;

  for (const [gram, leftCount] of leftBigrams.entries()) {
    const rightCount = rightBigrams.get(gram) || 0;
    intersection += Math.min(leftCount, rightCount);
  }

  const leftTotal = [...leftBigrams.values()].reduce((sum, count) => sum + count, 0);
  const rightTotal = [...rightBigrams.values()].reduce((sum, count) => sum + count, 0);

  if (leftTotal + rightTotal === 0) {
    return 0;
  }

  return (2 * intersection) / (leftTotal + rightTotal);
}

/**
 * @param {Iterable<string>} left
 * @param {Iterable<string>} right
 * @returns {number}
 */
function jaccardSimilarity(left, right) {
  const leftSet = left instanceof Set ? left : new Set(left);
  const rightSet = right instanceof Set ? right : new Set(right);

  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = leftSet.size + rightSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * @param {Iterable<string>} left
 * @param {Iterable<string>} right
 * @returns {number}
 */
function tokenOverlap(left, right) {
  const leftSet = left instanceof Set ? left : new Set(left);
  const rightSet = right instanceof Set ? right : new Set(right);

  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  return intersection / Math.max(1, Math.min(leftSet.size, rightSet.size));
}

/**
 * @param {string | null | undefined} left
 * @param {string | null | undefined} right
 * @returns {{ score: number, matchType: string }}
 */
function compareVersionLabels(left, right) {
  const leftVersion = normalizeVersionLabel(left);
  const rightVersion = normalizeVersionLabel(right);

  if (!leftVersion || !rightVersion) {
    return {
      score: 0,
      matchType: "missing",
    };
  }

  if (leftVersion === rightVersion) {
    return {
      score: 18,
      matchType: "exact",
    };
  }

  if (leftVersion.startsWith(rightVersion) || rightVersion.startsWith(leftVersion)) {
    return {
      score: 12,
      matchType: "prefix",
    };
  }

  const leftParts = extractVersionParts(leftVersion);
  const rightParts = extractVersionParts(rightVersion);
  const sharedLength = Math.min(leftParts.length, rightParts.length);
  let sharedPrefix = 0;

  while (sharedPrefix < sharedLength && leftParts[sharedPrefix] === rightParts[sharedPrefix]) {
    sharedPrefix += 1;
  }

  if (sharedPrefix >= 2) {
    return {
      score: 9,
      matchType: "shared-prefix",
    };
  }

  if (sharedPrefix >= 1) {
    return {
      score: 5,
      matchType: "major-match",
    };
  }

  return {
    score: -6,
    matchType: "conflict",
  };
}

module.exports = {
  SCAN_NOISE_TOKENS,
  normalizeScanText,
  buildCompactScanKey,
  extractSignificantTokens,
  buildTokenSet,
  normalizeVersionLabel,
  normalizeEngineName,
  diceCoefficient,
  jaccardSimilarity,
  tokenOverlap,
  compareVersionLabels,
};
