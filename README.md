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
- detects save locations for Ren'Py, RPG Maker, Unity, Unreal, Godot, Wolf RPG, KiriKiri, GameMaker, Flash and HTML games (game folder, AppData, LocalLow, Documents, Saved Games)
- exports and imports saves as plain zip files, per game or for the whole library, with no account needed
- backs up saves before destructive operations
- syncs saves into a cloud you already own: OneDrive, Dropbox, Google Drive, Yandex.Disk and other desktop clients in one click, or any WebDAV server or S3 bucket, with optional end-to-end encryption and a connection card for your other PCs
- keeps cloud account access in the main header and scan-source management inside Scan Hub instead of burying both in a generic settings window

## Cloud saves

F95Launcher runs no servers. Saves sync into storage the user owns (see `docs/save-storage.md`): a folder kept in sync by a desktop cloud client, a WebDAV server or an S3-compatible bucket. The first-launch assistant detects the clouds already installed on the PC and connects one in a single click; Settings → Save storage offers the rest, including a passphrase for end-to-end encryption and a portable connection card. The account-based Supabase flow below remains available as an advanced option for people hosting their own project.

Legacy account flow: a user signs in once, and the app can back up and restore that user's saves across machines.

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
- unpack or move the payload into the library (zip, 7z, rar, tar.gz and more, no external archiver needed; password prompts, disk-full and damaged-download diagnostics)
- keep the downloaded package after a failed install so it can be retried, unpacked with a password or installed from a folder you unpacked yourself
- detect the engine and launcher from the unpacked files (Unity player, Unreal bootstrap, RPG Maker `Game.exe`, `index.html` ...)
- register the installed version in the local database

When a mirror requires captcha confirmation, the app now keeps that flow resumable instead of dumping the user into a dead end.

## Interface runtime

- Every renderer window loads React, Babel, fonts and icons from `src/assets/vendor`, so the app starts without network access (see `src/assets/vendor/README.md` for versions).
- `src/core/ui/atlas-ui.js` is the framework-free layer loaded first in each window: boot splash with a recoverable error screen, global error capture (logged to the main process), toasts, confirm/alert dialogs, an Escape-key stack, ripple/press feedback and the offline notice.
- `src/core/ui/atlas-react.js` adds the React helpers: `usePresence`/`useModalLayer` for enter/exit animations, `useEscape`, `useBusyAction` and error boundaries (`AtlasErrorBoundary`, `AtlasSafe`) that keep a failing panel from blanking the window.
- Motion tokens live in `src/assets/css/main.css` (400–700 ms, expo-out easing). Settings → Interface → *Interface animations* switches between System, Full, Reduced and Off; the choice applies instantly to every window.
- The main process reloads crashed renderers and offers a recovery dialog for hung windows (`src/main/windowResilience.js`); `config.ini` is written atomically (`src/main/atomicFile.js`).

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
