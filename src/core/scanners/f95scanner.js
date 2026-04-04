const fs = require("fs");
const path = require("path");
const { searchAtlas, findF95Id, checkRecordExist } = require("../../database");
const { detectRenpyGame } = require("../../main/detectors/renpyDetector");
const { isScanCancelled } = require("../../main/scanSessions");
const { parseScanTitle } = require("../../shared/scanTitleParser");

const engineMap = {
  rpgm: [
    "rpgmv.exe",
    "rpgmk.exe",
    "rpgvx.exe",
    "rpgvxace.exe",
    "rpgmktranspatch.exe",
  ],
  renpy: ["renpy.exe", "renpy.sh"],
  unity: ["unityplayer.dll"],
  html: ["index.html"],
  flash: [".swf"],
};

const blacklist = [
  "UnityCrashHandler64.exe",
  "UnityCrashHandler32.exe",
  "payload.exe",
  "nwjc.exe",
  "notification_helper.exe",
  "nacl64.exe",
  "chromedriver.exe",
  "Squirrel.exe",
  "zsync.exe",
  "zsyncmake.exe",
  "cmake.exe",
  "pythonw.exe",
  "python.exe",
  "dxwebsetup.exe",
  "README.html",
  "manual.htm",
  "unins000.exe",
  "UE4PrereqSetup_X64.exe",
  "UEPrereqSetup_x64.exe",
  "credits.html",
  "LICENSES.chromium.html",
  "Uninstall.exe",
  "CONFIG_dl.exe",
];

/**
 * @param {string} code
 * @param {string} targetPath
 * @param {string} message
 * @param {string=} errorCode
 */
function createScanDiagnostic(code, targetPath, message, errorCode) {
  return {
    code,
    path: targetPath,
    message,
    errorCode: errorCode || "UNKNOWN",
    timestamp: new Date().toISOString(),
  };
}

/**
 * @param {{ webContents?: { send: (channel: string, payload: any) => void } }} window
 * @param {ReturnType<typeof createScanDiagnostic>} diagnostic
 */
function emitScanWarning(window, diagnostic) {
  console.warn("[scan.warning]", diagnostic);

  if (window?.webContents?.send) {
    window.webContents.send("scan-warning", diagnostic);
  }
}

/**
 * @param {Record<string, any>} params
 */
function throwIfCancelled(params) {
  if (isScanCancelled(params?.scanSession)) {
    throw Object.assign(new Error("Scan cancelled"), {
      code: "SCAN_CANCELLED",
    });
  }
}

/**
 * @param {string} directoryPath
 * @param {Record<string, any>} params
 * @param {{ webContents?: { send: (channel: string, payload: any) => void } }} window
 * @param {Array<ReturnType<typeof createScanDiagnostic>>} diagnostics
 */
