// @ts-check

const {
  buildCompactScanKey,
  buildTokenSet,
  compareVersionLabels,
  diceCoefficient,
  jaccardSimilarity,
  normalizeVersionLabel,
  normalizeEngineName,
  tokenOverlap,
} = require("../shared/scanMatchUtils");

/**
 * @param {import("sqlite3").Database} db
 * @param {string} sql
 * @param {unknown[]=} params
 * @returns {Promise<any[]>}
 */
function allAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows || []);
    });
  });
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string | null | undefined} value
 * @param {string} source
 * @param {number} weight
 * @returns {{ value: string, source: string, weight: number, compactKey: string, tokens: Set<string> } | null}
 */
function buildVariant(value, source, weight) {
  const trimmed = trimText(value);
  const compactKey = buildCompactScanKey(trimmed);

  if (!trimmed || compactKey.length < 3) {
    return null;
  }

  return {
    value: trimmed,
    source,
    weight,
    compactKey,
    tokens: buildTokenSet(trimmed),
  };
}

/**
 * @param {Array<{ value: string, source: string, weight: number, compactKey: string, tokens: Set<string> } | null>} variants
 */
function dedupeVariants(variants) {
  const deduped = [];
  const seen = new Set();

  for (const variant of variants) {
    if (!variant || seen.has(variant.compactKey)) {
      continue;
    }

    seen.add(variant.compactKey);
    deduped.push(variant);
  }

  return deduped;
}

/**
 * @param {Array<{ value: string, source: string, weight: number, compactKey: string, tokens: Set<string> }>} variants
 * @returns {Set<string>}
 */
function collectVariantTokens(variants) {
  const tokens = new Set();

  for (const variant of variants) {
    for (const token of variant.tokens) {
      tokens.add(token);
    }
  }

  return tokens;
}

/**
 * @param {Set<string>} leftTokens
 * @param {Set<string>} rightTokens
 * @returns {number}
 */
function countSharedTokens(leftTokens, rightTokens) {
  let shared = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }

  return shared;
}

/**
 * @param {any} row
 */
function buildIndexedEntry(row) {
  const titleVariants = dedupeVariants([
    buildVariant(row.title, "title", 10),
    buildVariant(row.original_name, "original-title", 6),
    buildVariant(row.short_name, "short-name", 12),
    buildVariant(row.id_name, "id-name", 12),
  ]);
  const creatorVariants = dedupeVariants([
    buildVariant(row.creator, "creator", 8),
    buildVariant(row.developer, "developer", 6),
  ]);

  return {
    atlasId: row.atlas_id,
    f95Id: row.f95_id || "",
    siteUrl: row.site_url || "",
    title: trimText(row.title),
    creator: trimText(row.creator),
    developer: trimText(row.developer),
    engine: trimText(row.engine),
    version: trimText(row.version),
    titleVariants,
    creatorVariants,
    titleTokens: collectVariantTokens(titleVariants),
    creatorTokens: collectVariantTokens(creatorVariants),
    normalizedEngine: normalizeEngineName(row.engine),
  };
}

/**
 * @param {Array<ReturnType<typeof buildIndexedEntry>>} entries
 */
function buildLookupIndex(entries) {
  const tokenIndex = new Map();
  const creatorTokenIndex = new Map();
  const compactKeyIndex = new Map();

  entries.forEach((entry, index) => {
    for (const token of entry.titleTokens) {
      if (!tokenIndex.has(token)) {
        tokenIndex.set(token, []);
      }

      tokenIndex.get(token).push(index);
    }

    for (const token of entry.creatorTokens) {
      if (!creatorTokenIndex.has(token)) {
        creatorTokenIndex.set(token, []);
      }

      creatorTokenIndex.get(token).push(index);
    }

    for (const variant of entry.titleVariants) {
      if (!compactKeyIndex.has(variant.compactKey)) {
        compactKeyIndex.set(variant.compactKey, []);
      }

      compactKeyIndex.get(variant.compactKey).push(index);
    }
  });

  return {
    tokenIndex,
    creatorTokenIndex,
    compactKeyIndex,
  };
}

