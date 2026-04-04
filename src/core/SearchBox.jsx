const SearchBox = ({
  value,
  onChange,
  onAction,
  onFocus,
  placeholder = "Search Atlas",
  isSearchActive = false,
}) => {
  return (
    <div className="flex w-full justify-center">
      <div
        className={`relative mt-5 flex h-11 w-[min(420px,calc(100vw-200px))] items-center rounded-2xl border bg-black/25 shadow-glass-sm backdrop-blur-xl transition-all duration-200 ${
          isSearchActive
            ? "border-accent/60 ring-2 ring-accent/25 shadow-glow-accent"
            : "border-white/10 hover:border-accent/40 hover:shadow-glass"
        }`}
      >
        <i className="fas fa-search flex h-11 w-10 items-center justify-center pl-3 text-text/70"></i>
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onFocus={onFocus}
          onChange={(event) => onChange?.(event.target.value)}
          className="[-webkit-app-region:no-drag] flex-1 bg-transparent px-2 text-text outline-none placeholder:text-text/45 focus:outline-none"
        />
        <button
          type="button"
          onClick={onAction}
          title="Open advanced search"
          className={`[-webkit-app-region:no-drag] flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-r-2xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            isSearchActive
              ? "text-accent"
              : "text-text/80 hover:bg-white/10 hover:text-highlight"
          }`}
        >
          <i className="fas fa-sliders"></i>
        </button>
      </div>
    </div>
  );
};

window.SearchBox = SearchBox;
