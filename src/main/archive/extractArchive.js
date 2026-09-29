// @ts-check

/**
 * Archive inspection and extraction for game packages.
 *
 * Every format goes through a chain of extractors, in order of preference:
 *
 *   zip           bundled 7-Zip → PowerShell ZipFile (Windows) → adm-zip
 *   7z/tar/gz/... bundled 7-Zip → 7-Zip installed on the computer
 *   rar           node-unrar-js (unrar in WebAssembly, in a worker thread)
 *                 → 7-Zip installed on the computer → WinRAR / unrar
 *
 * Each tool's output is mapped onto an ArchiveError code (see
 * archiveErrors.js), so a password prompt, a full disk or an incomplete
 * download reach the user as such instead of as raw tool output. Definitive
 * failures (wrong password, disk full, unsafe paths) stop the chain; other
 * failures move on to the next tool. Locked files (antivirus scanning a fresh
 * download) are retried with a short delay before the next tool is tried.
 */

const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const cp = require("child_process");
const AdmZip = require("adm-zip");
const sevenZipBin = require("7zip-bin");

const {
  ARCHIVE_ERROR_CODES,
  ArchiveError,
  DEFINITIVE_ARCHIVE_ERROR_CODES,
  RETRYABLE_ARCHIVE_ERROR_CODES,
  isArchiveError,
} = require("./archiveErrors");

/** adm-zip reads the whole archive into memory; keep it for small files. */
const ADM_ZIP_MAX_BYTES = 1024 * 1024 * 1024;
const LOCKED_FILE_RETRY_ATTEMPTS = 3;
const LOCKED_FILE_RETRY_DELAY_MS = 1500;

/**
 * @typedef {"zip" | "7z" | "rar" | "tar" | "gzip" | "bzip2" | "xz" | "zstd" | "cab" | ""} ArchiveFormat
 */

/**
 * @typedef {{
 *   name: string,
 *   size: number,
 *   directory: boolean,
 *   encrypted: boolean,
 * }} ArchiveEntry
 */

/**
 * @typedef {{
 *   format: ArchiveFormat,
 *   compound: boolean,
 *   entries: ArchiveEntry[],
 *   encrypted: boolean,
 *   headerEncrypted: boolean,
 *   multipart: { isMultipart: boolean, role: "first" | "other" | "", missingVolumes: string[] },
 *   tool: string,
 * }} ArchiveInspection
 */

/**
 * @typedef {{
 *   archivePath: string,
 *   destinationPath: string,
 *   password?: string,
 *   retryDelayMs?: number,
 *   toolCandidates?: string[],
 *   preferSystemTools?: boolean,
 * }} ExtractInput
 */

// ─── Entry-name safety ───────────────────────────────────────────────────

/**
 * @param {string} entryName
 */
function normalizeArchiveEntryName(entryName) {
  return String(entryName || "")
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/g, "")
    .replace(/^\/+/g, "")
    .trim();
}

/**
 * @param {string} entryName
 */
function isUnsafeArchiveEntryName(entryName) {
  const rawName = String(entryName || "").trim();
  const normalized = normalizeArchiveEntryName(entryName);

  if (!normalized) {
    return false;
  }

  if (normalized.includes("\0")) {
    return true;
  }

  if (/^[\\/]+/.test(rawName)) {
    return true;
  }

  if (/^[A-Za-z]:/.test(normalized)) {
    return true;
  }

  if (normalized.startsWith("../") || normalized === "..") {
    return true;
  }

  if (normalized.split("/").includes("..")) {
    return true;
  }

  return path.posix.isAbsolute(normalized);
}

/**
 * @param {string[]} entryNames
 */
function validateArchiveEntries(entryNames) {
  const invalidEntries = entryNames
    .map((entryName) => normalizeArchiveEntryName(entryName))
    .filter((entryName) => entryName && isUnsafeArchiveEntryName(entryName));

  return {
    valid: invalidEntries.length === 0,
    invalidEntries,
  };
}

// ─── Format detection ────────────────────────────────────────────────────

/**
 * @param {Buffer} buffer
 * @param {number[]} signature
 * @param {number=} offset
 */
function bufferStartsWith(buffer, signature, offset = 0) {
  if (!Buffer.isBuffer(buffer) || buffer.length < offset + signature.length) {
    return false;
  }
  return signature.every((value, index) => buffer[offset + index] === value);
}

/**
 * @param {Buffer} header
 * @returns {ArchiveFormat}
 */
