# Tasks

Last updated: 2026-04-05

## How To Read This File

- `Status`: `done`, `in_progress`, `partial`, `todo`, `blocked`
- `Progress`: rough completion percent for the task itself, not fake precision
- `TЗ coverage`: how much of the original spec this task meaningfully closes
- Update this file after every non-trivial implementation slice

## Overall TЗ Snapshot

| Area                             | Status      | Progress | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ----------- | -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage 0. Fork + writable storage | in_progress |      86% | Core code, checks and migration-safe storage are in place. Manual Electron smoke and packaged smoke are still pending.                                                                                                                                                                                                                                                                                                                                                                                                |
| Stage 1. Local core              | in_progress |      99% | `scan_sources`, `scan_jobs`, multi-source importer scan, library rescan action, cancelable scan sessions, warning diagnostics, Ren'Py scoring, persisted `scan_candidates`, a scan hub, site-media fallback, F95-style folder-name parsing, a main-app game-details panel, dedicated library/updates navigation, a live F95 browser workspace with shared auth session, Electron-side download capture, a global downloads panel/history store, install/import plumbing into the local library, masked-link resolution, grouped F95 mirror parsing, same-host landing-page resolution, countdown-host handshake resolution for hosts like `datanodes`/same-template mirrors, defensive `gofile` API resolution, `Google Drive` public-download resolution, F95 thread-title normalization, stable F95 install targets, installed-thread detection in the live F95 workspace, library-driven update install flow with remembered mirrors, library stubs for not-yet-installed F95 threads, card/detail install CTAs for stub entries, a first local save vault, Windows-safe ZIP extraction that avoids the old `adm-zip` 2 GiB wall, a confidence-ranked local scanner matcher with Ren'Py metadata extraction, runtime/helper-path suppression, a safe auto-import gate that leaves ambiguous candidates out of the installed library, and a reusable safe cleanup path for obvious runtime-trash library records now exist. Large messy-library manual smoke is still pending. |
| Stage 2. Save intelligence       | in_progress |      79% | `save_profiles` / `save_sync_state` SQLite layers now exist, the app now detects install-relative save roots, RPG Maker root save files, `%AppData%/RenPy/*`, Unity `LocalLow`, Unreal save roots, Godot `app_userdata`, and packaged HTML app storage, while local save vault and cloud sync can back up/restore those profile strategies safely. Richer conflict UX and live manual smoke across real game installs are still missing.                                                                                                                                      |
| Stage 3. Supabase                | in_progress |      62% | Publishable-key Supabase client wiring, local desktop session persistence, email/password auth, private storage archive upload/restore and a SQL bootstrap for bucket/RLS now exist. A user-scoped additive cloud-library catalog is now stored alongside save archives without any service-role key in the client. First live bucket/auth smoke is still pending.                                                                                                                                                                                           |
| Stage 4. Sync UX                 | in_progress |      68% | Settings now have a dedicated Cloud Saves page for config/auth, the library details panel exposes refresh/upload/restore actions plus sync state, false warning rendering after successful backup is fixed, and the cloud panel now exposes bulk backup/sync actions plus cloud-library refresh state. Richer conflict prompts, remote history browsing and long-running background sync smoke are still missing.                                                                                                                                             |
| Stage 5. Quality hardening       | partial     |      61% | CI/check foundation, migration tests, scan-source store tests, Ren'Py and multi-engine save-detector tests, scan-session tests, scan-candidate store tests, scan matcher/identity tests, scan auto-import policy tests, library cleanup tests, shared version-comparison tests, import-metadata tests, scan-title parser tests, cloud error rendering regression tests, F95 download resolver tests including masked-link, countdown-host, gofile and Google Drive coverage, app-updater tests and archive safety tests exist now, but no integration/perf/crash-recovery work yet.                                                          |
| MVP total                        | in_progress |      83% | Honest estimate relative to the full ТЗ, not relative to Atlas baseline.                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### 2026-04-05 — Stage 4 sync UX + Stage 1 library flow: additive cloud library catalog, bulk cloud save actions, and installable library stubs

- Status: done
- Progress: 100%
- ТЗ coverage: closes the missing cross-device library continuity flow, adds bulk cloud save actions, and turns F95 thread links into first-class library entries even before installation

What was done:

- Added account-wide cloud library catalog sync on top of the existing user-scoped Supabase storage flow.
- Added safe local materialization of remote-only cloud library entries into local stub records so another PC can see the library without already having installed files.
- Added a manual `Add to Library` action in the live F95 browser workspace next to `Install This Thread`.
- Added `Install` CTAs for library entries with no installed files on both the banner card and the details panel.
- Added bulk cloud save actions for all installed games:
  - back up all detected saves to cloud
  - sync all installed games against cloud saves
  - continue after per-game failures instead of aborting the whole batch
- Added cloud-panel progress and summary UI for those bulk actions.

How it was implemented:

- Cloud library catalog:
  - `src/main/cloudLibraryCatalog.js`
  - introduced normalized cloud-library entries and merge logic for local + remote catalogs
- Supabase/storage layer:
  - `src/main/cloudSaveSync.js`
  - now accepts `listGames(...)`
  - stores / reads a user-scoped `library/catalog.json`
  - merges local and remote library entries additively
- Local library materialization and F95 thread stubs:
  - `src/main.js`
  - added local upsert flow for F95-linked library stubs
  - remote-only catalog entries now materialize into local `games` rows without installed `versions`
  - `resolveF95InstallTarget(...)` now reuses stub records so installing later updates the same library entry instead of creating a duplicate
- F95 mapping persistence:
  - `src/database.js`
  - `getGame(...)` / `getGames(...)` now resolve `siteUrl` and `f95_id` from either Atlas-backed F95 metadata or direct `f95_zone_mappings`
  - added `upsertF95ZoneMapping(...)`
  - added migration `src/main/db/migrations/007_f95_zone_mapping_site_url.js`
  - updated migration index + tests
- Renderer / UI:
  - `src/renderer.js`
  - `src/web-preview-api.js`
  - added bulk cloud action APIs, cloud-library catalog APIs, bulk progress listener, and `addF95ThreadToLibrary(...)`
  - `src/core/cloud/CloudAuthPanel.jsx`
    - now exposes bulk backup/sync buttons
    - shows live bulk progress
    - shows cloud-library counts and remote-only entries
  - `src/core/search/F95BrowserWorkspace.jsx`
    - now distinguishes `in library` vs `installed`
    - adds the new `Add to Library` button next to install
  - `src/core/GameBanner.js`
    - stub entries now show `Install` instead of a dead `Play`
  - `src/core/library/LibraryDetailsPanel.jsx`
    - stub entries now show install-ready state and `Install` CTA
  - `src/core/updates/F95UpdateModal.jsx`
    - install/update copy now adapts to whether the entry already has installed files
  - `src/App.jsx`
    - library UI summary now distinguishes total library entries from installed entries

Checks run:

- `node --test test/cloudLibraryCatalog.test.js test/f95ZoneMappings.test.js test/migrations.test.js`
- `npm run typecheck`
- `npm run lint`

What is still missing here:

- no live manual Electron smoke was run yet for:
  - signing in on a second machine and watching remote-only library entries appear
  - full bulk save sync against a real populated Supabase bucket
- there is still no explicit account-level "remove from every device" flow; current cloud-library behavior is intentionally additive, not destructive

### 2026-04-05 — Stage 1 library hygiene: safe cleanup for obvious runtime-trash records

- Status: done
- Progress: 100%
- ТЗ coverage: closes the immediate real-world fallout from the older scanner by safely removing obvious runtime/helper junk from the installed library without touching game files or user saves

What was done:

- Added a reusable backend cleanup path for obvious noise records already imported into `games` / `versions`.
- Ran the cleanup against the current live profile and removed 6 strict-noise records:
  - `Managed`
  - `FullNET`
  - `DIN`
  - `ReiPatcher`
  - `Common ExtProtocol Executor`
  - `readme`
- Confirmed after cleanup that no matching runtime-trash records remain in the current library database.

How it was implemented:

- Cleanup classifier:
  - `src/main/libraryCleanup.js`
  - added strict heuristics that only flag records when they look like obvious runtime/helper artifacts:
    - known junk titles (`readme`, `ReiPatcher`, `Managed`, `FullNET`, etc.)
    - known helper executables (`readme.html`, `ReiPatcher.exe`, `Common.ExtProtocol.Executor.exe`, etc.)
    - nested runtime paths (`game/fonts`, `*_Data/Managed`, `Translators`, `BepInEx`, `RenPy`, `www`, and related infra folders)
  - cleanup is intentionally conservative and ignores merely suspicious-but-not-certain cases like an `index.html` root game
- Safety model:
  - cleanup uses `deleteGameCompletely(...)` only for the library record and related metadata/cache rows
  - it does **not** delete installed game files from disk
  - it does **not** touch user save files
- Live execution:
  - performed a dry-run first against `C:\Users\jerem\AppData\Roaming\f95-game-zone-app\data\data.db`
  - only after confirming the candidate set contained strict junk records did the real cleanup run

Files changed in this slice:

- `src/main/libraryCleanup.js`
- `test/libraryCleanup.test.js`
- `tasks.md`

Checks run:

- `node --test test/libraryCleanup.test.js test/gameRemoval.test.js`
- `npm run typecheck`
- `npm run lint`

What is still missing here:

- this cleanup path is backend-only for now; there is no explicit Scan Hub / Library UI action wired to it yet
- non-junk but still badly identified records such as HTML roots with `index.html` are intentionally left for a separate reconciliation pass instead of being auto-deleted

### 2026-04-05 — Stage 4 sync UX: stop showing fake cloud-backup errors after success

- Status: done
- Progress: 100%
- ТЗ coverage: closes a user-facing trust bug where the library panel could show a cloud-backup failure banner even after a successful upload with a valid `Last backup` timestamp

What was done:

- Fixed cloud-save UI so it only renders a user-facing error when there is an actual error string.
- Successful backups with `last_error = ""` no longer produce the fake warning `Could not back up your saves to the cloud right now.`
- Applied the same guard to the cloud auth panel so empty auth errors do not generate phantom failure messages there either.

How it was implemented:

- Shared error helper:
  - `src/shared/cloudSyncErrors.js`
  - added `getCloudSyncMessageIfPresent(...)`, which returns an empty string when no raw error exists and otherwise reuses the existing user-facing error mapping
- Library cloud panel:
  - `src/core/library/LibrarySaveSyncPanel.jsx`
  - replaced unconditional `getCloudSyncErrorDetails(...).userMessage` usage with the new guarded helper
- Cloud auth panel:
  - `src/core/cloud/CloudAuthPanel.jsx`
  - applied the same fix so empty auth-state errors stay silent

Files changed in this slice:

- `src/shared/cloudSyncErrors.js`
- `src/core/library/LibrarySaveSyncPanel.jsx`
- `src/core/cloud/CloudAuthPanel.jsx`
- `test/cloudSyncErrors.test.js`
- `tasks.md`

Checks run:

- `node --test test/cloudSyncErrors.test.js test/saveSyncStateStore.test.js test/saveSyncPlan.test.js`
- `npm run typecheck`
- `npm run lint`

What is still missing here:

- no renderer-level interaction test exists yet for the save panel itself; the regression is covered at the shared helper level, not with a mounted UI test

### 2026-04-05 — Stage 1 scanner hardening: stop importing runtime trash and unresolved matches

- Status: partial
- Progress: 95%
- ТЗ coverage: closes the practical failure mode discovered on a real user library where runtime/helper folders and ambiguous matches could still land in the installed library

What was done:

- Library rescan no longer auto-imports everything the scanner finds.
- Only `matched` scan candidates are auto-imported into the installed library.
- `ambiguous` and `unmatched` candidates stay in the discovery queue for review instead of silently polluting `games` / `versions`.
- Added runtime/helper-path suppression so nested infrastructure folders are not treated as game roots.
- Added extra executable/file blacklist coverage for common junk like `readme.html`, `Common.ExtProtocol.Executor.exe`, and `ReiPatcher.exe`.
- HTML game detection now treats `index.html` as a generic launcher name and prefers the folder title.

How it was implemented:

- Auto-import gate:
  - `src/main/scanCandidateImportPolicy.js`
  - `src/main.js`
  - introduced a dedicated split between auto-importable scan results and review-required results
  - library rescan now imports only matched candidates and reports the review queue count
- Nested runtime suppression:
  - `src/core/scanners/f95scanner.js`
  - added infrastructure-segment filtering for nested candidates such as `game/fonts`, `*_Data/Managed`, `Translators`, `BepInEx`, `RenPy`, `www`, `resources`, and similar runtime-only paths
- Identity cleanup:
  - `src/main/scanIdentity.js`
  - `index.html` is now treated as a generic launcher label so folder naming wins for HTML titles

Files changed in this slice:

- `src/main/scanCandidateImportPolicy.js`
- `src/main.js`
- `src/core/scanners/f95scanner.js`
- `src/main/scanIdentity.js`
- `test/scanCandidateImportPolicy.test.js`
- `test/scanCacheStores.test.js`
- `test/scanIdentity.test.js`
- `tasks.md`

Checks run:

- `node --test test/scanMatchUtils.test.js test/scanIdentity.test.js test/scanAtlasMatcher.test.js test/scanCandidatesStore.test.js test/scanCacheStores.test.js test/scanCandidateImportPolicy.test.js test/migrations.test.js test/scanTitleParser.test.js test/renpyDetector.test.js`
- `npm run typecheck`
- `npm run lint`

What is still missing here:

- already imported trash rows in the current live profile are not automatically cleaned yet; they were created before the new gate and still need an explicit cleanup/reconciliation pass
- threshold tuning for high-score ambiguous cases still needs real-library calibration rather than guesswork

### 2026-04-05 — Stage 1 scanner hardening: confidence-ranked F95/Atlas matching

- Status: partial
- Progress: 92%
- ТЗ coverage: materially closes the main scanner gap by replacing first-hit Atlas linking with a safer scored matcher that can identify previously downloaded F95 games without silently auto-binding ambiguous titles

What was done:

- Added a dedicated confidence-ranked Atlas/F95 matcher for scan candidates.
- Local scan identity now pulls stronger signals from:
  - folder names
  - executable names
  - configured scan path formats
  - Ren'Py `game/options.rpy` title/version metadata when available
- Ambiguous matches are no longer auto-selected during scan/importer refresh flows.
- Scan candidate persistence now stores match status, match score and match reasons instead of only raw match count.

How it was implemented:

- Shared matching primitives:
  - `src/shared/scanMatchUtils.js`
  - added canonical text/version/engine normalization plus deterministic similarity helpers for the scanner domain
- Local identity extraction:
  - `src/main/scanIdentity.js`
  - builds a candidate fingerprint from local folder layout, executable names, nested creator/title/version folders and Ren'Py `options.rpy`
- Atlas/F95 ranking:
  - `src/main/scanAtlasMatcher.js`
  - preloads Atlas/F95 rows once per scan job, indexes aliases (`title`, `short_name`, `id_name`, `original_name`), scores title/creator/version/engine agreement, and only auto-links when score plus winner margin are strong enough
- Scanner integration:
  - `src/core/scanners/f95scanner.js`
  - `src/main/scanRunner.js`
  - `src/main.js`
  - scan results now carry `matchStatus`, `matchScore`, `matchReasons`, and `autoMatched`
  - enabled-source scans build one matcher index and reuse it across the full run
  - single-folder importer scans also reuse the same safer matcher path
- Persistence + architecture:
  - `src/main/db/migrations/006_scan_candidate_match_metadata.js`
  - `src/main/db/migrations/index.js`
  - `src/main/db/scanCandidatesStore.js`
  - persisted match metadata was added to `scan_candidates`
  - created ADR `docs/adr/0005-confidence-ranked-f95-matching.md`
- Importer safety:
  - `src/core/importer/importer.jsx`
  - ambiguous Atlas results now stay unselected until the user explicitly chooses one instead of silently collapsing to the first option

Files changed in this slice:

