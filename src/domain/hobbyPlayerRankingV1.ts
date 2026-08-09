export const HOBBY_PLAYER_RANKING_SCHEMA_VERSION =
  'hobby-player-ranking.v1' as const
// Frozen v1 compatibility contract. New ranking work belongs in v2.
export const HOBBY_PLAYER_RANKINGS_FEED_SCHEMA_VERSION =
  'hobby-player-rankings.v1' as const
export const HOBBY_PLAYER_RANKINGS_CONTRACT_VERSION =
  'hobby-player-rankings-contract/v1' as const
export const HOBBY_PLAYER_RANKINGS_MODEL_VERSION =
  'hobby-player-durable-signal/18m-rules-v1.0.0' as const
export const HOBBY_PLAYER_RANKING_HISTORY_MONTHS = 18 as const
export const HOBBY_PLAYER_RANKING_MAX_HYPE_PENALTY = 12 as const

export type HobbyPlayerRankingSport = 'football' | 'basketball'
export type HobbyPlayerRankingPosture =
  | 'Build'
  | 'Hold'
  | 'Watch'
  | 'Deprioritize'
export type HobbyPlayerRankingConfidenceBand =
  | 'high'
  | 'moderate'
  | 'low'
  | 'withheld'
export type HobbyPlayerRankingFreshnessStatus =
  | 'current'
  | 'stale'
  | 'unknown'
export type HobbyPlayerRankingSortKey =
  | 'rank'
  | 'score'
  | 'outlook'
  | 'market_durability'
  | 'ttm_sales'
  | 'resilience'
  | 'hype_penalty'
  | 'attention_gap'
  | 'age'
  | 'name'
export type HobbyPlayerRankingManualReviewStatus = 'approved' | 'unreviewed'

export const HOBBY_PLAYER_RANKING_POSTURES:
  readonly HobbyPlayerRankingPosture[] = [
    'Build',
    'Hold',
    'Watch',
    'Deprioritize',
  ]

export const HOBBY_PLAYER_RANKING_SORT_KEYS:
  readonly HobbyPlayerRankingSortKey[] = [
    'rank',
    'score',
    'outlook',
    'market_durability',
    'ttm_sales',
    'resilience',
    'hype_penalty',
    'attention_gap',
    'age',
    'name',
  ]

export const HOBBY_PLAYER_RANKING_SEMANTICS = {
  publicationStatus: 'research_prioritization_signal',
  scoreMeaning:
    'rules_based_weak_link_score_combining_fantasy_dynasty_outlook_and_subject_level_completed_sales_durability',
  comparisonPolicy: 'rank_only_within_sport_never_across_sports',
  agePolicy: 'required_for_display_and_filtering_but_excluded_from_score',
  momentumPolicy: 'momentum_can_only_reduce_or_flag_and_cannot_carry_score',
  identityPolicy:
    'exact_normalized_name_within_sport_only_ambiguous_or_multiple_matches_are_quarantined',
  cardPolicy:
    'subject_level_demand_not_exact_card_price_population_or_supply_evidence',
  expectedReturnClaim: false,
  investmentAdvice: false,
} as const

export interface HobbyPlayerRankingProviderPercentiles {
  oneQb: number | null
  superflex: number | null
  fiveSeason: number | null
  keeper: number | null
}

export interface HobbyPlayerRankingCandidateInput {
  id: string
  name: string
  normalizedName: string
  sport: HobbyPlayerRankingSport
  age: number
  positions: readonly string[]
  primaryPosition: string
  team: string | null
  provider: 'keeptradecut' | 'hashtag_basketball'
  providerPlayerId: string
  gemRateSourceKey: string
  providerPercentiles: HobbyPlayerRankingProviderPercentiles
  monthlySalesUsd: readonly (number | null)[]
  volumePercentile: number
  marketFreshness: HobbyPlayerRankingFreshnessStatus
  fundamentalsFreshness: HobbyPlayerRankingFreshnessStatus
  manualReviewStatus: HobbyPlayerRankingManualReviewStatus
}

