// @ts-check

const crypto = require("crypto");
const {
  buildCloudLibraryEntryIdentityCandidates,
  normalizeCatalogUrl,
} = require("../cloudLibraryCatalog");

function normalizeCloudProjectKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCloudLibraryDeleteCandidateKeys(values) {
  const normalizedKeys = [];
  const seenKeys = new Set();

  for (const rawValue of Array.isArray(values) ? values : []) {
    const identityKey = String(rawValue || "").trim();
    if (!identityKey || seenKeys.has(identityKey)) {
      continue;
    }

    seenKeys.add(identityKey);
    normalizedKeys.push(identityKey);
  }

  return normalizedKeys;
}

function collectCloudLibraryDeleteCandidateKeys(requests) {
  return normalizeCloudLibraryDeleteCandidateKeys(
    (Array.isArray(requests) ? requests : []).flatMap((request) => [
      ...(Array.isArray(request?.candidateIdentityKeys)
        ? request.candidateIdentityKeys
        : []),
      request?.preferredIdentityKey || "",
    ]),
  );
}

function isMeaningfulCloudDeleteText(value) {
  const normalizedValue = String(value || "").trim().toLowerCase();
  return Boolean(normalizedValue && normalizedValue !== "unknown");
}

function buildCloudLibraryDeleteRequest(input) {
  const cloudProjectKey = normalizeCloudProjectKey(input?.cloudProjectKey);
  const recordId = Number.isInteger(Number(input?.recordId))
    ? Number(input.recordId)
    : null;
  const atlasId = String(input?.atlasId || "").trim();
  const f95Id = String(input?.f95Id || "").trim();
  const siteUrl = normalizeCatalogUrl(input?.siteUrl);
  const title = String(input?.title || "").trim();
  const creator = String(input?.creator || "").trim();
  const identityCandidates = buildCloudLibraryEntryIdentityCandidates({
    atlasId,
    f95Id,
    siteUrl,
    title,
    creator,
  });
  const hasStrongIdentity = Boolean(atlasId || f95Id || siteUrl);
  const candidateIdentityKeys = hasStrongIdentity
    ? identityCandidates
    : identityCandidates.filter(
        (identityKey) =>
          identityKey.startsWith("title:") &&
          isMeaningfulCloudDeleteText(title),
      );
  const preferredIdentityKey = candidateIdentityKeys[0] || "";

  if (!cloudProjectKey || !preferredIdentityKey) {
    return null;
  }

  const requestKey = crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        cloudProjectKey,
        candidateIdentityKeys,
        atlasId,
        f95Id,
        siteUrl,
        title,
        creator,
      }),
    )
    .digest("hex");

  return {
    requestKey,
    cloudProjectKey,
    recordId,
    preferredIdentityKey,
    candidateIdentityKeys,
    atlasId,
    f95Id,
    siteUrl,
    title,
    creator,
    requestedAt: new Date().toISOString(),
    lastError: "",
  };
}

function mapCloudLibraryDeleteQueueRow(row) {
  if (!row) {
    return null;
  }

  let candidateIdentityKeys = [];
  try {
    candidateIdentityKeys = normalizeCloudLibraryDeleteCandidateKeys(
      JSON.parse(row.candidate_identity_keys_json || "[]"),
    );
  } catch {
    candidateIdentityKeys = [];
  }

  return {
    requestKey: row.request_key,
    cloudProjectKey: normalizeCloudProjectKey(row.cloud_project_key),
    recordId:
      Number.isInteger(Number(row.record_id)) && Number(row.record_id) > 0
        ? Number(row.record_id)
        : null,
    preferredIdentityKey: String(row.preferred_identity_key || "").trim(),
    candidateIdentityKeys,
    atlasId: String(row.atlas_id || "").trim(),
    f95Id: String(row.f95_id || "").trim(),
    siteUrl: normalizeCatalogUrl(row.site_url),
    title: String(row.title || "").trim(),
    creator: String(row.creator || "").trim(),
    requestedAt: String(row.requested_at || "").trim(),
    lastError: String(row.last_error || "").trim(),
  };
}

