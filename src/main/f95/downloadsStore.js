const MAX_HISTORY_ITEMS = 40;

/**
 * Download entry lifecycle:
 *   resolving → (queued) → downloading → installing → completed
 *   resolving | downloading → action (user finishes a step in the browser)
 *   action → downloading (auto-continue) | error | cancelled
 *   any active state → error | cancelled
 *   error | cancelled → resolving (retry)
 */
const ACTIVE_STATUSES = new Set([
  "queued",
  "resolving",
  "action",
  "downloading",
  "installing",
]);
const CANCELLABLE_STATUSES = new Set([
  "queued",
  "resolving",
  "action",
  "downloading",
]);
const RETRYABLE_STATUSES = new Set(["error", "cancelled"]);
const HISTORY_STATUSES = new Set(["completed", "error", "cancelled"]);

const STATUS_PRIORITY = {
  downloading: 0,
  resolving: 1,
  queued: 1,
  action: 1,
  installing: 2,
  error: 3,
  cancelled: 3,
  completed: 4,
};

const CLEARED_ERROR_FIELDS = {
  error: "",
  errorCode: "",
  actionUrl: "",
};

function isActiveStatus(status) {
  return ACTIVE_STATUSES.has(status);
}

function sortDownloads(entries) {
  return [...entries].sort((left, right) => {
    const leftPriority = STATUS_PRIORITY[left.status] ?? 99;
    const rightPriority = STATUS_PRIORITY[right.status] ?? 99;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    if (isActiveStatus(left.status) && isActiveStatus(right.status)) {
      const createdAtDelta = (left.createdAt || 0) - (right.createdAt || 0);
      if (createdAtDelta !== 0) {
        return createdAtDelta;
      }
    } else {
      const updatedAtDelta = (right.updatedAt || 0) - (left.updatedAt || 0);
      if (updatedAtDelta !== 0) {
        return updatedAtDelta;
      }
    }

    const idCompare = String(left.id || "").localeCompare(String(right.id || ""));
    if (idCompare !== 0) {
      return idCompare;
    }

    return (right.updatedAt || 0) - (left.updatedAt || 0);
  });
}

function trimHistory(entries) {
  const activeEntries = entries.filter((entry) => isActiveStatus(entry.status));
  const historicalEntries = entries
    .filter((entry) => !isActiveStatus(entry.status))
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
    .slice(0, MAX_HISTORY_ITEMS);

  return sortDownloads([...activeEntries, ...historicalEntries]);
}

/**
 * Public shape sent to the renderer. `hasRetryPayload` is internal and is
 * exposed as the derived `canRetry` flag.
 */
function toPublicEntry(entry) {
  const { hasRetryPayload, ...publicEntry } = entry;
  return {
    ...publicEntry,
    errorCode: publicEntry.errorCode || "",
    actionUrl: publicEntry.actionUrl || "",
    hostLabel: publicEntry.hostLabel || "",
    canCancel: CANCELLABLE_STATUSES.has(entry.status),
    canRetry: RETRYABLE_STATUSES.has(entry.status) && hasRetryPayload === true,
  };
}

