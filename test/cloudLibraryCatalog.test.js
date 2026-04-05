const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCloudLibraryCatalogEntry,
  buildCloudLibraryEntryIdentity,
  getRemoteOnlyCloudLibraryEntries,
  mergeCloudLibraryCatalogEntries,
  parseCloudLibraryCatalogManifest,
} = require("../src/main/cloudLibraryCatalog");

test("buildCloudLibraryEntryIdentity prefers atlas id over weaker identifiers", () => {
  assert.equal(
    buildCloudLibraryEntryIdentity({
      atlasId: 123,
      f95Id: 456,
      siteUrl: "https://f95zone.to/threads/example.456/",
      title: "Example",
      creator: "Dev",
    }),
    "atlas:123",
  );
});

test("buildCloudLibraryCatalogEntry builds a stable cloud-library entry from a game", () => {
  const entry = buildCloudLibraryCatalogEntry({
    record_id: 7,
    atlas_id: 123,
    f95_id: 456,
    siteUrl: "https://f95zone.to/threads/example.456/",
    displayTitle: "Example Game",
    displayCreator: "Dev Team",
    engine: "Ren'Py",
    latestVersion: "0.5",
    newestInstalledVersion: "0.4",
    versions: [{ version: "0.4", exec_path: "C:\\Games\\Example.exe" }],
  });

  assert.equal(entry.identityKey, "atlas:123");
  assert.equal(entry.title, "Example Game");
  assert.equal(entry.creator, "Dev Team");
  assert.equal(entry.installedVersionCount, 1);
});

test("mergeCloudLibraryCatalogEntries keeps the richer local/remote entry per identity", () => {
  const merged = mergeCloudLibraryCatalogEntries(
    [
      {
        identityKey: "atlas:1",
        atlasId: "1",
        title: "Example",
        creator: "Dev",
        latestVersion: "0.5",
        updatedAt: "2026-04-05T10:00:00.000Z",
      },
    ],
    [
      {
        identityKey: "atlas:1",
        atlasId: "1",
        title: "Example",
        creator: "",
        latestVersion: "",
        updatedAt: "2026-04-05T09:00:00.000Z",
      },
      {
        identityKey: "atlas:2",
        atlasId: "2",
        title: "Remote Only",
        creator: "Cloud Dev",
        updatedAt: "2026-04-05T09:30:00.000Z",
      },
    ],
  );

  assert.equal(merged.length, 2);
  assert.equal(merged[0].identityKey, "atlas:1");
  assert.equal(merged[0].creator, "Dev");
  assert.equal(merged[1].identityKey, "atlas:2");
});

test("getRemoteOnlyCloudLibraryEntries returns only cloud entries missing locally", () => {
  const remoteOnly = getRemoteOnlyCloudLibraryEntries(
    [
      { identityKey: "atlas:1", title: "Local too" },
      { identityKey: "atlas:2", title: "Remote only" },
    ],
    [{ identityKey: "atlas:1", title: "Local too" }],
  );

  assert.deepEqual(
    remoteOnly.map((entry) => entry.identityKey),
    ["atlas:2"],
  );
});

test("parseCloudLibraryCatalogManifest normalizes malformed input safely", () => {
  const parsed = parseCloudLibraryCatalogManifest({
    version: 1,
    updatedAt: "2026-04-05T12:00:00.000Z",
    entries: [
      {
        identityKey: "atlas:4",
        title: "Cloud Entry",
        installedVersionCount: "2",
      },
      {
        identityKey: "",
        title: "Broken",
      },
    ],
  });

  assert.equal(parsed.version, 1);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].identityKey, "atlas:4");
  assert.equal(parsed.entries[0].installedVersionCount, 2);
});
