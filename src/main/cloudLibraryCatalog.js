// @ts-check

const { buildCompactScanKey } = require("../shared/scanMatchUtils");

function normalizeCatalogUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.replace(/\/+$/, "").toLowerCase();
}

function buildCloudLibraryEntryIdentityCandidates(input) {
  const candidates = [];
  const seenValues = new Set();
  const pushCandidate = (value) => {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue || seenValues.has(normalizedValue)) {
      return;
    }

    seenValues.add(normalizedValue);
    candidates.push(normalizedValue);
  };

  const atlasId = String(input?.atlasId || "").trim();
  if (atlasId) {
    pushCandidate(`atlas:${atlasId}`);
  }

  const f95Id = String(input?.f95Id || "").trim();
  if (f95Id) {
    pushCandidate(`f95:${f95Id}`);
  }

  const siteUrl = normalizeCatalogUrl(input?.siteUrl);
  if (siteUrl) {
    pushCandidate(`site:${siteUrl}`);
  }

  const titleKey = buildCompactScanKey(input?.title || input?.displayTitle || "");
  const creatorKey = buildCompactScanKey(
    input?.creator || input?.displayCreator || "",
  );

  if (titleKey) {
    pushCandidate(`title:${titleKey}|creator:${creatorKey || "unknown"}`);
  }

  return candidates;
}

function buildCloudLibraryEntryIdentity(input) {
  return buildCloudLibraryEntryIdentityCandidates(input)[0] || "";
}

function buildCloudLibraryCatalogEntry(game) {
  const versions = Array.isArray(game?.versions) ? game.versions : [];
  const entry = {
    identityKey: "",
    recordId: Number(game?.record_id || 0) || null,
    atlasId: game?.atlas_id ? String(game.atlas_id) : "",
    f95Id: game?.f95_id ? String(game.f95_id) : "",
    siteUrl: String(game?.siteUrl || "").trim(),
    title: String(game?.displayTitle || game?.title || "").trim(),
    creator: String(game?.displayCreator || game?.creator || "").trim(),
    engine: String(game?.engine || "").trim(),
    latestVersion: String(game?.latestVersion || "").trim(),
    newestInstalledVersion: String(game?.newestInstalledVersion || "").trim(),
    bannerUrl: String(game?.banner_url || "").trim(),
    status: String(game?.status || "").trim(),
    category: String(game?.category || "").trim(),
    isFavorite: Boolean(game?.isFavorite),
    installedVersionCount: versions.length,
    updatedAt: new Date().toISOString(),
  };

  entry.identityKey = buildCloudLibraryEntryIdentity(entry);
  return entry.identityKey ? entry : null;
}

function parseCloudLibraryCatalogManifest(input) {
  if (!input || typeof input !== "object") {
    return {
      version: 1,
      updatedAt: "",
      entries: [],
    };
  }

  const entries = Array.isArray(input.entries)
    ? input.entries
        .map((entry) => ({
          identityKey: String(entry?.identityKey || "").trim(),
          recordId:
            Number.isFinite(Number(entry?.recordId)) && Number(entry?.recordId) > 0
              ? Number(entry.recordId)
              : null,
          atlasId: String(entry?.atlasId || "").trim(),
          f95Id: String(entry?.f95Id || "").trim(),
          siteUrl: String(entry?.siteUrl || "").trim(),
          title: String(entry?.title || "").trim(),
          creator: String(entry?.creator || "").trim(),
          engine: String(entry?.engine || "").trim(),
          latestVersion: String(entry?.latestVersion || "").trim(),
          newestInstalledVersion: String(entry?.newestInstalledVersion || "").trim(),
          bannerUrl: String(entry?.bannerUrl || "").trim(),
          status: String(entry?.status || "").trim(),
          category: String(entry?.category || "").trim(),
          isFavorite: Boolean(entry?.isFavorite),
          installedVersionCount: Math.max(0, Number(entry?.installedVersionCount || 0)),
          updatedAt: String(entry?.updatedAt || "").trim(),
        }))
        .filter((entry) => Boolean(entry.identityKey))
    : [];

  return {
    version: Number(input.version || 1) || 1,
    updatedAt: String(input.updatedAt || "").trim(),
    entries: sortCloudLibraryCatalogEntries(entries),
  };
}

function scoreCloudLibraryEntry(entry) {
  let score = 0;

  if (entry?.atlasId) {
    score += 100;
  }

  if (entry?.f95Id) {
    score += 45;
  }

  if (entry?.siteUrl) {
    score += 20;
  }

  if (entry?.bannerUrl) {
    score += 8;
  }

  if (entry?.latestVersion) {
    score += 6;
  }

  if (entry?.creator) {
    score += 6;
  }

  if (entry?.title) {
    score += 6;
  }

  if (entry?.installedVersionCount > 0) {
    score += 3;
  }

  return score;
}

function choosePreferredCloudLibraryEntry(left, right) {
  if (!left) {
    return right || null;
  }

  if (!right) {
    return left;
  }

  const leftScore = scoreCloudLibraryEntry(left);
  const rightScore = scoreCloudLibraryEntry(right);

  if (rightScore !== leftScore) {
    return rightScore > leftScore ? right : left;
  }

  const leftUpdatedAt = new Date(left.updatedAt || 0).getTime() || 0;
  const rightUpdatedAt = new Date(right.updatedAt || 0).getTime() || 0;

  const preferred = rightUpdatedAt > leftUpdatedAt ? right : left;

  if (left.isFavorite || right.isFavorite) {
    return { ...preferred, isFavorite: true };
  }

  return preferred;
}

function sortCloudLibraryCatalogEntries(entries) {
  return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const leftTitle = String(left?.title || "").toLowerCase();
    const rightTitle = String(right?.title || "").toLowerCase();
    if (leftTitle !== rightTitle) {
      return leftTitle.localeCompare(rightTitle);
    }

    return String(left?.creator || "").localeCompare(String(right?.creator || ""));
  });
}

function mergeCloudLibraryCatalogEntries(localEntries, remoteEntries) {
  const mergedByKey = new Map();

  for (const entry of [...(remoteEntries || []), ...(localEntries || [])]) {
    if (!entry?.identityKey) {
      continue;
    }

    mergedByKey.set(
      entry.identityKey,
      choosePreferredCloudLibraryEntry(mergedByKey.get(entry.identityKey), entry),
    );
  }

  return sortCloudLibraryCatalogEntries([...mergedByKey.values()].filter(Boolean));
}

function getRemoteOnlyCloudLibraryEntries(remoteEntries, localEntries) {
  const localKeys = new Set(
    (Array.isArray(localEntries) ? localEntries : [])
      .map((entry) => entry?.identityKey)
      .filter(Boolean),
  );

  return sortCloudLibraryCatalogEntries(
    (Array.isArray(remoteEntries) ? remoteEntries : []).filter(
      (entry) => entry?.identityKey && !localKeys.has(entry.identityKey),
    ),
  );
}

module.exports = {
  buildCloudLibraryCatalogEntry,
  buildCloudLibraryEntryIdentity,
  buildCloudLibraryEntryIdentityCandidates,
  getRemoteOnlyCloudLibraryEntries,
  mergeCloudLibraryCatalogEntries,
  normalizeCatalogUrl,
  parseCloudLibraryCatalogManifest,
  sortCloudLibraryCatalogEntries,
};
