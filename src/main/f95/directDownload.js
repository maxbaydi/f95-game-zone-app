const fs = require("fs");
const path = require("path");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");

const DIRECT_SESSION_DOWNLOAD_HOSTS = new Set([
  "drive.google.com",
  "docs.google.com",
  "drive.usercontent.google.com",
]);

const DIRECT_DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Atlas/1.0 Chrome/125.0.0.0 Safari/537.36";

function normalizeHostname(hostname) {
  return String(hostname || "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

function shouldUseDirectSessionDownload(rawUrl) {
  try {
    const parsedUrl = new URL(String(rawUrl || ""));
    return DIRECT_SESSION_DOWNLOAD_HOSTS.has(
      normalizeHostname(parsedUrl.hostname),
    );
  } catch {
    return false;
  }
}

function decodeUriComponentSafely(value) {
  try {
    return decodeURIComponent(String(value || "").replace(/\+/g, "%20"));
  } catch {
    return String(value || "");
  }
}

function stripQuotedValue(value) {
  const normalizedValue = String(value || "").trim();
  if (
    (normalizedValue.startsWith('"') && normalizedValue.endsWith('"')) ||
    (normalizedValue.startsWith("'") && normalizedValue.endsWith("'"))
  ) {
    return normalizedValue.slice(1, -1);
  }

  return normalizedValue;
}

function parseContentDispositionFilename(contentDisposition) {
  const normalizedHeader = String(contentDisposition || "");
  if (!normalizedHeader) {
    return "";
  }

  const extendedFilenameMatch = normalizedHeader.match(
    /filename\*\s*=\s*([^;]+)/i,
  );
  if (extendedFilenameMatch) {
    const rawExtendedValue = stripQuotedValue(extendedFilenameMatch[1] || "");
    const charsetMatch = rawExtendedValue.match(/^[^']*'[^']*'(.*)$/);
    const encodedFileName = charsetMatch
      ? charsetMatch[1]
      : rawExtendedValue.replace(/^[^']*''/, "");
    const decodedFileName = decodeUriComponentSafely(encodedFileName);
    if (decodedFileName) {
      return decodedFileName;
    }
  }

  const filenameMatch = normalizedHeader.match(/filename\s*=\s*([^;]+)/i);
  if (!filenameMatch) {
    return "";
  }

  return stripQuotedValue(filenameMatch[1] || "");
}

function extractFileNameFromUrl(rawUrl) {
  try {
    const parsedUrl = new URL(String(rawUrl || ""));

    for (const paramName of ["filename", "file", "name"]) {
      const paramValue = decodeUriComponentSafely(
        parsedUrl.searchParams.get(paramName),
      ).trim();
      if (paramValue) {
        return paramValue;
      }
    }

    const basename = decodeUriComponentSafely(
      path.basename(parsedUrl.pathname || ""),
    ).trim();
    if (basename && !["download", "uc"].includes(basename.toLowerCase())) {
      return basename;
    }

    return "";
  } catch {
    return "";
  }
}

function resolveDownloadFileName(input) {
  return (
    parseContentDispositionFilename(input?.contentDisposition) ||
    extractFileNameFromUrl(input?.finalUrl) ||
    extractFileNameFromUrl(input?.requestedUrl) ||
    ""
  );
}

function toNodeReadableStream(responseBody) {
  if (!responseBody) {
    throw new Error("Download response did not include a readable body.");
  }

  if (typeof responseBody.pipe === "function") {
    return responseBody;
  }

  if (typeof Readable.fromWeb === "function") {
    return Readable.fromWeb(responseBody);
  }

  throw new Error(
    "This runtime cannot convert the download response body into a stream.",
  );
}

async function streamResponseBodyToFile(input) {
  let receivedBytes = 0;

  const progressTransform = new Transform({
    transform(chunk, encoding, callback) {
      receivedBytes += chunk?.length || 0;
      if (typeof input?.onProgress === "function") {
        input.onProgress(receivedBytes);
      }
      callback(null, chunk);
    },
  });

  await pipeline(
    toNodeReadableStream(input?.responseBody),
    progressTransform,
    fs.createWriteStream(input.targetPath),
  );

  return receivedBytes;
}

module.exports = {
  DIRECT_DOWNLOAD_USER_AGENT,
  parseContentDispositionFilename,
  resolveDownloadFileName,
  shouldUseDirectSessionDownload,
  streamResponseBodyToFile,
};
