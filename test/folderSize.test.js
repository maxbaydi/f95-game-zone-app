const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { getFolderSizeAsync } = require("../src/main/folderSize");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-folder-size-"));
}

test("getFolderSizeAsync sums every file in nested folders", async () => {
  const root = makeTempDir();
  fs.mkdirSync(path.join(root, "game", "renpy"), { recursive: true });
  fs.writeFileSync(path.join(root, "a.bin"), Buffer.alloc(10));
  fs.writeFileSync(path.join(root, "game", "b.bin"), Buffer.alloc(20));
  fs.writeFileSync(path.join(root, "game", "renpy", "c.bin"), Buffer.alloc(30));

  assert.equal(await getFolderSizeAsync(root), 60);
});

test("getFolderSizeAsync returns 0 for a missing folder instead of throwing", async () => {
  assert.equal(await getFolderSizeAsync(path.join(makeTempDir(), "nope")), 0);
  assert.equal(await getFolderSizeAsync(""), 0);
});

test("getFolderSizeAsync returns the size of a single file path", async () => {
  const root = makeTempDir();
  const filePath = path.join(root, "game.swf");
  fs.writeFileSync(filePath, Buffer.alloc(7));

  assert.equal(await getFolderSizeAsync(filePath), 7);
});

test("getFolderSizeAsync keeps counting when a subfolder cannot be read", async () => {
  const root = makeTempDir();
  fs.writeFileSync(path.join(root, "a.bin"), Buffer.alloc(5));
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "sub", "b.bin"), Buffer.alloc(6));

  const size = await getFolderSizeAsync(root, {
    readdir: async (dir, options) => {
      if (path.basename(dir) === "sub") {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return fs.promises.readdir(dir, options);
    },
  });

  assert.equal(size, 5);
});
