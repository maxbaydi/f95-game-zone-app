// @ts-check

const fs = require("fs");
const path = require("path");

/**
 * @typedef {Object} AtlasAppPaths
 * @property {string} root
 * @property {string} data
 * @property {string} cache
 * @property {string} logs
 * @property {string} backups
 * @property {string} launchers
 * @property {string} games
 * @property {string} downloads
 * @property {string} images
 * @property {string} updates
 * @property {string} bannerTemplates
 * @property {string} templates
 * @property {string} db
 * @property {string} config
 * @property {string} mainLog
 */

/**
 * @typedef {Object} LegacyAtlasPaths
 * @property {string} root
 * @property {string} data
 * @property {string} launchers
 */

/**
 * @typedef {Object} ScopedLogger
 * @property {(message: string, details?: Record<string, unknown>) => void} info
 * @property {(message: string, details?: Record<string, unknown>) => void} warn
 * @property {(message: string, details?: Record<string, unknown>) => void} error
 */

/**
 * @param {string} userDataRoot
 * @returns {AtlasAppPaths}
 */
function buildAppPaths(userDataRoot) {
  const root = path.resolve(userDataRoot);
  const data = path.join(root, "data");
  const cache = path.join(root, "cache");
  const logs = path.join(root, "logs");
  const backups = path.join(root, "backups");
  const templates = path.join(data, "templates");

  return {
    root,
    data,
    cache,
    logs,
    backups,
    launchers: path.join(data, "launchers"),
    games: path.join(data, "games"),
    downloads: path.join(cache, "downloads"),
    images: path.join(cache, "images"),
    updates: path.join(cache, "updates"),
    bannerTemplates: path.join(templates, "banner"),
    templates,
    db: path.join(data, "data.db"),
    config: path.join(data, "config.ini"),
    mainLog: path.join(logs, "main.log"),
  };
}

/**
 * @param {AtlasAppPaths} appPaths
 */
function ensureAppDirs(appPaths) {
  [
    appPaths.root,
    appPaths.data,
    appPaths.cache,
    appPaths.logs,
    appPaths.backups,
    appPaths.launchers,
    appPaths.games,
    appPaths.downloads,
    appPaths.images,
    appPaths.updates,
    appPaths.templates,
    appPaths.bannerTemplates,
  ].forEach((directoryPath) => {
    fs.mkdirSync(directoryPath, { recursive: true });
  });
}

/**
 * @param {string} logFilePath
 * @param {string} scope
 * @returns {ScopedLogger}
 */
function createScopedLogger(logFilePath, scope) {
  /**
   * @param {"info" | "warn" | "error"} level
   * @param {string} message
   * @param {Record<string, unknown>=} details
   */
  function write(level, message, details) {
    const prefix = `[${scope}]`;
    const consoleMethod =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : console.log;

    if (details && Object.keys(details).length > 0) {
      consoleMethod(prefix, message, details);
    } else {
      consoleMethod(prefix, message);
    }

    try {
      const renderedDetails =
        details && Object.keys(details).length > 0
          ? ` ${JSON.stringify(details)}`
          : "";
      fs.appendFileSync(
        logFilePath,
        `${new Date().toISOString()} ${prefix} [${level.toUpperCase()}] ${message}${renderedDetails}${path.delimiter === ";" ? "\r\n" : "\n"}`,
      );
    } catch (logError) {
      console.error(prefix, "Failed to write bootstrap log", logError);
    }
  }

  return {
    info: (message, details) => write("info", message, details),
    warn: (message, details) => write("warn", message, details),
    error: (message, details) => write("error", message, details),
  };
}

/**
 * @param {{ appPath: string, isPackaged: boolean, mainDir: string }} options
 * @returns {LegacyAtlasPaths}
 */
function resolveLegacyPaths(options) {
  if (options.isPackaged) {
    const packagedRoot = path.resolve(options.appPath, "../../");

    return {
      root: packagedRoot,
      data: path.join(packagedRoot, "data"),
      launchers: path.join(packagedRoot, "launchers"),
    };
  }

  const developmentRoot = path.resolve(options.mainDir);

  return {
    root: developmentRoot,
    data: path.join(developmentRoot, "data"),
    launchers: path.join(developmentRoot, "launchers"),
  };
}

