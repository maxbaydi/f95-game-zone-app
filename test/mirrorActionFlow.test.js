const test = require("node:test");
const assert = require("node:assert/strict");

const { createMirrorActionFlow } = require("../src/main/f95/mirrorActionFlow");
const {
  DownloadCancelledError,
  MirrorActionRequiredError,
  MirrorError,
} = require("../src/main/f95/hosts/common");

/** Deterministic timers: advance() fires due callbacks in order. */
function createFakeTimers() {
  let now = 0;
  let sequence = 0;
  const pending = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const id = ++sequence;
      pending.set(id, { at: now + Math.max(0, Number(delay) || 0), callback });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, entry]) => entry.at <= target)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!due) {
          break;
        }
        pending.delete(due[0]);
        now = due[1].at;
        due[1].callback();
        // Let every promise chain started by the callback settle.
        await new Promise((resolve) => setImmediate(resolve));
      }
      now = target;
      await new Promise((resolve) => setImmediate(resolve));
    },
    pendingCount: () => pending.size,
  };
}

function createFakeWindow() {
  const listeners = { navigated: [], closed: [] };
  const window = {
    openedAt: [],
    closed: false,
    webContentsId: 42,
    onNavigated(callback) {
      listeners.navigated.push(callback);
      return () => listeners.navigated.splice(listeners.navigated.indexOf(callback), 1);
    },
    onClosed(callback) {
      listeners.closed.push(callback);
      return () => listeners.closed.splice(listeners.closed.indexOf(callback), 1);
    },
    close() {
      window.closed = true;
      for (const callback of [...listeners.closed]) {
        callback();
      }
    },
    isOpen: () => !window.closed,
    emitNavigated(url) {
      for (const callback of [...listeners.navigated]) {
        callback({ url });
      }
    },
    emitClosedByUser() {
      window.closed = true;
      for (const callback of [...listeners.closed]) {
        callback();
      }
    },
    listenerCount: () => listeners.navigated.length + listeners.closed.length,
  };
  return window;
}

function actionError(url = "https://mirror.test/file") {
  return new MirrorActionRequiredError("Mirror needs a captcha.", {
    code: "captcha_required",
    actionUrl: url,
  });
}

function setup(overrides = {}) {
  const timers = createFakeTimers();
  const window = createFakeWindow();
  const events = [];
  const resolveResults = overrides.resolveResults || [];
  let inFlight = 0;
  let maxInFlight = 0;
  const flow = createMirrorActionFlow({
    actionUrl: "https://mirror.test/file",
    openWindow: (url) => {
      window.openedAt.push(url);
      return window;
    },
    resolveMirror: async (signal) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      events.push("resolve");
      const next = resolveResults.shift() || (() => Promise.reject(actionError()));
      try {
        return await next(signal);
      } finally {
        inFlight -= 1;
      }
    },
    onResolved: (prepared) => events.push(`resolved:${prepared.resolvedUrl}`),
    onGaveUp: (/** @type {any} */ error) => events.push(`gaveUp:${error.code}`),
    onStatus: (text) => events.push(`status:${text}`),
    timers,
    pollIntervalMs: 5000,
    navigationDebounceMs: 1000,
    timeoutMs: 60000,
    ...overrides.options,
  });
  return { flow, timers, window, events, maxInFlight: () => maxInFlight };
}

test("start opens the mirror page in the browser and announces the wait", () => {
  const { flow, window, events } = setup();
  flow.start();
  assert.deepEqual(window.openedAt, ["https://mirror.test/file"]);
  assert.ok(events.some((event) => event.startsWith("status:")));
  assert.equal(flow.isActive(), true);
  assert.equal(flow.matchesWebContents(42), true);
  assert.equal(flow.matchesWebContents(7), false);
  flow.stop();
});

test("a navigation re-resolves after the debounce and a success starts the transfer", async () => {
  const prepared = { resolvedUrl: "https://cdn.test/game.zip" };
  const { flow, timers, window, events } = setup({
    resolveResults: [async () => prepared],
  });
  flow.start();
  window.emitNavigated("https://mirror.test/file?solved=1");
  assert.ok(!events.includes("resolve"), "debounced");
  await timers.advance(1000);
  assert.ok(events.includes("resolve"));
  assert.ok(events.includes("resolved:https://cdn.test/game.zip"));
  assert.equal(window.closed, true, "the browser window is closed once the mirror resolves");
  assert.equal(flow.isActive(), false);
  assert.equal(timers.pendingCount(), 0, "no timers survive the flow");
  assert.equal(window.listenerCount(), 0);
});

