// @ts-check

const GAME_REMOVAL_MODES = Object.freeze({
  LIBRARY_ONLY: "library_only",
  DELETE_FILES_KEEP_SAVES: "delete_files_keep_saves",
  DELETE_FILES_AND_SAVES: "delete_files_and_saves",
});

const GAME_REMOVAL_MODE_VALUES = Object.freeze(
  Object.values(GAME_REMOVAL_MODES),
);

function isValidGameRemovalMode(value) {
  const normalizedValue = String(value || "");
  return GAME_REMOVAL_MODE_VALUES.some((mode) => mode === normalizedValue);
}

function normalizeGameRemovalRequest(payload) {
  const recordId = Number(payload?.recordId);
  const mode = String(payload?.mode || "");

  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Invalid game id for removal.");
  }

  if (!isValidGameRemovalMode(mode)) {
    throw new Error("Invalid game removal mode.");
  }

  return {
    recordId,
    mode,
  };
}

module.exports = {
  GAME_REMOVAL_MODES,
  GAME_REMOVAL_MODE_VALUES,
  isValidGameRemovalMode,
  normalizeGameRemovalRequest,
};
