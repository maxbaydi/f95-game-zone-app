const test = require("node:test");
const assert = require("node:assert/strict");
const { Transform } = require("stream");

const {
  buildDirectTransferHeaders,
  buildDirectTransferOptions,
  sanitizeDownloadFileName,
} = require("../src/main/f95/transferOptions");
const { DIRECT_DOWNLOAD_USER_AGENT } = require("../src/main/f95/directDownload");
const { MirrorActionRequiredError } = require("../src/main/f95/downloadSupport");

function preparedFixture(overrides = {}) {
  return {
    requestedUrl: "https://f95zone.to/masked/gofile.io/1/2/abc",
    resolvedUrl: "https://store1.gofile.io/download/web/abc/game.zip",
    sourceHost: "store1.gofile.io",
    mirrorHost: "gofile.io",
    hostId: "gofile",
    hostLabel: "Gofile",
    transfer: "direct",
    rangeMode: "header",
    headers: { cookie: "accountToken=abc" },
    fileName: "game.zip",
    size: 1234,
    mega: null,
    ...overrides,
  };
}

test("buildDirectTransferHeaders adds the browser identity and keeps resolver headers", () => {
  const headers = buildDirectTransferHeaders(preparedFixture());
  assert.equal(headers.accept, "*/*");
  assert.equal(headers["user-agent"], DIRECT_DOWNLOAD_USER_AGENT);
  assert.equal(headers.cookie, "accountToken=abc");
});

test("buildDirectTransferHeaders lets the resolver override the defaults", () => {
  const headers = buildDirectTransferHeaders(
    preparedFixture({ headers: { "user-agent": "custom/1.0", accept: "application/zip" } }),
  );
  assert.equal(headers["user-agent"], "custom/1.0");
  assert.equal(headers.accept, "application/zip");
});

test("buildDirectTransferHeaders tolerates a prepared download without headers", () => {
  const headers = buildDirectTransferHeaders(preparedFixture({ headers: undefined }));
  assert.deepEqual(Object.keys(headers).sort(), ["accept", "user-agent"]);
});

test("buildDirectTransferOptions mirrors every field the app hands to downloadToFile", () => {
  const fetchImpl = async () => new Response("x");
  const signal = new AbortController().signal;
  const resolveTargetPath = (fileName) => `C:/downloads/${fileName}`;
  const onTarget = () => {};
  const onProgress = () => {};
  const onRetry = () => {};

  const options = buildDirectTransferOptions({
    prepared: preparedFixture(),
    fetchImpl,
    signal,
    hostLabel: "Gofile",
    fallbackFileName: "My Game.bin",
    resolveTargetPath,
    onTarget,
    onProgress,
    onRetry,
  });

  assert.equal(options.fetchImpl, fetchImpl);
  assert.equal(options.url, "https://store1.gofile.io/download/web/abc/game.zip");
  assert.equal(options.signal, signal);
  assert.equal(options.hostLabel, "Gofile");
  assert.equal(options.fileNameHint, "game.zip");
  assert.equal(options.expectedSize, 1234);
  assert.equal(options.fallbackFileName, "My Game.bin");
  assert.equal(options.rangeMode, "header");
  assert.equal(options.createTransform, null);
  assert.equal(typeof options.interpretErrorResponse, "function");
  assert.equal(options.resolveTargetPath, resolveTargetPath);
  assert.equal(options.onTarget, onTarget);
  assert.equal(options.onProgress, onProgress);
  assert.equal(options.onRetry, onRetry);
  assert.equal(options.headers.cookie, "accountToken=abc");
  assert.equal(options.headers["user-agent"], DIRECT_DOWNLOAD_USER_AGENT);
});

test("buildDirectTransferOptions falls back to sane defaults for sparse prepared downloads", () => {
  const options = buildDirectTransferOptions({
    prepared: preparedFixture({
      fileName: "",
      size: 0,
      rangeMode: "",
      headers: {},
    }),
    fetchImpl: async () => new Response("x"),
    resolveTargetPath: (fileName) => fileName,
  });

  assert.equal(options.fileNameHint, "");
  assert.equal(options.expectedSize, 0);
  assert.equal(options.rangeMode, "header");
  assert.equal(options.signal, null);
  assert.equal(options.fallbackFileName, "download.bin");
  assert.equal(options.hostLabel, "Gofile");
});

