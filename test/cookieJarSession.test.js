const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCookieJar,
  createCookieJarSession,
  parseNetscapeCookies,
  parseSetCookieHeader,
} = require("../src/main/f95/cookieJar");
const { fetchWithCookieJar, BROWSER_USER_AGENT } = require("../src/main/f95/hosts/common");
const { createMockResponse } = require("./helpers/mockFetch");

async function withStubbedFetch(routes, run) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers || {});
    calls.push({
      url: String(url),
      method: String(init.method || "GET").toUpperCase(),
      headers: Object.fromEntries(headers.entries()),
      body: init.body,
      redirect: init.redirect,
    });
    const handler = routes[String(url)];
    if (!handler) {
      throw new Error(`Unexpected fetch ${url}`);
    }
    return handler(String(url), init, calls.length);
  };
  try {
    await run(calls);
  } finally {
    global.fetch = originalFetch;
  }
}

test("parseSetCookieHeader reads name, value and attributes", () => {
  const cookie = parseSetCookieHeader(
    "xf_session=abc123; path=/; domain=.f95zone.to; secure; HttpOnly; Max-Age=3600",
    "https://f95zone.to/masked/x",
  );
  assert.equal(cookie.name, "xf_session");
  assert.equal(cookie.value, "abc123");
  assert.equal(cookie.domain, "f95zone.to");
  assert.equal(cookie.hostOnly, false);
  assert.equal(cookie.path, "/");
  assert.equal(cookie.secure, true);
  assert.equal(cookie.httpOnly, true);
  assert.ok(cookie.expirationDate > Date.now() / 1000);
});

test("parseSetCookieHeader defaults domain/path from the request URL and drops junk", () => {
  const cookie = parseSetCookieHeader("token=1", "https://store1.gofile.io/download/web/x");
  assert.equal(cookie.domain, "store1.gofile.io");
  assert.equal(cookie.hostOnly, true);
  assert.equal(cookie.path, "/download/web");
  assert.equal(parseSetCookieHeader("", "https://x.y"), null);
  assert.equal(parseSetCookieHeader("=novalue", "https://x.y"), null);
});

test("cookie jar matches by domain, path, scheme and expiry", async () => {
  const jar = createCookieJar();
  await jar.set({ url: "https://f95zone.to/", name: "xf_user", value: "u1", domain: ".f95zone.to" });
  await jar.set({ url: "https://f95zone.to/", name: "only_root", value: "r", path: "/masked" });
  await jar.set({ url: "https://f95zone.to/", name: "sec", value: "s", secure: true });
  await jar.set({
    url: "https://f95zone.to/",
    name: "old",
    value: "x",
    expirationDate: Date.now() / 1000 - 10,
  });
  await jar.set({ url: "https://other.example/", name: "foreign", value: "f" });

  const names = (cookies) => cookies.map((cookie) => cookie.name).sort();
  assert.deepEqual(names(await jar.get({ url: "https://f95zone.to/masked/a" })), [
    "only_root",
    "sec",
    "xf_user",
  ]);
  assert.deepEqual(names(await jar.get({ url: "https://f95zone.to/threads/1" })), [
    "sec",
    "xf_user",
  ]);
  assert.deepEqual(names(await jar.get({ url: "http://f95zone.to/threads/1" })), ["xf_user"]);
  assert.deepEqual(names(await jar.get({ url: "https://attachments.f95zone.to/x" })), [
    "xf_user",
  ]);
  assert.deepEqual(names(await jar.get({})), ["foreign", "only_root", "sec", "xf_user"]);
});

test("cookie jar overwrites a cookie with the same name/domain/path and removes it", async () => {
  const jar = createCookieJar();
  await jar.set({ url: "https://gofile.io/", name: "accountToken", value: "one", domain: ".gofile.io" });
  await jar.set({ url: "https://gofile.io/", name: "accountToken", value: "two", domain: ".gofile.io" });
  const cookies = await jar.get({ url: "https://store1.gofile.io/download/x" });
  assert.deepEqual(cookies.map((cookie) => cookie.value), ["two"]);
  await jar.remove("https://gofile.io/", "accountToken");
  assert.deepEqual(await jar.get({ url: "https://gofile.io/" }), []);
});

test("parseNetscapeCookies understands the browser export format", () => {
  const text = [
    "# Netscape HTTP Cookie File",
    "# https://curl.se/docs/http-cookies.html",
    "",
    ".f95zone.to\tTRUE\t/\tTRUE\t1893456000\txf_user\t123%2Cabc",
    "#HttpOnly_.f95zone.to\tTRUE\t/\tTRUE\t0\txf_session\tsess",
    "f95zone.to\tFALSE\t/\tFALSE\t1893456000\txf_csrf\tcsrf",
    "broken line without tabs",
  ].join("\n");
  const cookies = parseNetscapeCookies(text);
  assert.equal(cookies.length, 3);
  assert.deepEqual(cookies[0], {
    domain: "f95zone.to",
    hostOnly: false,
    path: "/",
    secure: true,
    expirationDate: 1893456000,
    name: "xf_user",
    value: "123%2Cabc",
    httpOnly: false,
  });
  assert.equal(cookies[1].httpOnly, true);
  assert.equal(cookies[1].expirationDate, 0);
  assert.equal(cookies[2].hostOnly, true);
  assert.equal(cookies[2].secure, false);
});