function detectArchiveFormatFromBuffer(header) {
  if (
    bufferStartsWith(header, [0x50, 0x4b, 0x03, 0x04]) ||
    bufferStartsWith(header, [0x50, 0x4b, 0x05, 0x06]) ||
    bufferStartsWith(header, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return "zip";
  }
  if (bufferStartsWith(header, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return "7z";
  }
  if (bufferStartsWith(header, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) {
    return "rar";
  }
  if (bufferStartsWith(header, [0x1f, 0x8b, 0x08])) {
    return "gzip";
  }
  if (bufferStartsWith(header, [0x42, 0x5a, 0x68])) {
    return "bzip2";
  }
  if (bufferStartsWith(header, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) {
    return "xz";
  }
  if (bufferStartsWith(header, [0x28, 0xb5, 0x2f, 0xfd])) {
    return "zstd";
  }
  if (bufferStartsWith(header, [0x4d, 0x53, 0x43, 0x46])) {
    return "cab";
  }
  if (bufferStartsWith(header, [0x75, 0x73, 0x74, 0x61, 0x72], 257)) {
    return "tar";
  }
  return "";
}

/**
 * @param {string} archivePath
 * @returns {ArchiveFormat}
 */
function detectArchiveFormatFromName(archivePath) {
  const lower = String(archivePath || "").toLowerCase();
  if (/\.(tar\.gz|tgz|tar\.bz2|tbz2?|tar\.xz|txz|tar\.zst)$/.test(lower)) {
    return lower.endsWith("gz")
      ? "gzip"
      : lower.endsWith("zst")
        ? "zstd"
        : /bz2?$/.test(lower)
          ? "bzip2"
          : "xz";
  }
  const extension = path.extname(lower).replace(/^\./, "");
  switch (extension) {
    case "zip":
    case "jar":
    case "apk":
    case "z01":
      return "zip";
    case "7z":
      return "7z";
    case "rar":
    case "r00":
    case "r01":
      return "rar";
    case "tar":
      return "tar";
    case "gz":
      return "gzip";
    case "bz2":
      return "bzip2";
    case "xz":
      return "xz";
    case "zst":
      return "zstd";
    case "cab":
      return "cab";
    case "001": {
      const inner = path.extname(path.basename(lower, ".001")).replace(/^\./, "");
      return inner === "7z" ? "7z" : inner === "zip" ? "zip" : inner === "rar" ? "rar" : "";
    }
    default:
      return "";
  }
}

/**
 * @param {string} archivePath
 * @param {number=} bytesToRead
 */
async function readFileHeader(archivePath, bytesToRead = 512) {
  let handle;
  try {
    handle = await fsp.open(archivePath, "r");
  } catch (error) {
    throw mapFsError(error, "open", archivePath);
  }
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Resolves the archive format from magic bytes first, file name second.
 * Compound archives (tar.gz and friends) report the outer compression and
 * `compound: true`.
 * @param {string} archivePath
 * @returns {Promise<{ format: ArchiveFormat, compound: boolean }>}
 */
async function detectArchiveFormat(archivePath) {
  const header = await readFileHeader(archivePath);
  const byMagic = detectArchiveFormatFromBuffer(header);
  const byName = detectArchiveFormatFromName(archivePath);
  const format = byMagic || byName;
  const lower = String(archivePath || "").toLowerCase();
  const compound =
    ["gzip", "bzip2", "xz", "zstd"].includes(format) &&
    (/\.(tgz|tbz2?|txz)$/.test(lower) ||
      /\.tar\.(gz|bz2|xz|zst)$/.test(lower) ||
      // A plain .gz that is really a tarball: the name gives no hint, but
      // 7-Zip lists the inner entry as *.tar and the second pass handles it.
      false);
  return { format, compound };
}

// ─── Multi-part archives ─────────────────────────────────────────────────

/**
 * Recognises split archive names and reports which sibling parts are
 * missing next to the file. Only the numbered schemes are checked; RAR
 * `.r00` chains are reported as multi-part without a completeness check.
 * @param {string} archivePath
 * @param {{ existsSync?: typeof fs.existsSync, readdirSync?: typeof fs.readdirSync }=} options
 * @returns {{ isMultipart: boolean, role: "first" | "other" | "", missingVolumes: string[] }}
 */
function inspectArchiveVolumes(archivePath, options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  const readdirSync = options.readdirSync || fs.readdirSync;
  const directory = path.dirname(archivePath);
  const fileName = path.basename(archivePath);
  const lower = fileName.toLowerCase();

  /** @type {string[]} */
  let siblings = [];
  try {
    siblings = readdirSync(directory).map((entry) => String(entry));
  } catch {
    siblings = [];
  }
  const siblingsLower = new Set(siblings.map((entry) => entry.toLowerCase()));
  const has = (name) =>
    siblingsLower.has(name.toLowerCase()) || existsSync(path.join(directory, name));

  // name.part1.rar / name.part01.rar
  const rarPart = lower.match(/^(.*)\.part(\d+)\.rar$/);
  if (rarPart) {
    const stem = fileName.slice(0, rarPart[1].length);
    const digits = rarPart[2].length;
    const index = Number.parseInt(rarPart[2], 10);
    const missing = [];
    const siblingsInSet = siblings.filter((entry) =>
      new RegExp(`^${escapeRegExp(stem)}\\.part\\d+\\.rar$`, "i").test(entry),
    );
    const highest = siblingsInSet.reduce((max, entry) => {
      const match = entry.match(/\.part(\d+)\.rar$/i);
      return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
    }, index);
    for (let part = 1; part <= highest; part += 1) {
      const candidate = `${stem}.part${String(part).padStart(digits, "0")}.rar`;
      if (!has(candidate)) {
        missing.push(candidate);
      }
    }
    return { isMultipart: true, role: index === 1 ? "first" : "other", missingVolumes: missing };
  }

  // name.7z.001 / name.zip.001 / name.001
  const numbered = lower.match(/^(.*)\.(\d{3})$/);
  if (numbered) {
    const stem = fileName.slice(0, numbered[1].length);
    const index = Number.parseInt(numbered[2], 10);
    const siblingsInSet = siblings.filter((entry) =>
      new RegExp(`^${escapeRegExp(stem)}\\.\\d{3}$`, "i").test(entry),
    );
    const highest = siblingsInSet.reduce((max, entry) => {
      const match = entry.match(/\.(\d{3})$/);
      return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
    }, index);
    const missing = [];
    for (let part = 1; part <= highest; part += 1) {
      const candidate = `${stem}.${String(part).padStart(3, "0")}`;
      if (!has(candidate)) {
        missing.push(candidate);
      }
    }
    return { isMultipart: true, role: index === 1 ? "first" : "other", missingVolumes: missing };
  }

  // name.zip with name.z01 next to it (split zip) → zip is the last volume.
  if (lower.endsWith(".zip")) {
    const stem = fileName.slice(0, -4);
    if (has(`${stem}.z01`)) {
      return { isMultipart: true, role: "first", missingVolumes: [] };
    }
    return { isMultipart: false, role: "", missingVolumes: [] };
  }
  if (/\.z\d{2}$/.test(lower)) {
    return { isMultipart: true, role: "other", missingVolumes: [] };
  }

  // old RAR volumes: name.rar + name.r00, name.r01 ...
  if (lower.endsWith(".rar")) {
    const stem = fileName.slice(0, -4);
    if (has(`${stem}.r00`)) {
      return { isMultipart: true, role: "first", missingVolumes: [] };
    }
    return { isMultipart: false, role: "", missingVolumes: [] };
  }
  if (/\.r\d{2}$/.test(lower)) {
    return { isMultipart: true, role: "other", missingVolumes: [] };
  }

  return { isMultipart: false, role: "", missingVolumes: [] };
}

/**
 * @param {string} value
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Error mapping ───────────────────────────────────────────────────────

/**
 * @param {unknown} error
 * @param {string} tool
 * @param {string=} subject
 * @returns {ArchiveError}
 */
function mapFsError(error, tool, subject = "") {
  if (isArchiveError(error)) {
    return error;
  }
  const anyError = /** @type {any} */ (error);
  const code = String(anyError?.code || "");
  const message = anyError?.message ? String(anyError.message) : String(error);
  const suffix = subject ? ` (${path.basename(subject)})` : "";
  switch (code) {
    case "ENOSPC":
      return new ArchiveError(`Not enough disk space while unpacking${suffix}.`, {
        code: ARCHIVE_ERROR_CODES.DISK_FULL,
        tool,
        detail: message,
        cause: error,
      });
    case "ENAMETOOLONG":
      return new ArchiveError(`A file path is too long${suffix}.`, {
        code: ARCHIVE_ERROR_CODES.PATH_TOO_LONG,
        tool,
        detail: message,
        cause: error,
      });
    case "EBUSY":
    case "EPERM":
    case "EACCES":
    case "ETXTBSY":
      return new ArchiveError(`A file is locked or access was denied${suffix}.`, {
        code: ARCHIVE_ERROR_CODES.FILE_LOCKED,
        tool,
        detail: message,
        cause: error,
      });
    case "ENOENT":
      return new ArchiveError(`The archive was not found${suffix}.`, {
        code: ARCHIVE_ERROR_CODES.ARCHIVE_NOT_FOUND,
        tool,
        detail: message,
        cause: error,
      });
    default:
      return new ArchiveError(message || `Extraction failed${suffix}.`, {
        code: ARCHIVE_ERROR_CODES.EXTRACT_FAILED,
        tool,
        detail: message,
        cause: error,
      });
  }
}

/**
 * Maps 7-Zip / unrar console output onto an error code.
 * @param {string} output
 * @param {{ password?: string, tool: string, exitCode?: number | null }} context
 * @returns {ArchiveError}
 */
function classifyToolOutput(output, context) {
  const text = String(output || "");
  const detail = text.trim().split(/\r?\n/).filter(Boolean).slice(-6).join("\n");
  const make = (message, code) =>
    new ArchiveError(message, { code, tool: context.tool, detail });

  if (/wrong password|can not open encrypted archive|password is incorrect|incorrect password|bad password|checksum error in the encrypted file/i.test(text)) {
    return context.password
      ? make("The password did not open the archive.", ARCHIVE_ERROR_CODES.WRONG_PASSWORD)
      : make("The archive is password-protected.", ARCHIVE_ERROR_CODES.ENCRYPTED);
  }
  if (/enter password|password required|encrypted file:? .* is skipped|no password/i.test(text)) {
    return make("The archive is password-protected.", ARCHIVE_ERROR_CODES.ENCRYPTED);
  }
  if (/missing volume|cannot find volume|next volume|volume .* not found/i.test(text)) {
    return make("A part of the multi-part archive is missing.", ARCHIVE_ERROR_CODES.MISSING_VOLUME);
  }
  if (/unexpected end of (archive|data)|unexpected end|premature end|truncated/i.test(text)) {
    return make("The archive ends early; the download is probably incomplete.", ARCHIVE_ERROR_CODES.INCOMPLETE);
  }
  if (/no space left|not enough space|disk full|there is not enough space|espace disque/i.test(text)) {
    return make("Not enough disk space while unpacking.", ARCHIVE_ERROR_CODES.DISK_FULL);
  }
  if (/path too long|name too long|filename or extension is too long|too long/i.test(text)) {
    return make("A file path is too long for the install folder.", ARCHIVE_ERROR_CODES.PATH_TOO_LONG);
  }
  if (/access is denied|permission denied|being used by another process|sharing violation|cannot open output file/i.test(text)) {
    return make("A file is locked or access was denied.", ARCHIVE_ERROR_CODES.FILE_LOCKED);
  }
  if (/data error|crc failed|crc error|headers? error|is not archive|not a valid archive|can not open the file as archive|unknown archive format|corrupt|damaged|checksum error|no end header found|invalid or unsupported zip format|invalid (?:local|central) header/i.test(text)) {
    return make("The archive is damaged or incomplete.", ARCHIVE_ERROR_CODES.CORRUPT);
  }
  if (/unsupported method|unsupported compression/i.test(text)) {
    return make("The archive uses a compression method this archiver does not support.", ARCHIVE_ERROR_CODES.UNSUPPORTED_FORMAT);
  }
  return make(
    detail
      ? `${context.tool} failed (exit ${context.exitCode ?? "unknown"}): ${detail}`
      : `${context.tool} failed with exit code ${context.exitCode ?? "unknown"}.`,
    ARCHIVE_ERROR_CODES.EXTRACT_FAILED,
  );
}

// ─── Process helpers ─────────────────────────────────────────────────────

/**
 * @param {string} binaryPath
 * @param {string[]} args
 * @param {{ tool: string, password?: string, env?: Record<string, string> }} context
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function runTool(binaryPath, args, context) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = cp.spawn(binaryPath, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...(context.env || {}) },
      });
    } catch (error) {
      reject(
        new ArchiveError(`${context.tool} could not be started.`, {
          code: ARCHIVE_ERROR_CODES.TOOL_MISSING,
          tool: context.tool,
          detail: error instanceof Error ? error.message : String(error),
          cause: error,
        }),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      const anyError = /** @type {any} */ (error);
      reject(
        new ArchiveError(`${context.tool} could not be started.`, {
          code: ARCHIVE_ERROR_CODES.TOOL_MISSING,
          tool: context.tool,
          detail: anyError?.message ? String(anyError.message) : String(error),
          cause: error,
        }),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        classifyToolOutput(`${stderr}\n${stdout}`, {
          tool: context.tool,
          password: context.password,
          exitCode: code,
        }),
      );
    });
  });
}

