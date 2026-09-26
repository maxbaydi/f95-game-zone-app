/**
 * Mirror host registry.
 *
 * Every supported file host is described once here: which hostnames it owns,
 * a friendly label, whether F95Launcher can download it on its own ("auto")
 * or needs the user to finish a step in the embedded browser ("browser"), and
 * the resolver that turns a share link into a direct transfer target.
 *
 * Resolvers return either
 *   - a string: another URL to keep resolving (e.g. masked link → gofile), or
 *   - an object `{url, transfer?, headers?, fileName?, size?, rangeMode?, mega?}`:
 *     the final transfer target.
 */
const {
  DownloadCancelledError,
  MirrorError,
  createActionRequiredError,
  createResolverContext,
  detectCaptchaKind,
  hostMatchesDomain,
  looksLikeCloudflareChallenge,
  normalizeHostname,
  safeParseUrl,
  withRetry,
} = require("./common");
const {
  extractMaskedTargetHost,
  isF95AttachmentLink,
  isMaskedF95Link,
  resolveMaskedF95Target,
} = require("./f95");
const {
  GOOGLE_DRIVE_DOMAINS,
  interpretGoogleDriveTransferError,
  isGoogleDriveFolderUrl,
  resolveGoogleDriveTarget,
} = require("./googleDrive");
const { resolveGofileTarget } = require("./gofile");
const {
  PIXELDRAIN_DOMAINS,
  interpretPixeldrainTransferError,
  resolvePixeldrainTarget,
} = require("./pixeldrain");
const { isMixdropHost, resolveMixdropTarget } = require("./mixdrop");
const { resolveUploadhavenTarget } = require("./uploadhaven");
const { resolveGenericLandingTarget } = require("./xfilesharing");
const {
  MEGA_DOMAINS,
  interpretMegaTransferError,
  parseMegaUrl,
  resolveMegaTarget,
} = require("./mega");
const {
  BUZZHEAVIER_DOMAINS,
  resolveBuzzheavierTarget,
} = require("./buzzheavier");
const { MEDIAFIRE_DOMAINS, resolveMediafireTarget } = require("./mediafire");
const {
  WORKUPLOAD_DOMAINS,
  parseWorkuploadUrl,
  resolveWorkuploadTarget,
} = require("./workupload");
const { FILESFM_DOMAINS, resolveFilesFmTarget } = require("./filesfm");
const {
  KRAKENFILES_DOMAINS,
  resolveKrakenfilesTarget,
} = require("./krakenfiles");
const {
  QIWI_DOMAINS,
  QIWI_STORAGE_DOMAINS,
  parseQiwiUrl,
  resolveQiwiTarget,
} = require("./qiwi");
const {
  DROPBOX_DOMAINS,
  ONEDRIVE_DOMAINS,
  YANDEX_DISK_DOMAINS,
  interpretDropboxTransferError,
  resolveDropboxTarget,
  resolveOneDriveTarget,
  resolveYandexDiskTarget,
} = require("./cloudDrives");
const {
  resolveFuckingFastTarget,
  resolveSendspaceTarget,
} = require("./pageScrapers");

const MAX_RESOLUTION_HOPS = 8;

/**
 * @typedef {"auto" | "browser"} HostSupport
 * @typedef {{
 *   id: string,
 *   label: string,
 *   support: HostSupport,
 *   domains?: string[],
 *   internal?: boolean,
 *   match?: (parsedUrl: URL, hostname: string) => boolean,
 *   supportFor?: (parsedUrl: URL) => HostSupport | null,
 *   resolve?: ((ctx: any, url: string) => Promise<any>) | null,
 *   interpretTransferError?: (info: {status: number, bodyText: string, url: string}) => Error | null,
 *   browserReason?: string,
 * }} MirrorHost
 */

/**
 * Hosts whose free download needs a human (captcha, waiting room, login,
 * link-protector pages). They are recognised so the UI can label them and
 * open them in the embedded browser instead of failing silently.
 * @type {Array<{id: string, label: string, domains: string[], reason: string}>}
 */
