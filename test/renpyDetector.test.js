const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { detectRenpyGame } = require("../src/main/detectors/renpyDetector");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-renpy-detector-"));
}

test("detectRenpyGame returns strong confidence for a typical Ren'Py layout", () => {
  const root = makeTempDir();
  fs.mkdirSync(path.join(root, "game"));
  fs.mkdirSync(path.join(root, "renpy"));
  fs.mkdirSync(path.join(root, "lib"));
  fs.writeFileSync(path.join(root, "demo.exe"), "");
  fs.writeFileSync(path.join(root, "script.rpa"), "");
  fs.writeFileSync(path.join(root, "game", "script.rpyc"), "");
  fs.mkdirSync(path.join(root, "lib", "py3-windows-x86_64"));

  const result = detectRenpyGame(root, ["demo.exe"]);

  assert.equal(result.matched, true);
  assert.ok(result.confidence >= 70);
  assert.ok(result.reasons.includes("found game directory"));
  assert.ok(
    result.reasons.includes("found typical Ren'Py files inside game directory"),
  );
});

test("detectRenpyGame stays below threshold for a generic executable folder", () => {
  const root = makeTempDir();
  fs.writeFileSync(path.join(root, "launcher.exe"), "");
  fs.mkdirSync(path.join(root, "data"));

  const result = detectRenpyGame(root, ["launcher.exe"]);

  assert.equal(result.matched, false);
  assert.ok(result.confidence < 70);
});
