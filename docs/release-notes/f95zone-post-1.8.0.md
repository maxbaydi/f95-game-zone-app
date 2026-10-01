# F95Launcher 1.8.0 — forum post (English)

Copy the text below into the F95zone thread. Screenshots to attach are in `docs/screenshots/`. Lines starting with `>` are notes for you, not part of the post.

---

**F95Launcher 1.8.0 — its own game catalog, read straight from F95**

Download: https://github.com/maxbaydi/f95-game-zone-app/releases/latest
Source: https://github.com/maxbaydi/f95-game-zone-app
Installed 1.3+ versions update themselves through the built-in updater.

**The catalog is now the launcher's own**
- Until now the names, versions, engines, tags and covers used to match your folders came as a packaged database from a third-party server, updated with a delay of days. 1.8.0 drops that dependency: the launcher reads the F95 "Latest Updates" list itself, the same list you see on the site.
- The first run after the update walks the whole list once (about 27,000 games, a few minutes in the background, resumable if you close the app). After that only the pages with new updates are read, usually one or two.
- It runs at startup, every 6 hours and after your PC wakes up. You need to be signed in to F95 inside the launcher. Settings → General → Background work → *Keep the game catalog up to date*; the tray menu has *Refresh Game Catalog*.
- Everything that used the catalog keeps working: folder matching when scanning, *Link to catalog*, site names and covers, "Site latest" for update notifications, and the site search with engine, status and tag filters.

**What changed in the library**
- Games are linked to the catalog by their F95 thread. Your existing links are carried over automatically. A game that was linked to a catalog entry without an F95 thread shows up as *Not matched*; use *Link to catalog* once.
- The details panel shows the engine as the site labels it, the thread prefixes, the rating and the date of the last update on the site. Language, voice, OS and release date are gone: the new source does not provide them.

**Also in this release**
- Switching between the F95 browser and the library no longer breaks the automatic continuation of an install after you sign in to F95.
- A background app-update check no longer restarts a download that is already running or waiting to be installed, and turning automatic updates off takes effect immediately.
- The weekly library backup now also runs for a launcher that lives in the tray for weeks.
- The remaining traces of the Atlas project the launcher started from are gone from the app, the installer and the code.

> Screenshots: 01-library.png (cards with covers from the new catalog), 06-settings-general.png (Background work).
