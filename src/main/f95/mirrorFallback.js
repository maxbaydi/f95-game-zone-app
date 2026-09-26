const { getErrorMessage } = require("../errorMessage");

const MAX_FALLBACK_LINKS = 3;

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isF95MaskedUrl(value) {
  try {
    const parsedUrl = new URL(String(value || ""));
    return (
      /(^|\.)f95zone\.to$/i.test(parsedUrl.hostname) &&
      parsedUrl.pathname.includes("/masked/")
    );
  } catch {
    return false;
  }
}

function isMirrorActionError(error) {
  return (
    error?.name === "MirrorActionRequiredError" ||
    error?.code === "captcha_required" ||
    error?.code === "mirror_action_required"
  );
}

function normalizeMirrorCandidate(input) {
  const url = String(input?.url || "").trim();
  if (!isHttpUrl(url)) {
    return null;
  }

  return {
    url,
    label: String(input?.label || ""),
    host: String(input?.host || ""),
    variantId: String(input?.variantId || ""),
  };
}

/**
 * Builds the ordered, de-duplicated list of mirrors to try: the chosen one
 * first, then up to MAX_FALLBACK_LINKS alternatives of the same build.
 */
function buildMirrorCandidates(primary, fallbackLinks) {
  const candidates = [];
  const seenUrls = new Set();
  const push = (input) => {
    const candidate = normalizeMirrorCandidate(input);
    if (!candidate || seenUrls.has(candidate.url)) {
      return;
    }
    seenUrls.add(candidate.url);
    candidates.push(candidate);
  };

  push(primary);
  if (candidates.length === 0) {
    return candidates;
  }

  for (const fallbackLink of Array.isArray(fallbackLinks)
    ? fallbackLinks
    : []) {
    if (candidates.length > MAX_FALLBACK_LINKS) {
      break;
    }
    push(fallbackLink);
  }

  return candidates;
}

/**
 * Tries each mirror until one resolves to a downloadable URL. A captcha on an
 * F95 masked link gates every masked mirror, so it stops the chain; other
 * host-specific checks are remembered and the next mirror is tried.
 *
 * @param {{
 *   candidates: Array<{ url: string, host: string, label: string, variantId?: string }>,
 *   prepare: (url: string) => Promise<any>,
 *   onAttempt?: (attempt: Record<string, any>) => void,
 *   shouldStop?: (error: unknown) => boolean,
 * }} options
 */
async function resolveMirrorWithFallback({
  candidates,
  prepare,
  onAttempt,
  shouldStop,
}) {
  const attempts = [];
  const total = candidates.length;
  let actionFailure = null;
  let lastError = null;

  for (let index = 0; index < total; index += 1) {
    const candidate = candidates[index];
    onAttempt?.({ phase: "trying", index, total, candidate });

    try {
      const prepared = await prepare(candidate.url);
      attempts.push({
        url: candidate.url,
        host: candidate.host,
        label: candidate.label,
        ok: true,
      });
      onAttempt?.({ phase: "resolved", index, total, candidate });
      return {
        prepared,
        candidate,
        attempts,
        actionFailure: null,
        lastError: null,
        stopped: false,
      };
    } catch (error) {
      // Cancellation ends the whole chain; it is not a mirror failure.
      if (shouldStop?.(error)) {
        return {
          prepared: null,
          candidate: null,
          attempts,
          actionFailure: null,
          lastError: error,
          stopped: true,
        };
      }

      const actionRequired = isMirrorActionError(error);
      const message = getErrorMessage(error, "Mirror did not return a file.");
      attempts.push({
        url: candidate.url,
        host: candidate.host,
        label: candidate.label,
        ok: false,
        actionRequired,
        error: message,
      });
      onAttempt?.({
        phase: "failed",
        index,
        total,
        candidate,
        actionRequired,
        error: message,
      });
      lastError = error;

      if (actionRequired) {
        actionFailure = actionFailure || { error, candidate };
        if (
          error?.code === "captcha_required" &&
          isF95MaskedUrl(error?.actionUrl || candidate.url)
        ) {
          break;
        }
      }
    }
  }

  return {
    prepared: null,
    candidate: null,
    attempts,
    actionFailure,
    lastError,
    stopped: false,
  };
}

module.exports = {
  MAX_FALLBACK_LINKS,
  buildMirrorCandidates,
  isF95MaskedUrl,
  isMirrorActionError,
  resolveMirrorWithFallback,
};