/**
 * @param {string} sourcePath
 * @param {string} targetPath
 * @param {ScopedLogger} logger
 */
function copyMissing(sourcePath, targetPath, logger) {
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  const resolvedSource = path.resolve(sourcePath);
  const resolvedTarget = path.resolve(targetPath);

  if (resolvedSource === resolvedTarget) {
    return;
  }

  const sourceStats = fs.statSync(resolvedSource);

  if (sourceStats.isDirectory()) {
    fs.mkdirSync(resolvedTarget, { recursive: true });

    for (const entry of fs.readdirSync(resolvedSource)) {
      copyMissing(
        path.join(resolvedSource, entry),
        path.join(resolvedTarget, entry),
        logger,
      );
    }

    return;
  }

  if (fs.existsSync(resolvedTarget)) {
    logger.info("Skipped existing legacy target", {
      sourcePath: resolvedSource,
      targetPath: resolvedTarget,
    });
    return;
  }

  fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
  fs.copyFileSync(resolvedSource, resolvedTarget);
  logger.info("Copied legacy file", {
    sourcePath: resolvedSource,
    targetPath: resolvedTarget,
  });
}

/**
 * @param {AtlasAppPaths} appPaths
 * @param {LegacyAtlasPaths} legacyPaths
 * @param {ScopedLogger} logger
 */
function migrateLegacyData(appPaths, legacyPaths, logger) {
  logger.info("Starting legacy storage migration", {
    legacyRoot: legacyPaths.root,
    targetRoot: appPaths.root,
  });

  const dataMappings = [
    [path.join(legacyPaths.data, "data.db"), appPaths.db],
    [path.join(legacyPaths.data, "config.ini"), appPaths.config],
    [path.join(legacyPaths.data, "games"), appPaths.games],
    [path.join(legacyPaths.data, "templates"), appPaths.templates],
    [path.join(legacyPaths.data, "images"), appPaths.images],
    [path.join(legacyPaths.data, "updates"), appPaths.updates],
    [path.join(legacyPaths.data, "logs"), appPaths.logs],
    [legacyPaths.launchers, appPaths.launchers],
  ];

  for (const [sourcePath, targetPath] of dataMappings) {
    copyMissing(sourcePath, targetPath, logger);
  }

  if (fs.existsSync(legacyPaths.data)) {
    const handledEntries = new Set([
      "data.db",
      "config.ini",
      "games",
      "templates",
      "images",
      "updates",
      "logs",
    ]);

    for (const entry of fs.readdirSync(legacyPaths.data)) {
      if (handledEntries.has(entry)) {
        continue;
      }

      copyMissing(
        path.join(legacyPaths.data, entry),
        path.join(appPaths.data, entry),
        logger,
      );
    }
  }

  logger.info("Finished legacy storage migration", {
    targetRoot: appPaths.root,
  });
}

/**
 * @param {{ getPath: (name: string) => string, getAppPath: () => string, isPackaged: boolean }} app
 * @param {{ mainDir: string }} options
 * @returns {AtlasAppPaths}
 */
function initializeAppPaths(app, options) {
  const appPaths = buildAppPaths(app.getPath("userData"));
  ensureAppDirs(appPaths);

  const logger = createScopedLogger(appPaths.mainLog, "bootstrap.paths");
  logger.info("Resolved writable app paths", {
    root: appPaths.root,
    data: appPaths.data,
    cache: appPaths.cache,
    logs: appPaths.logs,
    backups: appPaths.backups,
  });

  const legacyPaths = resolveLegacyPaths({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    mainDir: options.mainDir,
  });

  migrateLegacyData(appPaths, legacyPaths, logger);
  ensureAppDirs(appPaths);

  logger.info("Writable storage ready", {
    db: appPaths.db,
    config: appPaths.config,
    images: appPaths.images,
    launchers: appPaths.launchers,
  });

  return appPaths;
}

module.exports = {
  buildAppPaths,
  ensureAppDirs,
  resolveLegacyPaths,
  migrateLegacyData,
  initializeAppPaths,
};
