(function attachLibraryInstallState(globalScope) {
  /**
   * Install state of a library record on this PC.
   *
   * - `installed`: at least one recorded install folder exists on disk
   * - `missing`: install folders are recorded but none of them exists any more
   * - `not_installed`: the record is a library stub (linked thread, no files)
   */
  const LIBRARY_INSTALL_STATES = Object.freeze({
    INSTALLED: "installed",
    MISSING: "missing",
    NOT_INSTALLED: "not_installed",
  });

  const LIBRARY_INSTALL_FILTERS = Object.freeze({
    ALL: "all",
    INSTALLED: "installed",
    MISSING: "missing",
    NOT_INSTALLED: "not_installed",
  });

  const LIBRARY_INSTALL_FILTER_OPTIONS = Object.freeze([
    {
      value: LIBRARY_INSTALL_FILTERS.ALL,
      label: "All games",
      description: "Everything in your library.",
    },
    {
      value: LIBRARY_INSTALL_FILTERS.INSTALLED,
      label: "Installed on this PC",
      description: "Games whose files are present and can be played.",
    },
    {
      value: LIBRARY_INSTALL_FILTERS.MISSING,
      label: "Files missing",
      description:
        "Games that were installed here, but their folder is gone (deleted, moved or on a disconnected drive).",
    },
    {
      value: LIBRARY_INSTALL_FILTERS.NOT_INSTALLED,
      label: "Not installed",
      description: "Games linked to your library that were never installed on this PC.",
    },
  ]);

  const STATE_LABELS = Object.freeze({
    [LIBRARY_INSTALL_STATES.INSTALLED]: "Installed",
    [LIBRARY_INSTALL_STATES.MISSING]: "Files missing",
    [LIBRARY_INSTALL_STATES.NOT_INSTALLED]: "Not installed",
  });

  /** @type {Set<string>} */
  const KNOWN_STATES = new Set(Object.values(LIBRARY_INSTALL_STATES));

  /**
   * @param {any} game
   * @returns {string}
   */
  function getLibraryInstallState(game) {
    if (!game || typeof game !== "object") {
      return LIBRARY_INSTALL_STATES.NOT_INSTALLED;
    }

    const explicitState = String(game.installState || "").trim();
    if (KNOWN_STATES.has(explicitState)) {
      return explicitState;
    }

    const versions = Array.isArray(game.versions) ? game.versions : [];
    if (versions.length === 0) {
      return LIBRARY_INSTALL_STATES.NOT_INSTALLED;
    }

    // Versions that were never checked against the disk count as present.
    const hasPresentVersion = versions.some(
      (version) => version && version.isPresent !== false,
    );

    return hasPresentVersion
      ? LIBRARY_INSTALL_STATES.INSTALLED
      : LIBRARY_INSTALL_STATES.MISSING;
  }

  /**
   * @param {any} game
   * @param {string} filter
   * @returns {boolean}
   */
  function matchesLibraryInstallFilter(game, filter) {
    const normalizedFilter = String(filter || "").trim();
    if (!normalizedFilter || normalizedFilter === LIBRARY_INSTALL_FILTERS.ALL) {
      return true;
    }

    if (!KNOWN_STATES.has(normalizedFilter)) {
      return true;
    }

    return getLibraryInstallState(game) === normalizedFilter;
  }

  /**
   * @param {any} game
   * @returns {string}
   */
  function describeLibraryInstallState(game) {
    return STATE_LABELS[getLibraryInstallState(game)] || STATE_LABELS.not_installed;
  }

  /**
   * @param {any[]} games
   * @returns {{ installed: number, missing: number, not_installed: number }}
   */
  function countLibraryInstallStates(games) {
    const counts = {
      [LIBRARY_INSTALL_STATES.INSTALLED]: 0,
      [LIBRARY_INSTALL_STATES.MISSING]: 0,
      [LIBRARY_INSTALL_STATES.NOT_INSTALLED]: 0,
    };

    for (const game of Array.isArray(games) ? games : []) {
      if (!game || typeof game !== "object") {
        continue;
      }
      counts[getLibraryInstallState(game)] += 1;
    }

    return counts;
  }

  const api = {
    LIBRARY_INSTALL_STATES,
    LIBRARY_INSTALL_FILTERS,
    LIBRARY_INSTALL_FILTER_OPTIONS,
    getLibraryInstallState,
    matchesLibraryInstallFilter,
    describeLibraryInstallState,
    countLibraryInstallStates,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.libraryInstallState = api;
  }
})(globalThis);
