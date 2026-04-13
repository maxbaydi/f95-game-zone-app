// @ts-check

/**
 * @param {any} NotificationCtor
 * @returns {boolean}
 */
function isNotificationSupported(NotificationCtor) {
  if (typeof NotificationCtor !== "function") {
    return false;
  }

  if (typeof NotificationCtor.isSupported === "function") {
    return NotificationCtor.isSupported();
  }

  return true;
}

/**
 * @param {{
 *   Notification: any,
 *   title: string,
 *   body: string,
 *   icon?: string | null,
 *   silent?: boolean,
 *   onClick?: (() => void) | null,
 * }} input
 * @returns {boolean}
 */
function showSystemNotification(input) {
  if (!isNotificationSupported(input.Notification)) {
    return false;
  }

  try {
    const notification = new input.Notification({
      title: String(input.title || "").trim(),
      body: String(input.body || "").trim(),
      icon: input.icon || undefined,
      silent: Boolean(input.silent),
    });

    if (typeof input.onClick === "function") {
      notification.on("click", () => {
        input.onClick();
      });
    }

    notification.show();
    return true;
  } catch (error) {
    console.error("[system.notification] Failed to show notification:", error);
    return false;
  }
}

module.exports = {
  isNotificationSupported,
  showSystemNotification,
};