const BROWSER_ONLY_HOSTS = [
  {
    id: "1fichier",
    label: "1fichier",
    domains: [
      "1fichier.com",
      "alterupload.com",
      "cjoint.net",
      "desfichiers.com",
      "dfichiers.com",
      "megadl.fr",
      "mesfichiers.org",
      "piecejointe.net",
      "pjointe.com",
      "tenvoi.com",
      "dl4free.com",
    ],
    reason: "uses a waiting room / captcha for free downloads.",
  },
  {
    id: "terabox",
    label: "TeraBox",
    domains: [
      "terabox.com",
      "teraboxapp.com",
      "terabox.app",
      "1024tera.com",
      "1024terabox.com",
      "4funbox.com",
      "4funbox.co",
      "mirrobox.com",
      "nephobox.com",
      "freeterabox.com",
      "teraboxlink.com",
      "terasharelink.com",
      "terafileshare.com",
    ],
    reason: "requires its website (login / app prompt) to download.",
  },
  {
    id: "filecrypt",
    label: "FileCrypt",
    domains: ["filecrypt.cc", "filecrypt.co"],
    reason: "is a link container protected by a captcha.",
  },
  {
    id: "rapidgator",
    label: "Rapidgator",
    domains: ["rapidgator.net", "rg.to"],
    reason: "requires a captcha and a waiting period for free downloads.",
  },
  {
    id: "nitroflare",
    label: "Nitroflare",
    domains: ["nitroflare.com", "nitro.download"],
    reason: "requires a captcha and a waiting period for free downloads.",
  },
  {
    id: "katfile",
    label: "Katfile",
    domains: ["katfile.com"],
    reason: "requires a captcha for free downloads.",
  },
  {
    id: "ddownload",
    label: "DDownload",
    domains: ["ddownload.com", "ddl.to"],
    reason: "requires a captcha for free downloads.",
  },
  {
    id: "turbobit",
    label: "Turbobit",
    domains: ["turbobit.net", "turb.cc", "turbobit.cc", "turb.to"],
    reason: "requires a captcha and a waiting period for free downloads.",
  },
  {
    id: "hitfile",
    label: "Hitfile",
    domains: ["hitfile.net", "hil.to"],
    reason: "requires a captcha and a waiting period for free downloads.",
  },
  {
    id: "vikingfile",
    label: "VikingFile",
    domains: ["vikingfile.com", "vik1ngfile.site"],
    reason: "requires a browser check (Cloudflare Turnstile) before downloading.",
  },
  {
    id: "multiup",
    label: "MultiUp",
    domains: ["multiup.io", "multiup.org", "multiup.eu"],
    reason: "is a multi-mirror link page; pick one of its mirrors in the browser.",
  },
  {
    id: "mirrored",
    label: "Mirrored.to",
    domains: ["mirrored.to", "mir.cr"],
    reason: "is a multi-mirror link page protected by a captcha.",
  },
  {
    id: "link-shortener",
    label: "Link shortener",
    domains: [
      "ouo.io",
      "ouo.press",
      "linkvertise.com",
      "link-to.net",
      "shrinkme.io",
      "adf.ly",
      "exe.io",
      "shorte.st",
    ],
    reason: "is an ad/link-shortener page that has to be clicked through manually.",
  },
  {
    id: "wetransfer",
    label: "WeTransfer",
    domains: ["wetransfer.com", "we.tl"],
    reason: "requires its website to start the transfer download.",
  },
];

/**
 * Hosts that run the standard XFileSharing script (op=download1 → download2)
 * or the datanodes-style countdown component.
 */
const XFILESHARING_HOSTS = [
  { id: "datanodes", label: "DataNodes", domains: ["datanodes.to"] },
  { id: "racaty", label: "Racaty", domains: ["racaty.io", "racaty.net", "racaty.com"] },
  { id: "nopy", label: "Nopy", domains: ["nopy.to"] },
  { id: "sendcm", label: "Send.cm", domains: ["send.cm", "send.now"] },
  { id: "hexload", label: "HexUpload", domains: ["hexload.com", "hexupload.net"] },
  { id: "usersdrive", label: "UsersDrive", domains: ["usersdrive.com"] },
  { id: "dropapk", label: "Drop.download", domains: ["drop.download", "dropapk.to"] },
  { id: "fileupload", label: "File-Upload", domains: ["file-upload.org", "file-upload.com"] },
  { id: "uploadrar", label: "UploadRAR", domains: ["uploadrar.com"] },
  { id: "uploady", label: "Uploady", domains: ["uploady.io"] },
  { id: "dailyuploads", label: "DailyUploads", domains: ["dailyuploads.net"] },
  { id: "upload-io", label: "Up-load", domains: ["up-load.io"] },
  { id: "userupload", label: "UserUpload", domains: ["userupload.net", "userupload.in"] },
  { id: "uploadev", label: "Uploadev", domains: ["uploadev.org"] },
  { id: "filerio", label: "FileRio", domains: ["filerio.in"] },
  { id: "anonfiles-clone", label: "AnonFiles", domains: ["anonfile.de", "anonfiles.se", "anonfiles.com"] },
];

