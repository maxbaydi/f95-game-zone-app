/**
 * F95 download page links (`/dl/<post>/?u&k&r&t`) expire a few hours after
 * the game page was opened. A retry or a queued download may run later than
 * that, so an expired link is swapped for the same mirror's fresh link: the
 * thread is read again and the link with the same post id and key `k` wins.
 */
const { parseF95DownloadPageLink } = require("./hosts/f95");

function linkIdentity(url) {
  const parsed = parseF95DownloadPageLink(String(url || ""));
  return parsed ? `${parsed.postId}:${parsed.key}` : "";
}

/**
 * @param {string} staleUrl
 * @param {Array<{url?: string}>} links links of a fresh thread inspection
 * @returns {string} the fresh URL, or "" when the thread has no such link
 */
function findFreshF95DownloadLink(staleUrl, links) {
  const identity = linkIdentity(staleUrl);
  if (!identity) {
    return "";
  }
  const match = (Array.isArray(links) ? links : []).find(
    (link) => linkIdentity(link?.url) === identity,
  );
  return match ? String(match.url) : "";
}

/**
 * Reads the thread at most once (per download run) when a link expired.
 * @param {{threadUrl: string, inspectThread: (threadUrl: string) => Promise<any>}} input
 */
function createF95LinkRefresher({ threadUrl, inspectThread }) {
  let pendingLinks = null;
  const loadLinks = () => {
    if (!pendingLinks) {
      pendingLinks = Promise.resolve()
        .then(() => inspectThread(threadUrl))
        .then((payload) => (Array.isArray(payload?.links) ? payload.links : []))
        .catch((error) => {
          console.warn("[f95.download] Could not re-read the thread for fresh links:", error);
          return [];
        });
    }
    return pendingLinks;
  };

  return {
    /** @param {string} staleUrl */
    async freshUrlFor(staleUrl) {
      if (!threadUrl || !linkIdentity(staleUrl)) {
        return "";
      }
      return findFreshF95DownloadLink(staleUrl, await loadLinks());
    },
  };
}

/**
 * `prepare(url)`, and once more with the fresh link if F95 says it expired.
 * @template T
 * @param {string} url
 * @param {(url: string) => Promise<T>} prepare
 * @param {ReturnType<typeof createF95LinkRefresher> | null} refresher
 * @param {(staleUrl: string, freshUrl: string) => void} [onRefreshed]
 * @returns {Promise<T>}
 */
async function prepareWithFreshF95Link(url, prepare, refresher, onRefreshed) {
  try {
    return await prepare(url);
  } catch (error) {
    if (error?.code !== "link_expired" || !refresher) {
      throw error;
    }
    const freshUrl = await refresher.freshUrlFor(url);
    if (!freshUrl || freshUrl === url) {
      throw error;
    }
    onRefreshed?.(url, freshUrl);
    return prepare(freshUrl);
  }
}

module.exports = {
  createF95LinkRefresher,
  findFreshF95DownloadLink,
  prepareWithFreshF95Link,
};
