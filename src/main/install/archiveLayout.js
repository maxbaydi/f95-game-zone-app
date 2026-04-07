const fs = require("fs");
const path = require("path");

const IGNORED_ROOT_DIRECTORIES = new Set(["__MACOSX"]);
const IGNORED_ROOT_FILES = new Set([".ds_store", "thumbs.db"]);
const AUXILIARY_ROOT_FILE_PATTERNS = [
  /^readme(?:[\s._-].*)?(?:\.[^.]+)?$/i,
  /^changelog(?:[\s._-].*)?(?:\.[^.]+)?$/i,
  /^changes?(?:[\s._-].*)?(?:\.[^.]+)?$/i,
  /^install(?:ation)?(?:[\s._-].*)?(?:\.[^.]+)?$/i,
  /^instructions?(?:[\s._-].*)?(?:\.[^.]+)?$/i,
  /^license(?:[\s._-].*)?(?:\.[^.]+)?$/i,
  /^credits?(?:[\s._-].*)?(?:\.[^.]+)?$/i,
  /^password(?:s)?(?:[\s._-].*)?(?:\.[^.]+)?$/i,
  /^(?:md5|sha1|sha256|sha512|checksums?)(?:[\s._-].*)?(?:\.[^.]+)?$/i,
];

function isAuxiliaryArchiveRootFile(fileName) {
  const normalizedName = String(fileName || "").trim();
  if (!normalizedName) {
    return false;
  }

  return AUXILIARY_ROOT_FILE_PATTERNS.some((pattern) =>
    pattern.test(normalizedName),
  );
}

function isIgnoredArchiveRootEntry(entry) {
  const normalizedName = String(entry.name || "").trim();

  return (
    (entry.isDirectory() &&
      IGNORED_ROOT_DIRECTORIES.has(normalizedName.toUpperCase())) ||
    (!entry.isDirectory() &&
      IGNORED_ROOT_FILES.has(normalizedName.toLowerCase()))
  );
}

async function resolveArchiveContentRoot(rootDirectory) {
  let currentDirectory = rootDirectory;
  let needsInspection = true;

  while (needsInspection) {
    const entries = await fs.promises.readdir(currentDirectory, {
      withFileTypes: true,
    });
    const meaningfulEntries = entries.filter(
      (entry) => !isIgnoredArchiveRootEntry(entry),
    );
    const directories = meaningfulEntries.filter((entry) => entry.isDirectory());
    const files = meaningfulEntries.filter((entry) => !entry.isDirectory());
    const payloadFiles = files.filter(
      (entry) => !isAuxiliaryArchiveRootFile(entry.name),
    );

    if (directories.length === 1 && payloadFiles.length === 0) {
      currentDirectory = path.join(currentDirectory, directories[0].name);
      continue;
    }

    needsInspection = false;
    return currentDirectory;
  }

  return currentDirectory;
}

module.exports = {
  resolveArchiveContentRoot,
};
