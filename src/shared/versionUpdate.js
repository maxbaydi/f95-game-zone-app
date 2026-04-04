"use strict";

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizeVersionLabel(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string | null | undefined} value
 * @returns {{ raw: string, parts: number[], isFinal: boolean }}
 */
function tokenizeVersion(value) {
  const raw = normalizeVersionLabel(value);
  const lower = raw.toLowerCase();
  const isFinal = lower.includes("final");
  const numericMatch = lower.match(/\d+(?:\.\d+)*/);
  const parts = numericMatch
    ? numericMatch[0]
        .split(".")
        .map((segment) => Number.parseInt(segment, 10))
        .filter((segment) => Number.isFinite(segment))
    : [];

  return {
    raw,
    parts,
    isFinal,
  };
}

/**
 * @param {{ raw: string, parts: number[], isFinal: boolean } | null | undefined} left
 * @param {{ raw: string, parts: number[], isFinal: boolean } | null | undefined} right
 * @returns {number}
 */
function compareVersionTokens(left, right) {
  if (!left?.raw && !right?.raw) {
    return 0;
  }

  if (!left?.raw) {
    return -1;
  }

  if (!right?.raw) {
    return 1;
  }

  if (left.isFinal && !right.isFinal) {
    return 1;
  }

  if (!left.isFinal && right.isFinal) {
    return -1;
  }

  const maxLength = Math.max(left.parts.length, right.parts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left.parts[index] || 0;
    const rightPart = right.parts[index] || 0;

    if (leftPart > rightPart) {
      return 1;
    }

    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

/**
 * @param {Array<{ version?: string | null }>} versions
 * @returns {string}
 */
function getNewestInstalledVersion(versions) {
  /** @type {{ raw: string, parts: number[], isFinal: boolean } | null} */
  let newestToken = null;

  for (const versionEntry of versions || []) {
    const token = tokenizeVersion(versionEntry?.version);
    if (!token.raw) {
      continue;
    }

    if (!newestToken || compareVersionTokens(token, newestToken) > 0) {
      newestToken = token;
    }
  }

  return newestToken?.raw || "";
}

/**
 * @param {string | null | undefined} latestVersion
 * @param {Array<{ version?: string | null }>} versions
 * @returns {{
 *   hasUpdate: boolean,
 *   latestVersion: string,
 *   newestInstalledVersion: string,
 *   hasFinalInstalled: boolean
 * }}
 */
function buildVersionUpdateState(latestVersion, versions) {
  const latestToken = tokenizeVersion(latestVersion);
  const installedTokens = (versions || [])
    .map((versionEntry) => tokenizeVersion(versionEntry?.version))
    .filter((token) => token.raw);

  const newestInstalledToken = installedTokens.reduce((currentNewest, token) => {
    if (!currentNewest || compareVersionTokens(token, currentNewest) > 0) {
      return token;
    }

    return currentNewest;
  }, null);

  const hasFinalInstalled = installedTokens.some((token) => token.isFinal);
  const newestInstalledVersion = newestInstalledToken?.raw || "";

  if (!latestToken.raw || !newestInstalledToken) {
    return {
      hasUpdate: false,
      latestVersion: latestToken.raw,
      newestInstalledVersion,
      hasFinalInstalled,
    };
  }

  if (hasFinalInstalled) {
    return {
      hasUpdate: false,
      latestVersion: latestToken.raw,
      newestInstalledVersion,
      hasFinalInstalled,
    };
  }

  if (latestToken.isFinal) {
    return {
      hasUpdate: true,
      latestVersion: latestToken.raw,
      newestInstalledVersion,
      hasFinalInstalled,
    };
  }

  if (latestToken.parts.length === 0 || newestInstalledToken.parts.length === 0) {
    return {
      hasUpdate: false,
      latestVersion: latestToken.raw,
      newestInstalledVersion,
      hasFinalInstalled,
    };
  }

  return {
    hasUpdate: compareVersionTokens(newestInstalledToken, latestToken) < 0,
    latestVersion: latestToken.raw,
    newestInstalledVersion,
    hasFinalInstalled,
  };
}

module.exports = {
  buildVersionUpdateState,
  compareVersionTokens,
  getNewestInstalledVersion,
  normalizeVersionLabel,
  tokenizeVersion,
};
