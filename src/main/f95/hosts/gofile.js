const crypto = require("crypto");
const path = require("path");

const {
  MirrorError,
  assertNotSplitArchive,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  normalizeHostname,
  normalizeText,
  parseRetryAfterMs,
  getHeader,
  pickBestFile,
  readResponseJson,
  safeParseUrl,
} = require("./common");

const HOST_LABEL = "Gofile";
const GOFILE_CLIENT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const GOFILE_CLIENT_LANGUAGE = "en-US";
const GOFILE_STATIC_WEBSITE_TOKEN = "4fd6sg89d7s6";
const GOFILE_WT_WINDOW_SECONDS = 14400;
const GOFILE_ACCOUNT_TTL_MS = 6 * 60 * 60 * 1000;
const GOFILE_RATE_LIMIT_RETRY_MS = 15000;

/** @type {WeakMap<object, {token: string, createdAt: number}>} */
const gofileAccountCache = new WeakMap();
const detachedSessionKey = {};

function getCacheKey(ctx) {
  return ctx?.session && typeof ctx.session === "object"
    ? ctx.session
    : detachedSessionKey;
}

function extractGofileContentId(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (normalizeHostname(parsedUrl.hostname) !== "gofile.io") {
      return "";
    }

    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    if (segments.length >= 2 && segments[0].toLowerCase() === "d") {
      return segments[1];
    }

    if (
      segments.length >= 3 &&
      segments[0].toLowerCase() === "download" &&
      segments[1].toLowerCase() === "web"
    ) {
      return segments[2];
    }

    if (segments.length >= 2 && segments[0].toLowerCase() === "file") {
      return segments[1];
    }

    return "";
  } catch {
    return "";
  }
}

function extractGofileFileNameHint(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl) {
    return "";
  }

  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  if (
    segments.length >= 4 &&
    segments[0].toLowerCase() === "download" &&
    segments[1].toLowerCase() === "web"
  ) {
    try {
      return decodeURIComponent(segments.slice(3).join("/"));
    } catch {
      return segments.slice(3).join("/");
    }
  }

  return "";
}

function generateGofileWebsiteToken(token, salt, options = {}) {
  const userAgent = options.userAgent || GOFILE_CLIENT_USER_AGENT;
  const language = options.language || GOFILE_CLIENT_LANGUAGE;
  const nowMs = typeof options.nowMs === "number" ? options.nowMs : Date.now();
  const windowBucket = Math.floor(
    Math.floor(nowMs / 1000) / GOFILE_WT_WINDOW_SECONDS,
  ).toString();
  const signatureInput = `${userAgent}::${language}::${token}::${windowBucket}::${salt}`;

  return crypto.createHash("sha256").update(signatureInput).digest("hex");
}

function createGofileUnavailableError() {
  return new MirrorError(
    "Gofile API is not responding (connection closed or timed out). Gofile may be temporarily rate-limiting your IP. Try again in a few minutes or use a different mirror.",
    { code: "network", retryable: true },
  );
}

async function createGofileGuestToken(ctx) {
  let response;
  try {
    response = await ctx.fetch("https://api.gofile.io/accounts", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": GOFILE_CLIENT_USER_AGENT,
        origin: "https://gofile.io",
        referer: "https://gofile.io/",
      },
      body: "{}",
    });
  } catch (error) {
    if (error?.code === "cancelled") {
      throw error;
    }
    throw createGofileUnavailableError();
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    if (response.status === 429) {
      throw createGofileRateLimitError(response);
    }
    throw new MirrorError(
      `Gofile account bootstrap failed with HTTP ${response.status}.`,
      {
        code: "http_error",
        status: response.status,
        retryable: response.status >= 500,
      },
    );
  }

  const payload = await readResponseJson(response);
  const token = payload?.data?.token;
  if (!token) {
    throw new MirrorError("Gofile did not return a guest access token.", {
      code: "gofile_token",
      retryable: true,
    });
  }

  return token;
}

async function syncGofileGuestAccount(ctx, token) {
  let response;
  try {
    response = await ctx.fetch("https://api.gofile.io/accounts/website", {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": GOFILE_CLIENT_USER_AGENT,
        origin: "https://gofile.io",
        referer: "https://gofile.io/",
      },
    });
  } catch (error) {
    if (error?.code === "cancelled") {
      throw error;
    }
    throw createGofileUnavailableError();
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    throw new MirrorError(
      `Gofile account sync failed with HTTP ${response.status}.`,
      {
        code: "http_error",
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
      },
    );
  }

  const payload = await readResponseJson(response);
  if (payload?.status !== "ok" || !payload?.data?.token) {
    throw new MirrorError("Gofile did not return a usable synced account.", {
      code: "gofile_token",
      retryable: true,
    });
  }

  return payload.data;
}

