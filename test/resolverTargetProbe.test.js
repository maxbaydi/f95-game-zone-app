/**
 * The browser-step flow re-resolves a mirror after every navigation. A
 * resolver that answers without touching the network (Buzzheavier returns
 * the page URL as a direct file) would end the step before Cloudflare has
 * finished its check. With `probeTarget` the resolved target is fetched
 * once (one byte) so the step only ends when the file is really reachable.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { MirrorActionRequiredError, MirrorError } = require("../src/main/f95/hosts/common");
const { prepareMirrorDownload } = require("../src/main/f95/hosts");
const { createMockResponse, createRoutedSession, noSleep } = require("./helpers/mockFetch");

const CHALLENGE_HTML = fs.readFileSync(
  path.join(__dirname, "fixtures", "hosts", "cloudflare", "challenge-403.html"),
  "utf8",
);

function fileProbeResponse(url) {
  return createMockResponse({
    url,
    status: 206,
    headers: {
      "content-type": "application/zip",
      "content-range": "bytes 0-0/5000",
      "content-length": "1",
    },
    body: "P",
  });
}

test("probeTarget: a reachable direct file keeps the prepared download (one 1-byte request)", async () => {
  const session = createRoutedSession([
    [
      "https://litter.catbox.moe/abc.zip",
      (url, options) => {
        assert.equal(new Headers(options.headers).get("range"), "bytes=0-0");
        return fileProbeResponse(url);
      },
    ],
  ]);
  const prepared = await prepareMirrorDownload(session, "https://litter.catbox.moe/abc.zip", {
    sleep: noSleep,
    retry: { attempts: 1 },
    probeTarget: true,
  });
  assert.equal(prepared.resolvedUrl, "https://litter.catbox.moe/abc.zip");
  assert.equal(session.calls.length, 1);
});

test("probeTarget: a Cloudflare wall on the target keeps the browser step open", async () => {
  const session = createRoutedSession([
    [
      "https://litter.catbox.moe/abc.zip",
      (url) =>
        createMockResponse({
          url,
          status: 403,
          headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
          body: CHALLENGE_HTML,
        }),
    ],
  ]);
  await assert.rejects(
    prepareMirrorDownload(session, "https://litter.catbox.moe/abc.zip", {
      sleep: noSleep,
      retry: { attempts: 1 },
      probeTarget: true,
    }),
    (/** @type {any} */ error) =>
      error instanceof MirrorActionRequiredError &&
      error.code === "captcha_required" &&
      error.actionUrl === "https://litter.catbox.moe/abc.zip",
  );
});

test("probeTarget: an HTML answer instead of the file is reported as action required too", async () => {
  const session = createRoutedSession([
    [
      "https://fileditch.com/x/abc.zip",
      (url) => createMockResponse({ url, body: "<html><body>Please wait...</body></html>" }),
    ],
  ]);
  await assert.rejects(
    prepareMirrorDownload(session, "https://fileditch.com/x/abc.zip", {
      sleep: noSleep,
      retry: { attempts: 1 },
      probeTarget: true,
    }),
    (/** @type {any} */ error) =>
      error instanceof MirrorActionRequiredError &&
      error.actionUrl === "https://fileditch.com/x/abc.zip",
  );
});

test("probeTarget: a 404 on the target fails clearly", async () => {
  const session = createRoutedSession([
    [
      "https://fileditch.com/x/abc.zip",
      (url) => createMockResponse({ url, status: 404, body: "nope" }),
    ],
  ]);
  await assert.rejects(
    prepareMirrorDownload(session, "https://fileditch.com/x/abc.zip", {
      sleep: noSleep,
      retry: { attempts: 1 },
      probeTarget: true,
    }),
    (/** @type {any} */ error) => error instanceof MirrorError && error.code === "not_found",
  );
});

test("without probeTarget nothing is fetched for a direct host", async () => {
  const session = createRoutedSession([]);
  const prepared = await prepareMirrorDownload(session, "https://litter.catbox.moe/abc.zip", {
    sleep: noSleep,
    retry: { attempts: 1 },
  });
  assert.equal(prepared.resolvedUrl, "https://litter.catbox.moe/abc.zip");
  assert.equal(session.calls.length, 0);
});

test("probeTarget: the probe carries the resolver's headers (referer) and a 416 counts as reachable", async () => {
  const session = createRoutedSession([
    [
      "https://qu.ax/AI98m",
      (url) =>
        createMockResponse({
          url,
          body: '<html><body><a href="/x/AI98m.zip" download>Download</a></body></html>',
        }),
    ],
    [
      "https://qu.ax/x/AI98m.zip",
      (url, options) => {
        const headers = new Headers(options.headers);
        if (headers.get("range") === "bytes=0-0") {
          assert.equal(headers.get("referer"), "https://qu.ax/AI98m");
          return createMockResponse({ url, status: 416, body: "" });
        }
        return createMockResponse({
          url,
          headers: { "content-type": "application/zip", "content-length": "2" },
          body: "PK",
        });
      },
    ],
  ]);
  const prepared = await prepareMirrorDownload(session, "https://qu.ax/AI98m", {
    sleep: noSleep,
    retry: { attempts: 1 },
    probeTarget: true,
  });
  assert.equal(prepared.resolvedUrl, "https://qu.ax/x/AI98m.zip");
  assert.equal(
    session.calls.filter((call) => new Headers(call.headers).get("range") === "bytes=0-0").length,
    1,
  );
});
