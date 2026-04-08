const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildAppPaths, ensureAppDirs } = require("../src/main/appPaths");
const { openDatabase } = require("../src/main/db/openDatabase");
const {
  buildCloudLibraryDeleteRequest,
  collectCloudLibraryDeleteCandidateKeys,
  deletePendingCloudLibraryDeleteRequest,
  listPendingCloudLibraryDeleteRequests,
  queueCloudLibraryDeleteRequest,
  setPendingCloudLibraryDeleteRequestError,
} = require("../src/main/db/cloudLibraryDeleteQueueStore");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-cloud-library-delete-"));
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

test("cloud library delete queue stores and updates pending requests", async () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "profile"));
  ensureAppDirs(appPaths);
  const db = await openDatabase(appPaths);

  const request = buildCloudLibraryDeleteRequest({
    cloudProjectKey: "jlwxwjgnujkenanohypr",
    recordId: 17,
    atlasId: "42",
    f95Id: "123",
    siteUrl: "https://f95zone.to/threads/demo.123/",
    title: "Demo",
    creator: "Dev",
  });

  assert.ok(request);
  assert.deepEqual(request.candidateIdentityKeys, [
    "atlas:42",
    "f95:123",
    "site:https://f95zone.to/threads/demo.123",
    "title:demo|creator:dev",
  ]);

  await queueCloudLibraryDeleteRequest(db, request);

  let listed = await listPendingCloudLibraryDeleteRequests(
    db,
    "jlwxwjgnujkenanohypr",
  );
  assert.equal(listed.length, 1);
  assert.equal(listed[0].preferredIdentityKey, "atlas:42");

  await setPendingCloudLibraryDeleteRequestError(
    db,
    request.requestKey,
    "network failure",
  );

  listed = await listPendingCloudLibraryDeleteRequests(
    db,
    "jlwxwjgnujkenanohypr",
  );
  assert.equal(listed[0].lastError, "network failure");

  await deletePendingCloudLibraryDeleteRequest(db, request.requestKey);
  assert.deepEqual(
    await listPendingCloudLibraryDeleteRequests(db, "jlwxwjgnujkenanohypr"),
    [],
  );

  await closeAsync(db);
});

test("cloud library delete request rejects ambiguous placeholder-only identities", () => {
  const request = buildCloudLibraryDeleteRequest({
    cloudProjectKey: "jlwxwjgnujkenanohypr",
    recordId: 18,
    title: "Unknown",
    creator: "Unknown",
  });

  assert.equal(request, null);
});

test("cloud library delete request accepts exact title identity even when creator is unknown", () => {
  const request = buildCloudLibraryDeleteRequest({
    cloudProjectKey: "jlwxwjgnujkenanohypr",
    recordId: 19,
    title: "SmallCoffee female",
    creator: "Unknown",
  });

  assert.ok(request);
  assert.deepEqual(request.candidateIdentityKeys, [
    "title:smallcoffeefemale|creator:unknown",
  ]);
});

test("collectCloudLibraryDeleteCandidateKeys deduplicates request aliases for sync exclusion", () => {
  const keys = collectCloudLibraryDeleteCandidateKeys([
    {
      preferredIdentityKey: "atlas:42",
      candidateIdentityKeys: [
        "atlas:42",
        "f95:123",
        "title:demo|creator:dev",
      ],
    },
    {
      preferredIdentityKey: "title:smallcoffeefemale|creator:unknown",
      candidateIdentityKeys: [
        "title:smallcoffeefemale|creator:unknown",
        "title:smallcoffeefemale|creator:unknown",
      ],
    },
  ]);

  assert.deepEqual(keys, [
    "atlas:42",
    "f95:123",
    "title:demo|creator:dev",
    "title:smallcoffeefemale|creator:unknown",
  ]);
});
