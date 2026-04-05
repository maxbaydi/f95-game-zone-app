// @ts-check

const { openDatabase } = require("./db/openDatabase");
const { parseScanTitle } = require("../shared/scanTitleParser");
const {
  extractSignificantTokens,
  normalizeVersionLabel,
} = require("../shared/scanMatchUtils");

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizePathKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
function hasMeaningfulCreator(value) {
  const creator = String(value || "").trim();
  if (!creator || /^unknown$/i.test(creator)) {
    return false;
  }

  return extractSignificantTokens(creator).length > 0;
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
function hasDetachedVersionTail(value) {
  const title = String(value || "").trim();
  if (!title) {
    return false;
  }

  return /\d(?:[\s._-]+\d+){1,}(?:\s+(?:alpha|beta|demo|fix|hotfix|patch|rus|eng))?$/i.test(
    title,
  );
}

/**
 * @param {string | null | undefined} value
 * @returns {number}
 */
function scoreTitleQuality(value) {
  const title = String(value || "").trim();
  if (!title) {
    return -50;
  }

  const parsed = parseScanTitle(title);
  const significantTokens = extractSignificantTokens(parsed.title);
  const digits = (title.match(/\d/g) || []).length;
  let score = 0;

  if (significantTokens.length > 0) {
    score += 12;
  }

  if (parsed.title === title) {
    score += 10;
  }

  if (!normalizeVersionLabel(title)) {
    score += 8;
  }

  if (/\s/.test(title)) {
    score += 4;
  }

  score -= Math.min(digits, 8);

  if (hasDetachedVersionTail(title)) {
    score -= 18;
  }

  return score;
}

/**
 * @param {any} game
 * @returns {number}
 */
function scoreGameForDuplicateResolution(game) {
  let score = 0;

  if (game?.atlas_id) {
    score += 100;
  }

  if (game?.f95_id) {
    score += 40;
  }

  if (hasMeaningfulCreator(game?.creator)) {
    score += 25;
  }

  if (String(game?.engine || "").trim() && !/^unknown$/i.test(String(game.engine))) {
    score += 10;
  }

  if (normalizeVersionLabel(game?.version)) {
    score += 8;
  }

  score += scoreTitleQuality(game?.title);
  score += Number(game?.record_id || 0) * 0.001;

  return score;
}

/**
 * @param {any[]} games
 * @returns {any | null}
 */
function choosePreferredDuplicateRecord(games) {
  const candidates = Array.isArray(games) ? [...games] : [];
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    return scoreGameForDuplicateResolution(right) - scoreGameForDuplicateResolution(left);
  });

  return candidates[0] || null;
}

/**
 * @param {any[]} games
 * @returns {Map<string, any[]>}
 */
function buildLibraryPathIndex(games) {
  const index = new Map();

  for (const game of Array.isArray(games) ? games : []) {
    for (const version of Array.isArray(game?.versions) ? game.versions : []) {
      const pathKey = normalizePathKey(version?.game_path);
      if (!pathKey) {
        continue;
      }

      if (!index.has(pathKey)) {
        index.set(pathKey, []);
      }

      index.get(pathKey).push(game);
    }
  }

  return index;
}

/**
 * @param {Map<string, any[]>} index
 * @param {string} gamePath
 * @returns {any | null}
 */
function findPreferredGameByPath(index, gamePath) {
  const matches = index.get(normalizePathKey(gamePath)) || [];
  return choosePreferredDuplicateRecord(matches);
}

/**
 * @param {any[]} games
 * @returns {Array<{ gamePath: string, winner: any, losers: any[] }>}
 */
function findDuplicateGamePathGroups(games) {
  const pathIndex = buildLibraryPathIndex(games);
  const groups = [];

  for (const [gamePath, matchedGames] of pathIndex.entries()) {
    const uniqueGames = [...new Map(
      matchedGames.map((game) => [Number(game?.record_id || 0), game]),
    ).values()];

    if (uniqueGames.length <= 1) {
      continue;
    }

    const winner = choosePreferredDuplicateRecord(uniqueGames);
    const losers = uniqueGames.filter(
      (game) => Number(game?.record_id || 0) !== Number(winner?.record_id || 0),
    );

    groups.push({
      gamePath,
      winner,
      losers,
    });
  }

  groups.sort((left, right) => left.gamePath.localeCompare(right.gamePath));
  return groups;
}

/**
 * @param {import("sqlite3").Database} db
 * @param {number} fromRecordId
 * @param {number} toRecordId
 */
