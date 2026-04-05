# ADR 0004: Reset Cache For Full Library Rescan

## context

The scanner persists `scan_jobs` and `scan_candidates` in SQLite so discovery survives restarts.

At the same time, the existing `Rescan Library` flow still skips already-known library records because the scanner checks local duplicates before queuing candidates. That means a normal rescan is incremental, not a true rebuild path.

Deleting `games`, `versions`, save sync state, or on-disk save data under a vague "reset cache" label would be destructive and would violate the project rule to prefer data safety over convenience.

## decision

Introduce an explicit `Reset Cache & Rescan Library` path with these rules:

- reset only the persisted scan cache tables: `scan_jobs` and `scan_candidates`
- do not delete `games`, `versions`, mappings, save profiles, save sync state, banners, previews, or user save files
- run the next library scan in `forceRescan` mode so already-known library entries are queued again and re-imported through the normal import path
- keep the existing `Rescan Library` action as the non-destructive incremental scan

## alternatives

1. Delete the whole library index before rescanning.
Rejected because it is destructive, breaks backward compatibility for local library state, and would silently throw away save-related metadata under a misleading cache label.

2. Clear only `scan_jobs` and `scan_candidates` without forcing known games back through the scanner.
Rejected because it would look like a reset in UI but still would not perform a real full reindex pass.

3. Keep only the existing incremental rescan.
Rejected because users need an explicit way to restart scan history and force a fresh pass without manual database surgery.

## consequences

- users get a safe reset flow for scanner persistence and a full reindex pass
- installed library records remain stable across reset-cache rescans
- stale library rows for folders that disappeared from disk are still not removed automatically; that needs a separate reconciliation flow later