- `src/shared/scanMatchUtils.js`
- `src/shared/scanTitleParser.js`
- `src/main/scanIdentity.js`
- `src/main/scanAtlasMatcher.js`
- `src/main/scanRunner.js`
- `src/main.js`
- `src/core/scanners/f95scanner.js`
- `src/core/importer/importer.jsx`
- `src/main/db/migrations/006_scan_candidate_match_metadata.js`
- `src/main/db/migrations/index.js`
- `src/main/db/scanCandidatesStore.js`
- `docs/adr/0005-confidence-ranked-f95-matching.md`
- `test/scanMatchUtils.test.js`
- `test/scanIdentity.test.js`
- `test/scanAtlasMatcher.test.js`
- `test/scanCandidatesStore.test.js`
- `test/scanCacheStores.test.js`
- `test/migrations.test.js`
- `tasks.md`

Checks run:

- `node --test test/scanMatchUtils.test.js test/scanIdentity.test.js test/scanAtlasMatcher.test.js test/scanCandidatesStore.test.js test/scanCacheStores.test.js test/migrations.test.js test/scanTitleParser.test.js test/renpyDetector.test.js`
- `npm run typecheck`
- `npm run lint`

What is still missing here:

- no large real-library manual smoke has been run yet to calibrate thresholds against messy user folders and same-title collisions in the wild
- the legacy importer refresh action still uses the old manual Atlas search endpoint for explicit re-checks; the dangerous auto-select part is gone, but that flow still deserves migration onto the same ranked matcher later

### 2026-04-05 — Stage 2 save intelligence: engine-aware save detection for popular Windows engines

- Status: partial
- Progress: 79%
- ТЗ coverage: closes the biggest practical gap in save intelligence by replacing the renpy-only detector with engine-aware save profile discovery that can now feed backup, restore and cloud sync flows for the most common Windows engine layouts we actually see in the library

What was done:

- Replaced the renpy-only save refresh path with a general `detectSaveProfiles(...)` pipeline in the Electron main process.
- Added engine-aware save adapters for:
  - `Ren'Py`
  - `RPG Maker`
  - `Unity`
  - `Unreal Engine`
  - `Godot`
  - packaged `HTML/NW.js/Electron` storage
- Added support for root-level save file sets, which is required for older `RPG Maker` variants that do not use a dedicated `save/` directory.
- Extended save vault backup/restore and cloud manifest/archive generation so the new profile strategies are not display-only.
- Extended safe game removal so supported external save roots under `AppData`, `Local AppData` and `LocalLow` can be deleted deliberately instead of being treated as unknown/unsafe paths.
- Updated the library save-sync panel labels so the UI now describes the detected save location type without leaking backend/internal details.

How it was implemented:

- Save profile detection:
  - `src/main/detectors/saveProfileDetector.js`
  - added engine normalization plus Windows-path heuristics for:
    - install-relative save directories
    - install-root file-pattern save sets
    - `AppData` / `Local AppData` / `LocalLow` save roots
- Save strategy model:
  - `src/main/saveProfileStrategies.js`
  - introduced reusable strategy helpers for:
    - destination path resolution
    - tracked-profile normalization
    - file-pattern matching
    - enumerating files from a save profile without copying an entire game folder by mistake
- Main-process integration:
  - `src/main/saveProfiles.js`
  - `src/main/saveVault.js`
  - `src/main/cloudSaveSync.js`
  - `src/main/gameRemoval.js`
  - switched save detection, vault backup/restore, cloud archive/manifest building and safe deletion to the new profile strategy layer
- UI integration:
  - `src/core/library/LibrarySaveSyncPanel.jsx`
  - mapped new providers/strategies to product-facing labels and updated the empty-state copy
- Compatibility:
  - `src/main/detectors/renpySaveDetector.js`
  - kept the existing Ren'Py-specific detector exports alive while reusing them from the new general detector path instead of breaking older code/tests

Files changed in this slice:

- `src/main/detectors/saveProfileDetector.js`
- `src/main/saveProfileStrategies.js`
- `src/main/saveProfiles.js`
- `src/main/saveVault.js`
- `src/main/cloudSaveSync.js`
- `src/main/gameRemoval.js`
- `src/main/detectors/renpySaveDetector.js`
- `src/core/library/LibrarySaveSyncPanel.jsx`
- `docs/adr/0005-engine-save-profile-strategies.md`
- `test/saveProfileDetector.test.js`
- `test/saveVault.test.js`
- `test/gameRemoval.test.js`
- `tasks.md`

Checks run:

- `node --test test/saveProfileDetector.test.js test/renpySaveDetector.test.js test/saveVault.test.js test/gameRemoval.test.js`
- `npm run typecheck`
- `npm run lint`
- `npm test`

What is still missing here:

- `Unity`, `Godot` and packaged `HTML` app-data detection still relies on title/company folder matching heuristics, so heavily renamed projects can still be missed
- no manual smoke has been run yet against a real installed sample for each supported engine family
- save conflict UX is still basic; this slice improves detection/transport, not human conflict resolution or history browsing

### 2026-04-05 — Stage 1 media policy: screenshot cap reduced from unlimited to 20

- Status: partial
- Progress: 97%
- ТЗ coverage: tightens screenshot caching so imports, rescans and post-import backfill stop at a bounded count instead of downloading unbounded media per game

What was done:

- Replaced the new unlimited screenshot behavior with a hard cap of `20`.
- Applied the same cap to:
  - default library rescans
  - importer defaults
  - manual per-game preview refresh
  - bulk cached screenshot backfill for already imported games
- Added a dedicated resolver so any legacy `Unlimited` value is coerced down to `20` in the Electron main process instead of slipping through old call paths.

How it was implemented:

- Main media limit handling:
  - `src/main/previewLimit.js`
  - centralized `DEFAULT_PREVIEW_LIMIT = "20"` and `resolvePreviewDownloadCount()`
  - old non-numeric inputs like `Unlimited` are now clamped to `20`
- Main integration:
  - `src/main.js`
  - image download flows now use the shared preview-limit resolver instead of special-casing `Unlimited`
- Importer defaults:
  - `src/core/importer/importer.jsx`
  - default preview limit displayed in the importer is now `20`

Files changed in this slice:

- `src/main/previewLimit.js`
- `src/main.js`
- `src/core/importer/importer.jsx`
- `test/previewLimit.test.js`
- `tasks.md`

Checks run:

- `node --test test/previewLimit.test.js`

What is still missing here:

- no manual Electron smoke was run yet to verify the UX copy/progress against a game with more than 20 remote screenshots

### 2026-04-05 — Stage 1 library media backfill: cached screenshot refresh without cache reset

- Status: partial
- Progress: 97%
- ТЗ coverage: closes the real gap left after removing the old screenshot cap by giving already-imported games a safe way to backfill missing cached screenshots without abusing reset-cache rescans

What was done:

- Added a dedicated bulk screenshot refresh flow for already imported library games with Atlas/F95 mappings.
- Existing games no longer need `Reset Cache & Rescan Library` just to backfill screenshots after the preview cap was raised.
- Hardened F95 thread-link normalization so screenshot/lightbox attachments are ignored even if the surrounding container text contains `DOWNLOAD`.

How it was implemented:

- Main process media refresh:
  - `src/main/libraryPreviewRefresh.js`
  - `src/main.js`
  - introduced a focused bulk-refresh target builder plus a cached-vs-remote decision helper
  - added a new `refresh-library-previews` IPC that iterates installed games with `atlas_id`, compares local preview count against remote `f95_zone_data.screens`, and reuses the existing `downloadImages(..., false, true, "Unlimited", false)` path only when backfill is actually needed
- Renderer/UI entrypoint:
  - `src/renderer.js`
  - `src/App.jsx`
  - exposed the new IPC to renderer and added a product-facing `Refresh Cached Screenshots` action to the library rescan menu
- F95 live thread guard:
  - `src/main/f95/threadInspector.js`
  - `src/main/f95/threadLinks.js`
  - attachment/lightbox screenshot anchors now carry image metadata from inspection and are filtered out during mirror normalization instead of relying on fragile container text

Files changed in this slice:

- `src/main/libraryPreviewRefresh.js`
- `src/main/f95/threadInspector.js`
- `src/main/f95/threadLinks.js`
- `src/main.js`
- `src/renderer.js`
- `src/App.jsx`
- `test/libraryPreviewRefresh.test.js`
- `test/f95ThreadLinks.test.js`
- `tasks.md`

Checks run:

- `node --test test/libraryPreviewRefresh.test.js test/f95ThreadLinks.test.js`
- `npm run typecheck`
- `npm run lint`

What is still missing here:

- no full Electron manual smoke was run yet for the new bulk screenshot refresh action on a large real library
- the legacy `GameDetailsWindow` still has its old per-record preview controls; the new bulk action fixes the workflow gap, but that older window is still not aligned with the newer library UX

### 2026-04-05 — Stage 1 mirror resolver extension: Google Drive support and live anonfile host-family recognition

- Status: partial
- Progress: 96%
- ТЗ coverage: closes another common mirror class by teaching the app how to resolve public Google Drive file links instead of treating share/view pages as dead HTML payloads

What was done:

- Added a dedicated `Google Drive` resolver in the Electron main process.
- Public Google Drive mirrors now support:
  - share/view URLs like `/file/d/<id>/view`
  - direct `uc?export=download&id=<id>` URLs
  - embedded viewer pages that expose the final `drive.usercontent.google.com` download URL
  - confirm/warning forms for large or scanned files that require a second confirmation request before the real payload is served
- Expanded known mirror-family recognition for live `anonfile`-style hosts:
  - `anonfile.de`
  - `anonfiles.se`
  - `drive.usercontent.google.com` for the resolved Google Drive payload host

How it was implemented:

- Main download support:
  - `src/main/f95/downloadSupport.js`
  - added helpers for:
    - Google Drive file-id extraction
    - JS-unescape decoding inside HTML viewer payloads
    - embedded direct download URL extraction from viewer pages
    - confirm-form parsing for warning pages
    - recursive resolution of the actual downloadable Google payload URL
- Thread mirror recognition:
  - `src/main/f95/threadLinks.js`
  - added live host-family recognition for `anonfile.de`, `anonfiles.se` and Google Drive's content host
- Important constraint:
  - `anonfile` itself is only automatically supported when the mirror page is actually resolvable without captcha
  - if the host requires captcha, the app still stops honestly instead of pretending it can bypass it

Files changed in this slice:

- `src/main/f95/downloadSupport.js`
- `src/main/f95/threadLinks.js`
- `test/f95DownloadSupport.test.js`
- `tasks.md`

Checks run:

- `node --test test/f95DownloadSupport.test.js`
- `npm run ci:check`

What is still missing here:

- `MEGA` still remains explicitly unsupported for automatic install and needs a dedicated implementation if it is ever going to work correctly
- `anonfile` public downloads that require captcha are still intentionally not auto-bypassed
- real manual smoke with a live Google Drive mirror from an actual F95 thread is still needed even though the resolver logic and tests are now in place

### 2026-04-04 — Stage 1 mirror resolver expansion: countdown hosts + Gofile + explicit MEGA guard

- Status: partial
- Progress: 95%
- ТЗ coverage: closes another real class of broken mirror installs where the app could only handle simple landing pages but not hosts that require a form handshake or API lookup before yielding the actual file

What was done:

- Added a generic countdown-host resolver for file hosts that expose a `download-countdown` component and expect a `download2` form POST before returning the real payload URL.
- Confirmed the `datanodes` family behavior from the live site and implemented the same handshake in the Electron main process instead of trying to download the HTML page.
- Added a defensive `gofile` resolver:
  - bootstraps a guest token
  - queries `https://api.gofile.io/contents/{id}`
  - extracts the direct file URL from the API payload when available
- Added an explicit `MEGA` guard so the app now fails honestly before queueing a bogus HTML page for a host that needs a dedicated crypto client path.

How it was implemented:

- Main download support:
  - `src/main/f95/downloadSupport.js`
  - added HTML tag parsing for:
    - `download-countdown`
    - `file-actions`
  - added countdown-host handshake resolver:
    - GET landing page
    - parse `code` / `referer` / `rand` / captcha flags
    - POST `op=download2`
    - trust the returned JSON `url`
  - added `gofile` content-id extraction and guest-token/API lookup
  - added explicit user-facing `MEGA` unsupported guard
- Tests:
  - `test/f95DownloadSupport.test.js`
  - added coverage for:
    - countdown-host config parsing
    - countdown-host final URL resolution
    - `gofile` content-id parsing
    - `gofile` API-driven direct URL lookup
    - explicit `MEGA` rejection

Files changed in this slice:

- `src/main/f95/downloadSupport.js`
- `test/f95DownloadSupport.test.js`
- `tasks.md`

Checks run:

- `node --test test/f95DownloadSupport.test.js`
- `npm run ci:check`

What is still missing here:

- this now covers another large class of mirrors, but it still does not mean every hoster is universally solved
- `MEGA` is explicitly blocked for automatic install until a real dedicated implementation exists
- real manual smoke is still needed for the exact failing mirrors from the user’s logged-in F95 session, especially `vikingfile` and the concrete `gofile` links seen in the wild

### 2026-04-04 — Stage 1 download resolver hardening: masked F95 -> same-host landing page -> real file

- Status: partial
- Progress: 94%
- ТЗ coverage: closes the concrete regression where masked F95 mirrors and host landing pages could still resolve to the wrong external payload instead of the actual game package

What was done:

- Hardened the F95 download resolver so the flow now explicitly handles:
  - F95 masked warning pages
  - host landing pages with an intermediate `Download` button
  - same-host follow-up download endpoints
- Fixed the dangerous generic resolver behavior that could follow unrelated external ad/download links from the landing page.
- Added regression coverage for the exact real-world chain:
  - `f95zone.to/masked/...`
  - external host landing page
  - final same-host `/download` endpoint
- Added a guard that keeps external off-host download bait such as `torproject.org` out of resolver candidates.

How it was implemented:

- Main download support:
  - `src/main/f95/downloadSupport.js`
  - masked F95 links are resolved through the AJAX endpoint instead of treating the warning page itself as a payload
  - host landing pages are parsed for same-host download affordances like `href`, `hx-get`, `formaction` and `action`
  - candidate scoring now prefers explicit download endpoints and penalizes preview/help/pricing noise
  - candidate URLs are constrained to the same host family as the current landing page, which is the real fix for the accidental Tor download class of bug
- Tests:
  - `test/f95DownloadSupport.test.js`
  - added regression coverage for:
    - generic landing-page extraction
    - same-host landing-page resolution
    - full masked-F95-to-final-download preparation

Files changed in this slice:

- `src/main/f95/downloadSupport.js`
- `test/f95DownloadSupport.test.js`
- `tasks.md`

Checks run:

- `npm run ci:check`

What is still missing here:

- this path is now safer and more general, but some hosters still use captcha, timers or JS challenges that cannot be bypassed universally
- real end-to-end smoke in the Electron app against a logged-in F95 session is still required for the exact host mix the user actually installs from

### 2026-04-04 — Stage 2/3/4 save sync foundation: Ren'Py AppData intelligence + Supabase auth/storage

- Status: partial
- Progress: 63%
- ТЗ coverage: closes the first real end-to-end slice of cloud save work instead of leaving save continuity trapped inside install folders only

What was done:

- Added persistent SQLite models for save detection and sync state:
  - `save_profiles`
  - `save_sync_state`
- Added Ren'Py-oriented save detection that now covers:
  - common install-relative save folders
  - `%AppData%/RenPy/...` profiles matched against game title/install heuristics
  - fallback Ren'Py detection from install markers even when engine metadata is missing
- Reworked local save vault so it can back up and restore profile-based save roots, not just hardcoded `game/saves`
- Added Supabase desktop client wiring with:
  - publishable key
  - desktop session persistence in app data
  - email/password sign-up / sign-in / sign-out
  - private storage archive upload / restore for game saves
- Added a dedicated Cloud Saves settings page for config/auth
- Added per-game save sync controls in the library details panel:
  - refresh detected profiles
  - upload to cloud
  - restore from cloud
  - view sync status and last error
- Added ADR + SQL bootstrap for the private storage bucket and RLS policies

How it was implemented:

- Main / DB:
  - `src/main/db/migrations/005_save_sync.js`
  - `src/main/db/saveProfilesStore.js`
  - `src/main/db/saveSyncStateStore.js`
  - `src/main/saveProfiles.js`
- Save detection / vault:
  - `src/main/detectors/renpySaveDetector.js`
  - `src/main/saveVault.js`
  - `%AppData%/RenPy` restore paths now resolve through profile strategy instead of install-folder guesses
