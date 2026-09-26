/**
 * MEGA (mega.nz) resolver.
 *
 * MEGA files are end-to-end encrypted: the public API hands out a temporary
 * storage URL for the *encrypted* payload, and the key lives in the link
 * fragment. The transfer pipeline therefore streams the payload through
 * `createMegaDecryptTransform` (AES-128-CTR) instead of using
 * `session.downloadURL`.
 */
const crypto = require("crypto");
const { Transform } = require("stream");

const {
  MirrorError,
  assertNotSplitArchive,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  hostMatchesDomain,
  normalizeText,
  pickBestFile,
  readResponseJson,
  safeParseUrl,
} = require("./common");

const HOST_LABEL = "MEGA";
const MEGA_DOMAINS = ["mega.nz", "mega.co.nz", "mega.io", "mega.app"];
const MEGA_API_URL = "https://g.api.mega.co.nz/cs";
const MEGA_HANDLE_PATTERN = /^[A-Za-z0-9_-]{8,}$/;
const MEGA_QUOTA_MESSAGE =
  "MEGA transfer quota for your connection is used up (free accounts get a limited amount every few hours). Try again later or pick another mirror.";

const MEGA_ERRORS = {
  "-1": { code: "mega_internal", retryable: true, message: "MEGA reported an internal error." },
  "-2": { code: "invalid_link", retryable: false, message: "This MEGA link is invalid or malformed." },
  "-3": { code: "mega_busy", retryable: true, message: "MEGA servers are busy right now." },
  "-4": { code: "rate_limited", retryable: true, message: "MEGA is rate-limiting requests right now." },
  "-6": { code: "rate_limited", retryable: true, message: "MEGA reports too many concurrent requests for this file." },
  "-8": { code: "link_expired", retryable: false, message: "This MEGA link has expired." },
  "-9": { code: "not_found", retryable: false, message: "This MEGA file no longer exists (it was deleted or the link is wrong)." },
  "-11": { code: "access_denied", retryable: false, message: "Access to this MEGA link is denied." },
  "-14": { code: "mega_bad_key", retryable: false, message: "The decryption key in this MEGA link is wrong." },
  "-16": { code: "blocked", retryable: false, message: "This MEGA link was taken down (blocked by MEGA)." },
  "-17": { code: "bandwidth_exceeded", retryable: false, message: MEGA_QUOTA_MESSAGE },
  "-18": { code: "temporarily_unavailable", retryable: true, message: "MEGA says this file is temporarily unavailable. Try again in a little while." },
};

let megaSequence = crypto.randomInt(0, 0x7fffffff);

function isMegaHost(hostname) {
  return hostMatchesDomain(hostname, MEGA_DOMAINS);
}

function createMegaApiError(errorCode) {
  const known = MEGA_ERRORS[String(errorCode)];
  if (known) {
    return new MirrorError(`${known.message} (MEGA error ${errorCode})`, {
      code: known.code,
      retryable: known.retryable,
      userMessage: known.message,
    });
  }

  return new MirrorError(`MEGA API returned error ${errorCode}.`, {
    code: "mega_api",
  });
}

