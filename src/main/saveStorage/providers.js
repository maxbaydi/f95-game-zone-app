// @ts-check

/**
 * Storage backends for save sync. Every backend exposes the same tiny
 * interface over a flat namespace of "relative/posix/paths":
 *
 *   list(prefix)  → [{ path, size, mtimeMs }]
 *   read(path)    → Buffer | null   (null when the object does not exist)
 *   write(path, buffer)
 *   remove(path)
 *   test()        → { ok, message, details }
 *
 * The sync engine (saveStorageSync.js) never touches transport details, so
 * a synced folder (Dropbox, OneDrive, Google Drive, Yandex.Disk, Syncthing
 * ...), a WebDAV server (Nextcloud, ownCloud, Yandex, Box, pCloud ...) and an
 * S3 bucket (Backblaze B2, Cloudflare R2, Wasabi, MinIO, AWS) behave alike.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SAVE_STORAGE_TYPES = /** @type {const} */ ({
  FOLDER: "folder",
  WEBDAV: "webdav",
  S3: "s3",
});

/**
 * @typedef {{ path: string, size: number, mtimeMs: number }} StorageEntry
 */

/**
 * @typedef {{
 *   kind: string,
 *   label: string,
 *   list: (prefix?: string) => Promise<StorageEntry[]>,
 *   read: (relativePath: string) => Promise<Buffer | null>,
 *   write: (relativePath: string, data: Buffer) => Promise<void>,
 *   remove: (relativePath: string) => Promise<void>,
 *   test: () => Promise<{ ok: boolean, message: string, details?: Record<string, any> }>,
 * }} SaveStorageProvider
 */

class SaveStorageError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, cause?: unknown, status?: number }=} options
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "SaveStorageError";
    this.code = options.code || "storage_failed";
    this.status = options.status || 0;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Relative paths are always posix, never absolute, never escaping the root.
 * @param {string} value
 */
function normalizeStoragePath(value) {
  const segments = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new SaveStorageError(`Invalid storage path: ${value}`, { code: "invalid_path" });
  }
  return segments.join("/");
}

// ─── Folder (synced by a desktop cloud client) ───────────────────────────

/**
 * @param {{ folderPath: string, label?: string }} settings
 * @returns {SaveStorageProvider}
 */
