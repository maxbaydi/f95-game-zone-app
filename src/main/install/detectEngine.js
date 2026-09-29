// @ts-check

/**
 * File-marker engine detection for an installed (or freshly unpacked) game
 * folder. It looks at what is on disk instead of at the name of the chosen
 * executable, so Unity, Unreal, RPG Maker, Godot, Wolf RPG, KiriKiri, HTML
 * and other engines are recognised even when their launcher is a generic
 * `Game.exe` or a bootstrap binary.
 *
 * The result also carries `preferredExecutables`: launcher paths the engine
 * layout itself points at (the Unity player next to `<name>_Data`, the
 * Unreal bootstrap at the root, `index.html` for browser games). The
 * executable picker boosts those above heuristics on file names.
 */

const fs = require("fs");
const path = require("path");

/**
 * Labels match the F95 engine vocabulary used by the thread parser
 * (`normalizeEngineLabel` in src/main/f95/downloadSupport.js) so records
 * stay consistent whether the engine came from the thread or from disk.
 */
const ENGINE_LABELS = /** @type {const} */ ({
  renpy: "Ren'Py",
  rpgm: "RPGM",
  unity: "Unity",
  unreal: "Unreal Engine",
  godot: "Godot",
  html: "HTML",
  wolf: "Wolf RPG",
  kirikiri: "KiriKiri",
  flash: "Flash",
  java: "Java",
  gamemaker: "GameMaker",
  tyrano: "TyranoBuilder",
  qsp: "QSP",
  rags: "RAGS",
  adrift: "ADRIFT",
  tads: "Tads",
  construct: "Construct",
  electron: "HTML",
  nwjs: "HTML",
});

/**
 * @typedef {{
 *   id: keyof typeof ENGINE_LABELS | "",
 *   engine: string,
 *   variant: string,
 *   confidence: number,
 *   reasons: string[],
 *   preferredExecutables: string[],
 *   ignoredExecutables: string[],
 * }} EngineDetection
 */

/**
 * @param {string} dir
 * @returns {fs.Dirent[]}
 */
function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * @param {string} filePath
 */
function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * @param {string} filePath
 * @param {number=} bytes
 */