export interface HobbyPlayerRankingDiagnostics {
  monthlySalesUsd: Array<number | null>
  trailingTwelveSalesUsd: number
  currentSixMonthSalesUsd: number
  priorSixMonthSalesUsd: number
  recentThreeMonthSalesUsd: number
  priorThreeMonthSalesUsd: number
  positiveMonthRatio: number
  observedHistoryRatio: number
  lowerQuartileToMedianRatio: number
  attentionGap: number
  accelerationLog: number
  accelerationContext: number
  providerPercentiles: HobbyPlayerRankingProviderPercentiles
}

export interface HobbyPlayerRankingComponents {
  outlook: number
  marketDurability: number
  volumePercentile: number
  resilience: number
  trendContext: number
  hypePenalty: number
}

export interface HobbyPlayerRankingBuildChecks {
  scoreAtLeast82: boolean
  outlookAtLeast80: boolean
  marketDurabilityAtLeast75: boolean
  volumePercentileAtLeast65: boolean
  resilienceAtLeast70: boolean
  hypePenaltyBelow4: boolean
  topFivePercent: boolean
  sourcesCurrent: boolean
  completeEighteenMonthHistory: boolean
  uniqueExactIdentity: boolean
  manualIdentityReviewed: boolean
  sensitivityStableTopDecile: boolean
}

export interface HobbyPlayerRankingSensitivity {
  stableTopDecile: boolean
  ranks: {
    outlookHeavy: number
    balanced: number
    marketHeavy: number
  }
  scores: {
    outlookHeavy: number
    balanced: number
    marketHeavy: number
  }
  scoreSpread: number
}

interface HobbyPlayerRankingProvisional {
  input: HobbyPlayerRankingCandidateInput
  score: number
  components: HobbyPlayerRankingComponents
  diagnostics: HobbyPlayerRankingDiagnostics
  sensitivityScores: HobbyPlayerRankingSensitivity['scores']
}

export interface HobbyPlayerRankingScoredCandidate
  extends HobbyPlayerRankingProvisional {
  sportRank: number
  sportPercentile: number
  posture: HobbyPlayerRankingPosture
  confidence: {
    score: number
    band: HobbyPlayerRankingConfidenceBand
    meaning: 'evidence_quality_not_statistical_confidence_interval'
    reasonCodes: string[]
  }
  gates: {
    buildEligible: boolean
    passed: number
    required: 12
    checks: HobbyPlayerRankingBuildChecks
    reasonCodes: string[]
  }
  sensitivity: HobbyPlayerRankingSensitivity
}

export interface HobbyPlayerRankingSourceEvidence {
  id: 'gemrate' | 'keeptradecut' | 'hashtag_basketball'
  label: 'GemRate' | 'KeepTradeCut' | 'Hashtag Basketball'
  url: string
  asOf: string
  fetchedAt: string
  freshness: HobbyPlayerRankingFreshnessStatus
  permissionBasis: string
  measure: string
}

export interface HobbyPlayerRankingItem {
  recordVersion: 'hobby-player-ranking-item/v1'
  id: string
  name: string
  normalizedName: string
  sport: HobbyPlayerRankingSport
  age: number
  positions: string[]
  primaryPosition: string
  team: string | null
  sportRank: number
  screenRank: number
  sportPercentile: number
  score: number
  posture: HobbyPlayerRankingPosture
  confidence: HobbyPlayerRankingScoredCandidate['confidence']
  components: HobbyPlayerRankingComponents
  diagnostics: HobbyPlayerRankingDiagnostics
  identity: {
    status: 'unique_exact'
    manualReviewStatus: HobbyPlayerRankingManualReviewStatus
    provider: 'keeptradecut' | 'hashtag_basketball'
    providerPlayerId: string
    gemRateSourceKey: string
  }
  gates: HobbyPlayerRankingScoredCandidate['gates']
  sensitivity: HobbyPlayerRankingSensitivity
  evidence: {
    marketHistoryMonths: number
    requiredMarketHistoryMonths: 18
    rankWithinSportOnly: true
    ageIncludedInScore: false
    momentumCanOnlyPenalize: true
    exactCardPricingAvailable: false
    populationDataAvailable: false
    expectedReturnValidated: false
  }
  sources: HobbyPlayerRankingSourceEvidence[]
  formulaVersion: typeof HOBBY_PLAYER_RANKINGS_MODEL_VERSION
}

