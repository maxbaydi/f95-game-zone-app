const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");

const {
  base64UrlEncode,
  computeCtrIv,
  createMegaDecryptTransform,
  decryptMegaAttributes,
  deriveMegaFileKey,
  encryptMegaAttributes,
  encryptMegaNodeKey,
  interpretMegaTransferError,
  parseMegaUrl,
} = require("../src/main/f95/hosts/mega");
const {
  MirrorActionRequiredError,
  prepareF95DownloadUrl,
} = require("../src/main/f95/downloadSupport");
const { downloadToFile } = require("../src/main/f95/directDownload");
const {
  createChunkedStream,
  createMockResponse,
  createRoutedSession,
  noSleep,
} = require("./helpers/mockFetch");

const FILE_HANDLE = "AbCdEfGh";
const FOLDER_HANDLE = "FoLdEr12";

function createFileKey(seed) {
  return crypto.createHash("sha256").update(String(seed)).digest();
}

function encryptPayload(plaintext, fileKey) {
  const { aesKey, iv } = deriveMegaFileKey(fileKey);
  const cipher = crypto.createCipheriv("aes-128-ctr", aesKey, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function readApiCommand(options) {
  return JSON.parse(String(options.body || "[]"))[0];
}

async function collectTransform(transform, input) {
  const chunks = [];
  await new Promise((resolve, reject) => {
    Readable.from([input]).pipe(transform);
    transform.on("data", (chunk) => chunks.push(chunk));
    transform.on("end", resolve);
    transform.on("error", reject);
  });
  return Buffer.concat(chunks);
}

test("parseMegaUrl understands new, legacy, embed, folder and protected link shapes", () => {
  assert.deepEqual(parseMegaUrl(`https://mega.nz/file/${FILE_HANDLE}#KeyPart`), {
    kind: "file",
    handle: FILE_HANDLE,
    key: "KeyPart",
    targetHandle: "",
  });
  assert.deepEqual(parseMegaUrl(`https://mega.nz/#!${FILE_HANDLE}!KeyPart`), {
    kind: "file",
    handle: FILE_HANDLE,
    key: "KeyPart",
    targetHandle: "",
  });
  assert.equal(parseMegaUrl(`https://mega.co.nz/#!${FILE_HANDLE}!KeyPart`).kind, "file");
  assert.equal(parseMegaUrl(`https://mega.nz/embed/${FILE_HANDLE}#KeyPart`).kind, "file");
  assert.deepEqual(
    parseMegaUrl(`https://mega.nz/folder/${FOLDER_HANDLE}#FolderKey/file/NoDe1234`),
    { kind: "folder", handle: FOLDER_HANDLE, key: "FolderKey", targetHandle: "NoDe1234" },
  );
  assert.deepEqual(parseMegaUrl(`https://mega.nz/#F!${FOLDER_HANDLE}!FolderKey`), {
    kind: "folder",
    handle: FOLDER_HANDLE,
    key: "FolderKey",
    targetHandle: "",
  });
  assert.equal(parseMegaUrl("https://mega.nz/#P!AgBbCc").kind, "protected");
  assert.equal(parseMegaUrl("https://example.com/file/abc#key"), null);
});

test("deriveMegaFileKey XORs the key halves and builds the CTR nonce", () => {
  const fileKey = Buffer.alloc(32);
  for (let index = 0; index < 32; index += 1) {
    fileKey[index] = index;
  }

  const { aesKey, iv, metaMac } = deriveMegaFileKey(fileKey);
  for (let index = 0; index < 16; index += 1) {
    assert.equal(aesKey[index], fileKey[index] ^ fileKey[index + 16]);
  }
  assert.deepEqual([...iv.subarray(0, 8)], [...fileKey.subarray(16, 24)]);
  assert.deepEqual([...iv.subarray(8)], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...metaMac], [...fileKey.subarray(24, 32)]);
});

test("decryptMegaAttributes round-trips MEGA{...} attribute blobs and rejects wrong keys", () => {
  const { aesKey } = deriveMegaFileKey(createFileKey("attributes"));
  const encrypted = encryptMegaAttributes({ n: "Game v1.0.zip", c: "x" }, aesKey);

  assert.deepEqual(decryptMegaAttributes(encrypted, aesKey), {
    n: "Game v1.0.zip",
    c: "x",
  });

  const { aesKey: wrongKey } = deriveMegaFileKey(createFileKey("other"));
  assert.throws(() => decryptMegaAttributes(encrypted, wrongKey), /key/i);
});

test("createMegaDecryptTransform decrypts from arbitrary byte offsets", async () => {
  const fileKey = createFileKey("ctr");
  const { aesKey, iv } = deriveMegaFileKey(fileKey);
  const plaintext = crypto.randomBytes(1000);
  const ciphertext = encryptPayload(plaintext, fileKey);

  for (const offset of [0, 1, 15, 16, 17, 500, 999]) {
    const decrypted = await collectTransform(
      createMegaDecryptTransform({
        keyHex: aesKey.toString("hex"),
        ivHex: iv.toString("hex"),
        offset,
      }),
      ciphertext.subarray(offset),
    );
    assert.deepEqual(decrypted, plaintext.subarray(offset), `offset ${offset}`);
  }
});

test("computeCtrIv carries the block counter across byte boundaries", () => {
  const iv = Buffer.from("0000000000000000000000000000ffff", "hex");
  assert.equal(computeCtrIv(iv, 16).toString("hex"), "00000000000000000000000000010000");
  assert.equal(computeCtrIv(iv, 15).toString("hex"), "0000000000000000000000000000ffff");
});

test("prepareF95DownloadUrl resolves a MEGA file link through the public API", async () => {
  const fileKey = createFileKey("file-link");
  const { aesKey, iv } = deriveMegaFileKey(fileKey);
  const session = createRoutedSession([
    [
      /^https:\/\/g\.api\.mega\.co\.nz\/cs\?id=\d+$/,
      (url, options) => {
        assert.deepEqual(readApiCommand(options), {
          a: "g",
          g: 1,
          ssl: 1,
          p: FILE_HANDLE,
        });
        return createMockResponse({
          json: [
            {
              s: 4096,
              at: encryptMegaAttributes({ n: "Summer Game v2.zip" }, aesKey),
              g: "https://gfs270n001.userstorage.mega.co.nz/dl/token123",
            },
          ],
        });
      },
    ],
  ]);

  const prepared = await prepareF95DownloadUrl(
    session,
    `https://mega.nz/file/${FILE_HANDLE}#${base64UrlEncode(fileKey)}`,
  );

  assert.equal(prepared.hostId, "mega");
  assert.equal(prepared.hostLabel, "MEGA");
  assert.equal(prepared.transfer, "mega");
  assert.equal(prepared.rangeMode, "mega-path");
  assert.equal(prepared.resolvedUrl, "https://gfs270n001.userstorage.mega.co.nz/dl/token123");
  assert.equal(prepared.fileName, "Summer Game v2.zip");
  assert.equal(prepared.size, 4096);
  assert.equal(prepared.mirrorHost, "mega.nz");
  assert.deepEqual(prepared.mega, {
    keyHex: aesKey.toString("hex"),
    ivHex: iv.toString("hex"),
  });
});

test("prepareF95DownloadUrl resolves MEGA links hidden behind masked F95 links", async () => {
  const fileKey = createFileKey("masked");
  const { aesKey } = deriveMegaFileKey(fileKey);
  const session = createRoutedSession([
    [
      "https://f95zone.to/masked/mega.nz/2/123/abc",
      () =>
        createMockResponse({
          json: {
            status: "ok",
            msg: `https://mega.nz/#!${FILE_HANDLE}!${base64UrlEncode(fileKey)}`,
          },
        }),
    ],
    [
      /g\.api\.mega\.co\.nz/,
      () =>
        createMockResponse({
          json: [
            {
              s: 10,
              at: encryptMegaAttributes({ n: "a.zip" }, aesKey),
              g: "https://gfs1.userstorage.mega.co.nz/dl/a",
            },
          ],
        }),
    ],
  ]);

  const prepared = await prepareF95DownloadUrl(
    session,
    "https://f95zone.to/masked/mega.nz/2/123/abc",
  );
  assert.equal(prepared.fileName, "a.zip");
  assert.equal(prepared.hostLabel, "MEGA");
});

test("prepareF95DownloadUrl picks the largest archive from a MEGA folder link", async () => {
  const folderKey = createFileKey("folder").subarray(0, 16);
  const readmeKey = createFileKey("readme");
  const gameKey = createFileKey("game");
  const rootNodeKey = createFileKey("root").subarray(0, 16);
  const nodes = [
    {
      h: "root0001",
      p: "",
      t: 1,
      a: encryptMegaAttributes({ n: "Release" }, rootNodeKey),
      k: `root0001:${encryptMegaNodeKey(rootNodeKey, folderKey)}`,
    },
    {
      h: "file0001",
      p: "root0001",
      t: 0,
      s: 900000,
      a: encryptMegaAttributes({ n: "readme.txt" }, deriveMegaFileKey(readmeKey).aesKey),
      k: `root0001:${encryptMegaNodeKey(readmeKey, folderKey)}`,
    },
    {
      h: "file0002",
      p: "root0001",
      t: 0,
      s: 5000,
      a: encryptMegaAttributes({ n: "Game-1.0-pc.zip" }, deriveMegaFileKey(gameKey).aesKey),
      k: `root0001:${encryptMegaNodeKey(gameKey, folderKey)}`,
    },
  ];

  const session = createRoutedSession([
    [
      (url, options) =>
        url.includes(`&n=${FOLDER_HANDLE}`) && readApiCommand(options).a === "f",
      () => createMockResponse({ json: [{ f: nodes }] }),
    ],
    [
      (url, options) =>
        url.includes(`&n=${FOLDER_HANDLE}`) && readApiCommand(options).a === "g",
      (url, options) => {
        assert.equal(readApiCommand(options).n, "file0002");
        return createMockResponse({
          json: [{ s: 5000, g: "https://gfs2.userstorage.mega.co.nz/dl/game" }],
        });
      },
    ],
  ]);

  const prepared = await prepareF95DownloadUrl(
    session,
    `https://mega.nz/folder/${FOLDER_HANDLE}#${base64UrlEncode(folderKey)}`,
  );

  assert.equal(prepared.fileName, "Game-1.0-pc.zip");
  assert.equal(prepared.size, 5000);
  assert.equal(prepared.mega.keyHex, deriveMegaFileKey(gameKey).aesKey.toString("hex"));
});

test("MEGA folder links honour an explicit /file/{node} target", async () => {
  const folderKey = createFileKey("folder-target").subarray(0, 16);
  const firstKey = createFileKey("first");
  const secondKey = createFileKey("second");
  const nodes = [
    {
      h: "file0001",
      p: "root0001",
      t: 0,
      s: 10,
      a: encryptMegaAttributes({ n: "Game-mac.zip" }, deriveMegaFileKey(firstKey).aesKey),
      k: `root0001:${encryptMegaNodeKey(firstKey, folderKey)}`,
    },
    {
      h: "file0002",
      p: "root0001",
      t: 0,
      s: 99999,
      a: encryptMegaAttributes({ n: "Game-pc.zip" }, deriveMegaFileKey(secondKey).aesKey),
      k: `root0001:${encryptMegaNodeKey(secondKey, folderKey)}`,
    },
  ];
  const session = createRoutedSession([
    [
      (url, options) => readApiCommand(options).a === "f",
      () => createMockResponse({ json: [{ f: nodes }] }),
    ],
    [
      (url, options) => readApiCommand(options).a === "g",
      (url, options) => {
        assert.equal(readApiCommand(options).n, "file0001");
        return createMockResponse({
          json: [{ s: 10, g: "https://gfs3.userstorage.mega.co.nz/dl/mac" }],
        });
      },
    ],
  ]);

  const prepared = await prepareF95DownloadUrl(
    session,
    `https://mega.nz/folder/${FOLDER_HANDLE}#${base64UrlEncode(folderKey)}/file/file0001`,
  );
  assert.equal(prepared.fileName, "Game-mac.zip");
});

test("MEGA API error codes become clear, typed errors", async () => {
  const fileKey = base64UrlEncode(createFileKey("errors"));
  const scenarios = [
    { payload: [-9], code: "not_found", pattern: /no longer exists/ },
    { payload: [-16], code: "blocked", pattern: /taken down/ },
    { payload: [-11], code: "access_denied", pattern: /denied/ },
    { payload: [-17], code: "bandwidth_exceeded", pattern: /quota/ },
  ];

  for (const scenario of scenarios) {
    const session = createRoutedSession([
      [/g\.api\.mega\.co\.nz/, () => createMockResponse({ json: scenario.payload })],
    ]);
    await assert.rejects(
      () =>
        prepareF95DownloadUrl(session, `https://mega.nz/file/${FILE_HANDLE}#${fileKey}`, {
          sleep: noSleep,
        }),
      (/** @type {any} */ error) => {
        assert.equal(error.code, scenario.code);
        assert.match(error.userMessage, scenario.pattern);
        return true;
      },
    );
  }
});

test("MEGA EAGAIN (-3) responses are retried with backoff", async () => {
  const fileKey = createFileKey("eagain");
  const { aesKey } = deriveMegaFileKey(fileKey);
  const session = createRoutedSession([
    [
      /g\.api\.mega\.co\.nz/,
      (url, options, count) =>
        count === 1
          ? createMockResponse({ json: -3 })
          : createMockResponse({
              json: [
                {
                  s: 1,
                  at: encryptMegaAttributes({ n: "x.zip" }, aesKey),
                  g: "https://gfs.userstorage.mega.co.nz/dl/x",
                },
              ],
            }),
    ],
  ]);

  const statuses = [];
  const prepared = await prepareF95DownloadUrl(
    session,
    `https://mega.nz/file/${FILE_HANDLE}#${base64UrlEncode(fileKey)}`,
    { sleep: noSleep, onStatus: (text) => statuses.push(text) },
  );

  assert.equal(prepared.fileName, "x.zip");
  assert.equal(session.calls.length, 2);
  assert.ok(statuses.some((text) => /Retrying/.test(text)));
});

test("MEGA password-protected links require the browser", async () => {
  await assert.rejects(
    () =>
      prepareF95DownloadUrl(
        createRoutedSession([]),
        "https://mega.nz/#P!AgBbCcDdEeFf",
      ),
    (/** @type {any} */ error) => error instanceof MirrorActionRequiredError,
  );
});

test("interpretMegaTransferError maps HTTP 509 to the transfer-quota message", () => {
  const error = interpretMegaTransferError({ status: 509 });
  assert.equal(error.code, "bandwidth_exceeded");
  assert.match(error.message, /quota/i);
  assert.equal(interpretMegaTransferError({ status: 500 }), null);
});

test("downloadToFile resumes a MEGA transfer with path ranges and decrypts the payload", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "f95-mega-transfer-"));
  const fileKey = createFileKey("transfer");
  const { aesKey, iv } = deriveMegaFileKey(fileKey);
  const plaintext = crypto.randomBytes(3000);
  const ciphertext = encryptPayload(plaintext, fileKey);
  const baseUrl = "https://gfs9.userstorage.mega.co.nz/dl/token";
  const requests = [];

  try {
    const result = await downloadToFile({
      url: baseUrl,
      expectedSize: plaintext.length,
      rangeMode: "mega-path",
      resolveTargetPath: (fileName) => path.join(tempDir, fileName),
      fileNameHint: "game.zip",
      createTransform: (offset) =>
        createMegaDecryptTransform({
          keyHex: aesKey.toString("hex"),
          ivHex: iv.toString("hex"),
          offset,
        }),
      sleep: noSleep,
      checkDiskSpace: async () => {},
      fetchImpl: async (url) => {
        requests.push(url);
        if (url === baseUrl) {
          return createMockResponse({
            url,
            headers: {
              "content-type": "application/octet-stream",
              "content-length": String(ciphertext.length),
            },
            body: createChunkedStream([ciphertext.subarray(0, 1000)], {
              error: new TypeError("fetch failed"),
            }),
          });
        }
        const match = url.match(/\/(\d+)-(\d+)$/);
        assert.ok(match, `expected a MEGA range URL, got ${url}`);
        const start = Number(match[1]);
        const end = Number(match[2]);
        return createMockResponse({
          url,
          headers: { "content-type": "application/octet-stream" },
          body: createChunkedStream([ciphertext.subarray(start, end + 1)]),
        });
      },
    });

    assert.equal(requests[0], baseUrl);
    assert.match(requests[1], /\/1000-2999$/);
    assert.deepEqual(fs.readFileSync(result.targetPath), plaintext);
    assert.equal(result.receivedBytes, plaintext.length);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