function createFolderProvider(settings) {
  const root = path.resolve(String(settings.folderPath || ""));
  if (!root || root === path.resolve("/") ) {
    throw new SaveStorageError("A folder is required.", { code: "invalid_config" });
  }
  const toAbsolute = (relativePath) => path.join(root, ...normalizeStoragePath(relativePath).split("/"));

  /** @param {unknown} error */
  const mapError = (error) => {
    const anyError = /** @type {any} */ (error);
    const code = String(anyError?.code || "");
    if (code === "ENOSPC") {
      return new SaveStorageError("The storage folder is out of space.", { code: "disk_full", cause: error });
    }
    if (code === "EACCES" || code === "EPERM") {
      return new SaveStorageError("The storage folder is not writable.", { code: "access_denied", cause: error });
    }
    if (code === "ENOENT") {
      return new SaveStorageError("The storage folder is not available (drive disconnected or cloud client stopped?).", {
        code: "unavailable",
        cause: error,
      });
    }
    return new SaveStorageError(anyError?.message || String(error), { cause: error });
  };

  return {
    kind: SAVE_STORAGE_TYPES.FOLDER,
    label: settings.label || root,
    async list(prefix = "") {
      const base = prefix ? toAbsolute(prefix) : root;
      /** @type {StorageEntry[]} */
      const entries = [];
      const walk = async (dir, relative) => {
        let dirents;
        try {
          dirents = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (error) {
          if (/** @type {any} */ (error)?.code === "ENOENT") {
            return;
          }
          throw mapError(error);
        }
        for (const dirent of dirents) {
          const nextRelative = relative ? `${relative}/${dirent.name}` : dirent.name;
          const full = path.join(dir, dirent.name);
          if (dirent.isDirectory()) {
            await walk(full, nextRelative);
          } else if (dirent.isFile() && !dirent.name.startsWith(".~")) {
            try {
              const stat = await fs.promises.stat(full);
              entries.push({ path: nextRelative, size: stat.size, mtimeMs: stat.mtimeMs });
            } catch {
              // Vanished between readdir and stat.
            }
          }
        }
      };
      await walk(base, prefix ? normalizeStoragePath(prefix) : "");
      return entries;
    },
    async read(relativePath) {
      try {
        return await fs.promises.readFile(toAbsolute(relativePath));
      } catch (error) {
        if (/** @type {any} */ (error)?.code === "ENOENT") {
          return null;
        }
        throw mapError(error);
      }
    },
    async write(relativePath, data) {
      const target = toAbsolute(relativePath);
      // Write next to the target and rename: a cloud client never uploads a
      // half-written archive, and a crash never leaves a truncated file.
      const temp = `${target}.~${process.pid}-${Date.now()}.tmp`;
      try {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(temp, data);
        await fs.promises.rename(temp, target);
      } catch (error) {
        await fs.promises.rm(temp, { force: true }).catch(() => {});
        throw mapError(error);
      }
    },
    async remove(relativePath) {
      try {
        await fs.promises.rm(toAbsolute(relativePath), { force: true });
      } catch (error) {
        throw mapError(error);
      }
    },
    async test() {
      try {
        await fs.promises.mkdir(root, { recursive: true });
        const probe = path.join(root, `.f95launcher-write-test-${Date.now()}`);
        await fs.promises.writeFile(probe, "ok");
        await fs.promises.rm(probe, { force: true });
        return { ok: true, message: "The folder is writable.", details: { root } };
      } catch (error) {
        const mapped = mapError(error);
        return { ok: false, message: mapped.message, details: { code: mapped.code } };
      }
    },
  };
}

// ─── WebDAV ──────────────────────────────────────────────────────────────

/**
 * @param {string} value
 */
function xmlUnescape(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Parses a PROPFIND multistatus body without an XML dependency. Namespace
 * prefixes differ between servers (d:, D:, lp1:, none), so tags are matched
 * by local name.
 * @param {string} xml
 * @returns {Array<{ href: string, isCollection: boolean, size: number, mtimeMs: number }>}
 */
function parseWebDavMultistatus(xml) {
  const responses = [];
  const responsePattern = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  let match;
  while ((match = responsePattern.exec(String(xml || "")))) {
    const block = match[1];
    const href = xmlUnescape((block.match(/<(?:[\w-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/i) || [])[1] || "").trim();
    if (!href) {
      continue;
    }
    const isCollection = /<(?:[\w-]+:)?collection\b/i.test(block);
    const size = Number.parseInt((block.match(/<(?:[\w-]+:)?getcontentlength\b[^>]*>([\s\S]*?)<\//i) || [])[1] || "0", 10) || 0;
    const modified = (block.match(/<(?:[\w-]+:)?getlastmodified\b[^>]*>([\s\S]*?)<\//i) || [])[1] || "";
    const mtimeMs = modified ? Date.parse(modified.trim()) || 0 : 0;
    responses.push({ href, isCollection, size, mtimeMs });
  }
  return responses;
}

/**
 * @param {{ url: string, username?: string, password?: string, label?: string, fetchImpl?: typeof fetch }} settings
 * @returns {SaveStorageProvider}
 */
function createWebDavProvider(settings) {
  const rawUrl = String(settings.url || "").trim();
  if (!/^https?:\/\//i.test(rawUrl)) {
    throw new SaveStorageError("The WebDAV address must start with http:// or https://.", { code: "invalid_config" });
  }
  const baseUrl = new URL(rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`);
  const basePath = baseUrl.pathname;
  const fetchImpl = settings.fetchImpl || fetch;
  const authHeader =
    settings.username || settings.password
      ? `Basic ${Buffer.from(`${settings.username || ""}:${settings.password || ""}`).toString("base64")}`
      : "";

  const urlFor = (relativePath, trailingSlash = false) => {
    const normalized = relativePath ? normalizeStoragePath(relativePath) : "";
    const encoded = normalized
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return new URL(`${encoded}${trailingSlash && encoded ? "/" : ""}`, baseUrl).toString();
  };

  const request = async (method, relativePath, options = {}) => {
    let response;
    try {
      response = await fetchImpl(urlFor(relativePath, options.collection), {
        method,
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...(options.headers || {}),
        },
        body: options.body,
        redirect: "follow",
      });
    } catch (error) {
      throw new SaveStorageError("The WebDAV server could not be reached.", { code: "network", cause: error });
    }
    if (response.status === 401 || response.status === 403) {
      throw new SaveStorageError("The WebDAV server rejected the login. Check the username and the app password.", {
        code: "auth_failed",
        status: response.status,
      });
    }
    if (response.status === 507) {
      throw new SaveStorageError("The WebDAV storage is out of space.", { code: "disk_full", status: 507 });
    }
    return response;
  };

  const ensureCollection = async (relativePath) => {
    const segments = relativePath ? normalizeStoragePath(relativePath).split("/") : [];
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const response = await request("MKCOL", current, { collection: true });
      // 201 created, 405 already exists, 301/302 redirects to the collection.
      if (![201, 405, 301, 302, 200, 204].includes(response.status)) {
        throw new SaveStorageError(`Could not create folder ${current} on the WebDAV server (HTTP ${response.status}).`, {
          code: "write_failed",
          status: response.status,
        });
      }
    }
  };

  const hrefToRelative = (href) => {
    let pathname = href;
    try {
      pathname = new URL(href, baseUrl).pathname;
    } catch {
      pathname = href;
    }
    const decoded = decodeURIComponent(pathname);
    const decodedBase = decodeURIComponent(basePath);
    if (!decoded.startsWith(decodedBase)) {
      return "";
    }
    return decoded.slice(decodedBase.length).replace(/^\/+|\/+$/g, "");
  };

  const listCollection = async (relativePath) => {
    const response = await request("PROPFIND", relativePath, {
      collection: true,
      headers: { Depth: "1", "Content-Type": "application/xml" },
      body:
        '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>',
    });
    if (response.status === 404) {
      return [];
    }
    if (response.status !== 207) {
      throw new SaveStorageError(`Listing failed on the WebDAV server (HTTP ${response.status}).`, {
        code: "list_failed",
        status: response.status,
      });
    }
    const self = relativePath ? normalizeStoragePath(relativePath) : "";
    return parseWebDavMultistatus(await response.text())
      .map((entry) => ({ ...entry, relative: hrefToRelative(entry.href) }))
      .filter((entry) => entry.relative !== self);
  };

  return {
    kind: SAVE_STORAGE_TYPES.WEBDAV,
    label: settings.label || baseUrl.host,
    async list(prefix = "") {
      /** @type {StorageEntry[]} */
      const entries = [];
      const queue = [prefix ? normalizeStoragePath(prefix) : ""];
      while (queue.length) {
        const current = /** @type {string} */ (queue.shift());
        for (const entry of await listCollection(current)) {
          if (!entry.relative) {
            continue;
          }
          if (entry.isCollection) {
            queue.push(entry.relative);
          } else {
            entries.push({ path: entry.relative, size: entry.size, mtimeMs: entry.mtimeMs });
          }
        }
      }
      return entries;
    },
    async read(relativePath) {
      const response = await request("GET", relativePath);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new SaveStorageError(`Download failed on the WebDAV server (HTTP ${response.status}).`, {
          code: "read_failed",
          status: response.status,
        });
      }
      return Buffer.from(await response.arrayBuffer());
    },
    async write(relativePath, data) {
      const normalized = normalizeStoragePath(relativePath);
      const parent = normalized.split("/").slice(0, -1).join("/");
      let response = await request("PUT", normalized, {
        body: data,
        headers: { "Content-Type": "application/octet-stream" },
      });
      if (response.status === 404 || response.status === 409) {
        await ensureCollection(parent);
        response = await request("PUT", normalized, {
          body: data,
          headers: { "Content-Type": "application/octet-stream" },
        });
      }
      if (![200, 201, 204].includes(response.status)) {
        throw new SaveStorageError(`Upload failed on the WebDAV server (HTTP ${response.status}).`, {
          code: "write_failed",
          status: response.status,
        });
      }
    },
    async remove(relativePath) {
      const response = await request("DELETE", relativePath);
      if (![200, 202, 204, 404].includes(response.status)) {
        throw new SaveStorageError(`Delete failed on the WebDAV server (HTTP ${response.status}).`, {
          code: "write_failed",
          status: response.status,
        });
      }
    },
    async test() {
      try {
        const probe = `.f95launcher-write-test-${Date.now()}.txt`;
        await this.write(probe, Buffer.from("ok"));
        const back = await this.read(probe);
        await this.remove(probe);
        if (!back || back.toString() !== "ok") {
          return { ok: false, message: "The server accepted the upload but returned different content." };
        }
        return { ok: true, message: `Connected to ${baseUrl.host}.`, details: { host: baseUrl.host } };
      } catch (error) {
        const anyError = /** @type {any} */ (error);
        return { ok: false, message: anyError?.message || String(error), details: { code: anyError?.code || "" } };
      }
    },
  };
}

// ─── S3-compatible ───────────────────────────────────────────────────────

/**
 * @param {string} value
 */
function s3Encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Minimal SigV4 signer: enough for ListObjectsV2, GetObject, PutObject and
 * DeleteObject on any S3-compatible service, without the AWS SDK.
 * @param {{
 *   endpoint: string,
 *   region?: string,
 *   bucket: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   forcePathStyle?: boolean,
 *   prefix?: string,
 *   label?: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => Date,
 * }} settings
 * @returns {SaveStorageProvider}
 */
function createS3Provider(settings) {
  const endpointRaw = String(settings.endpoint || "").trim();
  const bucket = String(settings.bucket || "").trim();
  const region = String(settings.region || "").trim() || "us-east-1";
  const accessKeyId = String(settings.accessKeyId || "").trim();
  const secretAccessKey = String(settings.secretAccessKey || "");
  if (!/^https?:\/\//i.test(endpointRaw) || !bucket || !accessKeyId || !secretAccessKey) {
    throw new SaveStorageError("Endpoint, bucket, access key and secret key are required.", { code: "invalid_config" });
  }
  const endpoint = new URL(endpointRaw);
  const pathStyle = settings.forcePathStyle !== false;
  const host = pathStyle ? endpoint.host : `${bucket}.${endpoint.host}`;
  const keyPrefix = settings.prefix ? normalizeStoragePath(settings.prefix) : "";
  const fetchImpl = settings.fetchImpl || fetch;
  const now = settings.now || (() => new Date());

  const objectKey = (relativePath) => {
    const normalized = relativePath ? normalizeStoragePath(relativePath) : "";
    return keyPrefix ? (normalized ? `${keyPrefix}/${normalized}` : keyPrefix) : normalized;
  };

  const buildUrl = (key, query) => {
    const encodedKey = key.split("/").map(s3Encode).join("/");
    const pathname = pathStyle
      ? `${endpoint.pathname.replace(/\/+$/, "")}/${bucket}${encodedKey ? `/${encodedKey}` : ""}`
      : `${endpoint.pathname.replace(/\/+$/, "")}/${encodedKey}`;
    const canonicalQuery = Object.keys(query || {})
      .sort()
      .map((name) => `${s3Encode(name)}=${s3Encode(String(query[name]))}`)
      .join("&");
    return { url: `${endpoint.protocol}//${host}${pathname}${canonicalQuery ? `?${canonicalQuery}` : ""}`, pathname, canonicalQuery };
  };

  const signedRequest = async (method, key, options = {}) => {
    const body = options.body || Buffer.alloc(0);
    const payloadHash = sha256Hex(body);
    const date = now();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const { url, pathname, canonicalQuery } = buildUrl(key, options.query);
    const headers = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...(options.headers || {}),
    };
    const signedHeaderNames = Object.keys(headers).map((name) => name.toLowerCase()).sort();
    const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${String(headers[name] ?? headers[Object.keys(headers).find((key2) => key2.toLowerCase() === name) || name]).trim()}\n`).join("");
    const canonicalRequest = [
      method,
      pathname.split("/").map((segment) => (segment ? s3Encode(decodeURIComponent(segment)) : "")).join("/"),
      canonicalQuery,
      canonicalHeaders,
      signedHeaderNames.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), "s3"), "aws4_request");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { ...headers, Authorization: authorization },
        body: method === "GET" || method === "DELETE" ? undefined : body,
      });
    } catch (error) {
      throw new SaveStorageError("The S3 endpoint could not be reached.", { code: "network", cause: error });
    }
    if (response.status === 401 || response.status === 403) {
      throw new SaveStorageError("The S3 service rejected the credentials. Check the access key, secret key and bucket permissions.", {
        code: "auth_failed",
        status: response.status,
      });
    }
    return response;
  };

  const describeFailure = async (response, action) => {
    let detail = "";
    try {
      const text = await response.text();
      detail = (text.match(/<Message>([\s\S]*?)<\/Message>/i) || [])[1] || (text.match(/<Code>([\s\S]*?)<\/Code>/i) || [])[1] || "";
    } catch {
      detail = "";
    }
    return new SaveStorageError(`${action} failed on the S3 service (HTTP ${response.status}${detail ? `: ${detail}` : ""}).`, {
      code: response.status === 404 ? "not_found" : "storage_failed",
      status: response.status,
    });
  };

  return {
    kind: SAVE_STORAGE_TYPES.S3,
    label: settings.label || `${bucket} @ ${endpoint.host}`,
    async list(prefix = "") {
      const fullPrefix = objectKey(prefix);
      /** @type {StorageEntry[]} */
      const entries = [];
      let continuationToken = "";
      do {
        const query = { "list-type": "2", prefix: fullPrefix ? `${fullPrefix}/` : "", "max-keys": "1000" };
        if (continuationToken) {
          query["continuation-token"] = continuationToken;
        }
        const response = await signedRequest("GET", "", { query });
        if (!response.ok) {
          throw await describeFailure(response, "Listing");
        }
        const xml = await response.text();
        const contents = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
        for (const block of contents) {
          const key = xmlUnescape((block.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1] || "");
          if (!key) continue;
          const relative = keyPrefix ? key.slice(keyPrefix.length + 1) : key;
          entries.push({
            path: relative,
            size: Number.parseInt((block.match(/<Size>(\d+)<\/Size>/) || [])[1] || "0", 10) || 0,
            mtimeMs: Date.parse((block.match(/<LastModified>([\s\S]*?)<\/LastModified>/) || [])[1] || "") || 0,
          });
        }
        const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
        continuationToken = truncated ? xmlUnescape((xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1] || "") : "";
      } while (continuationToken);
      return entries;
    },
    async read(relativePath) {
      const response = await signedRequest("GET", objectKey(relativePath));
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw await describeFailure(response, "Download");
      }
      return Buffer.from(await response.arrayBuffer());
    },
    async write(relativePath, data) {
      const response = await signedRequest("PUT", objectKey(relativePath), {
        body: data,
        headers: { "content-type": "application/octet-stream", "content-length": String(data.length) },
      });
      if (!response.ok) {
        throw await describeFailure(response, "Upload");
      }
    },
    async remove(relativePath) {
      const response = await signedRequest("DELETE", objectKey(relativePath));
      if (!response.ok && response.status !== 404) {
        throw await describeFailure(response, "Delete");
      }
    },
    async test() {
      try {
        const probe = `.f95launcher-write-test-${Date.now()}.txt`;
        await this.write(probe, Buffer.from("ok"));
        const back = await this.read(probe);
        await this.remove(probe);
        if (!back || back.toString() !== "ok") {
          return { ok: false, message: "The bucket accepted the upload but returned different content." };
        }
        return { ok: true, message: `Connected to bucket ${bucket}.`, details: { bucket, host } };
      } catch (error) {
        const anyError = /** @type {any} */ (error);
        return { ok: false, message: anyError?.message || String(error), details: { code: anyError?.code || "" } };
      }
    },
  };
}

/**
 * @param {{ type: string, settings: Record<string, any>, secrets?: Record<string, any> }} connection
 * @returns {SaveStorageProvider}
 */
function createSaveStorageProvider(connection) {
  const settings = /** @type {any} */ ({ ...(connection?.settings || {}), ...(connection?.secrets || {}) });
  switch (String(connection?.type || "")) {
    case SAVE_STORAGE_TYPES.FOLDER:
      return createFolderProvider(settings);
    case SAVE_STORAGE_TYPES.WEBDAV:
      return createWebDavProvider(settings);
    case SAVE_STORAGE_TYPES.S3:
      return createS3Provider(settings);
    default:
      throw new SaveStorageError(`Unknown storage type: ${connection?.type}`, { code: "invalid_config" });
  }
}

module.exports = {
  SAVE_STORAGE_TYPES,
  SaveStorageError,
  createFolderProvider,
  createS3Provider,
  createSaveStorageProvider,
  createWebDavProvider,
  normalizeStoragePath,
  parseWebDavMultistatus,
};
