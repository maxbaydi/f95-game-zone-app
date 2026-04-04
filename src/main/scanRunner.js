// @ts-check

const { openDatabase } = require("./db/openDatabase");
const { getScanSources } = require("./db/scanSourcesStore");
const { createScanJob, finishScanJob, listScanJobs } = require("./db/scanJobsStore");
const { upsertScanCandidates } = require("./db/scanCandidatesStore");
const { isScanCancelled } = require("./scanSessions");

/**
 * @param {{ webContents: { send: (channel: string, payload: any) => void } }} window
 * @param {Array<{ id: number, path: string, isEnabled: boolean }>} sources
 * @param {Record<string, any>} baseParams
 * @returns {Promise<{ success: boolean, games: any[], errorsCount: number, warningsCount: number, diagnostics: any[], cancelled: boolean }>}
 */
async function runScanAcrossSources(window, sources, baseParams) {
  const { startScan } = require("../core/scanners/f95scanner");
  const aggregatedGames = [];
  const diagnostics = [];
  let completedSources = 0;
  let errorsCount = 0;
  let warningsCount = 0;

  if (isScanCancelled(baseParams?.scanSession)) {
    return {
      success: false,
      games: aggregatedGames,
      errorsCount: 0,
      warningsCount: 0,
      diagnostics,
      cancelled: true,
    };
  }

  for (const source of sources) {
    if (isScanCancelled(baseParams?.scanSession)) {
      break;
    }
    const relayWindow = {
      webContents: {
        send(channel, payload) {
          if (channel === "scan-progress") {
            window.webContents.send("scan-progress", {
              value: completedSources + (payload.total ? payload.value / payload.total : 0),
              total: sources.length,
              potential: aggregatedGames.length + (payload.potential || 0),
              mode: "scan-sources",
              currentSourcePath: source.path,
              currentSourceIndex: completedSources + 1,
              sourceCount: sources.length,
            });
            return;
          }

          if (channel === "scan-complete") {
            const enrichedPayload = {
              ...payload,
              scanSourceId: source.id,
              scanSourcePath: source.path,
            };
            aggregatedGames.push(enrichedPayload);
            window.webContents.send("scan-complete", enrichedPayload);
            return;
          }

          if (channel === "scan-complete-final") {
            return;
          }

          window.webContents.send(channel, payload);
        },
      },
    };

    try {
      const sourceResult = await startScan(
        {
          ...baseParams,
          folder: source.path,
        },
        relayWindow,
      );

      warningsCount += sourceResult.warningsCount || 0;

      if (Array.isArray(sourceResult.diagnostics) && sourceResult.diagnostics.length > 0) {
        diagnostics.push(
          ...sourceResult.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            sourcePath: source.path,
          })),
        );
      }

      if (sourceResult.cancelled) {
        completedSources += 1;
        break;
      }
    } catch (error) {
      errorsCount += 1;
      console.error("[scan.runner] source scan failed", {
        sourcePath: source.path,
        error: error instanceof Error ? error.message : String(error),
      });
      diagnostics.push({
        code: "SCAN_SOURCE_FAILED",
        path: source.path,
        sourcePath: source.path,
        message: `Source scan failed: ${source.path}`,
        errorCode:
          error && typeof error === "object" && "code" in error && error.code
            ? error.code
            : "UNKNOWN",
        timestamp: new Date().toISOString(),
      });
    }

    completedSources += 1;
    window.webContents.send("scan-progress", {
      value: completedSources,
      total: sources.length,
      potential: aggregatedGames.length,
      mode: "scan-sources",
      currentSourcePath: source.path,
      currentSourceIndex: completedSources,
      sourceCount: sources.length,
    });
  }

  window.webContents.send("scan-complete-final", aggregatedGames);

  return {
    success: errorsCount === 0 && !isScanCancelled(baseParams?.scanSession),
    games: aggregatedGames,
    errorsCount,
    warningsCount,
    diagnostics,
    cancelled: isScanCancelled(baseParams?.scanSession),
  };
}

/**
 * @param {{ webContents: { send: (channel: string, payload: any) => void } }} window
 * @param {any} appPaths
 * @param {Record<string, any>} baseParams
 */
async function startEnabledSourcesScan(window, appPaths, baseParams) {
  const db = await openDatabase(appPaths);
  const allSources = await getScanSources(db);
  const enabledSources = allSources.filter((source) => source.isEnabled);

  if (enabledSources.length === 0) {
    return {
      success: false,
      error: "No enabled scan sources configured",
    };
  }

  const job = await createScanJob(db, {
    mode: "scan_sources",
    status: "running",
    sourceCount: enabledSources.length,
    notes: {
      sourceIds: enabledSources.map((source) => source.id),
    },
  });

  const result = await runScanAcrossSources(window, enabledSources, baseParams);
  const storedCandidates =
    result.games.length > 0
      ? await upsertScanCandidates(
          db,
          result.games.map((game) => ({
            sourceId: game.scanSourceId || null,
            lastJobId: job.id,
            folderPath: game.folder,
            title: game.title || "Unknown",
            creator: game.creator || "Unknown",
            engine: game.engine || "Unknown",
            version: game.version || "",
            executableName:
              game.selectedValue || game.singleExecutable || game.executable || "",
            atlasId: game.atlasId || "",
            f95Id: game.f95Id || "",
            isArchive: Boolean(game.isArchive),
            detectionScore: game.detectionScore || 0,
            detectionReasons: game.detectionReasons || [],
            matchCount: Array.isArray(game.results) ? game.results.length : 0,
            status: "detected",
          })),
        )
      : [];

  await finishScanJob(db, job.id, {
    status: result.cancelled ? "cancelled" : result.success ? "success" : "partial",
    gamesFound: result.games.length,
    errorsCount: result.errorsCount,
    notes: {
      sourceIds: enabledSources.map((source) => source.id),
      sourcePaths: enabledSources.map((source) => source.path),
      warningsCount: result.warningsCount,
      cancelled: result.cancelled,
      persistedCandidates: storedCandidates.length,
      diagnosticsSample: result.diagnostics.slice(0, 10),
    },
  });

  if (result.cancelled) {
    return {
      success: false,
      error: "Scan cancelled",
      cancelled: true,
      totalGames: result.games.length,
      persistedCandidates: storedCandidates.length,
      warningsCount: result.warningsCount,
      games: result.games,
    };
  }

  if (!result.success) {
    return {
      success: false,
      error: "One or more scan sources failed",
      errorsCount: result.errorsCount,
      persistedCandidates: storedCandidates.length,
      warningsCount: result.warningsCount,
      diagnostics: result.diagnostics,
      games: result.games,
    };
  }

  return {
    success: true,
    totalGames: result.games.length,
    persistedCandidates: storedCandidates.length,
    warningsCount: result.warningsCount,
    diagnostics: result.diagnostics,
    games: result.games,
  };
}

/**
 * @param {any} appPaths
 * @param {number=} limit
 */
async function getRecentScanJobs(appPaths, limit = 10) {
  const db = await openDatabase(appPaths);
  return listScanJobs(db, limit);
}

module.exports = {
  startEnabledSourcesScan,
  getRecentScanJobs,
};
