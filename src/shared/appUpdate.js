// @ts-check

const APP_UPDATE_STATUS = {
  IDLE: "idle",
  CHECKING: "checking",
  AVAILABLE: "available",
  NOT_AVAILABLE: "not-available",
  DOWNLOADING: "downloading",
  DOWNLOADED: "downloaded",
  ERROR: "error",
};

/**
 * @param {{ currentVersion: string, isPackaged: boolean }} input
 */
function createInitialAppUpdateState(input) {
  return {
    status: APP_UPDATE_STATUS.IDLE,
    currentVersion: input.currentVersion,
    availableVersion: null,
    percent: 0,
    error: null,
    checkedAt: null,
    releaseNotes: null,
    releaseUrl: null,
    supportsDownload: Boolean(input.isPackaged),
    supportsInstall: false,
  };
}

module.exports = {
  APP_UPDATE_STATUS,
  createInitialAppUpdateState,
};