export interface HobbyPlayerRankingsResponse {
  schemaVersion: typeof HOBBY_PLAYER_RANKINGS_FEED_SCHEMA_VERSION
  contractVersion: typeof HOBBY_PLAYER_RANKINGS_CONTRACT_VERSION
  modelVersion: typeof HOBBY_PLAYER_RANKINGS_MODEL_VERSION
  snapshot: {
    id: string
    generatedAt: string
    historyStart: string
    historyMonths: 18
    dataThrough: string
    publishedAt: string
    acquiredAt: string
    freshness: {
      status: HobbyPlayerRankingFreshnessStatus
      marketStatus: HobbyPlayerRankingFreshnessStatus
      fundamentalsStatus: HobbyPlayerRankingFreshnessStatus
      nextExpectedBy: string
      reasonCodes: string[]
    }
  }
  items: HobbyPlayerRankingItem[]
  cohorts: Array<{
    sport: HobbyPlayerRankingSport
    rankedCount: number
    buildCount: number
    holdCount: number
    watchCount: number
    deprioritizeCount: number
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
    expectedReturnClaim: false
    rankingPolicy: 'within_sport_only'
    agePolicy: 'display_and_filter_only_not_scored'
    momentumPolicy: 'penalty_or_flag_only_never_positive_score_driver'
    marketMeasure: 'subject_level_completed_ebay_singles_sales_volume_usd'
    exactCardRecommendationsAvailable: false
    populationDataAvailable: false
    outcomeValidationStatus: 'not_yet_outcome_validated'
    methodology: {
      formulas: {
        outlookFootball: string
        outlookBasketball: string
        resilience: string
        marketDurability: string
        attentionGap: string
        hypePenalty: string
        durableScore: string
        sensitivity: string
        age: string
      }
      buildGate: string
    }
    quarantine: {
      total: number
      ambiguousProviderIdentity: number
      ambiguousMarketIdentity: number
      missingMarketMatch: number
      incompleteProviderRanks: number
      invalidAge: number
    }
    availableFilters: {
      sports: HobbyPlayerRankingSport[]
      postures: HobbyPlayerRankingPosture[]
      sortKeys: HobbyPlayerRankingSortKey[]
      positionsBySport: {
        football: string[]
        basketball: string[]
      }
      ageRange: {
        minimum: number
        maximum: number
      }
    }
    provenance: Array<{
      id: 'gemrate' | 'keeptradecut' | 'hashtag_basketball'
      label: string
      url: string
      permissionBasis: string
      asOf: string
      fetchedAt: string
      semantics: string
    }>
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
  const sorted = values.toSorted((left, right) => left - right)
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]!
  const upperWeight = index - lower
  return sorted[lower]! * (1 - upperWeight) + sorted[upper]! * upperWeight
}

function weightedGeometricMean(
  outlook: number,
  market: number,
  outlookWeight: number,
): number {
  if (outlook <= 0 || market <= 0) return 0
  return outlook ** outlookWeight * market ** (1 - outlookWeight)
}

function durableScore(
  outlook: number,
  market: number,
  hypePenalty: number,
  variant: 'balanced' | 'outlookHeavy' | 'marketHeavy' = 'balanced',
): number {
  const geometric = weightedGeometricMean(outlook, market, 0.5)
  const raw = variant === 'outlookHeavy'
    ? 0.55 * Math.min(outlook, market) + 0.3 * geometric + 0.15 * outlook
    : variant === 'marketHeavy'
      ? 0.55 * Math.min(outlook, market) + 0.3 * geometric + 0.15 * market
      : 0.6 * Math.min(outlook, market) + 0.4 * geometric
  return round(clamp(
    raw - hypePenalty,
    0,
    100,
  ))
}

export function percentileFromProviderRank(
  rank: number | null,
  universe: number,
): number | null {
  if (
    rank === null ||
    !Number.isSafeInteger(rank) ||
    !Number.isSafeInteger(universe) ||
    universe < 2 ||
    rank < 1 ||
    rank > universe
  ) {
    return null
  }
  return round(((universe - rank) / (universe - 1)) * 100, 4)
}

