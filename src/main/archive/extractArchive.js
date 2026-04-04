// @ts-check

const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const cp = require("child_process");
const { pipeline } = require("stream/promises");
const AdmZip = require("adm-zip");
const Seven = require("node-7z");
const Unrar = require("unrar");

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

/**
 * @param {string} script
 * @param {Record<string, string>} envOverrides
 * @returns {Promise<string>}
 */
async function runPowerShell(script, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          ...envOverrides,
        },
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            `PowerShell command failed with exit code ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}

/**
 * @param {string} archivePath
 * @returns {Promise<string[]>}
 */
async function listZipEntriesWithPowerShell(archivePath) {
  const script = `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archivePath = $env:ATLAS_ARCHIVE_PATH
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
      @($zip.Entries | ForEach-Object { $_.FullName }) | ConvertTo-Json -Compress
    } finally {
      $zip.Dispose()
    }
  `;
  const stdout = await runPowerShell(script, {
    ATLAS_ARCHIVE_PATH: archivePath,
  });

  if (!stdout) {
    return [];
  }

  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * @param {string} archivePath
 * @param {string} destinationPath
 */
async function extractZipArchiveWithPowerShell(archivePath, destinationPath) {
  const script = `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archivePath = $env:ATLAS_ARCHIVE_PATH
    $destinationPath = $env:ATLAS_DESTINATION_PATH
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
      foreach ($entry in $zip.Entries) {
        if ([string]::IsNullOrWhiteSpace($entry.FullName)) {
          continue
        }

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
 * @returns {Promise<string[]>}
 */
async function list7zEntries(archivePath) {
  return new Promise((resolve, reject) => {
    const archive = new Seven();
    const names = new Set();

    archive
      .list(archivePath)
      .progress((entries) => {
        if (!Array.isArray(entries)) {
          return;
        }

        for (const entry of entries) {
          if (entry?.name) {
            names.add(entry.name);
          }
        }
      })
      .then(() => resolve([...names]))
      .catch(reject);
  });
}

/**
 * @param {string} archivePath
 * @returns {Promise<Array<{ name: string, type?: string }>>}
 */
async function listRarEntries(archivePath) {
  return new Promise((resolve, reject) => {
    const archive = new Unrar(archivePath);

    archive.list((error, entries) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(entries || []);
    });
  });
}

/**
 * @param {string} archivePath
 * @returns {Promise<string[]>}
 */
async function listArchiveEntries(archivePath) {
  const extension = path.extname(archivePath).toLowerCase();

  if (extension === ".zip") {
    if (process.platform === "win32") {
      return listZipEntriesWithPowerShell(archivePath);
    }

    const archive = new AdmZip(archivePath);
    return archive.getEntries().map((entry) => entry.entryName);
  }

  if (extension === ".7z") {
    return list7zEntries(archivePath);
  }

  if (extension === ".rar") {
    const entries = await listRarEntries(archivePath);
    return entries.map((entry) => entry.name).filter(Boolean);
  }

  throw new Error("Unsupported archive format");
}

/**
 * @param {string} archivePath
 * @param {string} destinationPath
 */
async function extract7zArchive(archivePath, destinationPath) {
  return new Promise((resolve, reject) => {
    const archive = new Seven();

    archive
      .extractFull(archivePath, destinationPath)
      .then(resolve)
      .catch(reject);
  });
}

/**
 * @param {string} archivePath
 * @param {string} destinationPath
 */
async function extractRarArchive(archivePath, destinationPath) {
  const archive = new Unrar(archivePath);
  const entries = await listRarEntries(archivePath);

  for (const entry of entries) {
    const normalizedName = normalizeArchiveEntryName(entry.name);

    if (!normalizedName) {
      continue;
    }

    const targetPath = path.join(destinationPath, ...normalizedName.split("/"));

    if (
      normalizedName.endsWith("/") ||
      (entry.type && String(entry.type).toLowerCase().includes("directory"))
    ) {
      await fsp.mkdir(targetPath, { recursive: true });
      continue;
    }

    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await pipeline(
      archive.stream(entry.name),
      fs.createWriteStream(targetPath),
    );
  }
}

/**
 * @param {{ archivePath: string, destinationPath: string }} input
 */
async function extractArchiveSafely(input) {
  const extension = path.extname(input.archivePath).toLowerCase();
  const entries = await listArchiveEntries(input.archivePath);
  const validation = validateArchiveEntries(entries);

  if (!validation.valid) {
    throw new Error(
      `Archive contains unsafe paths: ${validation.invalidEntries.join(", ")}`,
    );
  }

  await fsp.mkdir(input.destinationPath, { recursive: true });

  if (extension === ".zip") {
    if (process.platform === "win32") {
      await extractZipArchiveWithPowerShell(
        input.archivePath,
        input.destinationPath,
      );
    } else {
      const archive = new AdmZip(input.archivePath);
      archive.extractAllTo(input.destinationPath, true);
    }
  } else if (extension === ".7z") {
    await extract7zArchive(input.archivePath, input.destinationPath);
  } else if (extension === ".rar") {
    await extractRarArchive(input.archivePath, input.destinationPath);
  } else {
    throw new Error("Unsupported archive format");
  }

  return {
    success: true,
    extractedEntries: entries.length,
  };
}

module.exports = {
  extractArchiveSafely,
  isUnsafeArchiveEntryName,
  listArchiveEntries,
  normalizeArchiveEntryName,
  validateArchiveEntries,
};
