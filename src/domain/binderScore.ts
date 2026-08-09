export const BINDER_SCORE_SCHEMA_VERSION = 'binder-score.v1' as const
export const BINDER_SCORES_FEED_SCHEMA_VERSION = 'binder-scores.v1' as const
export const BINDER_SCORE_CONTRACT_VERSION = 'binder-score-contract/v1' as const
export const BINDER_SCORE_MODEL_VERSION = 'binder-score-heuristic/v1.0.0' as const
export const BINDER_SCORE_COHORT_PRIOR = 50 as const
export const BINDER_SCORE_MAX_HYPE_PENALTY = 10 as const
export const BINDER_SCORE_MAX_CONFIDENCE = 75 as const

export const BINDER_SCORE_WEIGHTS = {
  overall: {
    baseballThesis: 0.75,
    collectorDemand: 0.25,
  },
  baseballThesis: {
    careerIndex: 0.6,
    routeOutcomePercentile: 0.25,
    ageRunway: 0.15,
  },
  collectorDemand: {
    trailingTwelveMonthDemandPercentile: 0.6,
    durabilityResilience: 0.25,
    recentMomentum: 0.15,
  },
} as const

export const BINDER_SCORE_SEMANTICS = {
  publicationStatus: 'research_only',
  scoreRange: '0_to_100_higher_is_stronger_collection_thesis',
  missingValuePolicy: 'shrink_to_cohort_prior_50_without_dynamic_reweighting',
  marketMeaning:
    'collector_demand_is_an_ebay_singles_sales_volume_proxy_not_price_appreciation',
  careerMeaning:
    'career_evidence_is_statistical_hall_caliber_trajectory_not_hof_election_odds',
  actionMeaning: 'collection_research_signal_not_financial_advice',
  confidenceMeaning:
    'confidence_is_evidence_completeness_capped_at_moderate_while_oracle_models_remain_research_only',
  comparability:
    'compare_scores_only_within_the_same_model_version_and_declared_market_cohort',
} as const

export type BinderRoute =
  | 'pre_debut'
  | 'post_debut_minors'
  | 'recent_callup'
  | 'early_mlb'
  | 'established_mlb'
  | 'inactive'

export type BinderFreshnessStatus = 'current' | 'unknown' | 'stale'

export type BinderMarketIdentityStatus =
  | 'verified_external_id'
  | 'manual_verified'
  | 'unique_normalized_name'
  | 'ambiguous'
  | 'unmatched'

export type BinderAction =
  | 'build'
  | 'core_hold'
  | 'watch'
  | 'trim_hype'
  | 'pass'
  | 'insufficient_evidence'

export interface BinderFreshness {
  status: BinderFreshnessStatus
  dataAsOf: string | null
  reasonCodes?: readonly string[]
}

export interface BinderMarketInput {
  sourcePlayerName: string
  identityStatus: BinderMarketIdentityStatus
  trailingTwelveMonthDemandPercentile: number | null
  /**
   * Twelve chronological monthly eBay singles sales-volume values, oldest first.
   * `null` means that the month is unavailable; it never means zero sales.
   */
  monthlySalesUsd: readonly (number | null)[]
  freshness: BinderFreshness
  cohortId: string
}

export interface BinderCandidateInput {
  player: {
    id: string
    name: string
    age: number | null
    route: BinderRoute
  }
  baseball: {
    careerIndex: number | null
    routeOutcomePercentile: number | null
    freshness: BinderFreshness
  }
  market: BinderMarketInput | null
}

export interface BinderMarketSignal {
  trailingTwelveMonthSalesUsd: number | null
  observedMonths: number
  positiveSalesMonths: number
  coverageRatio: number
  activeMonthRatio: number
  durabilityResilienceScore: number | null
  recentMomentumRate: number | null
  recentMomentumScore: number | null
  momentumWindows: {
    priorThreeMonthAverageUsd: number | null
    recentThreeMonthAverageUsd: number | null
  }
}

export interface BinderComponent {
  rawValue: number | null
  effectiveValue: number
  imputedToPrior: boolean
  weight: number
  weightedContribution: number
}

