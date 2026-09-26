const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildTransferRequest,
  checkFreeDiskSpace,
  downloadToFile,
  parseContentRange,
  selectTransferMode,
} = require("../src/main/f95/directDownload");
const {
  DownloadCancelledError,
  MirrorActionRequiredError,
} = require("../src/main/f95/downloadSupport");
const {
  createChunkedStream,
  createMockResponse,
  noSleep,
} = require("./helpers/mockFetch");

const PAYLOAD = Buffer.from("PK\u0003\u0004-0123456789abcdefghijklmnopqrstuvwxyz");

function withTempDir(run) {
  return async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "f95-transfer-"));
    try {
      await run(tempDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function baseOptions(tempDir, overrides = {}) {
  return {
    url: "https://files.example.com/dl/game.zip",
    resolveTargetPath: (fileName) => path.join(tempDir, fileName),
    sleep: noSleep,
    checkDiskSpace: async () => {},
    progressIntervalMs: 0,
    ...overrides,
  };
}

function fileResponse(url, body, headers = {}) {
  return createMockResponse({
    url,
    headers: {
      "content-type": "application/zip",
      "content-length": String(PAYLOAD.length),
      "accept-ranges": "bytes",
      ...headers,
    },
    body,
  });
}

test("parseContentRange and buildTransferRequest describe resumed requests", () => {
  assert.deepEqual(parseContentRange("bytes 100-199/1000"), {
    start: 100,
    end: 199,
    total: 1000,
  });
  assert.deepEqual(parseContentRange("bytes 5-9/*"), { start: 5, end: 9, total: 0 });
  assert.equal(parseContentRange("garbage"), null);

  assert.deepEqual(buildTransferRequest("https://a/b", { x: "1" }, 0, "header", 10), {
    url: "https://a/b",
    headers: { x: "1" },
  });
  assert.deepEqual(buildTransferRequest("https://a/b", {}, 4, "header", 10), {
    url: "https://a/b",
    headers: { range: "bytes=4-" },
  });
  assert.deepEqual(buildTransferRequest("https://mega/dl/x", {}, 4, "mega-path", 10), {
    url: "https://mega/dl/x/4-9",
    headers: {},
  });
});

test("selectTransferMode streams everything directly unless a resolver opts out", () => {
  assert.equal(selectTransferMode({ transfer: "mega" }), "mega");
  assert.equal(
    selectTransferMode({ transfer: "session", resolvedUrl: "https://pixeldrain.com/api/file/x" }),
    "session",
  );
  assert.equal(
    selectTransferMode({
      transfer: "session",
      resolvedUrl: "https://drive.usercontent.google.com/download?id=1&export=download",
    }),
    "direct",
  );
  assert.equal(selectTransferMode({ transfer: "direct" }), "direct");
  assert.equal(selectTransferMode(null), "direct");
});

test(
  "downloadToFile writes the payload, reports progress and names the file from headers",
  withTempDir(async (tempDir) => {
    const progress = [];
    const targets = [];
    const result = await downloadToFile(
      baseOptions(tempDir, {
        url: "https://files.example.com/dl/abc",
        fetchImpl: async (url) =>
          fileResponse(url, createChunkedStream([PAYLOAD.subarray(0, 10), PAYLOAD.subarray(10)]), {
            "content-disposition": 'attachment; filename="My Game v1.zip"',
          }),
        onTarget: (info) => targets.push(info),
        onProgress: (info) => progress.push(info),
      }),
    );

    assert.equal(path.basename(result.targetPath), "My Game v1.zip");
    assert.deepEqual(fs.readFileSync(result.targetPath), PAYLOAD);
    assert.equal(result.totalBytes, PAYLOAD.length);
    assert.equal(fs.existsSync(`${result.targetPath}.part`), false);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].totalBytes, PAYLOAD.length);
    assert.equal(progress.at(-1).receivedBytes, PAYLOAD.length);
    assert.equal(progress.at(-1).percent, 100);
  }),
);

