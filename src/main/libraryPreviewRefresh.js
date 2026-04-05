function buildLibraryPreviewRefreshTargets(games) {
  return (Array.isArray(games) ? games : [])
    .map((game) => {
      const recordId = Number(game?.record_id);
      const atlasId = Number(game?.atlas_id);

      if (!Number.isInteger(recordId) || recordId <= 0) {
        return null;
      }

      if (!Number.isInteger(atlasId) || atlasId <= 0) {
        return null;
      }

      const title = String(game?.displayTitle || game?.title || "Unknown Game").trim();
      return {
        recordId,
        atlasId,
        title: title || "Unknown Game",
      };
    })
    .filter(Boolean);
}

function shouldRefreshCachedPreviews({ cachedPreviewCount, remotePreviewCount }) {
  const cachedCount = Number.isFinite(Number(cachedPreviewCount))
    ? Number(cachedPreviewCount)
    : 0;
  const remoteCount = Number.isFinite(Number(remotePreviewCount))
    ? Number(remotePreviewCount)
    : 0;

  return remoteCount > 0 && cachedCount < remoteCount;
}

module.exports = {
  buildLibraryPreviewRefreshTargets,
  shouldRefreshCachedPreviews,
};
