"use strict";

function normalizeHash(value) {
  return String(value || "").trim();
}

function getManifestLatestMtimeMs(manifest) {
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];

  return entries.reduce((maxValue, entry) => {
    const nextValue = Number(entry?.mtimeMs) || 0;
    return nextValue > maxValue ? nextValue : maxValue;
  }, 0);
}

function decideSaveSyncPlan(input) {
  const localManifest = input?.localManifest || null;
  const remoteManifest = input?.remoteManifest || null;
  const syncState = input?.syncState || null;

  const localHash = normalizeHash(localManifest?.manifestHash);
  const remoteHash = normalizeHash(remoteManifest?.manifestHash);
  const lastLocalHash = normalizeHash(syncState?.lastLocalManifestHash);
  const lastRemoteHash = normalizeHash(syncState?.lastRemoteManifestHash);

  if (!localHash && !remoteHash) {
    return {
      action: "noop",
      reason: "no-saves",
    };
  }

  if (localHash && !remoteHash) {
    return {
      action: "upload",
      reason: "remote-missing",
    };
  }

  if (!localHash && remoteHash) {
    return {
      action: "restore",
      reason: "local-missing",
    };
  }

  if (localHash === remoteHash) {
    return {
      action: "noop",
      reason: "already-synced",
    };
  }

  const localChangedSinceLast = lastLocalHash
    ? localHash !== lastLocalHash
    : Boolean(localHash);
  const remoteChangedSinceLast = lastRemoteHash
    ? remoteHash !== lastRemoteHash
    : Boolean(remoteHash);

  if (localChangedSinceLast && !remoteChangedSinceLast) {
    return {
      action: "upload",
      reason: "local-changed",
    };
  }

  if (!localChangedSinceLast && remoteChangedSinceLast) {
    return {
      action: "restore",
      reason: "remote-changed",
    };
  }

  const localLatestMtimeMs = getManifestLatestMtimeMs(localManifest);
  const remoteLatestMtimeMs = getManifestLatestMtimeMs(remoteManifest);

  if (localLatestMtimeMs > remoteLatestMtimeMs) {
    return {
      action: "upload",
      reason: "local-newer",
    };
  }

  if (remoteLatestMtimeMs > localLatestMtimeMs) {
    return {
      action: "restore",
      reason: "remote-newer",
    };
  }

  return {
    action: "conflict",
    reason: "ambiguous-divergence",
  };
}

module.exports = {
  decideSaveSyncPlan,
  getManifestLatestMtimeMs,
};
