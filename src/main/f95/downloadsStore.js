const MAX_HISTORY_ITEMS = 40;

function isActiveStatus(status) {
  return status === "queued" || status === "downloading" || status === "installing";
}

function sortDownloads(entries) {
  const statusPriority = {
    downloading: 0,
    queued: 1,
    installing: 2,
    error: 3,
    completed: 4,
  };

  return [...entries].sort((left, right) => {
    const leftPriority = statusPriority[left.status] ?? 99;
    const rightPriority = statusPriority[right.status] ?? 99;

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
  const activeEntries = entries.filter(
    (entry) => entry.status === "queued" || entry.status === "downloading",
  );
  const installingEntries = entries.filter((entry) => entry.status === "installing");
  const historicalEntries = entries
    .filter(
      (entry) => !isActiveStatus(entry.status),
    )
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
    .slice(0, MAX_HISTORY_ITEMS);

  return sortDownloads([...activeEntries, ...installingEntries, ...historicalEntries]);
}

function cloneEntry(entry) {
  return { ...entry };
}

function createDownloadsStore() {
  /** @type {Array<Record<string, unknown>>} */
  let entries = [];

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
        createdAt: now,
        updatedAt: now,
        ...patch,
      });
    }

    entries = trimHistory(entries);
    return entries.find((entry) => entry.id === id);
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
        version: entry.version || "",
        creator: entry.creator || "",
        text: entry.text || `Queued ${entry.title || "download"}`,
      });
    },
    start(entry) {
      return upsert(entry.id, {
        status: "downloading",
        fileName: entry.fileName || "",
        text: entry.text || `Downloading ${entry.title || "download"}`,
        totalBytes: entry.totalBytes || 0,
        receivedBytes: entry.receivedBytes || 0,
        percent: entry.percent || 0,
        speedBytesPerSecond: entry.speedBytesPerSecond || 0,
      });
    },
    progress(id, patch) {
      return upsert(id, {
        status: "downloading",
        ...patch,
      });
    },
    installing(id, patch) {
      return upsert(id, {
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
        ...patch,
      });
    },
    fail(id, patch) {
      return upsert(id, {
        status: "error",
        speedBytesPerSecond: 0,
        ...patch,
      });
    },
    list() {
      return sortDownloads(entries).map(cloneEntry);
    },
    activeCount() {
      return entries.filter(
        (entry) => isActiveStatus(entry.status),
      ).length;
    },
  };
}

module.exports = {
  createDownloadsStore,
};
