// @ts-check

const { showSystemNotification } = require("./systemNotification");

/**
 * @param {Array<any>} games
 * @returns {string}
 */
function buildLibraryUpdateNotificationKey(games) {
  return games
    .filter((game) => game?.isUpdateAvailable && game?.record_id != null)
    .map((game) => String(game.record_id))
    .sort()
    .join(",");
}

/**
 * @param {Array<any>} games
 * @returns {{ title: string, body: string } | null}
 */
function buildLibraryUpdateNotificationPayload(games) {
  if (!Array.isArray(games) || games.length === 0) {
    return null;
  }

  if (games.length === 1) {
    const game = games[0];
    const title = String(game?.displayTitle || game?.title || "A game").trim();

    return {
      title: "F95Launcher — Library update available",
      body: `${title} has a new version available in your library.`,
    };
  }

  return {
    title: "F95Launcher — Library updates available",
    body: `${games.length} games in your library have new versions available.`,
  };
}

/**
 * @param {{
 *   Notification: any,
 *   iconPath?: string | null,
 *   onClick?: (() => void) | null,
 * }} input
 */
function createLibraryUpdateNotificationController(input) {
  let lastNotifiedLibraryUpdateKey = "";

  /**
   * @param {{
   *   getGames: () => Promise<Array<any>>,
   *   allowNotify?: boolean,
   * }} options
   */
  async function syncFromAllGames(options) {
    if (!options || typeof options.getGames !== "function") {
      throw new Error("syncFromAllGames requires getGames");
    }
    const games = await options.getGames();
    const updateGames = games.filter((game) => game?.isUpdateAvailable === true);
    const notificationKey = buildLibraryUpdateNotificationKey(updateGames);

    if (!notificationKey) {
      lastNotifiedLibraryUpdateKey = "";
      return {
        count: 0,
        notified: false,
        games: updateGames,
      };
    }

    if (
      !options.allowNotify ||
      notificationKey === lastNotifiedLibraryUpdateKey
    ) {
      return {
        count: updateGames.length,
        notified: false,
        games: updateGames,
      };
    }

    const payload = buildLibraryUpdateNotificationPayload(updateGames);
    if (!payload) {
      return {
        count: updateGames.length,
        notified: false,
        games: updateGames,
      };
    }

    const shown = showSystemNotification({
      Notification: input.Notification,
      title: payload.title,
      body: payload.body,
      icon: input.iconPath || null,
      onClick: input.onClick || null,
    });

    if (shown) {
      lastNotifiedLibraryUpdateKey = notificationKey;
    }

    return {
      count: updateGames.length,
      notified: shown,
      games: updateGames,
    };
  }

  return {
    syncFromAllGames,
  };
}

module.exports = {
  buildLibraryUpdateNotificationKey,
  buildLibraryUpdateNotificationPayload,
  createLibraryUpdateNotificationController,
};