async function migrateDuplicateRecordMetadata(db, fromRecordId, toRecordId) {
  const run = (sql, params) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, (err) => (err ? reject(err) : resolve(null)));
    });
  const get = (sql, params) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });

  await run(
    `UPDATE OR IGNORE save_profiles SET record_id = ? WHERE record_id = ?`,
    [toRecordId, fromRecordId],
  );

  const existingSyncState = await get(
    `SELECT record_id FROM save_sync_state WHERE record_id = ?`,
    [toRecordId],
  );
  if (!existingSyncState) {
    await run(
      `UPDATE save_sync_state SET record_id = ? WHERE record_id = ?`,
      [toRecordId, fromRecordId],
    );
  }

  const existingAtlasMapping = await get(
    `SELECT record_id FROM atlas_mappings WHERE record_id = ?`,
    [toRecordId],
  );
  if (!existingAtlasMapping) {
    await run(
      `UPDATE atlas_mappings SET record_id = ? WHERE record_id = ?`,
      [toRecordId, fromRecordId],
    );
  }

  const existingSteamMapping = await get(
    `SELECT record_id FROM steam_mappings WHERE record_id = ?`,
    [toRecordId],
  );
  if (!existingSteamMapping) {
    await run(
      `UPDATE steam_mappings SET record_id = ? WHERE record_id = ?`,
      [toRecordId, fromRecordId],
    );
  }

  const existingF95Mapping = await get(
    `SELECT record_id FROM f95_zone_mappings WHERE record_id = ?`,
    [toRecordId],
  );
  if (!existingF95Mapping) {
    await run(
      `UPDATE f95_zone_mappings SET record_id = ? WHERE record_id = ?`,
      [toRecordId, fromRecordId],
    );
  }

  await run(
    `UPDATE OR IGNORE tag_mappings SET record_id = ? WHERE record_id = ?`,
    [toRecordId, fromRecordId],
  );
}

/**
 * @param {{
 *   appPaths: any,
 *   getGames: (appPaths: any, offset: number, limit: number | null) => Promise<any[]>,
 *   deleteGameCompletely: (recordId: number, appPaths: any) => Promise<{ success: boolean, error?: string }>,
 *   dryRun?: boolean
 * }} input
 */
async function reconcileLibraryDuplicateGamePaths(input) {
  const games = await input.getGames(input.appPaths, 0, null);
  const groups = findDuplicateGamePathGroups(games);

  if (input.dryRun) {
    return {
      groups: groups.map((group) => ({
        gamePath: group.gamePath,
        winner: {
          recordId: group.winner.record_id,
          title: group.winner.title,
          creator: group.winner.creator,
          atlasId: group.winner.atlas_id || null,
          f95Id: group.winner.f95_id || null,
        },
        losers: group.losers.map((game) => ({
          recordId: game.record_id,
          title: game.title,
          creator: game.creator,
          atlasId: game.atlas_id || null,
          f95Id: game.f95_id || null,
        })),
      })),
      removed: [],
      failed: [],
    };
  }

  const db = await openDatabase(input.appPaths);
  const removed = [];
  const failed = [];

  for (const group of groups) {
    for (const loser of group.losers) {
      try {
        await migrateDuplicateRecordMetadata(
          db,
          loser.record_id,
          group.winner.record_id,
        );
        const deleteResult = await input.deleteGameCompletely(
          loser.record_id,
          input.appPaths,
        );
        if (!deleteResult?.success) {
          failed.push({
            gamePath: group.gamePath,
            winnerRecordId: group.winner.record_id,
            loserRecordId: loser.record_id,
            error: deleteResult?.error || "Duplicate cleanup failed.",
          });
          continue;
        }

        removed.push({
          gamePath: group.gamePath,
          winnerRecordId: group.winner.record_id,
          loserRecordId: loser.record_id,
        });
      } catch (error) {
        failed.push({
          gamePath: group.gamePath,
          winnerRecordId: group.winner.record_id,
          loserRecordId: loser.record_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    groups: groups.map((group) => ({
      gamePath: group.gamePath,
      winner: {
        recordId: group.winner.record_id,
        title: group.winner.title,
        creator: group.winner.creator,
        atlasId: group.winner.atlas_id || null,
        f95Id: group.winner.f95_id || null,
      },
      losers: group.losers.map((game) => ({
        recordId: game.record_id,
        title: game.title,
        creator: game.creator,
        atlasId: game.atlas_id || null,
        f95Id: game.f95_id || null,
      })),
    })),
    removed,
    failed,
  };
}

module.exports = {
  buildLibraryPathIndex,
  choosePreferredDuplicateRecord,
  findDuplicateGamePathGroups,
  findPreferredGameByPath,
  normalizePathKey,
  reconcileLibraryDuplicateGamePaths,
  scoreGameForDuplicateResolution,
};
