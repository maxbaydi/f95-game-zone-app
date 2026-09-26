const fs = require("fs");
const path = require("path");

// Writes a file so readers never observe a half-written result: the data goes
// to a sibling temp file first and is then renamed over the target. If the
// rename is refused (e.g. antivirus holding the target open on Windows) it
// falls back to a direct write so the save is not lost.
function writeFileAtomicSync(filePath, data, options = {}) {
  const fsImpl = options.fs || fs;
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  fsImpl.mkdirSync(directory, { recursive: true });
  fsImpl.writeFileSync(tempPath, data, options.encoding || "utf8");

  try {
    fsImpl.renameSync(tempPath, filePath);
  } catch (renameError) {
    try {
      fsImpl.writeFileSync(filePath, data, options.encoding || "utf8");
    } finally {
      try {
        fsImpl.unlinkSync(tempPath);
      } catch {
        // The temp file may already be gone.
      }
    }
    if (typeof options.onFallback === "function") {
      options.onFallback(renameError);
    }
  }
}

module.exports = {
  writeFileAtomicSync,
};
