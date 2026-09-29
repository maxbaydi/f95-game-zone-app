# F95Launcher 1.6.1 — forum post (English)

Copy the text below into the F95zone thread. Screenshots to attach are in `docs/screenshots/` (see the list at the end). Lines starting with `>` are notes for you, not part of the post.

---

**F95Launcher 1.6.1 is out — and a recap of everything since 1.3**

F95Launcher is a free, open-source desktop launcher for Windows that keeps your F95 library, updates and saves in one place. The last few releases changed a lot, so here is the whole picture in one post.

Download: https://github.com/maxbaydi/f95-game-zone-app/releases/latest
Source: https://github.com/maxbaydi/f95-game-zone-app
Installed 1.3+ versions update themselves through the built-in updater.

**What's new in 1.6**

*Your own cloud for saves — no account with us*
- The launcher no longer runs a hosted cloud. Your saves sync into storage **you** own. Setup is one click if you already use OneDrive, Dropbox, Google Drive, Yandex.Disk, iCloud, MEGA, pCloud, Nextcloud, Box or Proton Drive: the launcher detects the desktop client, creates an "F95Launcher Saves" folder in it and keeps it up to date. The cloud client uploads it.
- Power users can point it at any WebDAV server (Nextcloud, ownCloud, Yandex, Box, pCloud, Koofr, NAS) or an S3 bucket (Backblaze B2, Cloudflare R2, Wasabi, MinIO, AWS).
- Optional end-to-end encryption with a passphrase; a "connection card" file reconnects another PC in one step.
- Sync is automatic: on start, after every install or update, and after you play (the launcher watches the save folders and backs up once the game goes quiet). Before anything is overwritten, the previous saves go to a local vault.
- Reinstall a game on a fresh PC and its saves come back by themselves. A catalog in the storage shows every game that has a backup, from any of your PCs.

*Saves without any cloud at all*
- **Export to file / Import from file** on every game: one zip with a manifest. Import also understands plain zips of a `saves` folder and drops them in the right place for the engine.
- **Export all saves to folder** for the whole library.
- Save locations are now found for Ren'Py, RPG Maker (MV/MZ/VX/XP/2003), Unity, Unreal, Godot, Wolf RPG, KiriKiri, GameMaker, Flash and HTML games — game folder, AppData, LocalLow, Documents, Saved Games.

*Installs that don't give up*
- Unpacking works without any external archiver: zip, 7z, **rar** (finally, no more "unrar not found"), tar.gz and friends.
- If an install fails, the downloaded file is **kept**. The card tells you why (password needed, damaged download, disk full, file locked by antivirus, missing archive part) and offers **Retry install** without re-downloading, a password prompt, **Install from folder** for archives you unpacked yourself, and **Install from file**.
- The downloads list survives restarts; an interrupted install stays retryable.
- Nested archives are unpacked, staging is verified before your install folder is touched.
- Engine and launcher are detected from the files, so Unity, Unreal, RPG Maker, Godot, Wolf RPG, KiriKiri and HTML games get the right label and the right exe (no more launching `UnityCrashHandler64.exe`).

*Library maintenance*
- Scan Hub now has **Refresh installed games**, **Reset cache & rescan** and **Rebuild library from scratch** (backup first). Rebuild wipes stale covers so nothing from an old library leaks into the new one; partial scan failures no longer look like a broken rebuild.

**Since 1.3 (if you skipped a few versions)**

*1.5 — library that repairs itself*
- **Locate…** a game whose folder moved, **Choose .exe** for games without a launcher, remove single versions.
- "Files missing" filter with **Reinstall all** (one game at a time from its F95 thread) and **Remove all from library**.
- **Library backups** in Settings: back up and restore the whole library database.
- Games that don't match the catalog are imported anyway with a "Not matched" badge and a **Link to catalog…** action.
- **Live thread checks**: the launcher reads version numbers straight from the F95 threads of your favorites and shows updates the catalog hasn't picked up yet.
- The old "Edit Game Details" window merged into the side panel.

*1.4 — install state*
- Every game shows **installed / files missing / not installed**; games without files get "Install" instead of "Update".
- Four rescan modes: Find new games, Refresh installed games, Reset scan cache, Rebuild from scratch.
- Database integrity fixes (apostrophes in titles, folder sizes, complete removal).

*1.3 — first-run assistant, mirrors, downloads*
- A setup assistant on first launch: games folder with drive suggestions, existing games found on your PC, accounts.
- Settings rebuilt with instant saving and folder health checks.
- Mirror picker with a one-click **Recommended** button, automation tiers per host, automatic fallback to up to three other mirrors.
- A real download pipeline: queue with cancel/retry, resumable transfers, captcha/Cloudflare steps finished in a window and continued automatically, and "Install from file" for hosts that only work in your own browser (Turnstile, Adscore).
- Interface animations setting, fault-tolerant renderer, offline-safe startup.

**Supported hosts**
Pixeldrain, Buzzheavier, Gofile, Datanodes, Google Drive, Catbox fully automatic; Mixdrop, Uploadhaven, Mediafire, Workupload, Krakenfiles, Vikingfile, Dropbox, OneDrive assisted; MEGA and Filecrypt through your browser.

**Notes**
- Windows installer (NSIS) and Linux packages are on the releases page.
- The launcher stores nothing on any server of ours. F95 login is used only inside the app to read threads and download.
- Feedback, bugs and feature requests: reply here or open an issue on GitHub.

---

> Screenshots to attach (in this order), all in `docs/screenshots/` with captions in `docs/screenshots/README.md`:
> `01-library-grid.png`, `06-settings-save-storage.png`, `08-onboarding-saves.png`, `02-game-details-saves.png`, `03-downloads-panel.png`, `05-updates-inbox.png`, `04-scan-hub.png`, `07-settings-library-folders.png`.
