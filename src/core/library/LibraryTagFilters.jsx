const LibraryTagFilters = ({
  isOpen,
  selectedTags,
  tagLogic,
  onTagsChange,
  onLogicChange,
  onOpen,
  onClose,
}) => {
  const [query, setQuery] = React.useState("");
  const [siteTags, setSiteTags] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [request, setRequest] = React.useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = React.useState(false);
  const [activeSuggestion, setActiveSuggestion] = React.useState(0);
  const inputRef = React.useRef(null);
  const activeOptionRef = React.useRef(null);
  const suggestionsId = React.useId();
  const { splitGameTags } = window.gameTags;

  React.useEffect(() => {
    if (!isOpen) return undefined;
    let alive = true;
    setIsLoading(true);
    setError("");
    window.electronAPI
      .getUniqueFilterOptions()
      .then((options) => {
        if (!alive) return;
        const available = splitGameTags(options?.tags);
        setSiteTags(available);
        const allowed = new Set(available.map((tag) => tag.toLowerCase()));
        onTagsChange((previous) =>
          previous.filter((tag) => allowed.has(tag.toLowerCase())),
        );
      })
      .catch(() => {
        if (alive) setError("Could not load game tags. Please try again.");
      })
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isOpen, request]);

  const tags = React.useMemo(
    () => splitGameTags([...siteTags]).sort((a, b) => a.localeCompare(b)),
    [siteTags],
  );
  const selectedKeys = new Set(selectedTags.map((tag) => tag.toLowerCase()));
  const toggle = (tag) =>
    onTagsChange(
      selectedKeys.has(tag.toLowerCase())
        ? selectedTags.filter(
            (item) => item.toLowerCase() !== tag.toLowerCase(),
          )
        : [...selectedTags, tag],
    );
  const visibleTags = tags.filter((tag) =>
    tag.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const suggestions = visibleTags.filter(
    (tag) => !selectedKeys.has(tag.toLowerCase()),
  );
  const showSuggestions = isOpen && suggestionsOpen && Boolean(query.trim());
  const activeIndex = Math.min(activeSuggestion, suggestions.length - 1);

  React.useEffect(() => {
    if (!isOpen) {
      setSuggestionsOpen(false);
      setQuery("");
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (showSuggestions)
      activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, showSuggestions]);

  const selectSuggestion = (tag) => {
    onTagsChange((previous) => splitGameTags([...previous, tag]));
    setQuery("");
    setSuggestionsOpen(false);
    setActiveSuggestion(0);
    inputRef.current?.focus();
  };

  const handleSearchKeyDown = (event) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && suggestionsOpen) {
      event.preventDefault();
      event.stopPropagation();
      setSuggestionsOpen(false);
    } else if (["ArrowDown", "ArrowUp"].includes(event.key) && query.trim()) {
      event.preventDefault();
      event.stopPropagation();
      setSuggestionsOpen(true);
      setActiveSuggestion((previous) => {
        if (!showSuggestions)
          return event.key === "ArrowDown"
            ? 0
            : Math.max(0, suggestions.length - 1);
        if (!suggestions.length) return 0;
        return (
          (previous +
            (event.key === "ArrowDown" ? 1 : -1) +
            suggestions.length) %
          suggestions.length
        );
      });
    } else if (
      event.key === "Enter" &&
      showSuggestions &&
      suggestions[activeIndex]
    ) {
      event.preventDefault();
      event.stopPropagation();
      selectSuggestion(suggestions[activeIndex]);
    }
  };

  if (!isOpen && selectedTags.length === 0) return null;
  return (
    <section
      aria-label="Library tag filters"
      className="relative z-20 shrink-0 space-y-3 border-b border-border bg-primary/50 px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          aria-label="Tag search controls"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-3"
        >
          <h3 className="text-sm font-semibold">
            Tags{selectedTags.length ? ` (${selectedTags.length})` : ""}
          </h3>
          <div
            role="group"
            aria-label="Match selected tags"
            className="flex gap-1"
          >
            {[
              { value: "AND", label: "All tags (AND)" },
              { value: "OR", label: "Any tag (OR)" },
            ].map((mode) => (
              <button
                type="button"
                key={mode.value}
                aria-pressed={tagLogic === mode.value}
                onClick={() => onLogicChange(mode.value)}
                className={`border px-2.5 py-1.5 text-xs ${tagLogic === mode.value ? "border-accent bg-accent/20 text-text" : "border-border text-text/65 hover:bg-white/10"}`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          {isOpen && (
            <div className="relative min-w-[180px] max-w-[320px] flex-1">
              <input
                ref={inputRef}
                type="search"
                role="combobox"
                aria-label="Find a tag"
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
                aria-controls={showSuggestions ? suggestionsId : undefined}
                aria-activedescendant={
                  showSuggestions && activeIndex >= 0
                    ? `${suggestionsId}-${activeIndex}`
                    : undefined
                }
                placeholder="Find a tag…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveSuggestion(0);
                  setSuggestionsOpen(true);
                }}
                onFocus={() => setSuggestionsOpen(true)}
                onBlur={() => setSuggestionsOpen(false)}
                onKeyDown={handleSearchKeyDown}
                className="w-full border border-border bg-black/25 px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
              />
              {showSuggestions && (
                <div
                  id={suggestionsId}
                  role="listbox"
                  aria-label="Tag suggestions"
                  className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[192px] overflow-y-auto overscroll-contain border border-border bg-primary py-1 shadow-glass-sm"
                >
                  {suggestions.length ? (
                    suggestions.map((tag, index) => (
                      <div
                        id={`${suggestionsId}-${index}`}
                        key={tag}
                        role="option"
                        aria-selected={index === activeIndex}
                        ref={index === activeIndex ? activeOptionRef : null}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveSuggestion(index)}
                        onClick={() => selectSuggestion(tag)}
                        className={`cursor-pointer px-2.5 py-2 text-xs text-text ${index === activeIndex ? "bg-accent/20" : "hover:bg-white/10"}`}
                      >
                        {tag}
                      </div>
                    ))
                  ) : (
                    <div
                      role="status"
                      className="px-2.5 py-2 text-xs text-text/60"
                    >
                      {isLoading ? "Loading tags…" : "No matching tags to add."}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-3 text-xs">
          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={() => onTagsChange([])}
              className="text-accent hover:underline"
            >
              Clear tags
            </button>
          )}
          <button
            type="button"
            onClick={isOpen ? onClose : onOpen}
            className="text-text/65 hover:text-text"
          >
            {isOpen ? "Hide tag picker" : "Choose tags"}
          </button>
        </div>
      </div>
      {selectedTags.length > 0 && (
        <div aria-label="Selected tags" className="flex flex-wrap gap-1.5">
          {selectedTags.map((tag) => (
            <button
              type="button"
              key={tag}
              aria-label={`Remove tag ${tag}`}
              onClick={() => toggle(tag)}
              className="game-tag-chip game-tag-button"
            >
              {tag} <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}
      {isOpen && (
        <>
          {(isLoading || error) && (
            <div className="flex flex-wrap items-center gap-3">
              {isLoading && (
                <span role="status" className="text-xs text-text/55">
                  Loading tags…
                </span>
              )}
              {error && (
                <span role="alert" className="text-xs text-text/65">
                  {error}{" "}
                  <button
                    type="button"
                    onClick={() => setRequest((value) => value + 1)}
                    className="text-accent"
                  >
                    Retry
                  </button>
                </span>
              )}
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-text/65 hover:text-text">
              All tags ({tags.length})
            </summary>
            <div
              aria-label="Available tags"
              className="mt-3 flex max-h-[160px] flex-wrap gap-1.5 overflow-y-auto overscroll-contain"
            >
              {tags.length ? (
                tags.map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    role="checkbox"
                    aria-checked={selectedKeys.has(tag.toLowerCase())}
                    onClick={() => toggle(tag)}
                    className={`game-tag-chip game-tag-button ${selectedKeys.has(tag.toLowerCase()) ? "!border-accent !bg-accent/25" : ""}`}
                  >
                    {tag}
                  </button>
                ))
              ) : (
                <span className="py-1 text-xs text-text/60">
                  No tags available yet. Link a game to the catalog or sign in
                  to F95.
                </span>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
};
window.LibraryTagFilters = LibraryTagFilters;