export function computeHobbyPlayerOutlook(
  sport: HobbyPlayerRankingSport,
  percentiles: HobbyPlayerRankingProviderPercentiles,
): number | null {
  if (sport === 'football') {
    const oneQb = percentiles.oneQb
    const superflex = percentiles.superflex
    if (oneQb === null || superflex === null) return null
    return round(
      0.6 * Math.min(oneQb, superflex) +
        0.4 * Math.sqrt(oneQb * superflex),
    )
  }
  const fiveSeason = percentiles.fiveSeason
  const keeper = percentiles.keeper
  if (fiveSeason === null || keeper === null) return null
  return round(0.75 * fiveSeason + 0.25 * keeper)
}

export function computeHobbyPlayerMarketDiagnostics(
  monthlySalesUsd: readonly (number | null)[],
): Omit<
  HobbyPlayerRankingDiagnostics,
  'attentionGap' | 'providerPercentiles'
> & {
  resilience: number
  trendContext: number
} {
  if (
    monthlySalesUsd.length !== HOBBY_PLAYER_RANKING_HISTORY_MONTHS ||
    monthlySalesUsd.some(
      (amount) =>
        amount !== null &&
        (!Number.isSafeInteger(amount) || amount < 0),
    )
  ) {
    throw new Error(
      'Hobby player market diagnostics require exactly 18 non-negative monthly observations or nulls',
    )
  }
  const observed = monthlySalesUsd.filter(
    (amount): amount is number => amount !== null,
  )
  const observedHistoryRatio =
    observed.length / HOBBY_PLAYER_RANKING_HISTORY_MONTHS
  const positiveMonthRatio =
    observed.length === 0
      ? 0
      : observed.filter((amount) => amount > 0).length / observed.length
  const median = quantile(observed, 0.5)
  const lowerQuartile = quantile(observed, 0.25)
  const lowerQuartileToMedianRatio =
    median <= 0
      ? 0
      : clamp(lowerQuartile / median, 0, 1)
  const resilience = round(
    0.5 * positiveMonthRatio * 100 +
      0.3 * observedHistoryRatio * 100 +
      0.2 * lowerQuartileToMedianRatio * 100,
  )
  const asZero = monthlySalesUsd.map((amount) => amount ?? 0)
  const trailingTwelveSalesUsd = sum(asZero.slice(-12))
  const currentSixMonthSalesUsd = sum(asZero.slice(-6))
  const priorSixMonthSalesUsd = sum(asZero.slice(-12, -6))
  const recentThreeMonthSalesUsd = sum(asZero.slice(-3))
  const priorThreeMonthSalesUsd = sum(asZero.slice(-6, -3))
  const earlierThreeMonthSalesUsd = sum(asZero.slice(-9, -6))
  const sixMonthLogGrowth = Math.log(
    (currentSixMonthSalesUsd + 1) / (priorSixMonthSalesUsd + 1),
  )
  const trendContext = round(clamp(
    50 + 15 * Math.tanh(sixMonthLogGrowth),
    35,
    65,
  ))
  const recentGrowthLog = Math.log(
    (recentThreeMonthSalesUsd + 1) / (priorThreeMonthSalesUsd + 1),
  )
  const priorGrowthLog = Math.log(
    (priorThreeMonthSalesUsd + 1) / (earlierThreeMonthSalesUsd + 1),
  )
  const accelerationLog = recentGrowthLog - priorGrowthLog
  return {
    monthlySalesUsd: [...monthlySalesUsd],
    trailingTwelveSalesUsd,
    currentSixMonthSalesUsd,
    priorSixMonthSalesUsd,
    recentThreeMonthSalesUsd,
    priorThreeMonthSalesUsd,
    positiveMonthRatio: round(positiveMonthRatio, 4),
    observedHistoryRatio: round(observedHistoryRatio, 4),
    lowerQuartileToMedianRatio: round(lowerQuartileToMedianRatio, 4),
    accelerationLog: round(accelerationLog, 4),
    accelerationContext: round(clamp(
      50 + 50 * Math.tanh(accelerationLog),
      0,
      100,
    )),
    resilience,
    trendContext,
  }
}