/**
 * @param {import("sqlite3").Database} db
 * @returns {Promise<{ entries: Array<ReturnType<typeof buildIndexedEntry>>, lookup: ReturnType<typeof buildLookupIndex>, matchCandidate: (candidate: any) => any }>}
 */
async function createAtlasScanMatcher(db) {
  const rows = await allAsync(
    db,
    `
      SELECT
        atlas_data.atlas_id as atlas_id,
        atlas_data.id_name as id_name,
        atlas_data.short_name as short_name,
        atlas_data.title as title,
        atlas_data.original_name as original_name,
        atlas_data.creator as creator,
        atlas_data.developer as developer,
        atlas_data.engine as engine,
        atlas_data.version as version,
        f95_zone_data.f95_id as f95_id,
        f95_zone_data.site_url as site_url
      FROM atlas_data
      LEFT JOIN f95_zone_data ON atlas_data.atlas_id = f95_zone_data.atlas_id
    `,
  );

  const entries = rows.map(buildIndexedEntry);
  const lookup = buildLookupIndex(entries);

  return {
    entries,
    lookup,
    matchCandidate(candidate) {
      return matchAtlasCandidate(candidate, { entries, lookup });
    },
  };
}

/**
 * @param {{
 *   titleVariants?: Array<{ value: string, source?: string, weight?: number }>,
 *   creatorHints?: string[],
 *   versionHints?: string[],
 *   engine?: string
 * }} candidate
 */
function buildCandidateFingerprint(candidate) {
  const titleVariants = dedupeVariants(
    (candidate.titleVariants || []).map((variant) =>
      buildVariant(variant.value, variant.source || "detected-title", variant.weight || 0),
    ),
  );
  const creatorVariants = dedupeVariants(
    (candidate.creatorHints || []).map((creator) => buildVariant(creator, "detected-creator", 0)),
  );
  const versionHints = [...new Set((candidate.versionHints || [])
    .map((version) => trimText(version))
    .filter((version) => Boolean(normalizeVersionLabel(version))))];

  return {
    titleVariants,
    creatorVariants,
    versionHints,
    normalizedEngine: normalizeEngineName(candidate.engine),
    titleTokens: collectVariantTokens(titleVariants),
    creatorTokens: collectVariantTokens(creatorVariants),
  };
}

/**
 * @param {{ titleVariants: Array<any>, creatorTokens: Set<string>, titleTokens: Set<string> }} candidate
 * @param {{ entries: Array<ReturnType<typeof buildIndexedEntry>>, lookup: ReturnType<typeof buildLookupIndex> }} atlasIndex
 */
function shortlistEntries(candidate, atlasIndex) {
  const hitScores = new Map();
  const exactIndexes = new Set();

  for (const variant of candidate.titleVariants) {
    const exactMatches = atlasIndex.lookup.compactKeyIndex.get(variant.compactKey) || [];
    for (const exactIndex of exactMatches) {
      exactIndexes.add(exactIndex);
    }
  }

  for (const token of candidate.titleTokens) {
    const matchingIndexes = atlasIndex.lookup.tokenIndex.get(token) || [];
    for (const matchIndex of matchingIndexes) {
      hitScores.set(matchIndex, (hitScores.get(matchIndex) || 0) + 4);
    }
  }

  for (const token of candidate.creatorTokens) {
    const matchingIndexes = atlasIndex.lookup.creatorTokenIndex.get(token) || [];
    for (const matchIndex of matchingIndexes) {
      hitScores.set(matchIndex, (hitScores.get(matchIndex) || 0) + 1);
    }
  }

  const rankedIndexes = [...new Set([...exactIndexes, ...hitScores.keys()])]
    .map((index) => ({
      index,
      exact: exactIndexes.has(index),
      score: hitScores.get(index) || 0,
    }))
    .sort((left, right) => {
      if (right.exact !== left.exact) {
        return Number(right.exact) - Number(left.exact);
      }

      return right.score - left.score;
    })
    .slice(0, 180)
    .map((entry) => atlasIndex.entries[entry.index]);

  return rankedIndexes.length > 0 ? rankedIndexes : atlasIndex.entries.slice(0, 300);
}

