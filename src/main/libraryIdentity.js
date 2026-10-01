// @ts-check

/**
 * Stable identity of a library game across installs and PCs, used to match
 * records that arrive without a record id (thread installs, scan results,
 * save backups). Strongest identifier first: F95 thread id, thread
 * URL, then a compact title + creator key.
 */

const { buildCompactScanKey } = require("../shared/scanMatchUtils");

/**
 * @param {unknown} value
 */
function normalizeCatalogUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.replace(/\/+$/, "").toLowerCase();
}

/**
 * @param {{
 *   f95Id?: unknown,
 *   siteUrl?: unknown,
 *   title?: unknown,
 *   displayTitle?: unknown,
 *   creator?: unknown,
 *   displayCreator?: unknown,
 * } | null | undefined} input
 * @returns {string[]}
 */
function buildLibraryIdentityCandidates(input) {
  /** @type {string[]} */
  const candidates = [];
  const seenValues = new Set();
  const pushCandidate = (/** @type {unknown} */ value) => {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue || seenValues.has(normalizedValue)) {
      return;
    }

    seenValues.add(normalizedValue);
    candidates.push(normalizedValue);
  };

  const f95Id = String(input?.f95Id || "").trim();
  if (f95Id) {
    pushCandidate(`f95:${f95Id}`);
  }

  const siteUrl = normalizeCatalogUrl(input?.siteUrl);
  if (siteUrl) {
    pushCandidate(`site:${siteUrl}`);
  }

  const titleKey = buildCompactScanKey(
    String(input?.title || input?.displayTitle || ""),
  );
  const creatorKey = buildCompactScanKey(
    String(input?.creator || input?.displayCreator || ""),
  );

  if (titleKey) {
    pushCandidate(`title:${titleKey}|creator:${creatorKey || "unknown"}`);
  }

  return candidates;
}

/**
 * @param {Parameters<typeof buildLibraryIdentityCandidates>[0]} input
 * @returns {string}
 */
function buildLibraryIdentity(input) {
  return buildLibraryIdentityCandidates(input)[0] || "";
}

module.exports = {
  buildLibraryIdentity,
  buildLibraryIdentityCandidates,
  normalizeCatalogUrl,
};