/**
 * @param {string} script
 * @param {Record<string, string>} envOverrides
 */
async function runPowerShell(script, envOverrides) {
  const { stdout } = await runTool(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { tool: "PowerShell", env: envOverrides },
  );
  return stdout.trim();
}

/**
 * Locates archivers installed on the computer, best first. Only used when
 * the bundled tools cannot open a file (RAR volumes, exotic formats).
 * @param {{ toolCandidates?: string[] }=} options
 * @returns {Array<{ kind: "7z" | "unrar" | "winrar", path: string }>}
 */
function findSystemArchivers(options = {}) {
  /** @type {Array<{ kind: "7z" | "unrar" | "winrar", path: string }>} */
  const found = [];
  const candidates = Array.isArray(options.toolCandidates)
    ? options.toolCandidates
    : defaultSystemArchiverCandidates();

  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) {
      continue;
    }
    const base = path.basename(candidate).toLowerCase();
    if (/^7zz?(\.exe)?$/.test(base) || base === "7z.exe" || base === "7zg.exe") {
      found.push({ kind: "7z", path: candidate });
    } else if (base.startsWith("unrar")) {
      found.push({ kind: "unrar", path: candidate });
    } else if (base.startsWith("winrar") || base === "rar.exe") {
      found.push({ kind: "winrar", path: candidate });
    }
  }
  return found;
}