/**
 * @param {string} localSource
 * @param {string} remoteSource
 * @returns {string}
 */
function describeTitleSources(localSource, remoteSource) {
  if (localSource === "renpy-options") {
    return `Ren'Py metadata matches Atlas ${remoteSource}`;
  }

  if (localSource === "executable-name") {
    return `executable name matches Atlas ${remoteSource}`;
  }

  if (localSource === "parent-folder") {
    return `parent folder matches Atlas ${remoteSource}`;
  }

  if (localSource === "structured-format") {
    return `configured path format matches Atlas ${remoteSource}`;
  }

  return `folder/title match against Atlas ${remoteSource}`;
}

/**
 * @param {{ titleVariants: Array<any> }} candidate
 * @param {ReturnType<typeof buildIndexedEntry>} entry
 */
function scoreTitleMatch(candidate, entry) {
  let best = {
    score: 0,
    similarity: 0,
    exact: false,
    localSource: "",
    remoteSource: "",
    reason: "",
  };

  for (const localVariant of candidate.titleVariants) {
    for (const remoteVariant of entry.titleVariants) {
      let score = 0;
      let similarity = 0;
      let exact = false;

      if (localVariant.compactKey === remoteVariant.compactKey) {
        score = 118;
        similarity = 1;
        exact = true;
      } else {
        const dice = diceCoefficient(localVariant.value, remoteVariant.value);
        const overlap = tokenOverlap(localVariant.tokens, remoteVariant.tokens);
        const jaccard = jaccardSimilarity(localVariant.tokens, remoteVariant.tokens);
        const sharedTokens = countSharedTokens(localVariant.tokens, remoteVariant.tokens);
        const symmetricTokenDifference =
          localVariant.tokens.size + remoteVariant.tokens.size - sharedTokens * 2;
        const subsetMatch =
          sharedTokens > 0 &&
          sharedTokens === Math.min(localVariant.tokens.size, remoteVariant.tokens.size) &&
          localVariant.tokens.size !== remoteVariant.tokens.size;
        const containsMatch =
          localVariant.compactKey.length >= 8 &&
          remoteVariant.compactKey.length >= 8 &&
          (localVariant.compactKey.includes(remoteVariant.compactKey) ||
            remoteVariant.compactKey.includes(localVariant.compactKey));

        similarity = Math.max(dice, overlap, jaccard);
        score = Math.round(dice * 62 + overlap * 42 + jaccard * 28);

        if (containsMatch) {
          score = Math.max(score, 88);
        }

        if (overlap >= 1 && localVariant.tokens.size >= 2 && remoteVariant.tokens.size >= 2) {
          score = Math.max(score, 98);
        }

        if (symmetricTokenDifference > 0) {
          score -= Math.min(24, symmetricTokenDifference * 10);
        }

        if (subsetMatch) {
          score -= 12;
        }

        if (
          localVariant.tokens.size === 1 ||
          remoteVariant.tokens.size === 1
        ) {
          score -= 6;
        }

        score = Math.min(score, 108);
        score = Math.max(score, 0);
      }

      score += Math.min(localVariant.weight + remoteVariant.weight, 18);

      if (score > best.score) {
        best = {
          score,
          similarity,
          exact,
          localSource: localVariant.source,
          remoteSource: remoteVariant.source,
          reason: exact
            ? `exact ${describeTitleSources(localVariant.source, remoteVariant.source)}`
            : similarity >= 0.95
              ? `very close ${describeTitleSources(localVariant.source, remoteVariant.source)}`
              : `strong ${describeTitleSources(localVariant.source, remoteVariant.source)}`,
        };
      }
    }
  }

  return best;
}

/**
 * @param {{ creatorVariants: Array<any> }} candidate
 * @param {ReturnType<typeof buildIndexedEntry>} entry
 */
