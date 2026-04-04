const fs = require("fs");
const path = require("path");

const IGNORED_ROOT_DIRECTORIES = new Set(["__MACOSX"]);
const IGNORED_ROOT_FILES = new Set([".DS_Store", "Thumbs.db"]);

function isIgnoredArchiveRootEntry(entry) {
  return (
    (entry.isDirectory() && IGNORED_ROOT_DIRECTORIES.has(entry.name)) ||
    (!entry.isDirectory() && IGNORED_ROOT_FILES.has(entry.name))
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

    if (directories.length === 1 && files.length === 0) {
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
