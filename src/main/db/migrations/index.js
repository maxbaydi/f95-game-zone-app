// @ts-check

const initialSchemaMigration = require("./001_initial");
const scanSourcesMigration = require("./002_scan_sources");
const scanJobsMigration = require("./003_scan_jobs");
const scanCandidatesMigration = require("./004_scan_candidates");
const saveSyncMigration = require("./005_save_sync");
const scanCandidateMatchMetadataMigration = require("./006_scan_candidate_match_metadata");
const f95ZoneMappingSiteUrlMigration = require("./007_f95_zone_mapping_site_url");
const gameFavoritesMigration = require("./008_game_favorites");
const cloudLibraryDeleteQueueMigration = require("./009_cloud_library_delete_queue");
const unescapeSqlQuotesMigration = require("./010_unescape_sql_quotes");
const libraryLiveVersionsMigration = require("./011_library_live_versions");
const f95CatalogMigration = require("./012_f95_catalog");
const f95CatalogThreadDetailsMigration = require("./013_f95_catalog_thread_details");

module.exports = [
  initialSchemaMigration,
  scanSourcesMigration,
  scanJobsMigration,
  scanCandidatesMigration,
  saveSyncMigration,
  scanCandidateMatchMetadataMigration,
  f95ZoneMappingSiteUrlMigration,
  gameFavoritesMigration,
  cloudLibraryDeleteQueueMigration,
  unescapeSqlQuotesMigration,
  libraryLiveVersionsMigration,
  f95CatalogMigration,
  f95CatalogThreadDetailsMigration,
];