export function computeHobbyPlayerHypePenalty(
  attentionGap: number,
  accelerationContext: number,
): number {
  return round(clamp(
    0.25 * Math.max(0, attentionGap - 15) +
      0.1 * Math.max(0, accelerationContext - 80),
    0,
    HOBBY_PLAYER_RANKING_MAX_HYPE_PENALTY,
  ))
}

function provisionalCandidate(
  input: HobbyPlayerRankingCandidateInput,
): HobbyPlayerRankingProvisional {
  const outlook = computeHobbyPlayerOutlook(
    input.sport,
    input.providerPercentiles,
  )
  if (outlook === null) {
    throw new Error(
      `Hobby player ${input.id} is missing a required provider rank`,
    )
  }
  if (
    !Number.isFinite(input.volumePercentile) ||
    input.volumePercentile < 0 ||
    input.volumePercentile > 100
  ) {
    throw new Error(`Hobby player ${input.id} has an invalid volume percentile`)
  }
  const market = computeHobbyPlayerMarketDiagnostics(input.monthlySalesUsd)
  const marketDurability = round(
    0.7 * input.volumePercentile +
      0.25 * market.resilience +
      0.05 * Math.min(market.trendContext, 50),
  )
  const attentionGap = round(input.volumePercentile - outlook)
  const hypePenalty = computeHobbyPlayerHypePenalty(
    attentionGap,
    market.accelerationContext,
  )
  const score = durableScore(outlook, marketDurability, hypePenalty)
  return {
    input,
    score,
    components: {
      outlook,
      marketDurability,
      volumePercentile: round(input.volumePercentile),
      resilience: market.resilience,
      trendContext: market.trendContext,
      hypePenalty,
    },
    diagnostics: {
      monthlySalesUsd: market.monthlySalesUsd,
      trailingTwelveSalesUsd: market.trailingTwelveSalesUsd,
      currentSixMonthSalesUsd: market.currentSixMonthSalesUsd,
      priorSixMonthSalesUsd: market.priorSixMonthSalesUsd,
      recentThreeMonthSalesUsd: market.recentThreeMonthSalesUsd,
      priorThreeMonthSalesUsd: market.priorThreeMonthSalesUsd,
      positiveMonthRatio: market.positiveMonthRatio,
      observedHistoryRatio: market.observedHistoryRatio,
      lowerQuartileToMedianRatio: market.lowerQuartileToMedianRatio,
      attentionGap,
      accelerationLog: market.accelerationLog,
      accelerationContext: market.accelerationContext,
      providerPercentiles: { ...input.providerPercentiles },
    },
    sensitivityScores: {
      outlookHeavy: durableScore(
        outlook,
        marketDurability,
        hypePenalty,
        'outlookHeavy',
      ),
      balanced: score,
      marketHeavy: durableScore(
        outlook,
        marketDurability,
        hypePenalty,
        'marketHeavy',
      ),
    },
  }
}

function rankedIndices(
  rows: readonly HobbyPlayerRankingProvisional[],
  scoreFor: (row: HobbyPlayerRankingProvisional) => number,
): Map<string, number> {
  const result = new Map<string, number>()
  rows.toSorted((left, right) => (
    scoreFor(right) - scoreFor(left) ||
    right.components.outlook - left.components.outlook ||
    right.components.marketDurability - left.components.marketDurability ||
    left.input.name.localeCompare(right.input.name, 'en-US')
  )).forEach((row, index) => result.set(row.input.id, index + 1))
  return result
}