function readHead(filePath, bytes = 65536) {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(bytes);
      const read = fs.readSync(fd, buffer, 0, bytes, 0);
      return buffer.subarray(0, read).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

/**
 * @param {string} rootDir
 * @param {string[]} segments
 */
function has(rootDir, ...segments) {
  return exists(path.join(rootDir, ...segments));
}

/**
 * Scores every engine against the folder and returns the best match.
 * @param {string} rootDir
 * @param {{ executables?: string[] }=} options
 * @returns {EngineDetection}
 */
function detectGameEngine(rootDir, options = {}) {
  const root = String(rootDir || "");
  const entries = safeReadDir(root);
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const filesLower = files.map((name) => name.toLowerCase());
  const dirsLower = dirs.map((name) => name.toLowerCase());
  const executables = Array.isArray(options.executables)
    ? options.executables.map((value) => String(value || "").replace(/\\/g, "/"))
    : [];
  const rootExes = files.filter((name) => /\.exe$/i.test(name));

  /** @type {Array<EngineDetection>} */
  const candidates = [];
  const add = (
    /** @type {keyof typeof ENGINE_LABELS} */ id,
    /** @type {number} */ confidence,
    /** @type {string[]} */ reasons,
    /** @type {{ variant?: string, preferredExecutables?: string[], ignoredExecutables?: string[] }=} extra
     */ extra = {},
  ) => {
    if (confidence <= 0) {
      return;
    }
    candidates.push({
      id,
      engine: ENGINE_LABELS[id],
      variant: extra.variant || "",
      confidence,
      reasons,
      preferredExecutables: extra.preferredExecutables || [],
      ignoredExecutables: extra.ignoredExecutables || [],
    });
  };

  // ── Ren'Py ────────────────────────────────────────────────────────────
  {
    let score = 0;
    const reasons = [];
    if (dirsLower.includes("renpy")) {
      score += 45;
      reasons.push("renpy/ runtime folder");
    }
    if (dirsLower.includes("game")) {
      const gameEntries = safeReadDir(path.join(root, "game")).map((entry) =>
        entry.name.toLowerCase(),
      );
      if (gameEntries.some((name) => /\.(rpa|rpyc|rpy)$/.test(name))) {
        score += 40;
        reasons.push("game/ folder with Ren'Py scripts");
      } else {
        score += 10;
      }
    }
    if (filesLower.some((name) => name === "renpy.exe" || name === "renpy.sh")) {
      score += 30;
      reasons.push("renpy launcher");
    }
    if (dirsLower.includes("lib")) {
      const libEntries = safeReadDir(path.join(root, "lib")).map((entry) =>
        entry.name.toLowerCase(),
      );
      if (libEntries.some((name) => /^py(2|3)?-(windows|linux|mac)/.test(name))) {
        score += 25;
        reasons.push("lib/ with Ren'Py Python runtime");
      }
    }
    if (filesLower.some((name) => name.endsWith(".py")) && rootExes.length > 0) {
      score += 10;
    }
    const launcher = rootExes.find((name) => {
      const stem = name.replace(/\.exe$/i, "").toLowerCase();
      return filesLower.includes(`${stem}.py`) || filesLower.includes(`${stem}.sh`);
    });
    add("renpy", score, reasons, launcher ? { preferredExecutables: [launcher] } : {});
  }

  // ── RPG Maker ─────────────────────────────────────────────────────────
  {
    const check = (base) => {
      const js = path.join(root, base, "js");
      if (exists(path.join(js, "rmmz_core.js"))) return "MZ";
      if (exists(path.join(js, "rpg_core.js"))) return "MV";
      return "";
    };
    const mvmz = check("www") || check("");
    if (mvmz) {
      const preferred = rootExes.filter((name) => !/^nw\.exe$/i.test(name));
      add("rpgm", 95, [`RPG Maker ${mvmz} runtime (rpg_core/rmmz_core.js)`], {
        variant: mvmz,
        preferredExecutables: preferred.length ? preferred : rootExes,
        ignoredExecutables: ["nw.exe", "nwjc.exe", "payload.exe"],
      });
    } else if (filesLower.includes("game.rgss3a") || filesLower.includes("game.ini")) {
      const dataDir = path.join(root, "Data");
      const dataFiles = safeReadDir(dataDir).map((entry) => entry.name.toLowerCase());
      let variant = "";
      if (filesLower.includes("game.rgss3a") || dataFiles.some((name) => name.endsWith(".rvdata2"))) {
        variant = "VX Ace";
      } else if (filesLower.includes("game.rgss2a") || dataFiles.some((name) => name.endsWith(".rvdata"))) {
        variant = "VX";
      } else if (filesLower.includes("game.rgssad") || dataFiles.some((name) => name.endsWith(".rxdata"))) {
        variant = "XP";
      }
      if (variant || filesLower.includes("game.ini")) {
        const ini = filesLower.includes("game.ini") ? readHead(path.join(root, "Game.ini"), 2048) : "";
        const isRpgm = variant || /\bRTP\b|Library=|Scripts=/i.test(ini);
        if (isRpgm) {
          add("rpgm", variant ? 90 : 60, [`RPG Maker ${variant || "XP/VX"} data files`], {
            variant,
            preferredExecutables: rootExes.filter((name) => /^game\.exe$/i.test(name)),
          });
        }
      }
    } else if (filesLower.includes("rpg_rt.exe") || filesLower.includes("rpg_rt.ldb")) {
      add("rpgm", 90, ["RPG Maker 2000/2003 runtime (RPG_RT)"], {
        variant: "2000/2003",
        preferredExecutables: ["RPG_RT.exe"],
      });
    }
  }

  // ── Unity ─────────────────────────────────────────────────────────────
  {
    let score = 0;
    const reasons = [];
    const dataDirs = dirs.filter((name) => /_data$/i.test(name));
    const unityDataDir = dataDirs.find((name) => {
      const dataPath = path.join(root, name);
      return (
        exists(path.join(dataPath, "globalgamemanagers")) ||
        exists(path.join(dataPath, "resources.assets")) ||
        exists(path.join(dataPath, "app.info")) ||
        exists(path.join(dataPath, "data.unity3d")) ||
        exists(path.join(dataPath, "Managed"))
      );
    });
    if (unityDataDir) {
      score += 70;
      reasons.push(`${unityDataDir}/ player data folder`);
    }
    if (filesLower.includes("unityplayer.dll")) {
      score += 40;
      reasons.push("UnityPlayer.dll");
    }
    if (dirsLower.includes("monobleedingedge")) {
      score += 15;
      reasons.push("MonoBleedingEdge/ runtime");
    }
    if (filesLower.some((name) => name.startsWith("unitycrashhandler"))) {
      score += 10;
    }
    const playerExe = unityDataDir
      ? rootExes.find(
          (name) =>
            name.replace(/\.exe$/i, "").toLowerCase() ===
            unityDataDir.replace(/_data$/i, "").toLowerCase(),
        )
      : "";
    add("unity", score, reasons, {
      preferredExecutables: playerExe ? [playerExe] : [],
      ignoredExecutables: ["unitycrashhandler64.exe", "unitycrashhandler32.exe", "unitycrashhandler.exe"],
    });
  }

  // ── Unreal Engine ─────────────────────────────────────────────────────
  {
    let score = 0;
    const reasons = [];
    const hasEngineDir =
      dirsLower.includes("engine") &&
      (has(root, "Engine", "Binaries") || has(root, "Engine", "Content") || has(root, "Engine", "Config"));
    if (hasEngineDir) {
      score += 50;
      reasons.push("Engine/ folder");
    }
    /** @type {string[]} */
    const shipping = [];
    for (const dir of dirs) {
      if (dir.toLowerCase() === "engine") {
        continue;
      }
      const binaries = path.join(root, dir, "Binaries");
      if (!exists(binaries)) {
        continue;
      }
      for (const platform of safeReadDir(binaries)) {
        if (!platform.isDirectory()) continue;
        for (const file of safeReadDir(path.join(binaries, platform.name))) {
          if (file.isFile() && /-shipping\.exe$/i.test(file.name)) {
            shipping.push(path.join(dir, "Binaries", platform.name, file.name).replace(/\\/g, "/"));
          }
        }
      }
      if (has(root, dir, "Content", "Paks")) {
        score += 30;
        reasons.push(`${dir}/Content/Paks`);
      }
    }
    if (shipping.length > 0) {
      score += 40;
      reasons.push("Binaries/*-Shipping.exe");
    }
    if (files.some((name) => /\.uproject$/i.test(name))) {
      score += 20;
      reasons.push(".uproject file");
    }
    if (rootExes.length > 0 && hasEngineDir) {
      score += 10;
    }
    add("unreal", score, reasons, {
      preferredExecutables: [
        ...rootExes.filter((name) => !/crashreportclient|unrealcefsubprocess|epicwebhelper/i.test(name)),
        ...shipping,
      ],
      ignoredExecutables: ["crashreportclient.exe", "unrealcefsubprocess.exe", "epicwebhelper.exe", "ue4prereqsetup_x64.exe", "ueprereqsetup_x64.exe"],
    });
  }

  // ── Godot ─────────────────────────────────────────────────────────────
  {
    const pck = files.find((name) => /\.pck$/i.test(name));
    let score = 0;
    const reasons = [];
    if (pck) {
      score += 70;
      reasons.push(`${pck} package`);
      const stem = pck.replace(/\.pck$/i, "").toLowerCase();
      const exe = rootExes.find((name) => name.replace(/\.exe$/i, "").toLowerCase() === stem);
      add("godot", score, reasons, { preferredExecutables: exe ? [exe] : [] });
    } else if (filesLower.includes("project.godot")) {
      add("godot", 60, ["project.godot"]);
    }
  }

  // ── Wolf RPG ──────────────────────────────────────────────────────────
  {
    let score = 0;
    const reasons = [];
    if (filesLower.includes("data.wolf")) {
      score += 80;
      reasons.push("Data.wolf");
    } else if (dirsLower.includes("data")) {
      const dataFiles = safeReadDir(path.join(root, "Data")).map((entry) => entry.name.toLowerCase());
      if (dataFiles.some((name) => name.endsWith(".wolf"))) {
        score += 70;
        reasons.push("Data/*.wolf");
      }
    }
    if (score > 0 && filesLower.includes("config.exe")) {
      score += 10;
    }
    add("wolf", score, reasons, {
      preferredExecutables: rootExes.filter((name) => /^game\.exe$/i.test(name)),
      ignoredExecutables: ["config.exe"],
    });
  }

  // ── KiriKiri ──────────────────────────────────────────────────────────
  if (files.some((name) => /\.xp3$/i.test(name))) {
    add("kirikiri", 80, ["*.xp3 archives"]);
  }

  // ── GameMaker ─────────────────────────────────────────────────────────
  if (filesLower.includes("data.win") || filesLower.includes("game.unx") || filesLower.includes("audiogroup1.dat")) {
    add("gamemaker", 80, ["data.win runtime data"]);
  }

  // ── TyranoBuilder ─────────────────────────────────────────────────────
  if (dirsLower.includes("tyrano") && (dirsLower.includes("data") || filesLower.includes("index.html"))) {
    add("tyrano", 80, ["tyrano/ engine folder"], {
      preferredExecutables: filesLower.includes("index.html") && rootExes.length === 0 ? ["index.html"] : rootExes,
      ignoredExecutables: ["nw.exe"],
    });
  }

  // ── QSP / RAGS / ADRIFT / TADS ────────────────────────────────────────
  if (files.some((name) => /\.qsp$/i.test(name))) {
    add("qsp", 70, ["*.qsp story file"]);
  }
  if (files.some((name) => /\.rag$/i.test(name))) {
    add("rags", 70, ["*.rag story file"]);
  }
  if (files.some((name) => /\.(taf|blorb)$/i.test(name))) {
    add("adrift", 60, ["*.taf story file"]);
  }
  if (files.some((name) => /\.(gam|t3)$/i.test(name))) {
    add("tads", 60, ["*.gam/*.t3 story file"]);
  }

  // ── Flash ─────────────────────────────────────────────────────────────
  {
    const swf = files.filter((name) => /\.swf$/i.test(name));
    if (swf.length > 0) {
      const score = rootExes.length > 0 ? 45 : 75;
      add("flash", score, ["*.swf movie"], {
        preferredExecutables: rootExes.length ? [] : swf,
      });
    } else if (dirsLower.includes("meta-inf") && has(root, "META-INF", "AIR")) {
      add("flash", 70, ["Adobe AIR application"]);
    }
  }

  // ── Java ──────────────────────────────────────────────────────────────
  {
    const jars = files.filter((name) => /\.jar$/i.test(name));
    if (jars.length > 0) {
      add("java", rootExes.length > 0 ? 40 : 75, ["*.jar application"], {
        preferredExecutables: rootExes.length ? [] : jars,
      });
    }
  }

  // ── HTML / browser games (Twine, SugarCube, Construct, Electron, NW.js) ─
  {
    let score = 0;
    const reasons = [];
    const indexHtml = ["index.html", "index.htm"].find((name) => filesLower.includes(name));
    let variant = "";
    if (indexHtml) {
      score += 45;
      reasons.push("index.html at the root");
      const head = readHead(path.join(root, indexHtml));
      if (/<tw-storydata|tw-passagedata|SugarCube|Harlowe|twine/i.test(head)) {
        score += 30;
        variant = "Twine";
        reasons.push("Twine story data");
      } else if (/c2runtime|c3runtime|construct/i.test(head)) {
        score += 20;
        variant = "Construct";
      }
    } else if (dirsLower.includes("www") && has(root, "www", "index.html")) {
      score += 30;
      reasons.push("www/index.html");
    }
    if (filesLower.includes("nw.exe") || filesLower.includes("nw.dll") || filesLower.includes("nw_elf.dll")) {
      score += 25;
      variant = variant || "NW.js";
      reasons.push("NW.js runtime");
    }
    if (dirsLower.includes("resources") && has(root, "resources", "app.asar")) {
      score += 35;
      variant = variant || "Electron";
      reasons.push("resources/app.asar (Electron)");
    }
    if (filesLower.some((name) => /^c[23]runtime\.js$/.test(name))) {
      score += 30;
      variant = variant || "Construct";
      reasons.push("Construct runtime");
    }
    add("html", score, reasons, {
      variant,
      preferredExecutables:
        rootExes.filter((name) => !/^nw\.exe$/i.test(name)).length > 0
          ? rootExes.filter((name) => !/^nw\.exe$/i.test(name))
          : indexHtml
            ? [indexHtml]
            : [],
      ignoredExecutables: ["nw.exe", "nwjc.exe", "payload.exe", "notification_helper.exe"],
    });
  }

  // Executables the caller already found may add evidence for engines
  // whose marker sits deeper than the root (e.g. Ren'Py launcher inside a
  // nested folder that was not unwrapped).
  if (candidates.length === 0 && executables.length > 0) {
    const lower = executables.map((value) => value.toLowerCase());
    if (lower.some((value) => /(^|\/)renpy\.(exe|sh)$/.test(value) || /\/renpy\//.test(value))) {
      add("renpy", 40, ["Ren'Py launcher found below the root"]);
    } else if (lower.some((value) => /unitycrashhandler/.test(value))) {
      add("unity", 30, ["Unity crash handler found below the root"]);
    } else if (lower.some((value) => /\/binaries\/win64\/.*-shipping\.exe$/.test(value))) {
      add("unreal", 40, ["Unreal shipping binary found below the root"]);
    } else if (lower.every((value) => /\.html?$/.test(value))) {
      add("html", 30, ["only HTML entry points found"]);
    } else if (lower.every((value) => /\.swf$/.test(value))) {
      add("flash", 30, ["only Flash movies found"]);
    } else if (lower.every((value) => /\.jar$/.test(value))) {
      add("java", 30, ["only Java archives found"]);
    }
  }

  candidates.sort((left, right) => right.confidence - left.confidence);
  const best = candidates[0];
  if (!best || best.confidence < 40) {
    return {
      id: "",
      engine: "",
      variant: "",
      confidence: best ? best.confidence : 0,
      reasons: best ? best.reasons : [],
      preferredExecutables: [],
      ignoredExecutables: [],
    };
  }
  return best;
}

module.exports = {
  ENGINE_LABELS,
  detectGameEngine,
};