export interface BinderScoreResult {
  version: {
    schemaVersion: typeof BINDER_SCORE_SCHEMA_VERSION
    contractVersion: typeof BINDER_SCORE_CONTRACT_VERSION
    modelVersion: typeof BINDER_SCORE_MODEL_VERSION
  }
  semantics: typeof BINDER_SCORE_SEMANTICS
  player: BinderCandidateInput['player']
  score: number | null
  action: BinderAction
  actionReasonCodes: string[]
  components: {
    baseballThesis: {
      score: number | null
      components: {
        careerIndex: BinderComponent
        routeOutcomePercentile: BinderComponent
        ageRunway: BinderComponent
      }
    }
    collectorDemand: {
      score: number
      components: {
        trailingTwelveMonthDemandPercentile: BinderComponent
        durabilityResilience: BinderComponent
        recentMomentum: BinderComponent
      }
      marketSignal: BinderMarketSignal
      cohortId: string | null
    }
    hypePenalty: {
      value: number
      maximum: typeof BINDER_SCORE_MAX_HYPE_PENALTY
      demandMinusBaseball: number | null
      formula:
        'max_0_demand_minus_baseball_minus_15_times_0_20_plus_momentum_above_70_times_0_10_capped_at_10'
    }
  }
  weights: typeof BINDER_SCORE_WEIGHTS
  confidence: {
    score: number
    band: 'high' | 'moderate' | 'low' | 'withheld'
    reasonCodes: string[]
  }
  flags: {
    coreBaseballEvidenceComplete: boolean
    marketEvidenceComplete: boolean
    marketIdentityStatus: BinderMarketIdentityStatus
    marketIdentityConfirmed: boolean
    baseballFreshness: BinderFreshnessStatus
    marketFreshness: BinderFreshnessStatus
    overallWithheld: boolean
  }
}

export interface BinderScoreFeedItem {
  recordVersion: 'binder-score-item/v1'
  player: {
    id: string
    name: string
    mlbamId: string | null
    age: number | null
    stage: BinderRoute
    playerType: 'Hitter' | 'Pitcher' | 'Two-way'
    organization: string | null
    organizationCode: string | null
    position: string | null
    level: string | null
  }
  assessment: BinderScoreResult
}

export interface BinderScoresResponse {
  schemaVersion: typeof BINDER_SCORES_FEED_SCHEMA_VERSION
  contractVersion: typeof BINDER_SCORE_CONTRACT_VERSION
  snapshot: {
    id: string
    baseballDataAsOf: string | null
    baseballFreshness: {
      status: BinderFreshnessStatus
      reasonCodes: string[]
      cadence: 'completed_season'
    }
    marketDataThrough: string
    marketPublishedAt: string
    marketAcquiredAt: string
    marketFreshness: {
      status: BinderFreshnessStatus
      reasonCodes: string[]
      nextExpectedBy: string
      cadence: 'monthly'
    }
  }
  items: BinderScoreFeedItem[]
  page: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  meta: {
    researchOnly: true
    investmentAdvice: false
    marketSource: 'GemRate Athlete Sales Trends'
    marketMeasure: 'completed_ebay_singles_sales_volume_usd'
    marketMeaning: typeof BINDER_SCORE_SEMANTICS.marketMeaning
    careerMeaning: typeof BINDER_SCORE_SEMANTICS.careerMeaning
    identityPolicy:
      'exact_oracle_identity_plus_unique_normalized_gemrate_name_no_fuzzy_matching'
    nullPolicy: 'missing_evidence_shrinks_to_prior_and_withholds_action'
    rankingScope: 'cross_stage_research_heuristic'
    sourceRows: number
    ambiguousSourceKeys: number
    matchedUniversePlayers: number
    actionableUniversePlayers: number
    permissionAttestation: 'docs/permissions/GEMRATE_ATTESTATION.md'
  }
}

export function isBinderScoresResponse(value: unknown): value is BinderScoresResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BinderScoresResponse>
  return (
    candidate.schemaVersion === BINDER_SCORES_FEED_SCHEMA_VERSION &&
    candidate.contractVersion === BINDER_SCORE_CONTRACT_VERSION &&
    Array.isArray(candidate.items) &&
    Boolean(candidate.page) &&
    Boolean(candidate.snapshot) &&
    Boolean(candidate.meta)
  )
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function finiteScore(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? clamp(value, 0, 100) : null
}

