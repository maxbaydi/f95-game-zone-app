// @ts-check

const {
  APP_UPDATE_STATUS,
  createInitialAppUpdateState,
} = require("../shared/appUpdate");

/**
 * @param {string | null | undefined} version
 */
function normalizeVersion(version) {
  return String(version || "")
    .trim()
    .replace(/^v/i, "");
}

/**
 * @param {string | null | undefined} version
 */
function toVersionParts(version) {
  const normalized = normalizeVersion(version);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10) || 0);
}

/**
 * @param {string | null | undefined} left
 * @param {string | null | undefined} right
 */
function compareVersions(left, right) {
  const leftParts = toVersionParts(left);
  const rightParts = toVersionParts(right);
  const totalParts = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < totalParts; index += 1) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;

    if (leftPart > rightPart) {
      return 1;
    }

    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

/**
 * @param {string | Array<{ note?: string }> | null | undefined} releaseNotes
 */
function normalizeReleaseNotes(releaseNotes) {
  if (!releaseNotes) {
    return null;
  }

  if (typeof releaseNotes === "string") {
    return releaseNotes.trim() || null;
  }

  if (Array.isArray(releaseNotes)) {
    const combined = releaseNotes
      .map((entry) =>
        entry && typeof entry.note === "string" ? entry.note : "",
      )
      .filter(Boolean)
      .join("\n\n")
      .trim();

    return combined || null;
  }

  return null;
}

/**
 * @param {string} owner
 * @param {string} repo
 */