/** @type {MirrorHost[]} */
const MIRROR_HOSTS = [
  {
    id: "f95-masked",
    label: "F95zone masked link",
    support: "auto",
    internal: true,
    match: (parsedUrl) => isMaskedF95Link(parsedUrl),
    resolve: resolveMaskedF95Target,
  },
  {
    id: "f95-attachment",
    label: "F95zone attachment",
    support: "auto",
    match: (parsedUrl) => isF95AttachmentLink(parsedUrl),
    resolve: null,
  },
  {
    id: "google-drive",
    label: "Google Drive",
    support: "auto",
    domains: GOOGLE_DRIVE_DOMAINS,
    supportFor: (parsedUrl) =>
      isGoogleDriveFolderUrl(parsedUrl.toString()) ? "browser" : null,
    resolve: resolveGoogleDriveTarget,
    interpretTransferError: interpretGoogleDriveTransferError,
  },
  {
    id: "mega",
    label: "MEGA",
    support: "auto",
    domains: MEGA_DOMAINS,
    supportFor: (parsedUrl) => {
      const parsed = parseMegaUrl(parsedUrl.toString());
      return parsed && (parsed.kind === "protected" || !parsed.key) ? "browser" : null;
    },
    resolve: resolveMegaTarget,
    interpretTransferError: interpretMegaTransferError,
  },
  {
    id: "gofile",
    label: "Gofile",
    support: "auto",
    domains: ["gofile.io"],
    resolve: resolveGofileTarget,
  },
  {
    id: "pixeldrain",
    label: "Pixeldrain",
    support: "auto",
    domains: PIXELDRAIN_DOMAINS,
    resolve: resolvePixeldrainTarget,
    interpretTransferError: interpretPixeldrainTransferError,
  },
  {
    id: "mixdrop",
    label: "Mixdrop",
    support: "auto",
    match: (parsedUrl, hostname) => isMixdropHost(hostname),
    resolve: resolveMixdropTarget,
  },
  {
    id: "uploadhaven",
    label: "Uploadhaven",
    support: "auto",
    domains: ["uploadhaven.com"],
    resolve: resolveUploadhavenTarget,
  },
  {
    id: "buzzheavier",
    label: "Buzzheavier",
    support: "auto",
    domains: BUZZHEAVIER_DOMAINS,
    resolve: resolveBuzzheavierTarget,
  },
  {
    id: "mediafire",
    label: "MediaFire",
    support: "auto",
    domains: MEDIAFIRE_DOMAINS,
    resolve: resolveMediafireTarget,
  },
  {
    id: "workupload",
    label: "Workupload",
    support: "auto",
    domains: WORKUPLOAD_DOMAINS,
    supportFor: (parsedUrl) =>
      parseWorkuploadUrl(parsedUrl.toString())?.kind === "archive" ? "browser" : null,
    resolve: resolveWorkuploadTarget,
  },
  {
    id: "filesfm",
    label: "Files.fm",
    support: "auto",
    domains: FILESFM_DOMAINS,
    resolve: resolveFilesFmTarget,
  },
  {
    id: "krakenfiles",
    label: "Krakenfiles",
    support: "auto",
    domains: KRAKENFILES_DOMAINS,
    resolve: resolveKrakenfilesTarget,
  },
  {
    id: "qiwi",
    label: "Qiwi",
    support: "auto",
    domains: [...QIWI_DOMAINS, ...QIWI_STORAGE_DOMAINS],
    supportFor: (parsedUrl) =>
      parseQiwiUrl(parsedUrl.toString())?.kind === "folder" ? "browser" : null,
    resolve: (ctx, url) =>
      hostMatchesDomain(safeParseUrl(url)?.hostname || "", QIWI_STORAGE_DOMAINS)
        ? Promise.resolve({ url, transfer: "direct" })
        : resolveQiwiTarget(ctx, url),
  },
  {
    id: "dropbox",
    label: "Dropbox",
    support: "auto",
    domains: DROPBOX_DOMAINS,
    resolve: resolveDropboxTarget,
    interpretTransferError: interpretDropboxTransferError,
  },
  {
    id: "onedrive",
    label: "OneDrive",
    support: "auto",
    domains: ONEDRIVE_DOMAINS,
    resolve: resolveOneDriveTarget,
  },
  {
    id: "yandex-disk",
    label: "Yandex Disk",
    support: "auto",
    domains: YANDEX_DISK_DOMAINS,
    resolve: resolveYandexDiskTarget,
  },
  {
    id: "sendspace",
    label: "Sendspace",
    support: "auto",
    domains: ["sendspace.com"],
    resolve: resolveSendspaceTarget,
  },
  {
    id: "fuckingfast",
    label: "FuckingFast",
    support: "auto",
    domains: ["fuckingfast.co", "fuckingfast.net"],
    resolve: resolveFuckingFastTarget,
  },
  {
    id: "litterbox",
    label: "Litterbox",
    support: "auto",
    domains: ["litter.catbox.moe", "litterbox.catbox.moe"],
    resolve: null,
  },
  {
    id: "catbox",
    label: "Catbox",
    support: "auto",
    domains: ["catbox.moe"],
    supportFor: (parsedUrl) =>
      /^\/c\//i.test(parsedUrl.pathname) ? "browser" : null,
    resolve: (ctx, url) => {
      const parsedUrl = safeParseUrl(url);
      if (parsedUrl && /^\/c\//i.test(parsedUrl.pathname)) {
        return Promise.reject(
          createActionRequiredError(
            "Catbox",
            url,
            "link is an album. Download the game file from it manually.",
          ),
        );
      }
      return Promise.resolve({ url, transfer: "direct" });
    },
  },
  {
    id: "fileditch",
    label: "FileDitch",
    support: "auto",
    domains: ["fileditch.com", "fileditch.me", "fileditchfiles.me", "fileditchstuff.me"],
    resolve: null,
  },
  {
    id: "pomf",
    label: "Direct file host",
    support: "auto",
    domains: ["uguu.se", "qu.ax", "0x0.st", "pomf2.lain.la", "pomf.lain.la"],
    resolve: null,
  },
  ...XFILESHARING_HOSTS.map((host) => ({
    ...host,
    support: /** @type {HostSupport} */ ("auto"),
    resolve: (ctx, url) =>
      resolveGenericLandingTarget(ctx, url, { hostLabel: host.label }),
  })),
  ...BROWSER_ONLY_HOSTS.map((host) => ({
    id: host.id,
    label: host.label,
    domains: host.domains,
    support: /** @type {HostSupport} */ ("browser"),
    browserReason: host.reason,
    resolve: (ctx, url) =>
      Promise.reject(
        createActionRequiredError(host.label, url, host.reason),
      ),
  })),
];

