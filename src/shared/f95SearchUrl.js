// @ts-check
(function attachF95SearchUrl(globalScope) {
  const F95_SEARCH_URL = "https://f95zone.to/sam/latest_alpha/";

  /**
   * Build the website's own Latest Updates hash, using its tag IDs.
   * Unknown local tags must not silently broaden the search.
   * @param {{ tags?: string[], tagLogic?: string, text?: string }} filters
   * @param {Record<string, string>} definitions
   */
  function buildF95SearchUrl(filters = {}, definitions = {}) {
    const idsByName = new Map(
      Object.entries(definitions)
        .filter(
          ([id, name]) => /^[1-9]\d*$/.test(id) && typeof name === "string",
        )
        .map(([id, name]) => [name.trim().toLowerCase(), id]),
    );
    const names = [
      ...new Set(
        (filters.tags || [])
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    const missingTags = names.filter((name) => !idsByName.has(name));
    if (missingTags.length) return { success: false, url: "", missingTags };

    const text = (filters.text || "").trim();
    if (!names.length && !text)
      return { success: true, url: F95_SEARCH_URL, missingTags };
    let hash = "/cat=games/page=1";
    if (names.length) {
      hash += `/tags=${names.map((name) => idsByName.get(name)).join(",")}`;
      hash += `/tagtype=${filters.tagLogic === "OR" ? "or" : "and"}`;
    }
    if (text) hash += `/search=${encodeURIComponent(text)}`;
    return { success: true, url: `${F95_SEARCH_URL}#${hash}`, missingTags };
  }

  const api = { F95_SEARCH_URL, buildF95SearchUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.f95SearchUrl = api;
})(globalThis);
