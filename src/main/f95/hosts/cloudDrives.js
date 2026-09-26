/**
 * Consumer cloud drives with public share links: Dropbox, OneDrive and
 * Yandex Disk.
 */
const {
  MirrorError,
  assertNotSplitArchive,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  hostMatchesDomain,
  normalizeHostname,
  normalizeText,
  pickBestFile,
  readResponseJson,
  safeParseUrl,
} = require("./common");

const DROPBOX_DOMAINS = ["dropbox.com", "dropboxusercontent.com", "db.tt"];
const ONEDRIVE_DOMAINS = [
  "1drv.ms",
  "onedrive.live.com",
  "onedrive.com",
  "sharepoint.com",
  "1drv.com",
];
const YANDEX_DISK_DOMAINS = [
  "disk.yandex.ru",
  "disk.yandex.com",
  "disk.yandex.kz",
  "disk.yandex.by",
  "disk.yandex.ua",
  "disk.yandex.com.tr",
  "disk.360.yandex.ru",
  "yadi.sk",
];

// ─── Dropbox ────────────────────────────────────────────────────────────────

function isDropboxHost(hostname) {
  return hostMatchesDomain(hostname, DROPBOX_DOMAINS);
}

/**
 * Rewrite a Dropbox share link to its direct form (`dl=1`). Folder links
 * (`/sh/`, `/scl/fo/`) download as a zip of the folder.
 * @param {string} rawUrl
 */
function buildDropboxDirectUrl(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl || !isDropboxHost(parsedUrl.hostname)) {
    return rawUrl;
  }

  if (normalizeHostname(parsedUrl.hostname).endsWith("dropboxusercontent.com")) {
    return parsedUrl.toString();
  }

  if (/^\/(s|sh|scl\/fi|scl\/fo|l)\//i.test(parsedUrl.pathname)) {
    parsedUrl.searchParams.delete("raw");
    parsedUrl.searchParams.set("dl", "1");
  }

  return parsedUrl.toString();
}

async function resolveDropboxTarget(ctx, rawUrl) {
  let sourceUrl = rawUrl;
  if (normalizeHostname(safeParseUrl(rawUrl)?.hostname || "") === "db.tt") {
    const response = await ctx.fetch(rawUrl, { method: "GET", redirect: "follow" });
    await cancelResponseBody(response);
    sourceUrl = response.url || rawUrl;
  }

  return {
    url: buildDropboxDirectUrl(sourceUrl),
    transfer: "direct",
  };
}

function interpretDropboxTransferError({ status }) {
  if (status === 429 || status === 460 || status === 509) {
    return new MirrorError(
      "Dropbox temporarily disabled this link because it generated too much traffic. Try again later or pick another mirror.",
      { code: "bandwidth_exceeded", status },
    );
  }
  return null;
}

// ─── OneDrive ───────────────────────────────────────────────────────────────

function isOneDriveHost(hostname) {
  return hostMatchesDomain(hostname, ONEDRIVE_DOMAINS);
}

function encodeOneDriveShareId(rawUrl) {
  return `u!${Buffer.from(String(rawUrl), "utf8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\//g, "_")
    .replace(/\+/g, "-")}`;
}

function isOneDriveDirectUrl(parsedUrl) {
  const hostname = normalizeHostname(parsedUrl.hostname);
  return (
    (hostname.endsWith("1drv.com") && hostname !== "1drv.com") ||
    /\/download(?:\.aspx)?$/i.test(parsedUrl.pathname) ||
    hostname === "api.onedrive.com"
  );
}

