// @ts-check

/**
 * Linking a library record to a catalog entry chosen by the user ("Link to
 * catalog…"): the thread mapping of that entry and the catalog's
 * title/creator/engine. Pure logic with injected database access.
 */

// One implementation for main and renderer: a record without a catalog entry,
// thread id or thread link needs to be linked by the user.
const { needsCatalogLink } = require("../shared/libraryInstallState");

const LOG_SCOPE = "[library.catalog]";

const CATALOG_LINK_ERROR_MESSAGES = Object.freeze({
  INVALID_INPUT: "Choose a game from the catalog list.",
  CATALOG_LINK_FAILED:
    "This game could not be linked to the catalog entry. Try again or pick another entry.",
});

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPositiveInteger(value) {
  return Number.isInteger(value) && Number(value) > 0;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

/**
 * @param {{
 *   recordId: number,
 *   f95Id: number,
 *   game?: any,
 *   deps: {
 *     getCatalogEntry: (f95Id: number) => Promise<{ f95Id: number, title: string, creator: string, engine: string, version: string, siteUrl: string } | null>,
 *     upsertF95ZoneMapping: (recordId: number, f95Id: string, siteUrl: string) => Promise<unknown>,
 *     updateGame: (game: { record_id: number, title: string, creator: string, engine: string }) => Promise<unknown>
 *   },
 *   logger?: { warn: Function }
 * }} input
 */
async function linkGameToCatalog(input) {
  const logger = input.logger || console;
  const { recordId, f95Id, deps } = input;

  if (!isPositiveInteger(recordId) || !isPositiveInteger(f95Id)) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: CATALOG_LINK_ERROR_MESSAGES.INVALID_INPUT,
    };
  }

  let entry = null;
  let siteUrl = "";
  try {
    entry = await deps.getCatalogEntry(f95Id);
    if (!entry) {
      throw new Error(`catalog entry ${f95Id} does not exist`);
    }
    siteUrl = normalizeText(entry.siteUrl) || `https://f95zone.to/threads/${f95Id}/`;
    await deps.upsertF95ZoneMapping(recordId, String(f95Id), siteUrl);
  } catch (error) {
    logger.warn(`${LOG_SCOPE} Linking to the catalog failed:`, {
      recordId,
      f95Id,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      code: "CATALOG_LINK_FAILED",
      error: CATALOG_LINK_ERROR_MESSAGES.CATALOG_LINK_FAILED,
    };
  }

  // The user picked this entry, so its metadata replaces whatever the folder
  // name produced. A failure here keeps the link (the list already shows the
  // catalog title) and only reports that the stored names were not changed.
  let metadataUpdated = false;
  try {
    const game = input.game || {};
    const next = {
      record_id: recordId,
      title: normalizeText(entry.title) || normalizeText(game.title),
      creator: normalizeText(entry.creator) || normalizeText(game.creator),
      engine: normalizeText(entry.engine) || normalizeText(game.engine),
    };
    const changed =
      next.title !== normalizeText(game.title) ||
      next.creator !== normalizeText(game.creator) ||
      next.engine !== normalizeText(game.engine);

    if (changed && next.title) {
      await deps.updateGame(next);
      metadataUpdated = true;
    }
  } catch (error) {
    logger.warn(`${LOG_SCOPE} Catalog metadata was not applied:`, {
      recordId,
      f95Id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    success: true,
    f95Id: String(f95Id),
    siteUrl,
    metadataUpdated,
  };
}

module.exports = {
  CATALOG_LINK_ERROR_MESSAGES,
  linkGameToCatalog,
  needsCatalogLink,
};