function queueCloudLibraryDeleteRequest(db, input) {
  const normalizedInput = buildCloudLibraryDeleteRequest(input);
  if (!normalizedInput) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    db.run(
      `
        INSERT INTO cloud_library_delete_queue
        (
          request_key,
          cloud_project_key,
          record_id,
          preferred_identity_key,
          candidate_identity_keys_json,
          atlas_id,
          f95_id,
          site_url,
          title,
          creator,
          requested_at,
          last_error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_key) DO UPDATE SET
          cloud_project_key = excluded.cloud_project_key,
          record_id = excluded.record_id,
          preferred_identity_key = excluded.preferred_identity_key,
          candidate_identity_keys_json = excluded.candidate_identity_keys_json,
          atlas_id = excluded.atlas_id,
          f95_id = excluded.f95_id,
          site_url = excluded.site_url,
          title = excluded.title,
          creator = excluded.creator,
          requested_at = excluded.requested_at,
          last_error = excluded.last_error
      `,
      [
        normalizedInput.requestKey,
        normalizedInput.cloudProjectKey,
        normalizedInput.recordId,
        normalizedInput.preferredIdentityKey,
        JSON.stringify(normalizedInput.candidateIdentityKeys),
        normalizedInput.atlasId,
        normalizedInput.f95Id,
        normalizedInput.siteUrl,
        normalizedInput.title,
        normalizedInput.creator,
        normalizedInput.requestedAt,
        normalizedInput.lastError,
      ],
      (err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(normalizedInput);
      },
    );
  });
}

function listPendingCloudLibraryDeleteRequests(db, cloudProjectKey) {
  const normalizedProjectKey = normalizeCloudProjectKey(cloudProjectKey);
  if (!normalizedProjectKey) {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT
          request_key,
          cloud_project_key,
          record_id,
          preferred_identity_key,
          candidate_identity_keys_json,
          atlas_id,
          f95_id,
          site_url,
          title,
          creator,
          requested_at,
          last_error
        FROM cloud_library_delete_queue
        WHERE cloud_project_key = ?
        ORDER BY requested_at ASC
      `,
      [normalizedProjectKey],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(
          (Array.isArray(rows) ? rows : [])
            .map((row) => mapCloudLibraryDeleteQueueRow(row))
            .filter(Boolean),
        );
      },
    );
  });
}

function deletePendingCloudLibraryDeleteRequest(db, requestKey) {
  const normalizedRequestKey = String(requestKey || "").trim();
  if (!normalizedRequestKey) {
    return Promise.resolve({ success: false });
  }

  return new Promise((resolve, reject) => {
    db.run(
      `
        DELETE FROM cloud_library_delete_queue
        WHERE request_key = ?
      `,
      [normalizedRequestKey],
      function onDeleted(err) {
        if (err) {
          reject(err);
          return;
        }

        resolve({ success: this.changes > 0 });
      },
    );
  });
}

function setPendingCloudLibraryDeleteRequestError(db, requestKey, error) {
  const normalizedRequestKey = String(requestKey || "").trim();
  if (!normalizedRequestKey) {
    return Promise.resolve({ success: false });
  }

  return new Promise((resolve, reject) => {
    db.run(
      `
        UPDATE cloud_library_delete_queue
        SET last_error = ?
        WHERE request_key = ?
      `,
      [String(error || "").trim(), normalizedRequestKey],
      function onUpdated(err) {
        if (err) {
          reject(err);
          return;
        }

        resolve({ success: this.changes > 0 });
      },
    );
  });
}

module.exports = {
  buildCloudLibraryDeleteRequest,
  collectCloudLibraryDeleteCandidateKeys,
  deletePendingCloudLibraryDeleteRequest,
  listPendingCloudLibraryDeleteRequests,
  normalizeCloudLibraryDeleteCandidateKeys,
  queueCloudLibraryDeleteRequest,
  setPendingCloudLibraryDeleteRequestError,
};