async function resolveOneDriveTarget(ctx, rawUrl) {
  const hostLabel = "OneDrive";
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl) {
    return rawUrl;
  }

  if (isOneDriveDirectUrl(parsedUrl)) {
    return { url: rawUrl, transfer: "direct" };
  }

  if (normalizeHostname(parsedUrl.hostname).endsWith("sharepoint.com")) {
    parsedUrl.searchParams.set("download", "1");
    return { url: parsedUrl.toString(), transfer: "direct" };
  }

  const shareId = encodeOneDriveShareId(rawUrl);
  const apiBase = `https://api.onedrive.com/v1.0/shares/${shareId}/root`;
  const response = await ctx.fetch(apiBase, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (response.status === 404) {
    await cancelResponseBody(response);
    throw new MirrorError("This OneDrive file no longer exists.", {
      code: "not_found",
      status: 404,
    });
  }

  if (response.status === 429 || response.status >= 500) {
    await cancelResponseBody(response);
    throw createHttpError(response, hostLabel);
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    throw createActionRequiredError(
      hostLabel,
      rawUrl,
      "did not allow an anonymous download of this share (Microsoft now often requires opening it in a browser).",
    );
  }

  const item = await readResponseJson(response);
  if (item?.folder) {
    throw createActionRequiredError(
      hostLabel,
      rawUrl,
      "link points to a folder. Download the game archive from it manually.",
    );
  }

  const downloadUrl =
    normalizeText(item?.["@content.downloadUrl"]) ||
    normalizeText(item?.["@microsoft.graph.downloadUrl"]) ||
    `${apiBase}/content`;

  return {
    url: downloadUrl,
    fileName: normalizeText(item?.name),
    size: Number(item?.size) || 0,
    transfer: "direct",
  };
}

// ─── Yandex Disk ────────────────────────────────────────────────────────────

function isYandexDiskHost(hostname) {
  return hostMatchesDomain(hostname, YANDEX_DISK_DOMAINS);
}

function createYandexError(payload, status) {
  const errorName = String(payload?.error || "");
  if (status === 404 || /NotFound/i.test(errorName)) {
    return new MirrorError("This Yandex Disk file no longer exists.", {
      code: "not_found",
      status,
    });
  }
  if (/Limit|Quota|TooMany/i.test(errorName) || status === 429) {
    return new MirrorError(
      "Yandex Disk download limit for this file is reached. Try again later or pick another mirror.",
      { code: "quota_exceeded", status, retryable: status === 429 },
    );
  }
  return new MirrorError(
    `Yandex Disk request failed${errorName ? ` (${errorName})` : ` with HTTP ${status}`}.`,
    { code: "http_error", status, retryable: status >= 500 },
  );
}

async function fetchYandexJson(ctx, url) {
  const response = await ctx.fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const payload = await readResponseJson(response);
  if (!response.ok) {
    throw createYandexError(payload, Number(response.status) || 0);
  }
  return payload || {};
}

async function resolveYandexDiskTarget(ctx, rawUrl) {
  const publicKey = encodeURIComponent(rawUrl);
  const metadata = await fetchYandexJson(
    ctx,
    `https://cloud-api.yandex.net/v1/disk/public/resources?public_key=${publicKey}&limit=200`,
  );

  let downloadApiUrl = `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${publicKey}`;
  let fileName = normalizeText(metadata?.name);
  let size = Number(metadata?.size) || 0;

  if (metadata?.type === "dir") {
    const items = Array.isArray(metadata?._embedded?.items)
      ? metadata._embedded.items.filter((item) => item?.type === "file")
      : [];
    /** @type {any} */
    const selectedItem = pickBestFile(items, { platformHint: ctx.platformHint });
    if (!selectedItem) {
      throw createActionRequiredError(
        "Yandex Disk",
        rawUrl,
        "folder has no files at its top level. Download the game archive from it manually.",
      );
    }
    assertNotSplitArchive(selectedItem, items, "Yandex Disk");
    downloadApiUrl += `&path=${encodeURIComponent(selectedItem.path)}`;
    fileName = normalizeText(selectedItem.name);
    size = Number(selectedItem.size) || 0;
  }

  const link = await fetchYandexJson(ctx, downloadApiUrl);
  const href = normalizeText(link?.href);
  if (!/^https?:\/\//i.test(href)) {
    throw new MirrorError("Yandex Disk did not return a download link.", {
      code: "no_file",
      retryable: true,
    });
  }

  return { url: href, fileName, size, transfer: "direct" };
}

module.exports = {
  DROPBOX_DOMAINS,
  ONEDRIVE_DOMAINS,
  YANDEX_DISK_DOMAINS,
  buildDropboxDirectUrl,
  encodeOneDriveShareId,
  interpretDropboxTransferError,
  isDropboxHost,
  isOneDriveHost,
  isYandexDiskHost,
  resolveDropboxTarget,
  resolveOneDriveTarget,
  resolveYandexDiskTarget,
};