const HOSTS_BY_ID = new Map(MIRROR_HOSTS.map((host) => [host.id, host]));

/**
 * @param {string | URL} value
 * @returns {MirrorHost | null}
 */
function findMirrorHost(value) {
  const parsedUrl = typeof value === "string" ? safeParseUrl(value) : value;
  if (!parsedUrl || !/^https?:$/i.test(parsedUrl.protocol)) {
    return null;
  }

  const hostname = normalizeHostname(parsedUrl.hostname);
  for (const host of MIRROR_HOSTS) {
    const matches = host.match
      ? host.match(parsedUrl, hostname)
      : hostMatchesDomain(hostname, host.domains || []);
    if (matches) {
      return host;
    }
  }

  return null;
}

function getMirrorHostById(hostId) {
  return HOSTS_BY_ID.get(String(hostId || "")) || null;
}

function parseUrlOrHost(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const parsedUrl = safeParseUrl(text);
  if (parsedUrl && /^https?:$/i.test(parsedUrl.protocol)) {
    return parsedUrl;
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(text)) {
    return safeParseUrl(`https://${text}`);
  }
  return null;
}

/**
 * Describe a mirror link for the UI.
 * @param {string} value URL or bare hostname
 * @returns {{host: string, hostId: string, label: string, supported: "auto" | "browser" | "unsupported", generic: boolean, masked: boolean, reason: string}}
 */
