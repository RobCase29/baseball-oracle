export const MAGNIFICENT_X_SCHEMA_VERSION = 'magnificent-x-market-signal.v1' as const
export const MAGNIFICENT_X_FEED_SCHEMA_VERSION = 'magnificent-x-feed.v1' as const
export const MAGNIFICENT_X_CONTRACT_VERSION = 'magnificent-x-contract/v1' as const
export const MAGNIFICENT_X_MODEL_VERSION =
  'magnificent-x-market-signal/18m-provisional-v1.0.0' as const
export const MAGNIFICENT_X_REQUIRED_HISTORY_MONTHS = 36 as const
export const MAGNIFICENT_X_COHORT_PRIOR = 50 as const
export const MAGNIFICENT_X_COHORT_SHRINKAGE_K = 200 as const

export const MAGNIFICENT_X_MARKET_WEIGHTS = {
  scale: 0.4,
  persistence: 0.25,
  shockResistance: 0.15,
  trendContext: 0.2,
} as const

export const MAGNIFICENT_X_SEMANTICS = {
  publicationStatus: 'research_only_provisional_market_signal',
  subjectMeaning:
    'subject_level_completed_ebay_singles_sales_volume_not_exact_card_performance',
  scoreMeaning:
    'market_signal_prioritizes_durable_subject_demand_within_provider_cohort_not_expected_return',
  magnificentMeaning:
    'magnificent_x_is_withheld_until_every_domain_identity_supply_history_and_card_gate_passes',
  comparisonPolicy:
    'compare_market_signal_within_provider_cohort_global_cross_hobby_ranking_is_not_validated',
  investmentAdvice: false,
} as const

export type MagnificentXSubjectType = 'athlete' | 'pokemon_character'
export type MagnificentXDomain =
  | 'baseball'
  | 'basketball'
  | 'football'
  | 'soccer'
  | 'hockey'
  | 'golf'
  | 'combat'
  | 'other_sport'
  | 'mixed_sport'
  | 'culture'
  | 'pokemon'
export type MagnificentXTaxonomyStatus =
  | 'coherent_provider_cohort'
  | 'small_provider_cohort'
  | 'mixed_provider_cohort'
  | 'outside_sports_scope'
export type MagnificentXResearchTier =
  | 'market_leader'
  | 'durable_demand'
  | 'watch'
  | 'noise_risk'
  | 'long_tail'
  | 'evidence_needed'
export type MagnificentXIdentityStatus =
  | 'source_name_only'
  | 'ambiguous_normalized_name'
  | 'canonical_identity_missing'
export type MagnificentXFreshnessStatus = 'current' | 'stale' | 'unknown'

export interface MagnificentXSourceRow {
  subjectType: MagnificentXSubjectType
  domain: MagnificentXDomain
  taxonomyStatus: MagnificentXTaxonomyStatus
  sourceCategory: string
  subjectName: string
  normalizedName: string
  sourceKey: string
  monthlySalesUsd: readonly number[]
  firstGradedYear: number | null
  mostGradedYear: number | null
}

export interface MagnificentXMarketInput {
  row: MagnificentXSourceRow
  cohortSize: number
  withinCohortPercentile: number
  globalScalePercentile: number | null
  identityStatus: MagnificentXIdentityStatus
  freshnessStatus: MagnificentXFreshnessStatus
}

export interface MagnificentXMarketSignal {
  score: number
  provisional: true
  latestTwelveMonthSalesUsd: number
  currentSixMonthSalesUsd: number
  priorYearSixMonthSalesUsd: number
  withinCohortPercentile: number
  shrunkWithinCohortPercentile: number
  globalScalePercentile: number | null
  components: {
    scale: number
    persistence: number
    shockResistance: number
    trendContext: number
  }
  diagnostics: {
    observedMonths: number
    positiveMonthRatio: number
    lowerQuartileToMedianRatio: number
    latestTwelveMonthHhi: number
    yearOverYearSixMonthLogGrowth: number
    recentThreeMonthYearOverYearLogGrowth: number
    recentThreeMonthAccelerationContext: number
  }
}

