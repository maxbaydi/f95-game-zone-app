const { useState, useEffect, useMemo } = window.React;

const buildSidebarFilterState = (filters = {}) => ({
  type: filters.type || "title",
  category: Array.isArray(filters.category) ? filters.category : [],
  engine: Array.isArray(filters.engine) ? filters.engine : [],
  status: Array.isArray(filters.status) ? filters.status : [],
  censored: Array.isArray(filters.censored) ? filters.censored : [],
  language: Array.isArray(filters.language) ? filters.language : [],
  tags: Array.isArray(filters.tags) ? filters.tags : [],
  sort: filters.sort || "name",
  dateLimit: Number(filters.dateLimit) || 0,
  tagLogic: filters.tagLogic || "AND",
  updateAvailable: Boolean(filters.updateAvailable),
});

const SearchSidebar = ({
  isVisible,
  onFilterChange,
  onClose,
  filters,
  layout = "overlay",
  defaultFilters,
  showUpdateFilter = true,
}) => {
  const [filter, setFilter] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [highlightedTagIndex, setHighlightedTagIndex] = useState(-1);
  const [selectedFilters, setSelectedFilters] = useState(
    buildSidebarFilterState(filters || defaultFilters),
  );
  const [options, setOptions] = useState({
    categories: [],
    engines: [],
    statuses: [],
    censored: [],
    languages: [],
    tags: [],
  });

  useEffect(() => {
    window.electronAPI
      .getUniqueFilterOptions()
      .then((data) => setOptions(data))
      .catch((err) => console.error("Failed to load filter options:", err));
  }, []);

  useEffect(() => {
    setFilter(filters?.text || "");
    setSelectedFilters(buildSidebarFilterState(filters || defaultFilters));
  }, [defaultFilters, filters]);

  const currentFilters = useMemo(
    () => ({
      text: filter,
      ...selectedFilters,
    }),
    [filter, selectedFilters],
  );

  useEffect(() => {
    onFilterChange(currentFilters);
  }, [currentFilters, onFilterChange]);

  const handleCheckbox = (group, value) => {
    setSelectedFilters((prev) => {
      let newVals = [...prev[group]];
      if (newVals.includes(value)) {
        newVals = newVals.filter((v) => v !== value);
      } else {
        if (group === "tags" && newVals.length >= 10) {
          alert("Max 10 tags allowed.");
          return prev;
        }
        newVals.push(value);
      }
      return { ...prev, [group]: newVals };
    });
  };

  const sortedTags = useMemo(
    () =>
      [...options.tags].sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
      ),
    [options.tags],
  );

  const filteredTags = sortedTags.filter((tag) =>
    tag.toLowerCase().includes(tagSearch.toLowerCase()),
  );

  useEffect(() => {
    setHighlightedTagIndex(-1);
  }, [tagSearch]);

  const isDocked = layout === "docked";

  if (!isVisible) return null;

  return (
    <div
      className={`overflow-hidden [-webkit-app-region:no-drag] ${
        isDocked
          ? "atlas-glass-subtle w-[320px] shrink-0 border-r border-white/10"
          : "fixed bottom-[48px] right-0 top-[70px] w-[320px] border border-accent/40 shadow-glass backdrop-blur-xl"
      }`}
      style={
        isDocked
          ? undefined
          : {
              margin: "10px 10px 50px 10px",
              borderRadius: "8px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
              height: "calc(100% - 70px - 60px)",
              top: "70px",
              bottom: "auto",
            }
      }
    >
      {/* Fixed-height sticky header */}
      <div className="sticky top-0 z-10 flex h-[60px] items-center justify-between border-b border-white/10 bg-black/25 px-4 backdrop-blur-md">
        <div>
          <span className="text-lg font-bold">
            <i className="fas fa-filter mr-2"></i>Filters
          </span>
          {isDocked && (
            <div className="text-[11px] uppercase tracking-[0.18em] opacity-55">
              Search workspace
            </div>
          )}
        </div>
        <div className="flex space-x-3">
          <button
            onClick={() => {
              setSelectedFilters(buildSidebarFilterState(defaultFilters));
              setTagSearch("");
              setFilter(defaultFilters?.text || "");
            }}
            className="text-text hover:text-accent text-sm flex items-center"
          >
            <i className="fas fa-undo-alt mr-1"></i> Reset
          </button>
          {!isDocked && (
            <button
              onClick={onClose}
              className="text-text hover:text-accent text-sm flex items-center"
            >
              <i className="fas fa-times mr-1"></i> Close
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="h-[calc(100%-60px)] overflow-y-auto p-4">
        {/* Search Input */}
        <div className="mb-6">
          <div className="flex items-center rounded-xl border border-white/10 bg-black/20 backdrop-blur-sm">
            <i className="fas fa-search w-6 h-6 text-text pl-3 flex items-center justify-center"></i>
            <input
              type="text"
              placeholder="Search the library"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-transparent outline-none text-text flex-1 px-3 py-2 focus:outline-none -webkit-app-region-no-drag"
            />
          </div>
        </div>

        {/* Search Scope */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Search Scope</h4>
          <div className="flex flex-wrap gap-2">
            {[
              { value: "title", label: "Title" },
              { value: "creator", label: "Creator" },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  setSelectedFilters((prev) => ({
                    ...prev,
                    type: option.value,
                  }))
                }
                className={`px-3 py-1 rounded text-sm ${
                  selectedFilters.type === option.value
                    ? "bg-accent text-white"
                    : "bg-tertiary hover:bg-highlight"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Category</h4>
          <div className="flex flex-wrap gap-2">
            {options.categories.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCheckbox("category", cat)}
                className={`px-3 py-1 rounded text-sm ${
                  selectedFilters.category.includes(cat)
                    ? "bg-accent text-white"
                    : "bg-tertiary hover:bg-highlight"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Sorting */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Sorting</h4>
          <div className="flex flex-wrap gap-2">
            {[
              { value: "name", label: "Name" },
              { value: "date", label: "Release" },
              { value: "likes", label: "Likes" },
              { value: "views", label: "Views" },
              { value: "rating", label: "Rating" },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  setSelectedFilters((prev) => ({
                    ...prev,
                    sort: option.value,
                  }))
                }
                className={`px-3 py-1 rounded text-sm ${
                  selectedFilters.sort === option.value
                    ? "bg-accent text-white"
                    : "bg-tertiary hover:bg-highlight"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Release Window */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Release Window</h4>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 0, label: "Any time" },
              { value: 30, label: "30 days" },
              { value: 90, label: "90 days" },
              { value: 365, label: "1 year" },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  setSelectedFilters((prev) => ({
                    ...prev,
                    dateLimit: option.value,
                  }))
                }
                className={`px-3 py-1 rounded text-sm ${
                  selectedFilters.dateLimit === option.value
                    ? "bg-accent text-white"
                    : "bg-tertiary hover:bg-highlight"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3 flex justify-between items-center">
            Tags (Max 10)
            <span className="text-sm font-normal text-gray-400">
              {selectedFilters.tagLogic}
            </span>
          </h4>
          <div className="flex gap-4 mb-3">
            <button
              onClick={() =>
                setSelectedFilters((prev) => ({ ...prev, tagLogic: "AND" }))
              }
              className={`px-4 py-1 rounded text-sm ${
                selectedFilters.tagLogic === "AND"
                  ? "bg-accent text-white"
                  : "bg-tertiary hover:bg-highlight"
              }`}
            >
              AND
            </button>
            <button
              onClick={() =>
                setSelectedFilters((prev) => ({ ...prev, tagLogic: "OR" }))
              }
              className={`px-4 py-1 rounded text-sm ${
                selectedFilters.tagLogic === "OR"
                  ? "bg-accent text-white"
                  : "bg-tertiary hover:bg-highlight"
              }`}
            >
              OR
            </button>
          </div>
          <input
            type="text"
            placeholder="Search tags... (↑↓ highlight, Enter select)"
            value={tagSearch}
            onChange={(e) => setTagSearch(e.target.value)}
            onKeyDown={(e) => {
              if (filteredTags.length === 0) return;

              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlightedTagIndex((prev) =>
                  prev < filteredTags.length - 1 ? prev + 1 : 0,
                );
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlightedTagIndex((prev) =>
                  prev > 0 ? prev - 1 : filteredTags.length - 1,
                );
              } else if (e.key === "Enter" && highlightedTagIndex >= 0) {
                e.preventDefault();
                const selectedTag = filteredTags[highlightedTagIndex];
                handleCheckbox("tags", selectedTag);
                setTagSearch("");
                setHighlightedTagIndex(-1);
              }
            }}
            className="w-full p-2 bg-tertiary border border-border rounded mb-3 text-sm -webkit-app-region-no-drag"
          />
          <div className="flex flex-wrap gap-2 mb-3">
            {selectedFilters.tags.map((tag) => (
              <span
                key={tag}
                className="bg-accent px-3 py-1 rounded text-sm flex items-center"
              >
                {tag}
                <button
                  onClick={() => handleCheckbox("tags", tag)}
                  className="ml-2 text-white text-xs"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="max-h-40 overflow-y-auto border border-border p-2 rounded bg-tertiary">
            {filteredTags.length === 0 ? (
              <p className="text-sm text-gray-500">No tags found</p>
            ) : (
              filteredTags.map((tag, index) => (
                <label
                  key={tag}
                  className={`flex items-center space-x-2 py-1 text-sm block px-1 rounded cursor-pointer ${
                    index === highlightedTagIndex
                      ? "bg-accent text-white"
                      : "hover:bg-highlight"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedFilters.tags.includes(tag)}
                    onChange={() => handleCheckbox("tags", tag)}
                    disabled={
                      selectedFilters.tags.length >= 10 &&
                      !selectedFilters.tags.includes(tag)
                    }
                    className="-webkit-app-region-no-drag"
                  />
                  <span>{tag}</span>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Engine */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Engine</h4>
          <div className="max-h-40 overflow-y-auto border border-border p-2 rounded bg-tertiary">
            {options.engines.length === 0 ? (
              <p className="text-sm text-gray-500">No engines found</p>
            ) : (
              options.engines.map((engine) => (
                <label
                  key={engine}
                  className="flex items-center space-x-2 py-1 text-sm block hover:bg-highlight px-1 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedFilters.engine.includes(engine)}
                    onChange={() => handleCheckbox("engine", engine)}
                    className="-webkit-app-region-no-drag"
                  />
                  <span>{engine}</span>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Status */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Status</h4>
          <div className="max-h-40 overflow-y-auto border border-border p-2 rounded bg-tertiary">
            {options.statuses.length === 0 ? (
              <p className="text-sm text-gray-500">No statuses found</p>
            ) : (
              options.statuses.map((status) => (
                <label
                  key={status}
                  className="flex items-center space-x-2 py-1 text-sm block hover:bg-highlight px-1 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedFilters.status.includes(status)}
                    onChange={() => handleCheckbox("status", status)}
                    className="-webkit-app-region-no-drag"
                  />
                  <span>{status}</span>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Language */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Language</h4>
          <div className="max-h-40 overflow-y-auto border border-border p-2 rounded bg-tertiary">
            {options.languages.length === 0 ? (
              <p className="text-sm text-gray-500">No languages found</p>
            ) : (
              options.languages.map((language) => (
                <label
                  key={language}
                  className="flex items-center space-x-2 py-1 text-sm block hover:bg-highlight px-1 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedFilters.language.includes(language)}
                    onChange={() => handleCheckbox("language", language)}
                    className="-webkit-app-region-no-drag"
                  />
                  <span>{language}</span>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Censored */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Censorship</h4>
          <div className="max-h-40 overflow-y-auto border border-border p-2 rounded bg-tertiary">
            {options.censored.length === 0 ? (
              <p className="text-sm text-gray-500">No censorship flags found</p>
            ) : (
              options.censored.map((value) => (
                <label
                  key={value}
                  className="flex items-center space-x-2 py-1 text-sm block hover:bg-highlight px-1 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedFilters.censored.includes(value)}
                    onChange={() => handleCheckbox("censored", value)}
                    className="-webkit-app-region-no-drag"
                  />
                  <span>{value}</span>
                </label>
              ))
            )}
          </div>
        </div>

        {showUpdateFilter && (
          <div className="mb-4">
            <label className="flex items-center space-x-2 text-sm">
              <input
                type="checkbox"
                checked={selectedFilters.updateAvailable || false}
                onChange={() =>
                  setSelectedFilters((prev) => ({
                    ...prev,
                    updateAvailable: !prev.updateAvailable,
                  }))
                }
                className="-webkit-app-region-no-drag"
              />
              <span>Show only games with updates available</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
};

window.SearchSidebar = SearchSidebar;