test(
  "downloadToFile resumes with an HTTP Range request after the connection drops",
  withTempDir(async (tempDir) => {
    const requests = [];
    const retries = [];
    const result = await downloadToFile(
      baseOptions(tempDir, {
        onRetry: (info) => retries.push(info),
        fetchImpl: async (url, init) => {
          requests.push({ ...init.headers });
          if (!init.headers.range) {
            return fileResponse(
              url,
              createChunkedStream([PAYLOAD.subarray(0, 12)], {
                error: new TypeError("fetch failed"),
              }),
            );
          }
          assert.equal(init.headers.range, "bytes=12-");
          return createMockResponse({
            url,
            status: 206,
            headers: {
              "content-type": "application/zip",
              "content-range": `bytes 12-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
            },
            body: createChunkedStream([PAYLOAD.subarray(12)]),
          });
        },
      }),
    );

    assert.equal(requests.length, 2);
    assert.equal(retries.length, 1);
    assert.equal(retries[0].resumeFrom, 12);
    assert.deepEqual(fs.readFileSync(result.targetPath), PAYLOAD);
  }),
);

test(
  "downloadToFile restarts from zero when the server ignores the Range header",
  withTempDir(async (tempDir) => {
    let calls = 0;
    const result = await downloadToFile(
      baseOptions(tempDir, {
        fetchImpl: async (url) => {
          calls += 1;
          if (calls === 1) {
            return fileResponse(
              url,
              createChunkedStream([PAYLOAD.subarray(0, 20)], {
                error: new TypeError("fetch failed"),
              }),
            );
          }
          return fileResponse(url, createChunkedStream([PAYLOAD]));
        },
      }),
    );

    assert.equal(calls, 2);
    assert.deepEqual(fs.readFileSync(result.targetPath), PAYLOAD);
  }),
);

test(
  "downloadToFile retries 503 responses honouring Retry-After",
  withTempDir(async (tempDir) => {
    const delays = [];
    let calls = 0;
    const result = await downloadToFile(
      baseOptions(tempDir, {
        sleep: async (ms) => {
          delays.push(ms);
        },
        fetchImpl: async (url) => {
          calls += 1;
          if (calls === 1) {
            return createMockResponse({
              url,
              status: 503,
              headers: { "retry-after": "3" },
              body: "busy",
            });
          }
          return fileResponse(url, createChunkedStream([PAYLOAD]));
        },
      }),
    );

    assert.deepEqual(delays, [3000]);
    assert.deepEqual(fs.readFileSync(result.targetPath), PAYLOAD);
  }),
);

test(
  "downloadToFile fails fast with a friendly error on 404",
  withTempDir(async (tempDir) => {
    let calls = 0;
    await assert.rejects(
      () =>
        downloadToFile(
          baseOptions(tempDir, {
            hostLabel: "Pixeldrain",
            fetchImpl: async (url) => {
              calls += 1;
              return createMockResponse({ url, status: 404, body: "gone" });
            },
          }),
        ),
      (error) => {
        assert.equal(error.code, "not_found");
        assert.match(error.message, /Pixeldrain says the file does not exist/);
        return true;
      },
    );
    assert.equal(calls, 1);
  }),
);

test(
  "downloadToFile maps 429 and 509 to rate-limit / bandwidth errors",
  withTempDir(async (tempDir) => {
    await assert.rejects(
      () =>
        downloadToFile(
          baseOptions(tempDir, {
            maxConsecutiveFailures: 2,
            fetchImpl: async (url) => createMockResponse({ url, status: 429, body: "slow down" }),
          }),
        ),
      (error) => error.code === "rate_limited",
    );
    await assert.rejects(
      () =>
        downloadToFile(
          baseOptions(tempDir, {
            fetchImpl: async (url) => createMockResponse({ url, status: 509, body: "limit" }),
          }),
        ),
      (error) => error.code === "bandwidth_exceeded",
    );
  }),
);

test(
  "downloadToFile lets hosts turn HTTP errors into browser actions",
  withTempDir(async (tempDir) => {
    await assert.rejects(
      () =>
        downloadToFile(
          baseOptions(tempDir, {
            fetchImpl: async (url) =>
              createMockResponse({
                url,
                status: 403,
                json: { success: false, value: "file_rate_limited_captcha_required" },
              }),
            interpretErrorResponse: ({ status, bodyText }) =>
              status === 403 && /captcha/.test(bodyText)
                ? new MirrorActionRequiredError("captcha", {
                    code: "captcha_required",
                    actionUrl: "https://pixeldrain.com/u/x",
                  })
                : null,
          }),
        ),
      (error) =>
        error instanceof MirrorActionRequiredError &&
        error.actionUrl === "https://pixeldrain.com/u/x",
    );
  }),
);

test(
  "downloadToFile detects HTML pages served instead of the file and removes the partial file",
  withTempDir(async (tempDir) => {
    await assert.rejects(
      () =>
        downloadToFile(
          baseOptions(tempDir, {
            fetchImpl: async (url) =>
              createMockResponse({
                url,
                headers: { "content-type": "text/html" },
                body: `<!DOCTYPE html><html><head><title>Download</title></head><body>${"x".repeat(600)}</body></html>`,
              }),
          }),
        ),
      (error) => error.code === "html_payload",
    );
    assert.deepEqual(fs.readdirSync(tempDir), []);
  }),
);

test(
  "downloadToFile treats JSON error bodies as a non-file payload",
  withTempDir(async (tempDir) => {
    await assert.rejects(
      () =>
        downloadToFile(
          baseOptions(tempDir, {
            fetchImpl: async (url) =>
              createMockResponse({ url, json: { error: "link expired" } }),
          }),
        ),
      (error) => error.code === "html_payload" && /link expired/.test(error.message),
    );
  }),
);

test(
  "downloadToFile aborts stalled transfers and resumes them",
  withTempDir(async (tempDir) => {
    let calls = 0;
    let cancelled = false;
    const result = await downloadToFile(
      baseOptions(tempDir, {
        stallTimeoutMs: 40,
        fetchImpl: async (url, init) => {
          calls += 1;
          if (calls === 1) {
            return fileResponse(
              url,
              createChunkedStream([PAYLOAD.subarray(0, 30)], {
                hang: true,
                onCancel: () => {
                  cancelled = true;
                },
              }),
            );
          }
          assert.equal(init.headers.range, "bytes=30-");
          return createMockResponse({
            url,
            status: 206,
            headers: {
              "content-type": "application/zip",
              "content-range": `bytes 30-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
            },
            body: createChunkedStream([PAYLOAD.subarray(30)]),
          });
        },
      }),
    );

    assert.equal(cancelled, true);
    assert.equal(calls, 2);
    assert.deepEqual(fs.readFileSync(result.targetPath), PAYLOAD);
  }),
);

