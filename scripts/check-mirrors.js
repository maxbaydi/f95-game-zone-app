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
 *   --thread <url>          F95 thread: check every mirror of its starter post
 *                           (repeatable; needs --cookies for masked links)
 *   --all-variants          with --thread: check every platform variant, not
 *                           only the one matching --platform
 *   --cookies <path>        Netscape cookies.txt (F95 login for masked links)
 *   --cookie-domains <list> domains to keep from --cookies (default f95zone.to;
 *                           a full browser export must not leak other logins)
 *   --resolve-only          resolve every link, report file name/size, no transfer
 *   --max-size <bytes>      skip the transfer (status SKIPPED) above this size
 *   --jar <path>            JSON cookie jar persisted between runs (keeps the
 *                           Gofile guest account, Cloudflare clearances, ...)
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
 *   --dry-run               list the links that would be checked and exit
 *   --accept-any            PASS non-game payloads too (public test files);
 *                           HTML/empty payloads still FAIL
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
const {
  BROWSER_USER_AGENT,
  extractAnchors,
  isHtmlLikeContentType,
  looksLikeCloudflareChallenge,
  stripHtmlTags,
} = require(path.join(ROOT, "src/main/f95/hosts/common"));
const { normalizeThreadDownloadLinks } = require(
  path.join(ROOT, "src/main/f95/threadLinks"),
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
    threads: [],
    allVariants: false,
    cookies: "",
    cookieDomains: ["f95zone.to"],
    resolveOnly: false,
    maxSize: 0,
    jar: "",
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
    dryRun: false,
    acceptAny: false,
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
      case "--thread":
        options.threads.push(takeValue(index, argument));
        index += 1;
        break;
      case "--all-variants":
        options.allVariants = true;
        break;
      case "--cookies":
        options.cookies = takeValue(index, argument);
        index += 1;
        break;
      case "--jar":
        options.jar = takeValue(index, argument);
        index += 1;
        break;
      case "--cookie-domains":
        options.cookieDomains = takeValue(index, argument)
          .split(",")
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean);
        index += 1;
        break;
      case "--resolve-only":
        options.resolveOnly = true;
        break;
      case "--max-size":
        options.maxSize = Number.parseInt(takeValue(index, argument), 10) || 0;
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
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--accept-any":
        options.acceptAny = true;
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

const THREAD_BLOCK_TAG_PATTERN =
  /<\/?(?:div|p|li|ul|ol|table|tbody|tr|td|th|blockquote|section|article|hr|h[1-6])\b[^>]*>/gi;

/**
 * Fetch an F95 thread and collect the starter post's mirror links with the
 * same classifier the app uses (threadLinks.js). Lines are split on block
 * tags and <br> so "Win: MEGA - GOFILE" labels stay attached to their links.
 */
