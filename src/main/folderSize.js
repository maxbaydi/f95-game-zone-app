// @ts-check

const fs = require("fs");
const path = require("path");

const YIELD_EVERY_DIRECTORIES = 50;

/**
 * Sums the size of every file under `targetPath` without blocking the event
 * loop (the synchronous walker froze the window for multi-gigabyte installs).
 * Unreadable subfolders are skipped, a missing path counts as 0 bytes and a
 * plain file returns its own size.
 *
 * @param {string} targetPath
 * @param {{
 *   readdir?: (dir: string, options: { withFileTypes: true }) => Promise<import("fs").Dirent[]>,
 *   stat?: (target: string) => Promise<import("fs").Stats>
 * }=} options
 * @returns {Promise<number>}
 */
async function getFolderSizeAsync(targetPath, options = {}) {
  const readdir = options.readdir || fs.promises.readdir;
  const stat = options.stat || fs.promises.stat;
  const root = String(targetPath || "").trim();
  if (!root) {
    return 0;
  }

  let rootStats;
  try {
    rootStats = await stat(root);
  } catch {
    return 0;
  }

  if (rootStats.isFile()) {
    return rootStats.size;
  }

  if (!rootStats.isDirectory()) {
    return 0;
  }

  let total = 0;
  let visitedDirectories = 0;
  const stack = [root];

  while (stack.length > 0) {
    const current = /** @type {string} */ (stack.pop());
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      try {
        total += (await stat(fullPath)).size;
      } catch {
        // A file that vanished mid-walk is not worth failing the whole size.
      }
    }

    visitedDirectories += 1;
    if (visitedDirectories % YIELD_EVERY_DIRECTORIES === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return total;
}

module.exports = {
  getFolderSizeAsync,
};
