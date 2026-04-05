// @ts-check

module.exports = {
  version: 7,
  name: "f95_zone_mapping_site_url",
  statements: [
    `
      ALTER TABLE f95_zone_mappings
      ADD COLUMN site_url TEXT NOT NULL DEFAULT '';
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_f95_zone_mappings_record_id
      ON f95_zone_mappings (record_id);
    `,
  ],
};
