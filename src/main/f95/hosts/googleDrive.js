const {
  MirrorActionRequiredError,
  MirrorError,
  buildAbsoluteUrl,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  decodeJavascriptEscapes,
  isFileResponse,
  normalizeHostname,
  normalizeText,
  parseHtmlTagAttributes,
  readResponseText,
  safeDecodeHtmlEntities,
  safeParseUrl,
} = require("./common");

const HOST_LABEL = "Google Drive";
const GOOGLE_DRIVE_DOMAINS = [
  "drive.google.com",
  "docs.google.com",
  "drive.usercontent.google.com",
];

const QUOTA_EXCEEDED_PATTERN =
  /Google Drive - Quota exceeded|Download quota exceeded|quota for this file has been exceeded|too many users have viewed or downloaded this file|can't view or download this file at this time|cannot view or download this file at this time/i;
const NOT_FOUND_PATTERN =
  /the file you have requested does not exist|file you requested does not exist|Google Drive - Page Not Found|this item might not exist or is no longer available/i;

function isGoogleDriveHost(hostname) {
  return GOOGLE_DRIVE_DOMAINS.includes(normalizeHostname(hostname));
}

function isGoogleDriveFolderUrl(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl || !isGoogleDriveHost(parsedUrl.hostname)) {
    return false;
  }

  return (
    /\/(?:drive\/(?:u\/\d+\/)?)?folders\//i.test(parsedUrl.pathname) ||
    /\/(?:embedded)?folderview/i.test(parsedUrl.pathname)
  );
}

function extractGoogleDriveFileId(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (!isGoogleDriveHost(parsedUrl.hostname)) {
      return "";
    }

    const searchParamId = normalizeText(parsedUrl.searchParams.get("id"));
    if (searchParamId) {
      return searchParamId;
    }

    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    const driveFileIndex = segments.findIndex((segment) => segment === "d");
    if (driveFileIndex >= 0 && segments[driveFileIndex + 1]) {
      return normalizeText(segments[driveFileIndex + 1]);
    }

    return "";
  } catch {
    return "";
  }
}

function extractGoogleDriveResourceKey(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (!isGoogleDriveHost(parsedUrl.hostname)) {
      return "";
    }

    return normalizeText(parsedUrl.searchParams.get("resourcekey"));
  } catch {
    return "";
  }
}

function isGoogleDriveDownloadPath(pathname) {
  return /(?:^|\/)(?:uc|download)(?:$|[/?#])/i.test(String(pathname || ""));
}

function isGoogleDriveDirectDownloadUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (!isGoogleDriveHost(parsedUrl.hostname)) {
      return false;
    }

    if (!isGoogleDriveDownloadPath(parsedUrl.pathname)) {
      return false;
    }

    return Boolean(
      normalizeText(parsedUrl.searchParams.get("id")) &&
        (normalizeText(parsedUrl.searchParams.get("export")) === "download" ||
          parsedUrl.pathname.toLowerCase().includes("/download") ||
          normalizeText(parsedUrl.searchParams.get("confirm"))),
    );
  } catch {
    return false;
  }
}

function buildGoogleDriveCandidateUrls(rawUrl) {
  const fileId = extractGoogleDriveFileId(rawUrl);
  if (!fileId) {
    return [rawUrl];
  }

  const resourceKey = extractGoogleDriveResourceKey(rawUrl);
  const candidates = new Set([rawUrl]);
  const addCandidate = (hostname, pathname) => {
    const candidateUrl = new URL(`https://${hostname}${pathname}`);
    candidateUrl.searchParams.set("export", "download");
    candidateUrl.searchParams.set("id", fileId);
    if (resourceKey) {
      candidateUrl.searchParams.set("resourcekey", resourceKey);
    }
    candidates.add(candidateUrl.toString());
  };

  addCandidate("drive.google.com", "/uc");
  addCandidate("drive.usercontent.google.com", "/uc");
  addCandidate("drive.usercontent.google.com", "/download");

  return [...candidates];
}

/**
 * Last-resort candidate for the "can't scan this file for viruses" warning
 * when the page layout is unknown: usercontent accepts `confirm=t`.
 */
function buildGoogleDriveForcedConfirmUrl(rawUrl) {
  const fileId = extractGoogleDriveFileId(rawUrl);
  if (!fileId) {
    return "";
  }

  const candidateUrl = new URL("https://drive.usercontent.google.com/download");
  candidateUrl.searchParams.set("id", fileId);
  candidateUrl.searchParams.set("export", "download");
  candidateUrl.searchParams.set("confirm", "t");
  const resourceKey = extractGoogleDriveResourceKey(rawUrl);
  if (resourceKey) {
    candidateUrl.searchParams.set("resourcekey", resourceKey);
  }
  return candidateUrl.toString();
}

