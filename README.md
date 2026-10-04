# F95Launcher

F95Launcher (repository `f95-game-zone-app`) is a desktop manager for F95 games on Windows. It focuses on four things that actually matter in day-to-day use:

- a reliable installed library
- live F95 thread search and update flow
- download/install directly into the library
- save protection with local vault backups and cloud sync

## What it does

- scans local folders and builds a real installed-games library
- keeps its own game catalog, read straight from the F95 game list (no third-party metadata server): names, versions, engines, tags, covers
- opens live F95 threads inside the app through a logged-in session
- installs or updates games from thread mirrors into the correct library folder
- keeps a downloads queue with background progress and history
- detects save locations for Ren'Py, RPG Maker, Unity, Unreal, Godot, Wolf RPG, KiriKiri, GameMaker, Flash and HTML games (game folder, AppData, LocalLow, Documents, Saved Games)
- exports and imports saves as plain zip files, per game or for the whole library, with no account needed
- backs up saves before destructive operations
- syncs saves into a cloud you already own: OneDrive, Dropbox, Google Drive, Yandex.Disk and other desktop clients in one click, or any WebDAV server, S3 bucket or your own Supabase project, with optional end-to-end encryption and a connection card for your other PCs
- works in the background: launch with Windows into the tray, automatic app updates, weekly library backups, thread checks and save sync after the PC wakes up, install notifications, archive passwords read from the thread
- keeps the save storage state in the main header and scan-source management inside Scan Hub instead of burying both in a generic settings window

## Cloud saves

F95Launcher ships no cloud account and keeps no saves on its own servers. Saves sync into storage the user owns (see `docs/save-storage.md`): a folder kept in sync by a desktop cloud client, a WebDAV server, an S3-compatible bucket or a bucket in the user's own Supabase project. The first-launch assistant detects the clouds already installed on the PC and connects one in a single click; Settings → Save storage offers the rest, including a passphrase for end-to-end encryption and a portable connection card.

Current cloud-save behavior:

- local save detection covers install-relative save folders and common Ren'Py AppData locations
- the app auto-reconciles saves on startup, after install/update, after you play, and after the PC wakes up
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
- `src/core/ui/app-ui.js` is the framework-free layer loaded first in each window: boot splash with a recoverable error screen, global error capture (logged to the main process), toasts, confirm/alert dialogs, an Escape-key stack, ripple/press feedback and the offline notice.
- `src/core/ui/app-react.js` adds the React helpers: `usePresence`/`useModalLayer` for enter/exit animations, `useEscape`, `useBusyAction` and error boundaries (`AppErrorBoundary`, `AppSafe`) that keep a failing panel from blanking the window.
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

## Usage statistics

Once a day the app sends an anonymous ping (a random install ID made on the PC, the app version, the OS, the CPU architecture and how many times each app feature from a fixed list was used) so the maintainer can see how many people use it and which features matter. Nothing about games, the library, files or accounts is sent, and the IP address is not stored. It can be turned off in Settings → General → Usage statistics or on the last step of the setup assistant. Only packaged builds report, and only once `usageStats.endpoint` in `package.json` points at a deployed counter.

- the counter is a Cloudflare Worker with a D1 database in `stats-worker/` (deploy steps in `stats-worker/README.md`); opening its URL shows a dashboard with installs, daily/weekly/monthly users, versions, systems, countries, the most and least used features and GitHub downloads per release; a personal link `<worker URL>/#key=<STATS_TOKEN>` opens it without typing the token
- `npm run stats` prints GitHub downloads per release and, with `F95LAUNCHER_STATS_URL` and `F95LAUNCHER_STATS_TOKEN` set, the user numbers
- details: `docs/usage-stats.md`, `docs/feature-usage-stats.md`

## Releases

Releases are published from this repository:

- [GitHub Releases](https://github.com/maxbaydi/f95-game-zone-app/releases)

A release is built by the *Release* workflow when a version tag is pushed (a plain push to `main` only runs the checks):

```powershell
npm version 1.7.1 --no-git-tag-version   # or edit package.json
git commit -am "release: 1.7.1"
git tag v1.7.1
git push origin main v1.7.1
```
