const test = require("node:test");
const assert = require("node:assert/strict");
const sqlite3 = require("sqlite3");

const { runMigrations } = require("../src/main/db/runMigrations");
const { createCatalogScanMatcher } = require("../src/main/scanCatalogMatcher");

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

async function seedCatalog(db) {
  await runMigrations(db);
  await run(
    db,
    `
      INSERT INTO f95_catalog (f95_id, title, creator, engine, version, site_url)
      VALUES
        (1001, 'Summer Time Saga', 'Icstor', 'Ren''Py', '0.20.0', 'https://f95zone.to/threads/1001/'),
        (1002, 'Eternum', 'Caribdis', 'Ren''Py', '0.8', 'https://f95zone.to/threads/1002/'),
        (1003, 'Eternum', 'Other Dev', 'Unity', '1.0', 'https://f95zone.to/threads/1003/'),
        (1004, 'Not a Failure to Launch', 'NotAFailureToLaunch', 'Unity', '0.5.7', 'https://f95zone.to/threads/1004/'),
        (1005, 'A Failure to Launch', 'Min Thy Lord', 'Ren''Py', '0.2.1', 'https://f95zone.to/threads/1005/'),
        (1006, 'My Hotwife', 'My Hotwife', 'Ren''Py', '1.5', 'https://f95zone.to/threads/1006/'),
        (1007, 'My Hotwife', 'Ben Lucky', 'Ren''Py', '2.16', 'https://f95zone.to/threads/1007/'),
        (1008, 'Willing Temptations', 'Abyss Exploration', 'Ren''Py', '0.4 Hotfix 1', 'https://f95zone.to/threads/1008/'),
        (1009, 'Temptations', 'Cris22', 'Ren''Py', '0.1', 'https://f95zone.to/threads/1009/'),
        (1010, 'Dark Temptations', 'Overactive Imagination Games', 'Ren''Py', '0.1.13', 'https://f95zone.to/threads/1010/'),
        (1011, 'Gamer Girl Adventure', 'Katrina 3Dx', 'Ren''Py', 'Final', 'https://f95zone.to/threads/1011/'),
        (1012, 'Libertas: Awakened Lust', 'Asuka137x', 'Ren''Py', '0.04', 'https://f95zone.to/threads/1012/'),
        (1013, 'New Life with My Daughter', 'VanderGames', 'Ren''Py', '0.7.0b', 'https://f95zone.to/threads/1013/'),
        (1014, 'Date a Giantess', 'GiantessNexus', 'Ren''Py', '5.22', 'https://f95zone.to/threads/1014/')
    `,
  );
}

test("catalog scan matcher auto-matches when title and creator corroborate the same entry", async () => {
  const db = openMemoryDatabase();
  await seedCatalog(db);

  const matcher = await createCatalogScanMatcher(db);
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
  assert.equal(result.bestMatch?.f95Id, 1001);
  assert.equal(result.bestMatch?.f95Id, 1001);
});

test("catalog scan matcher keeps same-title collisions ambiguous without corroborating signals", async () => {
  const db = openMemoryDatabase();
  await seedCatalog(db);

  const matcher = await createCatalogScanMatcher(db);
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

test("catalog scan matcher matches compact executable names against titles for high-confidence matches", async () => {
  const db = openMemoryDatabase();
  await seedCatalog(db);

  const matcher = await createCatalogScanMatcher(db);
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
  assert.equal(result.bestMatch?.f95Id, 1001);
});

test("catalog scan matcher auto-matches exact titles even when a nearby fuzzy title exists", async () => {
  const db = openMemoryDatabase();
  await seedCatalog(db);

  const matcher = await createCatalogScanMatcher(db);
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
  assert.equal(result.bestMatch?.f95Id, 1004);
});

test("catalog scan matcher prefers the correct same-title branch using version evidence", async () => {
  const db = openMemoryDatabase();
  await seedCatalog(db);

  const matcher = await createCatalogScanMatcher(db);
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
  assert.equal(result.bestMatch?.f95Id, 1007);
  assert.ok((result.margin || 0) >= 10);
});

test("catalog scan matcher rejects short substring collisions when a full exact title exists", async () => {
  const db = openMemoryDatabase();
  await seedCatalog(db);

  const matcher = await createCatalogScanMatcher(db);
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
  assert.equal(result.bestMatch?.f95Id, 1008);
});

test("catalog scan matcher can auto-match a near-exact parent-folder title when the margin is decisive", async () => {
  const db = openMemoryDatabase();
  await seedCatalog(db);

  const matcher = await createCatalogScanMatcher(db);
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
  assert.equal(result.bestMatch?.f95Id, 1012);
});

test("catalog scan matcher can auto-match exact version plus creator derived from folder metadata", async () => {
  const db = openMemoryDatabase();
  await seedCatalog(db);

  const matcher = await createCatalogScanMatcher(db);
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
  assert.equal(result.bestMatch?.f95Id, 1013);
});

test("catalog scan matcher can auto-match creator-anchored titles with wording drift", async () => {
  const db = openMemoryDatabase();
  await seedCatalog(db);

  const matcher = await createCatalogScanMatcher(db);
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
  assert.equal(result.bestMatch?.f95Id, 1014);
});

test("catalog scan matcher can auto-match a single clear title even when the catalog only has final version", async () => {
  const db = openMemoryDatabase();
  await seedCatalog(db);

  const matcher = await createCatalogScanMatcher(db);
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
  assert.equal(result.bestMatch?.f95Id, 1011);
});
