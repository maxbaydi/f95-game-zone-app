# ADR 0010: Save sync into user-owned storage instead of a hosted cloud

**Status:** accepted (2026-09-29)

## Context
Cloud saves ran on a Supabase project owned by the maintainer. Free projects pause after a week without traffic and the app is free, so there is no budget for keeping a hosted backend alive. Users still need saves on more than one PC, and the setup has to be doable by someone who does not know what a bucket is.

## Decision
- The app ships no backend. Saves sync into a storage the user owns, through one small provider interface (`list/read/write/remove/test`) with three implementations: a folder synced by a desktop cloud client, a WebDAV server, an S3-compatible bucket.
- The default path is the synced folder: desktop clouds already on the PC are detected and offered as one-click cards; the client uploads, the app only writes files atomically.
- The remote layout reuses the file export format (zip + manifest) and the vault identity (`f95-<thread id>`), so a fresh install finds its saves without any account. A `catalog.json` lists every game with a backup for the reconnect screen.
- One connection at a time; public settings in `config.ini`, secrets in one `safeStorage`-encrypted file; connect replaces, disconnect removes both. A portable "connection card" (optionally sealed) reconnects another PC in one action.
- Encryption is opt-in per storage (AES-256-GCM, scrypt), verified through a check value in the marker before anything is written.
- The old Supabase flow stays as an "advanced: own project" option and is used for automatic reconciles only while no storage is connected.

## Consequences
- No hosting cost and no dependency on a third party's uptime; sync works offline for the folder provider.
- Sync decisions gained a content hash so identical saves on two PCs are not re-uploaded after a restore.
- OAuth integrations with Google Drive, Dropbox or OneDrive APIs are not implemented: they would require vendor app registrations and shipped client ids. The synced-folder path covers the same clouds through their desktop clients.
- Multi-writer conflicts remain "safety first": both sides changed at the same time → status `conflict`, the user decides; history keeps the last five archives.
