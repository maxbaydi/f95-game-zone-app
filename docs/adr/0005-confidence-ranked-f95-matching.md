# ADR 0005: Confidence-Ranked Local Scan Matching For F95/Atlas

## context

The legacy scanner tried to bind a local folder to Atlas/F95 metadata with a few weak heuristics:

- folder or executable name parsing
- broad `LIKE` queries against `atlas_data`
- implicit selection of the first result when multiple rows matched

That is not acceptable for this fork.

The product goal is not "show something plausible".
The goal is to identify already-downloaded games with high precision without silently corrupting the user's library mappings.

False positives are worse than misses here because a wrong F95/Atlas link poisons:

- title/creator metadata
- update detection
- banner/preview download
- save-cloud identity

## decision

Introduce a dedicated confidence-ranked matching pipeline for scan candidates.

The pipeline now has three layers:

1. Local identity extraction
   - parse multiple local title candidates from folder names, executable names and configured path formats
   - read `game/options.rpy` when available for Ren'Py title/version hints
   - keep creator/version hints separate from the final resolved metadata

2. Indexed Atlas/F95 ranking
   - preload Atlas/F95 rows once per scan job
   - normalize title aliases (`title`, `short_name`, `id_name`, `original_name`)
   - score candidates by weighted signals:
     - title exactness/similarity
     - creator/developer agreement
     - version compatibility
     - engine agreement
     - winner margin over the second-best candidate

3. Safe decision policy
   - auto-link only when score and corroborating signals are strong enough
   - keep ambiguous candidates unresolved instead of auto-selecting the first result
   - persist match status, score and reasons in `scan_candidates`

## alternatives

1. Keep the old `LIKE` search and tweak thresholds.
   Rejected because it still cannot explain why a match won and still produces first-result false positives on duplicate titles.

2. Use title-only fuzzy matching with an external library.
   Rejected because title-only similarity is not enough for same-name or remake/fan-patch collisions, and adding a dependency for basic string metrics is unjustified.

3. Require manual user confirmation for every imported candidate.
   Rejected because it destroys the automated-library goal; ambiguity should be surfaced only when the data really is ambiguous.

## consequences

Positive:

- scanner decisions are explainable and testable
- false positive auto-links are dramatically reduced
- scan history now retains match quality instead of only match count
- later review UI can sort by `matched` / `ambiguous` / `unmatched`

Tradeoffs:

- scan startup now builds an in-memory Atlas/F95 matcher index
- more logic exists in the scanner domain and must be covered by tests
- some previously auto-linked candidates will now remain unresolved until a manual choice is made
