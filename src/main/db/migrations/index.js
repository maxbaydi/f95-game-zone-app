// @ts-check

const initialSchemaMigration = require("./001_initial");
const scanSourcesMigration = require("./002_scan_sources");
const scanJobsMigration = require("./003_scan_jobs");
const scanCandidatesMigration = require("./004_scan_candidates");
const saveSyncMigration = require("./005_save_sync");
const scanCandidateMatchMetadataMigration = require("./006_scan_candidate_match_metadata");

module.exports = [
  initialSchemaMigration,
  scanSourcesMigration,
  scanJobsMigration,
  scanCandidatesMigration,
  saveSyncMigration,
  scanCandidateMatchMetadataMigration,
];
