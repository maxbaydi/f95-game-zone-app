const {
  MirrorError,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  hostMatchesDomain,
  isFileResponse,
  normalizeText,
  pickBestFile,
  readResponseText,
  safeDecodeHtmlEntities,
  safeParseUrl,
  stripHtmlTags,
} = require("./common");

const HOST_LABEL = "Files.fm";
const FILESFM_DOMAINS = ["files.fm"];

function isFilesFmHost(hostname) {
  return hostMatchesDomain(hostname, FILESFM_DOMAINS);
}

/**
 * @param {string} rawUrl
 * @returns {null | {kind: "file" | "upload" | "direct", hash: string}}
 */
function parseFilesFmUrl(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl || !isFilesFmHost(parsedUrl.hostname)) {
    return null;
  }

  if (/\/down\.php$/i.test(parsedUrl.pathname)) {
    return { kind: "direct", hash: parsedUrl.searchParams.get("i") || "" };
  }

  const fileMatch = parsedUrl.pathname.match(/^\/f\/([A-Za-z0-9]+)/i);
  if (fileMatch) {
    return { kind: "file", hash: fileMatch[1] };
  }

  const uploadMatch = parsedUrl.pathname.match(/^\/u\/([A-Za-z0-9]+)/i);
  if (uploadMatch) {
    const hashFileMatch = parsedUrl.hash.match(/^#\/?(?:view|f)\/([A-Za-z0-9]+)/i);
    if (hashFileMatch) {
      return { kind: "file", hash: hashFileMatch[1] };
    }
    return { kind: "upload", hash: uploadMatch[1] };
  }

  return null;
}

function buildFilesFmDownloadUrl(fileHash) {
  const downloadUrl = new URL("https://files.fm/down.php");
  downloadUrl.searchParams.set("i", fileHash);
  return downloadUrl.toString();
}

/**
 * Collect the files listed on an upload (folder) page.
 * @param {string} html
 * @param {string} uploadHash
 */
function extractFilesFmUploadFiles(html, uploadHash) {
  const text = String(html || "");
  const files = new Map();
  const addFile = (hash, name, size) => {
    const normalizedHash = String(hash || "").trim();
    if (!normalizedHash || normalizedHash === uploadHash) {
      return;
    }
    const existing = files.get(normalizedHash) || { hash: normalizedHash, name: "", size: 0 };
    if (!existing.name && name) {
      existing.name = normalizeText(safeDecodeHtmlEntities(name));
    }
    if (!existing.size && size) {
      existing.size = Number(size) || 0;
    }
    files.set(normalizedHash, existing);
  };

  const downPattern = /down\.php\?(?:[^"'<>]*&(?:amp;)?)?i=([A-Za-z0-9]+)[^"'<>]*/gi;
  let match = null;
  while ((match = downPattern.exec(text))) {
    const nameMatch = match[0].match(/[?&](?:amp;)?n=([^&"'<>]+)/i);
    let name = "";
    try {
      name = nameMatch ? decodeURIComponent(nameMatch[1]) : "";
    } catch {
      name = nameMatch ? nameMatch[1] : "";
    }
    addFile(match[1], name, 0);
  }

  const itemPattern =
    /<div\b[^>]*class\s*=\s*["'][^"']*\bitem\b[^"']*["'][^>]*>([\s\S]{0,2000}?)<\/div>\s*<\/div>/gi;
  while ((match = itemPattern.exec(text))) {
    const block = match[0];
    const hashMatch =
      block.match(/data-(?:file-)?hash\s*=\s*["']([A-Za-z0-9]+)["']/i) ||
      block.match(/\/f\/([A-Za-z0-9]+)/i);
    if (!hashMatch) {
      continue;
    }
    const nameMatch =
      block.match(/title\s*=\s*["']([^"']+\.[A-Za-z0-9]{1,8})["']/i) ||
      block.match(/class\s*=\s*["'][^"']*\bfile_name\b[^"']*["'][^>]*>([\s\S]*?)<\//i);
    const sizeMatch = block.match(/data-size\s*=\s*["'](\d+)["']/i);
    addFile(
      hashMatch[1],
      nameMatch ? stripHtmlTags(nameMatch[1]) : "",
      sizeMatch ? sizeMatch[1] : 0,
    );
  }

  const filePagePattern = /files\.fm\/f\/([A-Za-z0-9]+)/gi;
  while ((match = filePagePattern.exec(text))) {
    addFile(match[1], "", 0);
  }

  return [...files.values()];
}

/**
 * @param {any} ctx
 * @param {string} rawUrl
 */
async function resolveFilesFmTarget(ctx, rawUrl) {
  const parsed = parseFilesFmUrl(rawUrl);
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

  if (parsed.kind === "file") {
    return {
      url: buildFilesFmDownloadUrl(parsed.hash),
      headers: { referer: `https://files.fm/f/${parsed.hash}` },
      transfer: "direct",
    };
  }

  const pageUrl = `https://files.fm/u/${parsed.hash}`;
  const response = await ctx.fetch(pageUrl, { method: "GET", redirect: "follow" });
  if (!response.ok) {
    await cancelResponseBody(response);
    if (response.status === 404) {
      throw new MirrorError("This Files.fm upload no longer exists.", {
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
  const files = extractFilesFmUploadFiles(html, parsed.hash);
  if (files.length === 0) {
    if (/upload (?:was|has been) (?:deleted|removed)|not found|expired/i.test(stripHtmlTags(html).slice(0, 4000))) {
      throw new MirrorError("This Files.fm upload no longer exists.", {
        code: "not_found",
      });
    }
    throw createActionRequiredError(
      HOST_LABEL,
      pageUrl,
      "upload page did not list any downloadable file.",
    );
  }

  const namedFiles = files.filter((file) => file.name);
  const selectedFile =
    files.length === 1
      ? files[0]
      : pickBestFile(namedFiles, { platformHint: ctx.platformHint });
  if (!selectedFile) {
    throw createActionRequiredError(
      HOST_LABEL,
      pageUrl,
      "upload contains several files and F95Launcher could not tell which one is the game.",
    );
  }

  return {
    url: buildFilesFmDownloadUrl(selectedFile.hash),
    fileName: selectedFile.name,
    size: selectedFile.size,
    headers: { referer: pageUrl },
    transfer: "direct",
  };
}

module.exports = {
  FILESFM_DOMAINS,
  HOST_LABEL,
  extractFilesFmUploadFiles,
  isFilesFmHost,
  parseFilesFmUrl,
  resolveFilesFmTarget,
};
