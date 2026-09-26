/**
 * Pure parts of the Electron resolver session: cookie selection for a URL,
 * the Cookie header, Set-Cookie persistence and the transport contract. The
 * net.request transport itself needs Electron and is exercised by
 * scripts/check-mirrors-electron.js.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createElectronResolverSession,
  mergeCookieHeader,
  selectCookiesForUrl,
} = require("../src/main/f95/electronSession");
const { createMockResponse } = require("./helpers/mockFetch");

const COOKIES = [
  { name: "cf_clearance", value: "cf", domain: ".bzzhr.to", hostOnly: false, path: "/", secure: true, httpOnly: true, expirationDate: 4102444800 },
  { name: "xf_user", value: "u", domain: "f95zone.to", hostOnly: true, path: "/", secure: true, expirationDate: 4102444800 },
  { name: "accountToken", value: "g", domain: ".gofile.io", hostOnly: false, path: "/", secure: true, expirationDate: 4102444800 },
  { name: "old", value: "x", domain: ".bzzhr.to", hostOnly: false, path: "/", secure: false, expirationDate: 1 },
  { name: "scoped", value: "s", domain: ".bzzhr.to", hostOnly: false, path: "/api", secure: false, expirationDate: 0 },
];

test("selectCookiesForUrl applies domain, host-only, path, secure and expiry rules", () => {
  const names = (url) => selectCookiesForUrl(COOKIES, url).map((cookie) => cookie.name).sort();
  assert.deepEqual(names("https://bzzhr.to/nce3rc3qd2y9"), ["cf_clearance"]);
  assert.deepEqual(names("https://bzzhr.to/api/x"), ["cf_clearance", "scoped"]);
  assert.deepEqual(names("http://bzzhr.to/api/x"), ["scoped"], "secure cookies stay on https");
  assert.deepEqual(names("https://cdn.bzzhr.to/file"), ["cf_clearance"], "domain cookies reach subdomains");
  assert.deepEqual(names("https://f95zone.to/masked/x"), ["xf_user"]);
  assert.deepEqual(names("https://attachments.f95zone.to/x"), [], "host-only cookies do not");
  assert.deepEqual(names("https://store1.gofile.io/download/web/a/b.zip"), ["accountToken"]);
  assert.deepEqual(names("not a url"), []);
});

test("mergeCookieHeader appends without duplicating names", () => {
  assert.equal(mergeCookieHeader("", [{ name: "cf_clearance", value: "abc" }]), "cf_clearance=abc");
  assert.equal(
    mergeCookieHeader("a=1; cf_clearance=old", [
      { name: "cf_clearance", value: "new" },
      { name: "b", value: "2" },
    ]),
    "a=1; cf_clearance=old; b=2",
  );
  assert.equal(mergeCookieHeader("a=1", []), "a=1");
});

function fakeSession(cookies = COOKIES) {
  const setCalls = [];
  return {
    setCalls,
    cookies: {
      // Electron's own URL filter misses domain cookies; emulate the worst
      // case (nothing matched natively) so the wrapper must send them itself.
      async get(filter = {}) {
        return filter.url ? cookies.filter((cookie) => cookie.hostOnly && cookie.domain === new URL(filter.url).hostname) : cookies;
      },
      async set(cookie) {
        setCalls.push(cookie);
      },
      async remove() {},
    },
    getUserAgent: () => "Electron/37",
    fetch: async () => {
      throw new Error("session.fetch must not be used (no cookies, blocked headers)");
    },
  };
}

test("requests go through the transport with the session's user agent and matching cookies", async () => {
  const seen = [];
  const session = fakeSession();
  const wrapped = createElectronResolverSession(session, {
    transport: async (rawSession, url, init) => {
      assert.equal(rawSession, session);
      seen.push({ url, init });
      return createMockResponse({ url, body: "ok" });
    },
  });
  const response = await wrapped.fetch("https://bzzhr.to/abc", {
    method: "GET",
    headers: { referer: "https://bzzhr.to/", cookie: "a=1" },
    redirect: "manual",
  });
  assert.equal(response.status, 200);
  const headers = new Headers(seen[0].init.headers);
  assert.equal(headers.get("cookie"), "a=1; cf_clearance=cf");
  assert.equal(headers.get("referer"), "https://bzzhr.to/");
  assert.equal(headers.get("user-agent"), "Electron/37");
  assert.equal(seen[0].init.redirect, "manual");
  assert.equal(wrapped.getUserAgent(), "Electron/37");
});

test("F95 login cookies reach masked-link requests, nothing reaches unrelated hosts", async () => {
  const seen = [];
  // Chromium matches nothing natively here, so the wrapper must send xf_user.
  const session = fakeSession();
  session.cookies.get = async (filter = {}) => (filter.url ? [] : COOKIES);
  const wrapped = createElectronResolverSession(session, {
    transport: async (rawSession, url, init) => {
      seen.push(new Headers(init.headers).get("cookie"));
      return createMockResponse({ url, body: "ok" });
    },
  });
  await wrapped.fetch("https://f95zone.to/masked/gofile.io/1/2/abc", { method: "POST", body: "xhr=1" });
  await wrapped.fetch("https://host.test/x", {});
  assert.deepEqual(seen, ["xf_user=u", null]);
});

test("Set-Cookie answers are stored back into the session", async () => {
  const session = fakeSession();
  const wrapped = createElectronResolverSession(session, {
    transport: async (rawSession, url) =>
      createMockResponse({
        url,
        body: "ok",
        headers: { "set-cookie": "xf_session=abc; Path=/; Domain=.f95zone.to; Secure; HttpOnly" },
      }),
  });
  await wrapped.fetch("https://f95zone.to/masked/x", { method: "POST", body: "xhr=1" });
  assert.equal(session.setCalls.length, 1);
  assert.equal(session.setCalls[0].name, "xf_session");
  assert.equal(session.setCalls[0].domain, "f95zone.to");
  assert.equal(session.setCalls[0].url, "https://f95zone.to/masked/x");
});

test("wrapped cookies.get({url}) finds domain cookies Electron's own URL filter misses", async () => {
  const session = fakeSession();
  const wrapped = createElectronResolverSession(session, {
    transport: async (rawSession, url) => createMockResponse({ url, body: "ok" }),
  });
  const byUrl = await wrapped.cookies.get({ url: "https://gofile.io/", name: "accountToken" });
  assert.deepEqual(byUrl.map((cookie) => cookie.value), ["g"]);
  const byDomain = await wrapped.cookies.get({ domain: "bzzhr.to" });
  assert.deepEqual(byDomain.map((cookie) => cookie.name).sort(), ["cf_clearance", "old", "scoped"]);
  const all = await wrapped.cookies.get({});
  assert.equal(all.length, COOKIES.length);
  await wrapped.cookies.set({ url: "https://gofile.io", name: "accountToken", value: "new" });
  assert.equal(session.setCalls.length, 1);
});

test("a cookie store that throws does not break the fetch", async () => {
  const session = {
    cookies: {
      async get() {
        throw new Error("boom");
      },
    },
  };
  const wrapped = createElectronResolverSession(session, {
    transport: async (rawSession, url) => createMockResponse({ url, body: "ok" }),
  });
  const response = await wrapped.fetch("https://host.test/x", {});
  assert.equal(await response.text(), "ok");
  assert.equal(wrapped.getUserAgent(), "");
  assert.deepEqual(await wrapped.cookies.get({ url: "https://host.test/" }), []);
});

test("cookies Chromium matches on its own are not duplicated in the explicit header", async () => {
  let seenInit = null;
  const session = {
    cookies: {
      async get(filter = {}) {
        return filter.url ? COOKIES.filter((cookie) => cookie.name === "cf_clearance") : COOKIES;
      },
      async set() {},
      async remove() {},
    },
    getUserAgent: () => "Electron/37",
  };
  const wrapped = createElectronResolverSession(session, {
    transport: async (rawSession, url, init) => {
      seenInit = init;
      return createMockResponse({ url, body: "ok" });
    },
  });
  await wrapped.fetch("https://bzzhr.to/api/x", {});
  assert.equal(new Headers(seenInit.headers).get("cookie"), "scoped=s", "cf_clearance is left to Chromium");
});