function safeReadDirEntries(directoryPath, params, window, diagnostics) {
  throwIfCancelled(params);

  try {
    return fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch (error) {
    const diagnostic = createScanDiagnostic(
      "SCAN_READDIR_FAILED",
      directoryPath,
      `Skipping unreadable directory: ${directoryPath}`,
      error && error.code ? error.code : undefined,
    );
    diagnostics.push(diagnostic);
    emitScanWarning(window, diagnostic);
    return [];
  }
}

async function startScan(params, window) {
  const {
    folder,
    format,
    gameExt,
    archiveExt,
    isCompressed,
    deleteAfter,
    scanSize,
    downloadBannerImages,
    downloadPreviewImages,
    previewLimit,
    downloadVideos,
  } = params;
  const extensions = isCompressed ? archiveExt : gameExt;
  const games = [];
  /** @type {Array<ReturnType<typeof createScanDiagnostic>>} */
  const diagnostics = [];
  let potential = 0;

  console.log(
    `Starting scan in folder: ${folder} with extensions: ${extensions.join(", ")}`,
  );

  try {
    throwIfCancelled(params);

    if (isCompressed) {
      const allFiles = getAllFiles(
        folder,
        params.archiveExt,
        params,
        window,
        diagnostics,
      );
      const totalFiles = allFiles.length;
      let i = 0;
      for (const file of allFiles) {
        throwIfCancelled(params);
        i++;
        console.log(`Scanning file: ${file} (isFile: true)`);
        const success = await findGame(
          file,
          format,
          extensions,
          folder,
          5,
          true,
          games,
          window,
          params,
          [],
          diagnostics,
        );
        if (success) {
          potential = games.length;
          window.webContents.send("scan-complete", games[games.length - 1]);
        }
        window.webContents.send("scan-progress", {
          value: i,
          total: totalFiles,
          potential,
        });
      }
    } else {
      const rootEntries = safeReadDirEntries(
        folder,
        params,
        window,
        diagnostics,
      );
      const directories = rootEntries
        .filter((d) => d.isDirectory())
        .map((d) => path.join(folder, d.name));
      const totalDirs = directories.length + 1;
      let ittr = 0;

      console.log(
        `Found ${totalDirs} directories to scan (including root): ${folder}, ${directories.join(", ")}`,
      );

      console.log(`Scanning root directory: ${folder}`);
      ittr++;
      const rootFiles = rootEntries
        .filter((f) => f.isFile())
        .map((f) => path.join(folder, f.name));
      console.log(`Checking files in ${folder}: ${rootFiles.join(", ")}`);
      let foundInRoot = false;
      const rootExecutables = rootFiles.filter(
        (f) =>
          extensions.includes(path.extname(f).toLowerCase().slice(1)) &&
          !blacklist.includes(path.basename(f)),
      );
      if (rootExecutables.length > 0) {
        console.log(
          `Scanning root directory with executables: ${folder} (isFile: false)`,
        );
        const res = await findGame(
          folder,
          format,
          extensions,
          folder,
          0,
          false,
          games,
          window,
          params,
          rootExecutables,
          diagnostics,
        );
        if (res) {
          foundInRoot = true;
          potential = games.length;
          window.webContents.send("scan-complete", games[games.length - 1]);
        }
      }
      window.webContents.send("scan-progress", {
        value: ittr,
        total: totalDirs,
        potential,
      });

      if (!foundInRoot) {
        for (const dir of directories) {
          throwIfCancelled(params);
          console.log(`Scanning directory: ${dir}`);
          ittr++;
          const dirEntries = safeReadDirEntries(
            dir,
            params,
            window,
            diagnostics,
          );
          const files = dirEntries
            .filter((f) => f.isFile())
            .map((f) => path.join(dir, f.name));
          console.log(`Checking files in ${dir}: ${files.join(", ")}`);
          let found = false;
          const dirExecutables = files.filter(
            (f) =>
              extensions.includes(path.extname(f).toLowerCase().slice(1)) &&
              !blacklist.includes(path.basename(f)),
          );
          if (dirExecutables.length > 0) {
            console.log(
              `Scanning directory with executables: ${dir} (isFile: false)`,
            );
            const res = await findGame(
              dir,
              format,
              extensions,
              folder,
              0,
              false,
              games,
              window,
              params,
              dirExecutables,
              diagnostics,
            );
            if (res) {
              found = true;
              potential = games.length;
              window.webContents.send("scan-complete", games[games.length - 1]);
            }
          }

          if (!found) {
            const maxDepth = format && format.trim() !== "" ? 3 : Infinity;
            const subdirs = getAllSubdirs(
              dir,
              folder,
              maxDepth,
              params,
              window,
              diagnostics,
            );
            const formatParts =
              format && format.trim() !== ""
                ? format.split("/").map((part) => part.replace(/\{|\}/g, ""))
                : [];
            const expectedDepth = formatParts.length || 2;
            const versionDirs =
              format && format.trim() !== ""
                ? subdirs.filter((subdir) => {
                    const relativePath = subdir.replace(
                      `${folder}${path.sep}`,
                      "",
                    );
                    const pathParts = relativePath.split(path.sep);
                    return pathParts.length === expectedDepth;
                  })
                : subdirs;
            console.log(
              `Version directories for ${dir}: ${versionDirs.join(", ")}`,
            );
            for (const t of versionDirs) {
              throwIfCancelled(params);
              console.log(`Processing version directory: ${t}`);
              const subdirEntries = safeReadDirEntries(
                t,
                params,
                window,
                diagnostics,
              );
              const filesInSubdir = subdirEntries
                .filter((f) => f.isFile())
                .map((f) => path.join(t, f.name));
              console.log(
                `Checking files in ${t}: ${filesInSubdir.join(", ")}`,
              );
              const subdirExecutables = filesInSubdir.filter(
                (f) =>
                  extensions.includes(path.extname(f).toLowerCase().slice(1)) &&
                  !blacklist.includes(path.basename(f)),
              );
              if (subdirExecutables.length > 0) {
                console.log(
                  `Scanning version Directory with executables: ${t} (isFile: false)`,
                );
                const res = await findGame(
                  t,
                  format,
                  extensions,
                  folder,
                  0,
                  false,
                  games,
                  window,
                  params,
                  subdirExecutables,
                  diagnostics,
                );
                if (res) {
                  found = true;
                  potential = games.length;
                  window.webContents.send(
                    "scan-complete",
                    games[games.length - 1],
                  );
                }
              }
            }
          }
          window.webContents.send("scan-progress", {
            value: ittr,
            total: totalDirs,
            potential,
          });
        }
      }
    }

    console.log(`Scan complete. Total games found: ${games.length}`);
    window.webContents.send("scan-complete-final", games);
    return {
      success: true,
      games,
      diagnostics,
      warningsCount: diagnostics.length,
      cancelled: false,
    };
  } catch (error) {
    if (error && error.code === "SCAN_CANCELLED") {
      window.webContents.send("scan-complete-final", games);
      return {
        success: false,
        games,
        diagnostics,
        warningsCount: diagnostics.length,
        cancelled: true,
        error: "Scan cancelled",
      };
    }

    throw error;
  }
}

function getAllSubdirs(
  root,
  basePath,
  maxDepth = Infinity,
  params,
  window,
  diagnostics,
) {
  const dirs = [];
  const stack = [{ path: root, depth: 0 }];
  while (stack.length) {
    throwIfCancelled(params);
    const { path: current, depth } = stack.pop();
    if (depth >= maxDepth) continue; // Skip if depth exceeds limit
    console.log(`Exploring directory: ${current}`);
    const items = safeReadDirEntries(current, params, window, diagnostics);
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        dirs.push(full);
        stack.push({ path: full, depth: depth + 1 });
      }
    }
  }
  return dirs;
}