test("while the mirror still asks for the browser step the flow keeps polling", async () => {
  const { flow, timers, events } = setup();
  flow.start();
  await timers.advance(5000);
  await timers.advance(5000);
  assert.equal(events.filter((event) => event === "resolve").length, 2);
  assert.ok(!events.some((event) => event.startsWith("gaveUp")));
  assert.equal(flow.isActive(), true);
  flow.stop();
});

test("closing the window before the step is done gives up with the action URL kept", async () => {
  const { flow, window, events } = setup();
  flow.start();
  window.emitClosedByUser();
  const gaveUp = events.find((event) => event.startsWith("gaveUp"));
  assert.equal(gaveUp, "gaveUp:captcha_required");
  assert.equal(flow.isActive(), false);
});

test("a hard resolver error ends the flow and closes the window", async () => {
  const { flow, timers, window, events } = setup({
    resolveResults: [
      async () =>
        Promise.reject(new MirrorError("gone", { code: "not_found", retryable: false })),
    ],
  });
  flow.start();
  await timers.advance(5000);
  assert.ok(events.includes("gaveUp:not_found"));
  assert.equal(window.closed, true);
  assert.equal(flow.isActive(), false);
});

test("transient resolver errors do not end the flow", async () => {
  const { flow, timers, events } = setup({
    resolveResults: [
      async () => Promise.reject(new MirrorError("hiccup", { code: "timeout", retryable: true })),
    ],
  });
  flow.start();
  await timers.advance(5000);
  assert.ok(!events.some((event) => event.startsWith("gaveUp")));
  assert.equal(flow.isActive(), true);
  flow.stop();
});

test("the flow times out eventually", async () => {
  const { flow, timers, events, window } = setup({ options: { timeoutMs: 12000 } });
  flow.start();
  await timers.advance(12000);
  assert.ok(events.includes("gaveUp:action_timeout"));
  assert.equal(window.closed, true);
  assert.equal(flow.isActive(), false);
});

test("attempts never overlap: a navigation during a resolve queues one more attempt", async () => {
  /** @type {(() => void) | null} */
  let release = null;
  const { flow, timers, window, events, maxInFlight } = setup({
    resolveResults: [
      () =>
        new Promise((resolve, reject) => {
          release = () => reject(actionError());
        }),
    ],
  });
  flow.start();
  await timers.advance(5000);
  assert.equal(events.filter((event) => event === "resolve").length, 1);
  window.emitNavigated("https://mirror.test/step2");
  await timers.advance(1000);
  assert.equal(events.filter((event) => event === "resolve").length, 1, "still in flight");
  release?.();
  await timers.advance(0);
  await timers.advance(0);
  assert.equal(events.filter((event) => event === "resolve").length, 2, "queued attempt ran");
  assert.equal(maxInFlight(), 1);
  flow.stop();
});

test("stop aborts an in-flight resolve, closes the window and silences callbacks", async () => {
  /** @type {AbortSignal | null} */
  let abortedSignal = null;
  const { flow, timers, window, events } = setup({
    resolveResults: [
      (signal) =>
        new Promise((resolve, reject) => {
          abortedSignal = signal;
          signal.addEventListener("abort", () => reject(new DownloadCancelledError()));
        }),
    ],
  });
  flow.start();
  await timers.advance(5000);
  flow.stop();
  await timers.advance(0);
  assert.equal(abortedSignal?.aborted, true);
  assert.equal(window.closed, true);
  assert.ok(!events.some((event) => event.startsWith("gaveUp") || event.startsWith("resolved")));
  assert.equal(timers.pendingCount(), 0);
});

test("adopting a download started inside the window ends the flow but keeps the window", async () => {
  const { flow, timers, window, events } = setup();
  flow.start();
  flow.adoptDownload();
  assert.equal(flow.isActive(), false);
  assert.equal(window.closed, false);
  await timers.advance(60000);
  assert.ok(!events.some((event) => event.startsWith("gaveUp")));
  assert.equal(events.filter((event) => event === "resolve").length, 0);
});

test("a resolver that returns another action-required error updates the page to open", async () => {
  const { flow, timers, window } = setup({
    resolveResults: [async () => Promise.reject(actionError("https://mirror.test/step-2"))],
  });
  flow.start();
  await timers.advance(5000);
  assert.deepEqual(window.openedAt, [
    "https://mirror.test/file",
    "https://mirror.test/step-2",
  ]);
  flow.stop();
});
