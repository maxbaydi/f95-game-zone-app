// @ts-check

/**
 * RAR listing and extraction through node-unrar-js (the official unrar
 * sources compiled to WebAssembly). It runs the same in the main process
 * and inside a worker thread (see rarWorker.js): extraction is synchronous
 * in the library, so large archives are handed to a worker to keep the UI
 * responsive.
 */
const path = require("path");

/**
 * @typedef {{
 *   mode: "list" | "extract",
 *   archivePath: string,
 *   destinationPath?: string,
 *   password?: string,
 * }} RarTask
 */

/**
 * @typedef {{
 *   ok: true,
 *   volume: boolean,
 *   headerEncrypted: boolean,
 *   entries: Array<{ name: string, size: number, directory: boolean, encrypted: boolean }>,
 *   extracted: number,
 * } | {
 *   ok: false,
 *   error: { message: string, reason?: string, file?: string, code?: string, errno?: number },
 * }} RarTaskResult
 */

/**
 * @param {RarTask} task
 * @returns {Promise<RarTaskResult>}
 */
async function runRarTask(task) {
  try {
    const { createExtractorFromFile } = require("node-unrar-js");
    const extractor = await createExtractorFromFile({
      filepath: task.archivePath,
      targetPath: task.destinationPath || path.dirname(task.archivePath),
      password: task.password || undefined,
    });

    const list = extractor.getFileList();
    const arcHeader = list.arcHeader;
    /** @type {Array<{ name: string, size: number, directory: boolean, encrypted: boolean }>} */
    const entries = [];
    for (const header of list.fileHeaders) {
      entries.push({
        name: String(header.name || "").replace(/\\/g, "/"),
        size: Number(header.unpSize) || 0,
        directory: Boolean(header.flags?.directory),
        encrypted: Boolean(header.flags?.encrypted),
      });
    }

    let extracted = 0;
    if (task.mode === "extract") {
      const result = extractor.extract({});
      // The iterator is lazy: every file is written while it is walked.
      for (const file of result.files) {
        if (!file.fileHeader?.flags?.directory) {
          extracted += 1;
        }
      }
    }

    return {
      ok: true,
      volume: Boolean(arcHeader?.flags?.volume),
      headerEncrypted: Boolean(arcHeader?.flags?.headerEncrypted),
      entries,
      extracted,
    };
  } catch (error) {
    const anyError = /** @type {any} */ (error);
    return {
      ok: false,
      error: {
        message: anyError?.message ? String(anyError.message) : String(error),
        reason: typeof anyError?.reason === "string" ? anyError.reason : undefined,
        file: typeof anyError?.file === "string" ? anyError.file : undefined,
        code: typeof anyError?.code === "string" ? anyError.code : undefined,
        errno: typeof anyError?.errno === "number" ? anyError.errno : undefined,
      },
    };
  }
}

module.exports = {
  runRarTask,
};