function getAllFiles(root, extensions, params, window, diagnostics) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    throwIfCancelled(params);
    const current = stack.pop();
    console.log(`Exploring directory for files: ${current}`);
    const items = safeReadDirEntries(current, params, window, diagnostics);
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(full);
      } else if (
        item.isFile() &&
        extensions.includes(path.extname(full).toLowerCase().slice(1)) &&
        !blacklist.includes(path.basename(full))
      ) {
        files.push(full);
      }
    }
  }
  console.log(`Found ${files.length} archive files: ${files.join(", ")}`);
  return files;
}

async function findGame(
  t,
  format,
  extensions,
  rootPath,
  stopLevel,
  isFile,
  games,
  window,
  params,
  executables,
  diagnostics,
) {
  console.log(
    `Finding game in: ${t} (isFile: ${isFile}) with extensions: ${extensions.join(", ")}`,
  );
  let potentialExecutables = executables || [];
  let singleExecutable = "";
  let selectedValue = "";
  let singleVisible = "hidden";
  let multipleVisible = "hidden";
  let gameEngine = "";
  let isArchive = false;
  let detectionScore = 0;
  let detectionReasons = [];

  try {
    throwIfCancelled(params);
    if (!isFile) {
      if (potentialExecutables.length === 0) {
        console.log(`No executable files provided for ${t}`);
        return false;
      }
      potentialExecutables = potentialExecutables
        .map((f) => path.basename(f))
        .filter((f) => !f.includes("-32")); // Exclude files with "-32" in the name
      for (const exec of potentialExecutables) {
        for (const [engine, patterns] of Object.entries(engineMap)) {
          if (patterns.some((p) => exec.toLowerCase().includes(p))) {
            gameEngine = engine;
            console.log(`Matched engine ${gameEngine} for ${exec}`);
            break;
          }
        }
        if (gameEngine) break;
      }

      if (potentialExecutables.length > 0) {
        detectionScore += 30;
        detectionReasons.push("found executable launch candidates");
      }

      if (gameEngine) {
        detectionScore += 25;
        detectionReasons.push(`matched ${gameEngine} runtime signature`);
      }

      if (potentialExecutables.length === 1) {
        detectionScore += 10;
        detectionReasons.push("found a single launch candidate");
      } else if (potentialExecutables.length > 1) {
        detectionScore += 5;
        detectionReasons.push("found multiple launch candidates");
      }

      const renpyDetection = detectRenpyGame(t, potentialExecutables);
      detectionScore = Math.max(detectionScore, renpyDetection.confidence);
      detectionReasons = [...detectionReasons, ...renpyDetection.reasons];

      if ((!gameEngine || gameEngine === "Unknown") && renpyDetection.matched) {
        gameEngine = "renpy";
        if (
          !detectionReasons.includes(
            "classified as renpy from filesystem layout",
          )
        ) {
          detectionReasons.push("classified as renpy from filesystem layout");
        }
      }

      if (potentialExecutables.length === 1) {
        singleExecutable = potentialExecutables[0];
        selectedValue = singleExecutable;
        singleVisible = "visible";
      } else if (potentialExecutables.length > 1) {
        multipleVisible = "visible";
        selectedValue = potentialExecutables[0];
      }
    } else {
      const ext = path.extname(t).toLowerCase().slice(1);
      console.log(
        `Checking file ${t}, Extension: ${ext}, Blacklisted: ${blacklist.includes(path.basename(t))}`,
      );
      if (!extensions.includes(ext) || blacklist.includes(path.basename(t))) {
        console.log(
          `File ${t} has unsupported extension ${ext} or is blacklisted`,
        );
        return false;
      }
      isArchive = params.isCompressed;
      singleExecutable = path.basename(t);
      selectedValue = singleExecutable;
      singleVisible = "visible";
      potentialExecutables = [singleExecutable];
      detectionScore = isArchive ? 25 : 0;
      detectionReasons = isArchive
        ? [
            "found supported archive candidate",
            "archive scan cannot validate Ren'Py layout before extraction",
          ]
        : [];
    }

    let title = "";
    let creator = "Unknown";
    let version = "";

    const relativePath = t.replace(`${rootPath}${path.sep}`, "");
    console.log(`Relative path: ${relativePath}, Format: ${format}`);
    if (format && format.trim() !== "") {
      const parsePath = isFile ? path.dirname(relativePath) : relativePath;
      const pathParts = parsePath.split(path.sep);
      console.log(`Path parts: ${pathParts.join(", ")}`);
      const formatParts = format
        .split("/")
        .map((part) => part.replace(/\{|\}/g, ""));
      if (pathParts.length >= formatParts.length) {
        const mapping = {};
        formatParts.forEach((part, index) => {
          mapping[part] = pathParts[index] || "";
        });
        creator = mapping.creator || "Unknown";
        title = mapping.title || "";
        version = mapping.version || "";
        console.log(
          `Structured match: creator=${creator}, title=${title}, version=${version}`,
        );
      }
    }

    if (!title || title.trim() === "") {
      let filename = isFile
        ? path.basename(t, path.extname(t))
        : path.basename(t);
      console.log(`Parsing filename: ${filename}`);
      const parsedName = parseScanTitle(filename);
      title = parsedName.title;
      version = parsedName.version;
      console.log(`Parsed: title=${title}, version=${version}`);
      if (!title || title.trim() === "") {
        title = filename;
        version = "Unknown";
      }
    }

    if (!title || title.trim() === "") {
      console.log(`No valid title extracted from ${t}, parsing failed`);
      return false;
    }

    console.log(
      `Processing game: ${title}, Creator: ${creator}, Version: ${version}, Engine: ${gameEngine}`,
    );
    let data;
    try {
      data = await searchAtlas(title, creator);
      console.log(`searchAtlas returned: ${JSON.stringify(data)}`);
    } catch (err) {
      console.error(`searchAtlas error for ${title}: ${err.message}`);
      diagnostics.push(
        createScanDiagnostic(
          "SCAN_ATLAS_LOOKUP_FAILED",
          t,
          `Atlas lookup failed for ${title || path.basename(t)}`,
          err && err.code ? err.code : undefined,
        ),
      );
      data = [];
    }

    let atlasId = "";
    let f95Id = "";
    let results = [];
    if (data.length === 1) {
      atlasId = data[0].atlas_id;
      f95Id = data[0].f95_id || "";
      title = data[0].title;
      creator = data[0].creator;
      gameEngine = data[0].engine || gameEngine;
      results = [{ key: "match", value: "Match Found" }];
    } else if (data.length > 1) {
      results = data.map((d) => ({
        key: String(d.atlas_id),
        value: `${d.atlas_id} | ${d.f95_id || ""} | ${d.title} | ${d.creator}`,
      }));
    }
    const engine = gameEngine || "Unknown";
    let recordExist = false;
    try {
      recordExist = await checkRecordExist(title, creator, engine, version, t);
      console.log(
        `checkRecordExist for ${title}, ${creator}, ${version}, ${t}: ${recordExist}`,
      );
    } catch (err) {
      console.error(`checkRecordExist error for ${title}: ${err.message}`);
      diagnostics.push(
        createScanDiagnostic(
          "SCAN_DB_LOOKUP_FAILED",
          t,
          `Local library lookup failed for ${title || path.basename(t)}`,
          err && err.code ? err.code : undefined,
        ),
      );
      return false;
    }

    if (!recordExist) {
      const gd = {
        atlasId,
        f95Id,
        title,
        creator,
        engine,
        version,
        singleExecutable,
        executables: potentialExecutables.map((e) => ({ key: e, value: e })),
        selectedValue,
        singleVisible,
        multipleVisible,
        folder: isFile ? path.dirname(t) : t,
        results,
        resultSelectedValue: results[0]?.key || "",
        resultVisibility: results.length > 0 ? "visible" : "hidden",
        recordExist,
        isArchive,
        detectionScore,
        detectionReasons: Array.from(new Set(detectionReasons.filter(Boolean))),
      };
      console.log(`Adding game to list: ${JSON.stringify(gd)}`);
      games.push(gd);
      return true;
    }
    console.log(`Game ${title} already exists or failed to add`);
    return false;
  } catch (err) {
    if (err && err.code === "SCAN_CANCELLED") {
      throw err;
    }

    diagnostics.push(
      createScanDiagnostic(
        "SCAN_CANDIDATE_FAILED",
        t,
        `Failed to classify candidate: ${t}`,
        err && err.code ? err.code : undefined,
      ),
    );
    console.error(`Error processing ${t}: ${err.message}, Stack: ${err.stack}`);
    return false;
  }
}

module.exports = { startScan };