- Supabase:
  - `src/main/supabase/client.js`
  - `src/main/cloudSaveSync.js`
  - `src/main.js`
  - auth and sync live entirely in the Electron main process via typed IPC
  - only the publishable key is configured in the shipped app
  - the provided secret key is intentionally ignored for runtime implementation because shipping it would be unprofessional and unsafe
- Renderer / UI:
  - `src/renderer.js`
  - `src/core/settings/CloudSync.jsx`
  - `src/core/settings/Settings.jsx`
  - `src/core/settings/settingsIcons.js`
  - `src/settings.html`
  - `src/core/library/LibrarySaveSyncPanel.jsx`
  - `src/core/library/LibraryDetailsPanel.jsx`
  - `src/index.html`
- Docs:
  - `docs/adr/0002-cloud-save-sync.md`
  - `docs/supabase/cloud-save-setup.sql`

Files changed in this slice:

- `package.json`
- `package-lock.json`
- `src/main.js`
- `src/renderer.js`
- `src/main/db/migrations/005_save_sync.js`
- `src/main/db/migrations/index.js`
- `src/main/db/saveProfilesStore.js`
- `src/main/db/saveSyncStateStore.js`
- `src/main/detectors/renpySaveDetector.js`
- `src/main/saveProfiles.js`
- `src/main/saveVault.js`
- `src/main/supabase/client.js`
- `src/main/cloudSaveSync.js`
- `src/shared/saveManifest.js`
- `src/core/settings/CloudSync.jsx`
- `src/core/settings/Settings.jsx`
- `src/core/settings/settingsIcons.js`
- `src/settings.html`
- `src/core/library/LibrarySaveSyncPanel.jsx`
- `src/core/library/LibraryDetailsPanel.jsx`
- `src/index.html`
- `docs/adr/0002-cloud-save-sync.md`
- `docs/supabase/cloud-save-setup.sql`
- `test/renpySaveDetector.test.js`
- `test/saveManifest.test.js`
- `test/saveProfilesStore.test.js`
- `test/saveSyncStateStore.test.js`
- `test/saveVault.test.js`
- `test/migrations.test.js`
- `tasks.md`

Checks run:

- `npm run ci:check`

What is still missing here:

- the bucket/RLS bootstrap still has to be applied once in the target Supabase project
- there is still no automatic background sync or cloud conflict dialog
- `%AppData%/RenPy` coverage is now real, but full save intelligence for every engine/runtime is obviously not “done”
- live manual smoke with a real Supabase user and real upload/restore is still required

Operational note:

- verified direct admin access to the target Supabase project with the provided secret key
- created the private storage bucket `atlas-cloud-saves` in project `jlwxwjgnujkenanohypr`
- bucket bootstrap is therefore no longer theoretical; the remaining project-side requirement is applying the `storage.objects` RLS policies so authenticated end users can use publishable-key client auth safely
- cleaned the cloud-save UI back to product language:
  - removed editable backend/project fields from user settings
  - removed visible bucket/backend jargon from the account/save panels
  - kept only user-facing actions such as sign in, create account, back up and restore

### 2026-04-04 — Stage 1 install/launch correction: flatten update archives + honor selected executable + add Play button

- Status: partial
- Progress: 91%
- ТЗ coverage: fixes a real update/install regression where archive updates were nesting a new game folder inside the old one, and closes the missing launch affordance in the details panel

What was done:

- Fixed archive update installs so single-root archives are flattened before merging into the existing game directory.
- Stopped treating the first discovered executable as the launch target when a better selected executable already exists.
- Added a direct `Play` action to the library details sidebar:
  - top-level current-version play button
  - per-version `Play` button inside installed versions
- Added a dedicated main-side `launch-game` IPC so the details panel can launch games directly instead of relying on the banner context menu only.
- Hardened context-menu launch handling so failed launches are logged instead of silently vanishing.

How it was implemented:

- Archive layout:
  - `src/main/install/archiveLayout.js`
  - new helper unwraps archives that contain exactly one top-level folder, so updates merge their contents into the target install directory instead of producing `Game\\UpdateFolder\\...`
- Executable selection:
  - `src/main/install/selectExecutable.js`
  - new scoring prefers title-matching game executables and penalizes generic runtime files like `renpy.exe`, `pythonw.exe`, `unitycrashhandler*` and similar
- Main install/launch flow:
  - `src/main.js`
  - F95 archive installs now use the unwrapped archive content root
  - archive and importer executable choice now use the new preferred-executable selector
  - added `launch-game` IPC
  - `launchGame()` now returns real success/failure and surfaces missing-target errors
- DB persistence:
  - `src/database.js`
  - `addVersion()` now respects `selectedValue` when writing `exec_path` instead of always storing the first executable in the array
- Renderer/UI:
  - `src/renderer.js`
  - `src/App.jsx`
  - `src/core/library/LibraryDetailsPanel.jsx`
  - `src/core/GameBanner.js`

Files changed in this slice:

- `src/main/install/archiveLayout.js`
- `src/main/install/selectExecutable.js`
- `src/main.js`
- `src/database.js`
- `src/renderer.js`
- `src/App.jsx`
- `src/core/library/LibraryDetailsPanel.jsx`
- `src/core/GameBanner.js`
- `test/archiveLayout.test.js`
- `test/selectExecutable.test.js`
- `test/databaseVersionSelection.test.js`
- `tasks.md`

Checks run:

- `npm run ci:check`

What is still missing here:

- this fixes the concrete nested-update-folder bug class, but it still assumes the archive has a sane single-root layout or direct root files
- there is still no interactive executable picker for weird multi-launcher releases
- save preservation is still best-effort via backup/restore; a full manual smoke on the exact Apartment #69 update path is still needed

### 2026-04-04 — Stage 1 thread parsing correction: filter irrelevant links and group mirrors by platform

- Status: partial
- Progress: 93%
- ТЗ coverage: fixes the broken F95 link parsing path where update/install modals treated every external URL in the starter post as a download candidate and dumped them into one flat list

What was done:

- Added proper F95 download-link classification instead of “every external link is a mirror”.
- Social/media/store links are now filtered out of thread download parsing:
  - Twitter / X
  - Steam links
  - similar non-download external URLs
- Download links are now grouped by platform variant when the thread uses separate lines such as:
  - `Win/Linux`
  - `Mac`
  - `Android`
- Both the library update modal and the live F95 workspace install modal now render grouped download sections instead of one noisy mixed list.
- The live F95 workspace no longer runs its own separate ad-hoc DOM parser for mirrors; it now reuses the main-side thread inspection IPC, so update/install parsing is consistent across both entry points.

How it was implemented:

- Main:
  - added `src/main/f95/threadLinks.js`
  - pure helper classifies raw anchor data, filters irrelevant links and groups candidates into platform variants
  - `src/main/f95/threadInspector.js`
    - hidden-page DOM script now extracts raw anchor/link context
    - main process post-processes the raw links through the new classifier
- Main IPC:
  - `src/main.js`
  - `inspect-f95-thread` failure payload now also returns `variants: []`
- Renderer/UI:
  - `src/core/updates/F95UpdateModal.jsx`
  - `src/core/search/F95BrowserWorkspace.jsx`
  - both modals now render grouped platform sections
  - F95 browser workspace now uses the same main-side inspection flow instead of a separate renderer-only parser
- Tests:
  - `test/f95ThreadLinks.test.js`

Files changed in this slice:

- `src/main/f95/threadLinks.js`
- `src/main/f95/threadInspector.js`
- `src/main.js`
- `src/core/updates/F95UpdateModal.jsx`
- `src/core/search/F95BrowserWorkspace.jsx`
- `test/f95ThreadLinks.test.js`
- `tasks.md`

Checks run:

- `npm run ci:check`

What is still missing here:

- the parser is now much saner, but F95 threads are messy and there will still be exotic layouts that need more examples
- there is still no automatic OS-aware default selection between Windows/Mac/Android groups; the user still chooses the target file manually

### 2026-04-04 — Stage 1 library launcher flow: in-app updates + local save vault

- Status: partial
- Progress: 88%
- TЗ coverage: moves the product closer to the intended “Steam-lite for local builds” direction by making updates library-driven and by separating user save continuity from a single install folder

What was done:

- Replaced the dead “open thread in browser” update behavior with an in-app F95 update flow from the library UI.
- Update buttons on library banners/details now:
  - inspect the live F95 thread through the authenticated session
  - show mirrors in an update modal
  - remember the last successful mirror host and preselect it next time
  - queue the selected update into the same download/install pipeline
- Added the first local save-vault layer:
  - save directories from common local layouts are copied into app-managed backup storage
  - updates back up saves before writing into the install directory
  - reinstall/update restores saved data back into the target install folder
  - delete-from-library flow now backs up saves before removing the DB record
- In-place update semantics are now product-oriented instead of browser-oriented:
  - the update action starts from the library record
  - the selected mirror is remembered as a user preference
  - the install still targets the existing game folder

How it was implemented:

- Main F95 thread inspection:
  - added `src/main/f95/threadInspector.js`
  - uses a hidden authenticated Electron window on the dedicated F95 partition to load a thread and extract mirrors/title/version/creator
  - new IPC:
    - `inspect-f95-thread`
- Mirror preference persistence:
  - `src/main.js`
  - stores last successful mirror selection in `config.ini` under `F95Mirrors`
  - selection is reapplied by host/label when the next update modal opens
- Renderer/UI:
  - `src/App.jsx`
  - added a dedicated update modal state/flow
  - `src/core/updates/F95UpdateModal.jsx`
  - `src/core/GameBanner.js`
  - `src/core/library/LibraryDetailsPanel.jsx`
  - update buttons now route through the modal instead of `openExternalUrl`
  - `src/index.html` now loads the update modal component
- Local save vault:
  - added `src/main/saveVault.js`
  - current tracked layouts focus on common local save folders such as:
    - `game/saves`
    - `saves`
    - `save`
    - `www/save`
  - `src/main.js` now backs up and restores these directories around update/reinstall flows
- Preload:
  - `src/renderer.js`
  - added `inspectF95Thread()`

Files changed in this slice:

- `src/main.js`
- `src/main/f95/threadInspector.js`
- `src/main/saveVault.js`
- `src/renderer.js`
- `src/App.jsx`
- `src/core/GameBanner.js`
- `src/core/library/LibraryDetailsPanel.jsx`
- `src/core/updates/F95UpdateModal.jsx`
- `src/index.html`
- `test/saveVault.test.js`
- `tasks.md`

Checks run:

- `node --test test/saveVault.test.js`
- `npm run ci:check`

What is still missing here:

- mirror inspection/update flow has code coverage via checks, but not a real manual smoke yet against a live logged-in update scenario
- save vault is still a first pass for common local save directories, not full Ren'Py save intelligence for `%AppData%/RenPy/*`
- there is still no cloud save layer yet; this slice is intentionally local-first only

### 2026-04-04 — Stage 1 workspace UX: disable install on already installed F95 threads

- Status: partial
- Progress: 86%
- TЗ coverage: closes the UX gap where the live F95 workspace still offered `Install This Thread` even when the current thread already mapped to an installed game in the library

What was done:

- Added installed-thread detection for the current F95 thread page.
- `Install This Thread` is now disabled when the game is already installed.
- The button label switches from `Install This Thread` to `Already Installed`.
- Added a visible installed-state banner in the workspace so the disabled button does not look like a random UI freeze.

How it was implemented:

- Main:
  - `src/main.js`
  - added a dedicated `get-f95-thread-install-state` IPC handler
  - install-state matching reuses the same installed-game detection logic as the F95 install-target resolver
  - matching prefers `f95_id` from the current thread URL and only falls back to normalized title/creator heuristics
- Preload:
  - `src/renderer.js`
  - added `getF95ThreadInstallState()`
- Renderer:
  - `src/core/search/F95BrowserWorkspace.jsx`
  - now requests install-state whenever the current thread changes
  - updates the install button state/label and shows an installed banner
- Parser hardening:
  - `src/main/f95/downloadSupport.js`
  - `parseF95ThreadTitle()` now strips trailing `| F95zone` browser-title suffix so title fallback matching is not poisoned by site chrome
- Tests:
  - extended `test/f95DownloadSupport.test.js` for the `| F95zone` browser-title case

Files changed in this slice:

- `src/main.js`
- `src/renderer.js`
- `src/core/search/F95BrowserWorkspace.jsx`
- `src/main/f95/downloadSupport.js`
- `test/f95DownloadSupport.test.js`
- `tasks.md`

Checks run:

- `node --test test/f95DownloadSupport.test.js`
- `npm run ci:check`

What is still missing here:

- installed-thread detection currently blocks install completely, as requested
- there is still no separate `Update This Thread` action for already installed games
- if a library entry has no F95 mapping and cannot be matched by normalized title/creator fallback, the workspace may still show the install button

### 2026-04-04 — Stage 1 install flow correction: ZIP64 extraction + stable update target

- Status: partial
- Progress: 84%
- TЗ coverage: fixes two real product failures in the F95 install pipeline:
  - large ZIP packages were crashing on the old `adm-zip` path
  - repeated installs/updates were creating new folders and duplicate library entries instead of reusing the existing install target

What was done:

- Replaced the Windows ZIP extraction path so large ZIP/ZIP64 archives are no longer blocked by the old 2 GiB limit from `adm-zip`.
- Stopped F95 installs from always creating a fresh version-stamped folder.
- F95 installs now resolve a stable target folder by title and reuse an existing installed folder when the game is already in the library.
- In-place F95 updates now write back into the existing install directory instead of creating a second standalone game folder.
- When updating in place, old version rows for that same `game_path` are removed before the new version row is stored, so the DB no longer accumulates multiple versions pointing at one physical directory.
- Archive installs now extract into a staging directory first and only then move/merge into the final install location, so failed archive installs stop leaving behind half-created target folders quite as easily.

How it was implemented:

- Archive layer:
  - `src/main/archive/extractArchive.js`
  - on Windows, ZIP entry listing and extraction now use PowerShell + .NET `System.IO.Compression` instead of the old `adm-zip` extraction path
  - archive-path validation still runs before extraction
- DB:
  - `src/database.js`
  - added `deleteVersionsForRecordPath(recordId, gamePath)` for in-place update cleanup
- Main F95 install flow:
  - `src/main.js`
  - added stable install-target resolution against the existing library snapshot
  - new installs now default to a stable title-based folder instead of `Title [version]`
  - existing installs reuse their current `game_path`
  - F95 installs now try to resolve `atlasId` from `f95_id` before persistence
  - existing library matches are updated in place instead of always going through the new-game import path
  - standalone file installs can overwrite the existing file inside the reused install directory

Files changed in this slice:

- `src/main/archive/extractArchive.js`
- `src/database.js`
- `src/main.js`
- `tasks.md`

Checks run:

- `node --test test/extractArchive.test.js`
- `npm run ci:check`

What is still missing here:

- this closes the concrete `> 2 GiB ZIP` failure on Windows, but Linux/macOS ZIP extraction still uses the older JS fallback path
- in-place update currently merges extracted files into the existing folder; there is still no rollback/backup transaction for failed mid-copy updates
- automatic cleanup/migration of older duplicate F95 install folders already created by the broken logic is not done yet

### 2026-04-04 — Stage 1 metadata hardening: F95 thread title cleanup for installs

- Status: partial
- Progress: 81%
- TЗ coverage: fixes the broken metadata path where F95 install titles were polluted by forum badges like `VN` and `Ren'Py` before the game even reached the library

What was done:

- Traced the bad title back to the F95 thread parser instead of trying to patch the library UI after the fact.
- Cleaned F95 install titles so badge/prefix noise is removed before queueing/install/import.
- Kept version and creator extraction while stripping category/engine labels from the visible title.
- Added a main-side normalization pass so the install pipeline no longer trusts the renderer blindly for thread metadata.

How it was implemented:

- Main:
  - `src/main/f95/downloadSupport.js` now exposes `parseF95ThreadTitle()` / `sanitizeF95ThreadTitle()`
  - the parser removes leading F95 badge noise such as `VN`, `Ren'Py`, `Unity`, platform/status tags, while keeping real title text
  - `src/main.js` now normalizes incoming thread title/creator/version before building the install context
- Renderer:
  - `src/core/search/F95BrowserWorkspace.jsx` now extracts the thread title from `h1.p-title-value` more honestly:
    - it removes XenForo label nodes from the cloned title element
    - then applies the same prefix-cleaning heuristics before sending metadata into install flow
