# ADR 0008: Library Index Reset, Refresh Rescan And On-Disk Presence

## context

ADR 0004 introduced `Reset Cache & Rescan Library` but left two gaps: known
records that the scanner could not match confidently were parked in the review
queue instead of being refreshed, and stale rows for folders that disappeared
from disk were never reconciled. The library also treated every record with a
`versions` row as installed, so a game whose folder was deleted still showed
`Play` and `Update`; an update downloaded the archive and then failed while
moving it into the dead folder.

Users asked for three things: a way to wipe the local library and rescan
everything, a way to refresh installed games without wiping, and a visible
difference between games that are physically installed and games that are only
linked to the library.

## decision

1. **Presence is derived at read time, not stored.** Every renderer-facing read
   of the library goes through `annotateLibraryPresence`, which checks each
   `versions[].game_path` on disk (with a timeout, a per-call cache and a
   drive-root short-circuit) and derives `installState`:
   `installed` / `missing` / `not_installed`. `isUpdateAvailable` only
   considers folders that exist.
2. **A missing game is installed, not updated.** `chooseInstallDirectory`
   reuses an existing folder only while it exists; otherwise the package goes
   to a fresh folder under the library root and the dead version rows are
   retired after the new version row is written.
3. **Four scan modes** with an explicit contract: `incremental` (new folders
   only), `refresh` (force rescan; known folders are refreshed even without a
   confident catalog match, stored metadata is never downgraded),
   `reset_cache` (ADR 0004 behaviour on top of `refresh`), `reset_library`.
4. **Library reset is backed up, atomic and scoped.** `resetLibraryIndex`
   writes a `VACUUM INTO` snapshot under `backups/library_index`, then clears
   the library tables in one transaction and removes per-record image caches.
   The Atlas/F95 catalog, scan sources, emulators, tags, the pending
   cloud-delete queue, the save vault and all game files are untouched. The
   renderer must confirm explicitly (`confirm: true`), and no cloud delete
   requests are queued: the account library is left as is and re-materializes
   remote-only entries as `not_installed` stubs (ADR 0006).

## alternatives

1. Store an `is_present` flag in `versions` and update it during scans.
   Rejected: it goes stale between scans (external drives, manual deletes) and
   needs a migration; a stat per folder is cheap and always current.
2. Delete records whose folders are missing during a refresh.
   Rejected: destructive without user intent; the record still carries thread
   identity, favorites and cloud save state. They are shown as `missing` with
   `Install`/`Remove` actions instead.
3. Implement library reset as `remove-library-game` for every record.
   Rejected: it would queue account-wide cloud deletes for every game and
   would run the per-game save-vault logic hundreds of times.

## consequences

- Cards, the details panel, the install dialog and the F95 workspace show the
  same three states from one shared module; the `Updates` section and the
  update notification ignore games that are not on disk.
- Library loads now touch the filesystem once per unique install folder; an
  unreachable network share costs one timeout (1.5 s) per share, not per game.
- Version rows pointing at dead folders disappear only after a successful
  fresh install of that game; otherwise they stay visible as `Folder missing`.
- Rebuilding the library forgets every record that is not found in an enabled
  scan folder; the backup file is the recovery path.
