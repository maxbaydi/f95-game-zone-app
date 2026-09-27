const useCatalogLinkModalLayer = (isOpen, props, options) =>
  window.AtlasMotion?.useModalLayer
    ? window.AtlasMotion.useModalLayer(isOpen, props, options)
    : { isMounted: Boolean(isOpen), state: "open", props, dialogRef: null };

const CATALOG_LINK_SEARCH_DELAY_MS = 350;
const CATALOG_LINK_MAX_RESULTS = 40;

const catalogLinkCreatorHint = (value) => {
  const creator = String(value || "").trim();
  return creator && !/^unknown$/i.test(creator) ? creator : "";
};

const catalogLinkInitialQuery = (game) => {
  const title = game?.title || game?.displayTitle || "";
  return window.libraryInstallState?.buildCatalogSearchTitle
    ? window.libraryInstallState.buildCatalogSearchTitle(title)
    : String(title).trim();
};

/**
 * "Link to catalog…": search the game catalog for a library entry that was
 * added without a confident match and attach the right entry to it (thread,
 * banner, updates, proper name).
 */
const CatalogLinkModal = (liveProps) => {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState([]);
  const [status, setStatus] = React.useState("idle");
  const [error, setError] = React.useState("");
  const [linkingId, setLinkingId] = React.useState(null);
  const searchSequenceRef = React.useRef(0);
  const inputRef = React.useRef(null);
  const layer = useCatalogLinkModalLayer(liveProps.isOpen, liveProps, {
    onClose: () => {
      if (!linkingId) {
        liveProps.onClose?.();
      }
    },
  });
  const game = liveProps.game;
  const recordId = game?.record_id;

  React.useEffect(() => {
    if (!liveProps.isOpen) {
      return;
    }
    searchSequenceRef.current += 1;
    setQuery(catalogLinkInitialQuery(game));
    setResults([]);
    setStatus("idle");
    setError("");
    setLinkingId(null);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
    // Reset only when the dialog opens (or switches to another game).
  }, [liveProps.isOpen, recordId]);

  const runSearch = React.useCallback(
    async (text) => {
      const trimmed = String(text || "").trim();
      const sequence = ++searchSequenceRef.current;
      if (trimmed.length < 2) {
        setResults([]);
        setStatus("idle");
        return;
      }

      setStatus("searching");
      setError("");
      try {
        const rows = await window.electronAPI.searchAtlas(
          trimmed,
          catalogLinkCreatorHint(game?.creator),
        );
        if (sequence !== searchSequenceRef.current) {
          return;
        }
        setResults(
          (Array.isArray(rows) ? rows : [])
            .filter((row) => row && row.atlas_id)
            .slice(0, CATALOG_LINK_MAX_RESULTS),
        );
        setStatus("done");
      } catch (searchError) {
        console.error("[library.catalog] Catalog search failed:", searchError);
        if (sequence !== searchSequenceRef.current) {
          return;
        }
        setResults([]);
        setStatus("error");
        setError("The catalog could not be searched. Try again.");
      }
    },
    [game?.creator],
  );

  React.useEffect(() => {
    if (!liveProps.isOpen) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void runSearch(query);
    }, CATALOG_LINK_SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query, liveProps.isOpen, runSearch]);

  if (!layer.isMounted) {
    return null;
  }

  const { onClose, onLinked } = layer.props;
  const displayTitle = game?.displayTitle || game?.title || "this game";

  const linkEntry = async (row) => {
    if (!recordId || linkingId) {
      return;
    }
    setLinkingId(row.atlas_id);
    setError("");
    try {
      const result = await window.electronAPI.linkGameToCatalog({
        recordId,
        atlasId: Number(row.atlas_id),
      });
      if (!result?.success) {
        setError(
          result?.error ||
            "This game could not be linked to the catalog entry. Try again.",
        );
        setLinkingId(null);
        return;
      }

      window.AtlasUI?.toast?.success(
        result.f95Id
          ? "Banner, screenshots and update checks will follow shortly."
          : "This catalog entry has no F95 thread, so updates can't be checked.",
        { title: `Linked to ${row.title || "the catalog"}` },
      );
      setLinkingId(null);
      onLinked?.(result.game || null);
      onClose?.();
    } catch (linkError) {
      console.error("[library.catalog] Linking failed:", linkError);
      setError("This game could not be linked to the catalog entry. Try again.");
      setLinkingId(null);
    }
  };

  return (
    <div
      className="atlas-overlay fixed inset-0 z-[1700] flex items-center justify-center bg-black/65 px-6 py-10 backdrop-blur-md"
      data-state={layer.state}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !linkingId) {
          onClose?.();
        }
      }}
    >
      <div
        ref={layer.dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Link to catalog"
        className="atlas-dialog flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-primary/95 shadow-2xl outline-none"
        data-state={layer.state}
      >
        <div className="relative border-b border-border px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(linkingId)}
            className="group absolute right-4 top-4 flex h-8 w-8 items-center justify-center border border-border bg-white/5 text-text transition hover:bg-white/10 disabled:opacity-40"
            aria-label="Close"
            title="Close (Esc)"
          >
            <span className="material-symbols-outlined text-[18px] leading-none transition-transform duration-500 group-hover:rotate-90">
              close
            </span>
          </button>
          <div className="text-[11px] uppercase tracking-[0.22em] text-accent/80">
            Link to catalog
          </div>
          <div className="mt-2 truncate pr-10 text-2xl font-semibold text-text">
            {displayTitle}
          </div>
          <div className="mt-2 text-sm text-text/65">
            Pick the matching game. Its name, banner, screenshots and update
            checks are attached to this library entry. Your files and saves
            stay as they are.
          </div>
        </div>

        <form
          className="flex items-center gap-2 border-b border-border px-6 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch(query);
          }}
        >
          <label className="flex min-w-0 flex-1 items-center gap-2 border border-border bg-black/25 px-3 py-2 focus-within:border-accent/60">
            <span className="material-symbols-outlined text-[18px] leading-none text-text/55" aria-hidden>
              search
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Game name"
              aria-label="Search the catalog"
              className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text/35"
            />
          </label>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 border border-accent/60 bg-accent px-3 py-2 text-xs font-semibold text-onAccent transition hover:brightness-110"
          >
            Search
          </button>
        </form>

        <div className="min-h-[180px] flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div
              key={error}
              className="atlas-shake mb-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100"
              role="alert"
            >
              {error}
            </div>
          )}

          {status === "searching" ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-text/65">
              <span className="atlas-spinner atlas-keep-motion text-accent" aria-hidden />
              Searching the catalog…
            </div>
          ) : status === "idle" ? (
            <div className="py-10 text-center text-sm text-text/55">
              Type at least two letters of the game's name.
            </div>
          ) : status === "done" && results.length === 0 ? (
            <div className="py-10 text-center text-sm text-text/60">
              Nothing found. Try a shorter name or the name used on F95.
            </div>
          ) : (
            <ul className="space-y-2" aria-label="Catalog results">
              {results.map((row, index) => {
                const isLinking = linkingId === row.atlas_id;
                return (
                  <li
                    key={row.atlas_id}
                    className="atlas-list-enter flex items-center gap-3 border border-border/70 bg-canvas/40 px-3 py-2.5 transition-colors hover:border-accent/40"
                    style={{ "--atlas-index": Math.min(index, 12) }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-text">
                        {row.title || "Untitled"}
                      </div>
                      <div className="truncate text-xs text-text/60">
                        {[row.creator, row.engine].filter(Boolean).join(" · ") ||
                          "Unknown creator"}
                        {" · "}
                        {row.f95_id ? `Thread #${row.f95_id}` : "No F95 thread"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => linkEntry(row)}
                      disabled={Boolean(linkingId)}
                      className="inline-flex shrink-0 items-center gap-1.5 border border-accent/60 bg-accent/85 px-3 py-1.5 text-xs font-semibold text-onAccent transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isLinking ? (
                        <span className="atlas-spinner atlas-keep-motion text-[11px]" aria-hidden />
                      ) : (
                        <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden>
                          link
                        </span>
                      )}
                      {isLinking ? "Linking…" : "Link"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

window.CatalogLinkModal = CatalogLinkModal;