- Tests:
  - extended `test/f95DownloadSupport.test.js` with explicit assertions for:
    - `VN Ren'Py Stained Blood [v0.2] [Obsidian Desire Labs]`
    - plain titles without prefix noise

Files changed in this slice:

- `src/main/f95/downloadSupport.js`
- `src/main.js`
- `src/core/search/F95BrowserWorkspace.jsx`
- `test/f95DownloadSupport.test.js`
- `tasks.md`

Checks run:

- `node --test test/f95DownloadSupport.test.js`
- `npm run ci:check`

What is still missing here:

- this fixes the concrete badge-noise case shown in the screenshots
- older already-imported bad titles are not auto-migrated yet
- some exotic F95 title formats may still need more examples before the parser can be called “done”

### 2026-04-04 — Stage 1 F95 install hardening: masked-link resolution + bogus payload rejection

- Status: partial
- Progress: 79%
- TЗ coverage: closes the real install bug where Atlas downloaded F95's anti-bot HTML page, marked it as installed, and polluted the library with fake entries

What was done:

- Stopped treating F95 `masked` pages as downloadable packages.
- Added proper resolution of F95 masked mirrors before `downloadURL()` is started.
- Added first direct-host normalization for Pixeldrain so viewer pages are converted into the official direct download endpoint instead of downloading the landing page HTML.
- Added payload validation before install/import:
  - HTML/text pages are now rejected;
  - empty files are rejected;
  - archive signatures are recognized even when the filename has no extension.
- Invalid HTML/text payloads are no longer marked as `completed` and are cleaned up instead of landing in the library as fake installs.

How it was implemented:

- Main:
  - added `src/main/f95/downloadSupport.js`
  - this module now owns:
    - masked-link POST resolution against F95;
    - host-specific URL normalization;
    - downloaded payload inspection/validation
- `src/main.js` now:
  - resolves the selected F95 mirror before queueing the Electron download
  - stores the resolved host in the download context/UI
  - validates the finished payload before install/import
  - rejects bogus HTML/text payloads and marks the download as failed instead of installed
  - preserves archive install behavior, including archive deletion after successful extraction
- Renderer:
  - `src/core/search/F95BrowserWorkspace.jsx` now surfaces the resolved host in the queued-install status text when available
- Tests:
  - added `test/f95DownloadSupport.test.js` for:
    - Pixeldrain viewer URL normalization
    - masked F95 HTML page rejection
    - archive signature detection without a filename extension

Files changed in this slice:

- `src/main.js`
- `src/main/f95/downloadSupport.js`
- `src/core/search/F95BrowserWorkspace.jsx`
- `test/f95DownloadSupport.test.js`
- `tasks.md`

Checks run:

- `node --test test/f95DownloadSupport.test.js`
- `npm run ci:check`

What is still missing here:

- this fixes the concrete broken case where F95 `masked` HTML was being saved as if it were the game
- host automation is still not universal:
  - Pixeldrain single-file links now have a real direct-download path
  - more hosters still need explicit resolvers/flows
- some mirrors will still require browser interaction or captcha and should fail honestly until those flows are implemented

## Completed Work Log

### 2026-04-04 — Stage 1 downloads UX: global footer downloads panel with active state and history

- Status: partial
- Progress: 76%
- TЗ coverage: closes a missing operator-facing part of the new F95 install flow by making background downloads observable outside the search page

What was done:

- Turned the dead footer `Downloads` button into a real popup panel.
- Added a global downloads list with:
  - active queued/downloading/installing items
  - completed and failed history
  - percent
  - transferred bytes
  - current speed
  - status text
  - source host / file name
  - last update timestamp
- Added an active-download badge to the footer button.
- Fixed a consistency bug where failed `downloadURL()` starts could otherwise leave a stuck queued item in the downloads list.

How it was implemented:

- Main:
  - added `src/main/f95/downloadsStore.js` as the in-memory download state store for active items and recent history
  - `src/main.js` now records lifecycle transitions for every F95 install request:
    - queued
    - downloading
    - installing
    - completed
    - error
  - each transition is broadcast through a dedicated renderer event instead of overloading the page-local progress banner
- Preload:
  - `src/renderer.js` now exposes:
    - `getF95Downloads()`
    - `onF95DownloadsChanged()`
- Renderer:
  - added `src/core/downloads/DownloadsPanel.jsx`
  - `src/App.jsx` now:
    - loads the initial downloads snapshot from main
    - subscribes to global downloads updates
    - opens/closes the popup from the footer `Downloads` button
    - shows the active count badge in the footer

Files changed in this slice:

- `src/main.js`
- `src/main/f95/downloadsStore.js`
- `src/renderer.js`
- `src/core/downloads/DownloadsPanel.jsx`
- `src/index.html`
- `src/App.jsx`
- `tasks.md`

Checks run:

- `npm run ci:check`

What is still missing here:

- the downloads list is in-memory history for the current app session, not persisted restart-to-restart
- there is still no pause/resume/cancel control for individual downloads from the panel
- mirror handling is still only as strong as the current direct-download path; complex hoster flows with timers/captchas still need separate work

### 2026-04-04 — Stage 1 F95 integration: real auth-backed search workspace + download/install pipeline

- Status: partial
- Progress: 72%
- TЗ coverage: replaces the fake third-page site search with a real F95 session flow and adds the first honest path from remote thread to installed local library entry

What was done:

- Replaced the third sidebar page with an embedded F95 browser workspace instead of cached local metadata cards.
- Added a dedicated persistent F95 session:
  - login window on its own Electron partition;
  - auth state events pushed back into the renderer;
  - logout support that clears only the dedicated F95 partition.
- Enabled live search through the real `F95 Latest Updates alpha` page by loading the site itself in the third workspace.
- Added thread install flow from the current F95 page:
  - inspect current thread in the embedded browser;
  - extract candidate download links from the starter post;
  - choose a mirror;
  - queue the download through the authenticated Electron session.
- Added Electron-side download capture for the F95 partition:
  - files are saved into centralized writable storage under app paths;
  - progress is streamed back into the renderer;
  - completed downloads are installed automatically.
- Added install/import plumbing for downloaded packages:
  - archives are extracted into the configured game library (or app-managed fallback);
  - standalone downloaded executables/files are moved into a dedicated game folder;
  - resulting installs are pushed through the existing import pipeline and land in the local library.
- Tightened security around the external login window:
  - the F95 login window no longer uses the app preload bridge, so the remote site does not get access to `electronAPI`.

How it was implemented:

- Main:
  - `src/main/f95/session.js` introduces the dedicated `persist:f95-auth` session helpers and login window creation
  - `src/main.js` now:
    - enables `webviewTag` only for the main app window
    - initializes the dedicated F95 session only after `app.whenReady()` so Electron does not crash on boot
    - publishes F95 auth IPC endpoints
    - registers `will-download` on the dedicated F95 session
    - installs downloaded archives/files into the library via the existing import flow
    - broadcasts auth and download progress events back to the renderer
- Writable storage:
  - `src/main/appPaths.js` now exposes a dedicated downloads directory through centralized app paths
- Preload:
  - `src/renderer.js` now exposes:
    - F95 auth status/login/logout methods
    - install request IPC
    - F95 auth/download progress event subscriptions
- Renderer:
  - `src/core/search/F95BrowserWorkspace.jsx` is the new live search workspace
  - it embeds the real F95 page, tracks navigation, opens login when needed, extracts download mirrors from the current thread and starts installs
  - after the first runtime smoke exposed a post-login black screen, the workspace was reworked to mount `webview` imperatively instead of letting React own the guest element directly
  - after the next smoke exposed `getURL()/canGoBack()` calls before `dom-ready`, guest state syncing was guarded so browser methods are only used after the embedded page is actually ready
  - after the next UX smoke showed thread links opening throwaway popup windows, same-host F95 links are now forced to stay inside the embedded workspace instead of spawning useless secondary windows
  - the workspace now also surfaces explicit guest load/crash errors instead of failing as a silent black rectangle
  - `src/App.jsx` now routes the third section into this workspace instead of local catalog results
  - `src/index.html` loads the new workspace component

Files changed in this slice:

- `src/main.js`
- `src/main/appPaths.js`
- `src/main/f95/session.js`
- `src/renderer.js`
- `src/core/search/F95BrowserWorkspace.jsx`
- `src/App.jsx`
- `src/index.html`
- `tasks.md`

Checks run:

- `npm run ci:check`
- `npx prettier --check src/App.jsx src/core/search/F95BrowserWorkspace.jsx src/renderer.js src/main.js src/main/f95/session.js src/main/appPaths.js src/index.html`

What is still missing here:

- no real end-to-end smoke was run with a live F95 account, so auth success, mirror extraction and actual downloads are still unproven against the current site
- thread parsing is intentionally heuristic right now:
  - title/version/creator extraction is best-effort from the current thread page
  - some threads will need stricter parsing once real examples are tested
- the install path currently targets the configured game folder or the managed fallback, but there is still no advanced per-install destination picker in the main renderer flow
- the older cached catalog search code still exists in the codebase, but it is no longer the active third-page UX

### 2026-04-04 — Stage 1 renderer correction: search page now targets site catalog, not local library

- Status: partial
- Progress: 67%
- TЗ coverage: fixes a wrong renderer interpretation and brings the third sidebar section in line with the requested product flow

What was done:

- Split local-library search from site-catalog search instead of pretending one filter state can serve both.
- Kept local search on the main library/update views through the header search box.
- Reworked the third sidebar page into actual site search over cached Atlas/F95 metadata.
- Added dedicated site-result cards with:
  - remote banner;
  - F95 id;
  - likes/views/replies/rating;
  - tags and overview;
  - direct open of the F95 thread;
  - jump back into the local library when the entry is already mapped.
- Fixed site-filter option quality so languages are now split into real language values instead of raw comma-joined strings.

How it was implemented:

- Shared:
  - added `src/shared/siteSearch.js` with pure helpers for site-filter normalization, splitting, filtering and sorting
- Main/database:
  - added `searchSiteCatalog()` in `src/database.js`
  - search reads from `atlas_data` + `f95_zone_data` and enriches entries with installed-library linkage through `atlas_mappings`
  - `getUniqueFilterOptions()` now normalizes language/tag options more honestly for site search
- IPC/preload:
  - new `search-site-catalog` IPC in `src/main.js`
  - new `searchSiteCatalog()` preload bridge in `src/renderer.js`
- Renderer:
  - `src/App.jsx` now has separate state for:
    - local library query
    - site search filters/results/loading/error
  - `src/core/search/SiteSearchResults.jsx` renders the site-search result list
  - `src/core/SearchSidebar.jsx` now supports default filter presets and hiding irrelevant filters such as local update-only mode
  - `src/core/SearchBox.jsx` no longer auto-routes every keystroke into the search page; context now decides whether the header box searches local library or site catalog

Files changed in this slice:

- `src/App.jsx`
- `src/core/SearchBox.jsx`
- `src/core/SearchSidebar.jsx`
- `src/core/search/SiteSearchResults.jsx`
- `src/database.js`
- `src/main.js`
- `src/renderer.js`
- `src/shared/siteSearch.js`
- `src/index.html`
- `test/siteSearch.test.js`
- `tasks.md`

Checks run:

- `npm run ci:check`

What is still missing here:

- site search is powered by the locally cached Atlas/F95 dataset, not live network scraping from the F95 site
- the search page is now functionally correct, but it still lacks richer actions like import/match from site result directly into library flow
- no manual renderer smoke was run yet for the corrected search/page switching behavior

### 2026-04-04 — Stage 1 renderer UX: real sidebar sections + dedicated search workspace

- Status: partial
- Progress: 63%
- TЗ coverage: advances the roadmap item for a proper library UI on top of SQLite-backed data instead of decorative toggles and half-dead search controls

What was done:

- Reworked the left sidebar into actual section navigation:
  - full library as the default landing page;
  - a dedicated updates page;
  - a dedicated search page;
  - settings still opens the existing settings window for now.
- Replaced the old update-only toggle in the sidebar with a real updates view backed by `isUpdateAvailable`.
- Promoted search from an overlay-only filter panel to a full workspace with docked filters and result grid.
- Wired the header search box to real app state so typing now opens the search section and updates the search query instead of doing almost nothing.
- Expanded renderer-side search controls that were either missing or misleading before:
  - title/creator search scope;
  - release-window filter;
  - language filter;
  - censorship filter;
  - working sort modes for `name`, `date`, `likes`, `views`, `rating`.

How it was implemented:

- Renderer boundary only:
  - no IPC contract changes;
  - no preload changes;
  - no main-process changes required for this slice.
- `src/App.jsx` now owns explicit section state:
  - `library`
  - `updates`
  - `search`
- `src/App.jsx` also now separates the three data views cleanly:
  - full library list;
  - updates-only list;
  - search-result list based on the active filter stack.
- `src/core/Sidebar.js` was simplified into a navigation component instead of mixing navigation with side-effect buttons.
- `src/core/SearchBox.jsx` is now controlled by app state and acts as an entry point into the full search workspace.
- `src/core/SearchSidebar.jsx` now supports a docked mode and syncs with app-level filter state instead of pretending the overlay itself is the whole search UX.

Files changed in this slice:

- `src/App.jsx`
- `src/core/Sidebar.js`
- `src/core/SearchBox.jsx`
- `src/core/SearchSidebar.jsx`
- `tasks.md`

Checks run:

- `npm run ci:check`

What is still missing here:

- there is still no embedded settings page inside the main renderer; the sidebar settings item still opens the separate settings window
- this slice improves navigation/search UX, but it does not replace the legacy scanner/importer architecture
- no manual Electron smoke was run yet specifically for this new sidebar/search flow
- there is still no UI automation coverage for renderer navigation

### 2026-04-04 — Stage 0 foundation: fork bootstrap and writable storage

- Status: partial
- Progress: 82%
- TЗ coverage: fixes the first mandatory bug and lays the base for later scanner/save/sync work

What was done:

- Initialized the workspace as a git repo and checked out upstream `towerwatchman/Atlas`.
- Moved writable storage to `app.getPath('userData')` through a single path module.
- Added one-shot legacy migration from old Atlas layouts:
  - development legacy source: `src/data`, `src/launchers`
  - packaged legacy source: `app.getAppPath()/../../data`, `.../launchers`
- Switched writable image storage from old `data/images` semantics to `cache/images`, while keeping backward resolution for old DB rows.
- Removed main/database dependence on install/resource-relative writable paths.
- Added focused local quality floor:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run ci:check`
- Added a non-release GitHub Actions check workflow.

How it was implemented:

- New modules:
  - `src/main/appPaths.js`
  - `src/main/assetPaths.js`
  - `src/main/databasePaths.js`
- Main integration:
  - `src/main.js` now resolves `appPaths` once and passes normalized paths down into DB/file consumers
  - banner conversion, image download, launcher/game storage, config and DB access now route through `appPaths`
- Database integration:
  - `src/database.js` now resolves DB path from normalized app paths
  - banner/preview read/delete functions now resolve file paths through `assetPaths` instead of `app.getAppPath()`
- Verification:
  - tests in `test/appPaths.test.js`
  - tests in `test/databasePaths.test.js`

Files changed in this slice:

- `package.json`
- `package-lock.json`
- `src/main.js`
- `src/database.js`
- `.github/workflows/check.yml`
- `.eslintrc.json`
- `tsconfig.typecheck.json`
- `src/main/appPaths.js`
- `src/main/assetPaths.js`
- `src/main/databasePaths.js`
- `test/appPaths.test.js`
- `test/databasePaths.test.js`

Checks run:

- `npm install`
- `npm run build:css`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run ci:check`

Remaining before Stage 0 can be called done:

- Run manual Electron smoke in dev mode
- Run packaged smoke to confirm nothing writes into install directory
- Document manual verification steps in a dedicated place or in this file

### 2026-04-04 — Stage 0.5: SQLite migrations skeleton

- Status: partial
- Progress: 88%
- TЗ coverage: begins the next mandatory roadmap item after `appPaths`

What was done:

