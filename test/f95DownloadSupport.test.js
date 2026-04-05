const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  DownloadValidationError,
  MirrorActionRequiredError,
  extractHtmlDownloadCandidates,
  extractGofileContentId,
  extractGoogleDriveConfirmUrl,
  extractGoogleDriveDirectUrlFromHtml,
  extractGoogleDriveFileId,
  generateGofileWebsiteToken,
  inspectDownloadedPackage,
  parseCountdownLandingConfig,
  parseF95ThreadTitle,
  prepareF95DownloadUrl,
  resolveCountdownLandingDownloadUrl,
  resolveGofileUrl,
  resolveGoogleDriveUrl,
  resolveHtmlLandingDownloadUrl,
  resolveKnownFileHostUrl,
} = require("../src/main/f95/downloadSupport");

test("resolveKnownFileHostUrl rewrites Pixeldrain viewer links to direct download API", () => {
  const resolvedUrl = resolveKnownFileHostUrl(
    "https://pixeldrain.com/u/AbCd1234",
  );

  assert.equal(
    resolvedUrl,
    "https://pixeldrain.com/api/file/AbCd1234?download=",
  );
});

test("parseF95ThreadTitle removes engine/category badges from the title", () => {
  const metadata = parseF95ThreadTitle(
    "VN Ren'Py Stained Blood [v0.2] [Obsidian Desire Labs]",
  );

  assert.equal(metadata.title, "Stained Blood");
  assert.equal(metadata.version, "v0.2");
  assert.equal(metadata.creator, "Obsidian Desire Labs");
});

test("parseF95ThreadTitle preserves normal titles when there are no F95 badges", () => {
  const metadata = parseF95ThreadTitle("Stained Blood [v0.2]");

  assert.equal(metadata.title, "Stained Blood");
  assert.equal(metadata.version, "v0.2");
  assert.equal(metadata.creator, "");
});

test("parseF95ThreadTitle removes trailing F95zone suffix from browser titles", () => {
  const metadata = parseF95ThreadTitle(
    "VN Ren'Py Stained Blood [v0.2] [Obsidian Desire Labs] | F95zone",
  );

  assert.equal(metadata.title, "Stained Blood");
  assert.equal(metadata.version, "v0.2");
  assert.equal(metadata.creator, "Obsidian Desire Labs");
});

