const test = require("node:test");
const assert = require("node:assert/strict");
const sqlite3 = require("sqlite3");

const { createAtlasScanMatcher } = require("../src/main/scanAtlasMatcher");

function openMemoryDatabase() {
  return new sqlite3.Database(":memory:");
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

async function seedAtlasTables(db) {
  await run(
    db,
    `
      CREATE TABLE atlas_data
      (
        atlas_id INTEGER PRIMARY KEY,
        id_name TEXT,
        short_name TEXT,
        title TEXT,
        original_name TEXT,
        creator TEXT,
        developer TEXT,
        engine TEXT,
        version TEXT
      )
    `,
  );
  await run(
    db,
    `
      CREATE TABLE f95_zone_data
      (
        f95_id INTEGER PRIMARY KEY,
        atlas_id INTEGER,
        site_url TEXT
      )
    `,
  );
  await run(
    db,
    `
      INSERT INTO atlas_data
        (atlas_id, id_name, short_name, title, original_name, creator, developer, engine, version)
      VALUES
        (1, 'summer-time-saga', 'SUMMERTIMESAGA', 'Summer Time Saga', '', 'Icstor', 'Icstor', 'Ren''Py', '0.20.0'),
        (2, 'eternum', 'ETERNUM', 'Eternum', '', 'Caribdis', 'Caribdis', 'Ren''Py', '0.8'),
        (3, 'eternum-remake', 'ETERNUMREMAKE', 'Eternum', '', 'Other Dev', 'Other Dev', 'Unity', '1.0')
    `,
  );
  await run(
    db,
    `
      INSERT INTO f95_zone_data
        (f95_id, atlas_id, site_url)
      VALUES
        (1001, 1, 'https://f95zone.to/threads/summer-time-saga.1001/'),
        (1002, 2, 'https://f95zone.to/threads/eternum.1002/'),
        (1003, 3, 'https://f95zone.to/threads/eternum-remake.1003/')
    `,
  );
}

test("Atlas scan matcher auto-matches when title and creator corroborate the same entry", async () => {
  const db = openMemoryDatabase();
  await seedAtlasTables(db);

  const matcher = await createAtlasScanMatcher(db);
  const result = matcher.matchCandidate({
    titleVariants: [
      {
        value: "Summer Time Saga",
        source: "renpy-options",
        weight: 110,
      },
    ],
    creatorHints: ["Icstor"],
    versionHints: ["0.20.0"],
    engine: "renpy",
  });

  assert.equal(result.status, "matched");
  assert.equal(result.autoMatch, true);
  assert.equal(result.bestMatch?.atlasId, 1);
  assert.equal(result.bestMatch?.f95Id, 1001);
});

test("Atlas scan matcher keeps same-title collisions ambiguous without corroborating signals", async () => {
  const db = openMemoryDatabase();
  await seedAtlasTables(db);

  const matcher = await createAtlasScanMatcher(db);
  const result = matcher.matchCandidate({
    titleVariants: [
      {
        value: "Eternum",
        source: "folder-name",
        weight: 60,
      },
    ],
    creatorHints: [],
    versionHints: [],
    engine: "",
  });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.autoMatch, false);
  assert.equal(result.matches.length, 2);
});

test("Atlas scan matcher can use Atlas short_name aliases for high-confidence matches", async () => {
  const db = openMemoryDatabase();
  await seedAtlasTables(db);

  const matcher = await createAtlasScanMatcher(db);
  const result = matcher.matchCandidate({
    titleVariants: [
      {
        value: "SUMMERTIMESAGA",
        source: "executable-name",
        weight: 76,
      },
    ],
    creatorHints: ["Icstor"],
    versionHints: ["v0.20"],
    engine: "Ren'Py",
  });

  assert.equal(result.status, "matched");
  assert.equal(result.autoMatch, true);
  assert.equal(result.bestMatch?.atlasId, 1);
});