- Added migration infrastructure for SQLite instead of relying only on startup `CREATE TABLE IF NOT EXISTS` calls.
- Converted the existing schema bootstrap into migration `001_initial`.
- Switched DB initialization to apply migrations and record them in `schema_migrations`.
- Made DB initialization idempotent for the active DB path instead of reopening the same database blindly.
- Added a migration test that checks first-run application and verifies the migration is persisted.

How it was implemented:

- New modules:
  - `src/main/db/migrations/001_initial.js`
  - `src/main/db/migrations/index.js`
  - `src/main/db/runMigrations.js`
- `src/database.js` now resolves DB path and applies migrations during initialization.

Files changed in this slice:

- `src/database.js`
- `src/main/db/openDatabase.js`
- `src/main/db/migrations/001_initial.js`
- `src/main/db/migrations/index.js`
- `src/main/db/runMigrations.js`
- `test/migrations.test.js`

Checks run:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run ci:check`

What is still missing here:

- Add next migration(s) instead of a single bootstrap migration once local schema starts changing
- Decide whether to split `database.js` into `db/query` and `db/service` slices before Stage 1 grows further

### 2026-04-04 — Stage 1 start: `scan_sources`

- Status: partial
- Progress: 58%
- TЗ coverage: closes the first missing local-core entity after storage and migrations

What was done:

- Added `scan_sources` as a real SQLite model through migration `002_scan_sources`.
- Added typed main-side store and service for scan source CRUD.
- Added IPC endpoints for listing, creating, updating and deleting scan sources.
- Added a dedicated Settings UI page for scan sources.
- Added runtime tests for scan source CRUD and migration coverage.

How it was implemented:

- DB schema:
  - migration `src/main/db/migrations/002_scan_sources.js`
  - table fields: `id`, `path`, `is_enabled`, `created_at`, `updated_at`
- Main-side logic:
  - `src/main/db/scanSourcesStore.js` for DB CRUD
  - `src/main/scanSources.js` for validation, normalization and user-facing error payloads
  - `src/main.js` IPC handlers:
    - `get-scan-sources`
    - `add-scan-source`
    - `update-scan-source`
    - `remove-scan-source`
- Preload:
  - `src/renderer.js` now exposes scan-source methods
- Renderer:
  - `src/core/settings/ScanSources.jsx`
  - `src/core/settings/Settings.jsx`
  - `src/core/settings/settingsIcons.js`
  - `src/settings.html`

Files changed in this slice:

- `AGENTS.md`
- `src/main/db/migrations/002_scan_sources.js`
- `src/main/db/migrations/index.js`
- `src/main/db/scanSourcesStore.js`
- `src/main/scanSources.js`
- `src/main.js`
- `src/renderer.js`
- `src/core/settings/ScanSources.jsx`
- `src/core/settings/Settings.jsx`
- `src/core/settings/settingsIcons.js`
- `src/settings.html`
- `test/migrations.test.js`
- `test/scanSourcesStore.test.js`

Checks run:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run ci:check`

What is still missing here:

- Wire recursive scan execution to all enabled scan sources instead of manual single-folder scan only
- Add `scan_jobs` table and job history/progress persistence
- Add UI entry points from the main library for launching rescan of configured sources
- Move current folder-scanner logic out of the legacy importer flow into a proper library scan workflow

### 2026-04-04 — Stage 1 extension: `scan_jobs` and enabled-source scan runner

- Status: partial
- Progress: 54%
- TЗ coverage: moves scanning one step closer to a real multi-source workflow instead of a single manually selected folder

What was done:

- Added `scan_jobs` migration and store.
- Added a main-side scan runner that iterates enabled `scan_sources` and records a scan job.
- Added IPC for recent scan job history.
- Extended importer UI with a `Scan Enabled Sources` action.
- Extended scan-sources settings UI with recent job history.
- Fixed missing preload `removeAllListeners` bridge used by importer cleanup.

How it was implemented:

- DB schema:
  - `src/main/db/migrations/003_scan_jobs.js`
- DB stores:
  - `src/main/db/scanJobsStore.js`
- Main-side runner:
  - `src/main/scanRunner.js`
  - current strategy wraps the legacy `f95scanner` and aggregates progress/results across enabled sources
  - current mode is still importer-oriented candidate discovery, not final local-library persistence
- IPC:
  - `get-scan-jobs`
  - `start-scan-sources`
- Renderer/UI:
  - `src/renderer.js`
  - `src/core/importer/importer.jsx`
  - `src/core/settings/ScanSources.jsx`

Files changed in this slice:

- `src/main/db/migrations/003_scan_jobs.js`
- `src/main/db/migrations/index.js`
- `src/main/db/scanJobsStore.js`
- `src/main/scanRunner.js`
- `src/main.js`
- `src/renderer.js`
- `src/core/importer/importer.jsx`
- `src/core/settings/ScanSources.jsx`
- `test/migrations.test.js`
- `test/scanJobsStore.test.js`

Checks run:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run ci:check`

What is still missing here:

- Move from importer candidate scan to true library scan that persists discovered local games
- Persist per-source/per-run progress and richer scan diagnostics
- Add cancellation and resilient partial-failure handling instead of best-effort looping
- Connect scan execution entry points into the main library UX instead of settings/importer only

### 2026-04-04 — UX pass inspired by YAM entry flow

- Status: partial
- Progress: 62%
- TЗ coverage: improves usability of adding/scanning games without inheriting YAM's folder-name detection limitations

What was done:

- Changed importer entry flow to start from explicit action selection instead of dumping the user directly into raw scan settings.
- Added clear actions:
  - `Scan Enabled Sources`
  - `Import From Folder`
  - `Import Steam Games`
- Added `Back` navigation between source selection, settings and scan results.
- Exposed scan mode in scan results so the user can understand whether the current run is manual folder import, steam import or enabled-source scan.

How it was implemented:

- `src/core/importer/importer.jsx`
  - initial view changed from `settings` to `source`
  - added explicit handlers for folder import, steam import and enabled-source scan
  - source screen now displays configured scan sources and disables automatic scan if none are enabled
- This was intentionally borrowed from YAM only at the UX level:
  - explicit choice-first add flow
  - clearer entry into import/update actions
  - but not their folder-name-based detection model

Files changed in this slice:

- `src/core/importer/importer.jsx`

Checks run:

- `npm run lint`
- `npm run typecheck`
- `npm run test`

What is still missing here:

- better in-app diagnostics during library scan/import
- a non-importer library scan screen in the main app itself
- replacement of legacy importer candidate semantics with detector-backed library entities

### 2026-04-04 — Stage 1 hardening: cancellable scans, warnings and Ren'Py confidence

- Status: partial
- Progress: 68%
- TЗ coverage: closes three missing scanner requirements at once: cancellation, resilience to unreadable folders and classifier confidence/reasons visibility

What was done:

- Added renderer-bound scan sessions so the app can reject duplicate scans per window and cancel an active recursive scan.
- Hardened the legacy recursive scanner against unreadable directories instead of letting a single `EACCES`/`EPERM` path kill the whole run.
- Added warning diagnostics flow from scanner to renderer and into stored `scan_jobs` notes.
- Added first real detector scoring surface for Ren'Py and exposed detection confidence/reasons in importer results.
- Added cancel controls in importer scan UI and in the main library rescan entry point.
- Fixed a real main-process bug where `createImporterWindow()` shadowed the global `importerWindow`, which made directory dialogs rely on bad ownership state.

How it was implemented:

- New main module:
  - `src/main/scanSessions.js`
- Scanner changes:
  - `src/core/scanners/f95scanner.js`
  - added cancellation checks via `scanSession`
  - wrapped directory reads in a safe helper that records warnings instead of hard-failing the run
  - kept sending incremental progress/results while collecting diagnostics
  - enriched candidates with generic detection score + Ren'Py-specific reasons
- Runner/main integration:
  - `src/main/scanRunner.js`
  - `src/main.js`
  - `src/renderer.js`
  - added `cancel-scan` IPC
  - `start-scan`, `start-scan-sources` and `scan-library` now run through scan sessions
  - `scan_jobs` completion notes now include warnings and a diagnostics sample
- Renderer/UI:
  - `src/core/importer/importer.jsx`
  - `src/App.jsx`
  - `src/core/settings/ScanSources.jsx`
  - importer now shows detection score/reasons and recent warnings
  - importer and library rescan now expose a real cancel action while scanning is in progress
  - recent scan jobs now surface warning counts and the latest issue summary
- Tests:
  - `test/renpyDetector.test.js`
  - `test/scanSessions.test.js`

Files changed in this slice:

- `src/main/scanSessions.js`
- `src/core/scanners/f95scanner.js`
- `src/main/scanRunner.js`
- `src/main.js`
- `src/renderer.js`
- `src/core/importer/importer.jsx`
- `src/App.jsx`
- `src/core/settings/ScanSources.jsx`
- `test/renpyDetector.test.js`
- `test/scanSessions.test.js`
- `tasks.md`

Checks run:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npx prettier --check src/App.jsx src/core/importer/importer.jsx src/core/settings/ScanSources.jsx`

What is still missing here:

- scanner persistence now exists for enabled-source scans, but scan review still feeds importer-oriented candidates instead of a dedicated discovery model
- cancellation currently covers the recursive scan phase, not the later import phase
- there is still no per-directory or per-source persistent progress timeline, only recent job summaries
- engine detection is still primitive outside of Ren'Py and executable signature heuristics

### 2026-04-04 — Stage 1 persistence: `scan_candidates` + ADR for scan engine direction

- Status: partial
- Progress: 57%
- TЗ coverage: replaces ephemeral enabled-source scan output with a real persisted SQLite model and records the design decision explicitly as required for scan engine changes

What was done:

- Added migration `004_scan_candidates` so enabled-source scans now persist discovered candidates locally.
- Added a dedicated scan-candidate store instead of dumping this into `games`/`versions`.
- Enabled-source scans now enrich candidates with source/job linkage before persistence.
- Import flow now marks persisted candidates as `imported` when they are successfully added to the library.
- Added a recent detected candidates section to scan-source settings so the new persistence layer is visible in the UI immediately.
- Added an ADR documenting why scan candidates live in their own table instead of polluting installed-library entities.

How it was implemented:

- DB schema:
  - `src/main/db/migrations/004_scan_candidates.js`
- DB/store/service:
  - `src/main/db/scanCandidatesStore.js`
  - `src/main/scanCandidates.js`
  - stores `folder_path`, source/job linkage, ids, detection score/reasons, match count, status and imported linkage
- Runner/main integration:
  - `src/main/scanRunner.js`
  - `src/main.js`
  - enabled-source scans now persist candidates after each job
  - successful imports now attempt to mark candidate rows as `imported`
  - new IPC: `get-scan-candidates`
- Renderer/UI:
  - `src/renderer.js`
  - `src/core/settings/ScanSources.jsx`
  - settings now show recent persisted candidates with confidence, reasons and import status
- Architecture note:
  - `docs/adr/0001-scan-candidate-persistence.md`

Files changed in this slice:

- `src/main/db/migrations/004_scan_candidates.js`
- `src/main/db/migrations/index.js`
- `src/main/db/scanCandidatesStore.js`
- `src/main/scanCandidates.js`
- `src/main/scanRunner.js`
- `src/main.js`
- `src/renderer.js`
- `src/core/settings/ScanSources.jsx`
- `docs/adr/0001-scan-candidate-persistence.md`
- `test/migrations.test.js`
- `test/scanCandidatesStore.test.js`
- `tasks.md`

Checks run:

- `npm run ci:check`
- `npx prettier --check src/App.jsx src/core/importer/importer.jsx src/core/settings/ScanSources.jsx tasks.md docs/adr/0001-scan-candidate-persistence.md`

What is still missing here:

- `scan_candidates` is a transitional persistence layer, not the final discovery/library model
- there is still no dedicated review/import workflow on top of the main-app discovery layer
- importer semantics still dominate the scan-review flow
- candidate dedupe/matching is still path-based and not yet a richer identity model

### 2026-04-04 — Stage 1 UI follow-through: main-app discovery panel

- Status: partial
- Progress: 44%
- TЗ coverage: moves persisted scan output out of settings-only storage and into the main app, which is the first real step away from importer-only scan UX

What was done:

- Added a main-app `Discovery` panel backed by persisted `scan_candidates`.
- Discovery panel can refresh recent candidates, show confidence/reasons/status and open the detected folder.
- Library rescan now refreshes discovery data after completion.
- Fixed `open-directory` so it opens the directory itself when the provided path is already a directory instead of always jumping to its parent.

How it was implemented:

- Main/IPC:
  - `src/main.js`
  - `open-directory` now checks whether the target path is already a directory
- Renderer:
  - `src/App.jsx`
  - added `Discovery` footer action
  - added overlay panel with recent scan candidates
  - added refresh and close controls
  - panel reads from persisted SQLite state via `get-scan-candidates`

Files changed in this slice:

- `src/main.js`
- `src/App.jsx`
- `tasks.md`

Checks run:

- `npm run ci:check`
- `npx prettier --check src/App.jsx src/core/importer/importer.jsx src/core/settings/ScanSources.jsx tasks.md docs/adr/0001-scan-candidate-persistence.md`

What is still missing here:

- discovery panel is currently read-only; it does not yet provide a proper review/import queue
- there is still no explicit candidate decision state such as `approved`, `ignored`, `needs_review`
- importer window still remains the only place where ambiguous matches can be edited before import

### 2026-04-04 — Stage 1 UX pass: scan hub + richer in-library game details

- Status: partial
- Progress: 61%
- TЗ coverage: makes repeat scan usable from the main library UI and brings version/update visibility plus site screenshots/details closer to the YAM/F95Checker direction without shoving more logic into renderer

What was done:

- Added a shared pure version-comparison utility so update availability is now computed consistently in both `getGames()` and `getGame()`.
- Exposed `newestInstalledVersion` alongside `isUpdateAvailable` for library cards and details UI.
- Wired the sidebar `Updates` entry to a real update-only library filter with a badge count instead of leaving it decorative.
- Replaced the old read-only discovery overlay with a broader `Scan Hub`:
  - configured scan sources;
  - recent scan jobs;
  - persisted discovery candidates;
  - repeat rescan and cancel actions from the same place.
- Added a right-side selected-game details panel in the main app:
  - banner;
  - installed/current/latest version status;
  - installed versions list with quick folder open;
  - site metadata summary;
  - cached screenshots with fullscreen preview.
- Tightened main-library selection refresh so the selected game panel updates when imports/rescans refresh the underlying record.

How it was implemented:

- Shared logic:
  - `src/shared/versionUpdate.js`
  - version parsing/comparison and newest-installed selection are now centralized
- Main/database integration:
  - `src/database.js`
  - both list/detail queries now use the shared version state instead of two conflicting heuristics
- Renderer/UI:
  - `src/App.jsx`
  - `src/core/Sidebar.js`
  - `src/core/GameBanner.js`
  - `src/core/library/LibraryDetailsPanel.jsx`
  - `src/core/library/ScanHubPanel.jsx`
  - `src/index.html`
- Quality:
  - `test/versionUpdate.test.js`
  - lint/typecheck coverage extended to `src/shared/**/*.js`

Files changed in this slice:

- `package.json`
- `.eslintrc.json`
- `tsconfig.typecheck.json`
- `src/shared/versionUpdate.js`
- `src/database.js`
- `src/App.jsx`
- `src/core/Sidebar.js`
- `src/core/GameBanner.js`
- `src/core/library/LibraryDetailsPanel.jsx`
- `src/core/library/ScanHubPanel.jsx`
- `src/index.html`
- `test/versionUpdate.test.js`
- `tasks.md`