function createDownloadsStore() {
  /** @type {Array<Record<string, any>>} */
  let entries = [];

  const findEntry = (id) => entries.find((entry) => entry.id === id) || null;

  const upsert = (id, patch) => {
    const now = Date.now();
    const existingIndex = entries.findIndex((entry) => entry.id === id);

    if (existingIndex >= 0) {
      entries[existingIndex] = {
        ...entries[existingIndex],
        ...patch,
        updatedAt: now,
      };
    } else {
      entries.push({
        id,
        status: "queued",
        percent: 0,
        totalBytes: 0,
        receivedBytes: 0,
        speedBytesPerSecond: 0,
        errorCode: "",
        actionUrl: "",
        hostLabel: "",
        createdAt: now,
        updatedAt: now,
        ...patch,
      });
    }

    entries = trimHistory(entries);
    const updated = findEntry(id);
    return updated ? toPublicEntry(updated) : null;
  };

  /**
   * Updates coming from an in-flight transfer must not resurrect an entry the
   * user already cancelled.
   */
  const upsertUnlessCancelled = (id, patch) => {
    const existing = findEntry(id);
    if (existing && existing.status === "cancelled") {
      return toPublicEntry(existing);
    }
    return upsert(id, patch);
  };

  const pickDescriptor = (entry) => {
    const descriptor = {};
    for (const key of [
      "title",
      "threadUrl",
      "requestedUrl",
      "sourceHost",
      "sourceLabel",
      "hostLabel",
      "version",
      "creator",
    ]) {
      if (entry[key] !== undefined) {
        descriptor[key] = entry[key] || "";
      }
    }
    if (entry.hasRetryPayload !== undefined) {
      descriptor.hasRetryPayload = Boolean(entry.hasRetryPayload);
    }
    return descriptor;
  };

  return {
    queue(entry) {
      return upsert(entry.id, {
        title: entry.title || "F95 download",
        status: "queued",
        threadUrl: entry.threadUrl || "",
        requestedUrl: entry.requestedUrl || "",
        sourceHost: entry.sourceHost || "",
        sourceLabel: entry.sourceLabel || "",
        hostLabel: entry.hostLabel || "",
        version: entry.version || "",
        creator: entry.creator || "",
        text: entry.text || `Queued ${entry.title || "download"}`,
        speedBytesPerSecond: 0,
        ...(entry.hasRetryPayload !== undefined
          ? { hasRetryPayload: Boolean(entry.hasRetryPayload) }
          : {}),
        ...CLEARED_ERROR_FIELDS,
      });
    },
    resolving(entry) {
      return upsert(entry.id, {
        ...pickDescriptor(entry),
        title: entry.title || findEntry(entry.id)?.title || "F95 download",
        status: "resolving",
        text: entry.text || `Resolving ${entry.hostLabel || "mirror"} link`,
        fileName: entry.fileName || "",
        percent: 0,
        totalBytes: 0,
        receivedBytes: 0,
        speedBytesPerSecond: 0,
        ...CLEARED_ERROR_FIELDS,
      });
    },
    status(id, patch) {
      const existing = findEntry(id);
      if (!existing || !isActiveStatus(existing.status)) {
        return existing ? toPublicEntry(existing) : null;
      }
      return upsert(id, patch);
    },
    /**
     * The mirror needs the user in the browser (captcha, Cloudflare check).
     * The entry stays active and cancellable; `actionUrl` lets the UI reopen
     * the page. Ignored for cancelled or unknown entries.
     */
    awaitingAction(id, patch = {}) {
      const existing = findEntry(id);
      if (!existing) {
        return null;
      }
      if (existing.status === "cancelled") {
        return toPublicEntry(existing);
      }
      return upsert(id, {
        status: "action",
        speedBytesPerSecond: 0,
        error: "",
        errorCode: "",
        actionUrl: patch.actionUrl || existing.actionUrl || "",
        text:
          patch.text ||
          `Finish the step in the browser window for ${existing.hostLabel || "this mirror"}`,
        ...(patch.hostLabel ? { hostLabel: patch.hostLabel } : {}),
      });
    },
    start(entry) {
      return upsertUnlessCancelled(entry.id, {
        ...pickDescriptor(entry),
        status: "downloading",
        fileName: entry.fileName || "",
        text: entry.text || `Downloading ${entry.title || "download"}`,
        totalBytes: entry.totalBytes || 0,
        receivedBytes: entry.receivedBytes || 0,
        percent: entry.percent || 0,
        speedBytesPerSecond: entry.speedBytesPerSecond || 0,
        ...CLEARED_ERROR_FIELDS,
      });
    },
    progress(id, patch) {
      return upsertUnlessCancelled(id, {
        status: "downloading",
        ...patch,
      });
    },
    installing(id, patch) {
      return upsertUnlessCancelled(id, {
        status: "installing",
        speedBytesPerSecond: 0,
        ...patch,
      });
    },
    complete(id, patch) {
      return upsert(id, {
        status: "completed",
        percent: 100,
        speedBytesPerSecond: 0,
        ...CLEARED_ERROR_FIELDS,
        ...patch,
      });
    },
    fail(id, patch) {
      return upsertUnlessCancelled(id, {
        status: "error",
        speedBytesPerSecond: 0,
        errorCode: "",
        actionUrl: "",
        ...patch,
      });
    },
    cancel(id, patch = {}) {
      const existing = findEntry(id);
      return upsert(id, {
        status: "cancelled",
        speedBytesPerSecond: 0,
        text: `Cancelled ${existing?.title || patch.title || "download"}`,
        ...CLEARED_ERROR_FIELDS,
        ...patch,
      });
    },
    get(id) {
      const entry = findEntry(id);
      return entry ? toPublicEntry(entry) : null;
    },
    remove(id) {
      const before = entries.length;
      entries = entries.filter((entry) => entry.id !== id);
      return entries.length !== before;
    },
    /**
     * Drop completed / failed / cancelled entries and keep active ones.
     * @returns {string[]} ids of removed entries
     */
    clearHistory() {
      const removedIds = entries
        .filter((entry) => HISTORY_STATUSES.has(entry.status))
        .map((entry) => entry.id);
      entries = entries.filter((entry) => !HISTORY_STATUSES.has(entry.status));
      return removedIds;
    },
    list() {
      return sortDownloads(entries).map(toPublicEntry);
    },
    ids() {
      return entries.map((entry) => entry.id);
    },
    activeCount() {
      return entries.filter((entry) => isActiveStatus(entry.status)).length;
    },
  };
}

module.exports = {
  ACTIVE_STATUSES,
  CANCELLABLE_STATUSES,
  MAX_HISTORY_ITEMS,
  createDownloadsStore,
  isActiveStatus,
};
