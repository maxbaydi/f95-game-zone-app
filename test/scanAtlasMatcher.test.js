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
        (3, 'eternum-remake', 'ETERNUMREMAKE', 'Eternum', '', 'Other Dev', 'Other Dev', 'Unity', '1.0'),
        (4, 'not-a-failure-to-launch', 'NOTAFAILURETOLAUNCH', 'Not a Failure to Launch', '', 'NotAFailureToLaunch', '', 'Unity', '0.5.7'),
        (5, 'a-failure-to-launch', 'AFAILURETOLAUNCH', 'A Failure to Launch', '', 'Min Thy Lord', '', 'Ren''Py', '0.2.1'),
        (6, 'my-hotwife-legacy', 'MYHOTWIFE', 'My Hotwife', '', 'My Hotwife', '', 'Ren''Py', '1.5'),
        (7, 'my-hotwife', 'MYHOTWIFE', 'My Hotwife', '', 'Ben Lucky', '', 'Ren''Py', '2.16'),
        (8, 'willing-temptations', 'WILLINGTEMPTATIONS', 'Willing Temptations', '', 'Abyss Exploration', '', 'Ren''Py', '0.4 Hotfix 1'),
        (9, 'temptations', 'TEMPTATIONS', 'Temptations', '', 'Cris22', '', 'Ren''Py', '0.1'),
        (10, 'dark-temptations', 'DARKTEMPTATIONS', 'Dark Temptations', '', 'Overactive Imagination Games', '', 'Ren''Py', '0.1.13'),
        (11, 'gamer-girl-adventure', 'GAMERGIRLADVENTURE', 'Gamer Girl Adventure', '', 'Katrina 3Dx', '', 'Ren''Py', 'Final'),
        (12, 'libertas-awakened-lust', 'LIBERTASAWAKENEDLUST', 'Libertas: Awakened Lust', '', 'Asuka137x', '', 'Ren''Py', '0.04'),
        (13, 'new-life-with-my-daughter', 'NEWLIFEWITHMYDAUGHTER', 'New Life with My Daughter', '', 'VanderGames', '', 'Ren''Py', '0.7.0b'),
        (14, 'date-a-giantess', 'DATEAGIANTESS', 'Date a Giantess', '', 'GiantessNexus', '', 'Ren''Py', '5.22')
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
        (1003, 3, 'https://f95zone.to/threads/eternum-remake.1003/'),
        (1004, 4, 'https://f95zone.to/threads/not-a-failure-to-launch.1004/'),
        (1005, 5, 'https://f95zone.to/threads/a-failure-to-launch.1005/'),
        (1007, 7, 'https://f95zone.to/threads/my-hotwife.1007/'),
        (1008, 8, 'https://f95zone.to/threads/willing-temptations.1008/'),
        (1009, 9, 'https://f95zone.to/threads/temptations.1009/'),
        (1010, 10, 'https://f95zone.to/threads/dark-temptations.1010/'),
        (1011, 11, 'https://f95zone.to/threads/gamer-girl-adventure.1011/'),
        (1012, 12, 'https://f95zone.to/threads/libertas-awakened-lust.1012/'),
        (1013, 13, 'https://f95zone.to/threads/new-life-with-my-daughter.1013/'),
        (1014, 14, 'https://f95zone.to/threads/date-a-giantess.1014/')
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

test("Atlas scan matcher auto-matches exact titles even when a nearby fuzzy title exists", async () => {
  const db = openMemoryDatabase();
  await seedAtlasTables(db);

  const matcher = await createAtlasScanMatcher(db);
  const result = matcher.matchCandidate({
    titleVariants: [
      {
        value: "Not A Failure To Launch",
        source: "executable-name",
        weight: 76,
      },
    ],
    creatorHints: [],
    versionHints: ["0.5"],
    engine: "Unknown",
  });

  assert.equal(result.status, "matched");
  assert.equal(result.autoMatch, true);
  assert.equal(result.bestMatch?.atlasId, 4);
});

