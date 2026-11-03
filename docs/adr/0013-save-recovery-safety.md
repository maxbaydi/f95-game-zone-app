# ADR 0013: Failure-safe save recovery and conflict handling

**Status:** accepted (2026-11-03)

## Context

Save import and cloud restore can overwrite the only local copy of game progress. A failed vault backup must therefore stop the write, and publishing a new vault snapshot must not destroy the last complete snapshot. F95Launcher archives also need integrity checks before their contents are copied into game directories. Across PCs, file modification times do not establish which divergent save set contains the progress the user wants; a missing sync baseline makes that ambiguity greater. Storage configuration and operations must fail closed when their marker is invalid or a connection is still loading.

The storage UI also exposed raw S3 and Supabase infrastructure fields. A distributed desktop app must not recommend Supabase secret or `service_role` keys. The current Supabase provider has no Supabase Auth session, so describing it as user-scoped would be incorrect.

## Decision

- Build each local vault snapshot in a staging directory and write its manifest there. Publish it only after copying completes; retain the previous snapshot through the swap and restore it if publishing fails. Serialize vault operations per identity and recover a stranded `.previous` snapshot before the next operation.
- Require a successful vault backup before file import or cloud restore writes any game save. Propagate backup errors to the caller instead of continuing.
- Before copying an F95Launcher archive into a save destination, validate the format and version, manifest hash, profile roots, complete file list, sizes, and SHA-256 values. Reject an invalid archive and remove its extraction directory. Foreign archives without an F95Launcher manifest remain supported through safe extraction and save-file heuristics.
- Read each source file once during export and use those bytes both in the ZIP and in its size and SHA-256 manifest fields.
- Serialize storage loading and cloud operations. If loading or reading the storage marker fails, clear the active encryption key and keep writes locked; only the supported marker format and version may be opened.
- Treat identical content as synced. When copies differ, use the last successful sync baseline only when it identifies one changed side. If both sides are considered changed (including when no baseline hashes have been recorded), report a conflict, retain the prior baseline, and wait for an explicit **Back up** or **Restore** action. Never choose a winner by file modification time.
- Keep folder and WebDAV setup in the user settings. Remove manual S3/Supabase credential forms and the developer-console setting. Retain existing S3 and supported Supabase provider connections through connection-card and main-process paths.
- Accept only Supabase publishable keys and legacy `anon` JWT keys with role `anon`; reject `sb_secret` and `service_role` keys. Do not create buckets or call bucket-admin APIs. The bucket and its Storage policies must already exist. This provider does not create a Supabase Auth session or provide user-scoped isolation. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).
- Keep atomic configuration writes atomic: a failed rename reports an error and leaves the existing config file intact. When hard links are unavailable while saving a downloaded package, use an exclusive copy so an existing package is never overwritten.

## Alternatives

- Continue after a vault-backup error and show a warning. Rejected because a later import or restore could overwrite saves without a confirmed safety copy.
- Delete the old vault before copying its replacement. Rejected because a copy failure would remove the last usable backup.
- Select the side with the newest file mtime. Rejected because clocks and timestamp preservation differ across PCs, and this can silently discard newer gameplay progress.
- Permit elevated Supabase keys or create a missing bucket automatically. Rejected because secret keys bypass policies and are not suitable for a distributed client; bucket creation is infrastructure administration outside the provider's object-storage role.
- Fall back to writing a config file directly when atomic rename fails. Rejected because it can truncate or replace the last good config.

## Consequences

- A failed backup, invalid archive, unsupported storage marker, or unsafe Supabase key stops the requested operation before save data is overwritten.
- Some older or modified F95Launcher ZIP files may now be rejected if their manifest or contents do not match. Foreign archives without that manifest continue through the safe foreign-import path.
- Conflicts may require a user choice even when one side appears newer by timestamp. This adds a step but preserves both copies until the user selects one.
- Supabase support is limited to public application keys and pre-provisioned storage policies. It does not authenticate individual Supabase users or provide per-user data isolation.
- Existing provider credentials can still be carried through supported connection-card/main-process flows; users cannot enter raw S3 or Supabase infrastructure fields in settings.
- Manual desktop verification remains part of final acceptance: backup failure, corrupt ZIP, two-PC conflict, storage switching, and a narrow-window toolbar layout.
