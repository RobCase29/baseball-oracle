import type {
  MagnificentXDomain,
  MagnificentXFreshnessStatus,
  MagnificentXIdentityStatus,
  MagnificentXResearchPosture,
  MagnificentXSourceRow,
  MagnificentXSubjectType,
  MagnificentXTaxonomyStatus,
} from './magnificentX.js'
import {
  buildHobbySalesTrend,
  type HobbySalesTrend,
} from './hobbySalesTrend.js'
import {
  buildHobbyBreakoutSignal,
  type HobbyBreakoutDomainBaseline,
  type HobbyBreakoutSignal,
} from './hobbyBreakoutSignal.js'

export const HOBBY_MASTER_SCHEMA_VERSION =
  'hobby-oracle-master-ranking.v2' as const
export const HOBBY_MASTER_CONTRACT_VERSION =
  'hobby-oracle-master-ranking-contract/v2' as const
export const HOBBY_MASTER_MODEL_VERSION =
  'hobby-oracle-absolute-demand-durability/18m-v2.0.0' as const
export const HOBBY_MASTER_RECORD_VERSION =
  'hobby-oracle-master-ranking-item/v2' as const

export const HOBBY_MASTER_TTM_ANCHOR_FLOOR_USD = 100_000 as const
export const HOBBY_MASTER_TTM_ANCHOR_CEILING_USD = 250_000_000 as const
export const HOBBY_MASTER_ESTABLISHED_TTM_FLOOR_USD = 20_000_000 as const
export const HOBBY_MASTER_ESTABLISHED_RUN_RATE_FLOOR_USD = 15_000_000 as const
export const HOBBY_MASTER_ESCAPE_TTM_FLOOR_USD = 15_000_000 as const
export const HOBBY_MASTER_ESCAPE_RUN_RATE_FLOOR_USD = 20_000_000 as const
export const HOBBY_MASTER_BUILD_SCORE_FLOOR = 75 as const
export const HOBBY_MASTER_ESCAPE_SCORE_FLOOR = 70 as const

export const HOBBY_MASTER_SORT_KEYS = [
  'master_rank',
  'master_score',
  'ttm_sales',
  'current_run_rate',
  'breakout',
  'exit_window',
  'trend',
  'durability',
  'persistence',
  'shock_resistance',
  'cohort_rank',
  'cohort_percentile',
  'name',
] as const

export type HobbyMasterSortKey = (typeof HOBBY_MASTER_SORT_KEYS)[number]
export type HobbyMasterSortDirection = 'asc' | 'desc'
export type HobbyMasterScreen = 'standard' | 'breakout'
export type HobbyMasterBuildRoute =
  | 'established_durability'
  | 'escape_velocity'
  | null

export interface HobbyMasterSignalInput {
  row: MagnificentXSourceRow
  cohortSize: number
  withinCohortPercentile: number
  globalObservedPercentile: number
  identityStatus: MagnificentXIdentityStatus
  freshnessStatus: MagnificentXFreshnessStatus
  domainMedianSixMonthLogGrowth?: number | null
  breakoutDomainBaseline?: HobbyBreakoutDomainBaseline | null
}

export interface HobbyMasterSignal {
  score: number
  demandMagnitudeScore: number
  durabilityScore: number
  downsideProtectionScore: number
  latestTwelveMonthSalesUsd: number
  currentSixMonthSalesUsd: number
  annualizedCurrentSixMonthSalesUsd: number
  priorYearSixMonthSalesUsd: number
  globalObservedPercentile: number
  withinCohortPercentile: number
  components: {
    trailingTwelveMonthMagnitude: number
    currentRunRateMagnitude: number
    persistence: number
    shockResistance: number
    downsideProtection: number
  }
  diagnostics: {
    observedMonths: 18
    positiveMonthRatio: number
    lowerQuartileToMedianRatio: number
    latestTwelveMonthHhi: number
    effectiveSalesMonths: number
    yearOverYearSixMonthLogGrowth: number
    recentThreeMonthYearOverYearLogGrowth: number
  }
  sensitivity: {
    demandHeavy: number
    balanced: number
    durabilityHeavy: number
    worstScenarioScore: number
    momentumAddsScore: false
  }
}

