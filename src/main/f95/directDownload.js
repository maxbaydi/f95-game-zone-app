const fs = require("fs");
const path = require("path");
const { Readable, Transform } = require("stream");
const { finished, pipeline } = require("stream/promises");

const {
  DownloadCancelledError,
  MirrorActionRequiredError,
  MirrorError,
  computeBackoffDelay,
  createHttpError,
  getHeader,
  hostnameOf,
  isAbortError,
  isTransientError,
  linkAbortSignals,
  looksLikeHtmlDocument,
  sleep,
} = require("./hosts/common");

const DIRECT_SESSION_DOWNLOAD_HOSTS = new Set([
  "drive.google.com",
  "docs.google.com",
  "drive.usercontent.google.com",
]);

const DIRECT_DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) F95Launcher/1.0 Chrome/125.0.0.0 Safari/537.36";

const DEFAULT_STALL_TIMEOUT_MS = 45000;
const DEFAULT_CONNECT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 6;
const DEFAULT_PROGRESS_INTERVAL_MS = 200;
const DISK_SPACE_MARGIN_BYTES = 64 * 1024 * 1024;
const PAYLOAD_SNIFF_BYTES = 512;
const ERROR_BODY_LIMIT_BYTES = 64 * 1024;

function normalizeHostname(hostname) {
  return String(hostname || "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

function shouldUseDirectSessionDownload(rawUrl) {
  try {
    const parsedUrl = new URL(String(rawUrl || ""));
    const hostname = normalizeHostname(parsedUrl.hostname);
    return (
      DIRECT_SESSION_DOWNLOAD_HOSTS.has(hostname) ||
      (hostname.endsWith(".gofile.io") &&
        parsedUrl.pathname.startsWith("/download"))
    );
  } catch {
    return false;
  }
}

/**
 * Pick how a prepared download is transferred:
 *  - "mega":    streamed + decrypted by downloadToFile (MEGA payloads are encrypted)
 *  - "session": handed to Electron's session.downloadURL (only on explicit request)
 *  - "direct":  streamed by downloadToFile with retry/resume (default)
 * @param {{transfer?: string, resolvedUrl?: string} | null | undefined} prepared
 * @returns {"mega" | "session" | "direct"}
 */
function selectTransferMode(prepared) {
  if (prepared?.transfer === "mega") {
    return "mega";
  }
  if (
    prepared?.transfer === "session" &&
    !shouldUseDirectSessionDownload(prepared?.resolvedUrl)
  ) {
    return "session";
  }
  return "direct";
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
    if (
      basename &&
      !["download", "uc", "content", "zip", "down.php", "file"].includes(
        basename.toLowerCase(),
      )
    ) {
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

// ─── Resilient transfer pipeline ────────────────────────────────────────────

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * @param {string} value e.g. "bytes 100-199/1000"
 * @returns {{start: number, end: number, total: number} | null}
 */
function parseContentRange(value) {
  const match = String(value || "").match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  if (!match) {
    return null;
  }
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === "*" ? 0 : Number(match[3]),
  };
}

/**
 * Build the request for a (possibly resumed) transfer attempt.
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {number} offset
 * @param {string} rangeMode "header" | "mega-path" | "none"
 * @param {number} totalBytes
 */
function buildTransferRequest(url, headers, offset, rangeMode, totalBytes) {
  if (!(offset > 0) || rangeMode === "none") {
    return { url, headers: { ...headers } };
  }

  if (rangeMode === "mega-path") {
    const end = totalBytes > 0 ? String(totalBytes - 1) : "";
    return {
      url: `${String(url).replace(/\/+$/, "")}/${offset}-${end}`,
      headers: { ...headers },
    };
  }

  return {
    url,
    headers: { ...headers, range: `bytes=${offset}-` },
  };
}

/**
 * Fail early when the target volume cannot hold the payload.
 * @param {string} directory
 * @param {number} requiredBytes
 */
async function checkFreeDiskSpace(directory, requiredBytes) {
  if (!(requiredBytes > 0) || typeof fs.promises.statfs !== "function") {
    return;
  }

  let stats = null;
  try {
    stats = await fs.promises.statfs(directory);
  } catch {
    return;
  }

  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  if (!Number.isFinite(availableBytes)) {
    return;
  }

  if (availableBytes < requiredBytes + DISK_SPACE_MARGIN_BYTES) {
    throw new MirrorError(
      `Not enough free disk space for this download: it needs ${formatBytes(requiredBytes)} but only ${formatBytes(availableBytes)} is free in ${directory}. Free up space (installing needs roughly the same amount again for extraction) and retry.`,
      { code: "disk_full" },
    );
  }
}

async function getFileSize(filePath) {
  try {
    return (await fs.promises.stat(filePath)).size;
  } catch {
    return 0;
  }
}

async function readErrorBody(response) {
  try {
    const reader = response?.body?.getReader?.();
    if (!reader) {
      const text = typeof response?.text === "function" ? await response.text() : "";
      return String(text || "").slice(0, ERROR_BODY_LIMIT_BYTES);
    }

    const chunks = [];
    let total = 0;
    while (total < ERROR_BODY_LIMIT_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      total += chunk.length;
    }
    await reader.cancel().catch(() => {});
    return Buffer.concat(chunks).toString("utf8", 0, Math.min(total, ERROR_BODY_LIMIT_BYTES));
  } catch {
    return "";
  }
}

async function discardBody(response) {
  try {
    if (response?.body && typeof response.body.cancel === "function") {
      await response.body.cancel();
    }
  } catch {
    // ignore
  }
}

function inspectPayloadStart(buffer, mimeType, label) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }

  if (looksLikeHtmlDocument(buffer)) {
    return new MirrorError(
      `${label} returned a web page instead of the file. The link may need a captcha or login, or it has expired — open the mirror in the browser, or retry to get a fresh link.`,
      { code: "html_payload" },
    );
  }

  const normalizedType = String(mimeType || "").toLowerCase().split(";")[0].trim();
  const preview = buffer.toString("utf8", 0, Math.min(buffer.length, 300)).trim();
  if (
    (normalizedType === "application/json" || normalizedType === "text/json") &&
    /^[[{]/.test(preview)
  ) {
    return new MirrorError(
      `${label} returned an error message instead of the file: ${preview.slice(0, 160)}`,
      { code: "html_payload" },
    );
  }

  return null;
}

function createProgressReporter(onProgress, intervalMs) {
  let lastEmitAt = 0;
  let lastSampleAt = Date.now();
  let lastSampleBytes = 0;
  let speed = 0;

  const report = (receivedBytes, totalBytes, force = false) => {
    if (typeof onProgress !== "function") {
      return;
    }
    const now = Date.now();
    if (!force && now - lastEmitAt < intervalMs) {
      return;
    }

    const elapsedMs = Math.max(now - lastSampleAt, 1);
    const deltaBytes = receivedBytes - lastSampleBytes;
    if (deltaBytes >= 0) {
      const instantSpeed = (deltaBytes * 1000) / elapsedMs;
      speed = speed > 0 ? speed * 0.7 + instantSpeed * 0.3 : instantSpeed;
    } else {
      speed = 0;
    }
    lastSampleAt = now;
    lastSampleBytes = receivedBytes;
    lastEmitAt = now;

    onProgress({
      receivedBytes,
      totalBytes,
      percent:
        totalBytes > 0
          ? Math.min(100, Math.floor((receivedBytes / totalBytes) * 100))
          : 0,
      speedBytesPerSecond: Math.max(0, Math.round(speed)),
    });
  };

  return {
    report,
    reset(receivedBytes) {
      speed = 0;
      lastSampleAt = Date.now();
      lastSampleBytes = receivedBytes;
    },
  };
}

function toTransferError(error, label) {
  if (
    error instanceof MirrorError ||
    error instanceof MirrorActionRequiredError ||
    error instanceof DownloadCancelledError
  ) {
    return error;
  }

  if (isTransientError(error) || isAbortError(error)) {
    return new MirrorError(
      `Lost the connection to ${label} and could not recover after several retries (${String(error?.message || error)}). Check your internet connection and retry.`,
      { code: "network" },
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Uniform chunk reader over a WHATWG ReadableStream or a Node readable.
 * @param {any} body
 */
function createChunkReader(body) {
  if (!body) {
    throw new Error("Download response did not include a readable body.");
  }

  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    return {
      read: () => reader.read(),
      cancel: () => reader.cancel().catch(() => {}),
    };
  }

  if (typeof body[Symbol.asyncIterator] === "function") {
    const iterator = body[Symbol.asyncIterator]();
    return {
      read: () => iterator.next(),
      cancel: async () => {
        try {
          await iterator.return?.();
        } catch {
          // ignore
        }
        body.destroy?.();
      },
    };
  }

  throw new Error(
    "This runtime cannot convert the download response body into a stream.",
  );
}

function createAbortError() {
  const error = new Error("The download attempt was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * Read one chunk, failing with a retryable "stalled" error when nothing
 * arrives for `stallTimeoutMs`, or an AbortError when `signal` fires.
 */
function readChunkWithWatchdog(reader, stallTimeoutMs, signal, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let onAbort = null;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (onAbort) {
        signal?.removeEventListener?.("abort", onAbort);
      }
      callback(value);
    };

    onAbort = () => finish(reject, createAbortError());
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
    timer = setTimeout(
      () =>
        finish(
          reject,
          new MirrorError(
            `No data received from ${label} for ${Math.round(stallTimeoutMs / 1000)}s.`,
            { code: "stalled", retryable: true },
          ),
        ),
      stallTimeoutMs,
    );
    reader.read().then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}

function waitForDrain(stream) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off("drain", onDrain);
      stream.off("close", onDrain);
      stream.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    stream.once("drain", onDrain);
    stream.once("close", onDrain);
    stream.once("error", onError);
  });
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return Buffer.from(value);
}

/**
 * Stream one response body into the part file with a stall watchdog,
 * payload sniffing and progress callbacks. On a network failure everything
 * received so far is flushed to disk first, so the caller can resume from
 * the part file size.
 */
async function streamAttempt(input) {
  const {
    response,
    partPath,
    append,
    transform,
    stallTimeoutMs,
    attemptLink,
    sniff,
    mimeType,
    label,
    onBytes,
  } = input;
  const reader = createChunkReader(response.body);
  const fileStream = fs.createWriteStream(partPath, { flags: append ? "a" : "w" });
  const writeTarget = transform || fileStream;
  const writeDone = transform ? pipeline(transform, fileStream) : finished(fileStream);
  // Keep a handler attached so an early write failure never goes unhandled.
  writeDone.catch(() => {});

  let streamedBytes = 0;
  let sniffChunks = sniff ? [] : null;
  let sniffLength = 0;
  let readError = null;

  const writeChunk = async (buffer) => {
    if (!writeTarget.write(buffer)) {
      await waitForDrain(writeTarget);
    }
  };

  const flushSniffedChunks = async () => {
    const chunks = sniffChunks || [];
    sniffChunks = null;
    const verdict = inspectPayloadStart(Buffer.concat(chunks), mimeType, label);
    if (verdict) {
      throw verdict;
    }
    for (const chunk of chunks) {
      await writeChunk(chunk);
    }
  };

  try {
    for (;;) {
      const result = await readChunkWithWatchdog(
        reader,
        stallTimeoutMs,
        attemptLink.signal,
        label,
      );
      if (result.done) {
        break;
      }

      const buffer = toBuffer(result.value);
      if (buffer.length === 0) {
        continue;
      }
      streamedBytes += buffer.length;

      if (sniffChunks) {
        sniffChunks.push(buffer);
        sniffLength += buffer.length;
        if (sniffLength >= PAYLOAD_SNIFF_BYTES) {
          await flushSniffedChunks();
        }
      } else {
        await writeChunk(buffer);
      }
      onBytes(streamedBytes);
    }

    if (sniffChunks) {
      await flushSniffedChunks();
    }
  } catch (error) {
    readError = error;
    attemptLink.abort(error);
    await reader.cancel();
    if (readError?.code !== "html_payload" && sniffChunks && sniffChunks.length > 0) {
      // Keep the bytes that arrived before the failure so resume can use them.
      try {
        await flushSniffedChunks();
      } catch (verdict) {
        readError = verdict;
      }
    }
  }

  if (readError?.code === "html_payload") {
    writeTarget.destroy();
    await writeDone.catch(() => {});
    throw readError;
  }

  writeTarget.end();
  try {
    await writeDone;
  } catch (writeError) {
    if (writeError?.code === "ENOSPC") {
      throw new MirrorError(
        `The disk ran out of space while downloading from ${label}. Free up space and retry.`,
        { code: "disk_full" },
      );
    }
    throw readError || writeError;
  }

  if (readError) {
    throw readError;
  }

  return streamedBytes;
}

/**
 * Download `url` to disk with retries, HTTP Range resume, a stall watchdog,
 * HTML/JSON payload detection and a free-space check.
 *
 * @param {{
 *   fetchImpl: (url: string, init: any) => Promise<any>,
 *   url: string,
 *   headers?: Record<string, string>,
 *   signal?: AbortSignal | null,
 *   resolveTargetPath: (fileName: string) => string,
 *   fallbackFileName?: string,
 *   fileNameHint?: string,
 *   expectedSize?: number,
 *   rangeMode?: "header" | "mega-path" | "none",
 *   createTransform?: ((offset: number) => import("stream").Transform) | null,
 *   interpretErrorResponse?: ((info: {status: number, bodyText: string, url: string}) => Error | null) | null,
 *   onTarget?: (info: {targetPath: string, fileName: string, totalBytes: number, mimeType: string}) => void,
 *   onProgress?: (info: {receivedBytes: number, totalBytes: number, percent: number, speedBytesPerSecond: number}) => void,
 *   onRetry?: (info: {attempt: number, maxAttempts: number, delayMs: number, error: any, resumeFrom: number, totalBytes: number}) => void,
 *   maxConsecutiveFailures?: number,
 *   stallTimeoutMs?: number,
 *   connectTimeoutMs?: number,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number,
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void>,
 *   checkDiskSpace?: (directory: string, requiredBytes: number) => Promise<void>,
 *   progressIntervalMs?: number,
 *   hostLabel?: string,
 * }} options
 * @returns {Promise<{targetPath: string, fileName: string, totalBytes: number, receivedBytes: number, mimeType: string, finalUrl: string}>}
 */
async function downloadToFile(options) {
  const {
    fetchImpl,
    url,
    headers = {},
    signal = null,
    resolveTargetPath,
    fallbackFileName = "download.bin",
    fileNameHint = "",
    expectedSize = 0,
    rangeMode = "header",
    createTransform = null,
    interpretErrorResponse = null,
    onTarget = null,
    onProgress = null,
    onRetry = null,
    maxConsecutiveFailures = DEFAULT_MAX_CONSECUTIVE_FAILURES,
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    sleep: sleepImpl = sleep,
    checkDiskSpace = checkFreeDiskSpace,
    progressIntervalMs = DEFAULT_PROGRESS_INTERVAL_MS,
    hostLabel = "",
  } = options;

  if (typeof fetchImpl !== "function") {
    throw new TypeError("downloadToFile requires fetchImpl.");
  }
  if (typeof resolveTargetPath !== "function") {
    throw new TypeError("downloadToFile requires resolveTargetPath.");
  }

  const label = hostLabel || hostnameOf(url) || "The mirror";
  const expectedTotal = Number(expectedSize) || 0;
  const state = {
    targetPath: "",
    partPath: "",
    fileName: "",
    totalBytes: expectedTotal,
    receivedBytes: 0,
    mimeType: "",
    finalUrl: url,
    supportsRange: rangeMode === "mega-path",
  };
  const progress = createProgressReporter(onProgress, progressIntervalMs);
  let failures = 0;

  const waitBeforeRetry = async (error) => {
    const delayMs = computeBackoffDelay(failures, {
      baseDelayMs,
      maxDelayMs,
      retryAfterMs: error?.retryAfterMs,
    });
    if (typeof onRetry === "function") {
      onRetry({
        attempt: failures,
        maxAttempts: maxConsecutiveFailures,
        delayMs,
        error,
        resumeFrom: state.receivedBytes,
        totalBytes: state.totalBytes,
      });
    }
    await sleepImpl(delayMs, signal || undefined);
    progress.reset(state.receivedBytes);
  };

  const throwIfCancelled = () => {
    if (signal?.aborted) {
      throw new DownloadCancelledError();
    }
  };

  try {
    for (;;) {
      throwIfCancelled();
      const offset = state.receivedBytes;
      const request = buildTransferRequest(
        url,
        headers,
        offset,
        rangeMode,
        state.totalBytes,
      );
      const attemptLink = linkAbortSignals([signal], connectTimeoutMs);

      let response = null;
      try {
        response = await fetchImpl(request.url, {
          method: "GET",
          redirect: "follow",
          headers: request.headers,
          signal: attemptLink.signal,
        });
      } catch (error) {
        const timedOut = attemptLink.didTimeout();
        attemptLink.dispose();
        throwIfCancelled();
        const connectError = timedOut
          ? new MirrorError(
              `${label} did not respond within ${Math.round(connectTimeoutMs / 1000)}s.`,
              { code: "timeout", retryable: true },
            )
          : error;
        failures += 1;
        if (failures < maxConsecutiveFailures && isTransientError(connectError)) {
          await waitBeforeRetry(connectError);
          continue;
        }
        throw toTransferError(connectError, label);
      }
      attemptLink.stopTimer();

      const status = Number(response.status) || (response.ok ? 200 : 0);

      if (offset > 0 && status === 416) {
        await discardBody(response);
        attemptLink.dispose();
        if (state.totalBytes > 0 && offset >= state.totalBytes) {
          break;
        }
        state.receivedBytes = 0;
        state.supportsRange = false;
        failures += 1;
        if (failures >= maxConsecutiveFailures) {
          throw new MirrorError(`${label} rejected the resume request (HTTP 416).`, {
            code: "http_error",
            status,
          });
        }
        continue;
      }

      if (!response.ok) {
        const bodyText = await readErrorBody(response);
        attemptLink.dispose();
        const info = { status, bodyText, url: request.url };
        const hostError =
          typeof interpretErrorResponse === "function"
            ? interpretErrorResponse(info)
            : null;
        if (hostError) {
          throw hostError;
        }
        const httpError = createHttpError(response, label);
        failures += 1;
        if (httpError.retryable && failures < maxConsecutiveFailures) {
          await waitBeforeRetry(httpError);
          continue;
        }
        throw httpError;
      }

      let startOffset = 0;
      if (offset > 0) {
        if (rangeMode === "mega-path") {
          startOffset = offset;
        } else if (status === 206) {
          const contentRange = parseContentRange(getHeader(response, "content-range"));
          if (contentRange && contentRange.start === offset) {
            startOffset = offset;
            if (contentRange.total > 0) {
              state.totalBytes = contentRange.total;
            }
          } else {
            await discardBody(response);
            attemptLink.dispose();
            state.receivedBytes = 0;
            state.supportsRange = false;
            failures += 1;
            if (failures >= maxConsecutiveFailures) {
              throw new MirrorError(`${label} returned an unexpected byte range.`, {
                code: "http_error",
              });
            }
            continue;
          }
        } else {
          state.supportsRange = false;
        }
      }

      if (startOffset === 0) {
        state.receivedBytes = 0;
        state.mimeType = getHeader(response, "content-type");
        state.finalUrl = response.url || request.url;
        const contentEncoding = getHeader(response, "content-encoding").toLowerCase();
        const isEncoded = Boolean(contentEncoding) && contentEncoding !== "identity";
        const contentLength =
          Number.parseInt(getHeader(response, "content-length") || "0", 10) || 0;
        if (!isEncoded && contentLength > 0) {
          state.totalBytes = expectedTotal > 0 ? expectedTotal : contentLength;
        } else {
          state.totalBytes = expectedTotal;
        }
        state.supportsRange =
          rangeMode === "mega-path" ||
          (rangeMode === "header" &&
            !isEncoded &&
            state.totalBytes > 0 &&
            !/none/i.test(getHeader(response, "accept-ranges")));

        if (!state.targetPath) {
          state.fileName =
            String(fileNameHint || "").trim() ||
            resolveDownloadFileName({
              contentDisposition: getHeader(response, "content-disposition"),
              finalUrl: state.finalUrl,
              requestedUrl: url,
            }) ||
            fallbackFileName;
          state.targetPath = resolveTargetPath(state.fileName);
          state.partPath = `${state.targetPath}.part`;
          await fs.promises.mkdir(path.dirname(state.targetPath), { recursive: true });
          if (typeof onTarget === "function") {
            onTarget({
              targetPath: state.targetPath,
              fileName: path.basename(state.targetPath),
              totalBytes: state.totalBytes,
              mimeType: state.mimeType,
            });
          }
        }

        if (state.totalBytes > 0) {
          try {
            await checkDiskSpace(path.dirname(state.targetPath), state.totalBytes);
          } catch (error) {
            await discardBody(response);
            attemptLink.dispose();
            throw error;
          }
        }
      }

      const attemptStartBytes = startOffset;
      try {
        await streamAttempt({
          response,
          partPath: state.partPath,
          append: startOffset > 0,
          transform:
            typeof createTransform === "function" ? createTransform(startOffset) : null,
          stallTimeoutMs,
          attemptLink,
          sniff: startOffset === 0,
          mimeType: state.mimeType,
          label,
          onBytes(streamedBytes) {
            state.receivedBytes = startOffset + streamedBytes;
            progress.report(state.receivedBytes, state.totalBytes);
          },
        });
      } catch (error) {
        attemptLink.dispose();
        throwIfCancelled();
        if (error?.code === "html_payload" || error?.code === "disk_full") {
          throw error;
        }
        state.receivedBytes = state.supportsRange ? await getFileSize(state.partPath) : 0;
        // Only bytes persisted for a resumable transfer count as progress;
        // otherwise a server that always drops mid-file would loop forever.
        const madeProgress = state.receivedBytes > attemptStartBytes;
        failures = madeProgress ? 1 : failures + 1;
        const retryable = isTransientError(error) || isAbortError(error);
        if (failures < maxConsecutiveFailures && retryable) {
          await waitBeforeRetry(error);
          continue;
        }
        throw toTransferError(error, label);
      }
      attemptLink.dispose();

      state.receivedBytes = await getFileSize(state.partPath);
      if (state.totalBytes > 0 && state.receivedBytes < state.totalBytes) {
        const madeProgress =
          state.supportsRange && state.receivedBytes > attemptStartBytes;
        failures = madeProgress ? 1 : failures + 1;
        if (!state.supportsRange) {
          state.receivedBytes = 0;
        }
        if (failures < maxConsecutiveFailures) {
          await waitBeforeRetry(
            new MirrorError("The connection closed before the file finished.", {
              code: "incomplete",
              retryable: true,
            }),
          );
          continue;
        }
        throw new MirrorError(
          `${label} kept closing the connection early (${formatBytes(state.receivedBytes)} of ${formatBytes(state.totalBytes)}). Retry later or pick another mirror.`,
          { code: "incomplete" },
        );
      }

      break;
    }

    progress.report(state.receivedBytes, state.totalBytes, true);
    await fs.promises.rename(state.partPath, state.targetPath);

    return {
      targetPath: state.targetPath,
      fileName: path.basename(state.targetPath),
      totalBytes: state.totalBytes || state.receivedBytes,
      receivedBytes: state.receivedBytes,
      mimeType: state.mimeType,
      finalUrl: state.finalUrl,
    };
  } catch (error) {
    if (state.partPath) {
      await fs.promises.unlink(state.partPath).catch(() => {});
    }
    if (signal?.aborted && !(error instanceof DownloadCancelledError)) {
      throw new DownloadCancelledError();
    }
    throw error;
  }
}

module.exports = {
  DIRECT_DOWNLOAD_USER_AGENT,
  buildTransferRequest,
  checkFreeDiskSpace,
  downloadToFile,
  formatBytes,
  parseContentDispositionFilename,
  parseContentRange,
  resolveDownloadFileName,
  selectTransferMode,
  shouldUseDirectSessionDownload,
  streamResponseBodyToFile,
};
