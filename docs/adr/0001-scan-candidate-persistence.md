# ADR 0001: Persist Scan Candidates In SQLite

## context

The current Atlas-derived scan flow produces transient importer candidates in memory.
That is not enough for this fork:

- recursive scan results need to survive window close/reopen
- the scanner must become a first-class subsystem instead of a one-shot importer helper
- later Library/Discovery UX cannot be built on ephemeral renderer state
- scan diagnostics and confidence scoring need a local persistence layer

At the same time, replacing the whole library model in one step would be a risky hidden refactor.

## decision

Introduce a dedicated `scan_candidates` table and keep it separate from the installed library tables (`games`, `versions`).

Each persisted candidate stores:

- source/job linkage
- detected folder path
- normalized title/creator/engine/version
- atlas/f95 ids when available
- detection score and reasons
- match count
- status (`detected`, later `imported` and future statuses)
- first/last seen timestamps

Enabled-source scans write candidates into `scan_candidates`.
When a candidate is imported into the local library, the candidate row is marked as `imported` and linked to the created `games.record_id`.

## alternatives

1. Reuse `games` / `versions` directly for raw scan output.
   This was rejected because detection results are not equivalent to installed library entries and would pollute user-facing library state with half-classified rows.

2. Keep scan output only in renderer memory.
   Rejected because it makes recovery, diagnostics, job history and later discovery UX impossible.

3. Store raw JSON blobs per scan job only.
   Rejected because querying by folder/status/source and linking imported results back to library records becomes awkward and brittle.

## consequences

Positive:

- scan output now survives app restarts
- later Discovery/Review UI can query SQLite instead of forcing a fresh rescan
- imported rows can be traced back to their scan origin
- diagnostics and detection metadata have a proper local home

Tradeoffs:

- one more local table and migration to maintain
- scanner and importer now need to keep candidate status in sync
- this is still a transitional design because the legacy scanner itself is not fully replaced yet
