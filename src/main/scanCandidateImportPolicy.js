// @ts-check

/**
 * @param {any} game
 * @returns {boolean}
 */
function shouldAutoImportScanGame(game) {
  return String(game?.matchStatus || "").toLowerCase() === "matched";
}

/**
 * @param {any[]} games
 * @returns {{ importableGames: any[], reviewGames: any[] }}
 */
function splitAutoImportableScanGames(games) {
  const importableGames = [];
  const reviewGames = [];

  for (const game of Array.isArray(games) ? games : []) {
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