function extractGoogleDriveDirectUrlFromHtml(html) {
  const normalizedHtml = decodeJavascriptEscapes(String(html || ""));
  const directUrlMatches =
    normalizedHtml.match(
      /https:\/\/drive(?:\.usercontent)?\.google\.com\/(?:u\/\d+\/)?(?:uc|download)\?[^"'<>\\\s]+/gi,
    ) || [];

  for (const rawMatch of directUrlMatches) {
    const directUrl = safeDecodeHtmlEntities(rawMatch).trim();
    if (isGoogleDriveDirectDownloadUrl(directUrl)) {
      return directUrl;
    }
  }

  return "";
}

/**
 * Old-style warning pages link the confirmation with a relative href such as
 * `/uc?export=download&amp;confirm=AbCd&amp;id=...` (id="uc-download-link").
 */
function extractGoogleDriveRelativeConfirmUrl(html, pageUrl) {
  const normalizedHtml = decodeJavascriptEscapes(String(html || ""));
  const hrefPattern = /href\s*=\s*["']([^"']*\/(?:uc|download)\?[^"']*confirm=[^"']*)["']/gi;
  let match = null;

  while ((match = hrefPattern.exec(normalizedHtml))) {
    const absoluteUrl = buildAbsoluteUrl(pageUrl, match[1]);
    if (absoluteUrl && isGoogleDriveDirectDownloadUrl(absoluteUrl)) {
      return absoluteUrl;
    }
  }

  return "";
}

function extractGoogleDriveConfirmUrl(html, pageUrl) {
  const normalizedHtml = decodeJavascriptEscapes(String(html || ""));
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let formMatch = null;

  while ((formMatch = formPattern.exec(normalizedHtml))) {
    const formAttributes = parseHtmlTagAttributes(formMatch[1]);
    const actionUrl = buildAbsoluteUrl(pageUrl, formAttributes.action || "");
    if (!actionUrl) {
      continue;
    }

    let parsedAction = null;
    try {
      parsedAction = new URL(actionUrl);
    } catch {
      continue;
    }

    if (
      !isGoogleDriveHost(parsedAction.hostname) ||
      !isGoogleDriveDownloadPath(parsedAction.pathname)
    ) {
      continue;
    }

    const inputPattern = /<input\b([^>]*)>/gi;
    let inputMatch = null;
    while ((inputMatch = inputPattern.exec(formMatch[2]))) {
      const inputAttributes = parseHtmlTagAttributes(inputMatch[1]);
      const inputName = normalizeText(inputAttributes.name);
      if (!inputName) {
        continue;
      }

      parsedAction.searchParams.set(inputName, inputAttributes.value || "");
    }

    if (!parsedAction.searchParams.get("export")) {
      parsedAction.searchParams.set("export", "download");
    }

    return parsedAction.toString();
  }

  return extractGoogleDriveRelativeConfirmUrl(normalizedHtml, pageUrl);
}

function createQuotaExceededError() {
  return new MirrorError(
    "Google Drive download quota for this file is exceeded (too many people downloaded it in the last 24 hours). Try again later or pick another mirror.",
    { code: "quota_exceeded" },
  );
}

async function resolveGoogleDriveCandidateUrl(ctx, candidateUrl, seenUrls, originalUrl) {
  if (!candidateUrl || seenUrls.has(candidateUrl)) {
    return "";
  }

  seenUrls.add(candidateUrl);

  const response = await ctx.fetch(candidateUrl, {
    method: "GET",
    redirect: "follow",
  });
  const finalUrl = response.url || candidateUrl;
  const finalHost = normalizeHostname(safeParseUrl(finalUrl)?.hostname || "");

  if (finalHost === "accounts.google.com") {
    await cancelResponseBody(response);
    throw createActionRequiredError(
      HOST_LABEL,
      originalUrl,
      "asks you to sign in — the file is private or shared only with specific accounts.",
    );
  }

  if (!response.ok) {
    const status = Number(response.status) || 0;
    if (status === 403 || status === 429) {
      const text = await readResponseText(response, 200000);
      if (QUOTA_EXCEEDED_PATTERN.test(text)) {
        throw createQuotaExceededError();
      }
    } else {
      await cancelResponseBody(response);
    }

    if (status === 404) {
      throw new MirrorError(
        "This Google Drive file does not exist or was deleted. Pick another mirror.",
        { code: "not_found", status },
      );
    }
    throw createHttpError(response, HOST_LABEL);
  }

  if (isFileResponse(response)) {
    await cancelResponseBody(response);
    return finalUrl;
  }

  const html = await readResponseText(response);
  if (QUOTA_EXCEEDED_PATTERN.test(html)) {
    throw createQuotaExceededError();
  }

  if (NOT_FOUND_PATTERN.test(html)) {
    throw new MirrorError(
      "This Google Drive file does not exist or was deleted. Pick another mirror.",
      { code: "not_found" },
    );
  }

  const embeddedDirectUrl = extractGoogleDriveDirectUrlFromHtml(html);
  if (embeddedDirectUrl && !seenUrls.has(embeddedDirectUrl)) {
    const resolvedEmbeddedUrl = await resolveGoogleDriveCandidateUrl(
      ctx,
      embeddedDirectUrl,
      seenUrls,
      originalUrl,
    );
    if (resolvedEmbeddedUrl) {
      return resolvedEmbeddedUrl;
    }
  }

  const confirmUrl = extractGoogleDriveConfirmUrl(html, finalUrl);
  if (confirmUrl && !seenUrls.has(confirmUrl)) {
    const resolvedConfirmUrl = await resolveGoogleDriveCandidateUrl(
      ctx,
      confirmUrl,
      seenUrls,
      originalUrl,
    );
    if (resolvedConfirmUrl) {
      return resolvedConfirmUrl;
    }
  }

  if (/virus scan warning|can't scan this file for viruses|download_warning/i.test(html)) {
    const forcedConfirmUrl = buildGoogleDriveForcedConfirmUrl(candidateUrl);
    if (forcedConfirmUrl && !seenUrls.has(forcedConfirmUrl)) {
      const resolvedForcedUrl = await resolveGoogleDriveCandidateUrl(
        ctx,
        forcedConfirmUrl,
        seenUrls,
        originalUrl,
      );
      if (resolvedForcedUrl) {
        return resolvedForcedUrl;
      }
    }
  }

  throw createActionRequiredError(
    HOST_LABEL,
    originalUrl,
    "returned an interstitial page instead of the file.",
  );
}

function getErrorPriority(error) {
  switch (error?.code) {
    case "quota_exceeded":
      return 5;
    case "mirror_action_required":
      return error?.userMessage && /sign in/i.test(error.userMessage) ? 4 : 1;
    case "not_found":
      return 3;
    default:
      return error?.retryable ? 2 : 0;
  }
}

/**
 * @param {ReturnType<typeof import("./common").createResolverContext>} ctx
 * @param {string} rawUrl
 */
async function resolveGoogleDriveTarget(ctx, rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl || !isGoogleDriveHost(parsedUrl.hostname)) {
    return rawUrl;
  }

  if (isGoogleDriveFolderUrl(rawUrl)) {
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "link points to a folder, which cannot be installed automatically. Download the game archive from the folder manually.",
    );
  }

  const seenUrls = new Set();
  const candidateUrls = buildGoogleDriveCandidateUrls(rawUrl);
  let bestError = null;

  for (const candidateUrl of candidateUrls) {
    try {
      const resolvedUrl = await resolveGoogleDriveCandidateUrl(
        ctx,
        candidateUrl,
        seenUrls,
        rawUrl,
      );
      if (resolvedUrl) {
        return {
          url: resolvedUrl,
          transfer: "direct",
        };
      }
    } catch (error) {
      if (
        error?.code === "cancelled" ||
        error?.code === "quota_exceeded" ||
        (error instanceof MirrorActionRequiredError && error.fromChallenge)
      ) {
        throw error;
      }
      if (!bestError || getErrorPriority(error) > getErrorPriority(bestError)) {
        bestError = error;
      }
    }
  }

  if (bestError) {
    throw bestError;
  }

  return { url: rawUrl, transfer: "direct" };
}

function interpretGoogleDriveTransferError({ status, bodyText }) {
  if ((status === 403 || status === 429) && QUOTA_EXCEEDED_PATTERN.test(bodyText || "")) {
    return createQuotaExceededError();
  }
  return null;
}

/** Legacy helper kept for callers/tests that only need the final URL. */
async function resolveGoogleDriveUrlWithContext(ctx, rawUrl) {
  const result = await resolveGoogleDriveTarget(ctx, rawUrl);
  return typeof result === "string" ? result : result.url;
}

module.exports = {
  GOOGLE_DRIVE_DOMAINS,
  HOST_LABEL,
  buildGoogleDriveCandidateUrls,
  extractGoogleDriveConfirmUrl,
  extractGoogleDriveDirectUrlFromHtml,
  extractGoogleDriveFileId,
  interpretGoogleDriveTransferError,
  isGoogleDriveDirectDownloadUrl,
  isGoogleDriveFolderUrl,
  isGoogleDriveHost,
  resolveGoogleDriveTarget,
  resolveGoogleDriveUrlWithContext,
};