function defaultSystemArchiverCandidates() {
  /** @type {string[]} */
  const candidates = [];
  if (process.platform === "win32") {
    const roots = [
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.ProgramW6432,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs") : "",
    ].filter(Boolean);
    for (const root of roots) {
      candidates.push(path.join(String(root), "7-Zip", "7z.exe"));
      candidates.push(path.join(String(root), "WinRAR", "UnRAR.exe"));
      candidates.push(path.join(String(root), "WinRAR", "WinRAR.exe"));
    }
    return candidates;
  }
  const pathEntries = String(process.env.PATH || "").split(path.delimiter);
  for (const entry of pathEntries) {
    if (!entry) {
      continue;
    }
    candidates.push(path.join(entry, "7zz"));
    candidates.push(path.join(entry, "7z"));
    candidates.push(path.join(entry, "unrar"));
  }
  return candidates;
}

// ─── 7-Zip (bundled and system) ──────────────────────────────────────────

function getBundled7zPath() {
  const binaryPath = sevenZipBin.path7za;
  if (!binaryPath || !fs.existsSync(binaryPath)) {
    return "";
  }
  return binaryPath;
}

/**
 * @param {string} binaryPath
 * @param {string} tool
 * @param {string} archivePath
 * @param {string=} password
 * @returns {Promise<ArchiveEntry[]>}
 */
async function listWith7z(binaryPath, tool, archivePath, password) {
  const args = ["l", "-slt", "-ba"];
  if (password) {
    args.push(`-p${password}`);
  }
  args.push("--", archivePath);
  const { stdout } = await runTool(binaryPath, args, { tool, password });
  return parse7zListing(stdout);
}

/**
 * @param {string} stdout
 * @returns {ArchiveEntry[]}
 */
