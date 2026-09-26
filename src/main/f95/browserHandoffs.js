const DEFAULT_BROWSER_HANDOFF_TTL_MS = 60 * 60 * 1000;

function getThreadKey(threadUrl) {
  const normalized = String(threadUrl || "").trim();
  const threadIdMatch = normalized.match(/\/threads\/(?:[^/?#]*\.)?(\d+)/i);
  if (threadIdMatch) {
    return `f95:${threadIdMatch[1]}`;
  }

  return normalized
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function extractHostname(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^blob:/i, "");
  if (!normalized) {
    return "";
  }

  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    // Bare host names such as "mega.nz" are accepted as well.
    return /^[a-z0-9.-]+$/i.test(normalized) ? normalized.toLowerCase() : "";
  }
}

/**
 * The recognizable part of a host that survives TLD and CDN changes, e.g.
 * "mixdrop" for mixdrop.co / mixdrop.ag and "mega" for mega.nz / mega.co.nz.
 */
function getHostBrand(value) {
  const labels = extractHostname(value).split(".").filter(Boolean);
  if (labels.length < 2) {
    return labels[0] || "";
  }

  const secondLevel = labels[labels.length - 2];
  if (labels.length >= 3 && /^(?:co|com|net|org)$/i.test(secondLevel)) {
    return labels[labels.length - 3];
  }

  return secondLevel;
}

function buildExpectedBrands(hosts) {
  return [
    ...new Set(
      (Array.isArray(hosts) ? hosts : [])
        .map(getHostBrand)
        .filter((brand) => brand && brand !== "f95zone"),
    ),
  ];
}

/**
 * Tracks installs that wait for the user to press "Download" on a mirror page
 * in the F95 browser session. A browser download that no automatic install
 * claimed goes to the newest waiting handoff whose mirror host it came from.
 */
function createBrowserHandoffRegistry(options = {}) {
  const ttlMs =
    Number(options.ttlMs) > 0
      ? Number(options.ttlMs)
      : DEFAULT_BROWSER_HANDOFF_TTL_MS;
  const onExpire =
    typeof options.onExpire === "function" ? options.onExpire : null;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  /** @type {Array<{ context: any, threadKey: string, brands: string[], timer: any }>} */
  let entries = [];

  const releaseEntry = (entry) => {
    clearTimer(entry.timer);
    entries = entries.filter((candidate) => candidate !== entry);
  };

  return {
    /**
     * @param {any} context
     * @param {{ threadUrl?: string, hosts?: string[] }} [target]
     */
    arm(context, target = {}) {
      const entry = {
        context,
        threadKey: getThreadKey(target.threadUrl),
        brands: buildExpectedBrands(target.hosts),
        timer: null,
      };
      entry.timer = setTimer(() => {
        if (!entries.includes(entry)) {
          return;
        }
        releaseEntry(entry);
        onExpire?.(context);
      }, ttlMs);
      entry.timer?.unref?.();
      entries.push(entry);
      return context;
    },
    cancelForThread(threadUrl) {
      const threadKey = getThreadKey(threadUrl);
      if (!threadKey) {
        return [];
      }

      const cancelled = entries.filter(
        (entry) => entry.threadKey === threadKey,
      );
      cancelled.forEach(releaseEntry);
      return cancelled.map((entry) => entry.context);
    },
    /**
     * @param {string[]} observedUrls page and download URLs of a new download
     */
    takeForDownload(observedUrls) {
      const observedBrands = new Set(
        (Array.isArray(observedUrls) ? observedUrls : [])
          .map(getHostBrand)
          .filter(Boolean),
      );

      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (
          entry.brands.length === 0 ||
          entry.brands.some((brand) => observedBrands.has(brand))
        ) {
          releaseEntry(entry);
          return entry.context;
        }
      }

      return null;
    },
    releaseById(id) {
      const entry = entries.find((candidate) => candidate.context?.id === id);
      if (!entry) {
        return null;
      }

      releaseEntry(entry);
      return entry.context;
    },
    release(context) {
      const entry = entries.find((candidate) => candidate.context === context);
      if (!entry) {
        return false;
      }

      releaseEntry(entry);
      return true;
    },
    size() {
      return entries.length;
    },
  };
}

module.exports = {
  DEFAULT_BROWSER_HANDOFF_TTL_MS,
  createBrowserHandoffRegistry,
  getHostBrand,
  getThreadKey,
};
