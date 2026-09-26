#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Live mirror verification (Node >= 18, no Electron).
 *
 * Runs every link through the same code the app uses:
 *   prepareF95DownloadUrl  (host resolvers, cookie-jar session shim)
 *   downloadToFile         (options from src/main/f95/transferOptions.js)
 *   inspectDownloadedPackage
 * then hashes the payload, checks the size against what the host announced
 * and tests archive integrity with the bundled 7-Zip.
 *
 * Usage:
 *   node scripts/check-mirrors.js [options] <url> [<url> ...]
 *   node scripts/check-mirrors.js --file links.txt
 *
 * Options:
 *   --file <path>           links, one per line (# comments, "url  # note")
 *   --cookies <path>        Netscape cookies.txt (F95 login for masked links)
 *   --out <dir>             download directory (default: <tmp>/f95-check-mirrors)
 *   --keep                  keep downloaded files (default: delete after checks)
 *   --only <hostId[,id2]>   only check links of these host ids (see --list-hosts)
 *   --simulate-drop <bytes> cut the first transfer after N bytes, expect a Range resume
 *   --platform <hint>       windows | linux | mac | android (default windows)
 *   --capture <dir>         save every textual HTTP response of the resolvers
 *   --json <path>           write machine-readable results
 *   --timeout <ms>          per-request timeout (default 30000)
 *   --user-agent <ua>       override the browser identity (match cf_clearance)
 *   --list-hosts            print the host registry and exit
 *
 * Exit code: 0 when every link is PASS or an expected ACTION_REQUIRED
 * (browser-only host), 1 when any link FAILs or an automatic host asks for a
 * browser step, 2 on usage errors.
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const {
  DownloadValidationError,
  MirrorActionRequiredError,
  getMirrorHostInfo,
  inspectDownloadedPackage,
  prepareF95DownloadUrl,
} = require(path.join(ROOT, "src/main/f95/downloadSupport"));
const { downloadToFile, formatBytes } = require(
  path.join(ROOT, "src/main/f95/directDownload"),
);
const {
  buildDirectTransferOptions,
  sanitizeDownloadFileName,
} = require(path.join(ROOT, "src/main/f95/transferOptions"));
const { createCookieJarSession, parseNetscapeCookies } = require(
  path.join(ROOT, "src/main/f95/cookieJar"),
);
const { MIRROR_HOSTS } = require(path.join(ROOT, "src/main/f95/hosts"));
const { isHtmlLikeContentType } = require(
  path.join(ROOT, "src/main/f95/hosts/common"),
);

// Defaults of the app's Library settings (importDownloadedF95Package).
const ARCHIVE_EXTENSIONS = ["zip", "7z", "rar"];
const GAME_EXTENSIONS = ["exe", "swf", "flv", "f4v", "rag", "cmd", "bat", "jar", "html"];
const CAPTURE_BODY_LIMIT = 2 * 1024 * 1024;

function usageError(message) {
  console.error(`check-mirrors: ${message}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}

function printHelp() {
  const source = fs.readFileSync(__filename, "utf8");
  const match = source.match(/\/\*\*\n([\s\S]*?)\*\//);
  console.log(
    match
      ? match[1]
          .split("\n")
          .map((line) => line.replace(/^ \* ?/, ""))
          .join("\n")
      : "See the header of scripts/check-mirrors.js",
  );
}

function parseArgs(argv) {
  const options = {
    urls: [],
    file: "",
    cookies: "",
    out: "",
    keep: false,
    only: [],
    simulateDrop: 0,
    platform: "windows",
    capture: "",
    json: "",
    timeout: 30000,
    userAgent: "",
    listHosts: false,
    help: false,
  };

  const takeValue = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      usageError(`${flag} needs a value`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--file":
        options.file = takeValue(index, argument);
        index += 1;
        break;
      case "--cookies":
        options.cookies = takeValue(index, argument);
        index += 1;
        break;
      case "--out":
        options.out = takeValue(index, argument);
        index += 1;
        break;
      case "--keep":
        options.keep = true;
        break;
      case "--only":
        options.only.push(
          ...takeValue(index, argument)
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        );
        index += 1;
        break;
      case "--simulate-drop":
        options.simulateDrop = Number.parseInt(takeValue(index, argument), 10);
        if (!(options.simulateDrop > 0)) {
          usageError("--simulate-drop needs a positive byte count");
        }
        index += 1;
        break;
      case "--platform":
        options.platform = takeValue(index, argument);
        index += 1;
        break;
      case "--capture":
        options.capture = takeValue(index, argument);
        index += 1;
        break;
      case "--json":
        options.json = takeValue(index, argument);
        index += 1;
        break;
      case "--timeout":
        options.timeout = Number.parseInt(takeValue(index, argument), 10) || 30000;
        index += 1;
        break;
      case "--user-agent":
        options.userAgent = takeValue(index, argument);
        index += 1;
        break;
      case "--list-hosts":
        options.listHosts = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (argument.startsWith("--")) {
          usageError(`unknown option ${argument}`);
        }
        options.urls.push(argument);
    }
  }

  return options;
}

/**
 * links.txt: one link per line. `# comment`, blank lines and an inline
 * `# note` after the URL are allowed. An optional `expect=<status>` token
 * after the URL pins the expected verdict.
 */
function readLinksFile(filePath) {
  const entries = [];
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    // Only " #" starts a note: MEGA links carry the key after a bare "#".
    const [urlPart, ...notePart] = line.split(/\s+#/);
    const tokens = urlPart.trim().split(/\s+/);
    const url = tokens[0];
    const expect = (tokens.find((token) => token.startsWith("expect=")) || "")
      .replace(/^expect=/, "")
      .toUpperCase();
    if (!/^https?:\/\//i.test(url)) {
      continue;
    }
    entries.push({ url, note: notePart.join(" #").trim(), expect });
  }
  return entries;
}

function loadCookies(filePath) {
  const cookies = parseNetscapeCookies(fs.readFileSync(filePath, "utf8"));
  if (cookies.length === 0) {
    usageError(`no cookies found in ${filePath}`);
  }
  return cookies;
}

function sanitizeForFileName(value) {
  return String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .slice(0, 80);
}

/**
 * Store textual responses of the resolver phase for fixture building.
 */
function createCaptureObserver(captureDir, getCurrentHost) {
  let counter = 0;
  return ({ url, requestUrl, method, status, response }) => {
    const contentType = response.headers?.get?.("content-type") || "";
    if (!isHtmlLikeContentType(contentType)) {
      return;
    }
    counter += 1;
    const hostDir = path.join(captureDir, getCurrentHost().id || "generic");
    fs.mkdirSync(hostDir, { recursive: true });
    const extension = /json/i.test(contentType) ? "json" : /html|xml/i.test(contentType) ? "html" : "txt";
    const base = `${String(counter).padStart(2, "0")}-${status}-${sanitizeForFileName(url)}`;
    const headers = {};
    try {
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } catch {
      // ignore
    }
    fs.writeFileSync(
      path.join(hostDir, `${base}.meta.json`),
      JSON.stringify({ url, requestUrl, method, status, contentType, headers }, null, 2),
    );
    response
      .clone()
      .text()
      .then((body) => {
        fs.writeFileSync(path.join(hostDir, `${base}.${extension}`), body.slice(0, CAPTURE_BODY_LIMIT));
      })
      .catch(() => {});
  };
}

/**
 * Wrap a Response so its body errors with a transient network error after
 * `dropAfterBytes` bytes. Used to prove HTTP Range resume works end to end.
 */
function cutResponseBody(response, dropAfterBytes) {
  const reader = response.body.getReader();
  let delivered = 0;
  const body = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      const remaining = dropAfterBytes - delivered;
      if (value.length >= remaining) {
        if (remaining > 0) {
          controller.enqueue(value.subarray(0, remaining));
          delivered += remaining;
        }
        const error = new Error("simulated connection drop (ECONNRESET)");
        // @ts-ignore
        error.code = "ECONNRESET";
        controller.error(error);
        reader.cancel().catch(() => {});
        return;
      }
      delivered += value.length;
      controller.enqueue(value);
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
  const cut = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  Object.defineProperty(cut, "url", { value: response.url, configurable: true });
  return cut;
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

function sevenZipPath() {
  try {
    return require("7zip-bin").path7za;
  } catch {
    return "";
  }
}

/**
 * `7za t` on zip/7z/rar; resolves with {ok, detail}.
 */
function testArchive(filePath) {
  const binary = sevenZipPath();
  if (!binary || !fs.existsSync(binary)) {
    return Promise.resolve({ ok: false, detail: "7-Zip binary unavailable" });
  }
  return new Promise((resolve) => {
    const child = cp.spawn(binary, ["t", "-y", "-p-", filePath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => resolve({ ok: false, detail: error.message }));
    child.on("close", (code) => {
      const files = output.match(/Files:\s*(\d+)/);
      resolve({
        ok: code === 0,
        detail:
          code === 0
            ? `ok${files ? ` (${files[1]} files)` : ""}`
            : output.trim().split("\n").slice(-3).join(" | ").slice(0, 200) || `exit ${code}`,
      });
    });
  });
}

function errorSummary(error) {
  const code = error?.code ? `[${error.code}] ` : "";
  const message = String(error?.userMessage || error?.message || error || "unknown error");
  return `${code}${message}`.replace(/\s+/g, " ").trim();
}

function hostInfoFor(url) {
  const info = getMirrorHostInfo(url);
  return {
    id: info.hostId || (info.generic ? "generic" : ""),
    label: info.label || info.host || url,
    supported: info.supported,
    masked: info.masked,
  };
}

async function checkLink(entry, options, session, state) {
  const startedAt = Date.now();
  const host = hostInfoFor(entry.url);
  state.currentHost = host;
  const row = {
    host: host.id || "?",
    label: host.label,
    supported: host.supported,
    masked: host.masked,
    url: entry.url,
    note: entry.note || "",
    expect: entry.expect || "",
    status: "FAIL",
    fileName: "",
    size: 0,
    announcedSize: 0,
    sha256: "",
    archive: "",
    error: "",
    actionUrl: "",
    resolvedUrl: "",
    transfer: "",
    resumed: null,
    elapsedMs: 0,
    log: [],
  };
  const log = (text) => {
    row.log.push(text);
    console.log(`    ${text}`);
  };

  console.log(`\n▶ ${host.label} (${row.host}${host.masked ? ", masked" : ""}) ${entry.url}`);

  const controller = new AbortController();
  let prepared = null;
  try {
    prepared = await prepareF95DownloadUrl(session, entry.url, {
      signal: controller.signal,
      platformHint: options.platform,
      requestTimeoutMs: options.timeout,
      onStatus: (text) => log(text),
    });
  } catch (error) {
    row.elapsedMs = Date.now() - startedAt;
    if (error instanceof MirrorActionRequiredError) {
      row.status = "ACTION_REQUIRED";
      row.actionUrl = error.actionUrl || entry.url;
      row.error = errorSummary(error);
      row.unexpected = host.supported !== "browser";
      log(`ACTION_REQUIRED → ${row.actionUrl}`);
      return row;
    }
    row.error = `resolve: ${errorSummary(error)}`;
    log(`FAIL ${row.error}`);
    return row;
  }

  row.resolvedUrl = prepared.resolvedUrl;
  row.transfer = prepared.transfer;
  row.announcedSize = prepared.size || 0;
  row.host = prepared.hostId || row.host;
  row.label = prepared.hostLabel || row.label;
  log(
    `resolved → ${prepared.resolvedUrl}${prepared.fileName ? ` (${prepared.fileName}` : ""}${prepared.size ? `${prepared.fileName ? ", " : " ("}${formatBytes(prepared.size)}` : ""}${prepared.fileName || prepared.size ? ")" : ""} transfer=${prepared.transfer} range=${prepared.rangeMode}`,
  );

  // Transfer with the exact options the app uses.
  let dropped = false;
  let resumeRequested = false;
  let resumeAccepted = false;
  const fetchImpl = async (url, init) => {
    const response = await session.fetch(url, init);
    const rangeHeader = new Headers(init?.headers || {}).get("range");
    if (dropped && rangeHeader) {
      resumeRequested = true;
      if (response.status === 206) {
        resumeAccepted = true;
      }
    }
    if (options.simulateDrop > 0 && !dropped && response.ok && response.body) {
      dropped = true;
      log(`simulating a connection drop after ${formatBytes(options.simulateDrop)}`);
      return cutResponseBody(response, options.simulateDrop);
    }
    return response;
  };

  let lastPercent = -1;
  let result = null;
  try {
    result = await downloadToFile(
      buildDirectTransferOptions({
        prepared,
        fetchImpl,
        signal: controller.signal,
        hostLabel: prepared.hostLabel,
        fallbackFileName: `${sanitizeDownloadFileName(row.host, "mirror")}-download.bin`,
        resolveTargetPath: (fileName) => {
          const safeName = sanitizeDownloadFileName(fileName, "download.bin");
          let candidate = path.join(options.out, safeName);
          let attempt = 1;
          while (fs.existsSync(candidate) || fs.existsSync(`${candidate}.part`)) {
            const extension = path.extname(safeName);
            const stem = path.basename(safeName, extension);
            candidate = path.join(options.out, `${stem} (${attempt++})${extension}`);
          }
          return candidate;
        },
        onTarget: ({ fileName, totalBytes, mimeType }) => {
          log(`file: ${fileName} ${totalBytes ? formatBytes(totalBytes) : "(unknown size)"} ${mimeType}`);
        },
        onProgress: ({ percent, speedBytesPerSecond, receivedBytes, totalBytes }) => {
          const bucket = Math.floor(percent / 10) * 10;
          if (bucket !== lastPercent && (bucket >= lastPercent + 10 || totalBytes === 0)) {
            lastPercent = bucket;
            if (totalBytes > 0) {
              process.stdout.write(
                `    ${String(percent).padStart(3)}% ${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)} @ ${formatBytes(speedBytesPerSecond)}/s\r`,
              );
            }
          }
        },
        onRetry: ({ attempt, maxAttempts, delayMs, error, resumeFrom }) => {
          log(
            `retry ${attempt}/${maxAttempts} in ${Math.ceil(delayMs / 1000)}s${resumeFrom > 0 ? ` (resume from ${formatBytes(resumeFrom)})` : ""}: ${errorSummary(error)}`,
          );
        },
        progressIntervalMs: 500,
      }),
    );
  } catch (error) {
    row.elapsedMs = Date.now() - startedAt;
    if (error instanceof MirrorActionRequiredError) {
      row.status = "ACTION_REQUIRED";
      row.actionUrl = error.actionUrl || entry.url;
      row.error = errorSummary(error);
      row.unexpected = host.supported !== "browser";
      log(`ACTION_REQUIRED (transfer) → ${row.actionUrl}`);
      return row;
    }
    row.error = `transfer: ${errorSummary(error)}`;
    log(`FAIL ${row.error}`);
    return row;
  }
  process.stdout.write("\n");

  row.fileName = result.fileName;
  row.size = result.receivedBytes;
  const problems = [];

  if (options.simulateDrop > 0) {
    row.resumed = resumeRequested && resumeAccepted;
    if (!dropped) {
      log("drop simulation did not trigger (empty body?)");
    } else if (row.resumed) {
      log("resume: Range request accepted with HTTP 206");
    } else if (resumeRequested) {
      problems.push("resume: host ignored the Range request (restarted from 0)");
    } else {
      problems.push("resume: pipeline restarted from 0 instead of resuming");
    }
  }

  try {
    const [hash, stats] = await Promise.all([
      sha256File(result.targetPath),
      fs.promises.stat(result.targetPath),
    ]);
    row.sha256 = hash;
    row.size = stats.size;
    if (result.totalBytes > 0 && stats.size !== result.totalBytes) {
      problems.push(`size: got ${stats.size} bytes, expected ${result.totalBytes}`);
    }
    if (row.announcedSize > 0 && stats.size !== row.announcedSize) {
      problems.push(`size: host announced ${row.announcedSize} bytes, got ${stats.size}`);
    }
  } catch (error) {
    problems.push(`hash: ${errorSummary(error)}`);
  }

  try {
    const payload = await inspectDownloadedPackage({
      filePath: result.targetPath,
      mimeType: result.mimeType,
      archiveExtensions: ARCHIVE_EXTENSIONS,
      gameExtensions: GAME_EXTENSIONS,
    });
    row.archive = payload.installKind === "archive" ? payload.archiveType : `file:${payload.normalizedExtension}`;
    if (payload.installKind === "archive" && ["zip", "7z", "rar"].includes(payload.archiveType)) {
      const verdict = await testArchive(result.targetPath);
      log(`archive test (${payload.archiveType}): ${verdict.detail}`);
      if (!verdict.ok) {
        problems.push(`archive: ${verdict.detail}`);
      }
    }
  } catch (error) {
    row.archive = error instanceof DownloadValidationError ? error.code : "";
    problems.push(`payload: ${errorSummary(error)}`);
  }

  if (!options.keep) {
    await fs.promises.unlink(result.targetPath).catch(() => {});
  } else {
    log(`kept ${result.targetPath}`);
  }

  row.elapsedMs = Date.now() - startedAt;
  if (problems.length > 0) {
    row.error = problems.join("; ");
    log(`FAIL ${row.error}`);
    return row;
  }

  row.status = "PASS";
  log(`PASS ${row.fileName} ${formatBytes(row.size)} sha256=${row.sha256}`);
  return row;
}

function truncate(value, width) {
  const text = String(value ?? "");
  if (text.length <= width) {
    return text;
  }
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function renderTable(rows) {
  const columns = [
    { title: "host", width: 14, value: (row) => row.host },
    { title: "URL", width: 58, value: (row) => row.url },
    { title: "status", width: 15, value: (row) => row.status + (row.unexpected ? "!" : "") },
    { title: "file", width: 34, value: (row) => row.fileName },
    { title: "size", width: 11, value: (row) => (row.size ? formatBytes(row.size) : "") },
    { title: "sha256", width: 64, value: (row) => row.sha256 },
    { title: "archive", width: 9, value: (row) => row.archive },
    { title: "error", width: 70, value: (row) => row.error || (row.actionUrl ? `open: ${row.actionUrl}` : "") },
  ];
  const line = (cells) => `| ${cells.join(" | ")} |`;
  const header = line(columns.map((column) => truncate(column.title, column.width).padEnd(column.width)));
  const separator = line(columns.map((column) => "-".repeat(column.width)));
  const body = rows.map((row) =>
    line(columns.map((column) => truncate(column.value(row), column.width).padEnd(column.width))),
  );
  return [header, separator, ...body].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }
  if (options.listHosts) {
    for (const host of MIRROR_HOSTS) {
      console.log(
        `${host.id.padEnd(18)} ${host.support.padEnd(8)} ${host.label.padEnd(22)} ${(host.domains || []).slice(0, 4).join(", ")}${host.match ? " (pattern)" : ""}`,
      );
    }
    return 0;
  }

  let entries = options.urls.map((url) => ({ url, note: "", expect: "" }));
  if (options.file) {
    if (!fs.existsSync(options.file)) {
      usageError(`links file not found: ${options.file}`);
    }
    entries = entries.concat(readLinksFile(options.file));
  }
  if (entries.length === 0) {
    usageError("no links given");
  }
  if (options.only.length > 0) {
    const wanted = new Set(options.only.map((id) => id.toLowerCase()));
    const before = entries.length;
    entries = entries.filter((entry) => wanted.has(hostInfoFor(entry.url).id.toLowerCase()));
    console.log(`--only: ${entries.length} of ${before} links match ${[...wanted].join(", ")}`);
    if (entries.length === 0) {
      return 0;
    }
  }

  options.out = path.resolve(options.out || path.join(os.tmpdir(), "f95-check-mirrors"));
  fs.mkdirSync(options.out, { recursive: true });
  if (options.capture) {
    options.capture = path.resolve(options.capture);
    fs.mkdirSync(options.capture, { recursive: true });
  }

  const state = { currentHost: { id: "", label: "" } };
  const session = createCookieJarSession({
    cookies: options.cookies ? loadCookies(options.cookies) : [],
    userAgent: options.userAgent || undefined,
    onResponse: options.capture
      ? createCaptureObserver(options.capture, () => state.currentHost)
      : undefined,
  });

  console.log(
    `check-mirrors: ${entries.length} link(s), out=${options.out}${options.cookies ? ", cookies loaded" : ""}${options.simulateDrop ? `, drop after ${options.simulateDrop} bytes` : ""}${options.capture ? `, capture=${options.capture}` : ""}`,
  );

  const rows = [];
  for (const entry of entries) {
    const row = await checkLink(entry, options, session, state);
    if (row.expect && row.expect !== row.status) {
      row.error = `${row.error ? `${row.error}; ` : ""}expected ${row.expect} but got ${row.status}`;
      row.status = "FAIL";
    }
    rows.push(row);
  }

  console.log(`\n${renderTable(rows)}\n`);
  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  const unexpected = rows.filter((row) => row.status === "ACTION_REQUIRED" && row.unexpected);
  console.log(
    `PASS ${counts.PASS || 0} · ACTION_REQUIRED ${counts.ACTION_REQUIRED || 0}${unexpected.length ? ` (${unexpected.length} unexpected on automatic hosts, marked "!")` : ""} · FAIL ${counts.FAIL || 0}`,
  );

  if (options.json) {
    fs.writeFileSync(
      options.json,
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          options: { ...options, cookies: options.cookies ? "(loaded)" : "" },
          rows,
        },
        null,
        2,
      ),
    );
    console.log(`results written to ${options.json}`);
  }

  return counts.FAIL || unexpected.length ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error("check-mirrors crashed:", error);
    process.exitCode = 1;
  },
);
