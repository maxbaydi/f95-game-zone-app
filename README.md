# F95 Game Zone App

F95 Game Zone App is a desktop manager for F95 games on Windows. It focuses on four things that actually matter in day-to-day use:

- a reliable installed library
- live F95 thread search and update flow
- download/install directly into the library
- save protection with local vault backups and cloud sync

This project started from Atlas foundations, but it is now being shipped as its own application and release line.

## What it does

- scans local folders and builds a real installed-games library
- opens live F95 threads inside the app through a logged-in session
- installs or updates games from thread mirrors into the correct library folder
- keeps a downloads queue with background progress and history
- detects save locations in both the game folder and common `%AppData%/RenPy/...` paths
- backs up saves before destructive operations
- supports account-based cloud saves through Supabase

## Cloud saves

Cloud saves are account-scoped. A user signs in once, and the app can back up and restore that user's saves across machines.

Current cloud-save behavior:

- local save detection covers install-relative save folders and common Ren'Py AppData locations
- the app now auto-reconciles saves on startup, after sign-in, and after install/update
- when only one side exists, that side is used automatically
- when both sides exist, the app compares manifest hashes and latest save-file mtimes to choose upload vs restore
- upload creates a cloud backup from the current local save set
- restore pulls the latest backup back to the current machine
- before restore, the app creates a local safety backup so local data is not silently lost
- local safety copies live on disk under the app profile vault, not inside SQLite blobs
- deleting a game can preserve saves in the local vault for later reinstall

This is a bidirectional sync foundation:

- local -> cloud: back up current saves from this machine
- cloud -> local: restore the latest backup onto this machine

It is still safety-first, not a blind merge engine. If local and cloud copies diverge with the same timestamp, the app flags the game for review instead of silently overwriting either side.

## Update and install flow

- inspect a live F95 thread
- choose a mirror by platform
- resolve masked F95 links and supported host flows
- queue the download
- unpack or move the payload into the library
- register the installed version in the local database

When a mirror requires captcha confirmation, the app now keeps that flow resumable instead of dumping the user into a dead end.

## Development

```powershell
npm install
npm run dev
```

Checks:

```powershell
npm run ci:check
```

## Releases

Releases are published from this repository:

- [GitHub Releases](https://github.com/maxbaydi/f95-game-zone-app/releases)