function base64UrlDecode(value) {
  return Buffer.from(
    String(value || "")
      .trim()
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .replace(/,/g, ""),
    "base64",
  );
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * @param {string} rawUrl
 * @returns {null | {kind: "file" | "folder" | "protected", handle: string, key: string, targetHandle: string}}
 */
function parseMegaUrl(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl || !isMegaHost(parsedUrl.hostname)) {
    return null;
  }

  const pathname = parsedUrl.pathname.replace(/\/+$/, "");
  const rawFragment = String(parsedUrl.hash || "").replace(/^#/, "");
  let fragment = rawFragment;
  try {
    fragment = decodeURIComponent(rawFragment);
  } catch {
    fragment = rawFragment;
  }

  const fileMatch = pathname.match(/^\/(?:file|embed)\/([A-Za-z0-9_-]+)$/i);
  if (fileMatch) {
    return {
      kind: "file",
      handle: fileMatch[1],
      key: fragment.split(/[/?&]/)[0] || "",
      targetHandle: "",
    };
  }

  const folderMatch = pathname.match(/^\/folder\/([A-Za-z0-9_-]+)$/i);
  if (folderMatch) {
    const [key = "", ...rest] = fragment.split("/");
    const targetIndex = rest.findIndex((part) => /^(file|folder)$/i.test(part));
    return {
      kind: "folder",
      handle: folderMatch[1],
      key,
      targetHandle: targetIndex >= 0 ? rest[targetIndex + 1] || "" : "",
    };
  }

  if (/^P!/i.test(fragment)) {
    return { kind: "protected", handle: "", key: "", targetHandle: "" };
  }

  if (fragment.startsWith("F!")) {
    const [handle = "", key = "", targetHandle = ""] = fragment.slice(2).split("!");
    return { kind: "folder", handle, key, targetHandle };
  }

  if (fragment.startsWith("!")) {
    const [handle = "", key = ""] = fragment.slice(1).split("!");
    return { kind: "file", handle, key, targetHandle: "" };
  }

  return null;
}

/**
 * Derive the AES key / CTR nonce from a 256-bit MEGA file key.
 * @param {Buffer} fileKey
 */
function deriveMegaFileKey(fileKey) {
  if (!Buffer.isBuffer(fileKey) || fileKey.length < 32) {
    throw new MirrorError("The decryption key in this MEGA link is incomplete.", {
      code: "mega_bad_key",
    });
  }

  const aesKey = Buffer.alloc(16);
  for (let index = 0; index < 4; index += 1) {
    const word =
      (fileKey.readUInt32BE(index * 4) ^ fileKey.readUInt32BE((index + 4) * 4)) >>> 0;
    aesKey.writeUInt32BE(word, index * 4);
  }

  const iv = Buffer.alloc(16);
  fileKey.copy(iv, 0, 16, 24);

  return {
    aesKey,
    iv,
    metaMac: fileKey.subarray(24, 32),
  };
}

/**
 * @param {string} attributeB64
 * @param {Buffer} aesKey
 * @returns {Record<string, any>}
 */
function decryptMegaAttributes(attributeB64, aesKey) {
  let data = base64UrlDecode(attributeB64);
  if (data.length === 0) {
    return {};
  }
  if (data.length % 16 !== 0) {
    data = Buffer.concat([data, Buffer.alloc(16 - (data.length % 16))]);
  }

  const decipher = crypto.createDecipheriv("aes-128-cbc", aesKey, Buffer.alloc(16));
  decipher.setAutoPadding(false);
  const text = Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );

  if (!text.startsWith("MEGA{")) {
    throw new MirrorError("The decryption key in this MEGA link is wrong.", {
      code: "mega_bad_key",
    });
  }

  const jsonEnd = text.lastIndexOf("}");
  try {
    return JSON.parse(text.slice(4, jsonEnd + 1));
  } catch {
    throw new MirrorError("MEGA file attributes could not be decoded.", {
      code: "mega_bad_key",
    });
  }
}

/** Test helper / inverse of decryptMegaAttributes. */
function encryptMegaAttributes(attributes, aesKey) {
  let data = Buffer.from(`MEGA${JSON.stringify(attributes)}`, "utf8");
  if (data.length % 16 !== 0) {
    data = Buffer.concat([data, Buffer.alloc(16 - (data.length % 16))]);
  }
  const cipher = crypto.createCipheriv("aes-128-cbc", aesKey, Buffer.alloc(16));
  cipher.setAutoPadding(false);
  return base64UrlEncode(Buffer.concat([cipher.update(data), cipher.final()]));
}

