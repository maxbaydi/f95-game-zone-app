const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCloudLibraryCatalogSnapshot,
  filterCloudLibraryEntriesByIdentity,
  normalizeCloudLibraryDeleteTarget,
  normalizeCloudLibraryIdentityKeys,
  shouldRemoveCloudLibraryEntry,
} = require("../src/main/cloudSaveSync");

test("normalizeCloudLibraryIdentityKeys keeps only unique non-empty keys", () => {
  const keys = normalizeCloudLibraryIdentityKeys([
    " atlas:1 ",
    "",
    null,
    "atlas:1",
    "atlas:2",
    "  ",
  ]);

  assert.deepEqual(keys, ["atlas:1", "atlas:2"]);
});

test("filterCloudLibraryEntriesByIdentity removes excluded identities", () => {
  const filtered = filterCloudLibraryEntriesByIdentity(
    [
      { identityKey: "atlas:1", title: "One" },
      { identityKey: "atlas:2", title: "Two" },
    ],
    ["atlas:2"],
  );

  assert.deepEqual(
    filtered.map((entry) => entry.identityKey),
    ["atlas:1"],
  );
});

test("buildCloudLibraryCatalogSnapshot excludes deleted identity from merge and remoteOnly", () => {
  const snapshot = buildCloudLibraryCatalogSnapshot(
    [
      {
        identityKey: "atlas:1",
        title: "Local One",
        updatedAt: "2026-04-08T10:00:00.000Z",
      },
      {
        identityKey: "atlas:4",
        title: "Deleted Locally",
        updatedAt: "2026-04-08T10:00:00.000Z",
      },
    ],
    [
      {
        identityKey: "atlas:2",
        title: "Remote Two",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      {
        identityKey: "atlas:4",
        title: "Deleted Locally",
        updatedAt: "2026-04-08T09:30:00.000Z",
      },
    ],
    {
      excludedIdentityKeys: [" atlas:4 ", "atlas:4"],
    },
  );

  assert.deepEqual(snapshot.excludedIdentityKeys, ["atlas:4"]);
  assert.deepEqual(
    snapshot.mergedEntries.map((entry) => entry.identityKey),
    ["atlas:1", "atlas:2"],
  );
  assert.deepEqual(
    snapshot.remoteOnlyEntries.map((entry) => entry.identityKey),
    ["atlas:2"],
  );
});

test("normalizeCloudLibraryDeleteTarget keeps exact alias candidates for safe delete", () => {
  const target = normalizeCloudLibraryDeleteTarget({
    atlasId: "42",
    f95Id: "123",
    siteUrl: "https://f95zone.to/threads/demo.123/",
    title: "Demo",
    creator: "Dev",
  });

  assert.deepEqual(target.candidateIdentityKeys, [
    "atlas:42",
    "f95:123",
    "site:https://f95zone.to/threads/demo.123",
    "title:demo|creator:dev",
  ]);
});

test("shouldRemoveCloudLibraryEntry removes exact identity aliases and strong field matches only", () => {
  const target = normalizeCloudLibraryDeleteTarget({
    atlasId: "42",
    f95Id: "123",
    siteUrl: "https://f95zone.to/threads/demo.123/",
    title: "Demo",
    creator: "Dev",
  });

  assert.equal(
    shouldRemoveCloudLibraryEntry(
      {
        identityKey: "site:https://f95zone.to/threads/demo.123",
        siteUrl: "https://f95zone.to/threads/demo.123",
      },
      target,
    ),
    true,
  );

  assert.equal(
    shouldRemoveCloudLibraryEntry(
      {
        identityKey: "title:demo|creator:dev",
        title: "Demo",
        creator: "Dev",
      },
      target,
    ),
    true,
  );

  assert.equal(
    shouldRemoveCloudLibraryEntry(
      {
        identityKey: "title:demo|creator:dev",
        title: "Demo",
        creator: "Other Dev",
        atlasId: "",
        f95Id: "",
        siteUrl: "",
      },
      normalizeCloudLibraryDeleteTarget({
        atlasId: "77",
        f95Id: "999",
        siteUrl: "https://f95zone.to/threads/other.999/",
        title: "Other Demo",
        creator: "Other Dev",
      }),
    ),
    false,
  );
});