Checks run:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npx prettier --check src/App.jsx src/core/GameBanner.js src/core/Sidebar.js src/core/library/LibraryDetailsPanel.jsx src/core/library/ScanHubPanel.jsx`

What is still missing here:

- repeat scan still relies on the legacy scanner/importer core instead of a dedicated local-library scan model
- `Scan Hub` still does not persist explicit review states like `ignored` / `approved` / `needs_review`
- the selected-game details panel uses cached DB/site data; it does not yet perform live F95 fetching
- there is still no automatic version-update workflow beyond surfacing the update status and opening the source page

### 2026-04-04 — Stage 1 metadata follow-through: prettier titles + site media fallback

- Status: partial
- Progress: 68%
- TЗ coverage: fixes the main usability gap where auto-scanned library entries looked worse than the site metadata already stored locally

What was done:

- Fixed library-card/media behavior so games can now show site banner/screenshot URLs even when local cached copies are not downloaded yet.
- Switched library rescan defaults to fetch banner and screenshot media instead of hard-disabling them during auto-import.
- Added import-side metadata merge so matched games prefer Atlas/F95 title/creator/engine and only keep local version when it is actually known.
- Stopped the scanner from silently inventing `1.0` as a fake version when parsing fails; unresolved local versions are now marked honestly as `Unknown`.
- Fixed the `searchAtlas()` preference for entries with `f95_id`:
  - before this slice it filtered with a Promise instead of a boolean and could keep noisy ambiguous matches;
  - now it actually narrows to rows that already have linked F95 metadata.
- Added display-level title/creator fields in the main library UI so already imported mapped games stop showing ugly local folder names on cards and in the list.

How it was implemented:

- Main/database:
  - `src/database.js`
  - added remote banner fallback from `f95_zone_data.banner_url`
  - added remote preview fallback from `f95_zone_data.screens`
  - added `displayTitle` / `displayCreator` in list/detail payloads
  - fixed `searchAtlas()` F95-preference filtering
  - extended `getAtlasData()` to include `version`
- Import pipeline:
  - `src/main/importMetadata.js`
  - `src/main.js`
  - import now merges Atlas metadata before storing a matched game/version
  - library rescan now uses media-enabled defaults instead of overriding them back to `false`
- Scanner:
  - `src/core/scanners/f95scanner.js`
  - unresolved parsed versions now become `Unknown` instead of fake `1.0`
- Renderer:
  - `src/App.jsx`
  - `src/core/GameBanner.js`
  - `src/core/library/LibraryDetailsPanel.jsx`
  - main-library filtering and card/details rendering now prefer display metadata when available
- Quality:
  - `test/importMetadata.test.js`

Files changed in this slice:

- `src/database.js`
- `src/main.js`
- `src/main/importMetadata.js`
- `src/core/scanners/f95scanner.js`
- `src/App.jsx`
- `src/core/GameBanner.js`
- `src/core/library/LibraryDetailsPanel.jsx`
- `test/importMetadata.test.js`
- `tasks.md`

Checks run:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run ci:check`
- `npx prettier --check src/main.js src/database.js src/App.jsx src/core/GameBanner.js src/core/scanners/f95scanner.js src/core/library/LibraryDetailsPanel.jsx src/main/importMetadata.js test/importMetadata.test.js tasks.md`

What is still missing here:

- if a game still has no reliable Atlas/F95 match, its title will remain local because inventing a fake site match would be worse
- current version detection is still mostly filename/path-based; there is no dedicated parser for common VN naming conventions yet
- old entries with no mapping still need either a better auto-match pass or an explicit review queue in `Scan Hub`

### 2026-04-04 — Stage 1 detection pass: F95-style folder name parsing

- Status: partial
- Progress: 64%
- TЗ coverage: reduces a real class of false negatives where games existed on disk but the scanner searched Atlas using dirty scene/F95 folder names

What was done:

- Added a dedicated F95-style folder-name parser for scan-time title/version extraction.
- Parser now strips common junk from folder names before Atlas lookup:
  - engine/status/platform tags;
  - `f95zone.to`-style prefixes;
  - underscore/dash separators;
  - inline version markers like `v0.5.1`, `Episode 3`, `Final`.
- Scanner now uses that parser instead of the old naive `split("-")` logic.
- Added focused tests for the parser on representative F95-style names.

How it was implemented:

- Shared logic:
  - `src/shared/scanTitleParser.js`
  - pure parser that returns normalized `title` + extracted `version`
- Scanner integration:
  - `src/core/scanners/f95scanner.js`
  - filename-based fallback parsing now runs through `parseScanTitle()`
- Quality:
  - `test/scanTitleParser.test.js`

Files changed in this slice:

- `src/shared/scanTitleParser.js`
- `src/core/scanners/f95scanner.js`
- `test/scanTitleParser.test.js`
- `tasks.md`

Checks run:

- `node -e "require('./src/core/scanners/f95scanner.js'); console.log('scanner ok')"`
- `npm run test`
- `npm run ci:check`
- `npx prettier --check src/shared/scanTitleParser.js test/scanTitleParser.test.js src/core/scanners/f95scanner.js tasks.md`

What is still missing here:

- parser-based cleanup improves matching, but it still cannot infer the exact F95 thread for genuinely ambiguous or heavily renamed folders
- scan engine recursion/orchestration is still legacy and may need a separate pass if some directories are being skipped structurally rather than misnamed
- creator extraction from folder names is still weak by design; right now the biggest win is title cleanup, not author inference

### 2026-04-04 — Update subsystem pass: explicit app updater flow + safe archive extraction

- Status: partial
- Progress: 61%
- TЗ coverage: replaces the old “check something and immediately restart on download” behavior with a controllable updater flow, and moves archive unpacking into a reusable main-side module that is suitable for future game-update install work

What was done:

- Replaced inline `electron-updater` wiring in `main.js` with a dedicated controller module.
- Removed automatic `quitAndInstall()` immediately after download; install is now an explicit action.
- Added packaged-build app update flow:
  - check for updates
  - download update
  - install downloaded update
- Added dev-mode fallback that checks GitHub releases without pretending auto-download/install works in an unpackaged app.
- Added footer-level app update controls in the main UI instead of alert spam.
- Replaced inline archive extraction logic with a main-only archive module.
- Added archive entry validation to block path traversal and absolute-path extraction.
- Fixed a real reliability issue in the old codepath: current `rar` extraction logic was not something we should trust as a production base, so unpacking is now centralized and explicit.

How it was implemented:

- Shared:
  - `src/shared/appUpdate.js`
- Main updater:
  - `src/main/appUpdater.js`
  - keeps updater state
  - supports startup check, explicit download and explicit install
  - sends normalized `update-status` payloads to renderer
- Main archive layer:
  - `src/main/archive/extractArchive.js`
  - supports entry listing, safety validation and extraction dispatch by archive type
- Main integration:
  - `src/main.js`
  - new IPC:
    - `get-app-update-state`
    - `check-app-update`
    - `download-app-update`
    - `install-app-update`
  - `unzip-game` and archive import now use `extractArchiveSafely()`
- Renderer/UI:
  - `src/renderer.js`
  - `src/App.jsx`
  - main footer now exposes `Check App Update` / `Download App Update` / `Install App Update` depending on updater state
- Quality:
  - `test/appUpdater.test.js`
  - `test/extractArchive.test.js`

Files changed in this slice:

- `src/shared/appUpdate.js`
- `src/main/appUpdater.js`
- `src/main/archive/extractArchive.js`
- `src/main.js`
- `src/renderer.js`
- `src/App.jsx`
- `test/appUpdater.test.js`
- `test/extractArchive.test.js`
- `tasks.md`

Checks run:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run ci:check`
- `npx prettier --check src/App.jsx src/main.js src/renderer.js src/main/appUpdater.js src/main/archive/extractArchive.js src/shared/appUpdate.js test/appUpdater.test.js test/extractArchive.test.js tasks.md`

What is still missing here:

- this is a solid app-updater flow, but it is not yet a full game-update installer workflow
- the new archive module is the base for update install/unpack, not the final game-update wizard itself
- packaged manual smoke for updater behavior still has to be run; unit tests do not prove installer UX end-to-end
- Linux/macOS updater behavior was not manually verified in this workspace

### 2026-04-05 — Game removal flow: library-only, delete-with-save-preserve, full local wipe

- Status: partial
- Progress: 66%
- TЗ coverage: closes a missing user-critical library operation by moving game deletion into a main-side removal service with explicit modes for keeping saves or fully wiping local data

What was done:

- Added a dedicated removal contract with explicit modes:
  - remove from library only
  - remove installed files but preserve saves
  - remove installed files and detected saves
- Moved deletion orchestration into a main-side service instead of spreading it across renderer confirms and ad-hoc DB calls.
- Added install-path safety checks so Atlas refuses to delete:
  - drive roots
  - protected app/data/library roots
  - folders overlapping another library entry
- Wired game removal into the main library UI with a dedicated modal instead of raw confirm chains.
- Added the same removal flow to the legacy `GameDetailsWindow` so the old details path no longer depends on broken/missing folder-delete plumbing.
- Updated banner context menu with a direct `Remove Game` action.
- Expanded DB cleanup so full library removal now also clears:
  - `save_profiles`
  - `save_sync_state`
  - leftover per-record cached image folders
- Added coverage for:
  - delete installed files + preserve saves in local vault
  - full cleanup of installed files + detected Ren'Py AppData saves + local vault copies

How it was implemented:

- Shared contract:
  - `src/shared/gameRemoval.js`
  - centralizes removal modes and input validation
- Main deletion service:
  - `src/main/gameRemoval.js`
  - validates request payload
  - loads current game + save snapshot
  - performs safe backup before destructive delete when saves must be preserved
  - validates removable install paths against protected roots and other library entries
  - deletes install folders and optional save folders
  - removes stale local vault copy on full cleanup
- Main integration:
  - `src/main.js`
  - new IPC endpoint: `remove-library-game`
  - reuses `game-deleted` broadcast for renderer refresh
- Database cleanup:
  - `src/database.js`
  - `deleteGameCompletely()` now removes save-sync tables and record image cache directory in addition to old metadata cleanup
- Renderer bridge:
  - `src/renderer.js`
  - exposes `removeLibraryGame()`
- Main library UI:
  - `src/core/library/DeleteGameModal.jsx`
  - `src/core/library/LibraryDetailsPanel.jsx`
  - `src/core/GameBanner.js`
  - `src/App.jsx`
  - added product-facing removal modal, remove button in details panel, and context-menu action
- Legacy details window:
  - `src/core/banner/GameDetailsWindow.jsx`
  - `src/gamedetails.html`
  - switched full game deletion to the same modal/service path
- HTML wiring:
  - `src/index.html`
  - `src/gamedetails.html`
- Tests:
  - `test/gameRemoval.test.js`

Rationale:

- The old implementation was wrong architecturally:
  - renderer-side confirm chains were deciding destructive FS behavior
  - last-version removal and full-game removal were coupled badly
  - the old details window depended on a non-existent recursive folder-delete bridge
  - DB cleanup still left sync/save metadata behind
- The new path keeps destructive logic in `main`, keeps renderer as presentation, and fails closed when folder/save deletion is unsafe.

Checks run:

- `npx prettier --write src/shared/gameRemoval.js src/main/gameRemoval.js src/database.js src/main.js src/renderer.js src/core/library/DeleteGameModal.jsx src/core/library/LibraryDetailsPanel.jsx src/core/GameBanner.js src/App.jsx src/core/banner/GameDetailsWindow.jsx src/index.html src/gamedetails.html test/gameRemoval.test.js`
- `npm run lint`
- `npm run typecheck`
- `node --test test/gameRemoval.test.js`
- `npm run test`

What is still missing here:

- no manual Electron smoke was run for the new modal/remove flows; only automated tests were run
- multi-version delete still only removes version records, not version folders; this slice focused on whole-game removal
- save cleanup is intentionally strict: if Atlas cannot classify an external save folder safely, it refuses full wipe instead of guessing
- if we later want per-version folder deletion, that should reuse the same safety service rather than introducing a second deletion path

### 2026-04-05 — Context menu routing fix + expanded library actions

- Status: partial
- Progress: 68%
- TЗ coverage: fixes a real regression in the library context menu and expands it with product-level actions without pushing destructive UI behavior into `main`

What was done:

- Fixed the broken context-menu action path for `removeGame`.
- Restored proper `main -> renderer` routing for UI-owned context-menu commands.
- Added an update action to the game-card context menu, so updateable titles can open the existing update flow directly from right-click.
- Cleaned up the game-card menu structure with separators and clearer labels:
  - `Play`
  - `Open Game Folder`
  - `Update to ...` when available
  - `Open Game Page`
  - `View Details`
  - `Remove Game`
- Tightened menu generation so launch/folder entries are built only from usable versions instead of dumping invalid items blindly.

How it was implemented:

- Main:
  - `src/main.js`
  - `handleContextAction()` now accepts the originating webContents
  - UI-owned actions like `removeGame` and `updateGame` are forwarded back to renderer via `context-menu-command`
  - `processTemplate()` now preserves the sender context recursively instead of dropping it
- Renderer/library UI:
  - `src/App.jsx`
  - handles forwarded `updateGame` command in addition to `removeGame`
- Card menu:
  - `src/core/GameBanner.js`
  - expanded context menu items and cleaned label/group structure

Rationale:

- The bug was not in the delete modal itself. The real issue was that the context menu executed actions only inside `main`, while newer actions like remove/update are renderer-owned UI flows.
- Leaving it as-is would keep producing `Unknown action: removeGame` and would encourage duplicating delete/update UI logic in `main`, which is the wrong boundary.

Checks run:

- `npx prettier --write src/main.js src/core/GameBanner.js src/App.jsx`
- `npm run lint`
- `npm run typecheck`
- `npm run test`

What is still missing here:

- no manual Electron smoke was run for the right-click menu in a live window yet
- context menu still belongs only to game cards; details-window-specific context actions were not extended in this slice

### 2026-04-05 — Google Drive mirror resolver hardening

- Status: partial
- Progress: 97%
- ТЗ coverage: tightens another real mirror family by fixing Google Drive link resolution instead of pushing invalid Drive URLs into the downloader

What was done:

- Hardened Google Drive mirror resolution so it no longer dies on the first failed candidate URL.
- Added `resourcekey` awareness for Google Drive public links, which is required by some share links to build a valid direct download URL.
- Expanded embedded Drive URL parsing so the resolver now accepts both:
  - `.../uc?...`
  - `.../download?...`
- Expanded confirm/warning-form handling so Google Drive forms with `/download` actions are treated the same as `/uc`.
- Tightened the Drive resolver boundary so this logic now runs only for actual Google Drive hosts and does not interfere with other mirrors.
- Added regression coverage for:
  - `drive.usercontent.google.com/download?...` extraction
  - fallback from a share page to a resourcekey-aware direct candidate

How it was implemented:

- Main download resolver:
  - `src/main/f95/downloadSupport.js`
  - added:
    - Drive `resourcekey` extraction
    - candidate URL generation for multiple valid direct-download shapes
    - broader direct URL recognition for embedded Drive payload links
    - retry/fallback logic across candidate URLs instead of failing on the first 400/interstitial
- Tests:
  - `test/f95DownloadSupport.test.js`

Rationale:

- The bug was not only “GDrive download fails”. The deeper problem was that the resolver was too narrow and too eager to stop:
  - it missed valid `/download`-style Drive URLs
  - it dropped `resourcekey`
  - it treated a single bad candidate as a fatal outcome instead of trying the next valid shape
- Fixing the resolver is the right boundary. If the final URL is wrong, no downloader path will save it.

Checks run:

- `npx prettier --write src/main/f95/downloadSupport.js test/f95DownloadSupport.test.js`
- `node --test test/f95DownloadSupport.test.js`
- `npm run ci:check`

What is still missing here:

- no live Electron smoke was run yet against the exact `Family Secrets` Google Drive mirror from your screenshot
- other log lines you pasted are separate limitations and are not fixed by this slice:
  - Pixeldrain list mirrors
  - Gofile 401 guest/API issues
  - masked links that now require captcha confirmation

### 2026-04-05 — Captcha-required mirror resume flow

- Status: partial
- Progress: 98%
- ТЗ coverage: removes a dead-end install/update failure mode by turning captcha-required mirrors into a resumable user flow instead of a terminal error

What was done:

- Added a typed `captcha_required` mirror error in the main F95 resolver path.
- `install-f95-thread` now returns structured captcha metadata instead of only a dead text error.
- Added a reusable F95 browser window on the same persistent session partition, so the user can solve the captcha without losing auth state.
- Search workspace now handles captcha-required installs properly:
  - loads the captcha page in the embedded browser
  - keeps the pending install request in state
  - shows a real `Retry Install` action after the user finishes the challenge
- Library update modal now handles the same case:
  - shows `Solve Captcha`
  - opens a same-session F95 browser window
  - lets the user retry the update without rebuilding the whole update flow

How it was implemented:

- Main resolver typing:
  - `src/main/f95/downloadSupport.js`
  - new `MirrorActionRequiredError`
  - masked-link captcha and countdown-host captcha now throw typed `captcha_required` with `actionUrl`
- F95 browser window support:
  - `src/main/f95/session.js`
  - new reusable `createF95BrowserWindow(...)`
- Main IPC:
  - `src/main.js`
  - `install-f95-thread` now returns structured captcha action payloads
  - new IPC endpoint: `open-f95-browser-url`
- Renderer bridge:
  - `src/renderer.js`
  - exposes `openF95BrowserUrl(...)`
- Search workspace UI:
  - `src/core/search/F95BrowserWorkspace.jsx`
  - stores pending captcha installs, opens captcha page, and retries the same install after challenge completion
- Update modal UI:
  - `src/App.jsx`
  - `src/core/updates/F95UpdateModal.jsx`
  - stores captcha URL for update attempts and renders a real recovery action instead of a dead error
- Tests:
  - `test/f95DownloadSupport.test.js`

Rationale:

- The old behavior was wrong product-wise. Telling the user “open it in the embedded browser and finish the captcha there” without giving them an actual resume flow is not a feature.
- The right fix is not to bypass captcha. The right fix is to preserve user intent, let the user complete the required challenge on the same session, and then resume the exact install/update action.

Checks run:

- `npx prettier --write src/main/f95/session.js src/renderer.js src/core/search/F95BrowserWorkspace.jsx src/core/updates/F95UpdateModal.jsx src/App.jsx`
- `node --test test/f95DownloadSupport.test.js`
- `npm run ci:check`

What is still missing here:

- no live Electron smoke was run yet for a real captcha-required mirror after this slice
- this does not auto-solve captchas and should not; it only turns them into a proper resumable flow
- other mirror limitations remain separate:
  - Pixeldrain list mirrors
  - Gofile 401/API edge cases

### 2026-04-05 — Gofile handshake fix for public mirror installs

- Status: partial
- Progress: 99%
- ТЗ coverage: fixes a real broken public mirror path by matching Gofile's current guest-account + website-token handshake instead of using an incomplete, now-invalid API flow

What was done:

- Fixed `Gofile content lookup failed with HTTP 401` for public mirrors by updating Atlas to follow Gofile's current frontend flow.
- Guest account bootstrap now uses:
  - `POST /accounts`
  - `GET /accounts/website`
  - `GET /contents/{id}` with:
    - `Authorization`
    - `X-Website-Token`
    - `X-BL`
    - stable `User-Agent`
- Added a local implementation of the current `X-Website-Token` generation logic used by Gofile's frontend.
- Removed the old half-implemented content lookup that only sent `Authorization` and therefore broke on `401`.

How it was implemented:

- Main mirror resolver:
  - `src/main/f95/downloadSupport.js`
  - added:
    - Gofile website-token generation
    - guest-account sync against `/accounts/website`
    - full request headers required by `/contents/{id}`
- Tests:
  - `test/f95DownloadSupport.test.js`
  - extended to cover:
    - website-token generation shape
    - synced account step before content lookup
    - required headers on the content request

Rationale:

- The bug was not that Gofile was impossible. The bug was that Atlas was following an outdated/incomplete API path.
- Their own frontend still creates a guest account, but it also syncs that account and sends a computed `X-Website-Token`. We were missing that second half, so `401` was expected.

Checks run:

- `npx prettier --write src/main/f95/downloadSupport.js test/f95DownloadSupport.test.js`
- `node --test test/f95DownloadSupport.test.js`
- `npm run ci:check`

What is still missing here:

- no live Electron smoke was run yet against the exact failing Gofile mirror from your install flow
- this fixes the API handshake path; it does not solve mirrors that later require password/captcha/premium-only access
- separate mirror limitations still remain:
  - Pixeldrain list mirrors
  - GDrive queueing transport issue

### 2026-04-05 — GDrive transport fix + Gofile file-link selection hardening

- Status: partial
- Progress: 99%
- ТЗ coverage: fixes two mirror execution failures that were still blocking real installs even after URL resolution succeeded

What was done:

- Fixed `GDrive queued forever` by adding a dedicated main-side streamed download path for Google Drive-family hosts.
- Atlas no longer waits for Electron `will-download` on `drive.google.com` / `drive.usercontent.google.com`, because that path was leaving Drive mirrors stuck in `queued`.
- The Google Drive direct path now:
  - streams the payload from the main process
  - derives the filename from `Content-Disposition` or final URL
  - updates the same download panel/store with progress
  - hands the finished file to the same install pipeline as normal mirrors
- Hardened Gofile file extraction so Atlas no longer grabs noisy folder-level `downloadPage` style values like `download.json`.
- Gofile now prefers actual file entries and real child file links inside the content tree.

How it was implemented:

- New direct transport helper:
  - `src/main/f95/directDownload.js`
  - owns:
    - direct-download host targeting
    - filename extraction
    - streamed response-to-file writing with progress
- Main integration:
  - `src/main.js`
  - reintroduced a dedicated direct-download branch for Google Drive-family URLs inside `install-f95-thread`
  - added queue cleanup helper for manual-download branches
  - reuses the existing install finalization path after the file lands on disk
- Gofile resolver tightening:
  - `src/main/f95/downloadSupport.js`
  - `extractNestedDownloadUrl()` now prefers real `file` nodes and child file links instead of noisy folder metadata
- Tests:
  - `test/f95DirectDownload.test.js`
  - `test/f95DownloadSupport.test.js`

Rationale:

- The GDrive bug was not in the resolver anymore. The remaining problem was the transport: `downloadURL()` was not transitioning those mirrors into an active download item, so they sat in `queued` forever.
- The Gofile `download.json` bug was not an auth problem anymore. It was a payload-selection bug: Atlas was still willing to take a non-file link from the content tree.

Checks run:

- `npx prettier --write src/main.js src/main/f95/downloadSupport.js src/main/f95/directDownload.js test/f95DownloadSupport.test.js test/f95DirectDownload.test.js`
- `node --test test/f95DownloadSupport.test.js test/f95DirectDownload.test.js`
- `npm run ci:check`

What is still missing here:

- no live Electron smoke was run yet against your exact `Family Secrets` GDrive mirror after this slice
- no live Electron smoke was run yet against your exact failing Gofile mirror after this slice
- this still does not solve separate mirror classes:
  - Pixeldrain list mirrors
  - MEGA automatic install

## 2026-04-05 — Captcha continuation recovery for install/update flows

Progress: 73% of the current F95 mirror-resilience stage
Overall roadmap impact: improves the live-install/update flow so manual captcha confirmation can actually hand control back to Atlas instead of dead-ending in a browser page

What was done:

- fixed the embedded F95 browser rewrite script so masked-page CTA links like `href="#"` no longer redirect to `https://f95zone.to/#`
- added shared captcha continuation helpers in `src/shared/f95CaptchaFlow.js`
- wired the reusable F95 browser window to:
  - keep popup targets in the same window
  - broadcast navigation changes back to renderer