function aesEcb(key, data, decrypt) {
  const cipher = decrypt
    ? crypto.createDecipheriv("aes-128-ecb", key, null)
    : crypto.createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function decryptMegaNodeKey(encryptedKeyB64, folderKey) {
  const encrypted = base64UrlDecode(encryptedKeyB64);
  if (encrypted.length === 0 || encrypted.length % 16 !== 0) {
    return Buffer.alloc(0);
  }
  return aesEcb(folderKey, encrypted, true);
}

/** Test helper / inverse of decryptMegaNodeKey. */
function encryptMegaNodeKey(nodeKey, folderKey) {
  return base64UrlEncode(aesEcb(folderKey, nodeKey, false));
}

function computeCtrIv(iv, offset) {
  const blockIndex = BigInt(Math.floor(Math.max(0, offset) / 16));
  const mask = (BigInt(1) << BigInt(128)) - BigInt(1);
  const counter = (BigInt(`0x${iv.toString("hex")}`) + blockIndex) & mask;
  return Buffer.from(counter.toString(16).padStart(32, "0"), "hex");
}

/**
 * AES-128-CTR decrypting transform that can start at any byte offset (used
 * for resumed downloads).
 * @param {{keyHex: string, ivHex: string, offset?: number}} input
 */
function createMegaDecryptTransform(input) {
  const key = Buffer.from(String(input.keyHex || ""), "hex");
  const iv = Buffer.from(String(input.ivHex || ""), "hex");
  const offset = Math.max(0, Number(input.offset) || 0);
  const decipher = crypto.createDecipheriv("aes-128-ctr", key, computeCtrIv(iv, offset));
  const skip = offset % 16;
  if (skip > 0) {
    decipher.update(Buffer.alloc(skip));
  }

  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        callback(null, decipher.update(chunk));
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      try {
        const rest = decipher.final();
        if (rest.length > 0) {
          this.push(rest);
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
}

/**
 * @param {any} ctx
 * @param {Record<string, any>} command
 * @param {{folderHandle?: string}} [options]
 */
async function megaApiRequest(ctx, command, options = {}) {
  const apiUrl = new URL(MEGA_API_URL);
  apiUrl.searchParams.set("id", String(megaSequence));
  megaSequence = (megaSequence + 1) % 0x7fffffff;
  if (options.folderHandle) {
    apiUrl.searchParams.set("n", options.folderHandle);
  }

  const response = await ctx.fetch(apiUrl.toString(), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify([command]),
  });

  if (response.status === 509) {
    await cancelResponseBody(response);
    throw createMegaApiError(-17);
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    throw createHttpError(response, HOST_LABEL);
  }

  const payload = await readResponseJson(response);
  if (typeof payload === "number") {
    throw createMegaApiError(payload);
  }

  if (!Array.isArray(payload) || payload.length === 0) {
    throw new MirrorError("MEGA API returned an unexpected response.", {
      code: "mega_api",
      retryable: true,
    });
  }

  const result = payload[0];
  if (typeof result === "number") {
    if (result < 0) {
      throw createMegaApiError(result);
    }
    return {};
  }

  return result && typeof result === "object" ? result : {};
}

function readDownloadUrl(result) {
  const value = Array.isArray(result?.g) ? result.g[0] : result?.g;
  return typeof value === "string" ? value.trim() : "";
}

function assertDownloadable(result) {
  const downloadUrl = readDownloadUrl(result);
  if (downloadUrl) {
    return downloadUrl;
  }

  if (typeof result?.e === "number" && result.e < 0) {
    throw createMegaApiError(result.e);
  }

  if (Number(result?.tl) > 0 || result?.efq) {
    throw createMegaApiError(-17);
  }

  throw new MirrorError("MEGA did not return a download URL for this file.", {
    code: "mega_api",
    retryable: true,
  });
}

function buildMegaTarget(downloadUrl, fileName, size, derivedKey) {
  return {
    url: downloadUrl,
    fileName: normalizeText(fileName),
    size: Number(size) || 0,
    transfer: "mega",
    rangeMode: "mega-path",
    mega: {
      keyHex: derivedKey.aesKey.toString("hex"),
      ivHex: derivedKey.iv.toString("hex"),
    },
  };
}

async function resolveMegaFileLink(ctx, parsed) {
  const fileKey = base64UrlDecode(parsed.key);
  const derivedKey = deriveMegaFileKey(fileKey);
  const result = await megaApiRequest(ctx, {
    a: "g",
    g: 1,
    ssl: 1,
    p: parsed.handle,
  });
  const downloadUrl = assertDownloadable(result);
  const attributes = result.at ? decryptMegaAttributes(result.at, derivedKey.aesKey) : {};

  return buildMegaTarget(downloadUrl, attributes.n, result.s, derivedKey);
}

function decryptFolderNode(node, folderKey) {
  const keyParts = String(node?.k || "")
    .split("/")
    .map((part) => part.split(":").pop())
    .filter(Boolean);

  for (const keyPart of keyParts) {
    try {
      const nodeKey = decryptMegaNodeKey(keyPart, folderKey);
      if (node.t === 0 && nodeKey.length >= 32) {
        const derivedKey = deriveMegaFileKey(nodeKey);
        const attributes = decryptMegaAttributes(node.a, derivedKey.aesKey);
        return { derivedKey, attributes };
      }
      if (node.t === 1 && nodeKey.length >= 16) {
        const attributes = decryptMegaAttributes(node.a, nodeKey.subarray(0, 16));
        return { derivedKey: null, attributes };
      }
    } catch {
      // Try the next key share.
    }
  }

  return null;
}

function collectDescendantHandles(nodes, rootHandle) {
  const handles = new Set([rootHandle]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!handles.has(node.h) && handles.has(node.p)) {
        handles.add(node.h);
        changed = true;
      }
    }
  }
  return handles;
}

