// @ts-check

/**
 * @param {any} game
 * @returns {boolean}
 */
function shouldAutoImportScanGame(game) {
  return String(game?.matchStatus || "").toLowerCase() === "matched";
}

/**
 * Splits scan results into games that are imported automatically and games
 * that wait for review.
 *
 * A folder the library already knows is always refreshed (marked with
 * `refreshExisting`), even when the Atlas match is not confident: the record
 * exists, so a rescan must update its files and version instead of parking it
 * in the review queue.
 *
 * @param {any[]} games
 * @param {{ isKnownPath?: (folder: string) => boolean }=} options
 * @returns {{ importableGames: any[], reviewGames: any[] }}
 */
function splitAutoImportableScanGames(games, options = {}) {
  const isKnownPath =
    typeof options.isKnownPath === "function" ? options.isKnownPath : null;
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

    if (shouldAutoImportScanGame(game)) {
      importableGames.push(game);
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
  shouldAutoImportScanGame,
  splitAutoImportableScanGames,
};