function parse7zListing(stdout) {
  /** @type {ArchiveEntry[]} */
  const entries = [];
  /** @type {Record<string, string>} */
  let current = {};
  const flush = () => {
    if (current.Path) {
      entries.push({
        name: current.Path.replace(/\\/g, "/"),
        size: Number.parseInt(current.Size || "0", 10) || 0,
        directory:
          /^D/.test(current.Attributes || "") || (current.Folder || "") === "+",
        encrypted: (current.Encrypted || "") === "+",
      });
    }
    current = {};
  };
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const separator = line.indexOf(" = ");
    if (separator < 0) {
      continue;
    }
    current[line.slice(0, separator).trim()] = line.slice(separator + 3).trim();
  }
  flush();
  return entries;
}

/**
 * @param {string} binaryPath
 * @param {string} tool
 * @param {string} archivePath
 * @param {string} destinationPath
 * @param {string=} password
 */
async function extractWith7z(binaryPath, tool, archivePath, destinationPath, password) {
  const args = ["x", "-y", "-aoa", "-bd", `-o${destinationPath}`];
  if (password) {
    args.push(`-p${password}`);
  }
  args.push("--", archivePath);
  await runTool(binaryPath, args, { tool, password });
}

// ─── PowerShell and adm-zip (zip fallbacks) ──────────────────────────────

/**
 * @param {string} archivePath
 * @returns {Promise<ArchiveEntry[]>}
 */
async function listZipWithPowerShell(archivePath) {
  const script = `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($env:ATLAS_ARCHIVE_PATH)
    try {
      @($zip.Entries | ForEach-Object { @{ n = $_.FullName; s = $_.Length } }) | ConvertTo-Json -Compress
    } finally {
      $zip.Dispose()
    }
  `;
  const stdout = await runPowerShell(script, { ATLAS_ARCHIVE_PATH: archivePath });
  if (!stdout) {
    return [];
  }
  const parsed = JSON.parse(stdout);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((row) => row && typeof row.n === "string")
    .map((row) => ({
      name: row.n.replace(/\\/g, "/"),
      size: Number(row.s) || 0,
      directory: /\/$/.test(row.n) || String(row.n).endsWith("\\"),
      encrypted: false,
    }));
}

/**
 * @param {string} archivePath
 * @param {string} destinationPath
 */
async function extractZipWithPowerShell(archivePath, destinationPath) {
  const script = `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $destinationPath = $env:ATLAS_DESTINATION_PATH
    $zip = [System.IO.Compression.ZipFile]::OpenRead($env:ATLAS_ARCHIVE_PATH)
    try {
      foreach ($entry in $zip.Entries) {
        if ([string]::IsNullOrWhiteSpace($entry.FullName)) { continue }
        $targetPath = Join-Path $destinationPath $entry.FullName
        if ([string]::IsNullOrEmpty($entry.Name)) {
          [System.IO.Directory]::CreateDirectory($targetPath) | Out-Null
          continue
        }
        [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($targetPath)) | Out-Null
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true)
      }
    } finally {
      $zip.Dispose()
    }
  `;
  await runPowerShell(script, {
    ATLAS_ARCHIVE_PATH: archivePath,
    ATLAS_DESTINATION_PATH: destinationPath,
  });
}

/**
 * @param {string} archivePath
 * @returns {ArchiveEntry[]}
 */
function listZipWithAdmZip(archivePath) {
  try {
    const archive = new AdmZip(archivePath);
    return archive.getEntries().map((entry) => ({
      name: entry.entryName.replace(/\\/g, "/"),
      size: Number(entry.header?.size) || 0,
      directory: Boolean(entry.isDirectory),
      encrypted: Boolean(entry.header?.encripted || entry.header?.encrypted),
    }));
  } catch (error) {
    throw classifyToolOutput(error instanceof Error ? error.message : String(error), {
      tool: "adm-zip",
    });
  }
}

/**
 * @param {string} archivePath
 * @param {string} destinationPath
 */
function extractZipWithAdmZip(archivePath, destinationPath) {
  try {
    const archive = new AdmZip(archivePath);
    archive.extractAllTo(destinationPath, true);
  } catch (error) {
    const anyError = /** @type {any} */ (error);
    if (anyError?.code) {
      throw mapFsError(error, "adm-zip");
    }
    throw classifyToolOutput(anyError?.message ? String(anyError.message) : String(error), {
      tool: "adm-zip",
    });
  }
}

// ─── RAR through node-unrar-js ───────────────────────────────────────────

/**
 * Runs a RAR task in a worker thread; falls back to the main thread when the
 * worker cannot be started (packaging quirks), so RAR support never depends
 * on it.
 * @param {import("./rarTask").RarTask} task
 * @returns {Promise<import("./rarTask").RarTaskResult>}
 */
function runRarTaskInWorker(task) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    let worker;
    try {
      const { Worker } = require("worker_threads");
      worker = new Worker(path.join(__dirname, "rarWorker.js"), { workerData: task });
    } catch {
      finish(require("./rarTask").runRarTask(task));
      return;
    }
    worker.once("message", (message) => finish(message));
    worker.once("error", () => {
      finish(require("./rarTask").runRarTask(task));
    });
    worker.once("exit", (code) => {
      if (!settled) {
        finish(
          code === 0
            ? require("./rarTask").runRarTask(task)
            : { ok: false, error: { message: `RAR worker exited with code ${code}.` } },
        );
      }
    });
  });
}

