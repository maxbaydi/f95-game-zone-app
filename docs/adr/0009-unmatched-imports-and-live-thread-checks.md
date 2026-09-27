# ADR 0009: Unmatched Imports And Live Thread Checks

## context

Two gaps remained after ADR 0008.

1. The scanner imported a new folder only when the Atlas matcher was
   confident (`matchStatus = matched`). Everything else, including folders
   that clearly are games (launchers of a known engine, a single launcher),
   waited in the Scan Hub review queue. Translations, mods, rare games and
   folders with unusual names never reached the library without per-folder
   manual review.
2. `latestVersion` came only from `atlas_data.version`. The catalog is
   refreshed in batches and lags the site by days, so "Update available"
   appeared late. The F95 thread title always carries the current version,
   and the app already has an authenticated F95 session and a thread
   inspector.

## decision

1. **Import clear games without a match.** A new folder is imported when the
   match is confident, or when it is not an archive and its detection score is
   at least `MIN_UNMATCHED_DETECTION_SCORE = 40` (a launcher plus engine or
   single-launcher evidence). Such imports carry `importUnmatched`, are
   counted in the scan summary and are marked "Not matched" in the UI. The
   condition "no `atlas_id`, no `f95_id`, no `siteUrl`" lives in one shared
   function (`needsCatalogLink`). The user links the record to the catalog
   from the details panel (`link-game-to-catalog`), which attaches the Atlas
   mapping, the F95 thread of that entry and the catalog metadata.
2. **Read versions from live threads.** A main-process checker opens the
   threads of installed games one at a time (1.5 s apart, at most 40 per run,
   favorites only in the background, every 6 hours, 90 s after startup and
   after an F95 sign-in) and stores the result per record in a new table
   `library_live_versions` (migration 011). Reads join it and expose
   `latestVersion = pickNewerVersion(atlas, live)`, so a thread can raise the
   known version but never lower it. Nothing runs without an F95 session.

## alternatives

1. Lower the Atlas matcher threshold. Rejected: wrong matches attach wrong
   threads, banners and cloud identities, which is worse than no match. An
   unmatched record is honest and can be linked by the user.
2. Import every scanned folder. Rejected: archives and folders without
   launchers are often not games; the name of a folder alone must not
   identify a game (AGENTS.md).
3. Store the live version in `atlas_data` or `f95_zone_data`. Rejected: those
   tables are replaced by catalog updates and are shared between users of the
   same catalog entry; the live value is per library record and must survive
   catalog refreshes.
4. Check every installed game in the background. Rejected: dozens of page
   loads every few hours per user look like scraping and trigger site
   protection; favorites cover the games users actually follow, and the
   manual "Check threads now" covers the rest on demand.
5. Poll the F95 "latest updates" feed instead of threads. Rejected for now:
   it needs a different parser and still requires mapping entries to library
   records; the thread inspector already exists and is tested.

## consequences

- More games reach the library after a scan; some of them need a manual
  "Link to catalog…" to get banners, update checks and a cloud identity. The
  review queue still holds weak detections and archives.
- `getGame`/`getGames` join one more table; `latestVersion` is `""` instead of
  `null` for records without catalog data.
- `library_live_versions` is part of `LIBRARY_RESET_TABLES`, is removed with
  the game (`deleteGameCompletely`, foreign keys are not enforced by
  node-sqlite3) and is restored from library backups.
- A failed check keeps the last good version of the same thread, so a
  timeout does not hide a known update; linking a record to another catalog
  entry clears it.
- Background checks open hidden windows with the F95 session; their cost is
  bounded by the per-run limit, the delay between threads and the 6-hour
  staleness window.
