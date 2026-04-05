(function attachF95CaptchaFlow(globalScope) {
  function normalizeUrlValue(value) {
    return String(value || "").trim();
  }

  function isF95Host(value) {
    try {
      return /(^|\.)f95zone\.to$/i.test(new URL(value).hostname);
    } catch {
      return false;
    }
  }

  function isMaskedF95Url(value) {
    try {
      const parsedUrl = new URL(value);
      return isF95Host(parsedUrl.toString()) && /\/masked\//i.test(parsedUrl.pathname);
    } catch {
      return false;
    }
  }

  function getCaptchaContinuationUrl(actionUrl, currentUrl) {
    const normalizedActionUrl = normalizeUrlValue(actionUrl);
    const normalizedCurrentUrl = normalizeUrlValue(currentUrl);

    if (
      !normalizedActionUrl ||
      !normalizedCurrentUrl ||
      normalizedCurrentUrl === normalizedActionUrl ||
      /^about:/i.test(normalizedCurrentUrl) ||
      isMaskedF95Url(normalizedCurrentUrl)
    ) {
      return "";
    }

    if (isF95Host(normalizedActionUrl) && isF95Host(normalizedCurrentUrl)) {
      return "";
    }

    return normalizedCurrentUrl;
  }

  const api = {
    normalizeUrlValue,
    isF95Host,
    isMaskedF95Url,
    getCaptchaContinuationUrl,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.f95CaptchaFlow = api;
  }
})(globalThis);
