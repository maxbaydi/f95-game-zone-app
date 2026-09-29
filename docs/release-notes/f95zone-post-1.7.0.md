# F95Launcher 1.7.0 — forum post (English)

Copy the text below into the F95zone thread. Screenshots to attach are in `docs/screenshots/` (`09-f95-browser.png` is new). Lines starting with `>` are notes for you, not part of the post.

---

**F95Launcher 1.7.0 — it does more on its own, and asks less**

Download: https://github.com/maxbaydi/f95-game-zone-app/releases/latest
Source: https://github.com/maxbaydi/f95-game-zone-app
Installed 1.3+ versions update themselves through the built-in updater.

**Less to click**
- **Archive passwords from the thread.** If the starter post says "Password: …", the launcher remembers it when you open the thread and unpacks the download with it. No more hunting for the password after a failed install.
- **App updates install themselves.** A new version downloads in the background and is applied when you quit. The release is re-checked every 6 hours and after your PC wakes up. (Settings → General → Background work, if you prefer the old two-button way.)
- **Launch with Windows** and **Start in the tray**: the launcher can sit next to the clock from sign-in, checking updates, downloading and syncing saves before you open it.
- **Finished and failed installs** now show a Windows notification when the launcher is not in front — useful with the tray.
- **New games are found at startup** (a quick incremental scan a few seconds after launch), the **background update check can cover every installed game**, not only favorites, and the library database gets a **weekly automatic backup** (last four kept).

**The built-in F95 browser, cleaned up**
- One toolbar of icons instead of a row of text buttons; the page title, path and an "Installed / In library / Files missing" badge sit in an address bar; a small chip shows the current download and opens the downloads panel.
- The six stacked banners under the toolbar are gone. Captcha steps, page errors and status notes are now compact cards over the page that close themselves.

**Your own Supabase project, if you want one**
- The launcher no longer ships any cloud of its own: the old account-based Supabase sign-in is removed. If you like Supabase, connect **your** project in Settings → Save storage → Supabase project (project URL, API key, bucket). The bucket is created on first use and works like every other storage: encryption, catalog, history, connection card.
- Synced folders (OneDrive, Dropbox, Google Drive, …), WebDAV and S3 stay as before.

> Screenshots: 09-f95-browser.png (the new browser), 06-settings-save-storage.png (Save storage).