function scoreCreatorMatch(candidate, entry) {
  if (candidate.creatorVariants.length === 0 || entry.creatorVariants.length === 0) {
    return {
      score: 0,
      reason: "",
    };
  }

  let bestScore = 0;
  let bestReason = "";

  for (const localVariant of candidate.creatorVariants) {
    for (const remoteVariant of entry.creatorVariants) {
      let score = 0;

      if (localVariant.compactKey === remoteVariant.compactKey) {
        score = 42;
      } else {
        const dice = diceCoefficient(localVariant.value, remoteVariant.value);
        const overlap = tokenOverlap(localVariant.tokens, remoteVariant.tokens);
        const jaccard = jaccardSimilarity(localVariant.tokens, remoteVariant.tokens);
        score = Math.round(dice * 20 + overlap * 18 + jaccard * 10);
      }

      if (score > bestScore) {
        bestScore = score;
        bestReason =
          score >= 38
            ? `creator matches Atlas ${remoteVariant.source}`
            : `creator is close to Atlas ${remoteVariant.source}`;
      }
    }
  }

  if (bestScore === 0) {
    return {
      score: -18,
      reason: "creator conflicts with Atlas metadata",
    };
  }

  return {
    score: bestScore,
    reason: bestReason,
  };
}

/**
 * @param {{ versionHints: string[] }} candidate
 * @param {ReturnType<typeof buildIndexedEntry>} entry
 */
function scoreVersionMatch(candidate, entry) {
  const comparisons = [];

  for (const versionHint of candidate.versionHints) {
    const comparison = compareVersionLabels(versionHint, entry.version);
    if (comparison.matchType !== "missing") {
      comparisons.push(comparison);
    }
  }

  if (comparisons.length === 0) {
    return {
      score: 0,
      reason: "",
    };
  }

  const best = comparisons.sort((left, right) => right.score - left.score)[0];

  return {
    score: best.score,
    reason:
      best.matchType === "exact"
        ? "version matches Atlas version"
        : best.matchType === "prefix" || best.matchType === "shared-prefix"
          ? "version is compatible with Atlas version"
          : best.matchType === "major-match"
            ? "major version matches Atlas version"
            : best.matchType === "conflict"
              ? "version conflicts with Atlas version"
              : "",
  };
}

/**
 * @param {{ normalizedEngine: string }} candidate
 * @param {ReturnType<typeof buildIndexedEntry>} entry
 */
function scoreEngineMatch(candidate, entry) {
  if (!candidate.normalizedEngine || !entry.normalizedEngine) {
    return {
      score: 0,
      reason: "",
    };
  }

  if (candidate.normalizedEngine === entry.normalizedEngine) {
    return {
      score: 18,
      reason: "engine matches Atlas engine",
    };
  }

  return {
    score: -22,
    reason: "engine conflicts with Atlas engine",
  };
}

/**
 * @param {ReturnType<typeof buildCandidateFingerprint>} candidate
 * @param {ReturnType<typeof buildIndexedEntry>} entry
 */
function scoreAtlasEntry(candidate, entry) {
  const title = scoreTitleMatch(candidate, entry);
  const creator = scoreCreatorMatch(candidate, entry);
  const version = scoreVersionMatch(candidate, entry);
  const engine = scoreEngineMatch(candidate, entry);
  const siteBonus = entry.f95Id ? 5 : 0;
  const totalScore = title.score + creator.score + version.score + engine.score + siteBonus;

  const reasons = [title.reason, creator.reason, version.reason, engine.reason]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .slice(0, 4);

  return {
    atlasId: entry.atlasId,
    f95Id: entry.f95Id,
    siteUrl: entry.siteUrl,
    title: entry.title,
    creator: entry.creator,
    engine: entry.engine,
    version: entry.version,
    score: totalScore,
    titleScore: title.score,
    creatorScore: creator.score,
    versionScore: version.score,
    engineScore: engine.score,
    titleExact: title.exact,
    titleSimilarity: title.similarity,
    reasons,
  };
}

