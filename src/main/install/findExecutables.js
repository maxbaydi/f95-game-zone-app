// @ts-check

const fs = require("fs");
const path = require("path");

/**
 * Lists files under `dir` whose extension is one of `extensions`, as paths
 * relative to `dir` (e.g. `Game.exe`, `lib\\helper.exe`).
 *
 * The root folder must be readable (its error is thrown to the caller);
 * sub-folders that cannot be read (access denied, removed while walking) are
 * skipped so one broken folder does not hide every other launcher.
 *
 * @param {string} dir
 * @param {string[]} extensions lower-case extensions without the dot
 * @param {{ readdirSync?: typeof fs.readdirSync }=} options
 * @returns {string[]}
 */
function findExecutables(dir, extensions, options = {}) {
  const readdirSync = options.readdirSync || fs.readdirSync;
  const allowed = new Set(
    (Array.isArray(extensions) ? extensions : [])
      .map((entry) => String(entry || "").trim().toLowerCase().replace(/^\./, ""))
      .filter(Boolean),
  );
  /** @type {string[]} */
  const executables = [];
  /** @type {string[]} */
  const stack = [dir];
  let isRoot = true;

  while (stack.length) {
    const current = /** @type {string} */ (stack.pop());
    /** @type {fs.Dirent[]} */
    let items;
    try {
      items = /** @type {fs.Dirent[]} */ (
        /** @type {unknown} */ (readdirSync(current, { withFileTypes: true }))
      );
    } catch (error) {
      if (isRoot) {
        throw error;
      }
      continue;
    } finally {
      isRoot = false;
    }

    for (const item of items) {
      const fullPath = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      const extension = path.extname(item.name).toLowerCase().slice(1);
      if (allowed.has(extension)) {
        executables.push(path.relative(dir, fullPath));
      }
    }
  }

  return executables;
}

module.exports = {
  findExecutables,
};
