const {
  MirrorError,
  assertNotSplitArchive,
  buildAbsoluteUrl,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  decodeJavascriptEscapes,
  detectCaptchaKind,
  hostMatchesDomain,
  isFileResponse,
  normalizeHostname,
  normalizeText,
  parseHtmlTagAttributes,
  pickBestFile,
  readResponseJson,
  readResponseText,
  safeParseUrl,
} = require("./common");

const HOST_LABEL = "MediaFire";
const MEDIAFIRE_DOMAINS = ["mediafire.com"];
const MEDIAFIRE_DIRECT_PATTERN =
  /https?:\/\/download\d*\.mediafire\.com\/[^"'\s<>\\]+/i;

function isMediafireHost(hostname) {
  return hostMatchesDomain(hostname, MEDIAFIRE_DOMAINS);
}

function isMediafireDirectHost(hostname) {
  return /^download\d*\.mediafire\.com$/i.test(normalizeHostname(hostname));
}

/**
 * @param {string} rawUrl
 * @returns {null | {kind: "file" | "folder" | "direct", key: string}}
 */
function parseMediafireUrl(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl || !isMediafireHost(parsedUrl.hostname)) {
    return null;
  }

  if (isMediafireDirectHost(parsedUrl.hostname)) {
    return { kind: "direct", key: "" };
  }

  const folderMatch = parsedUrl.pathname.match(/^\/folder\/([A-Za-z0-9]+)/i);
  if (folderMatch) {
    return { kind: "folder", key: folderMatch[1] };
  }

  const fileMatch = parsedUrl.pathname.match(
    /^\/(?:file|file_premium|download|view|download\.php)\/([A-Za-z0-9]+)/i,
  );
  if (fileMatch) {
    return { kind: "file", key: fileMatch[1] };
  }

  const queryKey = parsedUrl.search.replace(/^\?/, "").split("&")[0];
  if (/^[A-Za-z0-9]{10,}$/.test(queryKey)) {
    return { kind: "file", key: queryKey };
  }

  const hashKey = parsedUrl.hash.replace(/^#\/?/, "");
  if (/^[A-Za-z0-9]{10,}$/.test(hashKey)) {
    return { kind: "folder", key: hashKey };
  }

  return null;
}

function decodeScrambledUrl(value) {
  try {
    const decoded = Buffer.from(String(value || ""), "base64").toString("utf8");
    return /^https?:\/\//i.test(decoded) ? decoded : "";
  } catch {
    return "";
  }
}

/**
 * Extract the direct download URL from a MediaFire file page.
 * @param {string} html
 * @param {string} pageUrl
 */
function extractMediafireDownloadUrl(html, pageUrl) {
  const text = String(html || "");
  const anchorPattern = /<a\b([^>]*)>/gi;
  let match = null;

  while ((match = anchorPattern.exec(text))) {
    const attributes = parseHtmlTagAttributes(match[1]);
    const isDownloadButton =
      attributes.id === "downloadButton" ||
      /download file/i.test(attributes["aria-label"] || "") ||
      /\binput\b.*\bpopsok\b|\bdownload_link\b/i.test(attributes.class || "");
    if (!isDownloadButton) {
      continue;
    }

    const scrambledUrl = decodeScrambledUrl(attributes["data-scrambled-url"]);
    if (scrambledUrl) {
      return scrambledUrl;
    }

    const href = buildAbsoluteUrl(pageUrl, attributes.href || "");
    if (href && /^https?:/i.test(href) && !/javascript:|#$/.test(href)) {
      const hrefHost = safeParseUrl(href)?.hostname || "";
      if (isMediafireDirectHost(hrefHost)) {
        return href;
      }
    }
  }

  const scrambledMatch = text.match(/data-scrambled-url\s*=\s*["']([^"']+)["']/i);
  if (scrambledMatch) {
    const scrambledUrl = decodeScrambledUrl(scrambledMatch[1]);
    if (scrambledUrl) {
      return scrambledUrl;
    }
  }

  const directMatch = decodeJavascriptEscapes(text).match(MEDIAFIRE_DIRECT_PATTERN);
  return directMatch ? directMatch[0].replace(/&amp;/g, "&") : "";
}

async function resolveMediafireFilePage(ctx, pageUrl) {
  const response = await ctx.fetch(pageUrl, {
    method: "GET",
    redirect: "follow",
  });

  const finalUrl = response.url || pageUrl;
  if (/error\.php\?errno=/i.test(finalUrl)) {
    await cancelResponseBody(response);
    throw new MirrorError(
      "This MediaFire file was removed or is unavailable. Pick another mirror.",
      { code: "not_found" },
    );
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    if (response.status === 404) {
      throw new MirrorError("This MediaFire file no longer exists.", {
        code: "not_found",
        status: 404,
      });
    }
    throw createHttpError(response, HOST_LABEL);
  }

  if (isFileResponse(response)) {
    await cancelResponseBody(response);
    return { url: finalUrl, transfer: "direct" };
  }

  const html = await readResponseText(response);
  const downloadUrl = extractMediafireDownloadUrl(html, finalUrl);
  if (downloadUrl) {
    return {
      url: downloadUrl,
      headers: { referer: finalUrl },
      transfer: "direct",
    };
  }

  if (/Invalid or Deleted File|File Removed|file you requested has been removed/i.test(html)) {
    throw new MirrorError(
      "This MediaFire file was removed or is unavailable. Pick another mirror.",
      { code: "not_found" },
    );
  }

  if (detectCaptchaKind(html)) {
    throw createActionRequiredError(
      HOST_LABEL,
      pageUrl,
      "asks you to confirm you are human before downloading.",
      "captcha_required",
    );
  }

  throw createActionRequiredError(
    HOST_LABEL,
    pageUrl,
    "page did not expose a download button F95Launcher understands.",
  );
}

async function listMediafireFolder(ctx, folderKey) {
  const apiUrl = new URL("https://www.mediafire.com/api/1.5/folder/get_content.php");
  apiUrl.searchParams.set("folder_key", folderKey);
  apiUrl.searchParams.set("content_type", "files");
  apiUrl.searchParams.set("chunk", "1");
  apiUrl.searchParams.set("response_format", "json");

  const response = await ctx.fetch(apiUrl.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    await cancelResponseBody(response);
    throw createHttpError(response, HOST_LABEL);
  }

  const payload = await readResponseJson(response);
  const result = String(payload?.response?.result || "");
  if (result && result !== "Success") {
    throw new MirrorError(
      `MediaFire could not list this folder (${normalizeText(payload?.response?.message) || result}).`,
      { code: "not_found" },
    );
  }

  const files = payload?.response?.folder_content?.files;
  return (Array.isArray(files) ? files : []).map((file) => ({
    name: normalizeText(file?.filename),
    size: Number(file?.size) || 0,
    quickkey: String(file?.quickkey || ""),
    pageUrl:
      String(file?.links?.normal_download || "") ||
      `https://www.mediafire.com/file/${file?.quickkey}/file`,
  }));
}

/**
 * @param {any} ctx
 * @param {string} rawUrl
 */
async function resolveMediafireTarget(ctx, rawUrl) {
  const parsed = parseMediafireUrl(rawUrl);
  if (!parsed) {
    return resolveMediafireFilePage(ctx, rawUrl);
  }

  if (parsed.kind === "direct") {
    return { url: rawUrl, transfer: "direct" };
  }

  if (parsed.kind === "folder") {
    const files = await listMediafireFolder(ctx, parsed.key);
    const selectedFile = pickBestFile(files, { platformHint: ctx.platformHint });
    if (!selectedFile) {
      throw new MirrorError("This MediaFire folder is empty.", {
        code: "not_found",
      });
    }
    assertNotSplitArchive(selectedFile, files, HOST_LABEL);
    const target = await resolveMediafireFilePage(ctx, selectedFile.pageUrl);
    return {
      ...target,
      fileName: selectedFile.name,
      size: selectedFile.size,
    };
  }

  return resolveMediafireFilePage(ctx, rawUrl);
}

module.exports = {
  HOST_LABEL,
  MEDIAFIRE_DOMAINS,
  extractMediafireDownloadUrl,
  isMediafireHost,
  parseMediafireUrl,
  resolveMediafireTarget,
};
