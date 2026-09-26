/**
 * The Electron resolver session follows redirects hop by hop: cookies set by
 * an intermediate hop (XFS hosts create their session on the first GET and
 * redirect to /download) are stored and sent on the next hop. Chromium's own
 * redirect following in net.request drops them when useSessionCookies is off.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { createElectronResolverSession } = require("../src/main/f95/electronSession");
const { createMockResponse } = require("./helpers/mockFetch");

function fakeSession(initial = []) {
  const store = [...initial];
  return {
    store,
    cookies: {
      async get(filter = {}) {
        return filter.url ? [] : store;
      },
      async set(cookie) {
        const index = store.findIndex((entry) => entry.name === cookie.name && entry.domain === cookie.domain);
        const record = {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain || new URL(cookie.url).hostname,
          hostOnly: !cookie.domain,
          path: cookie.path || "/",
          secure: Boolean(cookie.secure),
          expirationDate: cookie.expirationDate || 0,
        };
        if (index >= 0) {
          store[index] = record;
        } else {
          store.push(record);
        }
      },
      async remove() {},
    },
    getUserAgent: () => "Electron/37",
  };
}

test("a cookie set by a 302 hop is sent on the next hop and the final response is returned", async () => {
  const hops = [];
  const session = fakeSession();
  const wrapped = createElectronResolverSession(session, {
    transport: async (rawSession, url, init) => {
      hops.push({ url, method: init.method, cookie: new Headers(init.headers).get("cookie"), redirect: init.redirect });
      assert.equal(init.redirect, "manual", "every hop is requested without automatic following");
      if (url === "https://datanodes.to/abc/file.zip") {
        return createMockResponse({
          url,
          status: 302,
          headers: { location: "/download", "set-cookie": "xfss=sess123; Path=/; HttpOnly" },
          body: "",
        });
      }
      return createMockResponse({ url, body: "<html>download page</html>" });
    },
  });

  const response = await wrapped.fetch("https://datanodes.to/abc/file.zip", { method: "GET" });
  assert.equal(response.status, 200);
  assert.equal(response.url, "https://datanodes.to/download");
  assert.equal(await response.text(), "<html>download page</html>");
  assert.deepEqual(
    hops.map((hop) => [hop.url, hop.method, hop.cookie]),
    [
      ["https://datanodes.to/abc/file.zip", "GET", null],
      ["https://datanodes.to/download", "GET", "xfss=sess123"],
    ],
  );
  assert.equal(session.store.length, 1, "the hop cookie is persisted in the partition");
});

test("redirect: manual returns the first 3xx untouched (with its location)", async () => {
  const wrapped = createElectronResolverSession(fakeSession(), {
    transport: async (rawSession, url) =>
      createMockResponse({ url, status: 302, headers: { location: "https://cdn.test/f.zip" }, body: "" }),
  });
  const response = await wrapped.fetch("https://host.test/x", { method: "POST", body: "a=1", redirect: "manual" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://cdn.test/f.zip");
});

test("a POST answered with 302/303 continues as GET without the body", async () => {
  const hops = [];
  const wrapped = createElectronResolverSession(fakeSession(), {
    transport: async (rawSession, url, init) => {
      hops.push({ url, method: init.method, body: init.body });
      if (hops.length === 1) {
        return createMockResponse({ url, status: 303, headers: { location: "https://cdn.test/f.zip" }, body: "" });
      }
      return createMockResponse({
        url,
        headers: { "content-type": "application/zip" },
        body: "PK",
      });
    },
  });
  const response = await wrapped.fetch("https://host.test/x", {
    method: "POST",
    body: "op=download2",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(hops[1], { url: "https://cdn.test/f.zip", method: "GET", body: undefined });
  assert.equal(response.redirected, true);
});

test("307 keeps the method and body", async () => {
  const hops = [];
  const wrapped = createElectronResolverSession(fakeSession(), {
    transport: async (rawSession, url, init) => {
      hops.push({ method: init.method, body: init.body });
      if (hops.length === 1) {
        return createMockResponse({ url, status: 307, headers: { location: "/again" }, body: "" });
      }
      return createMockResponse({ url, body: "ok" });
    },
  });
  await wrapped.fetch("https://host.test/x", { method: "POST", body: "payload" });
  assert.deepEqual(hops[1], { method: "POST", body: "payload" });
});

test("too many redirects fail instead of looping", async () => {
  const wrapped = createElectronResolverSession(fakeSession(), {
    transport: async (rawSession, url) =>
      createMockResponse({ url, status: 302, headers: { location: url }, body: "" }),
  });
  await assert.rejects(wrapped.fetch("https://host.test/loop", {}), /redirect/i);
});

test("redirect: error rejects on the first redirect", async () => {
  const wrapped = createElectronResolverSession(fakeSession(), {
    transport: async (rawSession, url) =>
      createMockResponse({ url, status: 302, headers: { location: "/x" }, body: "" }),
  });
  await assert.rejects(wrapped.fetch("https://host.test/x", { redirect: "error" }), /redirect/i);
});
