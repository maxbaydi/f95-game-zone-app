/**
 * Small hosts whose file page embeds the direct link in plain HTML/JS.
 */
const {
  MirrorError,
  buildAbsoluteUrl,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  decodeJavascriptEscapes,
  isFileResponse,
  parseHtmlTagAttributes,
  readResponseText,
  safeParseUrl,
} = require("./common");

async function fetchLandingHtml(ctx, pageUrl, hostLabel) {
  const response = await ctx.fetch(pageUrl, { method: "GET", redirect: "follow" });
  if (!response.ok) {
    await cancelResponseBody(response);
    if (response.status === 404 || response.status === 410) {
      throw new MirrorError(`This ${hostLabel} file no longer exists.`, {
        code: "not_found",
        status: response.status,
      });
    }
    throw createHttpError(response, hostLabel);
  }

  if (isFileResponse(response)) {
    await cancelResponseBody(response);
    return { fileUrl: response.url || pageUrl, html: "", finalUrl: response.url || pageUrl };
  }

  return {
    fileUrl: "",
    html: await readResponseText(response),
    finalUrl: response.url || pageUrl,
  };
}

/** sendspace.com/file/{id} → <a id="download_button" href="https://fsXX.sendspace.com/dl/..."> */
function extractSendspaceDownloadUrl(html, pageUrl) {
  const anchorPattern = /<a\b([^>]*)>/gi;
  let match = null;
  while ((match = anchorPattern.exec(String(html || "")))) {
    const attributes = parseHtmlTagAttributes(match[1]);
    if (attributes.id === "download_button" && attributes.href) {
      return buildAbsoluteUrl(pageUrl, attributes.href);
    }
  }

  const fallback = String(html || "").match(
    /https?:\/\/fs\d+n\d+\.sendspace\.com\/dl\/[^"'\s<>]+/i,
  );
  return fallback ? fallback[0] : "";
}

async function resolveSendspaceTarget(ctx, rawUrl) {
  const hostLabel = "Sendspace";
  const parsedUrl = safeParseUrl(rawUrl);
  if (parsedUrl && /\/dl\//i.test(parsedUrl.pathname)) {
    return { url: rawUrl, transfer: "direct" };
  }

  const page = await fetchLandingHtml(ctx, rawUrl, hostLabel);
  if (page.fileUrl) {
    return { url: page.fileUrl, transfer: "direct" };
  }

  const downloadUrl = extractSendspaceDownloadUrl(page.html, page.finalUrl);
  if (downloadUrl) {
    return {
      url: downloadUrl,
      headers: { referer: page.finalUrl },
      transfer: "direct",
    };
  }

  if (/file you requested is not available|file not found|has been deleted/i.test(page.html)) {
    throw new MirrorError("This Sendspace file no longer exists.", {
      code: "not_found",
    });
  }

  throw createActionRequiredError(
    hostLabel,
    rawUrl,
    "page did not expose the download button.",
  );
}

/** fuckingfast.co/{id} → window.open("https://fuckingfast.co/dl/...") */
function extractFuckingFastDownloadUrl(html) {
  const text = decodeJavascriptEscapes(String(html || ""));
  const match =
    text.match(/window\.open\(\s*["'](https?:\/\/[^"']*\/dl\/[^"']+)["']/i) ||
    text.match(/["'](https?:\/\/(?:[a-z0-9-]+\.)?fuckingfast\.co\/dl\/[^"']+)["']/i);
  return match ? match[1] : "";
}

async function resolveFuckingFastTarget(ctx, rawUrl) {
  const hostLabel = "FuckingFast";
  const parsedUrl = safeParseUrl(rawUrl);
  if (parsedUrl && /^\/dl\//i.test(parsedUrl.pathname)) {
    return { url: rawUrl, transfer: "direct" };
  }

  const page = await fetchLandingHtml(ctx, rawUrl, hostLabel);
  if (page.fileUrl) {
    return { url: page.fileUrl, transfer: "direct" };
  }

  const downloadUrl = extractFuckingFastDownloadUrl(page.html);
  if (downloadUrl) {
    return {
      url: downloadUrl,
      headers: { referer: page.finalUrl },
      transfer: "direct",
    };
  }

  if (/file (?:was )?not found|has been deleted|rate limit/i.test(page.html)) {
    const rateLimited = /rate limit/i.test(page.html);
    throw new MirrorError(
      rateLimited
        ? "FuckingFast is rate-limiting downloads right now. Try again in a few minutes."
        : "This FuckingFast file no longer exists.",
      { code: rateLimited ? "rate_limited" : "not_found", retryable: rateLimited, retryAfterMs: rateLimited ? 30000 : 0 },
    );
  }

  throw createActionRequiredError(
    hostLabel,
    rawUrl,
    "page did not expose the download link.",
  );
}

module.exports = {
  extractFuckingFastDownloadUrl,
  extractSendspaceDownloadUrl,
  resolveFuckingFastTarget,
  resolveSendspaceTarget,
};
