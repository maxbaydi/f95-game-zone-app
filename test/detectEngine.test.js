const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { detectGameEngine } = require("../src/main/install/detectEngine");
const { selectPreferredExecutable } = require("../src/main/install/selectExecutable");
const { findExecutables } = require("../src/main/install/findExecutables");

function makeGame(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-engine-"));
  for (const [relative, content] of Object.entries(layout)) {
    const target = path.join(root, relative);
    if (relative.endsWith("/")) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content ?? "");
  }
  return root;
}

const GAME_EXTENSIONS = ["exe", "swf", "jar", "html", "sh"];

function pick(root, detection, title) {
  const executables = findExecutables(root, GAME_EXTENSIONS);
  return selectPreferredExecutable(executables, {
    title,
    preferredExecutables: detection.preferredExecutables,
    ignoredExecutables: detection.ignoredExecutables,
  });
}

test("Ren'Py layout is detected and the launcher next to its .py wins", () => {
  const root = makeGame({
    "MyGame.exe": "MZ",
    "MyGame.py": "",
    "renpy/": null,
    "game/script.rpyc": "",
    "lib/py3-windows-x86_64/pythonw.exe": "MZ",
    "lib/py3-windows-x86_64/python.exe": "MZ",
  });
  const detection = detectGameEngine(root);
  assert.equal(detection.engine, "Ren'Py");
  assert.equal(pick(root, detection, "My Game"), "MyGame.exe");
});

test("Unity player is detected from the _Data folder and the crash handler is skipped", () => {
  const root = makeGame({
    "Game.exe": "MZ",
    "UnityCrashHandler64.exe": "MZ",
    "UnityPlayer.dll": "",
    "Game_Data/globalgamemanagers": "",
    "Game_Data/resources.assets": "",
    "MonoBleedingEdge/": null,
  });
  const detection = detectGameEngine(root);
  assert.equal(detection.engine, "Unity");
  assert.deepEqual(detection.preferredExecutables, ["Game.exe"]);
  assert.equal(pick(root, detection, "Some Long Title"), "Game.exe");
});

test("Unreal Engine builds are detected and the bootstrap exe beats helpers and the shipping binary", () => {
  const root = makeGame({
    "Lust.exe": "MZ",
    "Engine/Binaries/Win64/CrashReportClient.exe": "MZ",
    "Engine/Binaries/ThirdParty/DotNet/x.exe": "MZ",
    "Engine/Content/": null,
    "Lust/Binaries/Win64/Lust-Win64-Shipping.exe": "MZ",
    "Lust/Content/Paks/Lust-WindowsNoEditor.pak": "",
  });
  const detection = detectGameEngine(root);
  assert.equal(detection.engine, "Unreal Engine");
  assert.equal(pick(root, detection, "Lust"), "Lust.exe");

  fs.unlinkSync(path.join(root, "Lust.exe"));
  const withoutBootstrap = detectGameEngine(root);
  assert.equal(withoutBootstrap.engine, "Unreal Engine");
  assert.equal(
    pick(root, withoutBootstrap, "Lust"),
    path.join("Lust", "Binaries", "Win64", "Lust-Win64-Shipping.exe"),
  );
});

test("RPG Maker MV/MZ, VX Ace and 2003 layouts are recognised with their variants", () => {
  const mv = makeGame({
    "Game.exe": "MZ",
    "nw.exe": "MZ",
    "www/index.html": "<html>",
    "www/js/rpg_core.js": "",
    "www/save/": null,
  });
  const mvDetection = detectGameEngine(mv);
  assert.equal(mvDetection.engine, "RPGM");
  assert.equal(mvDetection.variant, "MV");
  assert.equal(pick(mv, mvDetection, "Whatever"), "Game.exe");

  const mz = makeGame({ "Game.exe": "MZ", "js/rmmz_core.js": "", "index.html": "" });
  assert.equal(detectGameEngine(mz).variant, "MZ");

  const ace = makeGame({ "Game.exe": "MZ", "Game.ini": "[Game]\nRTP=RPGVXAce\n", "Game.rgss3a": "" });
  const aceDetection = detectGameEngine(ace);
  assert.equal(aceDetection.engine, "RPGM");
  assert.equal(aceDetection.variant, "VX Ace");

  const rt = makeGame({ "RPG_RT.exe": "MZ", "RPG_RT.ldb": "" });
  assert.equal(detectGameEngine(rt).variant, "2000/2003");
});

test("Godot, Wolf RPG, KiriKiri, GameMaker and TyranoBuilder markers are recognised", () => {
  assert.equal(detectGameEngine(makeGame({ "Game.exe": "MZ", "Game.pck": "" })).engine, "Godot");
  const wolf = makeGame({ "Game.exe": "MZ", "Config.exe": "MZ", "Data.wolf": "" });
  const wolfDetection = detectGameEngine(wolf);
  assert.equal(wolfDetection.engine, "Wolf RPG");
  assert.equal(pick(wolf, wolfDetection, "Some Title"), "Game.exe");
  assert.equal(detectGameEngine(makeGame({ "Game.exe": "MZ", "data.xp3": "" })).engine, "KiriKiri");
  assert.equal(detectGameEngine(makeGame({ "Game.exe": "MZ", "data.win": "" })).engine, "GameMaker");
  assert.equal(
    detectGameEngine(makeGame({ "index.html": "", "tyrano/": null, "data/": null })).engine,
    "TyranoBuilder",
  );
});

test("HTML games prefer index.html and Twine stories are recognised", () => {
  const root = makeGame({
    "index.html": "<html><tw-storydata name='x' format='SugarCube'></tw-storydata></html>",
    "credits.html": "<html>",
    "images/": null,
  });
  const detection = detectGameEngine(root);
  assert.equal(detection.engine, "HTML");
  assert.equal(detection.variant, "Twine");
  assert.equal(pick(root, detection, "Degrees of Lewdity"), "index.html");
});

test("Flash and Java packages without an exe use the movie or jar as launcher", () => {
  const flash = makeGame({ "game.swf": "" });
  const flashDetection = detectGameEngine(flash);
  assert.equal(flashDetection.engine, "Flash");
  assert.equal(pick(flash, flashDetection, "Game"), "game.swf");

  const java = makeGame({ "Game.jar": "", "lib/": null });
  assert.equal(detectGameEngine(java).engine, "Java");
});

test("an empty or unknown folder reports no engine", () => {
  const root = makeGame({ "readme.txt": "hi" });
  const detection = detectGameEngine(root);
  assert.equal(detection.engine, "");
  assert.equal(detection.id, "");
});

test("redistributable folders never win the executable pick", () => {
  const selected = selectPreferredExecutable(
    ["_CommonRedist/vcredist/2019/VC_redist.x64.exe", "Bin/Game.exe"],
    { title: "Other" },
  );
  assert.equal(selected, "Bin/Game.exe");
});
