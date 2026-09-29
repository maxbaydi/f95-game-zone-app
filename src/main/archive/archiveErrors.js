// @ts-check

/**
 * Structured extraction failures. Every extractor in the fallback chain maps
 * its tool-specific output onto one of these codes so the install pipeline
 * and the downloads UI can react (ask for a password, free disk space, offer
 * the package for manual extraction) instead of showing raw tool output.
 */
const ARCHIVE_ERROR_CODES = /** @type {const} */ ({
  UNSUPPORTED_FORMAT: "unsupported_format",
  ARCHIVE_NOT_FOUND: "archive_not_found",
  ENCRYPTED: "archive_encrypted",
  WRONG_PASSWORD: "archive_wrong_password",
  CORRUPT: "archive_corrupt",
  INCOMPLETE: "archive_incomplete",
  MISSING_VOLUME: "archive_missing_volume",
  MULTIPART_UNSUPPORTED: "archive_multipart_unsupported",
  UNSAFE_PATHS: "archive_unsafe_paths",
  DISK_FULL: "disk_full",
  PATH_TOO_LONG: "path_too_long",
  FILE_LOCKED: "file_locked",
  TOOL_MISSING: "extract_tool_missing",
  EXTRACT_FAILED: "extract_failed",
});

/**
 * Codes that no other extractor can fix: trying the next tool would only
 * waste time and produce a less precise message.
 */
/** @type {Set<string>} */
const DEFINITIVE_ARCHIVE_ERROR_CODES = new Set([
  ARCHIVE_ERROR_CODES.ENCRYPTED,
  ARCHIVE_ERROR_CODES.WRONG_PASSWORD,
  ARCHIVE_ERROR_CODES.DISK_FULL,
  ARCHIVE_ERROR_CODES.UNSAFE_PATHS,
  ARCHIVE_ERROR_CODES.ARCHIVE_NOT_FOUND,
  ARCHIVE_ERROR_CODES.MISSING_VOLUME,
]);

/**
 * Codes worth a short wait and another attempt with the same tool.
 * @type {Set<string>}
 */
const RETRYABLE_ARCHIVE_ERROR_CODES = new Set([
  ARCHIVE_ERROR_CODES.FILE_LOCKED,
]);

class ArchiveError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, tool?: string, detail?: string, cause?: unknown, entry?: string }=} options
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "ArchiveError";
    this.code = options.code || ARCHIVE_ERROR_CODES.EXTRACT_FAILED;
    this.tool = options.tool || "";
    this.detail = options.detail || "";
    this.entry = options.entry || "";
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * @param {unknown} error
 * @returns {error is ArchiveError}
 */
function isArchiveError(error) {
  return error instanceof ArchiveError;
}

/**
 * Human-readable summary per code, used by the downloads panel and logs.
 * @param {string} code
 * @param {{ password?: boolean }=} context
 */
function describeArchiveErrorCode(code, context = {}) {
  switch (code) {
    case ARCHIVE_ERROR_CODES.ENCRYPTED:
      return "The archive is password-protected. Enter the password from the game thread to unpack it.";
    case ARCHIVE_ERROR_CODES.WRONG_PASSWORD:
      return context.password
        ? "The password did not open the archive. Check it against the game thread and try again."
        : "The archive is password-protected. Enter the password from the game thread to unpack it.";
    case ARCHIVE_ERROR_CODES.CORRUPT:
      return "The archive is damaged or was not downloaded completely. Re-download it from another mirror, or unpack it manually if your archiver can repair it.";
    case ARCHIVE_ERROR_CODES.INCOMPLETE:
      return "The archive ends early: the download is probably incomplete. Re-download it from another mirror.";
    case ARCHIVE_ERROR_CODES.MISSING_VOLUME:
      return "This is a multi-part archive and not all parts are present. Download every part into the same folder, then install from the first part.";
    case ARCHIVE_ERROR_CODES.MULTIPART_UNSUPPORTED:
      return "This multi-part archive needs an external archiver. Unpack it manually, then use \"Install from folder\".";
    case ARCHIVE_ERROR_CODES.UNSAFE_PATHS:
      return "The archive contains paths that would escape the install folder, so it was not unpacked.";
    case ARCHIVE_ERROR_CODES.DISK_FULL:
      return "There is not enough free disk space to unpack the game. Free some space, then retry the install.";
    case ARCHIVE_ERROR_CODES.PATH_TOO_LONG:
      return "Some file paths in the archive are too long for this install folder. Move the library to a shorter path or unpack manually.";
    case ARCHIVE_ERROR_CODES.FILE_LOCKED:
      return "A file is locked by another program (often the antivirus scanning the download). Wait a moment and retry the install.";
    case ARCHIVE_ERROR_CODES.UNSUPPORTED_FORMAT:
      return "This archive format is not supported. Unpack it manually, then use \"Install from folder\".";
    case ARCHIVE_ERROR_CODES.TOOL_MISSING:
      return "No archiver on this computer can open the file. Unpack it manually, then use \"Install from folder\".";
    case ARCHIVE_ERROR_CODES.ARCHIVE_NOT_FOUND:
      return "The downloaded package is no longer on disk. Download it again.";
    default:
      return "";
  }
}

module.exports = {
  ARCHIVE_ERROR_CODES,
  ArchiveError,
  DEFINITIVE_ARCHIVE_ERROR_CODES,
  RETRYABLE_ARCHIVE_ERROR_CODES,
  describeArchiveErrorCode,
  isArchiveError,
};
