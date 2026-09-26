/**
 * Regression tests driven by real (anonymised) host responses recorded with
 * `scripts/check-mirrors.js --capture`. Fixtures live in test/fixtures/hosts.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  GOFILE_CLIENT_USER_AGENT,
  GOFILE_STATIC_WEBSITE_TOKEN,
  GOFILE_WT_SALT,
  generateGofileWebsiteToken,
  resolveGofileTarget,
} = require("../src/main/f95/hosts/gofile");
const { MirrorError, createResolverContext } = require("../src/main/f95/hosts/common");
const { prepareMirrorDownload } = require("../src/main/f95/hosts");
const {
  createMockResponse,
  createRoutedSession,
  noSleep,
} = require("./helpers/mockFetch");

const FIXTURES = path.join(__dirname, "fixtures", "hosts");

function fixture(host, name) {
  return fs.readFileSync(path.join(FIXTURES, host, name), "utf8");
}

function fixtureJson(host, name) {
  return JSON.parse(fixture(host, name));
}

function jsonResponse(url, json, status = 200) {
  return createMockResponse({ url, status, json });
}

function expectedWebsiteToken(accountToken) {
  return generateGofileWebsiteToken(accountToken, GOFILE_WT_SALT, {
    userAgent: GOFILE_CLIENT_USER_AGENT,
    language: "en-US",
  });
}

const GUEST = fixtureJson("gofile", "accounts-guest.json");
const WEBSITE = fixtureJson("gofile", "accounts-website.json");
const CONTENTS_OK = {
  status: "ok",
  data: {
    id: "folder",
    type: "folder",
    name: "2cmlCIGh",
    children: {
      a: {
        id: "a",
        type: "file",
        name: "mirror-test.zip",
        size: 1499865,
        link: "https://store1.gofile.io/download/web/a/mirror-test.zip",
      },
    },
  },
};

/** @returns {any} */
function gofileRoutes(contentsHandler) {
  return [
    ["https://api.gofile.io/accounts", (url) => jsonResponse(url, GUEST)],
    ["https://api.gofile.io/accounts/website", (url) => jsonResponse(url, WEBSITE)],
    [/^https:\/\/api\.gofile\.io\/contents\//, contentsHandler],
  ];
}

test("gofile: the computed website token unlocks the content API on the first try", async () => {
  const session = createRoutedSession(
    gofileRoutes((url, options) => {
      assert.equal(options.headers["x-website-token"], expectedWebsiteToken(WEBSITE.data.token));
      assert.equal(options.headers.authorization, `Bearer ${WEBSITE.data.token}`);
      return jsonResponse(url, CONTENTS_OK);
    }),
  );
  const ctx = createResolverContext({ session, sleep: noSleep });

  /** @type {any} */
  const target = await resolveGofileTarget(ctx, "https://gofile.io/d/2cmlCIGh");
  assert.deepEqual(target, {
    url: "https://store1.gofile.io/download/web/a/mirror-test.zip",
    fileName: "mirror-test.zip",
    size: 1499865,
    transfer: "direct",
  });
  assert.deepEqual(
    session.calls.map((call) => `${call.method} ${call.url}`),
    [
      "POST https://api.gofile.io/accounts",
      "GET https://api.gofile.io/accounts/website",
      "GET https://api.gofile.io/contents/2cmlCIGh",
    ],
    "no request to the retired /dist/js/config.js",
  );
});

test("gofile: a 401 error-notPremium rotates to the static token before creating a new account", async () => {
  const seenTokens = [];
  const session = createRoutedSession(
    gofileRoutes((url, options) => {
      seenTokens.push(options.headers["x-website-token"]);
      if (seenTokens.length === 1) {
        return jsonResponse(url, fixtureJson("gofile", "contents-not-premium.json"), 401);
      }
      return jsonResponse(url, CONTENTS_OK);
    }),
  );
  const ctx = createResolverContext({ session, sleep: noSleep });

  /** @type {any} */
  const target = await resolveGofileTarget(ctx, "https://gofile.io/d/2cmlCIGh");
  assert.equal(target.url, "https://store1.gofile.io/download/web/a/mirror-test.zip");
  assert.deepEqual(seenTokens, [
    expectedWebsiteToken(WEBSITE.data.token),
    GOFILE_STATIC_WEBSITE_TOKEN,
  ]);
  assert.equal(
    session.calls.filter((call) => call.url === "https://api.gofile.io/accounts").length,
    1,
    "the guest account is created once",
  );
});

test("gofile: when every token is rejected the error is explicit and not retried forever", async () => {
  const session = createRoutedSession(
    gofileRoutes((url) =>
      jsonResponse(url, fixtureJson("gofile", "contents-not-premium.json"), 401),
    ),
  );
  const ctx = createResolverContext({ session, sleep: noSleep });

  await assert.rejects(
    resolveGofileTarget(ctx, "https://gofile.io/d/2cmlCIGh"),
    (/** @type {any} */ error) =>
      error instanceof MirrorError &&
      error.code === "access_denied" &&
      error.retryable === false &&
      /notPremium/.test(error.message),
  );
  assert.equal(
    session.calls.filter((call) => call.url === "https://api.gofile.io/accounts").length,
    2,
    "one refresh of the guest account, then give up",
  );
});

test("gofile: a rate-limited account bootstrap surfaces as a retryable rate_limited error", async () => {
  const session = createRoutedSession([
    [
      "https://api.gofile.io/accounts",
      (url) =>
        createMockResponse({
          url,
          status: 429,
          headers: { "retry-after": "20" },
          json: fixtureJson("gofile", "contents-rate-limit.json"),
        }),
    ],
  ]);
  const ctx = createResolverContext({ session, sleep: noSleep });

  await assert.rejects(
    resolveGofileTarget(ctx, "https://gofile.io/d/2cmlCIGh"),
    (/** @type {any} */ error) =>
      error instanceof MirrorError &&
      error.code === "rate_limited" &&
      error.retryable === true &&
      error.retryAfterMs === 20000,
  );
});

test("gofile: a rate-limited content lookup is retryable too", async () => {
  const session = createRoutedSession(
    gofileRoutes((url) =>
      jsonResponse(url, fixtureJson("gofile", "contents-rate-limit.json"), 429),
    ),
  );
  const ctx = createResolverContext({ session, sleep: noSleep });
  await assert.rejects(
    resolveGofileTarget(ctx, "https://gofile.io/d/2cmlCIGh"),
    (/** @type {any} */ error) => error.code === "rate_limited" && error.retryable === true,
  );
});

test("gofile: a pinned salt from host options overrides the built-in one", async () => {
  const session = createRoutedSession(
    gofileRoutes((url, options) => {
      assert.equal(
        options.headers["x-website-token"],
        generateGofileWebsiteToken(WEBSITE.data.token, "custom-salt", {
          userAgent: GOFILE_CLIENT_USER_AGENT,
          language: "en-US",
        }),
      );
      return jsonResponse(url, CONTENTS_OK);
    }),
  );
  const ctx = createResolverContext({
    session,
    sleep: noSleep,
    options: { gofileWebsiteTokenSalt: "custom-salt" },
  });
  /** @type {any} */
  const target = await resolveGofileTarget(ctx, "https://gofile.io/d/2cmlCIGh");
  assert.equal(target.fileName, "mirror-test.zip");
});

test("gofile: a guest account stored in the cookie jar is reused instead of creating a new one", async () => {
  // /accounts/website echoes the token it was called with; the fixture's
  // token therefore doubles as the stored cookie value.
  const session = createRoutedSession(
    gofileRoutes((url, options) => {
      assert.equal(options.headers.authorization, `Bearer ${WEBSITE.data.token}`);
      return jsonResponse(url, CONTENTS_OK);
    }),
  );
  const storedCookies = [
    {
      name: "accountToken",
      value: WEBSITE.data.token,
      domain: "gofile.io",
      hostOnly: false,
      path: "/",
      secure: true,
      httpOnly: false,
      expirationDate: 0,
    },
  ];
  session.cookies.get = async () => storedCookies;
  const setCalls = [];
  session.cookies.set = async (cookie) => {
    setCalls.push(cookie);
  };
  const ctx = createResolverContext({ session, sleep: noSleep });

  /** @type {any} */
  const target = await resolveGofileTarget(ctx, "https://gofile.io/d/2cmlCIGh");
  assert.equal(target.fileName, "mirror-test.zip");
  assert.deepEqual(
    session.calls.map((call) => `${call.method} ${call.url}`),
    [
      "GET https://api.gofile.io/accounts/website",
      "GET https://api.gofile.io/contents/2cmlCIGh",
    ],
  );
  assert.equal(setCalls.length, 1);
  assert.equal(setCalls[0].name, "accountToken");
  assert.ok(setCalls[0].expirationDate > Date.now() / 1000, "persisted across restarts");
});

test("gofile: a stale stored account falls back to a fresh guest account", async () => {
  let websiteCalls = 0;
  const session = createRoutedSession([
    ["https://api.gofile.io/accounts", (url) => jsonResponse(url, GUEST)],
    [
      "https://api.gofile.io/accounts/website",
      (url, options) => {
        websiteCalls += 1;
        if (options.headers.authorization === "Bearer STALE") {
          return createMockResponse({ url, status: 401, json: { status: "error-auth" } });
        }
        return jsonResponse(url, WEBSITE);
      },
    ],
    [/^https:\/\/api\.gofile\.io\/contents\//, (url) => jsonResponse(url, CONTENTS_OK)],
  ]);
  session.cookies.get = async () => [{ name: "accountToken", value: "STALE" }];
  const ctx = createResolverContext({ session, sleep: noSleep });

  /** @type {any} */
  const target = await resolveGofileTarget(ctx, "https://gofile.io/d/2cmlCIGh");
  assert.equal(target.fileName, "mirror-test.zip");
  assert.equal(websiteCalls, 2);
  assert.equal(
    session.calls.filter((call) => call.url === "https://api.gofile.io/accounts").length,
    1,
  );
});

test("pomf (qu.ax): the landing page is parsed down to the /x/<id>.<ext> file with the page as referer", async () => {
  const session = createRoutedSession([
    [
      "https://qu.ax/AI98m",
      (url) => createMockResponse({ url, body: fixture("pomf", "quax-file-page.html") }),
    ],
    [
      "https://qu.ax/x/AI98m.zip",
      (url, options) => {
        assert.equal(options.method, "GET");
        // Without the landing page as referer qu.ax answers 302 → landing page.
        if (new Headers(options.headers).get("referer") !== "https://qu.ax/AI98m") {
          return createMockResponse({
            url: "https://qu.ax/AI98m",
            body: fixture("pomf", "quax-file-page.html"),
          });
        }
        return createMockResponse({
          url,
          headers: {
            "content-type": "application/zip",
            "content-length": "1499865",
          },
          body: "PK",
        });
      },
    ],
  ]);

  const prepared = await prepareMirrorDownload(session, "https://qu.ax/AI98m", {
    sleep: noSleep,
    retry: { attempts: 1 },
  });
  assert.equal(prepared.hostId, "pomf");
  assert.equal(prepared.resolvedUrl, "https://qu.ax/x/AI98m.zip");
  assert.equal(prepared.transfer, "direct");
  assert.equal(prepared.headers.referer, "https://qu.ax/AI98m");
});

test("pomf: a direct file URL on a pomf clone stays a direct transfer", async () => {
  const session = createRoutedSession([
    [
      "https://pomf2.lain.la/f/abc.zip",
      (url) =>
        createMockResponse({
          url,
          headers: { "content-type": "application/octet-stream" },
          body: "PK",
        }),
    ],
  ]);
  const prepared = await prepareMirrorDownload(session, "https://pomf2.lain.la/f/abc.zip", {
    sleep: noSleep,
    retry: { attempts: 1 },
  });
  assert.equal(prepared.resolvedUrl, "https://pomf2.lain.la/f/abc.zip");
  assert.equal(prepared.hostId, "pomf");
});