function getMirrorHostInfo(value) {
  const parsedUrl = parseUrlOrHost(value);
  if (!parsedUrl) {
    return {
      host: "",
      hostId: "",
      label: "",
      supported: "unsupported",
      generic: false,
      masked: false,
      reason: "",
    };
  }

  if (isMaskedF95Link(parsedUrl)) {
    const targetHost = extractMaskedTargetHost(parsedUrl);
    if (targetHost) {
      const targetInfo = getMirrorHostInfo(targetHost);
      return { ...targetInfo, masked: true };
    }
  }

  const hostname = normalizeHostname(parsedUrl.hostname);
  const host = findMirrorHost(parsedUrl);
  if (!host) {
    return {
      host: hostname,
      hostId: "",
      label: hostname,
      supported: "unsupported",
      generic: true,
      masked: false,
      reason:
        "No dedicated support for this host; F95Launcher will still try a generic download.",
    };
  }

  const supported = (host.supportFor && host.supportFor(parsedUrl)) || host.support;
  return {
    host: hostname,
    hostId: host.id,
    label: host.label,
    supported,
    generic: false,
    masked: host.id === "f95-masked",
    reason: supported === "browser" ? host.browserReason || "needs a manual step in the browser." : "",
  };
}

function isKnownMirrorHost(value) {
  const parsedUrl = parseUrlOrHost(value);
  return Boolean(parsedUrl && findMirrorHost(parsedUrl));
}

/**
 * Build the object handed to the transfer pipeline.
 * @param {string} requestedUrl
 * @param {{url: string, transfer?: string, headers?: Record<string, string>, fileName?: string, size?: number, rangeMode?: string, mega?: any}} target
 * @param {{hostId: string, hostLabel: string, mirrorHost: string}} origin
 */
function buildPreparedDownload(requestedUrl, target, origin) {
  const resolvedUrl = String(target.url || "").trim();
  const parsedResolved = safeParseUrl(resolvedUrl);
  if (!parsedResolved) {
    throw new MirrorError("The mirror returned an invalid download URL.", {
      code: "invalid_link",
    });
  }

  return {
    requestedUrl,
    resolvedUrl,
    sourceHost: normalizeHostname(parsedResolved.hostname),
    mirrorHost: origin.mirrorHost || normalizeHostname(parsedResolved.hostname),
    hostId: origin.hostId || "",
    hostLabel: origin.hostLabel || normalizeHostname(parsedResolved.hostname),
    transfer: target.transfer === "mega" ? "mega" : target.transfer === "session" ? "session" : "direct",
    rangeMode: target.rangeMode || (target.transfer === "mega" ? "mega-path" : "header"),
    headers: { ...(target.headers || {}) },
    fileName: String(target.fileName || "").trim(),
    size: Number(target.size) || 0,
    mega: target.mega || null,
  };
}

