# ADR 0003: Automatic Cloud Save Reconcile With Local Vault As First-Class Copy

## context

The first cloud-save slice introduced:

- local save discovery in SQLite
- local save vault backup/restore in the Electron main process
- authenticated Supabase upload and restore actions

That was enough for manual backup/restore, but not enough for the real product goal:

- after startup or sign-in, saves should reconcile automatically
- after reinstall or update, a game should recover saves from the newest known copy
- the app must keep both a cloud copy and a local app-managed copy without stuffing binary saves into SQLite

Leaving the feature as manual buttons would make the cloud layer look implemented while still failing the actual continuity requirement.

## decision

Keep the local-first storage model and add automatic reconcile in the main process:

- binary save payloads stay on disk in the local vault under `appPaths.backups/save_vault`
- SQLite continues to store only save profile metadata and sync state
- cloud restore/upload decisions are based on local manifest hash, remote manifest hash, and newest save-file mtime
- automatic reconcile runs on:
  - app startup when a cloud session already exists
  - successful sign-in / sign-up that yields a live session
  - install/update flows after save profiles are refreshed
- after successful upload or restore, the local vault is refreshed so the app-managed local copy stays current
- if local and remote copies diverge but timestamps are indistinguishable, the app records a conflict state instead of silently overwriting either side

## alternatives

1. Store full save payloads in SQLite.
   Rejected because large binary blobs make the local database harder to debug, migrate, and recover. The vault should stay file-based.

2. Keep cloud sync manual only.
   Rejected because it does not satisfy the continuity requirement after login/startup/reinstall.

3. Always prefer cloud over local, or always prefer local over cloud.
   Rejected because either rule would silently lose user progress in valid scenarios.

## consequences

Positive:

- the product now behaves closer to “turn it on once and it keeps your saves alive”
- reinstall/update flows can recover from whichever copy is newest
- local vault remains a real offline safety layer independent of Supabase availability

Tradeoffs:

- reconcile is archive/manifest based, not block-level sync
- continuous live watching of save folders is still a later step
- conflict cases now surface as an explicit sync state that UI must represent clearly
