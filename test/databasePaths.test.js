const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildAppPaths,
} = require("../src/main/appPaths");
const {
  resolveDatabasePaths,
} = require("../src/main/databasePaths");
const {
  resolveStoredImagePath,
  toStoredImagePath,
} = require("../src/main/assetPaths");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-stage0-db-"));
}

test("database path resolution always targets data/data.db", () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "userData"));
  const resolved = resolveDatabasePaths(appPaths);

  assert.equal(resolved.db, appPaths.db);
});

test("managed image paths resolve through appPaths rather than install-relative paths", () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "userData"));
  const legacyStoredPath = "data/images/99/banner_sc.webp";
  const currentStoredPath = "cache/images/99/banner_sc.webp";

  assert.equal(
    resolveStoredImagePath(appPaths, legacyStoredPath),
    path.join(appPaths.images, "99", "banner_sc.webp"),
  );
  assert.equal(
    resolveStoredImagePath(appPaths, currentStoredPath),
    path.join(appPaths.images, "99", "banner_sc.webp"),
  );
});

test("new stored image paths are written relative to cache/images", () => {
  const appPaths = buildAppPaths(path.join(makeTempDir(), "userData"));
  const filePath = path.join(appPaths.images, "77", "preview_pr.webp");

  assert.equal(toStoredImagePath(appPaths, filePath), "cache/images/77/preview_pr.webp");
});
