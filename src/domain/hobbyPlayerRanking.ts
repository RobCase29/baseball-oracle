export const HOBBY_PLAYER_RANKING_SCHEMA_VERSION =
  'hobby-player-ranking.v2' as const
export const HOBBY_PLAYER_RANKINGS_FEED_SCHEMA_VERSION =
  'hobby-player-rankings.v2' as const
export const HOBBY_PLAYER_RANKINGS_CONTRACT_VERSION =
  'hobby-player-rankings-contract/v2' as const
export const HOBBY_PLAYER_RANKINGS_MODEL_VERSION =
  'hobby-player-durable-signal/18m-robust-core-v2.0.0' as const
export const HOBBY_PLAYER_RANKING_HISTORY_MONTHS = 18 as const
export const HOBBY_PLAYER_RANKING_MAX_DIVERGENCE_PENALTY = 12 as const
/** @deprecated Use HOBBY_PLAYER_RANKING_MAX_DIVERGENCE_PENALTY. */
export const HOBBY_PLAYER_RANKING_MAX_HYPE_PENALTY =
  HOBBY_PLAYER_RANKING_MAX_DIVERGENCE_PENALTY
export const HOBBY_PLAYER_RANKING_MAX_INPUT_INTEGRITY = 75 as const

export type HobbyPlayerRankingSport = 'football' | 'basketball'
export type HobbyPlayerRankingPosture =
  | 'Build'
  | 'Research'
  | 'Watch'
  | 'Deprioritize'
export type HobbyPlayerRankingConfidenceBand =
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
  | 'divergence_penalty'
  | 'concentration'
  | 'attention_gap'
  | 'age'
  | 'name'
export type HobbyPlayerRankingManualReviewStatus = 'approved' | 'unreviewed'
export type HobbyPlayerRankingIdentityStatus =
  | 'reviewed_exact'
  | 'reviewed_alias'
  | 'unique_normalized_name'
export type HobbyPlayerRankingEvidenceStage =
  | 'new'
  | 'developing'
  | 'emerging'
  | 'established'
export type HobbyPlayerRankingEvidenceBasis =
  | 'nfl_draft_year'
  | 'basketball_age_proxy'

export const HOBBY_PLAYER_RANKING_POSTURES:
  readonly HobbyPlayerRankingPosture[] = [
    'Build',
    'Research',
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
    'divergence_penalty',
    'concentration',
    'attention_gap',
    'age',
    'name',
  ]

export const HOBBY_PLAYER_RANKING_SEMANTICS = {
  publicationStatus: 'research_prioritization_signal',
  scoreMeaning:
    'rules_based_weak_link_active_growth_signal_combining_dynasty_outlook_and_subject_level_completed_sales_durability',
  comparisonPolicy: 'rank_only_within_sport_never_across_sports',
  agePolicy:
    'age_is_not_a_positive_score_input_basketball_age_only_supplies_a_conservative_evidence_depth_proxy',
  momentumPolicy: 'momentum_can_only_reduce_or_flag_and_cannot_carry_score',
  identityPolicy:
    'unique_normalized_name_or_explicit_reviewed_alias_with_known_collisions_and_impossible_chronology_quarantined_before_ranking',
  cardPolicy:
    'subject_level_demand_not_exact_card_price_population_or_supply_evidence',
  actionPolicy:
    'build_requires_robust_top_five_percent_membership_low_concentration_and_minimum_evidence_depth',
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
  age: number | null
  positions: readonly string[]
  primaryPosition: string
  team: string | null
  provider: 'keeptradecut' | 'hashtag_basketball'
  providerPlayerId: string
  gemRateSourceKey: string
  identityStatus: HobbyPlayerRankingIdentityStatus
  providerPercentiles: HobbyPlayerRankingProviderPercentiles
  monthlySalesUsd: readonly (number | null)[]
  volumePercentile: number
  recentSixMonthVolumePercentile: number
  fullHistoryVolumePercentile: number
  evidenceYears: number
  evidenceStage: HobbyPlayerRankingEvidenceStage
  evidenceBasis: HobbyPlayerRankingEvidenceBasis
  careerStartYear: number | null
  firstGradedYear: number | null
  mostGradedYear: number | null
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
  salesConcentrationHhi: number
  effectiveSalesMonths: number
  largestMonthShare: number
  topThreeMonthShare: number
  concentrationPercentile: number
  attentionGap: number
  attentionGapBaseline: number
  adjustedAttentionGap: number
  accelerationLog: number
  accelerationContext: number
  providerPercentiles: HobbyPlayerRankingProviderPercentiles
}

