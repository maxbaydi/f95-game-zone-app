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
  upsertF95ZoneMapping,
} = require("../src/database");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-stage0-f95map-"));
}

function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve(this);
    });
  });
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

test("f95 zone mappings resolve site urls for library stubs without installed files", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await initializeDatabase(appPaths);

  await runAsync(
    db,
    `
      INSERT INTO f95_zone_data (f95_id, atlas_id, site_url, banner_url, views, likes, tags, rating, screens, replies)
      VALUES (?, ?, ?, '', '', '', '', '', '', '')
    `,
    [123, null, "https://f95zone.to/threads/example-thread.123/"],
  );

  const mappedRecordId = await addGame({
    title: "Mapped Thread",
    creator: "Dev",
    engine: "Unknown",
  });
  await upsertF95ZoneMapping(
    mappedRecordId,
    123,
    "https://f95zone.to/threads/example-thread.123/",
  );

  const mappedGame = await getGame(mappedRecordId, appPaths);
  assert.equal(String(mappedGame.f95_id), "123");
  assert.equal(
    mappedGame.siteUrl,
    "https://f95zone.to/threads/example-thread.123/",
  );
  assert.equal(mappedGame.versions.length, 0);

  const fallbackRecordId = await addGame({
    title: "Fallback Thread",
    creator: "Dev",
    engine: "Unknown",
  });
  await upsertF95ZoneMapping(
    fallbackRecordId,
    456,
    "https://f95zone.to/threads/fallback-thread.456/",
  );

  const allGames = await getGames(appPaths, 0, null);
  const fallbackGame = allGames.find((game) => game.record_id === fallbackRecordId);

  assert.ok(fallbackGame);
  assert.equal(String(fallbackGame.f95_id), "456");
  assert.equal(
    fallbackGame.siteUrl,
    "https://f95zone.to/threads/fallback-thread.456/",
  );
  assert.equal(fallbackGame.versions.length, 0);

  await closeAsync(db);
});
