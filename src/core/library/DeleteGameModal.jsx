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
      ? "Remove From Library"
      : mode === DeleteGameModes.DELETE_FILES_AND_SAVES
        ? "Delete Everything"
        : "Delete Files";
  const primaryActionClass =
    mode === DeleteGameModes.DELETE_FILES_AND_SAVES
      ? "bg-red-600 text-white hover:bg-red-500"
      : "bg-accent text-black hover:bg-selected";

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
            Choose how much the app should remove from this PC.
          </div>
        </div>

        <div className="grid max-h-[58vh] gap-6 overflow-y-auto px-6 py-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.9fr)]">
          <div className="space-y-4">
            <DeleteModeCard
              title="Remove from library only"
              description="Hide this game from F95 Game Zone App but keep the installed files and all saves exactly where they are."
              detail="No files are deleted"
              selected={mode === DeleteGameModes.LIBRARY_ONLY}
              onClick={() => onSelectMode(DeleteGameModes.LIBRARY_ONLY)}
            />
            <DeleteModeCard
              title="Delete installed files, keep my saves"
              description="Remove the installed game folders and keep a local backup of detected saves so the game can be restored later."
              detail="Recommended for safe cleanup"
              selected={mode === DeleteGameModes.DELETE_FILES_KEEP_SAVES}
              onClick={() =>
                onSelectMode(DeleteGameModes.DELETE_FILES_KEEP_SAVES)
              }
            />
            <DeleteModeCard
              title="Delete everything"
              description="Remove the game from F95 Game Zone App, delete installed files, wipe detected saves, and clear local backup copies."
              detail="Use only when you want a full local wipe"
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
                What the app found
              </div>
              <div className="mt-3 grid gap-3 text-sm text-text/80">
                <div className="rounded-xl border border-border/70 bg-black/20 px-3 py-3">
                  <div className="font-medium text-text">
                    {installFolders.length} install{" "}
                    {installFolders.length === 1 ? "folder" : "folders"}
                  </div>
                  <div className="mt-1 text-xs text-text/58">
                    The app will delete these only if you choose a file removal
                    option.
                  </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-black/20 px-3 py-3">
                  <div className="font-medium text-text">
                    {profiles.length} detected save{" "}
                    {profiles.length === 1 ? "location" : "locations"}
                  </div>
                  <div className="mt-1 text-xs text-text/58">
                    Full cleanup removes detected saves. The safe option keeps
                    them.
                  </div>
                </div>
              </div>
            </div>

            {installFolders.length > 0 && (
              <div className="rounded-2xl border border-border bg-white/5 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-text/55">
                  Installed Folders
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
                  Detected Save Folders
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
              ? "Installed files stay on disk."
              : mode === DeleteGameModes.DELETE_FILES_AND_SAVES
                ? "Detected saves and local backup copies will be removed."
                : "Detected saves are preserved before installed files are removed."}
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
                ? "Removing..."
                : isLoading
                  ? "Loading..."
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
