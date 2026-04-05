// @ts-check

const path = require("path");

const NOISE_TITLE_KEYS = new Set([
  "commonextprotocolexecutor",
  "din",
  "fullnet",
  "managed",
  "manual",
  "readme",
  "reipatcher",
]);

const NOISE_EXECUTABLE_KEYS = new Set([
  "common.extprotocol.executor.exe",
  "license.html",
  "license.txt",
  "manual.html",
  "manual.htm",
  "readme.html",
  "readme.htm",
  "readme.txt",
  "reipatcher.exe",
]);

const INFRASTRUCTURE_SEGMENTS = new Set([
  "audio",
  "bepinex",
  "bin",
  "css",
  "fonts",
  "fullnet",
  "game",
  "images",
  "img",
  "js",
  "lib",
  "libs",
  "locales",
  "managed",
  "monobleedingedge",
  "plugins",
  "renpy",
  "resources",
  "streamingassets",
  "translators",
  "www",
]);

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "");
}

/**
 * @param {string | null | undefined} candidatePath
 * @returns {{ flagged: boolean, reasons: string[] }}
 */
function inspectInfrastructurePath(candidatePath) {
  const parts = String(candidatePath || "")
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const reasons = [];

  parts.forEach((part, index) => {
    if (index === 0) {
      return;
    }

    const normalized = normalizeKey(part);
    if (
      INFRASTRUCTURE_SEGMENTS.has(normalized) ||
      normalized.endsWith("_data")
    ) {
      reasons.push(`path includes runtime/helper segment '${part}'`);
    }
  });

  return {
    flagged: reasons.length > 0,
    reasons,
  };
}

/**
 * @param {any} game
 * @returns {{ suspicious: boolean, reasons: string[] }}
 */
function inspectLibraryNoiseRecord(game) {
  const reasons = [];
  const titleKey = normalizeKey(game?.title);
  const creatorKey = normalizeKey(game?.creator);
  const hasAtlasMapping = Boolean(game?.atlas_id || game?.f95_id);
  const versions = Array.isArray(game?.versions) ? game.versions : [];

  if (hasAtlasMapping) {
    return {
      suspicious: false,
      reasons: [],
    };
  }

  if (titleKey && NOISE_TITLE_KEYS.has(titleKey)) {
    reasons.push(`title '${game?.title}' is a known runtime/helper artifact`);
  }

  for (const version of versions) {
    const execBaseName = path.basename(String(version?.exec_path || ""));
    const execKey = execBaseName.toLowerCase();

    if (execKey && NOISE_EXECUTABLE_KEYS.has(execKey)) {
      reasons.push(`executable '${execBaseName}' is a known helper/readme artifact`);
    }

    const gamePathInspection = inspectInfrastructurePath(version?.game_path || "");
    reasons.push(...gamePathInspection.reasons);
  }

  if (creatorKey && creatorKey !== "unknown") {
    return {
      suspicious: false,
      reasons: [],
    };
  }

  return {
    suspicious: reasons.length > 0,
    reasons: [...new Set(reasons)],
  };
}

/**
 * @param {{
 *   appPaths: any,
 *   getGames: (appPaths: any, offset: number, limit: number | null) => Promise<any[]>,
 *   deleteGameCompletely: (recordId: number, appPaths: any) => Promise<{ success: boolean, error?: string }>,
 *   dryRun?: boolean
 * }} input
 */
async function cleanupLibraryNoiseRecords(input) {
  const games = await input.getGames(input.appPaths, 0, null);
  const candidates = [];

  for (const game of games || []) {
    const inspection = inspectLibraryNoiseRecord(game);
    if (!inspection.suspicious) {
      continue;
    }

    candidates.push({
      recordId: game.record_id,
      title: game.title || "",
      creator: game.creator || "",
      installPaths: (game.versions || []).map((version) => version.game_path || ""),
      execPaths: (game.versions || []).map((version) => version.exec_path || ""),
      reasons: inspection.reasons,
    });
  }

  if (input.dryRun) {
    return {
      candidates,
      removed: [],
      failed: [],
    };
  }

  const removed = [];
  const failed = [];

  for (const candidate of candidates) {
    const result = await input.deleteGameCompletely(candidate.recordId, input.appPaths);
    if (result?.success) {
      removed.push(candidate);
      continue;
    }

    failed.push({
      ...candidate,
      error: result?.error || "Library cleanup failed.",
    });
  }

  return {
    candidates,
    removed,
    failed,
  };
}

module.exports = {
  cleanupLibraryNoiseRecords,
  inspectInfrastructurePath,
  inspectLibraryNoiseRecord,
};