- search workspace now auto-detects when captcha flow has advanced to a real hoster page and retries install with that hoster URL
- update modal now does the same through browser-navigation IPC, so GDrive/Gofile captcha completion can resume update flow without manual file download
- exposed the new browser-navigation event through preload

How it was implemented:

- Main/browser layer:
  - `src/main/f95/session.js`
  - `src/main.js`
  - the reusable browser window now installs a same-window popup policy and emits `f95-browser-navigation`
- Renderer layer:
  - `src/core/search/F95BrowserWorkspace.jsx`
  - `src/App.jsx`
  - both flows use the same continuation rule: once the captcha page advances to a real hoster URL, Atlas retries install/update against that URL instead of forcing manual download
- Shared pure utility:
  - `src/shared/f95CaptchaFlow.js`
- Tests:
  - `test/f95CaptchaFlow.test.js`

Rationale:

- The broken behavior was not "captcha exists"; it was that Atlas had no professional handoff after the captcha step.
- Fixing only the resolver was not enough. The app needed a continuation contract between the manual captcha browser step and the automated download/install pipeline.
- The redirect-to-home bug in the embedded browser was self-inflicted by wrong `#` link rewriting and had to be fixed at the browser behavior layer, not hidden behind more retry buttons.

Checks run:

- `node --test test\\f95CaptchaFlow.test.js test\\f95DirectDownload.test.js test\\f95DownloadSupport.test.js`
- `npm run ci:check`

What is still missing here:

- no live Electron smoke was run yet against the exact user-reported Gofile captcha case after this continuation patch
- no live Electron smoke was run yet against the exact user-reported GDrive captcha/update case after this continuation patch
- MEGA and Pixeldrain list mirrors are still out of scope for automatic install

## 2026-04-05 — Stable ordering for concurrent downloads in the panel

Progress: 76% of the current F95 download UX stabilization stage
Overall roadmap impact: removes a visible UX regression where parallel downloads kept reordering themselves on every progress tick

What was done:

- fixed the downloads store ordering so active items no longer jump around when two or more downloads update at the same time
- active entries now keep a stable queue order based on creation order instead of `updatedAt`
- completed/error history still stays newest-first

How it was implemented:

- `src/main/f95/downloadsStore.js`
  - introduced `isActiveStatus()`
  - changed active sort behavior to prefer `createdAt`
  - kept historical entries ordered by `updatedAt`
  - added deterministic `id` tiebreaker
- `test/downloadsStore.test.js`
  - verifies stable ordering during concurrent progress updates
  - verifies history ordering still prefers the newest completed items

Rationale:

- The bug was not in the panel markup. It was in the store policy.
- Sorting active downloads by `updatedAt` is wrong because progress updates constantly mutate that field, which causes visible list thrashing.
- Stable order belongs in the source-of-truth store, not as a renderer-side visual patch.

Checks run:

- `node --test test\\downloadsStore.test.js`
- `npm run ci:check`

What is still missing here:

- no manual Electron smoke was run yet with 2+ real simultaneous mirrors after this ordering fix
- panel still has no pause/resume/cancel controls for active items

## 2026-04-05 — Professional library sorting in the installed-games view

Progress: 81% of the current library UX refinement stage
Overall roadmap impact: turns the library list from a hardcoded pseudo-sort into a user-controlled ordering model that matches real library usage

What was done:

- added a real library sort control to the header of the installed library view
- implemented library sorting modes for:
  - newest installed
  - oldest installed
  - title A-Z
  - title Z-A
  - engine
  - status
- status sorting now normalizes common Atlas/F95 states into stable groups:
  - in development
  - on hold
  - completed
  - abandoned
- blank/ongoing states are treated as "In development" instead of falling into random ordering
- the same sorted collection now drives both the sidebar titles list and the main game grid, so they stay in sync

How it was implemented:

- new shared pure util:
  - `src/shared/librarySort.js`
  - owns:
    - sort mode constants/options
    - installed timestamp extraction from `versions.date_added`
    - status normalization/grouping
    - deterministic sorting logic
- renderer wiring:
  - `src/index.html`
  - `src/App.jsx`
  - added header select control and replaced the old hidden hardcoded `lastPlayed/date` sorting path with explicit `sortLibraryGames(...)`
- tests:
  - `test/librarySort.test.js`

Rationale:

- The old library order was not professional. It silently mixed search filtering with unrelated hardcoded sort behavior.
- Sorting belongs in a shared pure helper so the sidebar and the grid do not drift apart and so the status-order contract is testable.
- Status sorting needed normalization because Atlas data is inconsistent: blank/ongoing values should not randomly interleave with Completed/Onhold/Abandoned entries.

Checks run:

- `node --test test\\librarySort.test.js`
- `npm run ci:check`

What is still missing here:

- no manual Electron smoke was run yet on a real mixed library with enough titles to visually verify every sort mode
- there is still no secondary filter UI for narrowing by engine/status; this slice only adds ordering, not filtering

## 2026-04-05 — Rebrand to F95 Game Zone App and prepare standalone repository

Progress: 88% of the current productization stage
Overall roadmap impact: shifts the project from an Atlas-branded fork surface to a standalone application surface with its own package/build metadata and public-facing docs

What was done:

- changed package/build branding to `F95 Game Zone App`
- updated Electron packaging metadata:
  - package name
  - description
  - product name
  - app id
  - GitHub publish owner/repo
- rewrote the top-level README around the new app identity
- documented cloud saves and the current bidirectional sync model honestly:
  - local -> cloud backup
  - cloud -> local restore
  - local safety backup before restore
- updated major user-facing window titles and settings copy to remove the old Atlas product branding
- added `.codex/` to `.gitignore` so local Codex workspace files do not leak into the standalone repo

How it was implemented:

- packaging and release metadata:
  - `package.json`
  - `package-lock.json`
  - `src/main/appUpdater.js`
- user-facing docs:
  - `README.md`
- runtime branding:
  - `src/index.html`
  - `src/settings.html`
  - `src/gamedetails.html`
  - `src/core/ui/windows/importer.html`
  - settings and cloud-save UI copy in the relevant React components

Rationale:

- Renaming only the README would be fake. The build metadata and updater target also needed to move or the app would still behave like Atlas under the hood.
- Renaming every internal `atlas_*` identifier would be a bad idea right now. Those names are part of compatibility and storage/migration safety, not product branding.
- The cloud-save docs needed to describe what is real today, not promise a background auto-merge system that does not exist yet.

Checks run:

- `npm run ci:check`

What is still missing here:

- manual smoke for branded window titles and updater target was not run yet
- standalone repo creation/push was completed, but the release build process still needed explicit verification on Windows

## 2026-04-05 — First standalone release build for F95 Game Zone App

Progress: 92% of the current productization stage
Overall roadmap impact: turns the renamed project into a real releasable application with a published standalone repository and Windows release artifacts

What was done:

- verified that the standalone repository now exists at:
  - `maxbaydi/f95-game-zone-app`
- verified that `origin` points to the standalone repo and `upstream` keeps the old Atlas repository
- built the first Windows release artifact locally
- confirmed the GitHub release `v1.1.0` contains release assets for the standalone app
- added a Windows build config fix so future local NSIS builds do not depend on the broken `winCodeSign` symlink extraction path on this machine

How it was implemented:

- local Windows build:
  - normal `npm run build` initially failed for environment reasons:
    - `winCodeSign` extraction hit Windows symlink privilege errors
    - later packaging retried into a locked `dist/win-unpacked`
- applied a durable fix in `package.json`:
  - `build.win.signAndEditExecutable = false`
- then built the installer from the already prepared unpacked app using:
  - `npx electron-builder --prepackaged dist/win-unpacked --win nsis --x64`

Release state:

- GitHub release:
  - `https://github.com/maxbaydi/f95-game-zone-app/releases/tag/v1.1.0`
- verified assets include:
  - Windows installer
  - Windows blockmap / `latest.yml`
  - Linux AppImage
  - Linux `.deb`

Rationale:

- The failure was not in application code. It was in the Windows release environment and electron-builder’s helper tooling.
- Pretending the release was "done" after only pushing the repo would have been wrong.
- Using the prepackaged path was the cleanest recovery because it avoided re-entering the file-lock phase after packaging had already succeeded once.

Checks run:

- `npm run ci:check`
- local Windows NSIS build via prepackaged flow
- GitHub release asset verification through `gh release view`

What is still missing here:

- no manual install smoke was run yet against the freshly built Windows installer
- auto-update behavior from the packaged Windows build still needs a real end-to-end smoke test

## Current Next Tasks

### 1. Finish Stage 0 verification

- Status: todo
- Progress: 0%
- Why next: storage-path work is not truly done until it survives real Electron launch paths
- Concrete work:
  - run dev Electron smoke
  - run packaged smoke
  - confirm no writes inside install/resources tree
  - record exact manual steps and results here

### 2. Replace importer-oriented scan with real local-library scan

- Status: todo
- Progress: 51%
- Why next: enabled-source scan now exists, but it still feeds the old importer candidate flow instead of persisting library entities from recursive discovery
- Concrete work:
  - decide whether `scan_candidates` evolves into the permanent discovery model or whether a second `local_games`/review table is still needed
  - finish moving scan orchestration and review actions out of importer UX
  - turn `Scan Hub` into a real review/import screen with explicit decisions
  - persist richer match/review state in SQLite
  - keep renderer as presentation/query layer only

### 3. Split DB responsibilities before scanner work grows further

- Status: todo
- Progress: 18%
- Why next: migration and scan-source logic have started moving out, but `src/database.js` is still too large
- Concrete work:
- continue extracting focused stores/services from `src/database.js`
- isolate legacy Atlas/F95 query concerns from local-library concerns
- prepare a smaller DB boundary for `local_games`, `save_profiles` and `sync_state`