export interface MagnificentXAssessment {
  schemaVersion: typeof MAGNIFICENT_X_SCHEMA_VERSION
  contractVersion: typeof MAGNIFICENT_X_CONTRACT_VERSION
  modelVersion: typeof MAGNIFICENT_X_MODEL_VERSION
  semantics: typeof MAGNIFICENT_X_SEMANTICS
  marketSignal: MagnificentXMarketSignal
  researchTier: MagnificentXResearchTier
  domainFundamentals: {
    score: null
    modelFamily: 'market_only_v1'
    reasonCodes: string[]
  }
  magnificentX: {
    score: null
    eligible: false
    designation: 'withheld'
    passedGateCount: number
    requiredGateCount: number
    gates: {
      marketStrength: boolean
      cohortQuality: boolean
      historyDepth: false
      canonicalIdentity: false
      domainFundamentals: false
      globalScale: false
      supplyDilution: false
      exactCardEvidence: false
      modelValidation: false
      currentFreshness: boolean
    }
    reasonCodes: string[]
  }
  confidence: {
    score: number
    band: 'provisional' | 'low' | 'withheld'
    meaning: 'evidence_quality_not_statistical_confidence_interval'
    reasonCodes: string[]
  }
  flags: {
    identityStatus: MagnificentXIdentityStatus
    taxonomyStatus: MagnificentXTaxonomyStatus
    freshnessStatus: MagnificentXFreshnessStatus
    cohortSize: number
    observedHistoryMonths: number
    requiredHistoryMonths: typeof MAGNIFICENT_X_REQUIRED_HISTORY_MONTHS
    cardLevelActionable: false
  }
}

export interface MagnificentXFeedItem {
  recordVersion: 'magnificent-x-feed-item/v1'
  subject: {
    id: string
    type: MagnificentXSubjectType
    domain: MagnificentXDomain
    sourceCategory: string
    name: string
    identityStatus: MagnificentXIdentityStatus
    firstGradedYear: number | null
    mostGradedYear: number | null
  }
  withinCohortRank: number
  assessment: MagnificentXAssessment
}

