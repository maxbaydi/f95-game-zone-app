"use strict";

const crypto = require("crypto");

function sortManifestEntries(entries) {
  return [...entries].sort((left, right) =>
    String(left.path || "").localeCompare(String(right.path || "")),
  );
}

function buildSaveManifest(input) {
  const entries = sortManifestEntries(input.entries || []).map((entry) => ({
    path: entry.path,
    size: Number(entry.size) || 0,
    sha256: entry.sha256 || "",
    mtimeMs: Number(entry.mtimeMs) || 0,
  }));

  const manifest = {
    version: 1,
    identity: input.identity || "",
    generatedAt: input.generatedAt || new Date().toISOString(),
    profiles: (input.profiles || []).map((profile) => ({
      provider: profile.provider,
      strategy: profile.strategy,
      rootPath: profile.rootPath,
      archiveRoot: profile.archiveRoot,
      confidence: Number(profile.confidence) || 0,
      reasons: profile.reasons || [],
    })),
    entries,
  };

  return {
    ...manifest,
    manifestHash: createSaveManifestHash(manifest),
    contentHash: createSaveContentHash(manifest),
  };
}

/**
 * Hash of what the files contain, independent of where they live and when
 * they were written: two machines holding the same saves agree on it even
 * though their manifestHash (paths, mtimes) differs.
 */
function createSaveContentHash(manifest) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        sortManifestEntries(manifest.entries || []).map((entry) => [
          entry.path,
          Number(entry.size) || 0,
          entry.sha256 || "",
        ]),
      ),
    )
    .digest("hex");
}

function createSaveManifestHash(manifest) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      version: manifest.version || 1,
      identity: manifest.identity || "",
      profiles: manifest.profiles || [],
      entries: sortManifestEntries(manifest.entries || []),
    }))
    .digest("hex");
}

module.exports = {
  buildSaveManifest,
  createSaveContentHash,
  createSaveManifestHash,
};