test("fetchWithCookieJar attaches jar cookies and records Set-Cookie from the response", async () => {
  const session = createCookieJarSession();
  await session.cookies.set({ url: "https://host.test/", name: "a", value: "1" });

  await withStubbedFetch(
    {
      "https://host.test/page": () =>
        createMockResponse({
          url: "https://host.test/page",
          body: "ok",
          headers: { "set-cookie": "b=2; Path=/; HttpOnly" },
        }),
    },
    async (calls) => {
      const response = await fetchWithCookieJar(session, "https://host.test/page", {
        method: "GET",
      });
      assert.equal(response.status, 200);
      assert.equal(calls[0].headers.cookie, "a=1");
      const cookies = await session.cookies.get({ url: "https://host.test/other" });
      assert.deepEqual(cookies.map((cookie) => `${cookie.name}=${cookie.value}`).sort(), [
        "a=1",
        "b=2",
      ]);
    },
  );
});

test("fetchWithCookieJar follows redirects hop by hop with fresh cookies", async () => {
  const session = createCookieJarSession();

  await withStubbedFetch(
    {
      "https://host.test/start": () =>
        createMockResponse({
          status: 302,
          url: "https://host.test/start",
          headers: {
            location: "/second",
            "set-cookie": "hop=1; Path=/",
          },
          body: "",
        }),
      "https://host.test/second": () =>
        createMockResponse({
          status: 303,
          url: "https://host.test/second",
          headers: { location: "https://cdn.test/file.zip" },
          body: "",
        }),
      "https://cdn.test/file.zip": () =>
        createMockResponse({
          url: "https://cdn.test/file.zip",
          headers: { "content-type": "application/zip" },
          body: "PK",
        }),
    },
    async (calls) => {
      const response = await fetchWithCookieJar(session, "https://host.test/start", {
        method: "POST",
        body: "x=1",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      assert.equal(response.status, 200);
      assert.equal(response.url, "https://cdn.test/file.zip");
      assert.equal(calls.length, 3);
      assert.equal(calls[0].redirect, "manual");
      assert.equal(calls[1].headers.cookie, "hop=1");
      assert.equal(calls[1].method, "GET", "302 after POST becomes GET");
      assert.equal(calls[1].body, undefined);
      assert.equal(calls[2].method, "GET");
      assert.equal(calls[2].headers.cookie, undefined, "cookies do not leak cross-site");
      assert.equal(calls[2].headers["content-type"], undefined);
    },
  );
});

test("fetchWithCookieJar keeps 307/308 method and body and honours redirect: manual", async () => {
  const session = createCookieJarSession();
  await withStubbedFetch(
    {
      "https://host.test/post": () =>
        createMockResponse({
          status: 307,
          url: "https://host.test/post",
          headers: { location: "https://host.test/post2" },
          body: "",
        }),
      "https://host.test/post2": () =>
        createMockResponse({ url: "https://host.test/post2", body: "done" }),
    },
    async (calls) => {
      const response = await fetchWithCookieJar(session, "https://host.test/post", {
        method: "POST",
        body: "payload",
      });
      assert.equal(await response.text(), "done");
      assert.equal(calls[1].method, "POST");
      assert.equal(calls[1].body, "payload");

      const manual = await fetchWithCookieJar(session, "https://host.test/post", {
        method: "POST",
        body: "payload",
        redirect: "manual",
      });
      assert.equal(manual.status, 307);
      assert.equal(calls.length, 3);
    },
  );
});

test("fetchWithCookieJar gives up after too many redirects", async () => {
  const session = createCookieJarSession();
  await withStubbedFetch(
    {
      "https://host.test/loop": () =>
        createMockResponse({
          status: 302,
          url: "https://host.test/loop",
          headers: { location: "/loop" },
          body: "",
        }),
    },
    async () => {
      await assert.rejects(
        fetchWithCookieJar(session, "https://host.test/loop", {}),
        /redirect/i,
      );
    },
  );
});

test("cookie-jar session fetch sends a browser identity by default", async () => {
  const session = createCookieJarSession();
  await withStubbedFetch(
    {
      "https://host.test/ua": () => createMockResponse({ url: "https://host.test/ua", body: "ok" }),
    },
    async (calls) => {
      await session.fetch("https://host.test/ua", {});
      assert.equal(calls[0].headers["user-agent"], BROWSER_USER_AGENT);
      await session.fetch("https://host.test/ua", { headers: { "user-agent": "custom" } });
      assert.equal(calls[1].headers["user-agent"], "custom");
    },
  );
});

test("cookie-jar session reports every response to the observer", async () => {
  const seen = [];
  const session = createCookieJarSession({
    onResponse: (info) => {
      seen.push(info);
    },
  });
  await withStubbedFetch(
    {
      "https://host.test/json": () =>
        createMockResponse({ url: "https://host.test/json", json: { ok: true } }),
    },
    async () => {
      const response = await session.fetch("https://host.test/json", { method: "GET" });
      assert.deepEqual(await response.json(), { ok: true });
      assert.equal(seen.length, 1);
      assert.equal(seen[0].url, "https://host.test/json");
      assert.equal(seen[0].status, 200);
      assert.equal(seen[0].method, "GET");
      assert.equal(typeof seen[0].response.clone, "function");
    },
  );
});
