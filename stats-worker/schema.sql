-- One row per install that ever sent a ping. The id is a random UUID made on
-- the user's PC; no IP address or anything about the user is stored.
CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  first_version TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS installs_first_seen ON installs (first_seen);
CREATE INDEX IF NOT EXISTS installs_last_seen ON installs (last_seen);

-- One row per install per UTC day it was used. Older days are pruned by the
-- daily cron (see RETENTION_DAYS in src/stats.js).
CREATE TABLE IF NOT EXISTS daily_active (
  day TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  PRIMARY KEY (day, id)
) WITHOUT ROWID;