function confidenceFor(
  row: HobbyPlayerRankingProvisional,
  sensitivityStableTopDecile: boolean,
): HobbyPlayerRankingScoredCandidate['confidence'] {
  const sourcesCurrent =
    row.input.marketFreshness === 'current' &&
    row.input.fundamentalsFreshness === 'current'
  const completeHistory = row.diagnostics.observedHistoryRatio === 1
  let score =
    30 +
    (row.input.manualReviewStatus === 'approved' ? 20 : 0) +
    (sourcesCurrent ? 20 : 0) +
    (completeHistory ? 15 : 0) +
    10 +
    (sensitivityStableTopDecile ? 5 : 0)
  if (!sourcesCurrent) score = Math.min(score, 40)
  if (!completeHistory) score = Math.min(score, 55)
  score = round(clamp(score, 0, 100))
  const band: HobbyPlayerRankingConfidenceBand =
    !sourcesCurrent
      ? 'withheld'
      : score >= 85
        ? 'high'
        : score >= 70
          ? 'moderate'
          : score >= 45
            ? 'low'
            : 'withheld'
  return {
    score,
    band,
    meaning: 'evidence_quality_not_statistical_confidence_interval',
    reasonCodes: [
      'subject_level_sales_not_exact_card_performance',
      'no_graded_population_or_supply_growth_input',
      'rules_based_signal_not_outcome_validated',
      ...(row.input.manualReviewStatus === 'approved'
        ? []
        : ['manual_identity_review_not_completed']),
      ...(sourcesCurrent ? [] : ['one_or_more_sources_not_current']),
      ...(completeHistory ? [] : ['market_history_incomplete']),
      ...(sensitivityStableTopDecile
        ? []
        : ['not_stable_in_top_decile_sensitivity_variants']),
    ],
  }
}

function reasonCodesForChecks(
  checks: HobbyPlayerRankingBuildChecks,
): string[] {
  const mapping: Array<[keyof HobbyPlayerRankingBuildChecks, string]> = [
    ['scoreAtLeast82', 'durable_score_below_82'],
    ['outlookAtLeast80', 'outlook_below_80'],
    ['marketDurabilityAtLeast75', 'market_durability_below_75'],
    ['volumePercentileAtLeast65', 'volume_percentile_below_65'],
    ['resilienceAtLeast70', 'resilience_below_70'],
    ['hypePenaltyBelow4', 'hype_penalty_not_below_4'],
    ['topFivePercent', 'outside_top_five_percent'],
    ['sourcesCurrent', 'one_or_more_sources_not_current'],
    ['completeEighteenMonthHistory', 'market_history_incomplete'],
    ['uniqueExactIdentity', 'unique_exact_identity_missing'],
    ['manualIdentityReviewed', 'manual_identity_review_not_completed'],
    ['sensitivityStableTopDecile', 'sensitivity_top_decile_not_stable'],
  ]
  return mapping
    .filter(([key]) => !checks[key])
    .map(([, reason]) => reason)
}