function summarizeError(error) {
  const message = String(error?.userMessage || error?.message || "temporary error");
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

/**
 * Resolve a mirror link (masked or direct) to a transfer target.
 * @param {ReturnType<typeof createResolverContext>} ctx
 * @param {string} rawUrl
 * @param {{attempts?: number, baseDelayMs?: number, maxDelayMs?: number}} [retry]
 */
async function resolveMirrorTarget(ctx, rawUrl, retry = {}) {
  const requestedUrl = String(rawUrl || "").trim();
  if (!safeParseUrl(requestedUrl)) {
    throw new MirrorError("The download link is not a valid URL.", {
      code: "invalid_link",
    });
  }

  let currentUrl = requestedUrl;
  let genericTried = false;
  const origin = { hostId: "", hostLabel: "", mirrorHost: "" };
  const visited = new Set();
  let currentHostId = "";

  ctx.continueOrFinal = (nextUrl) => {
    const nextHost = findMirrorHost(nextUrl);
    return nextHost && nextHost.resolve && nextHost.id !== currentHostId
      ? nextUrl
      : { url: nextUrl };
  };

  for (let hop = 0; hop < MAX_RESOLUTION_HOPS; hop += 1) {
    if (ctx.signal?.aborted) {
      throw new DownloadCancelledError();
    }

    const visitKey = currentUrl;
    if (visited.has(visitKey)) {
      break;
    }
    visited.add(visitKey);

    const parsedUrl = safeParseUrl(currentUrl);
    if (!parsedUrl) {
      throw new MirrorError("The mirror returned an invalid download URL.", {
        code: "invalid_link",
      });
    }

    const host = findMirrorHost(parsedUrl);
    if (host && !host.internal && !origin.hostId) {
      origin.hostId = host.id;
      origin.hostLabel = host.label;
      origin.mirrorHost = normalizeHostname(parsedUrl.hostname);
    }

    let resolver = null;
    let label = "";
    if (host) {
      if (!host.resolve) {
        return buildPreparedDownload(requestedUrl, { url: currentUrl }, origin);
      }
      resolver = host.resolve;
      label = host.label;
      currentHostId = host.id;
    } else {
      if (genericTried) {
        break;
      }
      genericTried = true;
      label = normalizeHostname(parsedUrl.hostname);
      currentHostId = "";
      if (!origin.mirrorHost) {
        origin.mirrorHost = label;
        origin.hostLabel = label;
      }
      resolver = (resolverCtx, url) =>
        resolveGenericLandingTarget(resolverCtx, url, { hostLabel: label });
    }

    ctx.report(`Resolving ${label} link`);
    const urlToResolve = currentUrl;
    const result = await withRetry(() => resolver(ctx, urlToResolve), {
      attempts: retry.attempts ?? 3,
      baseDelayMs: retry.baseDelayMs ?? 1500,
      maxDelayMs: retry.maxDelayMs ?? 15000,
      signal: ctx.signal || undefined,
      sleep: (ms) => ctx.sleep(ms),
      onRetry: ({ attempt, attempts, delayMs, error }) => {
        ctx.report(
          `${label}: ${summarizeError(error)} Retrying in ${Math.ceil(delayMs / 1000)}s (attempt ${attempt + 1}/${attempts})`,
        );
      },
    });

    if (result && typeof result === "object") {
      return buildPreparedDownload(requestedUrl, result, origin);
    }

    const nextUrl = String(result || "").trim();
    if (!nextUrl || nextUrl === currentUrl) {
      break;
    }
    currentUrl = nextUrl;
  }

  return buildPreparedDownload(requestedUrl, { url: currentUrl }, origin);
}

/**
 * Map an HTTP failure of the transfer to a host-specific error (captcha,
 * quota, expired link ...) when possible.
 * @param {{hostId?: string, requestedUrl?: string, hostLabel?: string}} prepared
 * @param {{status: number, bodyText: string, url: string}} info
 * @returns {Error | null}
 */
function interpretMirrorTransferError(prepared, info) {
  const host = getMirrorHostById(prepared?.hostId);
  const hostError =
    host && typeof host.interpretTransferError === "function"
      ? host.interpretTransferError(info)
      : null;
  if (hostError) {
    return hostError;
  }

  const bodyText = String(info?.bodyText || "");
  if (
    (info?.status === 403 || info?.status === 503 || info?.status === 429) &&
    (looksLikeCloudflareChallenge(bodyText) || detectCaptchaKind(bodyText))
  ) {
    return createActionRequiredError(
      prepared?.hostLabel || "This mirror",
      prepared?.requestedUrl || info?.url || "",
      "asks for a browser check (captcha / Cloudflare) before downloading.",
      "captcha_required",
    );
  }

  return null;
}

/**
 * Resolve `rawUrl` into a prepared download.
 * @param {any} session Electron session (or a stub with `fetch`)
 * @param {string} rawUrl
 * @param {{signal?: AbortSignal, onStatus?: (text: string) => void, sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, platformHint?: string, hostOptions?: Record<string, any>, retry?: {attempts?: number, baseDelayMs?: number, maxDelayMs?: number}, requestTimeoutMs?: number}} [options]
 */
async function prepareMirrorDownload(session, rawUrl, options = {}) {
  const ctx = createResolverContext({
    session,
    signal: options.signal,
    onStatus: options.onStatus,
    sleep: options.sleep,
    platformHint: options.platformHint,
    options: options.hostOptions || {},
    requestTimeoutMs: options.requestTimeoutMs,
  });
  return resolveMirrorTarget(ctx, rawUrl, options.retry || {});
}

module.exports = {
  BROWSER_ONLY_HOSTS,
  MIRROR_HOSTS,
  XFILESHARING_HOSTS,
  findMirrorHost,
  getMirrorHostById,
  getMirrorHostInfo,
  interpretMirrorTransferError,
  isKnownMirrorHost,
  prepareMirrorDownload,
  resolveMirrorTarget,
};
