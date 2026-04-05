const DEFAULT_PREVIEW_LIMIT = "20";
const MAX_PREVIEW_LIMIT = 20;

function resolvePreviewDownloadCount(previewLimit, availableScreensCount) {
  const availableCount = Math.max(0, Number(availableScreensCount) || 0);
  if (availableCount === 0) {
    return 0;
  }

  const requestedCount = Number.parseInt(String(previewLimit ?? DEFAULT_PREVIEW_LIMIT), 10);
  const normalizedCount = Number.isFinite(requestedCount)
    ? requestedCount
    : MAX_PREVIEW_LIMIT;

  return Math.min(Math.max(normalizedCount, 0), MAX_PREVIEW_LIMIT, availableCount);
}

module.exports = {
  DEFAULT_PREVIEW_LIMIT,
  MAX_PREVIEW_LIMIT,
  resolvePreviewDownloadCount,
};
