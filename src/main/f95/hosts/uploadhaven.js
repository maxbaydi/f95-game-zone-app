const {
  MirrorError,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  detectCaptchaKind,
  extractHtmlForms,
  isFileResponse,
  normalizeHostname,
  parseHtmlTagAttributes,
  readResponseText,
  safeParseUrl,
} = require("./common");

const HOST_LABEL = "Uploadhaven";
const UPLOADHAVEN_SUBMIT_DELAY_MS = 5000;
const UPLOADHAVEN_MAX_DELAY_MS = 30000;

function isUploadhavenDownloadUrl(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  return Boolean(
    parsedUrl &&
      normalizeHostname(parsedUrl.hostname) === "uploadhaven.com" &&
      parsedUrl.pathname.startsWith("/download/"),
  );
}

function parseUploadhavenCountdownMs(html) {
  const text = String(html || "");
  const match =
    text.match(
      /(?:var|let|const)\s+(?:seconds|countdown|timer|count|timeLeft)\s*=\s*(\d{1,2})\b/i,
    ) ||
    text.match(
      /id\s*=\s*["'](?:countdown|timer|seconds)["'][^>]*>\s*(\d{1,2})\s*</i,
    ) ||
    text.match(/data-(?:seconds|countdown)\s*=\s*["'](\d{1,2})["']/i);
  return match ? Number(match[1]) * 1000 : 0;
}

function collectHiddenFields(html) {
  const hiddenFields = {};
  const inputPattern = /<input\b([^>]*)>/gi;
  let inputMatch = null;
  while ((inputMatch = inputPattern.exec(html))) {
    const attrs = parseHtmlTagAttributes(inputMatch[1]);
    if ((attrs.type || "").toLowerCase() === "hidden" && attrs.name) {
      hiddenFields[attrs.name] = attrs.value || "";
    }
  }

  if (!hiddenFields._token) {
    const metaCsrf = html.match(
      /<meta\b[^>]*name\s*=\s*["']csrf-token["'][^>]*content\s*=\s*["']([^"']+)["']/i,
    );
    if (metaCsrf) {
      hiddenFields._token = metaCsrf[1];
    }
  }

  return hiddenFields;
}

/**
 * @param {any} ctx
 * @param {string} rawUrl
 * @param {{delayMs?: number}} [options]
 */
async function resolveUploadhavenTarget(ctx, rawUrl, options = {}) {
  if (!isUploadhavenDownloadUrl(rawUrl)) {
    return rawUrl;
  }

  const response = await ctx.fetch(rawUrl, {
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    await cancelResponseBody(response);
    if (response.status === 404 || response.status === 410) {
      throw new MirrorError(
        "This Uploadhaven mirror no longer exists or was removed.",
        { code: "not_found", status: response.status },
      );
    }
    throw createHttpError(response, HOST_LABEL);
  }

  const finalUrl = response.url || rawUrl;
  if (isFileResponse(response)) {
    await cancelResponseBody(response);
    return { url: finalUrl, transfer: "direct" };
  }

  const html = await readResponseText(response);

  if (/file not found|no longer available|has been removed/i.test(html)) {
    throw new MirrorError(
      "This Uploadhaven mirror no longer exists or was removed.",
      { code: "not_found" },
    );
  }

  const downloadForm =
    extractHtmlForms(html, finalUrl).find((form) =>
      Object.prototype.hasOwnProperty.call(form.fields, "_token"),
    ) || null;
  if (downloadForm && detectCaptchaKind(downloadForm.innerHtml)) {
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "asks for a captcha before the free download.",
      "captcha_required",
    );
  }

  const hiddenFields = collectHiddenFields(html);
  if (!hiddenFields._token) {
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "page did not contain the expected download form.",
    );
  }

  const configuredDelay =
    typeof options.delayMs === "number"
      ? options.delayMs
      : typeof ctx.options?.uploadhavenDelayMs === "number"
        ? ctx.options.uploadhavenDelayMs
        : Math.min(
            UPLOADHAVEN_MAX_DELAY_MS,
            Math.max(UPLOADHAVEN_SUBMIT_DELAY_MS, parseUploadhavenCountdownMs(html)),
          );
  if (configuredDelay > 0) {
    ctx.report(
      `Waiting ${Math.ceil(configuredDelay / 1000)}s for the Uploadhaven countdown`,
    );
    await ctx.sleep(configuredDelay);
  }

  const formBody = new URLSearchParams({
    ...hiddenFields,
    type: "free",
  }).toString();

  const postResponse = await ctx.fetch(finalUrl, {
    method: "POST",
    redirect: "follow",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: new URL(finalUrl).origin,
      referer: finalUrl,
    },
    body: formBody,
  });

  if (!postResponse.ok) {
    await cancelResponseBody(postResponse);
    throw new MirrorError(
      `Uploadhaven download handshake failed with HTTP ${postResponse.status}.`,
      {
        code: "http_error",
        status: postResponse.status,
        retryable: postResponse.status === 429 || postResponse.status >= 500,
      },
    );
  }

  const postFinalUrl = postResponse.url || finalUrl;
  if (isFileResponse(postResponse)) {
    await cancelResponseBody(postResponse);
    return {
      url: postFinalUrl,
      headers: { referer: finalUrl },
      transfer: "direct",
    };
  }

  const postHtml = await readResponseText(postResponse);
  const downloadLinkMatch = postHtml.match(
    /<a\b[^>]*href\s*=\s*["'](https?:\/\/[^"']+?)["'][^>]*>[\s\S]*?(?:download|click\s+here|get\s+file)/i,
  );
  if (downloadLinkMatch) {
    return {
      url: downloadLinkMatch[1],
      headers: { referer: finalUrl },
      transfer: "direct",
    };
  }

  if (detectCaptchaKind(postHtml)) {
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "asks for a captcha before the free download.",
      "captcha_required",
    );
  }

  throw createActionRequiredError(
    HOST_LABEL,
    rawUrl,
    "free download handshake did not produce a direct file link.",
  );
}

module.exports = {
  HOST_LABEL,
  UPLOADHAVEN_SUBMIT_DELAY_MS,
  isUploadhavenDownloadUrl,
  parseUploadhavenCountdownMs,
  resolveUploadhavenTarget,
};
