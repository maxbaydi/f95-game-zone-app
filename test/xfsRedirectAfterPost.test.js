/**
 * XFileSharing hosts answer the final POST (op=download2) with a 302 to the
 * CDN file. Chromium's fetch (Electron session.fetch) fails a cross-origin
 * redirect after a POST with net::ERR_FAILED, so the redirect is handled by
 * hand: the Location is probed with a one-byte GET and becomes the target.
 * Observed on dailyuploads.net, 2026-09-26.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { prepareMirrorDownload } = require("../src/main/f95/hosts");
const { createMockResponse, createRoutedSession, noSleep } = require("./helpers/mockFetch");

const PAGE_1 = `<html><body>
<form method="POST" action="">
  <input type="hidden" name="op" value="download1">
  <input type="hidden" name="id" value="pq3vaxi0jpdt">
  <input type="hidden" name="usr_login" value="">
  <input type="hidden" name="fname" value="ESR-11985-v1.2.20.rar">
  <input type="submit" name="method_free" value="Free Download">
</form></body></html>`;

const PAGE_2 = `<html><body>
<span class="seconds">1</span>
<form method="POST" action="" name="F1">
  <input type="hidden" name="op" value="download2">
  <input type="hidden" name="id" value="pq3vaxi0jpdt">
  <input type="hidden" name="rand" value="r4nd">
  <input type="hidden" name="referer" value="">
  <input type="hidden" name="method_free" value="Free Download">
  <input type="hidden" name="method_premium" value="">
  <input type="submit" name="btn_download" value="Download">
</form></body></html>`;

const CDN = "https://cdn89.files-cdn.com/d/abc/ESR-11985-v1.2.20.rar";

test("the 302 after the last XFS POST is followed by hand with a one-byte probe", async () => {
  const session = createRoutedSession([
    [
      "https://dailyuploads.net/pq3vaxi0jpdt",
      (url, options) => {
        if (options.method === "GET") {
          return createMockResponse({ url, body: PAGE_1 });
        }
        const body = String(options.body || "");
        if (/op=download1/.test(body)) {
          return createMockResponse({ url, body: PAGE_2 });
        }
        assert.match(body, /op=download2/);
        assert.match(body, /rand=r4nd/);
        assert.equal(options.redirect, "manual", "POST redirects are handled by hand");
        return createMockResponse({
          url,
          status: 302,
          headers: { location: CDN },
          body: "",
        });
      },
    ],
    [
      CDN,
      (url, options) => {
        assert.equal(options.method, "GET");
        assert.equal(new Headers(options.headers).get("range"), "bytes=0-0");
        return createMockResponse({
          url,
          status: 206,
          headers: {
            "content-type": "application/octet-stream",
            "content-range": "bytes 0-0/1000",
          },
          body: "R",
        });
      },
    ],
  ]);

  const prepared = await prepareMirrorDownload(session, "https://dailyuploads.net/pq3vaxi0jpdt", {
    sleep: noSleep,
    retry: { attempts: 1 },
  });
  assert.equal(prepared.resolvedUrl, CDN);
  assert.equal(prepared.hostId, "dailyuploads");
  assert.equal(prepared.headers.referer, "https://dailyuploads.net/pq3vaxi0jpdt");
});

test("a POST that answers with the file itself still resolves to the final URL", async () => {
  const session = createRoutedSession([
    [
      "https://dailyuploads.net/pq3vaxi0jpdt",
      (url, options) => {
        if (options.method === "GET") {
          return createMockResponse({ url, body: PAGE_1 });
        }
        if (/op=download1/.test(String(options.body || ""))) {
          return createMockResponse({ url, body: PAGE_2 });
        }
        return createMockResponse({
          url: CDN,
          headers: { "content-type": "application/octet-stream", "content-length": "4" },
          body: "RAR!",
        });
      },
    ],
  ]);
  const prepared = await prepareMirrorDownload(session, "https://dailyuploads.net/pq3vaxi0jpdt", {
    sleep: noSleep,
    retry: { attempts: 1 },
  });
  assert.equal(prepared.resolvedUrl, CDN);
});
