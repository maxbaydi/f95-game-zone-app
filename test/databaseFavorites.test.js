const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const {
  initializeDatabase,
  addGame,
  getGame,
  getGames,
  setGameFavorite,
} = require("../src/database");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-db-favorites-"));
}

function closeAsync(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

test("setGameFavorite persists favorite flag in getGame and getGames", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await initializeDatabase(appPaths);

  const recordId = await addGame({
    title: "Favorite Test",
    creator: "Atlas QA",
    engine: "Ren'Py",
  });

  const initialGame = await getGame(recordId, appPaths);
  assert.equal(initialGame?.isFavorite, false);

  await setGameFavorite(recordId, true);

  const favoriteGame = await getGame(recordId, appPaths);
  assert.equal(favoriteGame?.isFavorite, true);

  const gamesAfterFavorite = await getGames(appPaths, 0, null);
  const listFavoriteGame = gamesAfterFavorite.find(
    (game) => game.record_id === recordId,
  );
  assert.ok(listFavoriteGame);
  assert.equal(listFavoriteGame.isFavorite, true);

  await setGameFavorite(recordId, false);

  const restoredGame = await getGame(recordId, appPaths);
  assert.equal(restoredGame?.isFavorite, false);

  await closeAsync(db);
});