/**
 * @param {{ message: string, reason?: string, file?: string, code?: string }} error
 * @param {{ password?: string, encryptedEntries?: boolean }} context
 * @returns {ArchiveError}
 */
function mapUnrarError(error, context) {
  const tool = "unrar";
  const detail = error.message || "";
  const make = (message, code) =>
    new ArchiveError(message, { code, tool, detail, entry: error.file || "" });
  if (error.code) {
    return mapFsError({ code: error.code, message: error.message }, tool, error.file);
  }
  switch (error.reason) {
    case "ERAR_MISSING_PASSWORD":
      return make("The archive is password-protected.", ARCHIVE_ERROR_CODES.ENCRYPTED);
    case "ERAR_BAD_PASSWORD":
      return make("The password did not open the archive.", ARCHIVE_ERROR_CODES.WRONG_PASSWORD);
    case "ERAR_BAD_DATA":
      // unrar cannot tell a wrong password from damaged data: encrypted
      // headers fail to parse and RAR4 entries fail their CRC check. With a
      // password supplied, the password is by far the likelier cause.
      if (context.password) {
        return make(
          "The password did not open the archive (or the archive is damaged).",
          ARCHIVE_ERROR_CODES.WRONG_PASSWORD,
        );
      }
      return make("The archive is damaged or incomplete.", ARCHIVE_ERROR_CODES.CORRUPT);
    case "ERAR_BAD_ARCHIVE":
    case "ERAR_UNKNOWN_FORMAT":
      return make("The file is not a valid RAR archive.", ARCHIVE_ERROR_CODES.CORRUPT);
    case "ERAR_EREAD":
      return make("The archive could not be read completely.", ARCHIVE_ERROR_CODES.INCOMPLETE);
    case "ERAR_ECREATE":
    case "ERAR_EWRITE":
      return make("A file could not be written while unpacking.", ARCHIVE_ERROR_CODES.EXTRACT_FAILED);
    case "ERAR_NO_MEMORY":
      return make("Not enough memory to unpack the archive.", ARCHIVE_ERROR_CODES.EXTRACT_FAILED);
    default:
      if (/no space|ENOSPC/i.test(detail)) {
        return make("Not enough disk space while unpacking.", ARCHIVE_ERROR_CODES.DISK_FULL);
      }
      return make(detail || "RAR extraction failed.", ARCHIVE_ERROR_CODES.EXTRACT_FAILED);
  }
}

/**
 * @param {string} archivePath
 * @param {string=} password
 */
async function listRarWithUnrarJs(archivePath, password) {
  const result = await runRarTaskInWorker({ mode: "list", archivePath, password });
  if (result.ok !== true) {
    throw mapUnrarError(result.error, { password });
  }
  return result;
}

/**
 * @param {string} archivePath
 * @param {string} destinationPath
 * @param {string=} password
 */
async function extractRarWithUnrarJs(archivePath, destinationPath, password) {
  const listing = await listRarWithUnrarJs(archivePath, password);
  if (listing.volume) {
    throw new ArchiveError("Multi-part RAR archives need an external archiver.", {
      code: ARCHIVE_ERROR_CODES.MULTIPART_UNSUPPORTED,
      tool: "unrar",
    });
  }
  const encryptedEntries = listing.entries.some((entry) => entry.encrypted);
  if (encryptedEntries && !password) {
    throw new ArchiveError("The archive is password-protected.", {
      code: ARCHIVE_ERROR_CODES.ENCRYPTED,
      tool: "unrar",
    });
  }
  const result = await runRarTaskInWorker({
    mode: "extract",
    archivePath,
    destinationPath,
    password,
  });
  if (result.ok !== true) {
    throw mapUnrarError(result.error, { password, encryptedEntries });
  }
  return result.extracted;
}

/**
 * @param {string} binaryPath
 * @param {"unrar" | "winrar"} kind
 * @param {string} archivePath
 * @param {string} destinationPath
 * @param {string=} password
 */
async function extractRarWithSystemUnrar(binaryPath, kind, archivePath, destinationPath, password) {
  const args = ["x", "-y", "-o+", "-idq"];
  args.push(password ? `-p${password}` : "-p-");
  args.push(archivePath, `${destinationPath}${path.sep}`);
  await runTool(binaryPath, args, { tool: kind === "winrar" ? "WinRAR" : "unrar", password });
}

// ─── Extractor chains ────────────────────────────────────────────────────

/**
 * @typedef {{
 *   tool: string,
 *   list: (() => Promise<ArchiveEntry[]>) | null,
 *   extract: () => Promise<void>,
 * }} ExtractorStep
 */

/**
 * @param {ArchiveFormat} format
 * @param {ExtractInput} input
 * @param {{ archiveSize: number }} facts
 * @returns {ExtractorStep[]}
 */