export interface HobbyMasterBuildChecks {
  comparisonEligible: boolean
  sourceCurrent: boolean
  completeEighteenMonthHistory: boolean
  globalTopOnePercent: boolean
  persistenceAtLeast90: boolean
  shockResistanceAtLeast90: boolean
  downsideProtectionAtLeast90: boolean
  establishedRoute: boolean
  escapeVelocityRoute: boolean
  eitherBuildRoute: boolean
}

export interface HobbyMasterAssessment {
  schemaVersion: typeof HOBBY_MASTER_SCHEMA_VERSION
  contractVersion: typeof HOBBY_MASTER_CONTRACT_VERSION
  modelVersion: typeof HOBBY_MASTER_MODEL_VERSION
  posture: MagnificentXResearchPosture
  marketSignal: HobbyMasterSignal
  salesTrend: HobbySalesTrend
  breakoutSignal?: HobbyBreakoutSignal
  buildQualification: {
    eligible: boolean
    designation: 'Build' | 'withheld'
    route: HobbyMasterBuildRoute
    passed: number
    required: number
    checks: HobbyMasterBuildChecks
    reasonCodes: string[]
  }
  flags: {
    identityStatus: MagnificentXIdentityStatus
    taxonomyStatus: MagnificentXTaxonomyStatus
    freshnessStatus: MagnificentXFreshnessStatus
    cohortSize: number
    observedHistoryMonths: 18
    subjectLevelOnly: true
    exactCardActionable: false
  }
}

export type HobbySubjectContextEvidence =
  | 'verified_player_bridge'
  | 'reviewed_player_bridge'
  | 'unique_player_bridge'
  | 'canonical_species_match'
  | 'merged_species_label'
  | 'unavailable'

export type HobbySubjectContextSource =
  | 'backstop_player_rankings'
  | 'career_oracle'
  | 'keeptradecut'
  | 'hashtag_basketball'
  | 'pokeapi'
  | null

export interface HobbySubjectContext {
  age: number | null
  ageAsOf: string | null
  introducedYear: number | null
  approximateYearsSinceIntroduction: number | null
  introducedGeneration: number | null
  nationalDexNumber: number | null
  sourceId: HobbySubjectContextSource
  evidence: HobbySubjectContextEvidence
}

export interface HobbyMasterFeedItem {
  recordVersion: typeof HOBBY_MASTER_RECORD_VERSION
  subject: {
    id: string
    type: MagnificentXSubjectType
    domain: MagnificentXDomain
    sourceCategory: string
    name: string
    identityStatus: MagnificentXIdentityStatus
    firstGradedYear: number | null
    mostGradedYear: number | null
    context: HobbySubjectContext
  }
  masterRank: number | null
  withinCohortRank: number
  assessment: HobbyMasterAssessment
}

