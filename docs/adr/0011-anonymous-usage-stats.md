# ADR 0011: Anonymous usage counter on a Cloudflare Worker

**Status:** accepted (2026-10-04)

## Context
The maintainer wants to know how many people downloaded the app and how many actually use it. GitHub already counts release asset downloads, but those numbers mix first installs, auto-updates and update checks, and say nothing about who keeps the app. ADR 0010 dropped the hosted Supabase project because free projects pause after a week and there is no budget for hosting. The audience is privacy-sensitive: the app must not report anything about a user's games or library.

## Decision
- Downloads are read from the GitHub Releases API (installers vs `latest*.yml` update checks, blockmaps ignored); no app change is needed for them.
- Usage comes from a once-a-day anonymous ping: a random UUID v4 minted on the PC, the app version, the OS and the CPU architecture. Nothing else is collected; the server derives the country from the request and never stores the IP.
- The backend is a Cloudflare Worker with a D1 database (`stats-worker/`): free tier, no idle pausing, one small JS file. Two tables: `installs` (one row per id) and `daily_active` (one row per id per UTC day, pruned after 400 days). Reads require a secret token; the dashboard page itself holds no data.
- Reporting is on by default, disclosed and switchable in Settings → General and on the last onboarding step. Only packaged builds report, and only when `package.json → usageStats.endpoint` is set; an environment variable points dev runs at a local `wrangler dev`.
- The client checks hourly but sends at most once per UTC day, so a launcher that lives in the tray is counted on each day it runs.

## Consequences
- "Users" means installs: one person on two PCs counts twice, a wiped profile counts again. Good enough for trends.
- The ping endpoint is public; fake pings can inflate counts but cannot read or alter anything else. Cloudflare rate limiting can be added without code changes.
- The numbers start with the first release that ships an endpoint; earlier installs are invisible until they update.
- Hosting stays at zero cost; if the Cloudflare account goes away the app just fails the ping silently.
