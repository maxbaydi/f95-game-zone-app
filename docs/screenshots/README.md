# Screenshots

Marketing screenshots of the renderer, taken from the browser preview in demo mode (fictional games, no real data). Regenerate with:

```powershell
npm install --no-save playwright   # once; or set PLAYWRIGHT_CHROMIUM to a Chrome/Chromium binary
npm run screenshots                # writes docs/screenshots/*.png
SCREENSHOT_ONLY=03-downloads-panel npm run screenshots   # one shot
```

Captions for the forum post:

| File | Caption |
|---|---|
| `01-library-grid.png` | Your library: favorites, engine and status badges, update badges from the F95 threads, "Files missing" and "Not installed" states with one-click Install. |
| `02-game-details-saves.png` | Game details: the Saves block with the save locations found for the game, Export/Import to a file, "Back up to OneDrive" / "Restore from OneDrive", and the last backup time. |
| `03-downloads-panel.png` | Downloads: a failed install keeps the downloaded file and tells you exactly what to do; here the archive needs a password, so you type it and unpack without re-downloading. |
| `04-scan-hub.png` | Scan Hub: refresh installed games, reset cache & rescan, rebuild from scratch with a backup, scan sources and the discovery queue. |
| `05-updates-inbox.png` | Updates: every game with a newer version, checked against the live F95 threads. |
| `06-settings-save-storage.png` | Save storage: connected to your own OneDrive, sync status, connection card for another PC, and the catalog of backups from every PC. |
| `07-settings-library-folders.png` | Library & folders: install folder health, scan folders with switches, games found on this PC, library backups. |
| `08-onboarding-saves.png` | First launch: the "Saves" step detects the clouds already on the PC and connects one in a single click. |
