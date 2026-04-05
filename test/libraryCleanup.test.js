const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanupLibraryNoiseRecords,
  inspectInfrastructurePath,
  inspectLibraryNoiseRecord,
} = require("../src/main/libraryCleanup");

test("inspectInfrastructurePath flags nested runtime/helper folders", () => {
  const inspection = inspectInfrastructurePath(
    "C:\\Games\\Foo\\Foo\\game\\fonts\\DIN",
  );

  assert.equal(inspection.flagged, true);
  assert.ok(
    inspection.reasons.some((reason) => reason.includes("runtime/helper segment")),
  );
});

test("inspectLibraryNoiseRecord marks strict runtime trash as suspicious", () => {
  const inspection = inspectLibraryNoiseRecord({
    title: "readme",
    creator: "Unknown",
    atlas_id: null,
    f95_id: null,
    versions: [
      {
        game_path: "C:\\Games\\Foo\\Foo\\game\\fonts\\DIN",
        exec_path: "C:\\Games\\Foo\\Foo\\game\\fonts\\DIN\\readme.html",
      },
    ],
  });

  assert.equal(inspection.suspicious, true);
  assert.ok(
    inspection.reasons.some((reason) => reason.includes("known helper/readme artifact")),
  );
});

test("inspectLibraryNoiseRecord leaves suspicious but not strict cases alone", () => {
  const inspection = inspectLibraryNoiseRecord({
    title: "index",
    creator: "Unknown",
    atlas_id: null,
    f95_id: null,
    versions: [
      {
        game_path: "C:\\Games\\My Oblivious MILF",
        exec_path: "C:\\Games\\My Oblivious MILF\\index.html",
      },
    ],
  });

  assert.equal(inspection.suspicious, false);
});

test("cleanupLibraryNoiseRecords removes only strict noise records", async () => {
  const removedRecordIds = [];
  const result = await cleanupLibraryNoiseRecords({
    appPaths: {},
    getGames: async () => [
      {
        record_id: 1,
        title: "readme",
        creator: "Unknown",
        atlas_id: null,
        f95_id: null,
        versions: [
          {
            game_path: "C:\\Games\\Foo\\Foo\\game\\fonts\\DIN",
            exec_path: "C:\\Games\\Foo\\Foo\\game\\fonts\\DIN\\readme.html",
          },
        ],
      },
      {
        record_id: 2,
        title: "index",
        creator: "Unknown",
        atlas_id: null,
        f95_id: null,
        versions: [
          {
            game_path: "C:\\Games\\My Oblivious MILF",
            exec_path: "C:\\Games\\My Oblivious MILF\\index.html",
          },
        ],
      },
    ],
    deleteGameCompletely: async (recordId) => {
      removedRecordIds.push(recordId);
      return { success: true };
    },
  });

  assert.deepEqual(removedRecordIds, [1]);
  assert.deepEqual(
    result.removed.map((candidate) => candidate.recordId),
    [1],
  );
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.recordId),
    [1],
  );
});
