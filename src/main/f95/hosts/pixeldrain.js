const {
  MirrorActionRequiredError,
  MirrorError,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  hostMatchesDomain,
  normalizeHostname,
  normalizeText,
  readResponseJson,
  safeParseUrl,
} = require("./common");

const HOST_LABEL = "Pixeldrain";
const PIXELDRAIN_DOMAINS = [
  "pixeldrain.com",
  "pixeldrain.net",
  "pixeldrain.dev",
  "pixeldra.in",
];

function isPixeldrainHost(hostname) {
  return hostMatchesDomain(hostname, PIXELDRAIN_DOMAINS);
}

function getPixeldrainOrigin(parsedUrl) {
  const hostname = normalizeHostname(parsedUrl.hostname);
  if (hostname === "pixeldra.in") {
    return "https://pixeldrain.com";
  }
  return `https://${hostname}`;
}

/**
 * @param {string} rawUrl
 * @returns {{kind: "file" | "list", id: string, origin: string, itemIndex: number} | null}
 */
function parsePixeldrainUrl(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl || !isPixeldrainHost(parsedUrl.hostname)) {
    return null;
  }

  const origin = getPixeldrainOrigin(parsedUrl);
  const fileMatch =
    parsedUrl.pathname.match(/^\/u\/([^/?#]+)/i) ||
    parsedUrl.pathname.match(/^\/api\/file\/([^/?#]+)/i);
  if (fileMatch) {
    return { kind: "file", id: fileMatch[1], origin, itemIndex: -1 };
  }

  const listMatch =
    parsedUrl.pathname.match(/^\/l\/([^/?#]+)/i) ||
    parsedUrl.pathname.match(/^\/api\/list\/([^/?#]+)/i);
  if (listMatch) {
    const itemMatch = String(parsedUrl.hash || "").match(/item=(\d+)/i);
    return {
      kind: "list",
      id: listMatch[1],
      origin,
      itemIndex: itemMatch ? Number(itemMatch[1]) : -1,
    };
  }

  return null;
}

function buildPixeldrainFileDownloadUrl(origin, id) {
  const directUrl = new URL(`${origin}/api/file/${id}`);
  directUrl.searchParams.set("download", "");
  return directUrl.toString();
}

/**
 * Synchronous rewrite of Pixeldrain viewer links to the direct API endpoint.
 * List links are left untouched (they need an API call, see
 * resolvePixeldrainTarget).
 * @param {string} rawUrl
 */
function resolveKnownFileHostUrl(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl || !isPixeldrainHost(parsedUrl.hostname)) {
    return rawUrl;
  }

  const fileMatch = parsedUrl.pathname.match(/^\/u\/([^/?#]+)/i);
  if (fileMatch) {
    return buildPixeldrainFileDownloadUrl(
      getPixeldrainOrigin(parsedUrl),
      fileMatch[1],
    );
  }

  const apiMatch = parsedUrl.pathname.match(/^\/api\/file\/([^/?#]+)\/?$/i);
  if (apiMatch) {
    parsedUrl.searchParams.set("download", "");
    return parsedUrl.toString();
  }

  return rawUrl;
}

function createPixeldrainCaptchaError(viewerUrl, message) {
  const reason = normalizeText(message)
    ? `limits this file right now (${normalizeText(message)}) and asks for a captcha.`
    : "asks for a captcha before this file can be downloaded (rate limit / hotlink protection).";
  return createActionRequiredError(
    HOST_LABEL,
    viewerUrl,
    reason,
    "captcha_required",
  );
}

function interpretAvailability(info, viewerUrl) {
  const availability = normalizeText(info?.availability).toLowerCase();
  if (!availability) {
    return null;
  }

  if (/captcha|rate_limit|limited/.test(availability)) {
    return createPixeldrainCaptchaError(
      viewerUrl,
      info?.availability_message || "",
    );
  }

  if (/banned|blocked|removed|copyright|abuse|virus|malware/.test(availability)) {
    return new MirrorError(
      `Pixeldrain blocked this file (${availability}). Pick another mirror.`,
      { code: "blocked" },
    );
  }

  return null;
}

async function fetchPixeldrainFileInfo(ctx, origin, id) {
  let response;
  try {
    response = await ctx.fetch(`${origin}/api/file/${id}/info`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
  } catch (error) {
    if (error?.code === "cancelled" || error instanceof MirrorActionRequiredError) {
      throw error;
    }
    // Info is only used for pre-flight checks; the transfer will surface
    // real network problems with retries.
    return null;
  }

  if (response.status === 404) {
    await cancelResponseBody(response);
    throw new MirrorError("This Pixeldrain file no longer exists.", {
      code: "not_found",
      status: 404,
    });
  }

  const payload = await readResponseJson(response);
  if (!response.ok) {
    if (payload?.value === "not_found") {
      throw new MirrorError("This Pixeldrain file no longer exists.", {
        code: "not_found",
        status: response.status,
      });
    }
    if (response.status === 429 || response.status >= 500) {
      throw createHttpError(response, HOST_LABEL);
    }
    return null;
  }

  return payload && typeof payload === "object" ? payload : null;
}

async function resolvePixeldrainFile(ctx, origin, id) {
  const viewerUrl = `${origin}/u/${id}`;
  const info = await fetchPixeldrainFileInfo(ctx, origin, id);
  if (info?.success === false && info?.value === "not_found") {
    throw new MirrorError("This Pixeldrain file no longer exists.", {
      code: "not_found",
    });
  }

  const availabilityError = interpretAvailability(info, viewerUrl);
  if (availabilityError) {
    throw availabilityError;
  }

  return {
    url: buildPixeldrainFileDownloadUrl(origin, id),
    fileName: normalizeText(info?.name),
    size: Number(info?.size) || 0,
    transfer: "direct",
  };
}

/**
 * @param {any} ctx
 * @param {string} rawUrl
 */
async function resolvePixeldrainTarget(ctx, rawUrl) {
  const parsed = parsePixeldrainUrl(rawUrl);
  if (!parsed) {
    return rawUrl;
  }

  if (parsed.kind === "file") {
    return resolvePixeldrainFile(ctx, parsed.origin, parsed.id);
  }

  const response = await ctx.fetch(`${parsed.origin}/api/list/${parsed.id}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (response.status === 404) {
    await cancelResponseBody(response);
    throw new MirrorError("This Pixeldrain list no longer exists.", {
      code: "not_found",
      status: 404,
    });
  }
  if (!response.ok) {
    await cancelResponseBody(response);
    throw createHttpError(response, HOST_LABEL);
  }

  const payload = await readResponseJson(response);
  const files = Array.isArray(payload?.files) ? payload.files : [];
  if (payload?.success === false || files.length === 0) {
    throw new MirrorError(
      payload?.value === "not_found"
        ? "This Pixeldrain list no longer exists."
        : "This Pixeldrain list is empty.",
      { code: "not_found" },
    );
  }

  const indexedFile =
    parsed.itemIndex >= 0 && parsed.itemIndex < files.length
      ? files[parsed.itemIndex]
      : null;
  const singleFile = indexedFile || (files.length === 1 ? files[0] : null);
  if (singleFile?.id) {
    return resolvePixeldrainFile(ctx, parsed.origin, String(singleFile.id));
  }

  const listTitle = normalizeText(payload?.title) || parsed.id;
  return {
    url: `${parsed.origin}/api/list/${parsed.id}/zip`,
    fileName: `${listTitle.replace(/[<>:"/\\|?*]+/g, "_")}.zip`,
    transfer: "direct",
  };
}

/**
 * Pixeldrain answers API downloads with 403 + JSON when the file is rate
 * limited and needs a captcha in the browser.
 * @param {{status: number, bodyText?: string, url?: string}} info
 */
function interpretPixeldrainTransferError(info) {
  const bodyText = String(info?.bodyText || "");
  if (!/captcha|rate_limit|limited/i.test(bodyText)) {
    return null;
  }

  const parsedUrl = safeParseUrl(info?.url || "");
  const fileMatch = parsedUrl?.pathname.match(/^\/api\/file\/([^/?#]+)/i);
  const viewerUrl =
    parsedUrl && fileMatch
      ? `${getPixeldrainOrigin(parsedUrl)}/u/${fileMatch[1]}`
      : info?.url || "";
  let message = "";
  try {
    message = JSON.parse(bodyText)?.message || "";
  } catch {
    message = "";
  }
  return createPixeldrainCaptchaError(viewerUrl, message);
}

module.exports = {
  HOST_LABEL,
  PIXELDRAIN_DOMAINS,
  interpretPixeldrainTransferError,
  isPixeldrainHost,
  parsePixeldrainUrl,
  resolveKnownFileHostUrl,
  resolvePixeldrainTarget,
};
