# ADR 0006: Additive Cloud Library Catalog And Installable Library Stubs

## context

Cloud save sync already existed, but the product still had a broken cross-device story:

- on a second PC the user could sign in, but their library itself did not come back
- only installed local records existed in SQLite, so "I own this thread but it is not installed here" had no first-class representation
- the F95 workspace could install a thread, but it could not simply link a thread into the library for later installation
- save actions were per-game only, which is not enough for real migration / backup flows

That was not a UI gap. It was a model gap.

Without a cloud library catalog and local stub records, the app cannot represent:

- account-level library continuity
- install-later flows
- additive multi-device merging

## decision

Introduce an additive cloud library catalog stored in the same user-scoped Supabase storage area as cloud saves, and materialize remote-only entries into local SQLite as library stubs.

The design now has four parts:

1. Cloud library catalog manifest
   - stored per authenticated user in storage
   - merged additively from local and remote entries
   - no service-role key or privileged backend path is required

2. Local library stubs
   - a game may exist in `games` with zero installed `versions`
   - such records still carry thread identity and site linkage
   - they remain installable later from the library UI

3. Direct F95 thread mapping
   - local records can now resolve thread identity through `f95_zone_mappings`, not only through Atlas
   - this allows a library entry to exist even when there are no installed files yet

4. Bulk cloud save orchestration
   - upload/sync operations can run across all installed games
   - failures stay per-game instead of aborting the entire batch

## alternatives

1. Keep cloud sync save-only and show remote library entries in a separate modal list.
   Rejected because the library would still not be a real library on a second device; it would just be a disconnected remote report.

2. Sync library rows through a privileged backend or service-role flow.
   Rejected because the desktop app is intentionally limited to publishable-key + user-scoped storage operations.

3. Treat "Add to Library" as a UI-only bookmark without a local `games` row.
   Rejected because install, update, filtering, sorting and details-panel behavior all expect real library records.

4. Make cloud sync destructive so local deletes remove remote entries.
   Rejected for now because the user requirement is explicitly additive: plus, not minus.

## consequences

Positive:

- a second device can recover the user's library without already having installed files
- the F95 workspace now supports a proper "link now, install later" flow
- library cards and details panels can distinguish "in library" from "installed"
- bulk backup / sync is now product-level rather than per-record-only

Tradeoffs:

- local library count is no longer equal to installed-game count
- local deletion is no longer an account-level delete; a future explicit global-remove flow is still needed
- cloud library sync now has to manage both storage merge and local stub materialization
- more state now exists around F95 thread identity and must stay migration-safe
