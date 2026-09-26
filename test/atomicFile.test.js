const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { writeFileAtomicSync } = require("../src/main/atomicFile");

test("writeFileAtomicSync replaces the file and leaves no temp files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-atomic-"));
  const target = path.join(directory, "config.ini");
  fs.writeFileSync(target, "old=1\n");

  writeFileAtomicSync(target, "new=2\n");

  assert.equal(fs.readFileSync(target, "utf8"), "new=2\n");
  assert.deepEqual(fs.readdirSync(directory), ["config.ini"]);
});

test("writeFileAtomicSync creates missing directories", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-atomic-"));
  const target = path.join(directory, "nested", "deeper", "config.ini");

  writeFileAtomicSync(target, "value=1\n");

  assert.equal(fs.readFileSync(target, "utf8"), "value=1\n");
});

test("writeFileAtomicSync falls back to a direct write when rename fails", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-atomic-"));
  const target = path.join(directory, "config.ini");
  const fallbacks = [];
  const flakyFs = {
    ...fs,
    renameSync() {
      const error = new Error("EPERM: operation not permitted");
      // @ts-ignore - emulate a Node system error code
      error.code = "EPERM";
      throw error;
    },
  };

  writeFileAtomicSync(target, "value=2\n", {
    fs: flakyFs,
    onFallback: (error) => fallbacks.push(error.code),
  });

  assert.equal(fs.readFileSync(target, "utf8"), "value=2\n");
  assert.deepEqual(fallbacks, ["EPERM"]);
  assert.deepEqual(fs.readdirSync(directory), ["config.ini"]);
});
