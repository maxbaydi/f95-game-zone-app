// @ts-check

const { showSystemNotification } = require("./systemNotification");

/**
 * Native notifications for finished and failed installs. They matter when
 * the window is hidden in the tray or behind a game: the in-app toasts are
 * not visible then. A focused window gets no system notification, the toast
 * is enough.
 *
 * @param {{
 *   Notification: any,
 *   iconPath?: string | null,
 *   isEnabled: () => boolean,
 *   isWindowFocused: () => boolean,
 *   onClick?: ((detail: { kind: "completed" | "failed", recordId: number | null }) => void) | null,
 * }} input
 */
function createInstallNotificationController(input) {
  /**
   * @param {"completed" | "failed"} kind
   * @param {{ title?: string, body: string, recordId?: number | null }} detail
   * @returns {boolean}
   */
  function notify(kind, detail) {
    let enabled = true;
    try {
      enabled = input.isEnabled() !== false;
    } catch {
      enabled = true;
    }
    if (!enabled) {
      return false;
    }

    let focused = false;
    try {
      focused = Boolean(input.isWindowFocused());
    } catch {
      focused = false;
    }
    if (focused) {
      return false;
    }

    const recordId =
      Number.isInteger(detail.recordId) && Number(detail.recordId) > 0
        ? Number(detail.recordId)
        : null;
    return showSystemNotification({
      Notification: input.Notification,
      title:
        detail.title ||
        (kind === "completed"
          ? "F95Launcher — Game installed"
          : "F95Launcher — Install failed"),
      body: detail.body,
      icon: input.iconPath || null,
      onClick: input.onClick
        ? () => input.onClick?.({ kind, recordId })
        : null,
    });
  }

  return {
    /**
     * @param {{ title: string, warning?: string, recordId?: number | null }} detail
     */
    notifyCompleted(detail) {
      const title = String(detail.title || "The game").trim();
      return notify("completed", {
        body: detail.warning
          ? `${title} is installed. ${detail.warning}`
          : `${title} is installed and ready to play.`,
        recordId: detail.recordId ?? null,
      });
    },
    /**
     * @param {{ title: string, error?: string }} detail
     */
    notifyFailed(detail) {
      const title = String(detail.title || "The download").trim();
      const error = String(detail.error || "").trim();
      return notify("failed", {
        body: error
          ? `${title}: ${error} Open F95Launcher to retry.`
          : `${title} did not install. Open F95Launcher to retry.`,
      });
    },
  };
}

module.exports = {
  createInstallNotificationController,
};
