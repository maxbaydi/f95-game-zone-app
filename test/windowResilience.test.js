const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  attachWindowResilience,
  createReloadBudget,
} = require("../src/main/windowResilience");

function createFakeWindow() {
  const webContents = /** @type {any} */ (new EventEmitter());
  webContents.reloadCount = 0;
  webContents.reload = () => {
    webContents.reloadCount += 1;
  };
  webContents.isDestroyed = () => false;

  const browserWindow = /** @type {any} */ (new EventEmitter());
  browserWindow.webContents = webContents;
  browserWindow.destroyed = false;
  browserWindow.closed = false;
  browserWindow.isDestroyed = () => browserWindow.destroyed;
  browserWindow.close = () => {
    browserWindow.closed = true;
  };
  return browserWindow;
}

function createManualTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeoutFn(callback, delay) {
      const id = nextId++;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimeoutFn(id) {
      pending.delete(id);
    },
    async flush() {
      const entries = [...pending.entries()];
      pending.clear();
      for (const [, entry] of entries) {
        await entry.callback();
      }
    },
    get size() {
      return pending.size;
    },
  };
}

const silentLogger = { info() {}, warn() {}, error() {} };

test("createReloadBudget allows a limited number of reloads per window", () => {
  let now = 0;
  const budget = createReloadBudget({
    maxReloads: 2,
    reloadWindowMs: 1000,
    now: () => now,
  });

  assert.equal(budget.tryConsume(), true);
  assert.equal(budget.tryConsume(), true);
  assert.equal(budget.tryConsume(), false);

  now = 1500;
  assert.equal(budget.tryConsume(), true);
});

test("a crashed renderer is reloaded after a short delay", async () => {
  const win = createFakeWindow();
  const timers = createManualTimers();
  attachWindowResilience(win, {
    name: "main",
    logger: silentLogger,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  win.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
  assert.equal(win.webContents.reloadCount, 0);
  assert.equal(timers.size, 1);

  await timers.flush();
  assert.equal(win.webContents.reloadCount, 1);
});

test("a clean renderer exit is not treated as a crash", async () => {
  const win = createFakeWindow();
  const timers = createManualTimers();
  attachWindowResilience(win, {
    logger: silentLogger,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  win.webContents.emit("render-process-gone", {}, { reason: "clean-exit" });
  assert.equal(timers.size, 0);
});

test("after the reload budget is spent the user is asked what to do", async () => {
  const win = createFakeWindow();
  const timers = createManualTimers();
  const prompts = [];
  attachWindowResilience(win, {
    logger: silentLogger,
    maxReloads: 1,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    dialog: {
      showMessageBox: async (owner, options) => {
        prompts.push(options);
        return { response: 1 };
      },
    },
  });

  win.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  await timers.flush();
  assert.equal(win.webContents.reloadCount, 1);

  win.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts[0].buttons, ["Reload", "Close"]);
  assert.equal(win.closed, true);
});

test("main-frame load failures are retried but aborted navigations are ignored", async () => {
  const win = createFakeWindow();
  const timers = createManualTimers();
  attachWindowResilience(win, {
    logger: silentLogger,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  win.webContents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "file:///index.html", true);
  win.webContents.emit("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "file:///x.png", false);
  assert.equal(timers.size, 0);

  win.webContents.emit("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "file:///index.html", true);
  await timers.flush();
  assert.equal(win.webContents.reloadCount, 1);
});

test("an unresponsive window offers a reload unless it recovers first", async () => {
  const win = createFakeWindow();
  const timers = createManualTimers();
  const prompts = [];
  attachWindowResilience(win, {
    logger: silentLogger,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    dialog: {
      showMessageBox: async (owner, options) => {
        prompts.push(options);
        return { response: 1 };
      },
    },
  });

  win.emit("unresponsive");
  win.emit("responsive");
  await timers.flush();
  assert.equal(prompts.length, 0);

  win.emit("unresponsive");
  await timers.flush();
  assert.equal(prompts.length, 1);
  assert.equal(win.webContents.reloadCount, 1);
});

test("detaching on close cancels pending reloads", async () => {
  const win = createFakeWindow();
  const timers = createManualTimers();
  attachWindowResilience(win, {
    logger: silentLogger,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  win.webContents.emit("render-process-gone", {}, { reason: "oom" });
  win.emit("closed");
  assert.equal(timers.size, 0);
  assert.equal(win.webContents.listenerCount("render-process-gone"), 0);
});
