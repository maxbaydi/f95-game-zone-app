// @ts-check

const fs = require("fs");
const path = require("path");
const {
  buildVersionUpdateState,
  getNewestInstalledVersion,
} = require("../shared/versionUpdate");
const { LIBRARY_INSTALL_STATES } = require("../shared/libraryInstallState");

const DEFAULT_PROBE_TIMEOUT_MS = 1500;
const ANNOTATE_CONCURRENCY = 8;

/** @typedef {{ exists: boolean, known: boolean }} PresenceResult */

/**
 * @param {string} targetPath
 * @param {string} platform
 * @returns {string}
 */
function normalizeProbeKey(targetPath, platform) {
  const normalized = String(targetPath || "").trim();
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Checks whether install folders still exist on disk.
 *
 * Results are cached per call site, a missing drive root short-circuits every
 * path on that drive, and a stat that does not answer in time (disconnected
 * network share) reports `known: false` instead of blocking the caller.
 *
 * @param {{
 *   stat?: (targetPath: string) => Promise<{ isDirectory: () => boolean }>,
 *   platform?: string,
 *   timeoutMs?: number
 * }=} options
 * @returns {(targetPath: string | null | undefined) => Promise<PresenceResult>}
 */
function createPathPresenceProbe(options = {}) {
  const stat = options.stat || fs.promises.stat;
  const platform = options.platform || process.platform;
  const timeoutMs =
    Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_PROBE_TIMEOUT_MS;
  const pathModule = platform === "win32" ? path.win32 : path.posix;
  /** @type {Map<string, Promise<PresenceResult>>} */
  const cache = new Map();

  /**
   * @param {string} targetPath
   * @returns {Promise<PresenceResult>}
   */
  async function statDirectory(targetPath) {
    /** @type {NodeJS.Timeout | null} */
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    });

    try {
      const outcome = await Promise.race([
        Promise.resolve()
          .then(() => stat(targetPath))
          .then(
            (stats) => ({ stats }),
            (error) => ({ error }),
          ),
        timeout,
      ]);

      if (outcome && "timedOut" in outcome) {
        return { exists: false, known: false };
      }

      if (outcome && "error" in outcome) {
        const code = outcome.error && outcome.error.code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          return { exists: false, known: true };
        }
        return { exists: false, known: false };
      }

      const stats = outcome && "stats" in outcome ? outcome.stats : null;
      const isDirectory =
        stats && typeof stats.isDirectory === "function"
          ? Boolean(stats.isDirectory())
          : false;
      return { exists: isDirectory, known: true };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * @param {string} key
   * @param {string} targetPath
   * @returns {Promise<PresenceResult>}
   */
  function probeCached(key, targetPath) {
    let pending = cache.get(key);
    if (!pending) {
      pending = statDirectory(targetPath);
      cache.set(key, pending);
    }
    return pending;
  }

  return async function probe(targetPath) {
    const normalized = String(targetPath || "").trim();
    if (!normalized) {
      return { exists: false, known: true };
    }

    const key = normalizeProbeKey(normalized, platform);

    if (platform === "win32") {
      const root = pathModule.parse(normalized).root;
      const rootKey = root ? normalizeProbeKey(root, platform) : "";
      if (rootKey && rootKey !== key) {
        const rootResult = await probeCached(rootKey, root);
        if (rootResult.known && !rootResult.exists) {
          return { exists: false, known: true };
        }
        if (!rootResult.known) {
          // The drive or share does not answer: do not wait for a timeout on
          // every game folder under it, report all of them as unknown.
          return { exists: false, known: false };
        }
      }
    }

    return probeCached(key, normalized);
  };
}

/**
 * @param {Array<{ isPresent?: boolean }>} versions
 * @returns {string}
 */
function resolveGameInstallState(versions) {
  const list = Array.isArray(versions) ? versions : [];
  if (list.length === 0) {
    return LIBRARY_INSTALL_STATES.NOT_INSTALLED;
  }

  return list.some((version) => version && version.isPresent)
    ? LIBRARY_INSTALL_STATES.INSTALLED
    : LIBRARY_INSTALL_STATES.MISSING;
}

/**
 * @param {any} game
 * @param {(targetPath: string) => Promise<PresenceResult>} probe
 */
async function annotateGamePresence(game, probe) {
  if (!game || typeof game !== "object") {
    return game;
  }

  const versions = Array.isArray(game.versions) ? game.versions : [];
  const annotatedVersions = await Promise.all(
    versions.map(async (version) => {
      const gamePath = String(version?.game_path || "").trim();
      const presence = gamePath
        ? await probe(gamePath)
        : { exists: false, known: true };
      const isPresent = presence.known ? presence.exists : true;

      return {
        ...version,
        isPresent,
        presenceKnown: presence.known,
      };
    }),
  );

  const presentVersions = annotatedVersions.filter((version) => version.isPresent);
  const installState = resolveGameInstallState(annotatedVersions);
  const versionState = buildVersionUpdateState(game.latestVersion, presentVersions);

  return {
    ...game,
    versions: annotatedVersions,
    installState,
    presentVersionCount: presentVersions.length,
    missingVersionCount: annotatedVersions.length - presentVersions.length,
    presenceUnknownCount: annotatedVersions.filter(
      (version) => !version.presenceKnown,
    ).length,
    newestInstalledVersion: versionState.newestInstalledVersion,
    lastKnownVersion: getNewestInstalledVersion(annotatedVersions),
    isUpdateAvailable:
      installState === LIBRARY_INSTALL_STATES.INSTALLED && versionState.hasUpdate,
  };
}

/**
 * Adds on-disk presence to library games loaded from SQLite:
 * `versions[].isPresent`, `installState`, counts, and an `isUpdateAvailable`
 * that only considers versions that still exist.
 *
 * @param {any[] | null | undefined} games
 * @param {{
 *   probe?: (targetPath: string) => Promise<PresenceResult>,
 *   timeoutMs?: number
 * }=} options
 * @returns {Promise<any[]>}
 */
async function annotateLibraryPresence(games, options = {}) {
  const list = Array.isArray(games) ? games : [];
  const probe =
    typeof options.probe === "function"
      ? options.probe
      : createPathPresenceProbe({ timeoutMs: options.timeoutMs });
  const results = new Array(list.length);

  for (let start = 0; start < list.length; start += ANNOTATE_CONCURRENCY) {
    const batch = list.slice(start, start + ANNOTATE_CONCURRENCY);
    const annotated = await Promise.all(
      batch.map((game) => annotateGamePresence(game, probe)),
    );
    annotated.forEach((game, index) => {
      results[start + index] = game;
    });
  }

  return results;
}

module.exports = {
  annotateGamePresence,
  annotateLibraryPresence,
  createPathPresenceProbe,
  resolveGameInstallState,
};
