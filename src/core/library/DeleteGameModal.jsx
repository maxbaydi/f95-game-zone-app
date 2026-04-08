const DeleteGameModes = Object.freeze({
  LIBRARY_ONLY: "library_only",
  DELETE_FILES_KEEP_SAVES: "delete_files_keep_saves",
  DELETE_FILES_AND_SAVES: "delete_files_and_saves",
});

const DeleteModeCard = ({
  title,
  description,
  detail,
  tone = "neutral",
  selected,
  onClick,
}) => {
  const toneClass =
    tone === "danger"
      ? selected
        ? "border-red-400/60 bg-red-500/15 shadow-[0_0_0_1px_rgba(248,113,113,0.18)]"
        : "border-red-500/25 bg-red-500/8 hover:bg-red-500/12"
      : selected
        ? "border-accent/55 bg-accent/12 shadow-glow-accent"
        : "border-border bg-white/5 hover:bg-white/10";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border px-4 py-4 text-left transition ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text">{title}</div>
          <div className="mt-1 text-sm leading-6 text-text/72">
            {description}
          </div>
          <div className="mt-2 text-xs uppercase tracking-[0.16em] text-text/48">
            {detail}
          </div>
        </div>
        <div
          className={`mt-0.5 shrink-0 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${
            selected
              ? "border-accent/40 bg-accent/15 text-text"
              : "border-border bg-black/20 text-text/65"
          }`}
        >
          {selected ? "Selected" : "Choose"}
        </div>
      </div>
    </button>
  );
};

const DeleteGameModal = ({
  isOpen,
  game,
  installPaths,
  saveProfiles,
  mode,
  isLoading,
  isDeleting,
  error,
  onSelectMode,
  onConfirm,
  onClose,
}) => {
  if (!isOpen) {
    return null;
  }

  const displayTitle = game?.displayTitle || game?.title || "Selected game";
  const installFolders = Array.isArray(installPaths) ? installPaths : [];
  const profiles = Array.isArray(saveProfiles) ? saveProfiles : [];
  const primaryActionLabel =
    mode === DeleteGameModes.LIBRARY_ONLY
      ? "Remove from Library"
      : mode === DeleteGameModes.DELETE_FILES_AND_SAVES
        ? "Delete Game and Saves"
        : "Delete Game Files";
  const primaryActionClass =
    mode === DeleteGameModes.DELETE_FILES_AND_SAVES
      ? "bg-red-600 text-white hover:bg-red-500"
      : "bg-accent text-onAccent hover:brightness-110";

  return (
    <div className="fixed inset-0 z-[1750] flex items-center justify-center bg-black/70 px-6 py-10 backdrop-blur-md">
      <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-3xl border border-border bg-primary/95 shadow-2xl">
        <div className="border-b border-border px-6 py-5">
          <div className="text-[11px] uppercase tracking-[0.22em] text-red-200/75">
            Remove Game
          </div>
          <div className="mt-2 text-2xl font-semibold text-text">
            {displayTitle}
          </div>
          <div className="mt-2 text-sm text-text/65">
            Choose what you want removed from this PC.
          </div>
        </div>

        <div className="grid max-h-[58vh] gap-6 overflow-y-auto px-6 py-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.9fr)]">
          <div className="space-y-4">
            <DeleteModeCard
              title="Just remove it from my library"
              description="The game disappears from your library list, but the game files and your progress stay on this PC."
              detail="Nothing on this PC is deleted"
              selected={mode === DeleteGameModes.LIBRARY_ONLY}
              onClick={() => onSelectMode(DeleteGameModes.LIBRARY_ONLY)}
            />
            <DeleteModeCard
              title="Delete the game, keep my progress"
              description="The game files are removed from this PC, but your progress is kept so you can come back later."
              detail="Best if you want to free up space"
              selected={mode === DeleteGameModes.DELETE_FILES_KEEP_SAVES}
              onClick={() =>
                onSelectMode(DeleteGameModes.DELETE_FILES_KEEP_SAVES)
              }
            />
            <DeleteModeCard
              title="Delete the game and start over"
              description="The game is removed from your library, the game files are deleted, and the saves we found on this PC are erased too."
              detail="Use this only if you want everything gone"
              tone="danger"
              selected={mode === DeleteGameModes.DELETE_FILES_AND_SAVES}
              onClick={() =>
                onSelectMode(DeleteGameModes.DELETE_FILES_AND_SAVES)
              }
            />
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-white/5 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-text/55">
                What will be affected
              </div>
              <div className="mt-3 grid gap-3 text-sm text-text/80">
                <div className="rounded-xl border border-border/70 bg-black/20 px-3 py-3">
                  <div className="font-medium text-text">
                    {installFolders.length} install{" "}
                    {installFolders.length === 1 ? "folder" : "folders"}
                  </div>
                  <div className="mt-1 text-xs text-text/58">
                    These are only removed if you choose an option that deletes
                    game files.
                  </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-black/20 px-3 py-3">
                  <div className="font-medium text-text">
                    {profiles.length} detected save{" "}
                    {profiles.length === 1 ? "location" : "locations"}
                  </div>
                  <div className="mt-1 text-xs text-text/58">
                    If you keep your progress, these stay safe. Full cleanup
                    removes them.
                  </div>
                </div>
              </div>
            </div>

            {installFolders.length > 0 && (
              <div className="rounded-2xl border border-border bg-white/5 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-text/55">
                  Game Folders
                </div>
                <div className="mt-3 max-h-[160px] space-y-2 overflow-y-auto">
                  {installFolders.map((folderPath) => (
                    <div
                      key={folderPath}
                      className="rounded-xl border border-border/60 bg-black/20 px-3 py-2 text-xs text-text/70"
                    >
                      {folderPath}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {profiles.length > 0 && (
              <div className="rounded-2xl border border-border bg-white/5 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-text/55">
                  Save Folders We Found
                </div>
                <div className="mt-3 max-h-[160px] space-y-2 overflow-y-auto">
                  {profiles.map((profile) => (
                    <div
                      key={`${profile.rootPath}-${profile.strategy?.type || "profile"}`}
                      className="rounded-xl border border-border/60 bg-black/20 px-3 py-2 text-xs text-text/70"
                    >
                      {profile.rootPath}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <div className="text-xs text-text/55">
            {mode === DeleteGameModes.LIBRARY_ONLY
              ? "Your game files and progress will stay on this PC."
              : mode === DeleteGameModes.DELETE_FILES_AND_SAVES
                ? "Your game files, saves, and local backup copies will be removed."
                : "Your game files will be removed, but your progress will be kept."}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting || isLoading}
              className="rounded-lg border border-border bg-white/5 px-4 py-2 text-sm text-text transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isDeleting || isLoading}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${primaryActionClass}`}
            >
              {isDeleting
                ? "Working..."
                : isLoading
                  ? "Checking..."
                  : primaryActionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

window.DeleteGameModes = DeleteGameModes;
window.DeleteGameModal = DeleteGameModal;
