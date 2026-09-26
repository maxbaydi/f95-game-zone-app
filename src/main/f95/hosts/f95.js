const {
  MirrorActionRequiredError,
  MirrorError,
  cancelResponseBody,
  createHttpError,
  getHeader,
  looksLikeCloudflareChallenge,
  normalizeHostname,
  readResponseText,
  safeParseUrl,
} = require("./common");

const F95_MASKED_CAPTCHA_MESSAGE =
  "This mirror needs captcha confirmation before F95Launcher can continue. Finish the captcha, then retry the install.";

function isF95Hostname(hostname) {
  return /(^|\.)f95zone\.to$/i.test(normalizeHostname(hostname));
}

function isMaskedF95Link(parsedUrl) {
  return Boolean(
    parsedUrl && isF95Hostname(parsedUrl.hostname) && /\/masked\//i.test(parsedUrl.pathname),
  );
}

function isF95AttachmentLink(parsedUrl) {
  return Boolean(
    parsedUrl &&
      isF95Hostname(parsedUrl.hostname) &&
      /\/attachments\//i.test(parsedUrl.pathname),
  );
}

/**
 * F95 masked links usually carry the target host in the path:
 * `/masked/mega.nz/2/123456/AbCdEf`.
 * @param {string | URL} value
 */
function extractMaskedTargetHost(value) {
  const parsedUrl = typeof value === "string" ? safeParseUrl(value) : value;
  if (!isMaskedF95Link(parsedUrl)) {
    return "";
  }

  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  const maskedIndex = segments.findIndex((segment) => segment.toLowerCase() === "masked");
  const candidate = normalizeHostname(segments[maskedIndex + 1] || "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(candidate) ? candidate : "";
}

/**
 * @param {any} ctx
 * @param {string} maskedUrl
 */
async function resolveMaskedF95Target(ctx, maskedUrl) {
  const requestBody = new URLSearchParams({
    xhr: "1",
    download: "1",
  }).toString();

  const response = await ctx.fetch(maskedUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
    },
    body: requestBody,
  });

  if (!response.ok) {
    const status = Number(response.status) || 0;
    const body = status === 403 || status === 503 ? await readResponseText(response, 100000) : "";
    if (!body) {
      await cancelResponseBody(response);
    }
    if (body && looksLikeCloudflareChallenge(body)) {
      throw new MirrorActionRequiredError(F95_MASKED_CAPTCHA_MESSAGE, {
        code: "captcha_required",
        actionUrl: maskedUrl,
        userMessage: F95_MASKED_CAPTCHA_MESSAGE,
        hostLabel: "F95zone",
      });
    }
    const httpError = createHttpError(response, "F95zone");
    throw new MirrorError(`F95 masked link failed with HTTP ${status}.`, {
      code: httpError.code,
      status,
      retryable: httpError.retryable,
      retryAfterMs: httpError.retryAfterMs,
      userMessage: httpError.userMessage,
    });
  }

  let payload = null;
  const contentType = getHeader(response, "content-type");
  if (typeof response.json === "function" && !/text\/html/i.test(contentType)) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await readResponseText(response);
    try {
      payload = JSON.parse(text);
    } catch {
      if (looksLikeCloudflareChallenge(text)) {
        throw new MirrorActionRequiredError(F95_MASKED_CAPTCHA_MESSAGE, {
          code: "captcha_required",
          actionUrl: maskedUrl,
          userMessage: F95_MASKED_CAPTCHA_MESSAGE,
          hostLabel: "F95zone",
        });
      }
      payload = null;
    }
  }

  if (!payload || typeof payload !== "object") {
    throw new MirrorError("F95 masked link returned an invalid response.", {
      code: "invalid_response",
      retryable: true,
    });
  }

  if (payload.status === "ok" && payload.msg) {
    return String(payload.msg).trim();
  }

  if (payload.status === "captcha") {
    throw new MirrorActionRequiredError(
      "This masked F95 link now requires captcha confirmation. Open the mirror in the embedded browser and finish the captcha there.",
      {
        code: "captcha_required",
        actionUrl: maskedUrl,
        userMessage: F95_MASKED_CAPTCHA_MESSAGE,
        hostLabel: "F95zone",
      },
    );
  }

  throw new MirrorError(
    String(payload.msg || "F95 did not return a downloadable mirror for this thread."),
    { code: "masked_link_failed" },
  );
}

module.exports = {
  extractMaskedTargetHost,
  isF95AttachmentLink,
  isF95Hostname,
  isMaskedF95Link,
  resolveMaskedF95Target,
};
