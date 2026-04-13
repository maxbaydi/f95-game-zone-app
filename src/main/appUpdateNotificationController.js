// @ts-check

const { APP_UPDATE_STATUS } = require("../shared/appUpdate");
const { showSystemNotification } = require("./systemNotification");

/**
 * @param {any} state
 * @returns {string}
 */
function getAppUpdateNotificationKey(state) {
  const status = String(state?.status || "").trim();
  const version = String(state?.availableVersion || "").trim();

  if (!status) {
    return "";
  }

  return `${status}:${version}`;
}

/**
 * @param {any} state
 * @returns {{ title: string, body: string } | null}
 */
function buildAppUpdateNotificationPayload(state) {
  const status = String(state?.status || "").trim();
  const version = String(state?.availableVersion || "").trim();
  const versionLabel = version ? `Version ${version}` : "A new app update";

  if (status === APP_UPDATE_STATUS.AVAILABLE) {
    return {
      title: "F95Launcher — App update available",
      body: state?.supportsDownload
        ? `${versionLabel} is available. Open F95Launcher to download it.`
        : `${versionLabel} is available. Open F95Launcher to review the release.`,
    };
  }

  if (status === APP_UPDATE_STATUS.DOWNLOADED) {
    return {
      title: "F95Launcher — App update ready",
      body: `${versionLabel} is ready to install. Open F95Launcher to restart and apply it.`,
    };
  }

  return null;
}

/**
 * @param {{
 *   Notification: any,
 *   iconPath?: string | null,
 *   onActivate?: (() => void) | null,
 * }} input
 */
function createAppUpdateNotificationController(input) {
  let lastNotificationKey = "";

  /**
   * @param {any} nextState
   * @param {any} previousState
   * @returns {boolean}
   */
  function handleStateChange(nextState, previousState) {
    const nextPayload = buildAppUpdateNotificationPayload(nextState);
    const nextKey = getAppUpdateNotificationKey(nextState);

    if (!nextPayload || !nextKey) {
      return false;
    }

    const previousKey = getAppUpdateNotificationKey(previousState);
    if (nextKey === previousKey || nextKey === lastNotificationKey) {
      return false;
    }

    const shown = showSystemNotification({
      Notification: input.Notification,
      title: nextPayload.title,
      body: nextPayload.body,
      icon: input.iconPath || null,
      onClick: input.onActivate || null,
    });

    if (shown) {
      lastNotificationKey = nextKey;
    }

    return shown;
  }

  function reset() {
    lastNotificationKey = "";
  }

  return {
    handleStateChange,
    reset,
  };
}

module.exports = {
  buildAppUpdateNotificationPayload,
  createAppUpdateNotificationController,
  getAppUpdateNotificationKey,
};
