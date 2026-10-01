const SearchBox = ({
  value,
  onChange,
  onAction,
  onFocus,
  placeholder = "Search library",
  isSearchActive = false,
}) => {
  const inputRef = React.useRef(null);
  const hasValue = Boolean(String(value || "").length);

  // Ctrl/Cmd+F or "/" focuses the search field from anywhere in the window.
  React.useEffect(() => {
    const handleShortcut = (event) => {
      const target = event.target;
      const isTyping =
        target &&
        target.closest &&
        target.closest('input, textarea, select, [contenteditable="true"]');
      const isFindShortcut =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";
      const isSlash = event.key === "/" && !isTyping;
      if (!isFindShortcut && !isSlash) {
        return;
      }
      if (!inputRef.current || isSearchActive) {
        return;
      }
      event.preventDefault();
      inputRef.current.focus();
      inputRef.current.select();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [isSearchActive]);

  const clearValue = () => {
    onChange?.("");
    inputRef.current?.focus();
  };

  return (
    <div className="flex w-full items-center justify-center">
      <div
        className={`group relative flex h-11 w-[min(420px,calc(100vw-200px))] items-center rounded-2xl border bg-black/25 shadow-glass-sm backdrop-blur-xl transition-[border-color,box-shadow,background-color,width] duration-500 focus-within:w-[min(480px,calc(100vw-200px))] focus-within:border-accent/60 focus-within:bg-black/35 focus-within:shadow-glow-accent ${
          isSearchActive
            ? "border-accent/60 ring-2 ring-accent/25 shadow-glow-accent"
            : "border-border hover:border-accent/40 hover:shadow-glass"
        }`}
      >
        <i className="fas fa-search flex h-11 w-10 items-center justify-center pl-3 text-text/70 transition-colors duration-500 group-focus-within:text-accent"></i>
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={value}
          onFocus={onFocus}
          aria-label={placeholder}
          data-escape-local={hasValue ? "" : undefined}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (hasValue) {
                event.preventDefault();
                onChange?.("");
              } else {
                event.currentTarget.blur();
              }
            }
          }}
          onChange={(event) => onChange?.(event.target.value)}
          className="[-webkit-app-region:no-drag] min-w-0 flex-1 bg-transparent px-2 text-text outline-none placeholder:text-text/45 focus:outline-none"
        />
        {hasValue && (
          <button
            type="button"
            onClick={clearValue}
            title="Clear search (Esc)"
            aria-label="Clear search"
            className="app-badge-enter [-webkit-app-region:no-drag] mr-1 flex h-7 w-7 items-center justify-center rounded-full text-text/60 transition hover:bg-white/10 hover:text-text"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">
              close
            </span>
          </button>
        )}
        {!hasValue && !isSearchActive && (
          <kbd className="pointer-events-none mr-1 hidden border border-border/70 px-1.5 py-0.5 font-sans text-[10px] text-text/40 transition-opacity duration-500 group-focus-within:opacity-0 md:block">
            Ctrl F
          </kbd>
        )}
        <button
          type="button"
          onClick={onAction}
          title="Open advanced search"
          aria-label="Open advanced search"
          className={`[-webkit-app-region:no-drag] flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-r-2xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            isSearchActive
              ? "text-accent"
              : "text-text/80 hover:bg-white/10 hover:text-accent"
          }`}
        >
          <i className="fas fa-sliders transition-transform duration-500 group-hover:rotate-90"></i>
        </button>
      </div>
    </div>
  );
};

window.SearchBox = SearchBox;
