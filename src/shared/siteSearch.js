const splitDelimitedText = (value) => {
  if (!value || typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeSiteSearchFilters = (filters = {}) => ({
  text: typeof filters.text === "string" ? filters.text.trim() : "",
  type: filters.type === "creator" ? "creator" : "title",
  category: Array.isArray(filters.category) ? filters.category : [],
  engine: Array.isArray(filters.engine) ? filters.engine : [],
  status: Array.isArray(filters.status) ? filters.status : [],
  censored: Array.isArray(filters.censored) ? filters.censored : [],
  language: Array.isArray(filters.language) ? filters.language : [],
  tags: Array.isArray(filters.tags) ? filters.tags : [],
  sort: ["name", "date", "likes", "views", "rating"].includes(filters.sort)
    ? filters.sort
    : "date",
  dateLimit: Math.max(0, Number(filters.dateLimit) || 0),
  tagLogic: filters.tagLogic === "OR" ? "OR" : "AND",
});

const toComparableNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const normalized = String(value)
    .replace(/,/g, "")
    .match(/-?\d+(\.\d+)?/);
  return normalized ? Number(normalized[0]) : 0;
};

const toComparableDate = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (!value) {
    return 0;
  }

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return asNumber;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
};

const sortSiteCatalogEntries = (entries, sortMode = "date") => {
  const sortedEntries = [...entries];

  sortedEntries.sort((left, right) => {
    if (sortMode === "likes") {
      return toComparableNumber(right.likes) - toComparableNumber(left.likes);
    }

    if (sortMode === "views") {
      return toComparableNumber(right.views) - toComparableNumber(left.views);
    }

    if (sortMode === "rating") {
      return toComparableNumber(right.rating) - toComparableNumber(left.rating);
    }

    if (sortMode === "name") {
      return (left.title || "").localeCompare(right.title || "");
    }

    return (
      toComparableDate(right.releaseDate || right.threadPublishDate) -
      toComparableDate(left.releaseDate || left.threadPublishDate)
    );
  });

  return sortedEntries;
};

const filterSiteCatalogEntries = (entries, filters = {}) => {
  const normalizedFilters = normalizeSiteSearchFilters(filters);
  let result = entries.filter((entry) => entry.siteUrl || entry.f95Id);

  if (normalizedFilters.text) {
    const needle = normalizedFilters.text.toLowerCase();
    result = result.filter((entry) =>
      normalizedFilters.type === "creator"
        ? (entry.creator || "").toLowerCase().includes(needle)
        : (entry.title || "").toLowerCase().includes(needle),
    );
  }

  if (normalizedFilters.category.length > 0) {
    result = result.filter((entry) =>
      normalizedFilters.category.includes(entry.category),
    );
  }

  if (normalizedFilters.engine.length > 0) {
    result = result.filter((entry) =>
      normalizedFilters.engine.includes(entry.engine),
    );
  }

  if (normalizedFilters.status.length > 0) {
    result = result.filter((entry) =>
      normalizedFilters.status.includes(entry.status),
    );
  }

  if (normalizedFilters.censored.length > 0) {
    result = result.filter((entry) =>
      normalizedFilters.censored.includes(entry.censored),
    );
  }

  if (normalizedFilters.language.length > 0) {
    result = result.filter((entry) => {
      const languages = splitDelimitedText(entry.language);
      return normalizedFilters.language.some((language) =>
        languages.includes(language),
      );
    });
  }

  if (normalizedFilters.tags.length > 0) {
    result = result.filter((entry) => {
      const tags = splitDelimitedText(entry.tags);
      if (normalizedFilters.tagLogic === "AND") {
        return normalizedFilters.tags.every((tag) => tags.includes(tag));
      }

      return normalizedFilters.tags.some((tag) => tags.includes(tag));
    });
  }

  if (normalizedFilters.dateLimit > 0) {
    const cutoff = Date.now() / 1000 - normalizedFilters.dateLimit * 86400;
    result = result.filter(
      (entry) =>
        toComparableDate(entry.releaseDate || entry.threadPublishDate) >=
        cutoff,
    );
  }

  return sortSiteCatalogEntries(result, normalizedFilters.sort);
};

module.exports = {
  splitDelimitedText,
  normalizeSiteSearchFilters,
  toComparableNumber,
  toComparableDate,
  sortSiteCatalogEntries,
  filterSiteCatalogEntries,
};
