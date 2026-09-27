// @ts-check

/**
 * Linking a library record to a catalog entry chosen by the user ("Link to
 * catalog…"): the Atlas mapping, the F95 thread of that entry and the
 * catalog's title/creator/engine. Pure logic with injected database access.
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
 *   atlasId: number,
 *   game?: any,
 *   deps: {
 *     addAtlasMapping: (recordId: number, atlasId: number) => Promise<unknown>,
 *     getAtlasData: (atlasId: number) => Promise<any>,
 *     getF95ZoneDataByAtlasId: (atlasId: number) => Promise<{ f95_id?: unknown, site_url?: string } | null>,
 *     upsertF95ZoneMapping: (recordId: number, f95Id: string, siteUrl: string) => Promise<unknown>,
 *     updateGame: (game: { record_id: number, title: string, creator: string, engine: string }) => Promise<unknown>
 *   },
 *   logger?: { warn: Function }
 * }} input
 */
async function linkGameToCatalog(input) {
  const logger = input.logger || console;
  const { recordId, atlasId, deps } = input;

  if (!isPositiveInteger(recordId) || !isPositiveInteger(atlasId)) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: CATALOG_LINK_ERROR_MESSAGES.INVALID_INPUT,
    };
  }

  let f95Id = "";
  let siteUrl = "";
  try {
    await deps.addAtlasMapping(recordId, atlasId);

    const threadData = await deps.getF95ZoneDataByAtlasId(atlasId);
    f95Id = normalizeText(threadData?.f95_id);
    siteUrl = normalizeText(threadData?.site_url);
    if (f95Id) {
      await deps.upsertF95ZoneMapping(recordId, f95Id, siteUrl);
    } else {
      siteUrl = "";
    }
  } catch (error) {
    logger.warn(`${LOG_SCOPE} Linking to the catalog failed:`, {
      recordId,
      atlasId,
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
    const catalog = (await deps.getAtlasData(atlasId)) || {};
    const game = input.game || {};
    const next = {
      record_id: recordId,
      title: normalizeText(catalog.title) || normalizeText(game.title),
      creator: normalizeText(catalog.creator) || normalizeText(game.creator),
      engine: normalizeText(catalog.engine) || normalizeText(game.engine),
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
      atlasId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    success: true,
    atlasId,
    f95Id,
    siteUrl,
    metadataUpdated,
  };
}

module.exports = {
  CATALOG_LINK_ERROR_MESSAGES,
  linkGameToCatalog,
  needsCatalogLink,
};
