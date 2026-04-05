(function attachLibrarySort(globalScope) {
  const LIBRARY_SORT_MODES = {
    INSTALLED_NEWEST: "installedNewest",
    INSTALLED_OLDEST: "installedOldest",
    TITLE_ASC: "titleAsc",
    TITLE_DESC: "titleDesc",
    ENGINE: "engine",
    STATUS: "status",
  };

  const LIBRARY_SORT_OPTIONS = [
    {
      value: LIBRARY_SORT_MODES.INSTALLED_NEWEST,
      label: "Newest installed",
      description: "Recently installed games first.",
    },
    {
      value: LIBRARY_SORT_MODES.INSTALLED_OLDEST,
      label: "Oldest installed",
      description: "Earliest installs first. Games without install history stay last.",
    },
    {
      value: LIBRARY_SORT_MODES.TITLE_ASC,
      label: "Title (A-Z)",
      description: "Alphabetical by title, A to Z.",
    },
    {
      value: LIBRARY_SORT_MODES.TITLE_DESC,
      label: "Title (Z-A)",
      description: "Alphabetical by title, Z to A.",
    },
    {
      value: LIBRARY_SORT_MODES.ENGINE,
      label: "Engine (A-Z)",
      description: "Alphabetical by engine. Unknown engines stay last.",
    },
    {
      value: LIBRARY_SORT_MODES.STATUS,
      label: "Status (In dev first)",
      description:
        "Orders games by status: In development, On hold, Completed, Abandoned, then other statuses.",
    },
  ];

  const STATUS_GROUPS = {
    IN_DEVELOPMENT: "inDevelopment",
    ON_HOLD: "onHold",
    COMPLETED: "completed",
    ABANDONED: "abandoned",
    OTHER: "other",
  };

  const STATUS_GROUP_RANK = {
    [STATUS_GROUPS.IN_DEVELOPMENT]: 0,
    [STATUS_GROUPS.ON_HOLD]: 1,
    [STATUS_GROUPS.COMPLETED]: 2,
    [STATUS_GROUPS.ABANDONED]: 3,
    [STATUS_GROUPS.OTHER]: 4,
  };

  function getDisplayTitle(game) {
    return String(game?.displayTitle || game?.title || "Unknown");
  }

  function normalizeSortText(value, fallback = "Unknown") {
    const normalizedValue = String(value || "")
      .replace(/\s+/g, " ")
      .trim();

    return normalizedValue || fallback;
  }

  function compareText(left, right) {
    return left.localeCompare(right, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  }

  function getInstalledAtTimestamp(game) {
    const versions = Array.isArray(game?.versions) ? game.versions : [];
    let latestTimestamp = 0;

    for (const version of versions) {
      const candidateValue = Number(version?.date_added) || 0;
      if (candidateValue > latestTimestamp) {
        latestTimestamp = candidateValue;
      }
    }

    return latestTimestamp;
  }

  function normalizeLibraryStatus(statusValue) {
    const normalizedValue = normalizeSortText(statusValue, "").toLowerCase();

    if (
      !normalizedValue ||
      normalizedValue === "ongoing" ||
      normalizedValue === "in development" ||
      normalizedValue === "indev" ||
      normalizedValue === "in-development" ||
      normalizedValue === "development" ||
      normalizedValue === "wip"
    ) {
      return STATUS_GROUPS.IN_DEVELOPMENT;
    }

    if (
      normalizedValue === "onhold" ||
      normalizedValue === "on hold" ||
      normalizedValue === "paused" ||
      normalizedValue === "hiatus"
    ) {
      return STATUS_GROUPS.ON_HOLD;
    }

    if (
      normalizedValue === "completed" ||
      normalizedValue === "complete" ||
      normalizedValue === "finished"
    ) {
      return STATUS_GROUPS.COMPLETED;
    }

    if (normalizedValue === "abandoned" || normalizedValue === "cancelled") {
      return STATUS_GROUPS.ABANDONED;
    }

    return STATUS_GROUPS.OTHER;
  }

  function getStatusSortLabel(game) {
    const statusGroup = normalizeLibraryStatus(game?.status);
    if (statusGroup === STATUS_GROUPS.IN_DEVELOPMENT) {
      return "In development";
    }

    return normalizeSortText(game?.status, "Other");
  }

  function getLibrarySortDescription(sortMode) {
    const option = LIBRARY_SORT_OPTIONS.find((entry) => entry.value === sortMode);
    return option?.description || "Recently installed games first.";
  }

  function sortLibraryGames(games, sortMode = LIBRARY_SORT_MODES.INSTALLED_NEWEST) {
    const normalizedSortMode = Object.values(LIBRARY_SORT_MODES).includes(sortMode)
      ? sortMode
      : LIBRARY_SORT_MODES.INSTALLED_NEWEST;

    const gamesWithMeta = [...games].map((game, index) => ({
      game,
      index,
      displayTitle: normalizeSortText(getDisplayTitle(game)),
      engine: normalizeSortText(game?.engine, "Unknown"),
      statusGroup: normalizeLibraryStatus(game?.status),
      statusLabel: getStatusSortLabel(game),
      installedAt: getInstalledAtTimestamp(game),
    }));

    gamesWithMeta.sort((left, right) => {
      if (normalizedSortMode === LIBRARY_SORT_MODES.INSTALLED_NEWEST) {
        const installedDelta = right.installedAt - left.installedAt;
        if (installedDelta !== 0) {
          return installedDelta;
        }
      } else if (normalizedSortMode === LIBRARY_SORT_MODES.INSTALLED_OLDEST) {
        const missingLeft = left.installedAt <= 0;
        const missingRight = right.installedAt <= 0;
        if (missingLeft !== missingRight) {
          return missingLeft ? 1 : -1;
        }

        const installedDelta = left.installedAt - right.installedAt;
        if (installedDelta !== 0) {
          return installedDelta;
        }
      } else if (normalizedSortMode === LIBRARY_SORT_MODES.TITLE_ASC) {
        const titleDelta = compareText(left.displayTitle, right.displayTitle);
        if (titleDelta !== 0) {
          return titleDelta;
        }
      } else if (normalizedSortMode === LIBRARY_SORT_MODES.TITLE_DESC) {
        const titleDelta = compareText(right.displayTitle, left.displayTitle);
        if (titleDelta !== 0) {
          return titleDelta;
        }
      } else if (normalizedSortMode === LIBRARY_SORT_MODES.ENGINE) {
        const unknownLeft = left.engine === "Unknown";
        const unknownRight = right.engine === "Unknown";
        if (unknownLeft !== unknownRight) {
          return unknownLeft ? 1 : -1;
        }

        const engineDelta = compareText(left.engine, right.engine);
        if (engineDelta !== 0) {
          return engineDelta;
        }
      } else if (normalizedSortMode === LIBRARY_SORT_MODES.STATUS) {
        const statusRankDelta =
          (STATUS_GROUP_RANK[left.statusGroup] ?? 99) -
          (STATUS_GROUP_RANK[right.statusGroup] ?? 99);
        if (statusRankDelta !== 0) {
          return statusRankDelta;
        }

        const statusLabelDelta = compareText(left.statusLabel, right.statusLabel);
        if (statusLabelDelta !== 0) {
          return statusLabelDelta;
        }
      }

      const fallbackTitleDelta = compareText(left.displayTitle, right.displayTitle);
      if (fallbackTitleDelta !== 0) {
        return fallbackTitleDelta;
      }

      return left.index - right.index;
    });

    return gamesWithMeta.map((entry) => entry.game);
  }

  const api = {
    LIBRARY_SORT_MODES,
    LIBRARY_SORT_OPTIONS,
    STATUS_GROUPS,
    getInstalledAtTimestamp,
    getLibrarySortDescription,
    getStatusSortLabel,
    normalizeLibraryStatus,
    sortLibraryGames,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.librarySortUtils = api;
  }
})(globalThis);
