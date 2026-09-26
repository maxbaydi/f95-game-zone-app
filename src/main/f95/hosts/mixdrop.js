const {
  MirrorError,
  buildAbsoluteUrl,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  hostMatchesDomain,
  isFileResponse,
  normalizeHostname,
  readResponseText,
  safeParseUrl,
} = require("./common");

const HOST_LABEL = "Mixdrop";
const MAX_PACKED_KEYWORD_COUNT = 10000;

// Mixdrop rotates through many TLDs and look-alike domains.
const MIXDROP_HOST_PATTERN =
  /(?:^|\.)(?:mixdrop|mixdrp|m1xdrop|mixdropjmk|mxdrop)[a-z0-9-]*\.[a-z]{2,}$/i;
const MIXDROP_ALIAS_DOMAINS = [
  "md3b0j6hj.com",
  "mdbekjwqa.pw",
  "mdfx9dc8n.net",
  "mdzsmutpcvykb.net",
  "mdy48tn97.com",
];

function isMixdropHost(hostname) {
  const normalizedHost = normalizeHostname(hostname);
  return (
    MIXDROP_HOST_PATTERN.test(normalizedHost) ||
    hostMatchesDomain(normalizedHost, MIXDROP_ALIAS_DOMAINS)
  );
}

function extractMixdropFileRef(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (!isMixdropHost(parsedUrl.hostname)) {
      return "";
    }

    const match = parsedUrl.pathname.match(/^\/[ef]\/([a-zA-Z0-9]+)/i);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function unpackDeanEdwardsPackedJs(packed) {
  const argsMatch = String(packed || "").match(
    /}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\.split\s*\(\s*'\|'\s*\)/,
  );
  if (!argsMatch) {
    return "";
  }

  const payload = argsMatch[1].replace(/\\(.)/g, (_, char) => char);
  const radix = parseInt(argsMatch[2], 10);
  const count = parseInt(argsMatch[3], 10);
  const keywords = argsMatch[4].split("|");

  if (
    !Number.isSafeInteger(radix) ||
    radix < 2 ||
    radix > 62 ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > MAX_PACKED_KEYWORD_COUNT ||
    keywords.length === 0
  ) {
    return "";
  }

  function baseEncode(value) {
    const remainder = value % radix;
    const prefix = value >= radix ? baseEncode(Math.floor(value / radix)) : "";
    const digit =
      remainder > 35
        ? String.fromCharCode(remainder + 29)
        : remainder.toString(36);
    return prefix + digit;
  }

  const dict = {};
  for (let i = 0; i < count; i++) {
    const token = baseEncode(i);
    dict[token] = keywords[i] || token;
  }

  return payload.replace(/\b\w+\b/g, (token) => dict[token] || token);
}

function normalizeProtocolRelative(value) {
  return value.startsWith("//") ? `https:${value}` : value;
}

function extractMixdropDownloadUrl(html) {
  const sources = [String(html || "")];
  const unpacked = unpackDeanEdwardsPackedJs(html);
  if (unpacked) {
    sources.unshift(unpacked);
  }

  for (const source of sources) {
    const wurlMatch = source.match(/\bwurl\s*=\s*"([^"]+)"/);
    if (wurlMatch) {
      return normalizeProtocolRelative(wurlMatch[1]);
    }
  }

  if (unpacked) {
    const mdCoreMatches = [...unpacked.matchAll(/MDCore\.\w+\s*=\s*"([^"]+)"/g)];
    for (const [, value] of mdCoreMatches) {
      if (
        /\/(?:dl|d|f|download)\//i.test(value) ||
        /\.\w{2,4}(?:\?|$)/.test(value)
      ) {
        return normalizeProtocolRelative(value);
      }
    }
  }

  return "";
}

function buildMixdropFileUrl(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl) {
    return rawUrl;
  }
  parsedUrl.pathname = parsedUrl.pathname.replace(/^\/e\//i, "/f/");
  return parsedUrl.toString();
}

