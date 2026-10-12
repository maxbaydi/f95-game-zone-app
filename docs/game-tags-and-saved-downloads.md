# Game tags and downloads without unpacking

Library cards reveal the full catalog tag list on hover or keyboard focus.
The panel expands above or below the card according to available space and
does not change the grid layout. Long lists scroll inside the panel. Animation
uses the existing motion settings, including Reduced and Off. The game's
details panel always shows all available tags; there is no 14-tag limit.
Games with no catalog tags do not show an empty hover panel. Clicking a tag
on a library card or in game details adds that tag to the existing library
filters, without changing the current page.

The existing library's search field and **Tags** button form one search flow.
The advanced-search button also opens the inline tag picker. Its first row
contains AND/OR and **Find a tag**, the next row shows selected chips, and
**All tags** sits below them as a disclosure closed by default. Reopening the
picker closes the full list again. Typing opens a dropdown of matching tags
that have not yet been selected; choose by click or Up/Down/Enter. Escape or
an outside click dismisses suggestions. Selecting clears the tag query and
keeps focus ready for the next tag. The full list can be expanded independently
and is not narrowed by the search input. Tags can be removed independently.
**All tags (AND)** requires every selected tag;
**Any tag (OR)** requires at least one. Matching is by whole labels and ignores
case/whitespace. They compose with the existing title/creator search, install
state, sorting, Favorites and Updates views. Cards, result counts and the
titles list update in place. Selected chips remain visible when the picker
is hidden, and each chip can be removed; Clear tags resets only tag selection.
**Find games on F95** opens the existing F95 workspace with the selected tags,
AND/OR mode and library search text (as a title query). It maps labels to the
site's IDs and uses the site's native hash format: `#/cat=games/page=1/tags=ID,ID/tagtype=and|or/search=...`.
Unknown tags stop navigation with a message rather than silently removing filters.
The button remains available for empty text-search results. Opening Search from
the sidebar starts at the normal F95 home page.

The tag picker includes only tags in the website's **Games** category. Names
come from Latest Updates and membership from `latest_data.php?cmd=tags&cat=games`.
The live category response on 2026-10-12 contained 115 IDs; the global dictionary
contained 153 names. Asset and other category tags are excluded, and local tags
cannot expand the certified list. The existing authenticated Electron session
refreshes definitions when missing/older than seven days. Old global caches
refresh even if recent; scoped caches remain usable offline. Without a scoped
cache, only names from cached Games catalog rows are offered. Fetching these
definitions does not crawl catalog pages.

Settings → Library & folders → Downloads → **Keep downloads without unpacking**
controls new downloads. It defaults to off. Turning it on saves the original
package (ZIP, RAR, 7z or a supported standalone installer) instead of installing
the game. The file is not converted to ZIP. A download snapshots this setting
when it starts; changing it does not change an in-progress download or retry.

Saved packages live in `appPaths.archives` (`userData/data/archives`), separate
from the temporary download cache and scanned games. Downloads shows **Archive
saved**, **Install**, and **Folder**. The saved file remains after restarting,
clearing history or automatic history trimming. Install works on a cache copy
and leaves the original file in the archives folder. Existing library versions
and saves are not touched by download-only completion.

## Implementation and contract notes

- Renderer: `GameBanner.js`, `LibraryDetailsPanel.jsx`, `DownloadsPanel.jsx`,
  `LibrarySettings.jsx`, `LibraryTagFilters.jsx`; shared tag normalization and
  pure local-list matching in `shared/gameTags.js`. Renderer only filters its
  existing list; no new search page or database search endpoint is introduced.
- `get-unique-filter-options` additionally returns `tagDefinitions` (ID-to-name
  map restricted to Games). Cached definitions keep optional `gameTagIds` in the
  existing JSON state; no schema migration. `shared/f95SearchUrl.js` builds the
  website address; `F95BrowserWorkspace.initialUrl` defaults to the original home
  page and survives the login/guest recreation flow.
- Main: `f95/savedPackages.js` validates the payload and publishes the complete
  cache file using an exclusive hard link, then removes the cache name. Both
  paths share the userData filesystem. A failure leaves the source available.
  Name collisions get a numbered suffix; no existing archive is replaced.
  HTML error pages and empty files are refused. No archive is extracted here.