function finiteSalesValue(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function lowerQuartile(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.floor((sorted.length - 1) * 0.25)
  return sorted[index]
}

function makeComponent(rawValue: number | null, weight: number): BinderComponent {
  const normalized = finiteScore(rawValue)
  const effectiveValue = normalized ?? BINDER_SCORE_COHORT_PRIOR
  return {
    rawValue: normalized,
    effectiveValue,
    imputedToPrior: normalized === null,
    weight,
    weightedContribution: round(effectiveValue * weight, 2),
  }
}

/**
 * Conservative normalization for comparison keys. It does not establish identity:
 * callers still have to resolve ambiguity and set an explicit identity status.
 */
export function normalizePlayerName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/&/gu, ' and ')
    .replace(/[’'`]/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Converts a one-based rank into a 0-100 percentile. First is 100, last is 0.
 * A one-member cohort is assigned the neutral prior because no relative rank exists.
 */
export function percentileFromRank(rank: number, cohortSize: number): number | null {
  if (
    !Number.isInteger(rank) ||
    !Number.isInteger(cohortSize) ||
    cohortSize < 1 ||
    rank < 1 ||
    rank > cohortSize
  ) {
    return null
  }
  if (cohortSize === 1) return BINDER_SCORE_COHORT_PRIOR
  return round(((cohortSize - rank) / (cohortSize - 1)) * 100, 2)
}

/**
 * Converts a 0-100 percentile back to the nearest one-based cohort rank.
 */
export function rankFromPercentile(percentile: number, cohortSize: number): number | null {
  if (
    !Number.isFinite(percentile) ||
    percentile < 0 ||
    percentile > 100 ||
    !Number.isInteger(cohortSize) ||
    cohortSize < 1
  ) {
    return null
  }
  if (cohortSize === 1) return 1
  return 1 + Math.round(((100 - percentile) / 100) * (cohortSize - 1))
}

/**
 * Age is intentionally a modest input. The score represents future career runway,
 * not a claim that younger players are inherently better collectibles.
 */
export function ageRunwayScore(age: number | null, route: BinderRoute): number | null {
  if (age === null || !Number.isFinite(age) || age < 15 || age > 60) return null
  if (route === 'inactive') return BINDER_SCORE_COHORT_PRIOR

  const routeCurve: Record<
    Exclude<BinderRoute, 'inactive'>,
    { peakThroughAge: number; pointsPerYear: number }
  > = {
    pre_debut: { peakThroughAge: 19, pointsPerYear: 10 },
    post_debut_minors: { peakThroughAge: 21, pointsPerYear: 8 },
    recent_callup: { peakThroughAge: 22, pointsPerYear: 7 },
    early_mlb: { peakThroughAge: 23, pointsPerYear: 5 },
    established_mlb: { peakThroughAge: 24, pointsPerYear: 3.5 },
  }
  const curve = routeCurve[route]
  return round(clamp(100 - Math.max(0, age - curve.peakThroughAge) * curve.pointsPerYear, 0, 100))
}

/**
 * Creates durability and recent-momentum signals from twelve chronological months.
 * Missing months remain missing and reduce coverage; they are never converted to zero.
 */
export function calculateBinderMarketSignal(
  monthlySalesUsd: readonly (number | null)[],
): BinderMarketSignal {
  const trailingTwelve = monthlySalesUsd.slice(-12).map(finiteSalesValue)
  const observed = trailingTwelve.filter((value): value is number => value !== null)
  const observedMonths = observed.length
  const positiveSalesMonths = observed.filter((value) => value > 0).length
  const coverageRatio = observedMonths / 12
  const activeMonthRatio = positiveSalesMonths / 12

  let durabilityResilienceScore: number | null = null
  if (observedMonths > 0) {
    const observedMedian = median(observed)
    const floorToMedian =
      observedMedian > 0 ? clamp(lowerQuartile(observed) / observedMedian, 0, 1) : 0
    durabilityResilienceScore = round(
      100 * (0.5 * activeMonthRatio + 0.3 * coverageRatio + 0.2 * floorToMedian),
    )
  }

  const lastSix = trailingTwelve.slice(-6)
  const priorWindow = lastSix.slice(0, 3)
  const recentWindow = lastSix.slice(3, 6)
  const completeMomentumWindows =
    lastSix.length === 6 &&
    priorWindow.every((value) => value !== null) &&
    recentWindow.every((value) => value !== null)

  let priorThreeMonthAverageUsd: number | null = null
  let recentThreeMonthAverageUsd: number | null = null
  let recentMomentumRate: number | null = null
  let recentMomentumScore: number | null = null

  if (completeMomentumWindows) {
    priorThreeMonthAverageUsd = average(priorWindow as number[])
    recentThreeMonthAverageUsd = average(recentWindow as number[])
    if (priorThreeMonthAverageUsd > 0) {
      recentMomentumRate =
        (recentThreeMonthAverageUsd - priorThreeMonthAverageUsd) /
        priorThreeMonthAverageUsd
    } else {
      recentMomentumRate = recentThreeMonthAverageUsd > 0 ? 1 : 0
    }
    recentMomentumScore = round(
      clamp(50 + clamp(recentMomentumRate, -0.5, 0.5) * 100, 25, 75),
    )
  }

  return {
    trailingTwelveMonthSalesUsd:
      observedMonths > 0 ? round(observed.reduce((sum, value) => sum + value, 0), 2) : null,
    observedMonths,
    positiveSalesMonths,
    coverageRatio: round(coverageRatio, 3),
    activeMonthRatio: round(activeMonthRatio, 3),
    durabilityResilienceScore,
    recentMomentumRate: recentMomentumRate === null ? null : round(recentMomentumRate, 4),
    recentMomentumScore,
    momentumWindows: {
      priorThreeMonthAverageUsd:
        priorThreeMonthAverageUsd === null ? null : round(priorThreeMonthAverageUsd, 2),
      recentThreeMonthAverageUsd:
        recentThreeMonthAverageUsd === null ? null : round(recentThreeMonthAverageUsd, 2),
    },
  }
}

function identityConfirmed(status: BinderMarketIdentityStatus): boolean {
  return (
    status === 'verified_external_id' ||
    status === 'manual_verified'
  )
}

function identityConfidenceFactor(status: BinderMarketIdentityStatus): number {
  if (status === 'verified_external_id' || status === 'manual_verified') return 1
  if (status === 'unique_normalized_name') return 0.6
  return 0
}

function freshnessConfidenceFactor(status: BinderFreshnessStatus): number {
  if (status === 'current') return 1
  if (status === 'unknown') return 0.8
  return 0.5
}

function confidenceBand(
  score: number,
  overallWithheld: boolean,
): BinderScoreResult['confidence']['band'] {
  if (overallWithheld) return 'withheld'
  if (score >= 60) return 'moderate'
  return 'low'
}

function hypePenalty(
  baseballThesis: number,
  collectorDemand: number,
  recentMomentum: number,
): number {
  const demandMinusBaseball = collectorDemand - baseballThesis
  const gapPenalty = Math.max(0, demandMinusBaseball - 15) * 0.2
  const momentumPenalty = Math.max(0, recentMomentum - 70) * 0.1
  return round(clamp(gapPenalty + momentumPenalty, 0, BINDER_SCORE_MAX_HYPE_PENALTY))
}

function chooseAction(input: {
  score: number | null
  baseballThesis: number | null
  collectorDemand: number
  hypePenalty: number
  evidenceActionable: boolean
}): { action: BinderAction; reasonCodes: string[] } {
  if (
    !input.evidenceActionable ||
    input.score === null ||
    input.baseballThesis === null
  ) {
    return {
      action: 'insufficient_evidence',
      reasonCodes: ['action_withheld_until_core_baseball_and_market_evidence_are_complete'],
    }
  }

  if (
    input.hypePenalty >= 4 &&
    input.collectorDemand - input.baseballThesis >= 20 &&
    input.collectorDemand >= 70
  ) {
    return {
      action: 'trim_hype',
      reasonCodes: ['collector_demand_materially_outpaces_baseball_thesis'],
    }
  }
  if (input.score >= 78 && input.baseballThesis >= 75) {
    return {
      action: 'build',
      reasonCodes: ['strong_baseball_thesis_with_supported_collector_demand'],
    }
  }
  if (input.score >= 65) {
    return {
      action: 'core_hold',
      reasonCodes: ['durable_collection_thesis_without_build_threshold'],
    }
  }
  if (input.score >= 50) {
    return {
      action: 'watch',
      reasonCodes: ['mixed_or_developing_collection_thesis'],
    }
  }
  return {
    action: 'pass',
    reasonCodes: ['collection_thesis_below_watch_threshold'],
  }
}

export function buildBinderScore(candidate: BinderCandidateInput): BinderScoreResult {
  const careerIndex = makeComponent(
    candidate.baseball.careerIndex,
    BINDER_SCORE_WEIGHTS.baseballThesis.careerIndex,
  )
  const routeOutcomePercentile = makeComponent(
    candidate.baseball.routeOutcomePercentile,
    BINDER_SCORE_WEIGHTS.baseballThesis.routeOutcomePercentile,
  )
  const ageRunway = makeComponent(
    ageRunwayScore(candidate.player.age, candidate.player.route),
    BINDER_SCORE_WEIGHTS.baseballThesis.ageRunway,
  )
  const coreBaseballEvidenceComplete =
    !careerIndex.imputedToPrior && !routeOutcomePercentile.imputedToPrior
  const baseballThesisValue = round(
    careerIndex.weightedContribution +
      routeOutcomePercentile.weightedContribution +
      ageRunway.weightedContribution,
  )
  const baseballThesis = coreBaseballEvidenceComplete ? baseballThesisValue : null

  const marketSignal = calculateBinderMarketSignal(candidate.market?.monthlySalesUsd ?? [])
  const demandPercentile = makeComponent(
    candidate.market?.trailingTwelveMonthDemandPercentile ?? null,
    BINDER_SCORE_WEIGHTS.collectorDemand.trailingTwelveMonthDemandPercentile,
  )
  const durabilityResilience = makeComponent(
    marketSignal.durabilityResilienceScore,
    BINDER_SCORE_WEIGHTS.collectorDemand.durabilityResilience,
  )
  const recentMomentum = makeComponent(
    marketSignal.recentMomentumScore,
    BINDER_SCORE_WEIGHTS.collectorDemand.recentMomentum,
  )
  const collectorDemand = round(
    demandPercentile.weightedContribution +
      durabilityResilience.weightedContribution +
      recentMomentum.weightedContribution,
  )

  const marketIdentityStatus = candidate.market?.identityStatus ?? 'unmatched'
  const marketIdentityConfirmed = identityConfirmed(marketIdentityStatus)
  const marketFreshness = candidate.market?.freshness.status ?? 'unknown'
  const marketEvidenceComplete =
    candidate.market !== null &&
    marketIdentityConfirmed &&
    !demandPercentile.imputedToPrior &&
    !durabilityResilience.imputedToPrior &&
    !recentMomentum.imputedToPrior &&
    marketSignal.observedMonths === 12

  const penalty =
    baseballThesis === null
      ? 0
      : hypePenalty(baseballThesis, collectorDemand, recentMomentum.effectiveValue)
  const score =
    baseballThesis === null
      ? null
      : round(
          BINDER_SCORE_WEIGHTS.overall.baseballThesis * baseballThesis +
            BINDER_SCORE_WEIGHTS.overall.collectorDemand * collectorDemand -
            penalty,
        )

  const evidenceActionable =
    coreBaseballEvidenceComplete &&
    marketEvidenceComplete &&
    candidate.baseball.freshness.status === 'current' &&
    marketFreshness === 'current'
  const actionResult = chooseAction({
    score,
    baseballThesis,
    collectorDemand,
    hypePenalty: penalty,
    evidenceActionable,
  })

  const globalEvidenceWeights = {
    careerIndex:
      BINDER_SCORE_WEIGHTS.overall.baseballThesis *
      BINDER_SCORE_WEIGHTS.baseballThesis.careerIndex,
    routeOutcome:
      BINDER_SCORE_WEIGHTS.overall.baseballThesis *
      BINDER_SCORE_WEIGHTS.baseballThesis.routeOutcomePercentile,
    ageRunway:
      BINDER_SCORE_WEIGHTS.overall.baseballThesis *
      BINDER_SCORE_WEIGHTS.baseballThesis.ageRunway,
    demand:
      BINDER_SCORE_WEIGHTS.overall.collectorDemand *
      BINDER_SCORE_WEIGHTS.collectorDemand.trailingTwelveMonthDemandPercentile,
    durability:
      BINDER_SCORE_WEIGHTS.overall.collectorDemand *
      BINDER_SCORE_WEIGHTS.collectorDemand.durabilityResilience,
    momentum:
      BINDER_SCORE_WEIGHTS.overall.collectorDemand *
      BINDER_SCORE_WEIGHTS.collectorDemand.recentMomentum,
  }
  const evidenceCoverage =
    (careerIndex.imputedToPrior ? 0 : globalEvidenceWeights.careerIndex) +
    (routeOutcomePercentile.imputedToPrior ? 0 : globalEvidenceWeights.routeOutcome) +
    (ageRunway.imputedToPrior ? 0 : globalEvidenceWeights.ageRunway) +
    (demandPercentile.imputedToPrior ? 0 : globalEvidenceWeights.demand) +
    (durabilityResilience.imputedToPrior ? 0 : globalEvidenceWeights.durability) +
    (recentMomentum.imputedToPrior ? 0 : globalEvidenceWeights.momentum)
  const confidenceScore = round(
    Math.min(
      BINDER_SCORE_MAX_CONFIDENCE,
      100 *
        evidenceCoverage *
        identityConfidenceFactor(marketIdentityStatus) *
        freshnessConfidenceFactor(candidate.baseball.freshness.status) *
        freshnessConfidenceFactor(marketFreshness),
    ),
  )
  const confidenceReasonCodes: string[] = []
  if (!coreBaseballEvidenceComplete) {
    confidenceReasonCodes.push('core_baseball_evidence_missing_overall_score_withheld')
  }
  if (!marketEvidenceComplete) {
    confidenceReasonCodes.push('market_evidence_incomplete_action_withheld')
  }
  if (marketIdentityStatus === 'unique_normalized_name') {
    confidenceReasonCodes.push('market_identity_uses_unique_normalized_name_match')
  }
  if (candidate.baseball.freshness.status !== 'current') {
    confidenceReasonCodes.push(`baseball_freshness_${candidate.baseball.freshness.status}`)
  }
  if (marketFreshness !== 'current') {
    confidenceReasonCodes.push(`market_freshness_${marketFreshness}`)
  }

  return {
    version: {
      schemaVersion: BINDER_SCORE_SCHEMA_VERSION,
      contractVersion: BINDER_SCORE_CONTRACT_VERSION,
      modelVersion: BINDER_SCORE_MODEL_VERSION,
    },
    semantics: BINDER_SCORE_SEMANTICS,
    player: candidate.player,
    score,
    action: actionResult.action,
    actionReasonCodes: actionResult.reasonCodes,
    components: {
      baseballThesis: {
        score: baseballThesis,
        components: {
          careerIndex,
          routeOutcomePercentile,
          ageRunway,
        },
      },
      collectorDemand: {
        score: collectorDemand,
        components: {
          trailingTwelveMonthDemandPercentile: demandPercentile,
          durabilityResilience,
          recentMomentum,
        },
        marketSignal,
        cohortId: candidate.market?.cohortId ?? null,
      },
      hypePenalty: {
        value: penalty,
        maximum: BINDER_SCORE_MAX_HYPE_PENALTY,
        demandMinusBaseball:
          baseballThesis === null ? null : round(collectorDemand - baseballThesis),
        formula:
          'max_0_demand_minus_baseball_minus_15_times_0_20_plus_momentum_above_70_times_0_10_capped_at_10',
      },
    },
    weights: BINDER_SCORE_WEIGHTS,
    confidence: {
      score: confidenceScore,
      band: confidenceBand(confidenceScore, score === null),
      reasonCodes: confidenceReasonCodes,
    },
    flags: {
      coreBaseballEvidenceComplete,
      marketEvidenceComplete,
      marketIdentityStatus,
      marketIdentityConfirmed,
      baseballFreshness: candidate.baseball.freshness.status,
      marketFreshness,
      overallWithheld: score === null,
    },
  }
}