function buildExtractorChain(format, input, facts) {
  const { archivePath, destinationPath, password } = input;
  /** @type {ExtractorStep[]} */
  const steps = [];
  const bundled = getBundled7zPath();
  const systemTools = findSystemArchivers(input);
  const system7z = systemTools.find((tool) => tool.kind === "7z");
  const systemUnrar = systemTools.find((tool) => tool.kind === "unrar");
  const systemWinRar = systemTools.find((tool) => tool.kind === "winrar");

  const bundledStep = bundled
    ? {
        tool: "7-Zip",
        list: () => listWith7z(bundled, "7-Zip", archivePath, password),
        extract: () => extractWith7z(bundled, "7-Zip", archivePath, destinationPath, password),
      }
    : null;
  const system7zStep = system7z
    ? {
        tool: "7-Zip (system)",
        list: () => listWith7z(system7z.path, "7-Zip (system)", archivePath, password),
        extract: () =>
          extractWith7z(system7z.path, "7-Zip (system)", archivePath, destinationPath, password),
      }
    : null;

  if (format === "rar") {
    if (input.preferSystemTools && system7zStep) {
      steps.push(system7zStep);
    }
    steps.push({
      tool: "unrar",
      list: async () => (await listRarWithUnrarJs(archivePath, password)).entries,
      extract: async () => {
        await extractRarWithUnrarJs(archivePath, destinationPath, password);
      },
    });
    if (system7zStep && !input.preferSystemTools) {
      steps.push(system7zStep);
    }
    for (const tool of [systemUnrar, systemWinRar]) {
      if (tool) {
        steps.push({
          tool: tool.kind === "winrar" ? "WinRAR" : "unrar (system)",
          list: null,
          extract: () =>
            extractRarWithSystemUnrar(
              tool.path,
              /** @type {"unrar" | "winrar"} */ (tool.kind),
              archivePath,
              destinationPath,
              password,
            ),
        });
      }
    }
    return steps;
  }

  if (bundledStep) {
    steps.push(bundledStep);
  }
  if (format === "zip") {
    if (process.platform === "win32" && !password) {
      steps.push({
        tool: "PowerShell",
        list: () => listZipWithPowerShell(archivePath),
        extract: () => extractZipWithPowerShell(archivePath, destinationPath),
      });
    }
    if (!password && facts.archiveSize <= ADM_ZIP_MAX_BYTES) {
      steps.push({
        tool: "adm-zip",
        list: async () => listZipWithAdmZip(archivePath),
        extract: async () => extractZipWithAdmZip(archivePath, destinationPath),
      });
    }
  }
  if (system7zStep) {
    steps.push(system7zStep);
  }
  return steps;
}

/**
 * @param {ArchiveFormat} format
 */
function formatSupported(format) {
  return ["zip", "7z", "rar", "tar", "gzip", "bzip2", "xz", "zstd", "cab"].includes(format);
}

/**
 * @param {ExtractorStep[]} steps
 * @param {"list" | "extract"} phase
 * @param {ExtractInput} input
 * @returns {Promise<any>}
 */
async function runChain(steps, phase, input) {
  /** @type {ArchiveError | null} */
  let lastError = null;
  /** @type {ArchiveError | null} */
  let bestError = null;
  const usable = steps.filter((step) => (phase === "list" ? step.list : step.extract));
  if (usable.length === 0) {
    throw new ArchiveError("No archiver is available for this file.", {
      code: ARCHIVE_ERROR_CODES.TOOL_MISSING,
    });
  }
  for (const step of usable) {
    const run = phase === "list" ? step.list : step.extract;
    const retryDelay =
      typeof input.retryDelayMs === "number" ? input.retryDelayMs : LOCKED_FILE_RETRY_DELAY_MS;
    for (let attempt = 1; attempt <= LOCKED_FILE_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const result = await /** @type {any} */ (run)();
        return { result, tool: step.tool };
      } catch (error) {
        const archiveError = isArchiveError(error) ? error : mapFsError(error, step.tool);
        lastError = archiveError;
        if (!bestError || isMoreSpecificArchiveError(archiveError, bestError)) {
          bestError = archiveError;
        }
        if (
          RETRYABLE_ARCHIVE_ERROR_CODES.has(archiveError.code) &&
          attempt < LOCKED_FILE_RETRY_ATTEMPTS
        ) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }
        break;
      }
    }
    if (lastError && DEFINITIVE_ARCHIVE_ERROR_CODES.has(lastError.code)) {
      throw lastError;
    }
  }
  // Prefer the most specific diagnosis over the last tool's generic failure.
  throw bestError || lastError || new ArchiveError("Extraction failed.");
}

/** @type {Set<string>} */
const GENERIC_ARCHIVE_ERROR_CODES = new Set([
  ARCHIVE_ERROR_CODES.EXTRACT_FAILED,
  ARCHIVE_ERROR_CODES.TOOL_MISSING,
]);

/**
 * @param {ArchiveError} candidate
 * @param {ArchiveError} current
 */
