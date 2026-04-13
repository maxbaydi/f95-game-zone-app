const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  createTrayController,
  isMinimizeToTrayEnabled,
} = require("../src/main/trayController");
const { FakeNotification } = require("./helpers/fakeNotification");

class FakeTray extends EventEmitter {
  static instances = [];

  constructor(icon) {
    super();
    this.icon = icon;
    this.destroyed = false;
    FakeTray.instances.push(this);
  }

  setToolTip(value) {
    this.tooltip = value;
  }

  setContextMenu(menu) {
    this.menu = menu;
  }

  destroy() {
    this.destroyed = true;
  }
}

class FakeWindow extends EventEmitter {
  constructor() {
    super();
    this.visible = true;
    this.destroyed = false;
    this.minimized = false;
    this.hideCalls = 0;
    this.showCalls = 0;
    this.focusCalls = 0;
    this.restoreCalls = 0;
  }

  hide() {
    this.visible = false;
    this.hideCalls += 1;
    this.emit("hide");
  }

  show() {
    this.visible = true;
    this.showCalls += 1;
    this.emit("show");
  }

  focus() {
    this.focusCalls += 1;
  }

  isVisible() {
    return this.visible;
  }

  isDestroyed() {
    return this.destroyed;
  }

  isMinimized() {
    return this.minimized;
  }

  restore() {
    this.minimized = false;
    this.restoreCalls += 1;
  }

  closeCompletely() {
    this.destroyed = true;
    this.emit("closed");
  }
}

function createFakeMenu() {
  return {
    buildFromTemplate(template) {
      return template;
    },
  };
}

function createFakeEvent() {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

test("tray controller reports minimize-to-tray config safely", () => {
  assert.equal(isMinimizeToTrayEnabled(null), false);
  assert.equal(isMinimizeToTrayEnabled({ Interface: {} }), false);
  assert.equal(
    isMinimizeToTrayEnabled({ Interface: { minimizeToTray: true } }),
    true,
  );
});

test("tray controller hides the main window, shows one tray notice, and exposes tray actions", () => {
  FakeNotification.instances.length = 0;
  FakeTray.instances.length = 0;

  const config = {
    Interface: {
      minimizeToTray: true,
    },
  };
  let appQuitCalls = 0;
  let appUpdateChecks = 0;
  let libraryUpdateChecks = 0;

  const controller = createTrayController({
    app: {
      quit() {
        appQuitCalls += 1;
      },
    },
    Menu: createFakeMenu(),
    Tray: FakeTray,
    Notification: FakeNotification,
    createTrayImage: () => "tray-icon",
    getConfig: () => config,
    onCheckForAppUpdates: () => {
      appUpdateChecks += 1;
    },
    onCheckForLibraryUpdates: () => {
      libraryUpdateChecks += 1;
    },
    tooltip: "F95Launcher",
  });

  const windowInstance = new FakeWindow();
  controller.attachMainWindow(windowInstance);

  assert.equal(FakeTray.instances.length, 1);
  assert.equal(FakeTray.instances[0].tooltip, "F95Launcher");

  const minimizeEvent = createFakeEvent();
  windowInstance.emit("minimize", minimizeEvent);

  assert.equal(minimizeEvent.prevented, true);
  assert.equal(windowInstance.isVisible(), false);
  assert.equal(windowInstance.hideCalls, 1);
  assert.equal(FakeNotification.instances.length, 1);

  const trayMenu = FakeTray.instances[0].menu;
  trayMenu.find((item) => item.label === "Check for App Updates").click();
  trayMenu.find((item) => item.label === "Refresh Library Updates").click();
  assert.equal(appUpdateChecks, 1);
  assert.equal(libraryUpdateChecks, 1);

  FakeNotification.instances[0].trigger("click");
  assert.equal(windowInstance.isVisible(), true);
  assert.equal(windowInstance.showCalls, 1);
  assert.equal(windowInstance.focusCalls, 1);

  trayMenu.find((item) => item.label === "Quit").click();
  assert.equal(appQuitCalls, 1);
});

test("tray controller tears down the tray when the setting is disabled", () => {
  FakeNotification.instances.length = 0;
  FakeTray.instances.length = 0;

  const config = {
    Interface: {
      minimizeToTray: true,
    },
  };

  const controller = createTrayController({
    app: { quit() {} },
    Menu: createFakeMenu(),
    Tray: FakeTray,
    Notification: FakeNotification,
    createTrayImage: () => "tray-icon",
    getConfig: () => config,
  });

  controller.attachMainWindow(new FakeWindow());
  const tray = FakeTray.instances[0];

  config.Interface.minimizeToTray = false;
  controller.refresh();

  assert.equal(tray.destroyed, true);
});
