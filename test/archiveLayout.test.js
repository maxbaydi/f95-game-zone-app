const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  resolveArchiveContentRoot,
} = require("../src/main/install/archiveLayout");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-archive-layout-"));
}

test("resolveArchiveContentRoot unwraps a single nested archive folder", async () => {
  const root = makeTempDir();
  const nested = path.join(root, "Apartment69-0.11-pc");

  fs.mkdirSync(path.join(nested, "game"), { recursive: true });
  fs.writeFileSync(path.join(nested, "Apartment69.exe"), "");

  const resolved = await resolveArchiveContentRoot(root);

  assert.equal(resolved, nested);
});

test("resolveArchiveContentRoot keeps the root when archive already contains direct files", async () => {
  const root = makeTempDir();

  fs.mkdirSync(path.join(root, "game"), { recursive: true });
  fs.writeFileSync(path.join(root, "Apartment69.exe"), "");

  const resolved = await resolveArchiveContentRoot(root);

  assert.equal(resolved, root);
});
