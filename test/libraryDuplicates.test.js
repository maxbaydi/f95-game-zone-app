const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLibraryPathIndex,
  choosePreferredDuplicateRecord,
  findDuplicateGamePathGroups,
  findPreferredGameByPath,
  reconcileLibraryDuplicateGamePaths,
} = require("../src/main/libraryDuplicates");

test("choosePreferredDuplicateRecord prefers mapped canonical game metadata", () => {
  const winner = choosePreferredDuplicateRecord([
    {
      record_id: 7,
      title: "BeachfrontNightmares-0.2-pc",
      creator: "Unknown",
      engine: "unknown",
      version: "0.2-pc",
    },
    {
      record_id: 52,
      title: "Beachfront Nightmares",
      creator: "L8eralGames",
      engine: "renpy",
      version: "0.2",
      atlas_id: 12001,
      f95_id: 88001,
    },
  ]);

  assert.equal(winner?.record_id, 52);
});

test("choosePreferredDuplicateRecord penalizes detached version tails in titles", () => {
  const winner = choosePreferredDuplicateRecord([
    {
      record_id: 16,
      title: "Him 0 3 3",
      creator: "Unknown",
      engine: "unknown",
      version: "0.3.3",
    },
    {
      record_id: 61,
      title: "Him",
      creator: "Unknown",
      engine: "unknown",
      version: "",
    },
  ]);

  assert.equal(winner?.record_id, 61);
});

test("findPreferredGameByPath resolves duplicates by exact install path", () => {
  const games = [
    {
      record_id: 1,
      title: "adebtpaid-v03-pc",
      creator: "Unknown",
      versions: [{ game_path: "C:\\Games\\ADebtPaid" }],
    },
    {
      record_id: 48,
      title: "A Debt Paid",
      creator: "HarleyQ",
      atlas_id: 4001,
      versions: [{ game_path: "c:\\games\\adebtpaid" }],
    },
  ];

  const index = buildLibraryPathIndex(games);
  const winner = findPreferredGameByPath(index, "C:\\GAMES\\ADEBTPAID");

  assert.equal(winner?.record_id, 48);
});

test("findDuplicateGamePathGroups reports exact-path duplicate groups", () => {
  const groups = findDuplicateGamePathGroups([
    {
      record_id: 24,
      title: "My Oblivious MILF",
      creator: "Mity",
      atlas_id: 900,
      versions: [{ game_path: "C:\\Games\\My Oblivious MILF" }],
    },
    {
      record_id: 69,
      title: "index",
      creator: "Unknown",
      versions: [{ game_path: "C:\\Games\\My Oblivious MILF" }],
    },
    {
      record_id: 70,
      title: "Another Game",
      creator: "Dev",
      versions: [{ game_path: "C:\\Games\\Another Game" }],
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].winner.record_id, 24);
  assert.deepEqual(
    groups[0].losers.map((game) => game.record_id),
    [69],
  );
});

test("reconcileLibraryDuplicateGamePaths dry-run reports cleanup without deleting", async () => {
  const deleted = [];
  const result = await reconcileLibraryDuplicateGamePaths({
    appPaths: {},
    getGames: async () => [
      {
        record_id: 24,
        title: "My Oblivious MILF",
        creator: "Mity",
        atlas_id: 900,
        versions: [{ game_path: "C:\\Games\\My Oblivious MILF" }],
      },
      {
        record_id: 69,
        title: "index",
        creator: "Unknown",
        versions: [{ game_path: "C:\\Games\\My Oblivious MILF" }],
      },
    ],
    deleteGameCompletely: async (recordId) => {
      deleted.push(recordId);
      return { success: true };
    },
    dryRun: true,
  });

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].winner.recordId, 24);
  assert.deepEqual(
    result.groups[0].losers.map((game) => game.recordId),
    [69],
  );
  assert.deepEqual(deleted, []);
});