test(
  "downloadToFile stops with a cancellation error and cleans up when aborted",
  withTempDir(async (tempDir) => {
    const controller = new AbortController();
    const promise = downloadToFile(
      baseOptions(tempDir, {
        signal: controller.signal,
        fetchImpl: async (url) =>
          fileResponse(url, createChunkedStream([PAYLOAD.subarray(0, 40)], { hang: true })),
        onProgress: () => {
          setTimeout(() => controller.abort(), 5);
        },
      }),
    );

    await assert.rejects(() => promise, (error) => error instanceof DownloadCancelledError);
    assert.deepEqual(fs.readdirSync(tempDir), []);
  }),
);

test(
  "downloadToFile checks free disk space before streaming",
  withTempDir(async (tempDir) => {
    const checks = [];
    await assert.rejects(
      () =>
        downloadToFile(
          baseOptions(tempDir, {
            fetchImpl: async (url) => fileResponse(url, createChunkedStream([PAYLOAD])),
            checkDiskSpace: async (directory, requiredBytes) => {
              checks.push({ directory, requiredBytes });
              const error = new Error("no space");
              // @ts-ignore test double
              error.code = "disk_full";
              throw error;
            },
          }),
        ),
      (error) => error.code === "disk_full",
    );
    assert.deepEqual(checks, [{ directory: tempDir, requiredBytes: PAYLOAD.length }]);
  }),
);

test("checkFreeDiskSpace rejects impossible sizes and accepts small ones", async () => {
  await checkFreeDiskSpace(os.tmpdir(), 1024);
  if (typeof fs.promises.statfs === "function") {
    await assert.rejects(
      () => checkFreeDiskSpace(os.tmpdir(), Number.MAX_SAFE_INTEGER),
      (error) => error.code === "disk_full" && /Not enough free disk space/.test(error.message),
    );
  }
});

test(
  "downloadToFile gives up after repeated network failures without progress",
  withTempDir(async (tempDir) => {
    let calls = 0;
    await assert.rejects(
      () =>
        downloadToFile(
          baseOptions(tempDir, {
            maxConsecutiveFailures: 3,
            fetchImpl: async () => {
              calls += 1;
              throw new TypeError("fetch failed");
            },
          }),
        ),
      (error) => error.code === "network" && /Lost the connection/.test(error.message),
    );
    assert.equal(calls, 3);
  }),
);