- `Library.keepArchives` is an allowlisted boolean in the existing settings IPC.
  `get-app-info.paths.archives` is the saved-download folder used by Open folder.
- Download DTO: `keepArchive` records the request mode; `completionKind` is
  `archive` or `installed`; `savedArchivePath` records the persistent original;
  `packagePath` identifies the file available for explicit installation.
  `canInstallFromPackage` also applies to completed, saved archives.
- Existing `retry-f95-install` accepts completed saved archives and installs a
  copy. No new IPC endpoint, dependency, schema or save model is introduced.
- AND/OR filters operate on the existing, text/view-filtered library list.
  Selected labels are normalized/deduplicated. `get-unique-filter-options` refreshes only
  the cached tag definitions through the existing catalog service.
- Download progress events include `completionKind: archive` for
  saving and completion so every client labels it as saved instead of installed.

The storage rationale is to separate user-kept files from cache cleanup, and
to preserve original packages even when history is forgotten or installation
fails. All new paths are derived from appPaths outside the install directory.

## Manual verification

1. Hover a library card with tags, move onto the tag panel, and leave. Check
   smooth reveal/close, unchanged neighboring card positions, and scrolling
   for a long list. Focus the card with Tab and check the same reveal. Check
   a card near the bottom and Reduced/Off animation settings.
2. Open the game details; check every catalog tag, including entries after 14.
   Click a tag and check the current library filters in place. Add another
   tag, compare AND/OR, remove a chip, choose suggestions by mouse and keyboard,
   check the default-collapsed All tags disclosure and expand/collapse it,
   combine a title
   query and install-state view, then Clear tags. Hide the picker, remove a
   selected chip, and check both cards and titles reflect the same selection.
3. Enable Keep downloads without unpacking and download a small package.
   Check Archive saved, Folder revealing the original file, no extracted game
   folder, and no new installed version. Download the same filename again;
   both original packages must remain.
4. Restart the app; choose Install on the saved entry. Check that normal
   installation succeeds and the original archive is still present.
5. Clear the download history and restart; saved packages must remain in the
   folder accessible from Settings → Library & folders → Downloads.
6. Disable the switch; download another package and check normal automatic
   unpacking/registration. An HTML error page must not count as a saved game.
   Open folder in Settings must remain available with the switch off.
7. Select Games tags, choose AND/OR and a title that has no local result. Click
   Find games on F95; check the website's selected chips, title and results.
   Repeat with the other logic, then use the sidebar Search entry and check the
   normal homepage. Search the picker for `asset-`: no other-category tags.

## Verification evidence

- The live site's dictionary was fetched successfully through the existing
  `persist:f95-auth` session; only tag definitions were retained, no cookie or
  account secrets were exported.
- Browser preview: card click → inline library filters, two-tag AND/OR (1 vs 6 demo matches),
  title composition, and full-motion clicks verified through actual controls.
- Isolated Electron profile + localhost ZIP transfer: actual main finalization,
  real extraction/SQLite registration, restart, explicit Install, cache copy,
  history cleanup, original-byte preservation and switch persistence verified.
  Also checked the 153-tag dictionary through renderer IPC. Local AND/OR list
  filtering and composition are covered by pure tests and browser controls.
  No real games or saves used.
- Follow-up verification: live `cmd=tags&cat=games` response contains 115 IDs.
  Electron UI click → native website hash → both tag chips/title applied and
  actual site's script issues `tags[]=2257&tags[]=330` with `tagtype=or` only
  for OR. The isolated guest used sanitized fixture HTML, the site's freshly
  fetched JavaScript and live API; it did not share the running user profile.
  UI offered 115 tags and no `asset` matches; sidebar navigation reset to home.
  Final `ci:check`: 613/613 tests plus CSS build, lint, JSX and typecheck.
- Compact-picker follow-up: Electron controls verified default-collapsed and
  reopened-collapsed disclosure, 115 Games tags, dropdown mouse/keyboard
  selection, Escape/outside dismissal, no duplicate tags, unchanged local
  AND/OR filtering, row order and a 960×700 window. Screenshots are in
  `output/playwright/tags-collapsed-picker.png` and `tags-search-suggestions.png`.
  CSS build/lint/JSX/typecheck and six targeted tag/search tests pass.
