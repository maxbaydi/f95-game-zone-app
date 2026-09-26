/**
 * Pure parts of the Electron resolver session: cookie selection for a URL
 * and the Cookie header. The net.request path needs Electron and is
 * exercised by scripts/check-mirrors-electron.js.
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

function fakeSession(fetchImpl, cookies = COOKIES) {
  const setCalls = [];
  return {
    setCalls,
    cookies: {
      async get() {
        return cookies;
      },
      async set(cookie) {
        setCalls.push(cookie);
      },
      async remove() {},
    },
    getUserAgent: () => "Electron/37",
    fetch: fetchImpl,
  };
}

test("the wrapped fetch sends the session cookies matching the URL in the Cookie header", async () => {
  /** @type {any} */
  let seenInit = null;
  const session = fakeSession(async (url, init) => {
    seenInit = init;
    return createMockResponse({ url, body: "ok" });
  });
  const wrapped = createElectronResolverSession(session);
  const response = await wrapped.fetch("https://bzzhr.to/abc", {
    method: "GET",
    headers: { referer: "https://bzzhr.to/", cookie: "a=1" },
  });
  assert.equal(response.status, 200);
  const headers = new Headers(seenInit.headers);
  assert.equal(headers.get("cookie"), "a=1; cf_clearance=cf");
  assert.equal(headers.get("referer"), "https://bzzhr.to/");
  assert.equal(seenInit.redirect, undefined);
  assert.equal(wrapped.getUserAgent(), "Electron/37");
});

test("F95 login cookies reach masked-link requests, nothing reaches unrelated hosts", async () => {
  const seen = [];
  const session = fakeSession(async (url, init) => {
    seen.push(new Headers(init.headers).get("cookie"));
    return createMockResponse({ url, body: "ok" });
  });
  const wrapped = createElectronResolverSession(session);
  await wrapped.fetch("https://f95zone.to/masked/gofile.io/1/2/abc", { method: "POST", body: "xhr=1" });
  await wrapped.fetch("https://host.test/x", {});
  assert.deepEqual(seen, ["xf_user=u", null]);
});

test("wrapped cookies.get({url}) finds domain cookies Electron's own URL filter misses", async () => {
  const session = fakeSession(async (url) => createMockResponse({ url, body: "ok" }));
  const wrapped = createElectronResolverSession(session);
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
    fetch: async (url) => createMockResponse({ url, body: "ok" }),
  };
  const wrapped = createElectronResolverSession(session);
  const response = await wrapped.fetch("https://host.test/x", {});
  assert.equal(await response.text(), "ok");
  assert.equal(wrapped.getUserAgent(), "");
  assert.deepEqual(await wrapped.cookies.get({ url: "https://host.test/" }), []);
});