## Risks / Notes

- `src/database.js` remains a legacy-heavy module. It is safer than before, but still oversized.
- Existing Atlas dependency tree has inherited security warnings and deprecated packages. I did not mix that cleanup into the storage/migration slice on purpose.
- `AGENTS.md` and `ТЗ.md` are local workspace files and are intentionally left untracked relative to upstream Atlas.

## 2026-04-05 — Cloud save error text normalization

What was done:

- removed raw Supabase/storage error text from the save backup and restore UI
- added a shared cloud error normalizer for upload, restore, auth, network, and generic fallback cases
- normalized persisted `save_sync_state.last_error` values in main-process cloud sync handling
- applied the same user-facing error mapping to the `Cloud Saves` settings screen so auth/storage failures do not leak backend text there either

How it was implemented:

- added `src/shared/cloudSyncErrors.js` with `getCloudSyncErrorDetails()` and `formatByteSize()`
- mapped upload and restore failures through the shared normalizer inside `src/main/cloudSaveSync.js`
- loaded the shared mapper in both `src/index.html` and `src/settings.html`
- updated `src/core/library/LibrarySaveSyncPanel.jsx` and `src/core/settings/CloudSync.jsx` to render normalized user-facing messages instead of raw backend text
- added regression coverage in `test/cloudSyncErrors.test.js`

What remains:

- run a manual smoke on a real oversized cloud-backup case to confirm the new message is shown in renderer after a live Supabase failure
- expand friendly mapping later if new host/provider-specific sync failures appear

Current stage progress:

- cloud-save UI hardening: 82%
- overall roadmap progress relative to the current fork scope: 74%

Impact on overall progress:

- improves product polish and keeps backend/storage implementation details out of user UI, which was an explicit project rule
- reduces the chance of future regressions where raw technical storage/auth text leaks back into save-related flows

## 2026-04-05 — Automatic cloud/local save reconcile

What was done:

- added automatic save reconcile on app startup with an existing cloud session
- added automatic save reconcile right after successful cloud sign-in/sign-up with a live session
- added automatic save reconcile after install/update flows once save profiles are refreshed
- introduced a deterministic reconcile policy that compares local and remote manifests before choosing upload or restore
- kept binary local safety copies in the file-based save vault and refreshed that vault after successful sync operations
- added explicit `synced` and `conflict` sync states so the library panel does not pretend everything is merely “ready”

How it was implemented:

- added `src/shared/saveSyncPlan.js` as a pure decision module for `upload` / `restore` / `noop` / `conflict`
- extended `src/main/cloudSaveSync.js` with:
  - remote manifest fetch
  - local manifest build from detected save profiles
  - automatic reconcile per game
  - vault refresh before upload and after restore
- extended `src/main.js` with a serialized cloud-save task queue and startup/auth/post-install triggers
- updated `src/core/library/LibrarySaveSyncPanel.jsx` to show the new sync states honestly
- documented the behavior change in `README.md`
- added ADR `docs/adr/0003-auto-cloud-save-reconcile.md`
- added regression coverage in `test/saveSyncPlan.test.js`

What remains:

- run a real manual smoke with a real Supabase user and two machines or two app profiles
- verify the end-to-end case where a freshly reinstalled game restores from cloud because cloud is newer than the local vault
- add continuous save-folder watching later if we want near-real-time upload, instead of startup/auth/install reconciliation only

Current stage progress:

- cloud save architecture + reconcile policy: 90%
- overall roadmap progress relative to the current fork scope: 79%

Impact on overall progress:

- closes the gap between “manual backup UI exists” and “cloud save continuity actually works in product terms”
- keeps the architecture aligned with the project rule that binary user data belongs in managed filesystem storage, not SQLite blobs

## 2026-04-05 — Library sorting refresh and sort semantics

What was done:

- fixed the library grid so it actually refreshes after sort order changes instead of keeping stale virtualized cells
- clarified the library sort labels for engine and status so the UI states the intended ordering instead of making the user guess
- added a user-facing sort description under the toolbar for every library sort mode
- extended regression coverage for the shared sort contract

How it was implemented:

- expanded `src/shared/librarySort.js` sort option metadata with user-facing descriptions and exported `getLibrarySortDescription()`
- updated `src/App.jsx` with a centralized `refreshLibraryGrid()` helper and triggered it after visible library order changes, resize recalculations, game updates, and deletions
- widened the sort select in `src/App.jsx`, added a tooltip, and rendered a small helper line below the toolbar controls
- extended `test/librarySort.test.js` with assertions for the engine and status sort descriptions

What remains:

- run a manual desktop smoke with the title sidebar hidden to verify the banner grid visibly reshuffles for each sort mode
- decide later whether to expand project lint coverage to renderer files like `src/App.jsx`, because current lint does not check that layer

Current stage progress:

- library browsing polish and reliability: 86%
- overall roadmap progress relative to the current fork scope: 80%

Impact on overall progress:

- removes a user-visible library UX regression where sorting could be computed correctly but not shown correctly in the virtualized grid
- makes the product behavior for `Engine` and `Status` sorting explicit in the UI without leaking any technical/internal wording

## 2026-04-05 — Settings removal in favor of product surfaces

What was done:

- removed the dedicated `Settings` entry from the main sidebar so the primary app flow no longer routes users into a grab-bag settings window
- moved cloud-save account access into a reusable modal opened from a new header icon and from the library save-sync panel
- expanded `Scan Hub` so it now owns scan source management and the default library folder instead of leaving those controls stranded in settings
- set preview downloads to always-on defaults and removed the old metadata toggle from the user-facing settings content

How it was implemented:

- added `src/core/cloud/CloudAuthPanel.jsx` as a reusable renderer component and made `src/core/settings/CloudSync.jsx` a thin wrapper around it
- updated `src/App.jsx` to:
  - track cloud auth state for the header
  - open the auth modal from the header
  - manage scan source add/replace/toggle/remove actions
  - manage the default library folder directly for `Scan Hub`
- refactored `src/core/library/ScanHubPanel.jsx` into an actionable side panel instead of a passive status board
- updated `src/core/library/LibraryDetailsPanel.jsx` and `src/core/library/LibrarySaveSyncPanel.jsx` so save-sync actions point to the new cloud-auth modal
- removed the old settings sidebar entry in `src/core/Sidebar.js`
- aligned defaults in `src/main.js` and `src/core/importer/importer.jsx` so preview downloads are on by default

What remains:

- run a manual smoke for the new header auth modal, including sign-in, sign-out and unavailable-cloud states
- manually verify `Scan Hub` source mutations and default library folder selection on Windows dialogs
- decide later whether to delete the legacy settings window entirely or leave it as a hidden compatibility artifact during transition

Current stage progress:

- main-shell UX consolidation away from settings: 78%
- scan and library workflow coherence: 84%
- overall roadmap progress relative to the current fork scope: 83%

Impact on overall progress:

- removes a chunk of fake configuration UI and replaces it with product-facing entry points that match actual user tasks
- reduces duplicated surface area between `Settings`, importer flows and `Scan Hub`, which lowers future maintenance cost and UI drift

## 2026-04-05 — Reset-cache full library rescan

What was done:

- changed the `Rescan Library` button to open a context menu with `Reset Cache & Rescan Library` and `Rescan Library`
- added a safe reset-cache flow that clears persisted scan history and then forces a full reindex pass
- kept installed library records, save metadata, and local save files intact during reset-cache rescans
- documented the scan-flow decision in a dedicated ADR and added regression coverage for the new reset path

How it was implemented:

- extended the renderer rescan flow in `src/App.jsx` to open the existing Electron context menu bridge and route menu commands back into the app
- changed `src/renderer.js` and `src/main.js` so `scan-library` accepts options, with `resetCache` implying `forceRescan`
- added `src/main/scanCache.js` plus `clearScanCandidates()` / `clearScanJobs()` in the scan store modules to wipe only `scan_candidates` and `scan_jobs`
- updated `src/core/scanners/f95scanner.js` so force rescans re-queue already-known library entries instead of skipping them
- added ADR `docs/adr/0004-reset-cache-full-library-rescan.md`
- added regression coverage in `test/scanCacheStores.test.js`

What remains:

- run a manual desktop smoke to confirm the context menu opens from the footer button and both menu actions produce the expected progress text in the UI
- decide later whether a separate stale-library reconciliation flow should remove records whose folders disappeared from disk, because reset-cache rescans intentionally do not delete library entries

Current stage progress:

- scan/discovery control surface and persistence: 88%
- overall roadmap progress relative to the current fork scope: 81%

Impact on overall progress:

- gives the product an explicit safe reset path for scanner persistence without violating the rule against hidden destructive refactors
- closes the gap between incremental rescans and a real full reindex flow while preserving backward compatibility for the local library and save sync state

## 2026-04-05 — Library duplicate prevention and exact-path reconciliation

What was done:

- fixed the import pipeline so `reset cache + rescan` no longer creates a second library record for the same installed folder
- added exact-path duplicate reconciliation that preserves the best record and removes loser records sharing the identical `game_path`
- hardened duplicate cleanup so linked save/cloud/mapping metadata is migrated before deleting loser records
- ran the reconciler against the live profile after a DB backup and collapsed `39` duplicate path groups, reducing the library from `81` to `42` records

How it was implemented:

- updated `src/main.js` import flow to build a path index from `getGames()`, resolve existing records by normalized `game_path`, and update the existing game/version instead of blindly calling `addGame()`
- added `runLibraryDuplicateCleanup()` in `src/main.js` and invoked it from the library rescan flow so future rescans also self-heal legacy exact-path duplicates
- updated `src/database.js` so `updateGame()` performs a real `UPDATE` instead of `INSERT OR REPLACE`, avoiding silent loss of fields like playtime/description
- expanded `src/main/libraryDuplicates.js` to score duplicate winners more sanely, penalize titles with detached version tails, and migrate `save_profiles`, `save_sync_state`, `atlas_mappings`, `steam_mappings`, `f95_zone_mappings`, and `tag_mappings`
- added regression coverage in `test/libraryDuplicates.test.js`
- created a safety backup at `C:\Users\jerem\AppData\Roaming\f95-game-zone-app\backups\data-pre-duplicate-cleanup-20260405-214703.db`

What remains:

- manually refresh/restart the app shell and verify the rendered library count matches the cleaned DB state
- keep tuning duplicate winner scoring for edge cases where both records are unmapped and only folder-derived metadata exists
- later decide whether to add a dedicated user-triggered “reconcile library duplicates” action in UI, or keep this as an automatic maintenance pass during rescans only

Current stage progress:

- duplicate prevention for library rescans: 95%
- exact-path library reconciliation safety: 90%
- overall roadmap progress relative to the current fork scope: 85%

Impact on overall progress:

- removes the main data-integrity regression where a safe rescan could quietly bloat the library with duplicate records for the same install path
- keeps cleanup aligned with the project rule that user data safety comes first, because only DB metadata was merged/removed while installed game files and save files on disk were left untouched

## 2026-04-05 — Missing F95 auto-links for exact game matches

What was done:

- fixed the scan matcher so exact game titles with valid version/engine evidence no longer stay stuck in `ambiguous` just because of nearby fuzzy neighbors or stale duplicate Atlas rows
- backfilled live Atlas/F95 mappings for `12` already-imported library records that were safe `matched` candidates under the corrected matcher
- explicitly repaired the user-reported cases `My Hotwife`, `Not a Failure to Launch`, and `Willing Temptations` in the live profile, and updated their stale `scan_candidates` rows to `matched` + `imported`

How it was implemented:

- updated `src/shared/scanMatchUtils.js` so `normalizeEngineName()` treats `Unknown`-style placeholders as missing engine data instead of false engine conflicts
- updated `src/main/scanAtlasMatcher.js` to:
  - filter invalid version hints before scoring
  - preserve negative version-conflict evidence instead of letting a missing hint erase it
  - penalize subset/substring title collisions like `Temptations` vs `Willing Temptations`
  - relax the auto-match decision only for exact-title cases that also have enough corroboration from version/engine/F95 presence
- extended `test/scanAtlasMatcher.test.js` with regressions covering:
  - `Not a Failure to Launch` vs `A Failure to Launch`
  - `My Hotwife` same-title branch selection
  - `Willing Temptations` vs shorter `Temptations` collisions
- extended `test/scanMatchUtils.test.js` with the `Unknown` engine normalization case
- created a safety backup at `C:\Users\jerem\AppData\Roaming\f95-game-zone-app\backups\data-pre-match-backfill-20260405-220145.db`
- ran a live metadata backfill that added Atlas mappings and refreshed scan-candidate match state for 12 exact-path library entries, including:
  - `record_id 70` → `My Hotwife`
  - `record_id 72` → `Not a Failure to Launch`
  - `record_id 89` → `Willing Temptations`

What remains:

- manually refresh/restart the renderer and verify the linked thread metadata is visible in the library UI for the newly mapped records
- continue tuning title/version heuristics for harder non-exact cases where there is no Ren'Py metadata and no strong executable-name evidence
- later decide whether to add a dedicated maintenance action that re-evaluates already imported unmapped library records without requiring a full reset-cache rescan

Current stage progress:

- F95 thread auto-link reliability for exact-title scans: 91%
- live metadata backfill for already imported records: 88%
- overall roadmap progress relative to the current fork scope: 87%

Impact on overall progress:

- removes a real product failure mode where obviously correct site threads were present in the local catalog but still withheld from the user because the matcher was over-penalizing engine gaps and under-penalizing fuzzy neighbors
- reduces the number of “known but not linked” games in the current profile immediately, instead of waiting for the next full rescan to repair those mappings

## 2026-04-05 — Parent-folder identity and remaining site-link backfill

What was done:

- upgraded scan identity extraction so it can recover creator/title evidence from two common messy Windows folder patterns:
  - `Title by Creator`
  - `TitleCreatorStudio` with the creator stuck onto the end of the title token
- widened the matcher only for clearly dominant non-exact cases, so strong parent-folder titles and creator-anchored matches can auto-link without opening the floodgates to generic fuzzy collisions
- backfilled 4 more live library records that became safely matchable after those universal heuristics:
  - `NLWMD 0 7 0b`
  - `Dating a Giantess by Giantess Nexus`
  - `GGA`
  - `Libertas`

How it was implemented:

- added creator/title splitting helpers in `src/main/scanIdentity.js` and routed folder/executable/Ren'Py title hints through a shared `appendTitleHints(...)` path
- added regression coverage in `test/scanIdentity.test.js` for:
  - `Dating a Giantess by Giantess Nexus`
  - `New_Life_with_My_DaughterVanderGames-0.7.0b-pc`
- extended `src/main/scanAtlasMatcher.js` with additional auto-match lanes for:
  - decisive near-exact parent-folder titles
  - creator-anchored matches with exact version evidence
  - exact-version + engine corroboration when title evidence is strong enough
- added matcher regressions in `test/scanAtlasMatcher.test.js` for `Libertas`, `NLWMD`, `Date a Giantess`, and `Gamer Girl Adventure`
- created a safety backup at `C:\Users\jerem\AppData\Roaming\f95-game-zone-app\backups\data-pre-remaining-match-backfill-20260405-221500.db`

What remains:

- unresolved from the reviewed screenshot, and intentionally still not auto-linked:
  - `SW upd4 Open release` — not enough trustworthy local identity; current data looks like junk build naming
  - `Family Secrets` — true collision between multiple real F95 threads with the same title
  - `SmallCoffee female` — likely related to `Small Coffee`, but the local title modifier is too specific to safely collapse without more evidence
  - `banu west` — probably `Banu in the West`, but still not strong enough for safe automatic linking
- later add a dedicated “re-evaluate unmapped library records” maintenance action so these improved heuristics can be applied from UI without needing another full rescan

Current stage progress:

- universal scan identity extraction for messy folder naming: 90%
- F95 thread auto-link reliability for imported library records: 93%
- overall roadmap progress relative to the current fork scope: 88%

Impact on overall progress:

- reduces dependence on pristine folder naming and lets the scanner recover correct site links from the ugly real-world naming conventions users actually have on disk
- keeps the matching policy professional: more exact links are recovered automatically, while the genuinely unsafe collisions are still withheld instead of being silently mislinked
