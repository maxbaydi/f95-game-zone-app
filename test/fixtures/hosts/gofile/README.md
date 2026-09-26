# Gofile fixtures (captured 2026-09-26)

Anonymised responses of `api.gofile.io` recorded with `scripts/check-mirrors.js --capture`
while resolving a public folder link (`https://gofile.io/d/<code>`):

- `accounts-guest.json` — `POST /accounts` (guest account bootstrap).
- `accounts-website.json` — `GET /accounts/website` (account sync; ids/tokens/ip redacted).
- `contents-not-premium.json` — `GET /contents/<code>` with a wrong `x-website-token`
  (HTTP 401, `error-notPremium`).
- `contents-rate-limit.json` — HTTP 429 after too many `POST /accounts` calls.

The frontend no longer serves `/dist/js/config.js`; the website token comes from
`/js/wt.obf.js` → `generateWT(accountToken)` =
`sha256("<userAgent>::en-US::<accountToken>::<floor(now / 14400)>::12af056dacea0b")`.
The salt was verified by executing the live script in a sandbox and comparing with
`generateGofileWebsiteToken`.
