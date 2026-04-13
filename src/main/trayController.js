// @ts-check

const { showSystemNotification } = require("./systemNotification");

/**
 * @param {any} config
 * @returns {boolean}
 */
function isMinimizeToTrayEnabled(config) {
  return Boolean(config?.Interface?.minimizeToTray);
}

/**
 * @param {{
 *   app: { quit: () => void },
 *   Menu: { buildFromTemplate: (template: any[]) => any },
 *   Tray: new (icon: any) => any,
 *   Notification: any,
 *   createTrayImage: () => any,
 *   getConfig: () => any,
 *   onCheckForAppUpdates?: (() => Promise<any> | any) | null,
 *   onCheckForLibraryUpdates?: (() => Promise<any> | any) | null,
 *   tooltip?: string,
 * }} input
 */
function createTrayController(input) {
  /** @type {any | null} */
  let tray = null;
  /** @type {any | null} */
  let mainWindow = null;
  /** @type {{ close: (event: any) => void, minimize: (event: any) => void, show: () => void, hide: () => void, closed: () => void } | null} */
  let boundHandlers = null;
  let preparingToQuit = false;
  let trayNoticeShown = false;

  function getWindow() {
    if (!mainWindow || typeof mainWindow.isDestroyed !== "function") {
      return null;
    }

    return mainWindow.isDestroyed() ? null : mainWindow;
  }

  function buildContextMenuTemplate() {
    const windowInstance = getWindow();
    const isVisible = Boolean(windowInstance?.isVisible?.());
    /** @type {any[]} */
    const template = [
      {
        label: isVisible ? "Hide to Tray" : "Open F95Launcher",
        click: () => {
          if (isVisible) {
            hideMainWindow("tray-menu");
            return;
          }

          showMainWindow();
        },
      },
    ];

    if (typeof input.onCheckForAppUpdates === "function") {
      template.push({
        label: "Check for App Updates",
        click: () => {
          void input.onCheckForAppUpdates();
        },
      });
    }

    if (typeof input.onCheckForLibraryUpdates === "function") {
      template.push({
        label: "Refresh Library Updates",
        click: () => {
          void input.onCheckForLibraryUpdates();
        },
      });
    }

    template.push(
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          prepareForQuit();
          input.app.quit();
        },
      },
    );

    return template;
  }

  function syncTrayMenu() {
    if (!tray) {
      return;
    }

    tray.setToolTip(input.tooltip || "F95Launcher");
    tray.setContextMenu(
      input.Menu.buildFromTemplate(buildContextMenuTemplate()),
    );
  }

  function ensureTray() {
    if (tray) {
      syncTrayMenu();
      return tray;
    }

    if (!isMinimizeToTrayEnabled(input.getConfig())) {
      return null;
    }

    tray = new input.Tray(input.createTrayImage());
    tray.on("click", () => {
      showMainWindow();
    });
    tray.on("double-click", () => {
      showMainWindow();
    });
    syncTrayMenu();
    return tray;
  }

  function destroyTray() {
    if (!tray) {
      return;
    }

    tray.destroy();
    tray = null;
  }

  function notifyHiddenToTrayOnce() {
    if (trayNoticeShown) {
      return false;
    }

    const shown = showSystemNotification({
      Notification: input.Notification,
      title: "F95Launcher — App minimized to tray",
      body: "F95Launcher is still running in the tray. Open it from the tray icon when you need it.",
      silent: true,
      onClick: () => {
        showMainWindow();
      },
    });

    if (shown) {
      trayNoticeShown = true;
    }

    return shown;
  }

  /**
   * @param {"minimize" | "close" | "tray-menu"} reason
   * @returns {boolean}
   */
  function hideMainWindow(reason) {
    const windowInstance = getWindow();
    if (!windowInstance) {
      return false;
    }

    if (
      reason !== "tray-menu" &&
      (!isMinimizeToTrayEnabled(input.getConfig()) || preparingToQuit)
    ) {
      return false;
    }

    ensureTray();
    windowInstance.hide();
    syncTrayMenu();

    if (reason === "minimize" || reason === "close") {
      notifyHiddenToTrayOnce();
    }

    return true;
  }

  function showMainWindow() {
    const windowInstance = getWindow();
    if (!windowInstance) {
      return false;
    }

    if (windowInstance.isMinimized?.()) {
      windowInstance.restore();
    }

    if (!windowInstance.isVisible?.()) {
      windowInstance.show();
    }

    windowInstance.focus?.();
    syncTrayMenu();
    return true;
  }

  function refresh() {
    if (isMinimizeToTrayEnabled(input.getConfig())) {
      ensureTray();
      return true;
    }

    destroyTray();
    return false;
  }

  function detachMainWindow() {
    if (mainWindow && boundHandlers) {
      mainWindow.off("close", boundHandlers.close);
      mainWindow.off("minimize", boundHandlers.minimize);
      mainWindow.off("show", boundHandlers.show);
      mainWindow.off("hide", boundHandlers.hide);
      mainWindow.off("closed", boundHandlers.closed);
    }

    mainWindow = null;
    boundHandlers = null;
  }

  /**
   * @param {any} windowInstance
   */
  function attachMainWindow(windowInstance) {
    detachMainWindow();
    mainWindow = windowInstance;

    if (!windowInstance) {
      return;
    }

    boundHandlers = {
      close: (event) => {
        if (!isMinimizeToTrayEnabled(input.getConfig()) || preparingToQuit) {
          return;
        }

        event.preventDefault();
        hideMainWindow("close");
      },
      minimize: (event) => {
        if (!isMinimizeToTrayEnabled(input.getConfig()) || preparingToQuit) {
          return;
        }

        event.preventDefault();
        hideMainWindow("minimize");
      },
      show: () => {
        syncTrayMenu();
      },
      hide: () => {
        syncTrayMenu();
      },
      closed: () => {
        mainWindow = null;
      },
    };

    windowInstance.on("close", boundHandlers.close);
    windowInstance.on("minimize", boundHandlers.minimize);
    windowInstance.on("show", boundHandlers.show);
    windowInstance.on("hide", boundHandlers.hide);
    windowInstance.on("closed", boundHandlers.closed);
    refresh();
  }

  function prepareForQuit() {
    preparingToQuit = true;
  }

  function destroy() {
    detachMainWindow();
    destroyTray();
  }

  return {
    attachMainWindow,
    destroy,
    hideMainWindow,
    prepareForQuit,
    refresh,
    showMainWindow,
  };
}

module.exports = {
  createTrayController,
  isMinimizeToTrayEnabled,
};
