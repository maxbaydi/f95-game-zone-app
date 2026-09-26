const {
  MirrorError,
  buildAbsoluteUrl,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  decodeJavascriptEscapes,
  extractAnchors,
  getFileExtension,
  hostMatchesDomain,
  isFileResponse,
  normalizeText,
  readResponseText,
  safeParseUrl,
  stripHtmlTags,
} = require("./common");

const HOST_LABEL = "Qiwi";
const QIWI_DOMAINS = ["qiwi.gg"];
// Qiwi serves file payloads from this storage domain: /{fileId}.{ext}
const QIWI_STORAGE_ORIGIN = "https://spyderrock.com";
const QIWI_STORAGE_DOMAINS = ["spyderrock.com"];

function isQiwiHost(hostname) {
  return hostMatchesDomain(hostname, QIWI_DOMAINS);
}

/**
 * @param {string} rawUrl
 * @returns {null | {kind: "file" | "folder", id: string}}
 */
function parseQiwiUrl(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl || !isQiwiHost(parsedUrl.hostname)) {
    return null;
  }

  const match = parsedUrl.pathname.match(/^\/(file|folder)\/([A-Za-z0-9_-]+)/i);
  if (!match) {
    return null;
  }

  return {
    kind: match[1].toLowerCase() === "folder" ? "folder" : "file",
    id: match[2],
  };
}

function extractQiwiFileName(html) {
  const text = decodeJavascriptEscapes(String(html || ""));
  const jsonMatch = text.match(/"(?:fileName|file_name|name)"\s*:\s*"([^"]+\.[A-Za-z0-9]{1,8})"/);
  if (jsonMatch) {
    return normalizeText(jsonMatch[1]);
  }

  const headingMatch = text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const headingText = headingMatch ? stripHtmlTags(headingMatch[1]) : "";
  if (getFileExtension(headingText)) {
    return headingText;
  }

  const titleMatch = text.match(/<title>([\s\S]*?)<\/title>/i);
  const titleText = titleMatch
    ? stripHtmlTags(titleMatch[1]).replace(/\s*[|–-]\s*Qiwi.*$/i, "")
    : "";
  return getFileExtension(titleText) ? titleText : "";
}

/**
 * @param {any} ctx
 * @param {string} rawUrl
 */
async function resolveQiwiTarget(ctx, rawUrl) {
  const parsed = parseQiwiUrl(rawUrl);
  if (!parsed) {
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "link format is not recognised.",
    );
  }

  if (parsed.kind === "folder") {
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "link points to a folder. Open it and pick the game file manually.",
    );
  }

  const pageUrl = `https://qiwi.gg/file/${parsed.id}`;
  const response = await ctx.fetch(pageUrl, { method: "GET", redirect: "follow" });
  if (!response.ok) {
    await cancelResponseBody(response);
    if (response.status === 404) {
      throw new MirrorError("This Qiwi file no longer exists.", {
        code: "not_found",
        status: 404,
      });
    }
    throw createHttpError(response, HOST_LABEL);
  }

  if (isFileResponse(response)) {
    await cancelResponseBody(response);
    return { url: response.url || pageUrl, transfer: "direct" };
  }

  const html = await readResponseText(response);
  const finalPageUrl = response.url || pageUrl;
  const directAnchor = extractAnchors(html, finalPageUrl).find((anchor) => {
    const anchorHost = safeParseUrl(anchor.url)?.hostname || "";
    return (
      hostMatchesDomain(anchorHost, QIWI_STORAGE_DOMAINS) ||
      (/download/i.test(anchor.text) &&
        !isQiwiHost(anchorHost) &&
        /^https?:/i.test(anchor.url))
    );
  });
  if (directAnchor) {
    return {
      url: directAnchor.url,
      headers: { referer: finalPageUrl },
      transfer: "direct",
    };
  }

  const embeddedStorageUrl = decodeJavascriptEscapes(html).match(
    /https?:\/\/(?:[a-z0-9-]+\.)?spyderrock\.com\/[^"'\s<>\\]+/i,
  );
  if (embeddedStorageUrl) {
    return {
      url: buildAbsoluteUrl(finalPageUrl, embeddedStorageUrl[0]),
      headers: { referer: finalPageUrl },
      transfer: "direct",
    };
  }

  const fileName = extractQiwiFileName(html);
  const extension = getFileExtension(fileName);
  if (!extension) {
    if (/not found|does not exist|deleted/i.test(stripHtmlTags(html).slice(0, 3000))) {
      throw new MirrorError("This Qiwi file no longer exists.", {
        code: "not_found",
      });
    }
    throw createActionRequiredError(
      HOST_LABEL,
      pageUrl,
      "page did not reveal the file name needed for the direct download.",
    );
  }

  return {
    url: `${QIWI_STORAGE_ORIGIN}/${parsed.id}.${extension}`,
    fileName,
    headers: { referer: finalPageUrl },
    transfer: "direct",
  };
}

module.exports = {
  HOST_LABEL,
  QIWI_DOMAINS,
  QIWI_STORAGE_DOMAINS,
  extractQiwiFileName,
  isQiwiHost,
  parseQiwiUrl,
  resolveQiwiTarget,
};