export interface HobbyMasterFeedResponse {
  schemaVersion: typeof HOBBY_MASTER_SCHEMA_VERSION
  contractVersion: typeof HOBBY_MASTER_CONTRACT_VERSION
  snapshot: {
    id: string
    historyStart: string
    historyMonths: 18
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
  items: HobbyMasterFeedItem[]
  cohorts: Array<{
    domain: MagnificentXDomain
    taxonomyStatus: MagnificentXTaxonomyStatus
    subjectCount: number
    rankedCount: number
    buildCount: number
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
    rankingPolicy:
      'single_observed_universe_absolute_demand_and_durability_order'
    rankingUniverse: 'coherent_unambiguous_gemrate_subject_rows'
    rankingUniverseCount: number
    buildCount: number
    marketSource: 'GemRate Athlete + Pokémon Sales Trends'
    marketMeasure: 'completed_ebay_singles_sales_volume_usd'
    exactCardRecommendationsAvailable: false
    globalComparisonStatus:
      'observed_snapshot_comparable_not_canonical_hobby_census'
    globalComparisonLimitations: string[]
    buildPolicy: {
      fixedDollarAnchors: true
      establishedTtmFloorUsd: typeof HOBBY_MASTER_ESTABLISHED_TTM_FLOOR_USD
      establishedRunRateFloorUsd:
        typeof HOBBY_MASTER_ESTABLISHED_RUN_RATE_FLOOR_USD
      escapeTtmFloorUsd: typeof HOBBY_MASTER_ESCAPE_TTM_FLOOR_USD
      escapeRunRateFloorUsd:
        typeof HOBBY_MASTER_ESCAPE_RUN_RATE_FLOOR_USD
      positiveMomentumAddsScore: false
    }
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
  const sorted = [...values].sort((left, right) => left - right)
  if (sorted.length === 0) return 0
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]!
  const weight = index - lower
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight
}

function weightedGeometricMean(
  values: readonly number[],
  weights: readonly number[],
): number {
  if (values.length !== weights.length || values.length === 0) {
    throw new Error('Weighted geometric mean requires aligned inputs')
  }
  if (values.some((value) => value <= 0)) return 0
  return Math.exp(values.reduce(
    (total, value, index) => total + weights[index]! * Math.log(value),
    0,
  ))
}

export function hobbyMasterMagnitudeScore(value: number): number {
  if (!Number.isFinite(value) || value <= HOBBY_MASTER_TTM_ANCHOR_FLOOR_USD) {
    return 0
  }
  const denominator = Math.log(
    HOBBY_MASTER_TTM_ANCHOR_CEILING_USD /
      HOBBY_MASTER_TTM_ANCHOR_FLOOR_USD,
  )
  return round(100 * clamp(
    Math.log(value / HOBBY_MASTER_TTM_ANCHOR_FLOOR_USD) / denominator,
    0,
    1,
  ))
}

export function computeHobbyMasterSignal(
  input: HobbyMasterSignalInput,
): HobbyMasterSignal {
  const months = input.row.monthlySalesUsd
  if (
    months.length !== 18 ||
    months.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error(
      'Hobby master ranking requires 18 complete non-negative months',
    )
  }
  const latestTwelve = months.slice(-12)
  const currentSix = months.slice(-6)
  const priorYearSix = months.slice(0, 6)
  const currentRecentThree = months.slice(-3)
  const priorYearRecentThree = months.slice(3, 6)
  const latestTwelveMonthSalesUsd = sum(latestTwelve)
  const currentSixMonthSalesUsd = sum(currentSix)
  const annualizedCurrentSixMonthSalesUsd = currentSixMonthSalesUsd * 2
  const priorYearSixMonthSalesUsd = sum(priorYearSix)
  const positiveMonthRatio =
    months.filter((value) => value > 0).length / months.length
  const median = quantile(months, 0.5)
  const lowerQuartile = quantile(months, 0.25)
  const lowerQuartileToMedianRatio =
    median <= 0
      ? (lowerQuartile <= 0 ? 0 : 1)
      : clamp(lowerQuartile / median, 0, 1)
  const persistence = round(
    0.5 * positiveMonthRatio * 100 +
    0.3 * 100 +
    0.2 * lowerQuartileToMedianRatio * 100,
  )
  const latestTwelveMonthHhi = latestTwelveMonthSalesUsd <= 0
    ? 1
    : latestTwelve.reduce((total, value) => {
      const share = value / latestTwelveMonthSalesUsd
      return total + share * share
    }, 0)
  const shockResistance = round(
    100 * (
      1 - clamp(
        (latestTwelveMonthHhi - 1 / 12) / (1 - 1 / 12),
        0,
        1,
      )
    ),
  )
  const yearOverYearSixMonthLogGrowth = Math.log(
    (currentSixMonthSalesUsd + 1) / (priorYearSixMonthSalesUsd + 1),
  )
  const recentThreeMonthYearOverYearLogGrowth = Math.log(
    (sum(currentRecentThree) + 1) / (sum(priorYearRecentThree) + 1),
  )
  // Growth never adds score. Flat or positive demand receives the same 100;
  // only a year-over-year decline can reduce the master score.
  const downsideProtectionScore = round(clamp(
    100 + 50 * yearOverYearSixMonthLogGrowth / Math.log(2),
    50,
    100,
  ))
  const trailingTwelveMonthMagnitude = hobbyMasterMagnitudeScore(
    latestTwelveMonthSalesUsd,
  )
  const currentRunRateMagnitude = hobbyMasterMagnitudeScore(
    annualizedCurrentSixMonthSalesUsd,
  )
  const demandMagnitudeScore = round(weightedGeometricMean(
    [trailingTwelveMonthMagnitude, currentRunRateMagnitude],
    [0.75, 0.25],
  ))
  const durabilityScore = round(weightedGeometricMean(
    [persistence, shockResistance, downsideProtectionScore],
    [0.45, 0.35, 0.2],
  ))
  const balanced = round(weightedGeometricMean(
    [demandMagnitudeScore, durabilityScore],
    [0.72, 0.28],
  ))
  const demandHeavy = round(weightedGeometricMean(
    [demandMagnitudeScore, durabilityScore],
    [0.82, 0.18],
  ))
  const durabilityHeavy = round(weightedGeometricMean(
    [demandMagnitudeScore, durabilityScore],
    [0.6, 0.4],
  ))

  return {
    score: balanced,
    demandMagnitudeScore,
    durabilityScore,
    downsideProtectionScore,
    latestTwelveMonthSalesUsd,
    currentSixMonthSalesUsd,
    annualizedCurrentSixMonthSalesUsd,
    priorYearSixMonthSalesUsd,
    globalObservedPercentile: round(input.globalObservedPercentile),
    withinCohortPercentile: round(input.withinCohortPercentile),
    components: {
      trailingTwelveMonthMagnitude,
      currentRunRateMagnitude,
      persistence,
      shockResistance,
      downsideProtection: downsideProtectionScore,
    },
    diagnostics: {
      observedMonths: 18,
      positiveMonthRatio: round(positiveMonthRatio, 4),
      lowerQuartileToMedianRatio: round(lowerQuartileToMedianRatio, 4),
      latestTwelveMonthHhi: round(latestTwelveMonthHhi, 6),
      effectiveSalesMonths: round(
        latestTwelveMonthHhi <= 0 ? 0 : 1 / latestTwelveMonthHhi,
      ),
      yearOverYearSixMonthLogGrowth: round(
        yearOverYearSixMonthLogGrowth,
        4,
      ),
      recentThreeMonthYearOverYearLogGrowth: round(
        recentThreeMonthYearOverYearLogGrowth,
        4,
      ),
    },
    sensitivity: {
      demandHeavy,
      balanced,
      durabilityHeavy,
      worstScenarioScore: Math.min(
        demandHeavy,
        balanced,
        durabilityHeavy,
      ),
      momentumAddsScore: false,
    },
  }
}

function reasonCodesForChecks(checks: HobbyMasterBuildChecks): string[] {
  const labels: Array<[keyof HobbyMasterBuildChecks, string]> = [
    ['comparisonEligible', 'observed_universe_comparison_not_eligible'],
    ['sourceCurrent', 'market_snapshot_not_current'],
    ['completeEighteenMonthHistory', 'complete_18_month_history_missing'],
    ['globalTopOnePercent', 'below_observed_global_top_one_percent'],
    ['persistenceAtLeast90', 'persistence_below_90'],
    ['shockResistanceAtLeast90', 'shock_resistance_below_90'],
    ['downsideProtectionAtLeast90', 'material_six_month_demand_decline'],
    ['eitherBuildRoute', 'neither_absolute_build_route_cleared'],
  ]
  return labels.flatMap(([key, label]) => checks[key] ? [] : [label])
}

export function buildHobbyMasterAssessment(
  input: HobbyMasterSignalInput,
): HobbyMasterAssessment {
  const marketSignal = computeHobbyMasterSignal(input)
  const salesTrend = buildHobbySalesTrend({
    monthlySalesUsd: input.row.monthlySalesUsd,
    currentSixMonthSalesUsd: marketSignal.currentSixMonthSalesUsd,
    priorYearSixMonthSalesUsd: marketSignal.priorYearSixMonthSalesUsd,
    effectiveSalesMonths: marketSignal.diagnostics.effectiveSalesMonths,
    sixMonthLogGrowth:
      marketSignal.diagnostics.yearOverYearSixMonthLogGrowth,
    recentThreeMonthLogGrowth:
      marketSignal.diagnostics.recentThreeMonthYearOverYearLogGrowth,
    domainMedianSixMonthLogGrowth:
      input.domainMedianSixMonthLogGrowth ?? null,
    freshnessStatus: input.freshnessStatus,
  })
  const comparisonEligible =
    input.row.taxonomyStatus === 'coherent_provider_cohort' &&
    input.cohortSize >= 100 &&
    input.identityStatus !== 'ambiguous_normalized_name'
  const sourceCurrent = input.freshnessStatus === 'current'
  const completeEighteenMonthHistory =
    marketSignal.diagnostics.observedMonths === 18
  const globalTopOnePercent =
    marketSignal.globalObservedPercentile >= 99
  const persistenceAtLeast90 =
    marketSignal.components.persistence >= 90
  const shockResistanceAtLeast90 =
    marketSignal.components.shockResistance >= 90
  const downsideProtectionAtLeast90 =
    marketSignal.downsideProtectionScore >= 90
  const establishedRoute =
    marketSignal.latestTwelveMonthSalesUsd >=
      HOBBY_MASTER_ESTABLISHED_TTM_FLOOR_USD &&
    marketSignal.annualizedCurrentSixMonthSalesUsd >=
      HOBBY_MASTER_ESTABLISHED_RUN_RATE_FLOOR_USD &&
    marketSignal.score >= HOBBY_MASTER_BUILD_SCORE_FLOOR
  const escapeVelocityRoute =
    marketSignal.latestTwelveMonthSalesUsd >=
      HOBBY_MASTER_ESCAPE_TTM_FLOOR_USD &&
    marketSignal.annualizedCurrentSixMonthSalesUsd >=
      HOBBY_MASTER_ESCAPE_RUN_RATE_FLOOR_USD &&
    marketSignal.score >= HOBBY_MASTER_ESCAPE_SCORE_FLOOR &&
    marketSignal.diagnostics.yearOverYearSixMonthLogGrowth >= Math.log(2.5) &&
    marketSignal.diagnostics.recentThreeMonthYearOverYearLogGrowth >=
      Math.log(2)
  const eitherBuildRoute = establishedRoute || escapeVelocityRoute
  const checks: HobbyMasterBuildChecks = {
    comparisonEligible,
    sourceCurrent,
    completeEighteenMonthHistory,
    globalTopOnePercent,
    persistenceAtLeast90,
    shockResistanceAtLeast90,
    downsideProtectionAtLeast90,
    establishedRoute,
    escapeVelocityRoute,
    eitherBuildRoute,
  }
  const commonChecks = [
    comparisonEligible,
    sourceCurrent,
    completeEighteenMonthHistory,
    globalTopOnePercent,
    persistenceAtLeast90,
    shockResistanceAtLeast90,
    downsideProtectionAtLeast90,
    eitherBuildRoute,
  ]
  const buildEligible = commonChecks.every(Boolean)
  const route: HobbyMasterBuildRoute = buildEligible
    ? establishedRoute
      ? 'established_durability'
      : 'escape_velocity'
    : null

  let posture: MagnificentXResearchPosture
  if (!sourceCurrent) {
    posture = 'needs_refresh'
  } else if (!comparisonEligible) {
    posture = 'unrated'
  } else if (buildEligible) {
    posture = 'build_candidate'
  } else if (
    marketSignal.latestTwelveMonthSalesUsd >= 8_000_000 &&
    marketSignal.score >= 60 &&
    marketSignal.durabilityScore >= 85
  ) {
    posture = 'hold_candidate'
  } else if (
    marketSignal.latestTwelveMonthSalesUsd >= 1_000_000 &&
    marketSignal.score >= 45
  ) {
    posture = downsideProtectionAtLeast90 ? 'watch' : 'risk_review'
  } else {
    posture = 'pass'
  }
  const breakoutSignal = buildHobbyBreakoutSignal({
    monthlySalesUsd: input.row.monthlySalesUsd,
    latestTwelveMonthSalesUsd:
      marketSignal.latestTwelveMonthSalesUsd,
    annualizedCurrentSixMonthSalesUsd:
      marketSignal.annualizedCurrentSixMonthSalesUsd,
    persistence: marketSignal.components.persistence,
    shockResistance: marketSignal.components.shockResistance,
    comparisonEligible,
    sourceCurrent,
    completeEighteenMonthHistory,
    buildEligible,
    baselineSixMonthMultiple:
      input.breakoutDomainBaseline?.sixMonthMultiple ?? 0,
    baselineRecentThreeMonthMultiple:
      input.breakoutDomainBaseline?.recentThreeMonthMultiple ?? 0,
  })

  return {
    schemaVersion: HOBBY_MASTER_SCHEMA_VERSION,
    contractVersion: HOBBY_MASTER_CONTRACT_VERSION,
    modelVersion: HOBBY_MASTER_MODEL_VERSION,
    posture,
    marketSignal,
    salesTrend,
    breakoutSignal,
    buildQualification: {
      eligible: buildEligible,
      designation: buildEligible ? 'Build' : 'withheld',
      route,
      passed: commonChecks.filter(Boolean).length,
      required: commonChecks.length,
      checks,
      reasonCodes: buildEligible ? [] : reasonCodesForChecks(checks),
    },
    flags: {
      identityStatus: input.identityStatus,
      taxonomyStatus: input.row.taxonomyStatus,
      freshnessStatus: input.freshnessStatus,
      cohortSize: input.cohortSize,
      observedHistoryMonths: 18,
      subjectLevelOnly: true,
      exactCardActionable: false,
    },
  }
}

export function isHobbyMasterFeedResponse(
  value: unknown,
): value is HobbyMasterFeedResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<HobbyMasterFeedResponse>
  return (
    candidate.schemaVersion === HOBBY_MASTER_SCHEMA_VERSION &&
    candidate.contractVersion === HOBBY_MASTER_CONTRACT_VERSION &&
    Array.isArray(candidate.items) &&
    candidate.items.every((item) => (
      item.recordVersion === HOBBY_MASTER_RECORD_VERSION &&
      Boolean(item.subject?.context) &&
      typeof item.assessment?.salesTrend?.available === 'boolean' &&
      (
        item.masterRank === null ||
        (Number.isSafeInteger(item.masterRank) && item.masterRank > 0)
      ) &&
      item.assessment?.schemaVersion === HOBBY_MASTER_SCHEMA_VERSION &&
      item.assessment?.contractVersion === HOBBY_MASTER_CONTRACT_VERSION
    )) &&
    Array.isArray(candidate.cohorts) &&
    Boolean(candidate.snapshot) &&
    Boolean(candidate.page) &&
    Boolean(candidate.meta)
  )
}

export type {
  MagnificentXDomain,
  MagnificentXFreshnessStatus,
  MagnificentXIdentityStatus,
  MagnificentXResearchPosture,
  MagnificentXSourceRow,
  MagnificentXSubjectType,
  MagnificentXTaxonomyStatus,
}
export { midrankPercentiles } from './magnificentX.js'
