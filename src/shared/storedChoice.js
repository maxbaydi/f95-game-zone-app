(function attachStoredChoice(globalScope) {
  /**
   * Remembers a small UI choice (sort order, filter) in a Storage-like object
   * (window.localStorage). Only values from an allow-list are read or written,
   * and a blocked or missing storage never breaks the caller.
   */

  /**
   * @param {unknown} allowedValues
   * @returns {string[]}
   */
  function normalizeAllowedValues(allowedValues) {
    return (Array.isArray(allowedValues) ? allowedValues : [])
      .filter((value) => typeof value === "string" && value !== "")
      .map((value) => String(value));
  }

  /**
   * @param {any} storage
   * @param {string} key
   */
  function removeStoredKey(storage, key) {
    try {
      if (storage && typeof storage.removeItem === "function") {
        storage.removeItem(key);
      }
    } catch {
      /* storage unavailable: nothing to clean up */
    }
  }

  /**
   * @param {any} storage
   * @param {string} key
   * @param {string[]} allowedValues
   * @param {string} fallback
   * @returns {string}
   */
  function readStoredChoice(storage, key, allowedValues, fallback) {
    const allowed = normalizeAllowedValues(allowedValues);
    let stored = null;
    try {
      if (!storage || typeof storage.getItem !== "function") {
        return fallback;
      }
      stored = storage.getItem(key);
    } catch {
      return fallback;
    }

    if (stored === null || stored === undefined) {
      return fallback;
    }

    const value = String(stored);
    if (allowed.includes(value)) {
      return value;
    }

    removeStoredKey(storage, key);
    return fallback;
  }

  /**
   * @param {any} storage
   * @param {string} key
   * @param {string} value
   * @param {string[]} allowedValues
   * @returns {boolean} true when the value was stored
   */
  function writeStoredChoice(storage, key, value, allowedValues) {
    const allowed = normalizeAllowedValues(allowedValues);
    if (!storage) {
      return false;
    }

    if (typeof value !== "string" || !allowed.includes(value)) {
      removeStoredKey(storage, key);
      return false;
    }

    try {
      if (typeof storage.setItem !== "function") {
        return false;
      }
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  const api = {
    readStoredChoice,
    writeStoredChoice,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.storedChoice = api;
  }
})(globalThis);