async function resolveMegaFolderLink(ctx, parsed, rawUrl) {
  const folderKey = base64UrlDecode(parsed.key);
  if (folderKey.length !== 16) {
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "folder link is missing its decryption key.",
    );
  }

  const listing = await megaApiRequest(
    ctx,
    { a: "f", c: 1, ca: 1, r: 1 },
    { folderHandle: parsed.handle },
  );
  const nodes = Array.isArray(listing?.f) ? listing.f : [];
  if (nodes.length === 0) {
    throw createMegaApiError(-9);
  }

  let scope = null;
  if (parsed.targetHandle) {
    const targetNode = nodes.find((node) => node.h === parsed.targetHandle);
    if (targetNode?.t === 1) {
      scope = collectDescendantHandles(nodes, targetNode.h);
    } else if (targetNode?.t === 0) {
      scope = new Set([targetNode.h]);
    }
  }

  const files = [];
  for (const node of nodes) {
    if (node?.t !== 0 || (scope && !scope.has(node.h) && !scope.has(node.p))) {
      continue;
    }
    const decrypted = decryptFolderNode(node, folderKey);
    if (!decrypted?.derivedKey) {
      continue;
    }
    files.push({
      handle: node.h,
      name: normalizeText(decrypted.attributes?.n),
      size: Number(node.s) || 0,
      derivedKey: decrypted.derivedKey,
    });
  }

  if (files.length === 0) {
    throw new MirrorError(
      "This MEGA folder has no files F95Launcher could decrypt (wrong key or empty folder).",
      { code: "mega_bad_key" },
    );
  }

  const selectedFile = pickBestFile(files, { platformHint: ctx.platformHint });
  assertNotSplitArchive(selectedFile, files, HOST_LABEL);

  const result = await megaApiRequest(
    ctx,
    { a: "g", g: 1, ssl: 1, n: selectedFile.handle },
    { folderHandle: parsed.handle },
  );
  const downloadUrl = assertDownloadable(result);

  return buildMegaTarget(
    downloadUrl,
    selectedFile.name,
    result.s || selectedFile.size,
    selectedFile.derivedKey,
  );
}

/**
 * @param {any} ctx
 * @param {string} rawUrl
 */
async function resolveMegaTarget(ctx, rawUrl) {
  const parsed = parseMegaUrl(rawUrl);
  if (!parsed) {
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "link format is not recognised.",
    );
  }

  if (parsed.kind === "protected") {
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "link is password-protected.",
    );
  }

  if (!MEGA_HANDLE_PATTERN.test(parsed.handle)) {
    throw new MirrorError("This MEGA link is invalid or malformed.", {
      code: "invalid_link",
    });
  }

  if (!parsed.key) {
    throw createActionRequiredError(
      HOST_LABEL,
      rawUrl,
      "link is missing its decryption key (the part after #).",
    );
  }

  if (parsed.kind === "folder") {
    return resolveMegaFolderLink(ctx, parsed, rawUrl);
  }

  return resolveMegaFileLink(ctx, parsed);
}

function interpretMegaTransferError({ status }) {
  if (status === 509) {
    return new MirrorError(MEGA_QUOTA_MESSAGE, {
      code: "bandwidth_exceeded",
      status,
    });
  }
  if (status === 403 || status === 404 || status === 410) {
    return new MirrorError(
      `The temporary MEGA download link expired (HTTP ${status}). Retry the download to get a fresh one.`,
      { code: "link_expired", status },
    );
  }
  return null;
}

module.exports = {
  HOST_LABEL,
  MEGA_DOMAINS,
  base64UrlDecode,
  base64UrlEncode,
  computeCtrIv,
  createMegaDecryptTransform,
  decryptMegaAttributes,
  decryptMegaNodeKey,
  deriveMegaFileKey,
  encryptMegaAttributes,
  encryptMegaNodeKey,
  interpretMegaTransferError,
  isMegaHost,
  parseMegaUrl,
  resolveMegaTarget,
};