/**
 * @param {ReturnType<typeof scoreAtlasEntry>[]} matches
 */
function decideMatchOutcome(matches) {
  if (matches.length === 0) {
    return {
      status: "unmatched",
      autoMatch: false,
    };
  }

  const bestMatch = matches[0];
  const secondScore = matches[1]?.score || 0;
  const margin = bestMatch.score - secondScore;
  const strongCorroboration =
    bestMatch.creatorScore >= 16 ||
    bestMatch.versionScore >= 8 ||
    (bestMatch.titleExact &&
      bestMatch.versionScore >= 5 &&
      bestMatch.engineScore >= 18) ||
    (bestMatch.titleExact &&
      bestMatch.engineScore >= 18 &&
      Boolean(bestMatch.f95Id)) ||
    (bestMatch.creatorScore >= 10 && bestMatch.engineScore >= 18);

  const strongAutoMatch =
    bestMatch.titleExact &&
    bestMatch.score >= 150 &&
    margin >= 15 &&
    strongCorroboration;
  const clearNearExactAutoMatch =
    !bestMatch.titleExact &&
    bestMatch.titleScore >= 120 &&
    bestMatch.score >= 140 &&
    margin >= 60 &&
    bestMatch.engineScore >= 18;
  const creatorAnchoredAutoMatch =
    bestMatch.creatorScore >= 38 &&
    bestMatch.versionScore >= 12 &&
    bestMatch.engineScore >= 18 &&
    bestMatch.score >= 145 &&
    margin >= 25;
  const preciseVersionAutoMatch =
    bestMatch.titleScore >= 88 &&
    bestMatch.versionScore >= 18 &&
    bestMatch.engineScore >= 18 &&
    bestMatch.score >= 125 &&
    margin >= 20;
  const similarityAutoMatch =
    bestMatch.titleSimilarity >= 0.96 &&
    bestMatch.score >= 165 &&
    margin >= 35 &&
    (bestMatch.creatorScore >= 16 || bestMatch.versionScore >= 8);

  if (
    strongAutoMatch ||
    clearNearExactAutoMatch ||
    creatorAnchoredAutoMatch ||
    preciseVersionAutoMatch ||
    similarityAutoMatch
  ) {
    return {
      status: "matched",
      autoMatch: true,
      margin,
    };
  }

  if (bestMatch.score >= 95) {
    return {
      status: "ambiguous",
      autoMatch: false,
      margin,
    };
  }

  return {
    status: "unmatched",
    autoMatch: false,
    margin,
  };
}

/**
 * @param {{
 *   titleVariants?: Array<{ value: string, source?: string, weight?: number }>,
 *   creatorHints?: string[],
 *   versionHints?: string[],
 *   engine?: string
 * }} candidateInput
 * @param {{ entries: Array<ReturnType<typeof buildIndexedEntry>>, lookup: ReturnType<typeof buildLookupIndex> }} atlasIndex
 */
function matchAtlasCandidate(candidateInput, atlasIndex) {
  const candidate = buildCandidateFingerprint(candidateInput);

  if (candidate.titleVariants.length === 0) {
    return {
      status: "unmatched",
      autoMatch: false,
      matches: [],
      bestMatch: null,
      matchScore: 0,
      matchReasons: [],
    };
  }

  const shortlistedEntries = shortlistEntries(candidate, atlasIndex);
  const scoredMatches = shortlistedEntries
    .map((entry) => scoreAtlasEntry(candidate, entry))
    .filter((match) => match.titleScore >= 72 || match.score >= 95)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  const decision = decideMatchOutcome(scoredMatches);
  const bestMatch = scoredMatches[0] || null;

  return {
    status: decision.status,
    autoMatch: decision.autoMatch,
    matches: scoredMatches,
    bestMatch,
    matchScore: bestMatch?.score || 0,
    matchReasons: bestMatch?.reasons || [],
    margin: decision.margin || 0,
  };
}

module.exports = {
  createAtlasScanMatcher,
  matchAtlasCandidate,
};