function buildLatestReleaseUrl(owner, repo) {
  return `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
}

/**
 * @param {{
 *   app: { getVersion: () => string, isPackaged: boolean },
 *   autoUpdaterInstance?: any,
 *   httpGet?: (url: string) => Promise<any>,
 *   owner?: string,
 *   repo?: string,
 *   onStateChanged?: ((nextState: any, previousState: any) => void) | null,
 * }} input
 */
function createAppUpdaterController(input) {
  const owner = input.owner || "maxbaydi";
  const repo = input.repo || "f95-game-zone-app";
  const autoUpdaterInstance =
    input.autoUpdaterInstance || require("electron-updater").autoUpdater;
  const httpGet =
    input.httpGet ||
    (async (url) => {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while requesting ${url}`);
      }

      return response.json();
    });

  /** @type {{ webContents?: { send: (channel: string, payload: any) => void } } | null} */
  let mainWindow = null;
  let listenersBound = false;
  let state = createInitialAppUpdateState({
    currentVersion: input.app.getVersion(),
    isPackaged: input.app.isPackaged,
  });

  /**
   * @param {Partial<typeof state>} patch
   */
  function updateState(patch) {
    const previousState = state;
    state = {
      ...state,
      ...patch,
    };

    if (typeof input.onStateChanged === "function") {
      try {
        input.onStateChanged(state, previousState);
      } catch (error) {
        console.error("[app.updater] state change callback failed", error);
      }
    }

    if (mainWindow?.webContents?.send) {
      mainWindow.webContents.send("update-status", state);
    }

    return state;
  }

  function bindListeners() {
    if (listenersBound) {
      return;
    }

    listenersBound = true;
    autoUpdaterInstance.autoDownload = false;
    autoUpdaterInstance.autoInstallOnAppQuit = false;

    autoUpdaterInstance.on("error", (error) => {
      console.error("[app.updater] updater error", error);
      updateState({
        status: APP_UPDATE_STATUS.ERROR,
        error: error instanceof Error ? error.message : String(error),
        percent: 0,
        supportsInstall: false,
      });
    });

    autoUpdaterInstance.on("checking-for-update", () => {
      updateState({
        status: APP_UPDATE_STATUS.CHECKING,
        error: null,
        percent: 0,
        checkedAt: new Date().toISOString(),
      });
    });

    autoUpdaterInstance.on("update-available", (info) => {
      updateState({
        status: APP_UPDATE_STATUS.AVAILABLE,
        availableVersion: normalizeVersion(info?.version || info?.releaseName),
        error: null,
        percent: 0,
        checkedAt: new Date().toISOString(),
        releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
        releaseUrl: state.releaseUrl,
        supportsDownload: true,
        supportsInstall: false,
      });
    });

    autoUpdaterInstance.on("update-not-available", () => {
      updateState({
        status: APP_UPDATE_STATUS.NOT_AVAILABLE,
        availableVersion: null,
        error: null,
        percent: 0,
        checkedAt: new Date().toISOString(),
        releaseNotes: null,
        releaseUrl: null,
        supportsDownload: input.app.isPackaged,
        supportsInstall: false,
      });
    });

    autoUpdaterInstance.on("download-progress", (progress) => {
      updateState({
        status: APP_UPDATE_STATUS.DOWNLOADING,
        percent: Number(progress?.percent || 0),
        error: null,
        supportsDownload: true,
        supportsInstall: false,
      });
    });

    autoUpdaterInstance.on("update-downloaded", (info) => {
      updateState({
        status: APP_UPDATE_STATUS.DOWNLOADED,
        availableVersion: normalizeVersion(info?.version || info?.releaseName),
        percent: 100,
        error: null,
        releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
        releaseUrl: state.releaseUrl,
        supportsDownload: true,
        supportsInstall: true,
      });
    });
  }

  /**
   * @param {{ webContents?: { send: (channel: string, payload: any) => void } } | null} window
   */
  function attachWindow(window) {
    mainWindow = window;

    if (mainWindow?.webContents?.send) {
      mainWindow.webContents.send("update-status", state);
    }
  }

  async function checkForUpdates() {
    bindListeners();

    if (!input.app.isPackaged) {
      updateState({
        status: APP_UPDATE_STATUS.CHECKING,
        error: null,
        percent: 0,
        checkedAt: new Date().toISOString(),
      });

      try {
        const release = await httpGet(buildLatestReleaseUrl(owner, repo));
        const latestVersion = normalizeVersion(release?.tag_name);
        const currentVersion = normalizeVersion(input.app.getVersion());
        const isNewer = compareVersions(latestVersion, currentVersion) > 0;

        return updateState({
          status: isNewer
            ? APP_UPDATE_STATUS.AVAILABLE
            : APP_UPDATE_STATUS.NOT_AVAILABLE,
          availableVersion: isNewer ? latestVersion : null,
          releaseUrl: release?.html_url || null,
          releaseNotes: normalizeReleaseNotes(release?.body),
          supportsDownload: false,
          supportsInstall: false,
          error: null,
          percent: 0,
          checkedAt: new Date().toISOString(),
        });
      } catch (error) {
        return updateState({
          status: APP_UPDATE_STATUS.ERROR,
          error: error instanceof Error ? error.message : String(error),
          percent: 0,
          supportsDownload: false,
          supportsInstall: false,
        });
      }
    }

    await autoUpdaterInstance.checkForUpdates();
    return state;
  }

  async function downloadUpdate() {
    bindListeners();

    if (!input.app.isPackaged) {
      return updateState({
        status: APP_UPDATE_STATUS.ERROR,
        error:
          "Automatic app update download is only available in packaged builds",
        supportsDownload: false,
        supportsInstall: false,
      });
    }

    if (state.status !== APP_UPDATE_STATUS.AVAILABLE) {
      return updateState({
        status: APP_UPDATE_STATUS.ERROR,
        error: "No app update is ready to download",
      });
    }

    await autoUpdaterInstance.downloadUpdate();
    return state;
  }

  function installUpdate() {
    bindListeners();

    if (!input.app.isPackaged) {
      return updateState({
        status: APP_UPDATE_STATUS.ERROR,
        error: "Automatic install is only available in packaged builds",
        supportsInstall: false,
      });
    }

    if (state.status !== APP_UPDATE_STATUS.DOWNLOADED) {
      return updateState({
        status: APP_UPDATE_STATUS.ERROR,
        error: "No downloaded app update is ready to install",
        supportsInstall: false,
      });
    }

    autoUpdaterInstance.quitAndInstall(false, true);
    return state;
  }

  function getState() {
    return state;
  }

  return {
    attachWindow,
    checkForUpdates,
    downloadUpdate,
    getState,
    installUpdate,
  };
}

module.exports = {
  buildLatestReleaseUrl,
  compareVersions,
  createAppUpdaterController,
  normalizeReleaseNotes,
  normalizeVersion,
};
