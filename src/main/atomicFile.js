const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

// Writes a file so readers never observe a half-written result: the data goes
// to a sibling temp file first and is then renamed over the target. If the
// rename is refused (e.g. antivirus holding the target open on Windows),
// leave the previous file intact and report the failure to the caller.
function writeFileAtomicSync(filePath, data, options = {}) {
  const fsImpl = options.fs || fs;
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  fsImpl.mkdirSync(directory, { recursive: true });
  try {
    fsImpl.writeFileSync(tempPath, data, options.encoding || "utf8");
    fsImpl.renameSync(tempPath, filePath);
  } finally {
    try {
      fsImpl.unlinkSync(tempPath);
    } catch {
      // A successful rename has already consumed the temporary file.
    }
  }
}

module.exports = {
  writeFileAtomicSync,
};
