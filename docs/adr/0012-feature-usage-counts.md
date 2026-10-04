# ADR 0012: Feature usage counts in the daily ping

**Status:** accepted (2026-10-04); extends ADR 0011

## Context
ADR 0011 counts installs and active users. The maintainer also needs to know which parts of the app people actually use, to decide what to improve and what to simplify. ADR 0011 promised that nothing beyond the install id, version, OS and architecture is collected, and the audience is privacy-sensitive.

## Decision
- The daily ping gains an optional `features` object: counts per feature name from a fixed list (for example `library.launch: 14`). No game names, paths, search text, accounts or timestamps.
- Actions are counted in the main process by wrapping `ipcMain.handle` for an explicit allow-list of channels (`src/main/featureUsage.js`), before any handler is registered. Reads and calls the app makes by itself are not on the list. The page may report only "where the user goes" names (sections, settings pages, downloads panel), checked against a second allow-list.
- Counting follows the existing switch: nothing is counted or kept on disk while statistics are off or the build has no endpoint. Unsent counts survive restarts in `feature-usage.json` and are cleared only after a successful ping.
- The worker stores `feature_daily(day, feature, id, uses)`, accepts any well-formed name (so a new app version needs no worker change) and drops malformed entries without rejecting the ping. The dashboard ranks features by distinct users and lists catalogued features nobody used.
- The dashboard can be opened with a personal link `/#key=<token>`; the fragment never reaches the server and is removed from the address bar.

## Consequences
- The settings text, onboarding text and README now name feature counts explicitly.
- Counts are attributed to the day of the ping, not the day of use; fine for 7/30/90-day views.
- Row writes grow with features per active install per day (~10–20); the D1 free tier (100k rows written per day) covers several thousand daily users.
- The privacy promise still holds: counts are tied to the random install id only, and the list of names is reviewable in one file.