async function expandThread(session, threadUrl, options) {
  const response = await session.fetch(threadUrl, {
    method: "GET",
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  const html = await response.text();
  if (!response.ok) {
    if (looksLikeCloudflareChallenge(html)) {
      throw new Error(
        "F95zone answered with a Cloudflare challenge; export fresh cookies (cf_clearance) and pass --user-agent of that browser.",
      );
    }
    throw new Error(`F95zone answered HTTP ${response.status}`);
  }
  if (!/data-logged-in="true"/i.test(html)) {
    console.log("    (not logged in: masked links will need --cookies)");
  }

  let start = html.indexOf("message-threadStarterPost");
  if (start < 0) {
    start = 0;
  }
  const wrapperIndex = html.indexOf('class="bbWrapper"', start);
  if (wrapperIndex < 0) {
    throw new Error("Could not find the starter post on this page.");
  }
  const end = html.indexOf("</article>", wrapperIndex);
  const postHtml = html.slice(wrapperIndex, end > 0 ? end : undefined);
  const titleMatch = html.match(/<h1[^>]*class="p-title-value"[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? stripHtmlTags(titleMatch[1]) : threadUrl;

  const rawLinks = [];
  const fragments = postHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(THREAD_BLOCK_TAG_PATTERN, "\n$&")
    .split("\n");
  for (const fragment of fragments) {
    const lineText = stripHtmlTags(fragment);
    for (const anchor of extractAnchors(fragment, threadUrl)) {
      const parsed = new URL(anchor.url);
      const isF95 = /(^|\.)f95zone\.to$/i.test(parsed.hostname);
      if (isF95 && !/\/(masked|attachments)\//i.test(parsed.pathname)) {
        continue;
      }
      rawLinks.push({
        url: anchor.url,
        label: anchor.text || parsed.hostname,
        host: parsed.hostname,
        lineText,
        contextText: lineText,
        order: rawLinks.length,
      });
    }
  }

  const { variants } = normalizeThreadDownloadLinks(rawLinks);
  const wantedPlatform = String(options.platform || "").toLowerCase();
  const selected = [];
  console.log(`\n≡ ${title}`);
  for (const variant of variants) {
    const variantId = String(variant.id || "").toLowerCase();
    const matches =
      options.allVariants ||
      variantId === wantedPlatform ||
      (variantId === "general" && variants.length === 1) ||
      (wantedPlatform === "windows" && /^(win|windows|pc)/.test(variantId));
    console.log(
      `  ${matches ? "●" : "○"} ${variant.label}: ${variant.links.map((link) => link.hostLabel).join(", ")}`,
    );
    if (!matches) {
      continue;
    }
    for (const link of variant.links) {
      selected.push({
        url: link.url,
        note: `${title} · ${variant.label} · ${link.hostLabel}`,
        expect: "",
        thread: threadUrl,
      });
    }
  }
  if (selected.length === 0 && variants.length > 0 && !options.allVariants) {
    console.log("  (no variant matched --platform; use --all-variants)");
  }
  return selected;
}

function loadCookies(filePath, domains) {
  const all = parseNetscapeCookies(fs.readFileSync(filePath, "utf8"));
  const wanted = (domains || []).map((domain) => domain.replace(/^\./, ""));
  const cookies =
    wanted.length === 0 || wanted.includes("*")
      ? all
      : all.filter((cookie) =>
          wanted.some(
            (domain) => cookie.domain === domain || cookie.domain.endsWith(`.${domain}`),
          ),
        );
  if (cookies.length === 0) {
    usageError(`no cookies for ${wanted.join(", ") || "any domain"} found in ${filePath}`);
  }
  console.log(
    `cookies: ${cookies.length} of ${all.length} loaded (${wanted.join(", ") || "all domains"})`,
  );
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

/**
 * Verify a downloaded file the way the app's installer would: SHA-256, size
 * against Content-Length / the host's announcement, package sniffing and a
 * 7-Zip integrity test for archives.
 */
async function verifyDownloadedFile(row, result, options, log, resume) {
  const problems = [];
  row.fileName = result.fileName;
  row.size = result.receivedBytes;

  if (resume && options.simulateDrop > 0) {
    row.resumed = resume.requested && resume.accepted;
    if (!resume.dropped) {
      log("drop simulation did not trigger (empty body?)");
    } else if (row.resumed) {
      log("resume: ranged request accepted (HTTP 206 / MEGA path range)");
    } else if (resume.requested) {
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
    if (options.acceptAny && error?.code === "unsupported_payload") {
      row.archive = `other:${path.extname(result.fileName).replace(/^\./, "") || "?"}`;
      log(`payload is not a game package (accepted by --accept-any)`);
    } else {
      problems.push(`payload: ${errorSummary(error)}`);
    }
  }

  if (!options.keep) {
    await fs.promises.unlink(result.targetPath).catch(() => {});
  } else {
    log(`kept ${result.targetPath}`);
  }

  if (problems.length > 0) {
    row.error = problems.join("; ");
    log(`FAIL ${row.error}`);
    row.status = "FAIL";
    return row;
  }

  row.status = "PASS";
  log(`PASS ${row.fileName} ${formatBytes(row.size)} sha256=${row.sha256}`);
  return row;
}

function markActionRequired(row, error, entry, host, log, phase = "") {
  row.status = "ACTION_REQUIRED";
  row.actionUrl = error.actionUrl || entry.url;
  row.error = errorSummary(error);
  row.unexpected = host.supported !== "browser";
  log(`ACTION_REQUIRED${phase ? ` (${phase})` : ""} → ${row.actionUrl}`);
  return row;
}

/**
 * Give the browser-step hook (Electron runner) a chance to finish the step.
 * Returns {prepared} | {adopted} | null (no hook / resolve-only).
 */
async function tryBrowserStep(error, entry, host, options, session, adapters, log) {
  const hook = adapters?.hooks?.awaitBrowserStep;
  if (typeof hook !== "function" || options.resolveOnly) {
    return null;
  }
  log(`browser step: ${errorSummary(error)}`);
  return hook({
    entry,
    actionUrl: error.actionUrl || entry.url,
    hostLabel: error.hostLabel || host.label,
    error,
    outDir: options.out,
    log,
    resolveMirror: (signal) =>
      prepareF95DownloadUrl(session, entry.url, {
        signal,
        platformHint: options.platform,
        requestTimeoutMs: options.timeout,
        retry: { attempts: 1 },
        probeTarget: true,
        onStatus: (text) => log(text),
      }),
  });
}

async function checkLink(entry, options, session, state, adapters = {}) {
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
    browserStep: false,
    elapsedMs: 0,
    log: [],
  };
  const log = (text) => {
    row.log.push(text);
    console.log(`    ${text}`);
  };
  const finish = (result) => {
    row.elapsedMs = Date.now() - startedAt;
    return result;
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
    if (!(error instanceof MirrorActionRequiredError)) {
      row.error = `resolve: ${errorSummary(error)}`;
      log(`FAIL ${row.error}`);
      return finish(row);
    }
    let outcome = null;
    try {
      outcome = await tryBrowserStep(error, entry, host, options, session, adapters, log);
    } catch (stepError) {
      if (stepError instanceof MirrorActionRequiredError) {
        return finish(markActionRequired(row, stepError, entry, host, log, "browser step"));
      }
      row.error = `browser step: ${errorSummary(stepError)}`;
      log(`FAIL ${row.error}`);
      return finish(row);
    }
    if (!outcome) {
      return finish(markActionRequired(row, error, entry, host, log));
    }
    row.browserStep = true;
    if (outcome.adopted) {
      row.transfer = "browser";
      return finish(await verifyDownloadedFile(row, outcome.adopted, options, log, null));
    }
    prepared = outcome.prepared;
  }

  row.resolvedUrl = prepared.resolvedUrl;
  row.transfer = prepared.transfer;
  row.announcedSize = prepared.size || 0;
  row.host = prepared.hostId || row.host;
  row.label = prepared.hostLabel || row.label;
  log(
    `resolved → ${prepared.resolvedUrl}${prepared.fileName ? ` (${prepared.fileName}` : ""}${prepared.size ? `${prepared.fileName ? ", " : " ("}${formatBytes(prepared.size)}` : ""}${prepared.fileName || prepared.size ? ")" : ""} transfer=${prepared.transfer} range=${prepared.rangeMode}`,
  );
  row.fileName = prepared.fileName || "";
  row.size = prepared.size || 0;

  if (options.resolveOnly) {
    row.status = "RESOLVED";
    log(`RESOLVED (no transfer requested)`);
    return finish(row);
  }
  if (options.maxSize > 0 && prepared.size > options.maxSize) {
    row.status = "SKIPPED";
    row.error = `announced size ${formatBytes(prepared.size)} exceeds --max-size ${formatBytes(options.maxSize)}`;
    log(`SKIPPED ${row.error}`);
    return finish(row);
  }

  // Transfer with the exact options the app uses.
  const resume = { dropped: false, requested: false, accepted: false };
  const fetchImpl = async (url, init) => {
    const response = await session.fetch(url, init);
    // HTTP hosts resume with a Range header; MEGA appends "/<offset>-<end>"
    // to the path (rangeMode "mega-path") and answers 200.
    const rangeHeader = new Headers(init?.headers || {}).get("range");
    const megaRange = /\/\d+-\d*$/.test(String(url));
    if (resume.dropped && (rangeHeader || megaRange)) {
      resume.requested = true;
      if (response.status === 206 || (megaRange && response.ok)) {
        resume.accepted = true;
      }
    }
    if (options.simulateDrop > 0 && !resume.dropped && response.ok && response.body) {
      resume.dropped = true;
      log(`simulating a connection drop after ${formatBytes(options.simulateDrop)}`);
      return cutResponseBody(response, options.simulateDrop);
    }
    return response;
  };

  const transfer = (target) => {
    let lastPercent = -1;
    return downloadToFile(
      buildDirectTransferOptions({
        prepared: target,
        fetchImpl,
        signal: controller.signal,
        hostLabel: target.hostLabel,
        userAgent: adapters.userAgent || options.userAgent || BROWSER_USER_AGENT,
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
  };

  let result = null;
  try {
    result = await transfer(prepared);
  } catch (error) {
    if (!(error instanceof MirrorActionRequiredError)) {
      row.error = `transfer: ${errorSummary(error)}`;
      log(`FAIL ${row.error}`);
      return finish(row);
    }
    // A wall on the CDN itself: same browser step, then one more transfer.
    let outcome = null;
    try {
      outcome = await tryBrowserStep(error, entry, host, options, session, adapters, log);
    } catch (stepError) {
      if (stepError instanceof MirrorActionRequiredError) {
        return finish(markActionRequired(row, stepError, entry, host, log, "browser step"));
      }
      row.error = `browser step: ${errorSummary(stepError)}`;
      log(`FAIL ${row.error}`);
      return finish(row);
    }
    if (!outcome) {
      return finish(markActionRequired(row, error, entry, host, log, "transfer"));
    }
    row.browserStep = true;
    if (outcome.adopted) {
      row.transfer = "browser";
      return finish(await verifyDownloadedFile(row, outcome.adopted, options, log, null));
    }
    try {
      result = await transfer(outcome.prepared);
    } catch (secondError) {
      row.error = `transfer after browser step: ${errorSummary(secondError)}`;
      log(`FAIL ${row.error}`);
      return finish(row);
    }
  }
  process.stdout.write("\n");

  return finish(await verifyDownloadedFile(row, result, options, log, resume));
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
    { title: "status", width: 16, value: (row) => row.status + (row.unexpected ? "!" : "") + (row.browserStep ? " (browser)" : "") },
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

function createNodeSession(options, state) {
  const persistedCookies =
    options.jar && fs.existsSync(options.jar)
      ? JSON.parse(fs.readFileSync(options.jar, "utf8"))
      : [];
  return createCookieJarSession({
    cookies: [
      ...(Array.isArray(persistedCookies) ? persistedCookies : []),
      ...(options.cookies ? loadCookies(options.cookies, options.cookieDomains) : []),
    ],
    userAgent: options.userAgent || undefined,
    onResponse: options.capture
      ? createCaptureObserver(options.capture, () => state.currentHost)
      : undefined,
  });
}

/**
 * Run the checks described by \`options\` (from parseArgs).
 * @param {ReturnType<typeof parseArgs>} options
 * @param {{session?: any, userAgent?: string, hooks?: {awaitBrowserStep?: Function}}} [adapters]
 * @returns {Promise<number>} exit code
 */
async function run(options, adapters = {}) {
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
  if (entries.length === 0 && options.threads.length === 0) {
    usageError("no links given");
  }
  options.out = path.resolve(options.out || path.join(os.tmpdir(), "f95-check-mirrors"));
  fs.mkdirSync(options.out, { recursive: true });
  if (options.capture) {
    options.capture = path.resolve(options.capture);
    fs.mkdirSync(options.capture, { recursive: true });
  }

  const state = { currentHost: { id: "", label: "" } };
  const session = adapters.session || createNodeSession(options, state);

  for (const threadUrl of options.threads) {
    state.currentHost = { id: "f95-thread", label: "F95zone thread" };
    try {
      entries = entries.concat(await expandThread(session, threadUrl, options));
    } catch (error) {
      console.error(`thread ${threadUrl}: ${errorSummary(error)}`);
      process.exitCode = 1;
    }
  }
  if (entries.length === 0) {
    console.error("no mirror links to check");
    return 1;
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

  if (options.dryRun) {
    for (const entry of entries) {
      const host = hostInfoFor(entry.url);
      console.log(`${host.id.padEnd(16)} ${host.supported.padEnd(8)} ${entry.url}${entry.note ? `  # ${entry.note}` : ""}`);
    }
    return 0;
  }

  console.log(
    `check-mirrors: ${entries.length} link(s), out=${options.out}${options.cookies ? ", cookies loaded" : ""}${options.simulateDrop ? `, drop after ${options.simulateDrop} bytes` : ""}${options.capture ? `, capture=${options.capture}` : ""}${adapters.hooks?.awaitBrowserStep ? ", browser steps enabled" : ""}`,
  );

  const rows = [];
  for (const entry of entries) {
    const row = await checkLink(entry, options, session, state, adapters);
    if (row.expect && row.expect !== row.status) {
      row.error = `${row.error ? `${row.error}; ` : ""}expected ${row.expect} but got ${row.status}`;
      row.status = "FAIL";
    }
    rows.push(row);
  }

  if (options.jar && typeof session.cookies?.list === "function") {
    fs.writeFileSync(options.jar, JSON.stringify(session.cookies.list(), null, 2));
  }

  console.log(`\n${renderTable(rows)}\n`);
  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  const unexpected = rows.filter((row) => row.status === "ACTION_REQUIRED" && row.unexpected);
  console.log(
    `PASS ${counts.PASS || 0} · ACTION_REQUIRED ${counts.ACTION_REQUIRED || 0}${unexpected.length ? ` (${unexpected.length} unexpected on automatic hosts, marked "!")` : ""} · FAIL ${counts.FAIL || 0}${counts.RESOLVED ? ` · RESOLVED ${counts.RESOLVED}` : ""}${counts.SKIPPED ? ` · SKIPPED ${counts.SKIPPED}` : ""}`,
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

module.exports = {
  checkLink,
  hostInfoFor,
  loadCookies,
  parseArgs,
  readLinksFile,
  renderTable,
  run,
};

if (require.main === module) {
  run(parseArgs(process.argv.slice(2))).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error("check-mirrors crashed:", error);
      process.exitCode = 1;
    },
  );
}
