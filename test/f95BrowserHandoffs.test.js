const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createBrowserHandoffRegistry,
  getHostBrand,
  getThreadKey,
} = require("../src/main/f95/browserHandoffs");

function createFakeTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    setTimer(callback) {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    fireAll() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
    size() {
      return timers.size;
    },
  };
}

test("getThreadKey matches the same thread across URL shapes", () => {
  assert.equal(
    getThreadKey("https://f95zone.to/threads/my-game.12345/"),
    getThreadKey("https://f95zone.to/threads/12345/page-3#post-1"),
  );
  assert.notEqual(
    getThreadKey("https://f95zone.to/threads/my-game.12345/"),
    getThreadKey("https://f95zone.to/threads/other-game.999/"),
  );
  assert.equal(getThreadKey(""), "");
});

test("getHostBrand ignores TLD, CDN and blob differences", () => {
  assert.equal(getHostBrand("https://mixdrop.ag/f/abc"), "mixdrop");
  assert.equal(getHostBrand("mixdrop.co"), "mixdrop");
  assert.equal(getHostBrand("blob:https://mega.nz/1234-abcd"), "mega");
  assert.equal(getHostBrand("https://mega.co.nz/file/x"), "mega");
  assert.equal(
    getHostBrand("https://store-eu-1.gofile.io/download/x"),
    "gofile",
  );
  assert.equal(getHostBrand(""), "");
});

test("browser handoffs give a browser download to the newest waiting install of the same host", () => {
  const timers = createFakeTimers();
  const registry = createBrowserHandoffRegistry(timers);
  const megaInstall = { id: "mega" };
  const mixdropInstall = { id: "mixdrop" };
  const anyHostInstall = { id: "any" };

  registry.arm(megaInstall, {
    threadUrl: "https://f95zone.to/threads/a.1/",
    hosts: ["mega.nz", "https://f95zone.to/masked/abc/"],
  });
  registry.arm(mixdropInstall, {
    threadUrl: "https://f95zone.to/threads/b.2/",
    hosts: ["mixdrop.co"],
  });

  assert.equal(
    registry.takeForDownload([
      "https://example.com/",
      "https://cdn.example.com/x.zip",
    ]),
    null,
  );
  assert.equal(
    registry.takeForDownload([
      "https://mega.nz/file/abc",
      "blob:https://mega.nz/1",
    ]),
    megaInstall,
  );
  assert.equal(
    registry.takeForDownload([
      "https://mixdrop.ag/f/x",
      "https://a-delivery.example/x.zip",
    ]),
    mixdropInstall,
  );

  registry.arm(anyHostInstall, {
    threadUrl: "https://f95zone.to/threads/c.3/",
  });
  assert.equal(
    registry.takeForDownload(["https://whatever.example/"]),
    anyHostInstall,
  );
  assert.equal(registry.takeForDownload(["https://mega.nz/"]), null);
  assert.equal(timers.size(), 0);
});

test("browser handoffs are cancelled per thread and released explicitly", () => {
  const timers = createFakeTimers();
  const registry = createBrowserHandoffRegistry(timers);
  const threadA = { id: "a" };
  const threadB = { id: "b" };

  registry.arm(threadA, { threadUrl: "https://f95zone.to/threads/a.1/" });
  registry.arm(threadB, { threadUrl: "https://f95zone.to/threads/b.2/" });

  assert.deepEqual(registry.cancelForThread("https://f95zone.to/threads/1/"), [
    threadA,
  ]);
  assert.equal(registry.size(), 1);
  assert.equal(registry.release(threadB), true);
  assert.equal(registry.release(threadB), false);
  assert.equal(registry.size(), 0);
  assert.equal(timers.size(), 0);
});

test("browser handoffs expire when no download starts", () => {
  const timers = createFakeTimers();
  const expired = [];
  const registry = createBrowserHandoffRegistry({
    ...timers,
    onExpire: (context) => expired.push(context.id),
  });

  registry.arm(
    { id: "waiting" },
    { threadUrl: "https://f95zone.to/threads/a.1/" },
  );
  timers.fireAll();

  assert.deepEqual(expired, ["waiting"]);
  assert.equal(registry.takeForDownload([]), null);
});