export interface HobbyPlayerRankingComponents {
  outlook: number
  marketDurability: number
  volumePercentile: number
  resilience: number
  shockResistance: number
  trendContext: number
  divergencePenalty: number
}

export interface HobbyPlayerRankingBuildChecks {
  scoreAtLeast82: boolean
  outlookAtLeast80: boolean
  marketDurabilityAtLeast75: boolean
  volumePercentileAtLeast65: boolean
  divergencePenaltyBelow4: boolean
  topFivePercent: boolean
  sourcesCurrent: boolean
  completeEighteenMonthHistory: boolean
  identityBridgeValid: boolean
  manualIdentityReviewed: boolean
  robustTopFivePercent: boolean
  minimumEvidenceDepth: boolean
  concentrationBelowSportP90: boolean
}

export interface HobbyPlayerRankingSensitivity {
  robustTopFivePercent: boolean
  topFiveInclusionRate: number
  rankRange: {
    best: number
    worst: number
  }
  ranks: {
    outlookHeavy: number
    balanced: number
    marketHeavy: number
    recentWindow: number
    fullHistory: number
    primaryFormat: number
    secondaryFormat: number
  }
  scores: {
    outlookHeavy: number
    balanced: number
    marketHeavy: number
    recentWindow: number
    fullHistory: number
    primaryFormat: number
    secondaryFormat: number
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

interface HobbyPlayerRankingCoreCandidate {
  input: HobbyPlayerRankingCandidateInput
  outlook: number
  market: ReturnType<typeof computeHobbyPlayerMarketDiagnostics>
  marketDurability: number
  recentWindowMarketDurability: number
  fullHistoryMarketDurability: number
  attentionGap: number
}

export interface HobbyPlayerRankingScoredCandidate
  extends HobbyPlayerRankingProvisional {
  sportRank: number
  sportPercentile: number
  posture: HobbyPlayerRankingPosture
  confidence: {
    score: number
    band: HobbyPlayerRankingConfidenceBand
    meaning: 'player_model_input_integrity_not_investment_confidence'
    investmentConfidence: 'withheld'
    reasonCodes: string[]
  }
  gates: {
    buildEligible: boolean
    passed: number
    required: 13
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
  recordVersion: 'hobby-player-ranking-item/v2'
  id: string
  name: string
  normalizedName: string
  sport: HobbyPlayerRankingSport
  age: number | null
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
    status: HobbyPlayerRankingIdentityStatus
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
    evidenceYears: number
    evidenceStage: HobbyPlayerRankingEvidenceStage
    evidenceBasis: HobbyPlayerRankingEvidenceBasis
    careerStartYear: number | null
    firstGradedYear: number | null
    mostGradedYear: number | null
    jointHeat: boolean
    concentrationReview: boolean
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
  scope: {
    sport: HobbyPlayerRankingSport
    screen: {
      maxAge: number | null
      position: string | null
      posture: HobbyPlayerRankingPosture | 'all'
    }
  }
  screenSummary: {
    rankedCount: number
    buildCount: number
    researchCount: number
    watchCount: number
    deprioritizeCount: number
  }
  cohorts: Array<{
    sport: HobbyPlayerRankingSport
    rankedCount: number
    buildCount: number
    researchCount: number
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
    agePolicy: 'not_a_positive_score_input_basketball_age_supplies_evidence_depth_gate'
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
        divergencePenalty: string
        durableScore: string
        sensitivity: string
        age: string
        evidenceDepth: string
        concentration: string
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
      identityControlBlocked: number
      impossibleGradedChronology: number
    }
    globalQuarantine: {
      total: number
      ambiguousProviderIdentity: number
      ambiguousMarketIdentity: number
      missingMarketMatch: number
      incompleteProviderRanks: number
      invalidAge: number
      identityControlBlocked: number
      impossibleGradedChronology: number
    }
    coverage: {
      sourceRows: number
      rankedRows: number
      coveragePercent: number
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
  divergencePenalty: number,
  variant: 'balanced' | 'outlookHeavy' | 'marketHeavy' = 'balanced',
): number {
  const geometric = weightedGeometricMean(outlook, market, 0.5)
  const raw = variant === 'outlookHeavy'
    ? 0.55 * Math.min(outlook, market) + 0.3 * geometric + 0.15 * outlook
    : variant === 'marketHeavy'
      ? 0.55 * Math.min(outlook, market) + 0.3 * geometric + 0.15 * market
      : 0.6 * Math.min(outlook, market) + 0.4 * geometric
  return round(clamp(
    raw - divergencePenalty,
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
  | 'attentionGap'
  | 'attentionGapBaseline'
  | 'adjustedAttentionGap'
  | 'concentrationPercentile'
  | 'providerPercentiles'
> & {
  resilience: number
  shockResistance: number
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
  const trailingTwelve = asZero.slice(-12)
  const salesConcentrationHhi =
    trailingTwelveSalesUsd <= 0
      ? 1
      : trailingTwelve.reduce((total, amount) => {
          const share = amount / trailingTwelveSalesUsd
          return total + share * share
        }, 0)
  const sortedShares =
    trailingTwelveSalesUsd <= 0
      ? trailingTwelve.map(() => 0)
      : trailingTwelve
          .map((amount) => amount / trailingTwelveSalesUsd)
          .toSorted((left, right) => right - left)
  const largestMonthShare = sortedShares[0] ?? 0
  const topThreeMonthShare = sum(sortedShares.slice(0, 3))
  const effectiveSalesMonths =
    salesConcentrationHhi <= 0 ? 0 : 1 / salesConcentrationHhi
  const shockResistance = round(
    100 *
      (
        1 -
        clamp(
          (salesConcentrationHhi - 1 / 12) / (1 - 1 / 12),
          0,
          1,
        )
      ),
  )
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
    salesConcentrationHhi: round(salesConcentrationHhi, 6),
    effectiveSalesMonths: round(effectiveSalesMonths, 2),
    largestMonthShare: round(largestMonthShare, 4),
    topThreeMonthShare: round(topThreeMonthShare, 4),
    accelerationLog: round(accelerationLog, 4),
    accelerationContext: round(clamp(
      50 + 50 * Math.tanh(accelerationLog),
      0,
      100,
    )),
    resilience,
    shockResistance,
    trendContext,
  }
}

export function computeHobbyPlayerDivergencePenalty(
  adjustedAttentionGap: number,
  accelerationContext: number,
): number {
  return round(clamp(
    0.25 * Math.max(0, adjustedAttentionGap - 15) +
      0.1 * Math.max(0, accelerationContext - 80),
    0,
    HOBBY_PLAYER_RANKING_MAX_DIVERGENCE_PENALTY,
  ))
}

/** @deprecated Use the position-adjusted divergence penalty. */
export function computeHobbyPlayerHypePenalty(
  attentionGap: number,
  accelerationContext: number,
): number {
  return computeHobbyPlayerDivergencePenalty(
    attentionGap,
    accelerationContext,
  )
}

function marketDurabilityFor(
  volumePercentile: number,
  market: ReturnType<typeof computeHobbyPlayerMarketDiagnostics>,
): number {
  return round(
    0.7 * volumePercentile +
      0.15 * market.resilience +
      0.1 * market.shockResistance +
      0.05 * Math.min(market.trendContext, 50),
  )
}

function formatScenarioOutlooks(
  input: HobbyPlayerRankingCandidateInput,
): { primary: number; secondary: number } {
  if (input.sport === 'football') {
    const oneQb = input.providerPercentiles.oneQb!
    const superflex = input.providerPercentiles.superflex!
    return {
      primary: round(0.75 * superflex + 0.25 * oneQb),
      secondary: round(0.25 * superflex + 0.75 * oneQb),
    }
  }
  const fiveSeason = input.providerPercentiles.fiveSeason!
  const keeper = input.providerPercentiles.keeper!
  return {
    primary: round(0.9 * fiveSeason + 0.1 * keeper),
    secondary: round(0.5 * fiveSeason + 0.5 * keeper),
  }
}

function coreCandidate(
  input: HobbyPlayerRankingCandidateInput,
): HobbyPlayerRankingCoreCandidate {
  const outlook = computeHobbyPlayerOutlook(
    input.sport,
    input.providerPercentiles,
  )
  if (outlook === null) {
    throw new Error(
      `Hobby player ${input.id} is missing a required provider rank`,
    )
  }
  for (const [label, value] of [
    ['TTM', input.volumePercentile],
    ['recent-six-month', input.recentSixMonthVolumePercentile],
    ['full-history', input.fullHistoryVolumePercentile],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(
        `Hobby player ${input.id} has an invalid ${label} volume percentile`,
      )
    }
  }
  const market = computeHobbyPlayerMarketDiagnostics(input.monthlySalesUsd)
  return {
    input,
    outlook,
    market,
    marketDurability: marketDurabilityFor(input.volumePercentile, market),
    recentWindowMarketDurability: marketDurabilityFor(
      input.recentSixMonthVolumePercentile,
      market,
    ),
    fullHistoryMarketDurability: marketDurabilityFor(
      input.fullHistoryVolumePercentile,
      market,
    ),
    attentionGap: round(input.volumePercentile - outlook),
  }
}

function provisionalCandidate(
  core: HobbyPlayerRankingCoreCandidate,
  attentionGapBaseline: number,
  concentrationPercentile: number,
): HobbyPlayerRankingProvisional {
  const { input, market, outlook, marketDurability, attentionGap } = core
  const adjustedAttentionGap = round(attentionGap - attentionGapBaseline)
  const divergencePenalty = computeHobbyPlayerDivergencePenalty(
    adjustedAttentionGap,
    market.accelerationContext,
  )
  const score = durableScore(outlook, marketDurability, divergencePenalty)
  const formatOutlooks = formatScenarioOutlooks(input)
  return {
    input,
    score,
    components: {
      outlook,
      marketDurability,
      volumePercentile: round(input.volumePercentile),
      resilience: market.resilience,
      shockResistance: market.shockResistance,
      trendContext: market.trendContext,
      divergencePenalty,
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
      salesConcentrationHhi: market.salesConcentrationHhi,
      effectiveSalesMonths: market.effectiveSalesMonths,
      largestMonthShare: market.largestMonthShare,
      topThreeMonthShare: market.topThreeMonthShare,
      concentrationPercentile: round(concentrationPercentile),
      attentionGap,
      attentionGapBaseline: round(attentionGapBaseline),
      adjustedAttentionGap,
      accelerationLog: market.accelerationLog,
      accelerationContext: market.accelerationContext,
      providerPercentiles: { ...input.providerPercentiles },
    },
    sensitivityScores: {
      outlookHeavy: durableScore(
        outlook,
        marketDurability,
        divergencePenalty,
        'outlookHeavy',
      ),
      balanced: score,
      marketHeavy: durableScore(
        outlook,
        marketDurability,
        divergencePenalty,
        'marketHeavy',
      ),
      recentWindow: durableScore(
        outlook,
        core.recentWindowMarketDurability,
        divergencePenalty,
      ),
      fullHistory: durableScore(
        outlook,
        core.fullHistoryMarketDurability,
        divergencePenalty,
      ),
      primaryFormat: durableScore(
        formatOutlooks.primary,
        marketDurability,
        divergencePenalty,
      ),
      secondaryFormat: durableScore(
        formatOutlooks.secondary,
        marketDurability,
        divergencePenalty,
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
  robustTopFivePercent: boolean,
  concentrationBelowSportP90: boolean,
): HobbyPlayerRankingScoredCandidate['confidence'] {
  const sourcesCurrent =
    row.input.marketFreshness === 'current' &&
    row.input.fundamentalsFreshness === 'current'
  const completeHistory = row.diagnostics.observedHistoryRatio === 1
  let score =
    10 +
    (row.input.manualReviewStatus === 'approved' ? 20 : 0) +
    (sourcesCurrent ? 15 : 0) +
    (completeHistory ? 15 : 0) +
    (row.input.evidenceYears >= 2 ? 5 : 0) +
    (robustTopFivePercent ? 5 : 0) +
    (concentrationBelowSportP90 ? 5 : 0)
  if (!sourcesCurrent) score = Math.min(score, 30)
  if (!completeHistory) score = Math.min(score, 45)
  score = round(clamp(
    score,
    0,
    HOBBY_PLAYER_RANKING_MAX_INPUT_INTEGRITY,
  ))
  const band: HobbyPlayerRankingConfidenceBand =
    !sourcesCurrent
      ? 'withheld'
      : score >= 60
        ? 'moderate'
        : score >= 35
          ? 'low'
          : 'withheld'
  return {
    score,
    band,
    meaning: 'player_model_input_integrity_not_investment_confidence',
    investmentConfidence: 'withheld',
    reasonCodes: [
      'subject_level_sales_not_exact_card_performance',
      'no_graded_population_or_supply_growth_input',
      'rules_based_signal_not_outcome_validated',
      ...(row.input.manualReviewStatus === 'approved'
        ? []
        : ['manual_identity_review_not_completed']),
      ...(sourcesCurrent ? [] : ['one_or_more_sources_not_current']),
      ...(completeHistory ? [] : ['market_history_incomplete']),
      ...(row.input.evidenceYears >= 2
        ? []
        : ['minimum_career_evidence_depth_not_reached']),
      ...(robustTopFivePercent
        ? []
        : ['not_robust_in_top_five_percent_scenarios']),
      ...(concentrationBelowSportP90
        ? []
        : ['sales_concentration_above_sport_p90']),
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
    ['divergencePenaltyBelow4', 'demand_outlook_divergence_penalty_not_below_4'],
    ['topFivePercent', 'outside_top_five_percent'],
    ['sourcesCurrent', 'one_or_more_sources_not_current'],
    ['completeEighteenMonthHistory', 'market_history_incomplete'],
    ['identityBridgeValid', 'reviewable_identity_bridge_missing'],
    ['manualIdentityReviewed', 'manual_identity_review_not_completed'],
    ['robustTopFivePercent', 'not_robust_in_top_five_percent_scenarios'],
    ['minimumEvidenceDepth', 'minimum_career_evidence_depth_not_reached'],
    ['concentrationBelowSportP90', 'sales_concentration_above_sport_p90'],
  ]
  return mapping
    .filter(([key]) => !checks[key])
    .map(([, reason]) => reason)
}

function median(values: readonly number[]): number {
  return quantile(values, 0.5)
}

function attentionGapBaselines(
  rows: readonly HobbyPlayerRankingCoreCandidate[],
): Map<string, number> {
  const result = new Map<string, number>()
  const sportMedian = median(rows.map((row) => row.attentionGap))
  const byPosition = new Map<string, HobbyPlayerRankingCoreCandidate[]>()
  for (const row of rows) {
    const positionKey = row.input.primaryPosition
    byPosition.set(positionKey, [
      ...(byPosition.get(positionKey) ?? []),
      row,
    ])
  }
  for (const row of rows) {
    const positionRows = byPosition.get(row.input.primaryPosition) ?? []
    const baselineRows =
      positionRows.length >= 8
        ? positionRows
        : rows
    result.set(
      row.input.id,
      baselineRows.length === 0
        ? sportMedian
        : median(baselineRows.map((candidate) => candidate.attentionGap)),
    )
  }
  return result
}

function concentrationPercentiles(
  rows: readonly HobbyPlayerRankingCoreCandidate[],
): Map<string, number> {
  const sorted = rows.toSorted((
    left,
    right,
  ) => (
    left.market.salesConcentrationHhi -
      right.market.salesConcentrationHhi ||
    left.input.id.localeCompare(right.input.id, 'en-US')
  ))
  const result = new Map<string, number>()
  for (let lower = 0; lower < sorted.length;) {
    const hhi = sorted[lower]!.market.salesConcentrationHhi
    let upper = lower
    while (
      upper + 1 < sorted.length &&
      sorted[upper + 1]!.market.salesConcentrationHhi === hhi
    ) {
      upper += 1
    }
    const midRank = (lower + upper) / 2
    const percentile =
      sorted.length <= 1
        ? 0
        : (midRank / (sorted.length - 1)) * 100
    for (let index = lower; index <= upper; index += 1) {
      result.set(sorted[index]!.input.id, round(percentile, 2))
    }
    lower = upper + 1
  }
  return result
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
      (
        input.age === null &&
        input.sport !== 'football'
      ) ||
      (
        input.age !== null &&
        (
          !Number.isFinite(input.age) ||
          input.age < 15 ||
          input.age > 60
        )
      )
    ) {
      throw new Error(
        `Hobby player ${input.id} must have a plausible age or an explicitly unknown football age`,
      )
    }
    if (
      !Number.isSafeInteger(input.evidenceYears) ||
      input.evidenceYears < 0 ||
      input.evidenceYears > 60
    ) {
      throw new Error(
        `Hobby player ${input.id} must have plausible evidence years`,
      )
    }
    if (
      input.careerStartYear !== null &&
      (
        !Number.isSafeInteger(input.careerStartYear) ||
        input.careerStartYear < 1950 ||
        input.careerStartYear > 2100
      )
    ) {
      throw new Error(
        `Hobby player ${input.id} must have a plausible career start year`,
      )
    }
  }

  const cores = inputs.map(coreCandidate)
  const provisional: HobbyPlayerRankingProvisional[] = []
  for (const sport of ['football', 'basketball'] as const) {
    const cohort = cores.filter((row) => row.input.sport === sport)
    const baselines = attentionGapBaselines(cohort)
    const concentration = concentrationPercentiles(cohort)
    provisional.push(...cohort.map((row) => provisionalCandidate(
      row,
      baselines.get(row.input.id) ?? 0,
      concentration.get(row.input.id) ?? 0,
    )))
  }

  const result: HobbyPlayerRankingScoredCandidate[] = []
  for (const sport of ['football', 'basketball'] as const) {
    const cohort = provisional.filter((row) => row.input.sport === sport)
    const rankMaps = {
      outlookHeavy: rankedIndices(
        cohort,
        (row) => row.sensitivityScores.outlookHeavy,
      ),
      balanced: rankedIndices(cohort, (row) => row.score),
      marketHeavy: rankedIndices(
        cohort,
        (row) => row.sensitivityScores.marketHeavy,
      ),
      recentWindow: rankedIndices(
        cohort,
        (row) => row.sensitivityScores.recentWindow,
      ),
      fullHistory: rankedIndices(
        cohort,
        (row) => row.sensitivityScores.fullHistory,
      ),
      primaryFormat: rankedIndices(
        cohort,
        (row) => row.sensitivityScores.primaryFormat,
      ),
      secondaryFormat: rankedIndices(
        cohort,
        (row) => row.sensitivityScores.secondaryFormat,
      ),
    }
    const topFivePercentRank = Math.max(1, Math.ceil(cohort.length * 0.05))
    for (const row of cohort) {
      const sportRank = rankMaps.balanced.get(row.input.id)!
      const ranks = {
        outlookHeavy: rankMaps.outlookHeavy.get(row.input.id)!,
        balanced: sportRank,
        marketHeavy: rankMaps.marketHeavy.get(row.input.id)!,
        recentWindow: rankMaps.recentWindow.get(row.input.id)!,
        fullHistory: rankMaps.fullHistory.get(row.input.id)!,
        primaryFormat: rankMaps.primaryFormat.get(row.input.id)!,
        secondaryFormat: rankMaps.secondaryFormat.get(row.input.id)!,
      }
      const scenarioRanks = Object.values(ranks)
      const topFiveInclusions = scenarioRanks.filter(
        (rank) => rank <= topFivePercentRank,
      ).length
      const robustTopFivePercent =
        topFiveInclusions === scenarioRanks.length
      const sensitivity: HobbyPlayerRankingSensitivity = {
        robustTopFivePercent,
        topFiveInclusionRate: round(
          topFiveInclusions / scenarioRanks.length,
          4,
        ),
        rankRange: {
          best: Math.min(...scenarioRanks),
          worst: Math.max(...scenarioRanks),
        },
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
      const concentrationBelowSportP90 =
        row.diagnostics.concentrationPercentile <= 90
      const checks: HobbyPlayerRankingBuildChecks = {
        scoreAtLeast82: row.score >= 82,
        outlookAtLeast80: row.components.outlook >= 80,
        marketDurabilityAtLeast75:
          row.components.marketDurability >= 75,
        volumePercentileAtLeast65:
          row.components.volumePercentile >= 65,
        divergencePenaltyBelow4: row.components.divergencePenalty < 4,
        topFivePercent: sportRank <= topFivePercentRank,
        sourcesCurrent,
        completeEighteenMonthHistory:
          row.diagnostics.observedHistoryRatio === 1,
        identityBridgeValid:
          row.input.identityStatus === 'reviewed_exact' ||
          row.input.identityStatus === 'reviewed_alias' ||
          row.input.identityStatus === 'unique_normalized_name',
        manualIdentityReviewed:
          row.input.manualReviewStatus === 'approved',
        robustTopFivePercent,
        minimumEvidenceDepth: row.input.evidenceYears >= 2,
        concentrationBelowSportP90,
      }
      const buildEligible = Object.values(checks).every(Boolean)
      const pendingResearchGateCandidate =
        !buildEligible &&
        Object.entries(checks).every(
          ([key, passed]) =>
            (
              key === 'manualIdentityReviewed' ||
              key === 'robustTopFivePercent' ||
              key === 'minimumEvidenceDepth' ||
              key === 'concentrationBelowSportP90'
            ) ||
            passed,
        )
      const posture: HobbyPlayerRankingPosture = buildEligible
        ? 'Build'
        : pendingResearchGateCandidate
          ? 'Watch'
        : (
            sourcesCurrent &&
            row.diagnostics.observedHistoryRatio === 1 &&
            row.input.manualReviewStatus === 'approved' &&
            row.input.evidenceYears >= 2 &&
            concentrationBelowSportP90 &&
            row.score >= 70 &&
            row.components.outlook >= 65 &&
            row.components.marketDurability >= 65 &&
            row.components.divergencePenalty <= 8
          )
          ? 'Research'
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
        confidence: confidenceFor(
          row,
          robustTopFivePercent,
          concentrationBelowSportP90,
        ),
        gates: {
          buildEligible,
          passed: Object.values(checks).filter(Boolean).length,
          required: 13,
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

function hasConsistentPostureCounts(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const counts = value as Record<string, unknown>
  const rankedCount = counts.rankedCount
  const postureCounts = [
    counts.buildCount,
    counts.researchCount,
    counts.watchCount,
    counts.deprioritizeCount,
  ]
  return (
    Number.isSafeInteger(rankedCount) &&
    (rankedCount as number) >= 0 &&
    postureCounts.every(
      (count) => Number.isSafeInteger(count) && (count as number) >= 0,
    ) &&
    sum(postureCounts as number[]) === rankedCount
  )
}

export function isHobbyPlayerRankingsResponse(
  value: unknown,
): value is HobbyPlayerRankingsResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as HobbyPlayerRankingsResponse
  const scopedSport = candidate.scope?.sport
  const freshnessStatus = candidate.snapshot?.freshness?.status
  const publicationSuspended = freshnessStatus !== 'current'
  const cohortsValid =
    Array.isArray(candidate.cohorts) &&
    candidate.cohorts.length === 2 &&
    new Set(candidate.cohorts.map((cohort) => cohort.sport)).size === 2 &&
    candidate.cohorts.some((cohort) => cohort.sport === 'football') &&
    candidate.cohorts.some((cohort) => cohort.sport === 'basketball') &&
    candidate.cohorts.every(hasConsistentPostureCounts)
  const scopedCohort = Array.isArray(candidate.cohorts)
    ? candidate.cohorts.find((cohort) => cohort.sport === scopedSport)
    : undefined
  const pageValid =
    Boolean(candidate.page) &&
    Number.isSafeInteger(candidate.page.page) &&
    candidate.page.page >= 1 &&
    Number.isSafeInteger(candidate.page.limit) &&
    candidate.page.limit >= 1 &&
    candidate.page.limit <= 100 &&
    Number.isSafeInteger(candidate.page.total) &&
    candidate.page.total >= 0 &&
    Number.isSafeInteger(candidate.page.totalPages) &&
    candidate.page.totalPages === (
      candidate.page.total === 0
        ? 0
        : Math.ceil(candidate.page.total / candidate.page.limit)
    )
  return (
    candidate.schemaVersion === HOBBY_PLAYER_RANKINGS_FEED_SCHEMA_VERSION &&
    candidate.contractVersion === HOBBY_PLAYER_RANKINGS_CONTRACT_VERSION &&
    candidate.modelVersion === HOBBY_PLAYER_RANKINGS_MODEL_VERSION &&
    Boolean(candidate.snapshot) &&
    (
      freshnessStatus === 'current' ||
      freshnessStatus === 'stale' ||
      freshnessStatus === 'unknown'
    ) &&
    (scopedSport === 'football' || scopedSport === 'basketball') &&
    Array.isArray(candidate.items) &&
    candidate.items.length <= (candidate.page?.limit ?? 0) &&
    candidate.items.length <= (candidate.page?.total ?? 0) &&
    candidate.items.every((item) => (
      item.recordVersion === 'hobby-player-ranking-item/v2' &&
      item.sport === scopedSport &&
      HOBBY_PLAYER_RANKING_POSTURES.includes(item.posture) &&
      Number.isFinite(item.score) &&
      Number.isSafeInteger(item.sportRank) &&
      Number.isSafeInteger(item.screenRank) &&
      item.confidence.investmentConfidence === 'withheld' &&
      item.confidence.score <= HOBBY_PLAYER_RANKING_MAX_INPUT_INTEGRITY
    )) &&
    cohortsValid &&
    pageValid &&
    hasConsistentPostureCounts(candidate.screenSummary) &&
    candidate.screenSummary.rankedCount === candidate.page.total &&
    Boolean(candidate.meta) &&
    candidate.meta.expectedReturnClaim === false &&
    (!publicationSuspended || (
      candidate.items.length === 0 &&
      candidate.page.total === 0 &&
      candidate.page.totalPages === 0 &&
      scopedCohort?.rankedCount === 0
    ))
  )
}
