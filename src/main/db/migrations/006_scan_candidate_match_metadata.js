// @ts-check

module.exports = {
  version: 6,
  name: "scan_candidate_match_metadata",
  statements: [
    `
      ALTER TABLE scan_candidates
      ADD COLUMN match_status TEXT NOT NULL DEFAULT 'unmatched';
    `,
    `
      ALTER TABLE scan_candidates
      ADD COLUMN match_score INTEGER NOT NULL DEFAULT 0;
    `,
    `
      ALTER TABLE scan_candidates
      ADD COLUMN match_reasons_json TEXT;
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_scan_candidates_match_status_score
      ON scan_candidates (match_status, match_score DESC, last_seen_at DESC);
    `,
  ],
};