async function fetchGofileWebsiteToken(ctx) {
  try {
    const response = await ctx.fetch("https://gofile.io/dist/js/config.js", {
      method: "GET",
      headers: { "user-agent": GOFILE_CLIENT_USER_AGENT },
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      return { token: GOFILE_STATIC_WEBSITE_TOKEN, salt: "" };
    }

    const js = await response.text();
    const wtMatch = js.match(
      /\bwebsiteToken\s*[:=]\s*["']([a-zA-Z0-9_-]+)["']/,
    );
    if (wtMatch) {
      return { token: wtMatch[1], salt: "" };
    }

    const saltMatch = js.match(/\bsalt\s*[:=]\s*["']([a-zA-Z0-9_-]+)["']/);
    if (saltMatch) {
      return { token: "", salt: saltMatch[1] };
    }

    return { token: GOFILE_STATIC_WEBSITE_TOKEN, salt: "" };
  } catch (error) {
    if (error?.code === "cancelled") {
      throw error;
    }
    return { token: GOFILE_STATIC_WEBSITE_TOKEN, salt: "" };
  }
}

async function getGofileAccountToken(ctx, options = {}) {
  const cacheKey = getCacheKey(ctx);
  const cached = gofileAccountCache.get(cacheKey);
  if (
    !options.forceRefresh &&
    cached &&
    Date.now() - cached.createdAt < GOFILE_ACCOUNT_TTL_MS
  ) {
    return cached.token;
  }

  const guestToken = await createGofileGuestToken(ctx);
  const account = await syncGofileGuestAccount(ctx, guestToken);
  gofileAccountCache.set(cacheKey, {
    token: account.token,
    createdAt: Date.now(),
  });

  if (ctx.session?.cookies?.set) {
    try {
      await ctx.session.cookies.set({
        url: "https://gofile.io",
        name: "accountToken",
        value: account.token,
        domain: ".gofile.io",
      });
    } catch {
      // Best-effort cookie injection for CDN downloads.
    }
  }

  return account.token;
}

function computeWebsiteToken(wtInfo, accountToken) {
  return wtInfo.token
    ? wtInfo.token
    : generateGofileWebsiteToken(accountToken, wtInfo.salt, {
        userAgent: GOFILE_CLIENT_USER_AGENT,
        language: GOFILE_CLIENT_LANGUAGE,
      });
}

async function fetchGofileContents(ctx, contentId, accountToken, websiteToken) {
  return ctx.fetch(
    `https://api.gofile.io/contents/${encodeURIComponent(contentId)}`,
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accountToken}`,
        "x-website-token": websiteToken,
        "x-bl": GOFILE_CLIENT_LANGUAGE,
        "user-agent": GOFILE_CLIENT_USER_AGENT,
        origin: "https://gofile.io",
        referer: "https://gofile.io/",
      },
    },
  );
}

function createGofileRateLimitError(response) {
  return new MirrorError(
    "Gofile is rate-limiting requests right now. F95Launcher will retry automatically; if it keeps failing, wait a few minutes or pick another mirror.",
    {
      code: "rate_limited",
      status: 429,
      retryable: true,
      retryAfterMs:
        parseRetryAfterMs(getHeader(response, "retry-after")) ||
        GOFILE_RATE_LIMIT_RETRY_MS,
    },
  );
}

function fileNameFromLink(link) {
  const parsedUrl = safeParseUrl(link);
  if (!parsedUrl) {
    return "";
  }
  try {
    return decodeURIComponent(path.posix.basename(parsedUrl.pathname));
  } catch {
    return path.posix.basename(parsedUrl.pathname);
  }
}

/**
 * Flatten a Gofile content tree into downloadable files.
 * @param {any} node
 * @param {Array<{name: string, size: number, link: string}>} [output]
 * @param {number} [depth]
 */
function collectGofileFiles(node, output = [], depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) {
    return output;
  }

  const normalizedType = normalizeText(node.type).toLowerCase();
  if (normalizedType === "file") {
    const link =
      (typeof node.directLink === "string" && node.directLink.trim()) ||
      (typeof node.link === "string" && node.link.trim()) ||
      "";
    if (link) {
      output.push({
        name: normalizeText(node.name) || fileNameFromLink(link),
        size: Number(node.size) || 0,
        link,
      });
    }
    return output;
  }

  const children = Array.isArray(node.children)
    ? node.children
    : node.children && typeof node.children === "object"
      ? Object.values(node.children)
      : [];
  for (const child of children) {
    collectGofileFiles(child, output, depth + 1);
  }

  return output;
}

function extractFallbackDirectLink(data) {
  if (data?.directLinks && typeof data.directLinks === "object") {
    for (const directLink of Object.values(data.directLinks)) {
      if (typeof directLink === "string" && directLink.trim()) {
        return directLink.trim();
      }
      if (directLink && typeof directLink === "object") {
        const nestedLink = directLink.directLink || directLink.link || "";
        if (typeof nestedLink === "string" && nestedLink.trim()) {
          return nestedLink.trim();
        }
      }
    }
  }

  return "";
}

/**
 * @param {any} ctx
 * @param {string} rawUrl
 */
async function resolveGofileTarget(ctx, rawUrl) {
  const contentId = extractGofileContentId(rawUrl);
  if (!contentId) {
    return rawUrl;
  }

  let accountToken = await getGofileAccountToken(ctx);
  let wtInfo = await fetchGofileWebsiteToken(ctx);
  let websiteToken = computeWebsiteToken(wtInfo, accountToken);
  let refreshed = false;
  let triedStaticToken = false;
  let lastFailure = "";
  let payload = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchGofileContents(
      ctx,
      contentId,
      accountToken,
      websiteToken,
    );
    const status = Number(response.status) || (response.ok ? 200 : 0);

    if (status === 429) {
      await cancelResponseBody(response);
      throw createGofileRateLimitError(response);
    }

    if (status === 401 || status === 403) {
      await cancelResponseBody(response);
      lastFailure = "auth";
      if (!triedStaticToken && websiteToken !== GOFILE_STATIC_WEBSITE_TOKEN) {
        triedStaticToken = true;
        websiteToken = GOFILE_STATIC_WEBSITE_TOKEN;
        continue;
      }
      if (!refreshed) {
        refreshed = true;
        accountToken = await getGofileAccountToken(ctx, { forceRefresh: true });
        wtInfo = await fetchGofileWebsiteToken(ctx);
        websiteToken = computeWebsiteToken(wtInfo, accountToken);
        continue;
      }
      break;
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      if (status === 404) {
        throw new MirrorError("This Gofile mirror no longer exists.", {
          code: "not_found",
          status,
        });
      }
      throw createHttpError(response, HOST_LABEL);
    }

    payload = await readResponseJson(response);
    const payloadStatus = String(payload?.status || "");

    if (!payloadStatus || payloadStatus === "ok") {
      lastFailure = "";
      break;
    }

    if (payloadStatus === "error-notPremium") {
      lastFailure = "notPremium";
      if (!refreshed) {
        refreshed = true;
        accountToken = await getGofileAccountToken(ctx, { forceRefresh: true });
        wtInfo = await fetchGofileWebsiteToken(ctx);
        websiteToken = computeWebsiteToken(wtInfo, accountToken);
        continue;
      }
      if (!triedStaticToken && websiteToken !== GOFILE_STATIC_WEBSITE_TOKEN) {
        triedStaticToken = true;
        websiteToken = GOFILE_STATIC_WEBSITE_TOKEN;
        continue;
      }
      break;
    }

    if (payloadStatus === "error-rateLimit") {
      throw createGofileRateLimitError(response);
    }

    if (payloadStatus === "error-notFound") {
      throw new MirrorError("This Gofile mirror no longer exists.", {
        code: "not_found",
      });
    }

    if (/password/i.test(payloadStatus)) {
      throw new MirrorError(
        "This Gofile mirror is password-protected, which F95Launcher cannot install automatically. Pick another mirror.",
        { code: "password_required" },
      );
    }

    if (/notPublic|disabled|banned|blocked/i.test(payloadStatus)) {
      throw new MirrorError(
        `Gofile refused access to this mirror (${payloadStatus}). Pick another mirror.`,
        { code: "access_denied" },
      );
    }

    throw new MirrorError(payloadStatus || "Gofile content lookup failed.", {
      code: "gofile_error",
    });
  }

  if (lastFailure === "auth") {
    throw new MirrorError(
      "Gofile rejected the request (authentication failed). The website token may have changed. Try again later or use a different mirror.",
      { code: "access_denied", retryable: false },
    );
  }

  if (lastFailure === "notPremium") {
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "only allows this mirror from its website right now (premium-only API response).",
    );
  }

  const data = payload?.data || {};
  const files = collectGofileFiles(data);
  const selectedFile = pickBestFile(files, {
    preferredName: extractGofileFileNameHint(rawUrl),
    platformHint: ctx.platformHint,
  });

  if (selectedFile) {
    assertNotSplitArchive(selectedFile, files, HOST_LABEL);
    return {
      url: selectedFile.link,
      fileName: selectedFile.name,
      size: selectedFile.size,
      transfer: "direct",
    };
  }

  const fallbackLink = extractFallbackDirectLink(data);
  if (fallbackLink) {
    return { url: fallbackLink, transfer: "direct" };
  }

  throw new MirrorError(
    "Gofile did not expose a downloadable file URL for this mirror.",
    { code: "no_file" },
  );
}

module.exports = {
  GOFILE_CLIENT_USER_AGENT,
  GOFILE_STATIC_WEBSITE_TOKEN,
  HOST_LABEL,
  collectGofileFiles,
  extractGofileContentId,
  generateGofileWebsiteToken,
  resolveGofileTarget,
};
