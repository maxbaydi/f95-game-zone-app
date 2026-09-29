const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createInstallNotificationController,
} = require("../src/main/installNotificationController");

function makeNotification() {
  const shown = [];
  class FakeNotification {
    constructor(options) {
      this.options = options;
      this.handlers = {};
    }
    static isSupported() {
      return true;
    }
    on(event, handler) {
      this.handlers[event] = handler;
    }
    show() {
      shown.push(this);
    }
  }
  return { FakeNotification, shown };
}

test("install notifications are shown only while the window is not focused", () => {
  const { FakeNotification, shown } = makeNotification();
  let focused = true;
  const controller = createInstallNotificationController({
    Notification: FakeNotification,
    isEnabled: () => true,
    isWindowFocused: () => focused,
  });

  assert.equal(controller.notifyCompleted({ title: "Harbor Lights" }), false);
  focused = false;
  assert.equal(controller.notifyCompleted({ title: "Harbor Lights", recordId: 4 }), true);
  assert.equal(shown[0].options.title, "F95Launcher — Game installed");
  assert.match(shown[0].options.body, /Harbor Lights is installed and ready to play/);
});

test("install notifications respect the setting and carry the error text", () => {
  const { FakeNotification, shown } = makeNotification();
  let enabled = false;
  const clicks = [];
  const controller = createInstallNotificationController({
    Notification: FakeNotification,
    isEnabled: () => enabled,
    isWindowFocused: () => false,
    onClick: (detail) => clicks.push(detail),
  });

  assert.equal(controller.notifyFailed({ title: "Ashen Kingdom", error: "The archive needs a password." }), false);
  enabled = true;
  assert.equal(controller.notifyFailed({ title: "Ashen Kingdom", error: "The archive needs a password." }), true);
  assert.equal(shown[0].options.title, "F95Launcher — Install failed");
  assert.match(shown[0].options.body, /Ashen Kingdom: The archive needs a password\. Open F95Launcher to retry\./);
  shown[0].handlers.click();
  assert.deepEqual(clicks, [{ kind: "failed", recordId: null }]);
});
