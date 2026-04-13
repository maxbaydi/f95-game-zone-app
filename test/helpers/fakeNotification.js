class FakeNotification {
  static instances = [];

  static isSupported() {
    return true;
  }

  constructor(options) {
    this.options = options;
    this.handlers = new Map();
    FakeNotification.instances.push(this);
  }

  on(eventName, handler) {
    this.handlers.set(eventName, handler);
  }

  show() {
    this.shown = true;
  }

  trigger(eventName) {
    const handler = this.handlers.get(eventName);
    if (handler) {
      handler();
    }
  }
}

module.exports = {
  FakeNotification,
};