export interface MagnificentXFeedResponse {
  schemaVersion: typeof MAGNIFICENT_X_FEED_SCHEMA_VERSION
  contractVersion: typeof MAGNIFICENT_X_CONTRACT_VERSION
  snapshot: {
    id: string
    historyStart: string
    historyMonths: number
    dataThrough: string
    publishedAt: string
    acquiredAt: string
    freshness: {
      status: MagnificentXFreshnessStatus
      cadence: 'monthly'
      nextExpectedBy: string
      reasonCodes: string[]
    }
  }
  items: MagnificentXFeedItem[]
  cohorts: Array<{
    domain: MagnificentXDomain
    taxonomyStatus: MagnificentXTaxonomyStatus
    subjectCount: number
    marketLeaderCount: number
    magnificentEligibleCount: 0
  }>
  page: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  meta: {
    researchOnly: true
    investmentAdvice: false
    magnificentEligibleCount: 0
    marketSource: 'GemRate Athlete + Pokémon Sales Trends'
    marketMeasure: 'completed_ebay_singles_sales_volume_usd'
    rawExportsPublished: false
    globalRankingAvailable: false
    globalRankingReason:
      'provider_export_cap_and_cross_subject_overlap_not_independently_verified'
    exactCardRecommendationsAvailable: false
    ageIncluded: false
    agePolicy:
      'age_requires_canonical_sport_identity_and_validated_domain_adapter_not_inferred_from_name'
    permissionAttestation: 'docs/permissions/GEMRATE_ATTESTATION.md'
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function quantile(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]!
  const weight = index - lower
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight
}

function safeLogGrowth(current: number, prior: number): number {
  return Math.log((current + 1) / (prior + 1))
}

function boundedTrendScore(logGrowth: number): number {
  return round(50 + 25 * clamp(logGrowth / Math.log(2), -1, 1))
}

export function midrankPercentiles<T>(
  rows: readonly T[],
  valueFor: (row: T) => number,
  keyFor: (row: T) => string,
): Map<string, number> {
  const sorted = [...rows].sort((left, right) => (
    valueFor(left) - valueFor(right) ||
    keyFor(left).localeCompare(keyFor(right), 'en-US')
  ))
  const result = new Map<string, number>()
  if (sorted.length === 0) return result
  if (sorted.length === 1) {
    result.set(keyFor(sorted[0]!), 100)
    return result
  }
  for (let start = 0; start < sorted.length;) {
    let end = start + 1
    while (end < sorted.length && valueFor(sorted[end]!) === valueFor(sorted[start]!)) {
      end += 1
    }
    const averageZeroBasedRank = (start + (end - 1)) / 2
    const percentile = round(100 * averageZeroBasedRank / (sorted.length - 1), 4)
    for (let index = start; index < end; index += 1) {
      result.set(keyFor(sorted[index]!), percentile)
    }
    start = end
  }
  return result
}

export function computeMagnificentXMarketSignal(
  input: MagnificentXMarketInput,
): MagnificentXMarketSignal {
  const months = input.row.monthlySalesUsd
  if (
    months.length !== 18 ||
    months.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error('Magnificent X provisional market signal requires 18 complete non-negative months')
  }
  const latestTwelve = months.slice(-12)
  const currentSix = months.slice(-6)
  const priorYearSix = months.slice(0, 6)
  const currentRecentThree = months.slice(-3)
  const priorYearRecentThree = months.slice(3, 6)
  const latestTwelveMonthSalesUsd = sum(latestTwelve)
  const currentSixMonthSalesUsd = sum(currentSix)
  const priorYearSixMonthSalesUsd = sum(priorYearSix)
  const positiveMonthRatio = months.filter((value) => value > 0).length / months.length
  const median = quantile(months, 0.5)
  const lowerQuartile = quantile(months, 0.25)
  const lowerQuartileToMedianRatio =
    median <= 0 ? (lowerQuartile <= 0 ? 0 : 1) : clamp(lowerQuartile / median, 0, 1)
  const persistence = round(
    0.5 * positiveMonthRatio * 100 +
    0.3 * 100 +
    0.2 * lowerQuartileToMedianRatio * 100,
  )
  const hhi = latestTwelveMonthSalesUsd <= 0
    ? 1
    : latestTwelve.reduce((total, value) => {
      const share = value / latestTwelveMonthSalesUsd
      return total + share * share
    }, 0)
  const shockResistance = round(
    100 * (1 - clamp((hhi - 1 / 12) / (1 - 1 / 12), 0, 1)),
  )
  const yearOverYearSixMonthLogGrowth = safeLogGrowth(
    currentSixMonthSalesUsd,
    priorYearSixMonthSalesUsd,
  )
  const recentThreeMonthYearOverYearLogGrowth = safeLogGrowth(
    sum(currentRecentThree),
    sum(priorYearRecentThree),
  )
  const trendContext = boundedTrendScore(yearOverYearSixMonthLogGrowth)
  const recentThreeMonthAccelerationContext =
    boundedTrendScore(recentThreeMonthYearOverYearLogGrowth)
  const shrinkage = input.cohortSize / (
    input.cohortSize + MAGNIFICENT_X_COHORT_SHRINKAGE_K
  )
  const shrunkWithinCohortPercentile = round(
    MAGNIFICENT_X_COHORT_PRIOR +
    shrinkage * (input.withinCohortPercentile - MAGNIFICENT_X_COHORT_PRIOR),
  )
  // Cross-subject overlap and the exact 5,000-row athlete export cap are not
  // independently verified. The unavailable global input therefore stays at
  // the fixed prior instead of silently expanding the within-cohort weight.
  const globalEffective = input.globalScalePercentile ?? MAGNIFICENT_X_COHORT_PRIOR
  const scale = round(0.65 * shrunkWithinCohortPercentile + 0.35 * globalEffective)
  const score = round(
    MAGNIFICENT_X_MARKET_WEIGHTS.scale * scale +
    MAGNIFICENT_X_MARKET_WEIGHTS.persistence * persistence +
    MAGNIFICENT_X_MARKET_WEIGHTS.shockResistance * shockResistance +
    MAGNIFICENT_X_MARKET_WEIGHTS.trendContext * trendContext,
  )
  return {
    score,
    provisional: true,
    latestTwelveMonthSalesUsd,
    currentSixMonthSalesUsd,
    priorYearSixMonthSalesUsd,
    withinCohortPercentile: round(input.withinCohortPercentile),
    shrunkWithinCohortPercentile,
    globalScalePercentile: input.globalScalePercentile,
    components: {
      scale,
      persistence,
      shockResistance,
      trendContext,
    },
    diagnostics: {
      observedMonths: months.length,
      positiveMonthRatio: round(positiveMonthRatio, 4),
      lowerQuartileToMedianRatio: round(lowerQuartileToMedianRatio, 4),
      latestTwelveMonthHhi: round(hhi, 6),
      yearOverYearSixMonthLogGrowth: round(yearOverYearSixMonthLogGrowth, 4),
      recentThreeMonthYearOverYearLogGrowth:
        round(recentThreeMonthYearOverYearLogGrowth, 4),
      recentThreeMonthAccelerationContext,
    },
  }
}

function researchTier(
  signal: MagnificentXMarketSignal,
  input: MagnificentXMarketInput,
): MagnificentXResearchTier {
  if (
    input.row.taxonomyStatus !== 'coherent_provider_cohort' ||
    input.cohortSize < 100 ||
    input.identityStatus === 'ambiguous_normalized_name'
  ) {
    return 'evidence_needed'
  }
  if (
    signal.withinCohortPercentile >= 85 &&
    (
      signal.components.shockResistance < 60 ||
      signal.components.trendContext < 40 ||
      signal.diagnostics.recentThreeMonthAccelerationContext < 35
    )
  ) {
    return 'noise_risk'
  }
  if (
    signal.score >= 70 &&
    signal.withinCohortPercentile >= 98 &&
    signal.components.shockResistance >= 60 &&
    signal.components.trendContext >= 45
  ) {
    return 'market_leader'
  }
  if (
    signal.score >= 64 &&
    signal.withinCohortPercentile >= 90 &&
    signal.components.shockResistance >= 55
  ) {
    return 'durable_demand'
  }
  if (signal.score >= 60 && signal.withinCohortPercentile >= 60) return 'watch'
  return 'long_tail'
}

export function buildMagnificentXAssessment(
  input: MagnificentXMarketInput,
): MagnificentXAssessment {
  const marketSignal = computeMagnificentXMarketSignal(input)
  const tier = researchTier(marketSignal, input)
  const marketStrength =
    marketSignal.score >= 70 &&
    marketSignal.withinCohortPercentile >= 98 &&
    marketSignal.components.shockResistance >= 60 &&
    marketSignal.components.trendContext >= 45
  const cohortQuality =
    input.row.taxonomyStatus === 'coherent_provider_cohort' &&
    input.cohortSize >= 100
  const currentFreshness = input.freshnessStatus === 'current'
  const gates = {
    marketStrength,
    cohortQuality,
    historyDepth: false as const,
    canonicalIdentity: false as const,
    domainFundamentals: false as const,
    globalScale: false as const,
    supplyDilution: false as const,
    exactCardEvidence: false as const,
    modelValidation: false as const,
    currentFreshness,
  }
  const reasonCodes = [
    ...(marketStrength ? [] : ['market_strength_gate_not_met']),
    ...(cohortQuality ? [] : ['cohort_quality_gate_not_met']),
    'history_below_36_complete_months',
    'canonical_subject_identity_missing',
    'domain_fundamentals_missing',
    'global_scale_overlap_not_verified',
    'supply_dilution_evidence_missing',
    'exact_card_evidence_missing',
    'outcome_validation_missing',
    ...(currentFreshness ? [] : ['market_snapshot_not_current']),
    ...(input.row.subjectType === 'pokemon_character'
      ? ['pokemon_character_bucket_not_exact_card', 'national_dex_identity_missing']
      : ['athlete_sport_era_identity_unverified']),
  ]
  const evidenceCompleteness =
    input.row.taxonomyStatus === 'coherent_provider_cohort' ? 40 : 25
  const identityStrength =
    input.identityStatus === 'ambiguous_normalized_name' ? 0 : 25
  const freshnessScore =
    input.freshnessStatus === 'current'
      ? 100
      : input.freshnessStatus === 'stale' ? 0 : 25
  const historyDepth = 100 * Math.min(
    1,
    input.row.monthlySalesUsd.length / MAGNIFICENT_X_REQUIRED_HISTORY_MONTHS,
  )
  const modelValidation = 25
  const confidenceScore = round(Math.min(
    50,
    0.4 * evidenceCompleteness +
    0.2 * identityStrength +
    0.15 * freshnessScore +
    0.15 * historyDepth +
    0.1 * modelValidation,
  ))
  const confidenceReasons = [
    'subject_name_identity_only_caps_confidence_at_50',
    'market_history_is_18_of_36_required_months',
    'provisional_model_not_outcome_validated',
    ...(input.identityStatus === 'ambiguous_normalized_name'
      ? ['normalized_name_collision']
      : []),
    ...(cohortQuality ? [] : ['provider_cohort_not_eligible']),
  ]
  return {
    schemaVersion: MAGNIFICENT_X_SCHEMA_VERSION,
    contractVersion: MAGNIFICENT_X_CONTRACT_VERSION,
    modelVersion: MAGNIFICENT_X_MODEL_VERSION,
    semantics: MAGNIFICENT_X_SEMANTICS,
    marketSignal,
    researchTier: tier,
    domainFundamentals: {
      score: null,
      modelFamily: 'market_only_v1',
      reasonCodes: [
        'validated_domain_adapter_unavailable',
        ...(input.row.subjectType === 'athlete'
          ? ['age_not_inferred_without_canonical_identity']
          : ['pokemon_character_rubric_not_yet_officially_sourced']),
      ],
    },
    magnificentX: {
      score: null,
      eligible: false,
      designation: 'withheld',
      passedGateCount: Object.values(gates).filter(Boolean).length,
      requiredGateCount: Object.keys(gates).length,
      gates,
      reasonCodes,
    },
    confidence: {
      score: confidenceScore,
      band: input.identityStatus === 'ambiguous_normalized_name'
        ? 'withheld'
        : confidenceScore >= 40 ? 'provisional' : 'low',
      meaning: 'evidence_quality_not_statistical_confidence_interval',
      reasonCodes: confidenceReasons,
    },
    flags: {
      identityStatus: input.identityStatus,
      taxonomyStatus: input.row.taxonomyStatus,
      freshnessStatus: input.freshnessStatus,
      cohortSize: input.cohortSize,
      observedHistoryMonths: input.row.monthlySalesUsd.length,
      requiredHistoryMonths: MAGNIFICENT_X_REQUIRED_HISTORY_MONTHS,
      cardLevelActionable: false,
    },
  }
}

export function isMagnificentXFeedResponse(
  value: unknown,
): value is MagnificentXFeedResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MagnificentXFeedResponse>
  return (
    candidate.schemaVersion === MAGNIFICENT_X_FEED_SCHEMA_VERSION &&
    candidate.contractVersion === MAGNIFICENT_X_CONTRACT_VERSION &&
    Array.isArray(candidate.items) &&
    Array.isArray(candidate.cohorts) &&
    Boolean(candidate.snapshot) &&
    Boolean(candidate.page) &&
    Boolean(candidate.meta)
  )
}