function isMoreSpecificArchiveError(candidate, current) {
  const candidateGeneric = GENERIC_ARCHIVE_ERROR_CODES.has(candidate.code);
  const currentGeneric = GENERIC_ARCHIVE_ERROR_CODES.has(current.code);
  if (candidateGeneric !== currentGeneric) {
    return !candidateGeneric;
  }
  return false;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Lists an archive and reports encryption and multi-part facts without
 * extracting anything.
 * @param {string} archivePath
 * @param {{ password?: string, toolCandidates?: string[], preferSystemTools?: boolean }=} options
 * @returns {Promise<ArchiveInspection>}
 */
async function inspectArchive(archivePath, options = {}) {
  let stats;
  try {
    stats = await fsp.stat(archivePath);
  } catch (error) {
    throw mapFsError(error, "inspect", archivePath);
  }
  const { format, compound } = await detectArchiveFormat(archivePath);
  if (!formatSupported(format)) {
    throw new ArchiveError("Unsupported archive format", {
      code: ARCHIVE_ERROR_CODES.UNSUPPORTED_FORMAT,
    });
  }
  const multipart = inspectArchiveVolumes(archivePath);
  if (multipart.missingVolumes.length > 0) {
    throw new ArchiveError(
      `Missing archive parts: ${multipart.missingVolumes.join(", ")}`,
      { code: ARCHIVE_ERROR_CODES.MISSING_VOLUME },
    );
  }
  const input = {
    archivePath,
    destinationPath: "",
    password: options.password,
    toolCandidates: options.toolCandidates,
    preferSystemTools: options.preferSystemTools,
  };
  const steps = buildExtractorChain(format, input, { archiveSize: stats.size });
  const { result, tool } = await runChain(steps, "list", input);
  /** @type {ArchiveEntry[]} */
  const entries = result;
  return {
    format,
    compound,
    entries,
    encrypted: entries.some((entry) => entry.encrypted),
    headerEncrypted: false,
    multipart,
    tool,
  };
}

/**
 * Backwards-compatible listing that returns entry names only.
 * @param {string} archivePath
 * @param {{ password?: string }=} options
 * @returns {Promise<string[]>}
 */
async function listArchiveEntries(archivePath, options = {}) {
  const inspection = await inspectArchive(archivePath, options);
  return inspection.entries.map((entry) => entry.name).filter(Boolean);
}

/**
 * Extracts an archive into `destinationPath` after validating entry names.
 * Throws an ArchiveError with a code that describes what went wrong.
 * @param {ExtractInput} input
 * @returns {Promise<{ success: true, extractedEntries: number, format: ArchiveFormat, tool: string, encrypted: boolean }>}
 */
async function extractArchiveSafely(input) {
  const archivePath = String(input?.archivePath || "");
  const destinationPath = String(input?.destinationPath || "");
  if (!archivePath || !destinationPath) {
    throw new ArchiveError("Archive path and destination path are required.");
  }

  const inspection = await inspectArchive(archivePath, input);
  const validation = validateArchiveEntries(inspection.entries.map((entry) => entry.name));
  if (!validation.valid) {
    throw new ArchiveError(
      `Archive contains unsafe paths: ${validation.invalidEntries.join(", ")}`,
      { code: ARCHIVE_ERROR_CODES.UNSAFE_PATHS },
    );
  }
  if (inspection.encrypted && !input.password) {
    throw new ArchiveError("The archive is password-protected.", {
      code: ARCHIVE_ERROR_CODES.ENCRYPTED,
      tool: inspection.tool,
    });
  }

  try {
    await fsp.mkdir(destinationPath, { recursive: true });
  } catch (error) {
    throw mapFsError(error, "mkdir", destinationPath);
  }

  const stats = await fsp.stat(archivePath);
  const stageDestination = inspection.compound
    ? path.join(destinationPath, ".__f95_tar_stage")
    : destinationPath;
  const steps = buildExtractorChain(
    inspection.format,
    { ...input, archivePath, destinationPath: stageDestination },
    { archiveSize: stats.size },
  );
  const { tool } = await runChain(steps, "extract", input);
  let extractedEntries = inspection.entries.filter((entry) => !entry.directory).length;

  if (inspection.compound) {
    // Second pass: the outer layer produced a tarball, unpack it in place.
    extractedEntries = await unpackInnerTarball(stageDestination, destinationPath, input);
  }

  return {
    success: true,
    extractedEntries,
    format: inspection.format,
    tool,
    encrypted: inspection.encrypted,
  };
}

/**
 * @param {string} stageDestination
 * @param {string} destinationPath
 * @param {ExtractInput} input
 */
async function unpackInnerTarball(stageDestination, destinationPath, input) {
  const files = await fsp.readdir(stageDestination).catch(() => []);
  const tarName = files.find((name) => /\.tar$/i.test(name)) || files[0];
  if (!tarName) {
    await fsp.rm(stageDestination, { recursive: true, force: true }).catch(() => {});
    throw new ArchiveError("The compressed file did not contain a tar archive.", {
      code: ARCHIVE_ERROR_CODES.CORRUPT,
    });
  }
  const tarPath = path.join(stageDestination, tarName);
  try {
    const inner = await extractArchiveSafely({
      ...input,
      archivePath: tarPath,
      destinationPath,
      password: "",
    });
    return inner.extractedEntries;
  } finally {
    await fsp.rm(stageDestination, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Whether a file name looks like an archive this module can open.
 * @param {string} fileName
 */
function isSupportedArchiveName(fileName) {
  return formatSupported(detectArchiveFormatFromName(fileName));
}

module.exports = {
  ADM_ZIP_MAX_BYTES,
  ARCHIVE_ERROR_CODES,
  ArchiveError,
  classifyToolOutput,
  detectArchiveFormat,
  detectArchiveFormatFromBuffer,
  detectArchiveFormatFromName,
  extractArchiveSafely,
  findSystemArchivers,
  inspectArchive,
  inspectArchiveVolumes,
  isArchiveError,
  isSupportedArchiveName,
  isUnsafeArchiveEntryName,
  listArchiveEntries,
  mapFsError,
  normalizeArchiveEntryName,
  parse7zListing,
  validateArchiveEntries,
};