test("inspectDownloadedPackage rejects masked F95 HTML pages", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "atlas-f95-download-support-"),
  );
  const filePath = path.join(tempDir, "masked-page.bin");

  try {
    fs.writeFileSync(
      filePath,
      [
        "<!doctype html>",
        "<html>",
        "<head><title>Link Masked | F95zone</title></head>",
        "<body>You're leaving F95zone</body>",
        "</html>",
      ].join(""),
      "utf8",
    );

    await assert.rejects(
      () =>
        inspectDownloadedPackage({
          filePath,
          mimeType: "text/html",
          archiveExtensions: ["zip", "7z", "rar"],
          gameExtensions: ["exe", "html"],
        }),
      (error) => {
        const typedError = /** @type {DownloadValidationError} */ (error);
        assert.equal(typedError instanceof DownloadValidationError, true);
        assert.equal(typedError.code, "html_payload");
        return true;
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inspectDownloadedPackage accepts zip archives even when the filename has no extension", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "atlas-f95-download-support-"),
  );
  const filePath = path.join(tempDir, "payload");

  try {
    fs.writeFileSync(
      filePath,
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
    );

    const payloadInfo = await inspectDownloadedPackage({
      filePath,
      mimeType: "application/octet-stream",
      archiveExtensions: ["zip", "7z", "rar"],
      gameExtensions: ["exe"],
    });

    assert.equal(payloadInfo.installKind, "archive");
    assert.equal(payloadInfo.archiveType, "zip");
    assert.equal(payloadInfo.normalizedExtension, "zip");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("extractHtmlDownloadCandidates finds generic download affordances on host landing pages", () => {
  const html = `
    <html>
      <body>
        <a href="/pricing">Pricing</a>
        <a class="link-button" hx-get="/abc123/download">Download</a>
        <a href="https://www.torproject.org/download/">Download Tor Browser</a>
        <a href="/abc123/preview">Preview</a>
      </body>
    </html>
  `;

  const candidates = extractHtmlDownloadCandidates(
    "https://buzzheavier.com/abc123",
    html,
  );

  assert.equal(candidates.length > 0, true);
  assert.equal(candidates[0].url, "https://buzzheavier.com/abc123/download");
  assert.equal(
    candidates.some((candidate) => candidate.url.includes("torproject.org")),
    false,
  );
});

test("resolveHtmlLandingDownloadUrl follows a generic host landing page to its final download endpoint", async () => {
  const createMockResponse = ({
    url,
    contentType,
    contentDisposition = "",
    text = "",
  }) => ({
    ok: true,
    url,
    headers: {
      get(name) {
        const normalized = String(name || "").toLowerCase();
        if (normalized === "content-type") {
          return contentType;
        }

        if (normalized === "content-disposition") {
          return contentDisposition;
        }

        return "";
      },
    },
    async text() {
      return text;
    },
    body: {
      async cancel() {
        return undefined;
      },
    },
  });

  const session = {
    fetch: async (url) => {
      if (url === "https://buzzheavier.com/abc123") {
        return createMockResponse({
          url: "https://buzzheavier.com/abc123",
          contentType: "text/html; charset=utf-8",
          text: `
            <html>
              <body>
                <a class="link-button" hx-get="/abc123/download">Download</a>
              </body>
            </html>
          `,
        });
      }

      if (url === "https://buzzheavier.com/abc123/download") {
        return createMockResponse({
          url: "https://buzzheavier.com/abc123/download",
          contentType: "application/octet-stream",
          contentDisposition: 'attachment; filename="payload.zip"',
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  };

  const resolvedUrl = await resolveHtmlLandingDownloadUrl(
    session,
    "https://buzzheavier.com/abc123",
  );

  assert.equal(resolvedUrl, "https://buzzheavier.com/abc123/download");
});

test("parseCountdownLandingConfig extracts host countdown handshake data from landing pages", () => {
  const html = `
    <html>
      <body>
        <file-actions
          link="https://datanodes.to/j81v3byeltwi/Cricket_2022_4_Files_Fix.zip"
          code="j81v3byeltwi"
          token="2b43975f5ce37b0bee866f84524cfd82"></file-actions>
        <download-countdown
          :countdown="5"
          code="j81v3byeltwi"
          referer="https://datanodes.to/j81v3byeltwi"
          rand=""
          free-method=""
          premium-method=""
          :has-password="false"
          :has-captcha="false"
          :has-countdown="true"></download-countdown>
      </body>
    </html>
  `;

  const config = parseCountdownLandingConfig(
    html,
    "https://datanodes.to/j81v3byeltwi",
  );

  assert.deepEqual(config, {
    code: "j81v3byeltwi",
    referer: "https://datanodes.to/j81v3byeltwi",
    rand: "",
    freeMethod: "",
    premiumMethod: "",
    countdown: 5,
    hasCaptcha: false,
    hasPassword: false,
    hasCountdown: true,
    fileLink: "https://datanodes.to/j81v3byeltwi/Cricket_2022_4_Files_Fix.zip",
    fileToken: "2b43975f5ce37b0bee866f84524cfd82",
  });
});

test("resolveCountdownLandingDownloadUrl follows countdown hosts to their final cross-host payload URL", async () => {
  const createMockResponse = ({
    url,
    contentType,
    contentDisposition = "",
    text = "",
    json = null,
  }) => ({
    ok: true,
    url,
    headers: {
      get(name) {
        const normalized = String(name || "").toLowerCase();
        if (normalized === "content-type") {
          return contentType;
        }

        if (normalized === "content-disposition") {
          return contentDisposition;
        }

        return "";
      },
    },
    async text() {
      return text;
    },
    async json() {
      return json;
    },
    body: {
      async cancel() {
        return undefined;
      },
    },
  });

  const calls = [];
  const session = {
    async fetch(url, options = {}) {
      calls.push({
        url,
        method: options.method || "GET",
      });

      if (url === "https://datanodes.to/j81v3byeltwi") {
        if ((options.method || "GET") === "GET") {
          return createMockResponse({
            url,
            contentType: "text/html; charset=utf-8",
            text: `
              <html>
                <body>
                  <file-actions
                    link="https://datanodes.to/j81v3byeltwi/Cricket_2022_4_Files_Fix.zip"
                    code="j81v3byeltwi"
                    token="2b43975f5ce37b0bee866f84524cfd82"></file-actions>
                  <download-countdown
                    :countdown="5"
                    code="j81v3byeltwi"
                    referer="https://datanodes.to/j81v3byeltwi"
                    rand=""
                    free-method=""
                    premium-method=""
                    :has-password="false"
                    :has-captcha="false"
                    :has-countdown="true"></download-countdown>
                </body>
              </html>
            `,
          });
        }

        return createMockResponse({
          url,
          contentType: "application/json",
          json: {
            url: encodeURIComponent(
              "https://tunnel1.dlproxy.uk/download/example.zip?sig=abc123",
            ),
          },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  };

  const resolvedUrl = await resolveCountdownLandingDownloadUrl(
    session,
    "https://datanodes.to/j81v3byeltwi",
  );

  assert.equal(
    resolvedUrl,
    "https://tunnel1.dlproxy.uk/download/example.zip?sig=abc123",
  );
  assert.deepEqual(calls, [
    { url: "https://datanodes.to/j81v3byeltwi", method: "GET" },
    { url: "https://datanodes.to/j81v3byeltwi", method: "POST" },
  ]);
});

test("extractGofileContentId understands common public gofile URL shapes", () => {
  assert.equal(extractGofileContentId("https://gofile.io/d/MovsLG"), "MovsLG");
  assert.equal(
    extractGofileContentId("https://gofile.io/download/web/MovsLG/example.zip"),
    "MovsLG",
  );
  assert.equal(
    extractGofileContentId("https://gofile.io/file/MovsLG"),
    "MovsLG",
  );
  assert.equal(extractGofileContentId("https://example.com/d/MovsLG"), "");
});

test("extractGoogleDriveFileId understands common share and download URL shapes", () => {
  assert.equal(
    extractGoogleDriveFileId(
      "https://drive.google.com/file/d/1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv/view?usp=sharing",
    ),
    "1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv",
  );
  assert.equal(
    extractGoogleDriveFileId(
      "https://drive.google.com/uc?export=download&id=1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv",
    ),
    "1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv",
  );
  assert.equal(
    extractGoogleDriveFileId(
      "https://drive.usercontent.google.com/uc?id=1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv&export=download",
    ),
    "1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv",
  );
  assert.equal(
    extractGoogleDriveFileId("https://example.com/file/d/123/view"),
    "",
  );
});

test("extractGoogleDriveDirectUrlFromHtml reads embedded download URLs from viewer pages", () => {
  const html = `
    <html>
      <body>
        <script>
          window.viewerData = {
            itemJson: [
              null,
              "Manturov.mp4",
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              "video/mp4",
              null,
              null,
              null,
              null,
              "https://drive.usercontent.google.com/uc?id\\u003d1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv\\u0026export\\u003ddownload"
            ]
          };
        </script>
      </body>
    </html>
  `;

  assert.equal(
    extractGoogleDriveDirectUrlFromHtml(html),
    "https://drive.usercontent.google.com/uc?id=1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv&export=download",
  );
});

test("extractGoogleDriveDirectUrlFromHtml accepts driveusercontent download endpoints", () => {
  const html = `
    <html>
      <body>
        <script>
          const payload = "https://drive.usercontent.google.com/download?id\\u003dabc123\\u0026export\\u003ddownload\\u0026resourcekey\\u003d0-testKey";
        </script>
      </body>
    </html>
  `;

  assert.equal(
    extractGoogleDriveDirectUrlFromHtml(html),
    "https://drive.usercontent.google.com/download?id=abc123&export=download&resourcekey=0-testKey",
  );
});

test("extractGoogleDriveConfirmUrl rebuilds the confirm download URL from warning forms", () => {
  const html = `
    <html>
      <body>
        <form id="download-form" action="https://drive.google.com/uc?export=download" method="post">
          <input type="hidden" name="id" value="abc123">
          <input type="hidden" name="confirm" value="t">
          <input type="hidden" name="uuid" value="deadbeef">
        </form>
      </body>
    </html>
  `;

  assert.equal(
    extractGoogleDriveConfirmUrl(
      html,
      "https://drive.google.com/uc?export=download&id=abc123",
    ),
    "https://drive.google.com/uc?export=download&id=abc123&confirm=t&uuid=deadbeef",
  );
});

test("generateGofileWebsiteToken matches the current frontend handshake format", () => {
  const token = generateGofileWebsiteToken("abc123token", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    language: "en-US",
    nowMs: 1712345678000,
  });

  assert.equal(
    token,
    "714cd3c5ef314c637076cc8275f13054c2f279f39c14c67da62804279324e222",
  );
});

test("resolveGofileUrl uses guest account bootstrap and content API to find the direct file URL", async () => {
  const calls = [];
  const session = {
    async fetch(url, options = {}) {
      calls.push({
        url,
        method: options.method || "GET",
      });

      if (url === "https://api.gofile.io/accounts") {
        return {
          ok: true,
          async json() {
            return {
              data: {
                token: "guest-token-123",
              },
            };
          },
        };
      }

      if (url === "https://api.gofile.io/accounts/website") {
        assert.equal(options.headers.authorization, "Bearer guest-token-123");
        return {
          ok: true,
          async json() {
            return {
              status: "ok",
              data: {
                token: "guest-token-123",
                id: "guest-account-id",
                email: "guest123",
              },
            };
          },
        };
      }

      if (url === "https://api.gofile.io/contents/MovsLG") {
        assert.equal(options.headers.authorization, "Bearer guest-token-123");
        assert.equal(
          options.headers["x-website-token"],
          generateGofileWebsiteToken("guest-token-123"),
        );
        assert.equal(options.headers["x-bl"], "en-US");
        return {
          ok: true,
          async json() {
            return {
              status: "ok",
              data: {
                children: {
                  childA: {
                    type: "file",
                    link: "https://store7.gofile.io/download/web/abc/file.zip",
                  },
                },
              },
            };
          },
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  };

  const resolvedUrl = await resolveGofileUrl(
    session,
    "https://gofile.io/d/MovsLG",
  );

  assert.equal(
    resolvedUrl,
    "https://store7.gofile.io/download/web/abc/file.zip",
  );
  assert.deepEqual(calls, [
    { url: "https://api.gofile.io/accounts", method: "POST" },
    { url: "https://api.gofile.io/accounts/website", method: "GET" },
    { url: "https://api.gofile.io/contents/MovsLG", method: "GET" },
  ]);
});

test("resolveGofileUrl prefers child file links over noisy folder downloadPage values", async () => {
  const session = {
    async fetch(url) {
      if (url === "https://api.gofile.io/accounts") {
        return {
          ok: true,
          async json() {
            return {
              status: "ok",
              data: {
                token: "guest-token-123",
              },
            };
          },
        };
      }

      if (url === "https://api.gofile.io/accounts/website") {
        return {
          ok: true,
          async json() {
            return {
              status: "ok",
              data: {
                token: "guest-token-123",
                id: "guest-account-id",
                email: "guest123",
              },
            };
          },
        };
      }

      if (url === "https://api.gofile.io/contents/NoisyFolder") {
        return {
          ok: true,
          async json() {
            return {
              status: "ok",
              data: {
                type: "folder",
                downloadPage:
                  "https://file-eu-par-3.gofile.io/download/web/noisy/download.json",
                children: {
                  childA: {
                    type: "file",
                    link: "https://file-eu-par-3.gofile.io/download/web/real/game.zip",
                  },
                },
              },
            };
          },
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  };

  const resolvedUrl = await resolveGofileUrl(
    session,
    "https://gofile.io/d/NoisyFolder",
  );

  assert.equal(
    resolvedUrl,
    "https://file-eu-par-3.gofile.io/download/web/real/game.zip",
  );
});

test("resolveGoogleDriveUrl follows share pages to the embedded direct download URL", async () => {
  const createMockResponse = ({
    url,
    contentType,
    contentDisposition = "",
    text = "",
  }) => ({
    ok: true,
    url,
    headers: {
      get(name) {
        const normalized = String(name || "").toLowerCase();
        if (normalized === "content-type") {
          return contentType;
        }

        if (normalized === "content-disposition") {
          return contentDisposition;
        }

        return "";
      },
    },
    async text() {
      return text;
    },
    body: {
      async cancel() {
        return undefined;
      },
    },
  });

  const calls = [];
  const session = {
    async fetch(url, options = {}) {
      calls.push({
        url,
        method: options.method || "GET",
      });

      if (
        url ===
        "https://drive.google.com/file/d/1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv/view?usp=sharing"
      ) {
        return createMockResponse({
          url,
          contentType: "text/html; charset=utf-8",
          text: `
            <html>
              <body>
                <script>
                  window.viewerData = {
                    itemJson: [
                      null,
                      "Manturov.mp4",
                      null,
                      null,
                      null,
                      null,
                      null,
                      null,
                      null,
                      null,
                      null,
                      "video/mp4",
                      null,
                      null,
                      null,
                      null,
                      "https://drive.usercontent.google.com/uc?id\\u003d1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv\\u0026export\\u003ddownload"
                    ]
                  };
                </script>
              </body>
            </html>
          `,
        });
      }

      if (
        url ===
        "https://drive.usercontent.google.com/uc?id=1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv&export=download"
      ) {
        return createMockResponse({
          url,
          contentType: "video/mp4",
          contentDisposition: 'attachment; filename="Manturov.mp4"',
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  };

  const resolvedUrl = await resolveGoogleDriveUrl(
    session,
    "https://drive.google.com/file/d/1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv/view?usp=sharing",
  );

  assert.equal(
    resolvedUrl,
    "https://drive.usercontent.google.com/uc?id=1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv&export=download",
  );
  assert.deepEqual(calls, [
    {
      url: "https://drive.google.com/file/d/1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv/view?usp=sharing",
      method: "GET",
    },
    {
      url: "https://drive.usercontent.google.com/uc?id=1nvDoaSXwd3eh7n80T0BLGFSn-U8E70Hv&export=download",
      method: "GET",
    },
  ]);
});

test("resolveGoogleDriveUrl follows confirm warning forms for large or scanned files", async () => {
  const createMockResponse = ({
    url,
    contentType,
    contentDisposition = "",
    text = "",
  }) => ({
    ok: true,
    url,
    headers: {
      get(name) {
        const normalized = String(name || "").toLowerCase();
        if (normalized === "content-type") {
          return contentType;
        }

        if (normalized === "content-disposition") {
          return contentDisposition;
        }

        return "";
      },
    },
    async text() {
      return text;
    },
    body: {
      async cancel() {
        return undefined;
      },
    },
  });

  const calls = [];
  const session = {
    async fetch(url, options = {}) {
      calls.push({
        url,
        method: options.method || "GET",
      });

      if (
        url === "https://drive.google.com/uc?export=download&id=abc123" &&
        (options.method || "GET") === "GET"
      ) {
        return createMockResponse({
          url,
          contentType: "text/html; charset=utf-8",
          text: `
            <html>
              <body>
                <form id="download-form" action="https://drive.google.com/uc?export=download" method="post">
                  <input type="hidden" name="id" value="abc123">
                  <input type="hidden" name="confirm" value="t">
                  <input type="hidden" name="uuid" value="deadbeef">
                </form>
              </body>
            </html>
          `,
        });
      }

      if (
        url ===
        "https://drive.google.com/uc?export=download&id=abc123&confirm=t&uuid=deadbeef"
      ) {
        return createMockResponse({
          url,
          contentType: "application/zip",
          contentDisposition: 'attachment; filename="payload.zip"',
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  };

  const resolvedUrl = await resolveGoogleDriveUrl(
    session,
    "https://drive.google.com/uc?export=download&id=abc123",
  );

  assert.equal(
    resolvedUrl,
    "https://drive.google.com/uc?export=download&id=abc123&confirm=t&uuid=deadbeef",
  );
  assert.deepEqual(calls, [
    {
      url: "https://drive.google.com/uc?export=download&id=abc123",
      method: "GET",
    },
    {
      url: "https://drive.google.com/uc?export=download&id=abc123&confirm=t&uuid=deadbeef",
      method: "GET",
    },
  ]);
});

test("resolveGoogleDriveUrl retries resourcekey-aware candidates after an unsupported share page", async () => {
  const createMockResponse = ({
    url,
    contentType,
    contentDisposition = "",
    text = "",
  }) => ({
    ok: true,
    url,
    headers: {
      get(name) {
        const normalized = String(name || "").toLowerCase();
        if (normalized === "content-type") {
          return contentType;
        }

        if (normalized === "content-disposition") {
          return contentDisposition;
        }

        return "";
      },
    },
    async text() {
      return text;
    },
    body: {
      async cancel() {
        return undefined;
      },
    },
  });

  const calls = [];
  const session = {
    async fetch(url, options = {}) {
      calls.push({
        url,
        method: options.method || "GET",
      });

      if (
        url ===
        "https://drive.google.com/file/d/abc123/view?usp=drive_link&resourcekey=0-testKey"
      ) {
        return createMockResponse({
          url,
          contentType: "text/html; charset=utf-8",
          text: "<html><body><p>Preview page without embedded direct link</p></body></html>",
        });
      }

      if (
        url ===
        "https://drive.google.com/uc?export=download&id=abc123&resourcekey=0-testKey"
      ) {
        return createMockResponse({
          url,
          contentType: "application/zip",
          contentDisposition: 'attachment; filename="payload.zip"',
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  };

  const resolvedUrl = await resolveGoogleDriveUrl(
    session,
    "https://drive.google.com/file/d/abc123/view?usp=drive_link&resourcekey=0-testKey",
  );

  assert.equal(
    resolvedUrl,
    "https://drive.google.com/uc?export=download&id=abc123&resourcekey=0-testKey",
  );
  assert.deepEqual(calls, [
    {
      url: "https://drive.google.com/file/d/abc123/view?usp=drive_link&resourcekey=0-testKey",
      method: "GET",
    },
    {
      url: "https://drive.google.com/uc?export=download&id=abc123&resourcekey=0-testKey",
      method: "GET",
    },
  ]);
});

test("prepareF95DownloadUrl blocks unsupported MEGA mirrors with a clear error", async () => {
  await assert.rejects(
    () =>
      prepareF95DownloadUrl(
        {
          fetch() {
            throw new Error("Fetch must not be called for MEGA guards.");
          },
        },
        "https://mega.nz/file/u1AjAI4L#key",
      ),
    /MEGA mirrors are not supported/,
  );
});

test("prepareF95DownloadUrl resolves F95 masked links through the host landing page without following external ad links", async () => {
  const createMockResponse = ({
    ok = true,
    url,
    contentType = "",
    contentDisposition = "",
    text = "",
    json = null,
  }) => ({
    ok,
    url,
    headers: {
      get(name) {
        const normalized = String(name || "").toLowerCase();
        if (normalized === "content-type") {
          return contentType;
        }

        if (normalized === "content-disposition") {
          return contentDisposition;
        }

        return "";
      },
    },
    async text() {
      return text;
    },
    async json() {
      return json;
    },
    body: {
      async cancel() {
        return undefined;
      },
    },
  });

  const calls = [];
  const session = {
    async fetch(url, options = {}) {
      calls.push({
        url,
        method: options.method || "GET",
      });

      if (
        url === "https://f95zone.to/masked/example" &&
        (options.method || "GET") === "POST"
      ) {
        return createMockResponse({
          url,
          contentType: "application/json",
          json: {
            status: "ok",
            msg: "https://buzzheavier.com/ub5ewcwwl2xa",
          },
        });
      }

      if (url === "https://buzzheavier.com/ub5ewcwwl2xa") {
        return createMockResponse({
          url,
          contentType: "text/html; charset=utf-8",
          text: `
            <html>
              <body>
                <a href="https://www.torproject.org/download/">Download Tor Browser</a>
                <a class="link-button" hx-get="/ub5ewcwwl2xa/download">Download</a>
              </body>
            </html>
          `,
        });
      }

      if (url === "https://buzzheavier.com/ub5ewcwwl2xa/download") {
        return createMockResponse({
          url,
          contentType: "application/octet-stream",
          contentDisposition: 'attachment; filename="LasFutas.zip"',
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  };

  const prepared = await prepareF95DownloadUrl(
    session,
    "https://f95zone.to/masked/example",
  );

  assert.equal(
    prepared.resolvedUrl,
    "https://buzzheavier.com/ub5ewcwwl2xa/download",
  );
  assert.equal(prepared.sourceHost, "buzzheavier.com");
  assert.deepEqual(calls, [
    { url: "https://f95zone.to/masked/example", method: "POST" },
    { url: "https://buzzheavier.com/ub5ewcwwl2xa", method: "GET" },
    { url: "https://buzzheavier.com/ub5ewcwwl2xa", method: "GET" },
    {
      url: "https://buzzheavier.com/ub5ewcwwl2xa/download",
      method: "GET",
    },
  ]);
});

test("prepareF95DownloadUrl returns a typed captcha-required error for masked links", async () => {
  const session = {
    async fetch(url, options = {}) {
      if (
        url === "https://f95zone.to/masked/captcha-example" &&
        (options.method || "GET") === "POST"
      ) {
        return {
          ok: true,
          async json() {
            return {
              status: "captcha",
            };
          },
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  };

  await assert.rejects(
    () =>
      prepareF95DownloadUrl(
        session,
        "https://f95zone.to/masked/captcha-example",
      ),
    (error) => {
      const typedError = /** @type {MirrorActionRequiredError} */ (error);
      assert.equal(typedError instanceof MirrorActionRequiredError, true);
      assert.equal(typedError.code, "captcha_required");
      assert.equal(
        typedError.actionUrl,
        "https://f95zone.to/masked/captcha-example",
      );
      return true;
    },
  );
});
