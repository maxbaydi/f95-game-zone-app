const {
  MirrorError,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  hostMatchesDomain,
  normalizeText,
  readResponseJson,
  readResponseText,
  safeParseUrl,
} = require("./common");

const HOST_LABEL = "Workupload";
const WORKUPLOAD_DOMAINS = ["workupload.com"];

function isWorkuploadHost(hostname) {
  return hostMatchesDomain(hostname, WORKUPLOAD_DOMAINS);
}

/**
 * @param {string} rawUrl
 * @returns {null | {kind: "file" | "archive" | "direct", id: string, origin: string}}
 */
function parseWorkuploadUrl(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl || !isWorkuploadHost(parsedUrl.hostname)) {
    return null;
  }

  const origin = "https://workupload.com";
  if (/^\/download\//i.test(parsedUrl.pathname) && /^f\d*\./i.test(parsedUrl.hostname)) {
    return { kind: "direct", id: "", origin };
  }

  const match = parsedUrl.pathname.match(/^\/(file|start|archive)\/([A-Za-z0-9]+)/i);
  if (!match) {
    return null;
  }

  return {
    kind: match[1].toLowerCase() === "archive" ? "archive" : "file",
    id: match[2],
    origin,
  };
}

/**
 * Workupload flow: prime the session via /start/{id}, then ask the JSON API
 * for a download server. When the site demands its puzzle/captcha the API
 * refuses and the user has to solve it once in the browser.
 * @param {any} ctx
 * @param {string} rawUrl
 */
async function resolveWorkuploadTarget(ctx, rawUrl) {
  const parsed = parseWorkuploadUrl(rawUrl);
  if (!parsed) {
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "link format is not recognised.",
    );
  }

  if (parsed.kind === "direct") {
    return { url: rawUrl, transfer: "direct" };
  }

  const pageUrl = `${parsed.origin}/${parsed.kind}/${parsed.id}`;
  if (parsed.kind === "archive") {
    throw createActionRequiredError(
      HOST_LABEL,
      pageUrl,
      "link is a multi-file archive page. Download the game package from it manually.",
    );
  }

  const startResponse = await ctx.fetch(`${parsed.origin}/start/${parsed.id}`, {
    method: "GET",
    redirect: "follow",
    headers: { referer: pageUrl },
  });
  if (startResponse.status === 404) {
    await cancelResponseBody(startResponse);
    throw new MirrorError("This Workupload file no longer exists.", {
      code: "not_found",
      status: 404,
    });
  }
  if (startResponse.status === 429 || startResponse.status >= 500) {
    await cancelResponseBody(startResponse);
    throw createHttpError(startResponse, HOST_LABEL);
  }
  const startHtml = startResponse.ok ? await readResponseText(startResponse, 400000) : "";
  if (!startResponse.ok) {
    await cancelResponseBody(startResponse);
  }
  if (/file (?:was|has been) (?:deleted|removed)|file not found|datei wurde gel[öo]scht/i.test(startHtml)) {
    throw new MirrorError("This Workupload file no longer exists.", {
      code: "not_found",
    });
  }

  const apiResponse = await ctx.fetch(
    `${parsed.origin}/api/file/getDownloadServer/${parsed.id}`,
    {
      method: "GET",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
        referer: pageUrl,
      },
    },
  );
  if (apiResponse.status === 429 || apiResponse.status >= 500) {
    await cancelResponseBody(apiResponse);
    throw createHttpError(apiResponse, HOST_LABEL);
  }

  const payload = await readResponseJson(apiResponse);
  const downloadUrl = normalizeText(payload?.data?.url);
  if (payload?.success && /^https?:\/\//i.test(downloadUrl)) {
    return {
      url: downloadUrl,
      headers: { referer: pageUrl },
      transfer: "direct",
    };
  }

  const message = normalizeText(payload?.message || payload?.error || "");
  if (/not found|deleted|removed/i.test(message)) {
    throw new MirrorError("This Workupload file no longer exists.", {
      code: "not_found",
    });
  }

  throw createActionRequiredError(
    HOST_LABEL,
    pageUrl,
    "asks you to solve its puzzle/captcha before downloading.",
    "captcha_required",
  );
}

module.exports = {
  HOST_LABEL,
  WORKUPLOAD_DOMAINS,
  isWorkuploadHost,
  parseWorkuploadUrl,
  resolveWorkuploadTarget,
};
