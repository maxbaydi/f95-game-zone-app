(function attachGameTags(globalScope) {
  /** Full, ordered list of catalog tags, without empty or duplicate chips. */
  function splitGameTags(value) {
    const entries = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];
    const seen = new Set();
    return entries.flatMap((entry) => {
      if (typeof entry !== "string") return [];
      const tag = entry.trim();
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) return [];
      seen.add(key);
      return [tag];
    });
  }

  function matchesGameTags(value, selected, logic = "AND") {
    const needles = splitGameTags(selected).map((tag) => tag.toLowerCase());
    if (!needles.length) return true;
    const tags = new Set(splitGameTags(value).map((tag) => tag.toLowerCase()));
    return String(logic).toUpperCase() === "OR"
      ? needles.some((tag) => tags.has(tag))
      : needles.every((tag) => tags.has(tag));
  }

  function filterLibraryGamesByTags(games, selected, logic = "AND") {
    if (!splitGameTags(selected).length) return games;
    return games.filter((game) =>
      matchesGameTags(game.f95_tags || game.tags, selected, logic),
    );
  }

  const api = { splitGameTags, matchesGameTags, filterLibraryGamesByTags };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.gameTags = api;
})(globalThis);
