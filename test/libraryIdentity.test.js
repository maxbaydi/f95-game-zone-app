const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLibraryIdentity,
  buildLibraryIdentityCandidates,
} = require("../src/main/libraryIdentity");

test("buildLibraryIdentity prefers the thread id over weaker identifiers", () => {
  assert.equal(
    buildLibraryIdentity({
      f95Id: 456,
      siteUrl: "https://f95zone.to/threads/example.456/",
      title: "Example",
      creator: "Dev",
    }),
    "f95:456",
  );
});

test("buildLibraryIdentityCandidates lists every identifier, strongest first", () => {
  assert.deepEqual(
    buildLibraryIdentityCandidates({
      f95Id: 456,
      siteUrl: "https://F95zone.to/threads/example.456/",
      displayTitle: "Example Game",
      displayCreator: "Dev Team",
    }),
    [
      "f95:456",
      "site:https://f95zone.to/threads/example.456",
      `title:${require("../src/shared/scanMatchUtils").buildCompactScanKey("Example Game")}|creator:${require("../src/shared/scanMatchUtils").buildCompactScanKey("Dev Team")}`,
    ],
  );
});

test("buildLibraryIdentity is empty without any identifier", () => {
  assert.equal(buildLibraryIdentity({}), "");
  assert.equal(buildLibraryIdentity(null), "");
});
