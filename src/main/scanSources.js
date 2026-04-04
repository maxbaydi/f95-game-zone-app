// @ts-check

const fs = require("fs");
const path = require("path");
const {
  addScanSource,
  getScanSources,
  removeScanSource,
  updateScanSource,
} = require("./db/scanSourcesStore");
const { openDatabase } = require("./db/openDatabase");

/**
 * @param {string} message
 * @param {string} code
 * @returns {{ success: false, error: { code: string, message: string } }}
 */
function failure(message, code) {
  return {
    success: false,
    error: {
      code,
      message,
    },
  };
}

/**
 * @param {string} inputPath
 * @returns {string}
 */
function normalizeScanSourcePath(inputPath) {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw Object.assign(new Error("Scan source path is required"), {
      code: "SCAN_SOURCE_PATH_REQUIRED",
    });
  }

  const resolvedPath = path.resolve(inputPath.trim());

  if (!fs.existsSync(resolvedPath)) {
    throw Object.assign(new Error("Selected scan source does not exist"), {
      code: "SCAN_SOURCE_PATH_NOT_FOUND",
    });
  }

  if (!fs.statSync(resolvedPath).isDirectory()) {
    throw Object.assign(new Error("Scan source must be a directory"), {
      code: "SCAN_SOURCE_PATH_NOT_DIRECTORY",
    });
  }

  return resolvedPath;
}

async function listScanSources(appPaths) {
  try {
    const db = await openDatabase(appPaths);
    return {
      success: true,
      sources: await getScanSources(db),
    };
  } catch (error) {
    console.error("[scan.sources] list failed", error);
    return failure("Failed to load scan sources", "SCAN_SOURCE_LIST_FAILED");
  }
}

/**
 * @param {string} sourcePath
 */
async function createScanSource(appPaths, sourcePath) {
  try {
    const db = await openDatabase(appPaths);
    const normalizedPath = normalizeScanSourcePath(sourcePath);
    const source = await addScanSource(db, normalizedPath);

    return {
      success: true,
      source,
    };
  } catch (error) {
    console.error("[scan.sources] create failed", error);
    return failure(
      error instanceof Error ? error.message : "Failed to add scan source",
      error && typeof error === "object" && "code" in error
        ? error.code
        : "SCAN_SOURCE_CREATE_FAILED",
    );
  }
}

/**
 * @param {{ id: number, path?: string, isEnabled?: boolean }} params
 */
async function patchScanSource(appPaths, params) {
  try {
    const db = await openDatabase(appPaths);
    if (!params || typeof params.id !== "number") {
      return failure("Scan source id is required", "SCAN_SOURCE_ID_REQUIRED");
    }

    /** @type {{ path?: string, isEnabled?: boolean }} */
    const changes = {};

    if (typeof params.path === "string") {
      changes.path = normalizeScanSourcePath(params.path);
    }

    if (typeof params.isEnabled === "boolean") {
      changes.isEnabled = params.isEnabled;
    }

    const source = await updateScanSource(db, params.id, changes);

    if (!source) {
      return failure("Scan source was not found", "SCAN_SOURCE_NOT_FOUND");
    }

    return {
      success: true,
      source,
    };
  } catch (error) {
    console.error("[scan.sources] update failed", error);
    return failure(
      error instanceof Error ? error.message : "Failed to update scan source",
      error && typeof error === "object" && "code" in error
        ? error.code
        : "SCAN_SOURCE_UPDATE_FAILED",
    );
  }
}

/**
 * @param {number} sourceId
 */
async function deleteScanSource(appPaths, sourceId) {
  try {
    const db = await openDatabase(appPaths);
    if (typeof sourceId !== "number") {
      return failure("Scan source id is required", "SCAN_SOURCE_ID_REQUIRED");
    }

    const result = await removeScanSource(db, sourceId);

    if (!result.success) {
      return failure("Scan source was not found", "SCAN_SOURCE_NOT_FOUND");
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error("[scan.sources] delete failed", error);
    return failure(
      "Failed to remove scan source",
      "SCAN_SOURCE_DELETE_FAILED",
    );
  }
}

module.exports = {
  listScanSources,
  createScanSource,
  patchScanSource,
  deleteScanSource,
  normalizeScanSourcePath,
};