test("Atlas scan matcher prefers the correct same-title branch using version evidence", async () => {
  const db = openMemoryDatabase();
  await seedAtlasTables(db);

  const matcher = await createAtlasScanMatcher(db);
  const result = matcher.matchCandidate({
    titleVariants: [
      {
        value: "My Hotwife",
        source: "renpy-options",
        weight: 110,
      },
    ],
    creatorHints: [],
    versionHints: ["2.15", "unknown"],
    engine: "renpy",
  });

  assert.equal(result.status, "matched");
  assert.equal(result.autoMatch, true);
  assert.equal(result.bestMatch?.atlasId, 7);
  assert.ok((result.margin || 0) >= 15);
});

test("Atlas scan matcher rejects short substring collisions when a full exact title exists", async () => {
  const db = openMemoryDatabase();
  await seedAtlasTables(db);

  const matcher = await createAtlasScanMatcher(db);
  const result = matcher.matchCandidate({
    titleVariants: [
      {
        value: "Willing Temptations",
        source: "renpy-options",
        weight: 110,
      },
    ],
    creatorHints: [],
    versionHints: ["0.4.1 Hotfix 1"],
    engine: "renpy",
  });

  assert.equal(result.status, "matched");
  assert.equal(result.autoMatch, true);
  assert.equal(result.bestMatch?.atlasId, 8);
});

test("Atlas scan matcher can auto-match a near-exact parent-folder title when the margin is decisive", async () => {
  const db = openMemoryDatabase();
  await seedAtlasTables(db);

  const matcher = await createAtlasScanMatcher(db);
  const result = matcher.matchCandidate({
    titleVariants: [
      {
        value: "Libertas Awakened Lust",
        source: "parent-folder",
        weight: 68,
      },
      {
        value: "Libertas",
        source: "executable-name",
        weight: 76,
      },
    ],
    creatorHints: [],
    versionHints: ["0.4"],
    engine: "renpy",
  });

  assert.equal(result.status, "matched");
  assert.equal(result.autoMatch, true);
  assert.equal(result.bestMatch?.atlasId, 12);
});

test("Atlas scan matcher can auto-match exact version plus creator derived from folder metadata", async () => {
  const db = openMemoryDatabase();
  await seedAtlasTables(db);

  const matcher = await createAtlasScanMatcher(db);
  const result = matcher.matchCandidate({
    titleVariants: [
      {
        value: "New Life with My Daughter",
        source: "parent-folder",
        weight: 68,
      },
      {
        value: "NLWMD",
        source: "executable-name",
        weight: 76,
      },
    ],
    creatorHints: ["Vander Games"],
    versionHints: ["0.7.0b"],
    engine: "renpy",
  });

  assert.equal(result.status, "matched");
  assert.equal(result.autoMatch, true);
  assert.equal(result.bestMatch?.atlasId, 13);
});

test("Atlas scan matcher can auto-match creator-anchored titles with wording drift", async () => {
  const db = openMemoryDatabase();
  await seedAtlasTables(db);

  const matcher = await createAtlasScanMatcher(db);
  const result = matcher.matchCandidate({
    titleVariants: [
      {
        value: "Dating a Giantess",
        source: "renpy-options",
        weight: 118,
      },
      {
        value: "Dating a Giantess by Giantess Nexus",
        source: "renpy-options",
        weight: 110,
      },
    ],
    creatorHints: ["Giantess Nexus"],
    versionHints: ["5.22"],
    engine: "renpy",
  });

  assert.equal(result.status, "matched");
  assert.equal(result.autoMatch, true);
  assert.equal(result.bestMatch?.atlasId, 14);
});

test("Atlas scan matcher can auto-match a single clear title even when Atlas only has final version", async () => {
  const db = openMemoryDatabase();
  await seedAtlasTables(db);

  const matcher = await createAtlasScanMatcher(db);
  const result = matcher.matchCandidate({
    titleVariants: [
      {
        value: "Gamer Girl Adventure",
        source: "parent-folder",
        weight: 68,
      },
      {
        value: "GGA",
        source: "executable-name",
        weight: 76,
      },
    ],
    creatorHints: [],
    versionHints: ["2.0"],
    engine: "renpy",
  });

  assert.equal(result.status, "matched");
  assert.equal(result.autoMatch, true);
  assert.equal(result.bestMatch?.atlasId, 11);
});