export function rankHobbyPlayerCandidates(
  inputs: readonly HobbyPlayerRankingCandidateInput[],
): HobbyPlayerRankingScoredCandidate[] {
  const ids = new Set<string>()
  for (const input of inputs) {
    if (ids.has(input.id)) {
      throw new Error(`Hobby player ranking candidate id is duplicated: ${input.id}`)
    }
    ids.add(input.id)
    if (
      !Number.isFinite(input.age) ||
      input.age < 15 ||
      input.age > 60
    ) {
      throw new Error(`Hobby player ${input.id} must have a plausible age`)
    }
  }
  const provisional = inputs.map(provisionalCandidate)
  const result: HobbyPlayerRankingScoredCandidate[] = []
  for (const sport of ['football', 'basketball'] as const) {
    const cohort = provisional.filter((row) => row.input.sport === sport)
    const balancedRanks = rankedIndices(cohort, (row) => row.score)
    const outlookHeavyRanks = rankedIndices(
      cohort,
      (row) => row.sensitivityScores.outlookHeavy,
    )
    const marketHeavyRanks = rankedIndices(
      cohort,
      (row) => row.sensitivityScores.marketHeavy,
    )
    const topDecileRank = Math.max(1, Math.ceil(cohort.length * 0.1))
    const topFivePercentRank = Math.max(1, Math.ceil(cohort.length * 0.05))
    for (const row of cohort) {
      const sportRank = balancedRanks.get(row.input.id)!
      const ranks = {
        outlookHeavy: outlookHeavyRanks.get(row.input.id)!,
        balanced: sportRank,
        marketHeavy: marketHeavyRanks.get(row.input.id)!,
      }
      const stableTopDecile = Object.values(ranks).every(
        (rank) => rank <= topDecileRank,
      )
      const sensitivity: HobbyPlayerRankingSensitivity = {
        stableTopDecile,
        ranks,
        scores: row.sensitivityScores,
        scoreSpread: round(
          Math.max(...Object.values(row.sensitivityScores)) -
            Math.min(...Object.values(row.sensitivityScores)),
        ),
      }
      const sourcesCurrent =
        row.input.marketFreshness === 'current' &&
        row.input.fundamentalsFreshness === 'current'
      const checks: HobbyPlayerRankingBuildChecks = {
        scoreAtLeast82: row.score >= 82,
        outlookAtLeast80: row.components.outlook >= 80,
        marketDurabilityAtLeast75:
          row.components.marketDurability >= 75,
        volumePercentileAtLeast65:
          row.components.volumePercentile >= 65,
        resilienceAtLeast70: row.components.resilience >= 70,
        hypePenaltyBelow4: row.components.hypePenalty < 4,
        topFivePercent: sportRank <= topFivePercentRank,
        sourcesCurrent,
        completeEighteenMonthHistory:
          row.diagnostics.observedHistoryRatio === 1,
        uniqueExactIdentity: true,
        manualIdentityReviewed:
          row.input.manualReviewStatus === 'approved',
        sensitivityStableTopDecile: stableTopDecile,
      }
      const buildEligible = Object.values(checks).every(Boolean)
      const reviewPendingBuildCandidate =
        !checks.manualIdentityReviewed &&
        Object.entries(checks).every(
          ([key, passed]) =>
            key === 'manualIdentityReviewed' || passed,
        )
      const posture: HobbyPlayerRankingPosture = buildEligible
        ? 'Build'
        : reviewPendingBuildCandidate
          ? 'Watch'
        : (
            sourcesCurrent &&
            row.diagnostics.observedHistoryRatio === 1 &&
            row.score >= 70 &&
            row.components.outlook >= 65 &&
            row.components.marketDurability >= 65 &&
            row.components.hypePenalty <= 8
          )
          ? 'Hold'
          : row.score >= 45 || !sourcesCurrent
            ? 'Watch'
            : 'Deprioritize'
      result.push({
        ...row,
        sportRank,
        sportPercentile:
          cohort.length <= 1
            ? 100
            : round(
                ((cohort.length - sportRank) / (cohort.length - 1)) * 100,
                2,
              ),
        posture,
        confidence: confidenceFor(row, stableTopDecile),
        gates: {
          buildEligible,
          passed: Object.values(checks).filter(Boolean).length,
          required: 12,
          checks,
          reasonCodes: reasonCodesForChecks(checks),
        },
        sensitivity,
      })
    }
  }
  return result.toSorted((left, right) => (
    left.input.sport.localeCompare(right.input.sport, 'en-US') ||
    left.sportRank - right.sportRank
  ))
}

export function normalizeHobbyPlayerName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/&/gu, ' and ')
    .replace(/[’'`]/gu, '')
    .replace(/[^a-zA-Z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('en-US')
}

export function isHobbyPlayerRankingsResponse(
  value: unknown,
): value is HobbyPlayerRankingsResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<HobbyPlayerRankingsResponse>
  return (
    candidate.schemaVersion === HOBBY_PLAYER_RANKINGS_FEED_SCHEMA_VERSION &&
    candidate.contractVersion === HOBBY_PLAYER_RANKINGS_CONTRACT_VERSION &&
    candidate.modelVersion === HOBBY_PLAYER_RANKINGS_MODEL_VERSION &&
    Boolean(candidate.snapshot) &&
    Array.isArray(candidate.items) &&
    candidate.items.every((item) => (
      item.recordVersion === 'hobby-player-ranking-item/v1' &&
      (item.sport === 'football' || item.sport === 'basketball') &&
      HOBBY_PLAYER_RANKING_POSTURES.includes(item.posture) &&
      Number.isFinite(item.score) &&
      Number.isSafeInteger(item.sportRank) &&
      Number.isSafeInteger(item.screenRank)
    )) &&
    Array.isArray(candidate.cohorts) &&
    Boolean(candidate.page) &&
    Boolean(candidate.meta)
  )
}