function buildMixdropDownloadPageUrl(fileUrl) {
  const parsedUrl = safeParseUrl(fileUrl);
  if (!parsedUrl) {
    return "";
  }
  parsedUrl.search = "?download";
  parsedUrl.hash = "";
  return parsedUrl.toString();
}

/**
 * @param {any} ctx
 * @param {string} rawUrl
 * @param {Set<string>} [seenUrls]
 * @returns {Promise<string | {url: string, headers: Record<string, string>, transfer: string}>}
 */
async function resolveMixdropTarget(ctx, rawUrl, seenUrls = new Set()) {
  if (!extractMixdropFileRef(rawUrl)) {
    return rawUrl;
  }

  if (seenUrls.has(rawUrl)) {
    return rawUrl;
  }
  seenUrls.add(rawUrl);

  const fileUrl = buildMixdropFileUrl(rawUrl);
  const pageCandidates = [fileUrl, buildMixdropDownloadPageUrl(fileUrl)].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  );

  for (const pageUrl of pageCandidates) {
    const response = await ctx.fetch(pageUrl, {
      method: "GET",
      redirect: "follow",
      headers: { referer: fileUrl },
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      if (response.status === 404) {
        throw new MirrorError(
          "This Mixdrop mirror no longer exists or was removed.",
          { code: "not_found", status: 404 },
        );
      }
      throw createHttpError(response, HOST_LABEL);
    }

    const finalPageUrl = response.url || pageUrl;
    if (response.headers && isFileResponse(response)) {
      await cancelResponseBody(response);
      return {
        url: finalPageUrl,
        headers: { referer: fileUrl },
        transfer: "direct",
      };
    }

    const html = await readResponseText(response);

    if (/WE ARE SORRY/i.test(html)) {
      throw new MirrorError(
        "This Mixdrop mirror no longer exists or was removed.",
        { code: "not_found" },
      );
    }

    if (
      /cf-browser-verification|challenge-platform|cf-turnstile|just a moment/i.test(
        html,
      )
    ) {
      throw createActionRequiredError(
        HOST_LABEL,
        fileUrl,
        "requires browser verification (Cloudflare) before downloading.",
      );
    }

    const redirectMatch = html.match(/\bwindow\.location\s*=\s*['"]([^'"]+)['"]/);
    if (redirectMatch) {
      const redirectUrl = buildAbsoluteUrl(finalPageUrl, redirectMatch[1]);
      if (redirectUrl && !seenUrls.has(redirectUrl) && extractMixdropFileRef(redirectUrl)) {
        return resolveMixdropTarget(ctx, redirectUrl, seenUrls);
      }
    }

    const downloadUrl = extractMixdropDownloadUrl(html);
    if (downloadUrl) {
      return {
        url: downloadUrl,
        headers: { referer: finalPageUrl },
        transfer: "direct",
      };
    }

    // Since 2026 the DOWNLOAD button carries a Cloudflare Turnstile site key
    // (data-cf-key) and the delivery URL is only handed out after the widget
    // passes; there is no packed script to unpack any more.
    if (hasTurnstileDownloadButton(html)) {
      throw createActionRequiredError(
        HOST_LABEL,
        finalPageUrl,
        "protects its download button with a Cloudflare Turnstile check. Press DOWNLOAD in the browser window; the file is picked up automatically.",
        "captcha_required",
      );
    }
  }

  throw createActionRequiredError(
    HOST_LABEL,
    fileUrl,
    "page could not be parsed automatically.",
  );
}

/**
 * @param {string} html
 */
function hasTurnstileDownloadButton(html) {
  return /data-cf-key\s*=|class="[^"]*download-btn[^"]*"[^>]*data-cf|challenges\.cloudflare\.com\/turnstile/i.test(
    String(html || ""),
  );
}

module.exports = {
  HOST_LABEL,
  extractMixdropFileRef,
  hasTurnstileDownloadButton,
  isMixdropHost,
  resolveMixdropTarget,
  unpackDeanEdwardsPackedJs,
};
