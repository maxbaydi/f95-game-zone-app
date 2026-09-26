/**
 * Cloudflare / captcha walls must surface as ACTION_REQUIRED (captcha_required)
 * for every host, not as a generic "refused access (HTTP 403)": the app only
 * opens the browser-step window for action-required errors.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  MirrorActionRequiredError,
  createResolverContext,
} = require("../src/main/f95/hosts/common");
const { prepareMirrorDownload } = require("../src/main/f95/hosts");
const { createMockResponse, createRoutedSession, noSleep } = require("./helpers/mockFetch");

const CHALLENGE_HTML = fs.readFileSync(
  path.join(__dirname, "fixtures", "hosts", "cloudflare", "challenge-403.html"),
  "utf8",
);

function challengeResponse(url, status = 403) {
  return createMockResponse({
    url,
    status,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cf-mitigated": "challenge",
      server: "cloudflare",
    },
    body: CHALLENGE_HTML,
  });
}

test("ctx.fetch turns a Cloudflare challenge response into an action-required error", async () => {
  const session = createRoutedSession([
    ["https://files.fm/u/abc", (url) => challengeResponse(url)],
  ]);
  const ctx = createResolverContext({ session, sleep: noSleep });

  await assert.rejects(
    ctx.fetch("https://files.fm/u/abc", { method: "GET" }),
    (error) =>
      error instanceof MirrorActionRequiredError &&
      error.code === "captcha_required" &&
      error.actionUrl === "https://files.fm/u/abc" &&
      /browser/i.test(error.userMessage),
  );
});

test("ctx.fetch leaves ordinary 403 pages and non-HTML errors to the resolver", async () => {
  const session = createRoutedSession([
    [
      "https://host.test/forbidden",
      (url) => createMockResponse({ url, status: 403, body: "<html><body>Forbidden</body></html>" }),
    ],
    [
      "https://host.test/api",
      (url) => createMockResponse({ url, status: 403, json: { error: "nope" } }),
    ],
  ]);
  const ctx = createResolverContext({ session, sleep: noSleep });

  const page = await ctx.fetch("https://host.test/forbidden", {});
  assert.equal(page.status, 403);
  assert.match(await page.text(), /Forbidden/);

  const api = await ctx.fetch("https://host.test/api", {});
  assert.equal(api.status, 403);
  assert.deepEqual(await api.json(), { error: "nope" });
});

test("ctx.fetch also recognises a 503 challenge and a Turnstile wall", async () => {
  const session = createRoutedSession([
    ["https://host.test/503", (url) => challengeResponse(url, 503)],
    [
      "https://host.test/turnstile",
      (url) =>
        createMockResponse({
          url,
          status: 403,
          body: '<html><body><div class="cf-turnstile" data-sitekey="x"></div></body></html>',
        }),
    ],
  ]);
  const ctx = createResolverContext({ session, sleep: noSleep });
  await assert.rejects(ctx.fetch("https://host.test/503", {}), MirrorActionRequiredError);
  await assert.rejects(ctx.fetch("https://host.test/turnstile", {}), MirrorActionRequiredError);
});

test("a successful response is passed through untouched (body still readable)", async () => {
  const session = createRoutedSession([
    [
      "https://host.test/file.zip",
      (url) =>
        createMockResponse({
          url,
          headers: { "content-type": "application/zip", "content-length": "2" },
          body: "PK",
        }),
    ],
  ]);
  const ctx = createResolverContext({ session, sleep: noSleep });
  const response = await ctx.fetch("https://host.test/file.zip", {});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "PK");
});

test("prepareMirrorDownload points the action at the mirror link, not at an API sub-request", async () => {
  const session = createRoutedSession([
    // Files.fm resolver first calls the share page; the wall is on it.
    [/^https:\/\/files\.fm\//, (url) => challengeResponse(url)],
  ]);

  await assert.rejects(
    prepareMirrorDownload(session, "https://files.fm/u/abc", {
      sleep: noSleep,
      retry: { attempts: 1 },
    }),
    (error) =>
      error instanceof MirrorActionRequiredError &&
      error.code === "captcha_required" &&
      error.actionUrl === "https://files.fm/u/abc" &&
      error.hostLabel === "Files.fm",
  );
});

test("a challenge on a host API call still opens the mirror page the user knows", async () => {
  const session = createRoutedSession([
    [
      "https://api.pixeldrain.com/file/abc/info",
      (url) => challengeResponse(url),
    ],
    [/^https:\/\/pixeldrain\.com\//, (url) => challengeResponse(url)],
  ]);
  await assert.rejects(
    prepareMirrorDownload(session, "https://pixeldrain.com/u/abc", {
      sleep: noSleep,
      retry: { attempts: 1 },
    }),
    (error) =>
      error instanceof MirrorActionRequiredError &&
      error.actionUrl === "https://pixeldrain.com/u/abc",
  );
});

test("challenge detection never retries: the error is not transient", async () => {
  let calls = 0;
  const session = createRoutedSession([
    [
      "https://files.fm/u/abc",
      (url) => {
        calls += 1;
        return challengeResponse(url);
      },
    ],
  ]);
  await assert.rejects(
    prepareMirrorDownload(session, "https://files.fm/u/abc", {
      sleep: noSleep,
      retry: { attempts: 3 },
    }),
    MirrorActionRequiredError,
  );
  assert.equal(calls, 1);
});
