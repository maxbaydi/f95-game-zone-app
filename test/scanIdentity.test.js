const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { extractScanCandidateIdentity } = require("../src/main/scanIdentity");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-scan-identity-"));
}

test("extractScanCandidateIdentity prefers Ren'Py options metadata over folder noise", () => {
  const root = path.join(makeTempDir(), "games", "Summer Time Saga v20-pc");
  fs.mkdirSync(path.join(root, "game"), { recursive: true });
  fs.writeFileSync(path.join(root, "SummerTimeSaga.exe"), "");
  fs.writeFileSync(
    path.join(root, "game", "options.rpy"),
    [
      'define config.name = _("Summer Time Saga")',
      'define config.version = "0.20.0"',
    ].join("\n"),
  );

  const identity = extractScanCandidateIdentity({
    targetPath: root,
    rootPath: path.dirname(root),
    relativePath: path.basename(root),
    isFile: false,
    executables: ["SummerTimeSaga.exe"],
    engine: "renpy",
  });

  assert.equal(identity.title, "Summer Time Saga");
  assert.equal(identity.version, "0.20.0");
  assert.ok(identity.reasons.includes("read title from Ren'Py options.rpy"));
  assert.ok(
    identity.titleVariants.some((variant) => variant.source === "renpy-options"),
  );
});

test("extractScanCandidateIdentity can infer creator/title from nested folders", () => {
  const sourceRoot = path.join(makeTempDir(), "source");
  const gameRoot = path.join(sourceRoot, "Caribdis", "Eternum", "v0.8");
  fs.mkdirSync(gameRoot, { recursive: true });
  fs.writeFileSync(path.join(gameRoot, "Eternum.exe"), "");

  const identity = extractScanCandidateIdentity({
    targetPath: gameRoot,
    rootPath: sourceRoot,
    relativePath: path.relative(sourceRoot, gameRoot),
    isFile: false,
    executables: ["Eternum.exe"],
    engine: "renpy",
  });

  assert.equal(identity.title, "Eternum");
  assert.equal(identity.creator, "Caribdis");
  assert.equal(identity.version, "0.8");
  assert.ok(identity.reasons.includes("inferred creator from grandparent folder"));
});

test("extractScanCandidateIdentity treats index.html as generic and keeps folder title", () => {
  const sourceRoot = makeTempDir();
  const gameRoot = path.join(sourceRoot, "My Oblivious MILF");
  fs.mkdirSync(gameRoot, { recursive: true });
  fs.writeFileSync(path.join(gameRoot, "index.html"), "<html></html>");

  const identity = extractScanCandidateIdentity({
    targetPath: gameRoot,
    rootPath: sourceRoot,
    relativePath: path.basename(gameRoot),
    isFile: false,
    executables: ["index.html"],
    engine: "html",
  });

  assert.equal(identity.title, "My Oblivious MILF");
});
