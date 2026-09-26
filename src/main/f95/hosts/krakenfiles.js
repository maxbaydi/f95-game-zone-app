const {
  MirrorError,
  buildAbsoluteUrl,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  detectCaptchaKind,
  extractHtmlForms,
  hostMatchesDomain,
  isFileResponse,
  normalizeText,
  readResponseJson,
  readResponseText,
  safeParseUrl,
} = require("./common");

const HOST_LABEL = "Krakenfiles";
const KRAKENFILES_DOMAINS = ["krakenfiles.com"];

function isKrakenfilesHost(hostname) {
  return hostMatchesDomain(hostname, KRAKENFILES_DOMAINS);
}

function extractKrakenfilesHash(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl || !isKrakenfilesHost(parsedUrl.hostname)) {
    return "";
  }

  const match = parsedUrl.pathname.match(
    /^\/(?:view|embed-video|embed-audio|download)\/([A-Za-z0-9]+)/i,
  );
  return match ? match[1] : "";
}

/**
 * Krakenfiles: the file page holds a form (#dl-form) with a one-time token;
 * POSTing it with a `hash` header returns JSON {status: "ok", url}.
 * @param {any} ctx
 * @param {string} rawUrl
 */
async function resolveKrakenfilesTarget(ctx, rawUrl) {
  const fileHash = extractKrakenfilesHash(rawUrl);
  const parsedUrl = safeParseUrl(rawUrl);
  if (!fileHash) {
    if (parsedUrl && /force-download|\/download\//i.test(parsedUrl.pathname)) {
      return { url: rawUrl, transfer: "direct" };
    }
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "link format is not recognised.",
    );
  }

  const pageUrl = `https://krakenfiles.com/view/${fileHash}/file.html`;
  const response = await ctx.fetch(pageUrl, { method: "GET", redirect: "follow" });
  if (!response.ok) {
    await cancelResponseBody(response);
    if (response.status === 404) {
      throw new MirrorError("This Krakenfiles file no longer exists.", {
        code: "not_found",
        status: 404,
      });
    }
    throw createHttpError(response, HOST_LABEL);
  }

  const finalPageUrl = response.url || pageUrl;
  if (isFileResponse(response)) {
    await cancelResponseBody(response);
    return { url: finalPageUrl, transfer: "direct" };
  }

  const html = await readResponseText(response);
  if (/file not found|file (?:has been|was) (?:deleted|removed)/i.test(html) && !/dl-form/i.test(html)) {
    throw new MirrorError("This Krakenfiles file no longer exists.", {
      code: "not_found",
    });
  }

  const forms = extractHtmlForms(html, finalPageUrl);
  const downloadForm =
    forms.find((form) => form.id === "dl-form") ||
    forms.find((form) => Object.prototype.hasOwnProperty.call(form.fields, "token")) ||
    null;
  const token =
    normalizeText(downloadForm?.fields?.token) ||
    normalizeText(
      (html.match(/id\s*=\s*["']dl-token["'][^>]*value\s*=\s*["']([^"']+)["']/i) || [])[1],
    );

  if (!token) {
    if (detectCaptchaKind(html)) {
      throw createActionRequiredError(
        HOST_LABEL,
        finalPageUrl,
        "asks for a captcha before downloading.",
        "captcha_required",
      );
    }
    throw createActionRequiredError(
      HOST_LABEL,
      finalPageUrl,
      "page did not contain the expected download form.",
    );
  }

  const actionUrl =
    (downloadForm?.attributes?.action &&
      buildAbsoluteUrl(finalPageUrl, downloadForm.attributes.action)) ||
    `https://krakenfiles.com/download/${fileHash}`;
  // The form now embeds a Cloudflare Turnstile widget; without its token the
  // server answers HTTP 500 {"status":"error","msg":"captcha not valid"}.
  const formCaptcha = detectCaptchaKind(downloadForm?.innerHtml || "") || detectCaptchaKind(html);
  if (formCaptcha) {
    throw createActionRequiredError(
      HOST_LABEL,
      finalPageUrl,
      `asks for a captcha (${formCaptcha}) before downloading. Press "Download now" in the browser window; the file is picked up automatically.`,
      "captcha_required",
    );
  }

  const postResponse = await ctx.fetch(actionUrl, {
    method: "POST",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      hash: fileHash,
      origin: "https://krakenfiles.com",
      referer: finalPageUrl,
    },
    body: new URLSearchParams({ token }).toString(),
  });
  const payload = await readResponseJson(postResponse);
  if (/captcha/i.test(String(payload?.msg || ""))) {
    throw createActionRequiredError(
      HOST_LABEL,
      finalPageUrl,
      "asks for a captcha before downloading. Press \"Download now\" in the browser window; the file is picked up automatically.",
      "captcha_required",
    );
  }
  if (!postResponse.ok) {
    throw createHttpError(postResponse, HOST_LABEL);
  }
  const downloadUrl = buildAbsoluteUrl(finalPageUrl, String(payload?.url || ""));
  if (downloadUrl && (!payload?.status || payload.status === "ok")) {
    return {
      url: downloadUrl,
      headers: { referer: finalPageUrl },
      transfer: "direct",
    };
  }

  throw createActionRequiredError(
    HOST_LABEL,
    finalPageUrl,
    `did not return a download link${payload?.msg ? ` (${normalizeText(payload.msg)})` : ""}.`,
  );
}

module.exports = {
  HOST_LABEL,
  KRAKENFILES_DOMAINS,
  extractKrakenfilesHash,
  isKrakenfilesHost,
  resolveKrakenfilesTarget,
};