test("buildDirectTransferOptions wires the MEGA decrypt transform per resume offset", () => {
  const prepared = preparedFixture({
    hostId: "mega",
    hostLabel: "MEGA",
    transfer: "mega",
    rangeMode: "mega-path",
    mega: {
      keyHex: "000102030405060708090a0b0c0d0e0f",
      ivHex: "0f0e0d0c0b0a09080706050403020100",
    },
  });
  const options = buildDirectTransferOptions({
    prepared,
    fetchImpl: async () => new Response("x"),
    resolveTargetPath: (fileName) => fileName,
  });

  assert.equal(options.rangeMode, "mega-path");
  assert.equal(typeof options.createTransform, "function");
  assert.ok(options.createTransform(0) instanceof Transform);
  assert.ok(options.createTransform(4096) instanceof Transform);
});

test("buildDirectTransferOptions does not build a MEGA transform without key material", () => {
  const options = buildDirectTransferOptions({
    prepared: preparedFixture({ transfer: "mega", mega: null }),
    fetchImpl: async () => new Response("x"),
    resolveTargetPath: (fileName) => fileName,
  });
  assert.equal(options.createTransform, null);
});

test("interpretErrorResponse maps a captcha wall to an action-required error", () => {
  const options = buildDirectTransferOptions({
    prepared: preparedFixture(),
    fetchImpl: async () => new Response("x"),
    resolveTargetPath: (fileName) => fileName,
  });
  const error = options.interpretErrorResponse({
    status: 403,
    bodyText: '<html><div class="cf-turnstile"></div></html>',
    url: "https://store1.gofile.io/download/web/abc/game.zip",
  });
  assert.ok(error instanceof MirrorActionRequiredError);
  assert.equal(error.actionUrl, "https://f95zone.to/masked/gofile.io/1/2/abc");

  assert.equal(
    options.interpretErrorResponse({ status: 500, bodyText: "oops", url: "https://x" }),
    null,
  );
});

test("buildDirectTransferOptions passes through optional pipeline tunables", () => {
  const sleep = async () => {};
  const checkDiskSpace = async () => {};
  const options = buildDirectTransferOptions({
    prepared: preparedFixture(),
    fetchImpl: async () => new Response("x"),
    resolveTargetPath: (fileName) => fileName,
    sleep,
    checkDiskSpace,
    progressIntervalMs: 0,
    stallTimeoutMs: 5000,
    connectTimeoutMs: 6000,
    maxConsecutiveFailures: 2,
  });

  assert.equal(options.sleep, sleep);
  assert.equal(options.checkDiskSpace, checkDiskSpace);
  assert.equal(options.progressIntervalMs, 0);
  assert.equal(options.stallTimeoutMs, 5000);
  assert.equal(options.connectTimeoutMs, 6000);
  assert.equal(options.maxConsecutiveFailures, 2);
});

test("buildDirectTransferOptions leaves unspecified tunables to downloadToFile defaults", () => {
  const options = buildDirectTransferOptions({
    prepared: preparedFixture(),
    fetchImpl: async () => new Response("x"),
    resolveTargetPath: (fileName) => fileName,
  });
  for (const key of [
    "sleep",
    "checkDiskSpace",
    "progressIntervalMs",
    "stallTimeoutMs",
    "connectTimeoutMs",
    "maxConsecutiveFailures",
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(options, key), false, key);
  }
});

test("buildDirectTransferOptions rejects a prepared download without a URL", () => {
  assert.throws(
    () =>
      buildDirectTransferOptions({
        prepared: preparedFixture({ resolvedUrl: "" }),
        fetchImpl: async () => new Response("x"),
        resolveTargetPath: (fileName) => fileName,
      }),
    /resolvedUrl/,
  );
});

test("sanitizeDownloadFileName strips characters Windows cannot store", () => {
  assert.equal(sanitizeDownloadFileName('My: Game <v1>?.zip'), "My_ Game _v1__.zip");
  assert.equal(sanitizeDownloadFileName("  spaced   name.7z "), "spaced name.7z");
  assert.equal(sanitizeDownloadFileName("bad\u0001\u0002.zip"), "bad.zip");
  assert.equal(sanitizeDownloadFileName("", "fallback.bin"), "fallback.bin");
  assert.equal(sanitizeDownloadFileName("///", "fallback.bin"), "___");
});
