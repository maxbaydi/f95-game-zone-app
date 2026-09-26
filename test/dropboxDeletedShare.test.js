/**
 * Dropbox answers `?dl=1` for a deleted or disabled share with HTTP 200 and an
 * HTML page (captured 2026-09-26). The resolver must report "not found"
 * instead of handing the page to the transfer as if it were the file.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { MirrorError } = require("../src/main/f95/hosts/common");
const { prepareMirrorDownload } = require("../src/main/f95/hosts");
const { createMockResponse, createRoutedSession, noSleep } = require("./helpers/mockFetch");

const DELETED_PAGE = fs.readFileSync(
  path.join(__dirname, "fixtures", "hosts", "dropbox", "file-deleted.html"),
  "utf8",
);
const SHARE = "https://www.dropbox.com/scl/fi/abc123/Game-v1.zip?rlkey=key&e=1&st=xyz&dl=0";
const DIRECT = "https://www.dropbox.com/scl/fi/abc123/Game-v1.zip?rlkey=key&e=1&st=xyz&dl=1";

test("a deleted Dropbox share is reported as not_found", async () => {
  const session = createRoutedSession([
    [DIRECT, (url) => createMockResponse({ url, body: DELETED_PAGE })],
  ]);
  await assert.rejects(
    prepareMirrorDownload(session, SHARE, { sleep: noSleep, retry: { attempts: 1 } }),
    (/** @type {any} */ error) =>
      error instanceof MirrorError && error.code === "not_found" && /Dropbox/.test(error.message),
  );
});

test("a live Dropbox share resolves to the redirect target of ?dl=1", async () => {
  const session = createRoutedSession([
    [
      DIRECT,
      (url) =>
        createMockResponse({
          url,
          status: 302,
          headers: { location: "https://uc123.dl.dropboxusercontent.com/cd/0/get/Game-v1.zip" },
          body: "",
        }),
    ],
  ]);
  const prepared = await prepareMirrorDownload(session, SHARE, {
    sleep: noSleep,
    retry: { attempts: 1 },
  });
  assert.equal(prepared.resolvedUrl, "https://uc123.dl.dropboxusercontent.com/cd/0/get/Game-v1.zip");
  assert.equal(prepared.hostId, "dropbox");
  assert.equal(session.calls[0].method, "GET");
  assert.equal(new Headers(session.calls[0].headers).get("range"), "bytes=0-0", "probe, not a download");
});

test("a Dropbox share that answers with the file itself keeps the ?dl=1 URL", async () => {
  const session = createRoutedSession([
    [
      DIRECT,
      (url) =>
        createMockResponse({
          url,
          status: 206,
          headers: {
            "content-type": "application/zip",
            "content-range": "bytes 0-0/1000",
            "content-disposition": 'attachment; filename="Game-v1.zip"',
          },
          body: "P",
        }),
    ],
  ]);
  const prepared = await prepareMirrorDownload(session, SHARE, {
    sleep: noSleep,
    retry: { attempts: 1 },
  });
  assert.equal(prepared.resolvedUrl, DIRECT);
  assert.equal(prepared.fileName, "Game-v1.zip");
});

test("an unexpected Dropbox HTML page asks for the browser instead of failing later", async () => {
  const session = createRoutedSession([
    [
      DIRECT,
      (url) =>
        createMockResponse({
          url,
          body: "<html><head><title>Dropbox - Sign in</title></head><body>Sign in to continue</body></html>",
        }),
    ],
  ]);
  await assert.rejects(
    prepareMirrorDownload(session, SHARE, { sleep: noSleep, retry: { attempts: 1 } }),
    (/** @type {any} */ error) => error.code === "mirror_action_required" && error.actionUrl === SHARE,
  );
});
