// @ts-check

/**
 * Minimum detection score (0-100, see f95scanner detection reasons) for a
 * folder without a confident catalog match to be added automatically. Folders
 * with launchers of a known engine or a single launcher reach it; loose
 * archives and folders with nothing but a name do not.
 */
const MIN_UNMATCHED_DETECTION_SCORE = 40;

/**
 * @param {any} game
 * @returns {boolean}
 */
function isCatalogMatched(game) {
  return String(game?.matchStatus || "").toLowerCase() === "matched";
}

/**
 * A scan result is imported without review when the catalog match is
 * confident, or when the folder clearly is a game (high detection score) even
 * though the catalog has no confident match. Archives are never imported
 * without a match: their content cannot be checked before extraction.
 *
 * @param {any} game
 * @param {{ minUnmatchedDetectionScore?: number }=} options
 * @returns {boolean}
 */
function shouldAutoImportScanGame(game, options = {}) {
  if (isCatalogMatched(game)) {
    return true;
  }

  const threshold = Number.isFinite(options.minUnmatchedDetectionScore)
    ? Number(options.minUnmatchedDetectionScore)
    : MIN_UNMATCHED_DETECTION_SCORE;
  const detectionScore = Number(game?.detectionScore);

  return (
    !game?.isArchive &&
    Number.isFinite(detectionScore) &&
    detectionScore >= threshold
  );
}

/**
 * Splits scan results into games that are imported automatically and games
 * that wait for review.
 *
 * A folder the library already knows is always refreshed (marked with
 * `refreshExisting`), even when the Atlas match is not confident: the record
 * exists, so a rescan must update its files and version instead of parking it
 * in the review queue. New folders without a confident match that are clearly
 * games are imported with `importUnmatched` so the summary can count them and
 * the user can link them to the catalog later.
 *
 * @param {any[]} games
 * @param {{
 *   isKnownPath?: (folder: string) => boolean,
 *   minUnmatchedDetectionScore?: number
 * }=} options
 * @returns {{ importableGames: any[], reviewGames: any[] }}
 */
function splitAutoImportableScanGames(games, options = {}) {
  const isKnownPath =
    typeof options.isKnownPath === "function" ? options.isKnownPath : null;
  const policyOptions = {
    minUnmatchedDetectionScore: options.minUnmatchedDetectionScore,
  };
  const importableGames = [];
  const reviewGames = [];

  for (const game of Array.isArray(games) ? games : []) {
    let isKnown = false;
    if (isKnownPath) {
      try {
        isKnown = Boolean(isKnownPath(String(game?.folder || "")));
      } catch {
        isKnown = false;
      }
    }

    if (isKnown) {
      importableGames.push({ ...game, refreshExisting: true });
      continue;
    }

    if (isCatalogMatched(game)) {
      importableGames.push(game);
      continue;
    }

    if (shouldAutoImportScanGame(game, policyOptions)) {
      importableGames.push({ ...game, importUnmatched: true });
      continue;
    }

    reviewGames.push(game);
  }

  return {
    importableGames,
    reviewGames,
  };
}

module.exports = {
  MIN_UNMATCHED_DETECTION_SCORE,
  shouldAutoImportScanGame,
  splitAutoImportableScanGames,
};
