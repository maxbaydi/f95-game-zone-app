# ADR 0002: Local-First Cloud Save Sync With Supabase Storage

## context

This fork needs three things at once:

- reliable local save continuity across update/reinstall/delete
- Ren'Py-aware save discovery, including `%AppData%/RenPy/...`
- optional cloud sync that does not break the local product when Supabase is unavailable

The unsafe shortcut would be to push a Supabase secret/service key into the app and let the renderer or desktop client act like an admin.
That is not acceptable.

## decision

Use a local-first architecture:

- save profile discovery and sync state live in local SQLite (`save_profiles`, `save_sync_state`)
- local save backup/restore lives in the Electron main process only
- Supabase client auth uses the publishable key plus user email/password auth
- remote cloud payloads are stored as user-scoped archives in a private Storage bucket
- bucket access is enforced by RLS on `storage.objects`, scoped to the authenticated user id as the first path segment

Cloud identity is derived from the existing local identity model:

- prefer `f95-{threadId}`
- otherwise `atlas-{atlasId}`
- otherwise normalized `title + creator`

This keeps the remote namespace stable without trusting folder names alone.

## alternatives

1. Put the Supabase secret/service key in the desktop app.
   Rejected because the app is distributed to users, so that key would no longer be secret.

2. Store cloud sync state only remotely.
   Rejected because local diffing, diagnostics and offline UX still need authoritative local state.

3. Add a separate backend before shipping any cloud save feature.
   Rejected for now because authenticated user-scoped storage with RLS is enough for the first local-to-cloud iteration.

## consequences

Positive:

- cloud save auth and storage work without shipping admin credentials
- local library/update/delete flows keep working fully offline
- `%AppData%/RenPy` and install-relative save roots can share the same archive/manifest pipeline
- future cloud providers or edge functions can reuse the same local manifest/profile model

Tradeoffs:

- bucket/RLS bootstrap still must be applied once in Supabase
- first sync iteration is archive-based, not block-level diff sync
- full cloud conflict resolution is still a later stage
