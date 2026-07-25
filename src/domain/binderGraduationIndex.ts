import type {
  HobbyMasterFeedItem,
  HobbyMasterBuildRoute,
} from './hobbyMasterRanking.js'
import type {
  HobbyPlayerRankingItem,
  HobbyPlayerRankingSport,
} from './hobbyPlayerRanking.js'

export const BINDER_GRADUATION_SCHEMA_VERSION =
  'backstop-binder-index.v1' as const
export const BINDER_GRADUATION_CONTRACT_VERSION =
  'backstop-binder-index-contract/v1' as const
export const BINDER_GRADUATION_MODEL_VERSION =
  'binder-graduation-readiness/master-build-v2.0.0' as const
export const BINDER_GRADUATION_RECORD_VERSION =
  'backstop-binder-graduation-item/v1' as const
export const BINDER_GRADUATION_HORIZON_MONTHS = 24 as const

export const BINDER_GRADUATION_SORT_KEYS = [
  'graduation_rank',
  'graduation_index',
  'market_readiness',
  'player_outlook',
  'ttm_sales',
  'current_run_rate',
  'age',
  'name',
] as const

export const BINDER_GRADUATION_BANDS = [
  'graduated',
  'on_deck',
  'approaching',
  'developing',
  'long_range',
  'withheld',
] as const

export type BinderGraduationSortKey =
  (typeof BINDER_GRADUATION_SORT_KEYS)[number]
export type BinderGraduationBand =
  (typeof BINDER_GRADUATION_BANDS)[number]
export type BinderGraduationTrajectory = 'rising' | 'steady' | 'fading'
export type BinderGraduationProjectedRoute =
  | 'durable_scale'
  | 'escape_velocity'
  | 'graduated'
  | 'withheld'
export type BinderGraduationEvidenceGrade = 'A' | 'B' | 'withheld'
export type BinderGraduationBlocker =
  | 'already_on_build_board'
  | 'ttm_scale'
  | 'current_run_rate'
  | 'master_score'
  | 'global_top_one_percent'
  | 'persistence'
  | 'shock_resistance'
  | 'downside_protection'
  | 'six_month_growth'
  | 'three_month_growth'
  | 'evidence_not_publishable'

export interface BinderGraduationDistance {
  ttmSalesUsd: number
  currentRunRateUsd: number
  masterScorePoints: number
  globalTopOneTtmUsd: number
  persistencePoints: number
  shockResistancePoints: number
  downsideProtectionPoints: number
  sixMonthGrowthMultiple: number
  threeMonthGrowthMultiple: number
}

export interface BinderGraduationAssessment {
  status: 'graduated' | 'ranked' | 'withheld'
  index: number | null
  globalRank: number | null
  band: BinderGraduationBand
  horizonMonths: typeof BINDER_GRADUATION_HORIZON_MONTHS
  probability: null
  probabilityStatus: 'withheld_no_longitudinal_build_transitions'
  target: {
    designation: 'Master Build'
    schemaVersion: 'hobby-oracle-master-ranking.v2'
    contractVersion: 'hobby-oracle-master-ranking-contract/v2'
    persistenceRule:
      'enter_build_and_remain_build_in_two_of_three_monthly_snapshots'
  }
  projectedRoute: BinderGraduationProjectedRoute
  primaryBlocker: BinderGraduationBlocker
  marketPathReadiness: number | null
  trajectorySupport: number | null
  trajectory: BinderGraduationTrajectory
  routeReadiness: {
    established: number
    escapeVelocity: number
    commonGates: number
  }
  distance: BinderGraduationDistance
  evidence: {
    grade: BinderGraduationEvidenceGrade
    sourceCurrent: boolean
    completeHistory: boolean
    identityBridgeValid: boolean
    manualIdentityReviewed: boolean
  }
  buildGateProgress: {
    passed: number
    required: number
    reasonCodes: string[]
  }
}

export interface BinderGraduationItem {
  recordVersion: typeof BINDER_GRADUATION_RECORD_VERSION
  player: {
    id: string
    name: string
    normalizedName: string
    sport: HobbyPlayerRankingSport
    age: number | null
    positions: string[]
    primaryPosition: string
    team: string | null
  }
  graduation: BinderGraduationAssessment
  playerSignal: {
    score: number
    outlook: number
    marketDurability: number
    evidenceYears: number
    evidenceStage: HobbyPlayerRankingItem['evidence']['evidenceStage']
    inputIntegrity: number
  }
  market: {
    masterRank: number | null
    masterScore: number
    boardPosture: HobbyMasterFeedItem['assessment']['posture']
    buildRoute: HobbyMasterBuildRoute
    ttmSalesUsd: number
    currentRunRateUsd: number
    globalObservedPercentile: number
    durability: number
    persistence: number
    shockResistance: number
    downsideProtection: number
  }
  identity: HobbyPlayerRankingItem['identity']
  sources: HobbyPlayerRankingItem['sources']
}

export interface BinderGraduationResponse {
  schemaVersion: typeof BINDER_GRADUATION_SCHEMA_VERSION
  contractVersion: typeof BINDER_GRADUATION_CONTRACT_VERSION
  modelVersion: typeof BINDER_GRADUATION_MODEL_VERSION
  snapshot: {
    id: string
    generatedAt: string
    dataThrough: string
    historyStart: string
    historyMonths: 18
    freshness: {
      status: 'current' | 'stale' | 'unknown'
      reasonCodes: string[]
    }
  }
  items: BinderGraduationItem[]
  scope: {
    sport: HobbyPlayerRankingSport | 'all'
    maxAge: number | null
    position: string | null
    band: BinderGraduationBand | 'all'
  }
  summary: {
    rankedCount: number
    graduatedCount: number
    onDeckCount: number
    approachingCount: number
    developingCount: number
    longRangeCount: number
    withheldCount: number
  }
  page: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  meta: {
    researchOnly: true
    investmentAdvice: false
    probabilityAvailable: false
    probabilityReason:
      'no_longitudinal_master_build_transitions_or_prospective_holdout'
    rankingPolicy:
      'one_global_rank_before_sport_age_position_or_search_filters'
    agePolicy:
      'age_is_a_filter_not_a_score_input_because_dynasty_outlook_already_prices_runway'
    targetBoard: 'hobby-oracle-master-ranking.v2'
    targetBuildCount: number
    rankingUniverseCount: number
    globalTopOneTtmFloorUsd: number
    formula: {
      establishedRoute: string
      escapeVelocityRoute: string
      commonGates: string
      marketPathReadiness: string
      graduationIndex: string
    }
    calibrationPlan: {
      targetHorizonMonths: 24
      durableGraduationDefinition:
        'enter_build_and_remain_build_in_two_of_three_monthly_snapshots'
      minimumObservedTransitionsBeforeProbability: 100
      currentObservedTransitions: 0
    }
  }
}

export interface BinderGraduationInput {
  player: HobbyPlayerRankingItem
  master: HobbyMasterFeedItem
  globalTopOneTtmFloorUsd: number
}

interface ProgressFactor {
  code: BinderGraduationBlocker
  value: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function progress(value: number, target: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(target) || target <= 0) {
    return 0
  }
  return clamp(value / target, 0, 1)
}

function weightedGeometricMean(
  values: readonly number[],
  weights: readonly number[],
): number {
  if (values.length !== weights.length || values.length === 0) {
    throw new Error('Binder Graduation geometric mean inputs are misaligned')
  }
  if (values.some((value) => value <= 0)) return 0
  return Math.exp(values.reduce(
    (total, value, index) => total + weights[index]! * Math.log(value),
    0,
  ))
}

function bandFor(index: number): BinderGraduationBand {
  if (index >= 85) return 'on_deck'
  if (index >= 70) return 'approaching'
  if (index >= 50) return 'developing'
  return 'long_range'
}

function trajectoryFor(
  ttmSalesUsd: number,
  currentRunRateUsd: number,
): BinderGraduationTrajectory {
  if (ttmSalesUsd <= 0) return currentRunRateUsd > 0 ? 'rising' : 'steady'
  const ratio = currentRunRateUsd / ttmSalesUsd
  if (ratio >= 1.15) return 'rising'
  if (ratio <= 0.85) return 'fading'
  return 'steady'
}

function distanceToTarget(value: number, target: number): number {
  return round(Math.max(0, target - value))
}

function evidenceFor(
  player: HobbyPlayerRankingItem,
  master: HobbyMasterFeedItem,
): BinderGraduationAssessment['evidence'] {
  const sourceCurrent =
    master.assessment.flags.freshnessStatus === 'current' &&
    player.sources.every((source) => source.freshness === 'current')
  const completeHistory =
    master.assessment.marketSignal.diagnostics.observedMonths === 18 &&
    player.diagnostics.observedHistoryRatio === 1
  const identityBridgeValid = player.gates.checks.identityBridgeValid
  const manualIdentityReviewed =
    player.identity.manualReviewStatus === 'approved'
  return {
    grade:
      !sourceCurrent || !completeHistory || !identityBridgeValid
        ? 'withheld'
        : manualIdentityReviewed
          ? 'A'
          : 'B',
    sourceCurrent,
    completeHistory,
    identityBridgeValid,
    manualIdentityReviewed,
  }
}

function emptyDistance(): BinderGraduationDistance {
  return {
    ttmSalesUsd: 0,
    currentRunRateUsd: 0,
    masterScorePoints: 0,
    globalTopOneTtmUsd: 0,
    persistencePoints: 0,
    shockResistancePoints: 0,
    downsideProtectionPoints: 0,
    sixMonthGrowthMultiple: 0,
    threeMonthGrowthMultiple: 0,
  }
}

export function buildBinderGraduationAssessment(
  input: BinderGraduationInput,
): BinderGraduationAssessment {
  const { player, master } = input
  const signal = master.assessment.marketSignal
  const evidence = evidenceFor(player, master)
  const sixMonthGrowth = Math.exp(
    signal.diagnostics.yearOverYearSixMonthLogGrowth,
  )
  const threeMonthGrowth = Math.exp(
    signal.diagnostics.recentThreeMonthYearOverYearLogGrowth,
  )
  const trajectory = trajectoryFor(
    signal.latestTwelveMonthSalesUsd,
    signal.annualizedCurrentSixMonthSalesUsd,
  )
  const buildGateProgress = {
    passed: master.assessment.buildQualification.passed,
    required: master.assessment.buildQualification.required,
    reasonCodes: [...master.assessment.buildQualification.reasonCodes],
  }

  if (evidence.grade === 'withheld') {
    return {
      status: 'withheld',
      index: null,
      globalRank: null,
      band: 'withheld',
      horizonMonths: BINDER_GRADUATION_HORIZON_MONTHS,
      probability: null,
      probabilityStatus: 'withheld_no_longitudinal_build_transitions',
      target: {
        designation: 'Master Build',
        schemaVersion: 'hobby-oracle-master-ranking.v2',
        contractVersion: 'hobby-oracle-master-ranking-contract/v2',
        persistenceRule:
          'enter_build_and_remain_build_in_two_of_three_monthly_snapshots',
      },
      projectedRoute: 'withheld',
      primaryBlocker: 'evidence_not_publishable',
      marketPathReadiness: null,
      trajectorySupport: null,
      trajectory,
      routeReadiness: {
        established: 0,
        escapeVelocity: 0,
        commonGates: 0,
      },
      distance: emptyDistance(),
      evidence,
      buildGateProgress,
    }
  }

  if (master.assessment.buildQualification.eligible) {
    return {
      status: 'graduated',
      index: 100,
      globalRank: null,
      band: 'graduated',
      horizonMonths: BINDER_GRADUATION_HORIZON_MONTHS,
      probability: null,
      probabilityStatus: 'withheld_no_longitudinal_build_transitions',
      target: {
        designation: 'Master Build',
        schemaVersion: 'hobby-oracle-master-ranking.v2',
        contractVersion: 'hobby-oracle-master-ranking-contract/v2',
        persistenceRule:
          'enter_build_and_remain_build_in_two_of_three_monthly_snapshots',
      },
      projectedRoute: 'graduated',
      primaryBlocker: 'already_on_build_board',
      marketPathReadiness: 100,
      trajectorySupport: player.components.outlook,
      trajectory,
      routeReadiness: {
        established: 100,
        escapeVelocity: 100,
        commonGates: 100,
      },
      distance: emptyDistance(),
      evidence,
      buildGateProgress,
    }
  }

  const establishedFactors: ProgressFactor[] = [
    {
      code: 'ttm_scale',
      value: progress(signal.latestTwelveMonthSalesUsd, 20_000_000),
    },
    {
      code: 'current_run_rate',
      value: progress(signal.annualizedCurrentSixMonthSalesUsd, 15_000_000),
    },
    { code: 'master_score', value: progress(signal.score, 75) },
  ]
  const escapeFactors: ProgressFactor[] = [
    {
      code: 'ttm_scale',
      value: progress(signal.latestTwelveMonthSalesUsd, 15_000_000),
    },
    {
      code: 'current_run_rate',
      value: progress(signal.annualizedCurrentSixMonthSalesUsd, 20_000_000),
    },
    { code: 'master_score', value: progress(signal.score, 70) },
    { code: 'six_month_growth', value: progress(sixMonthGrowth, 2.5) },
    { code: 'three_month_growth', value: progress(threeMonthGrowth, 2) },
  ]
  const commonFactors: ProgressFactor[] = [
    {
      code: 'global_top_one_percent',
      value: progress(
        signal.latestTwelveMonthSalesUsd,
        input.globalTopOneTtmFloorUsd,
      ),
    },
    {
      code: 'persistence',
      value: progress(signal.components.persistence, 90),
    },
    {
      code: 'shock_resistance',
      value: progress(signal.components.shockResistance, 90),
    },
    {
      code: 'downside_protection',
      value: progress(signal.downsideProtectionScore, 90),
    },
  ]
  const established = weightedGeometricMean(
    establishedFactors.map((factor) => factor.value),
    [0.45, 0.35, 0.2],
  )
  const escapeVelocity = weightedGeometricMean(
    escapeFactors.map((factor) => factor.value),
    [0.3, 0.25, 0.15, 0.15, 0.15],
  )
  const commonGates = weightedGeometricMean(
    commonFactors.map((factor) => factor.value),
    [0.25, 0.25, 0.25, 0.25],
  )
  const projectedRoute: BinderGraduationProjectedRoute =
    escapeVelocity > established ? 'escape_velocity' : 'durable_scale'
  const selectedRouteFactors =
    projectedRoute === 'escape_velocity'
      ? escapeFactors
      : establishedFactors
  const marketPathReadiness = round(
    100 * weightedGeometricMean(
      [Math.max(established, escapeVelocity), commonGates],
      [0.65, 0.35],
    ),
  )
  const trajectorySupport = round(player.components.outlook)
  const index = round(clamp(
    0.6 * Math.min(trajectorySupport, marketPathReadiness) +
      0.4 * Math.sqrt(trajectorySupport * marketPathReadiness),
    0,
    99.9,
  ))
  const primaryBlocker = [...commonFactors, ...selectedRouteFactors]
    .toSorted((left, right) => (
      left.value - right.value ||
      left.code.localeCompare(right.code, 'en-US')
    ))[0]?.code ?? 'master_score'
  const routeTargets =
    projectedRoute === 'escape_velocity'
      ? {
          ttm: 15_000_000,
          runRate: 20_000_000,
          score: 70,
          sixMonthGrowth: 2.5,
          threeMonthGrowth: 2,
        }
      : {
          ttm: 20_000_000,
          runRate: 15_000_000,
          score: 75,
          sixMonthGrowth: 1,
          threeMonthGrowth: 1,
        }

  return {
    status: 'ranked',
    index,
    globalRank: null,
    band: bandFor(index),
    horizonMonths: BINDER_GRADUATION_HORIZON_MONTHS,
    probability: null,
    probabilityStatus: 'withheld_no_longitudinal_build_transitions',
    target: {
      designation: 'Master Build',
      schemaVersion: 'hobby-oracle-master-ranking.v2',
      contractVersion: 'hobby-oracle-master-ranking-contract/v2',
      persistenceRule:
        'enter_build_and_remain_build_in_two_of_three_monthly_snapshots',
    },
    projectedRoute,
    primaryBlocker,
    marketPathReadiness,
    trajectorySupport,
    trajectory,
    routeReadiness: {
      established: round(established * 100),
      escapeVelocity: round(escapeVelocity * 100),
      commonGates: round(commonGates * 100),
    },
    distance: {
      ttmSalesUsd: distanceToTarget(
        signal.latestTwelveMonthSalesUsd,
        routeTargets.ttm,
      ),
      currentRunRateUsd: distanceToTarget(
        signal.annualizedCurrentSixMonthSalesUsd,
        routeTargets.runRate,
      ),
      masterScorePoints: distanceToTarget(signal.score, routeTargets.score),
      globalTopOneTtmUsd: distanceToTarget(
        signal.latestTwelveMonthSalesUsd,
        input.globalTopOneTtmFloorUsd,
      ),
      persistencePoints: distanceToTarget(
        signal.components.persistence,
        90,
      ),
      shockResistancePoints: distanceToTarget(
        signal.components.shockResistance,
        90,
      ),
      downsideProtectionPoints: distanceToTarget(
        signal.downsideProtectionScore,
        90,
      ),
      sixMonthGrowthMultiple: round(Math.max(
        0,
        routeTargets.sixMonthGrowth - sixMonthGrowth,
      ), 2),
      threeMonthGrowthMultiple: round(Math.max(
        0,
        routeTargets.threeMonthGrowth - threeMonthGrowth,
      ), 2),
    },
    evidence,
    buildGateProgress,
  }
}

export function withBinderGraduationRank(
  items: readonly BinderGraduationItem[],
): BinderGraduationItem[] {
  const ranked = items
    .filter((item) => item.graduation.status === 'ranked')
    .toSorted((left, right) => (
      (right.graduation.index ?? -1) - (left.graduation.index ?? -1) ||
      (right.graduation.marketPathReadiness ?? -1) -
        (left.graduation.marketPathReadiness ?? -1) ||
      right.playerSignal.outlook - left.playerSignal.outlook ||
      left.player.name.localeCompare(right.player.name, 'en-US')
    ))
  const rankById = new Map(
    ranked.map((item, index) => [item.player.id, index + 1]),
  )
  return items.map((item) => ({
    ...item,
    graduation: {
      ...item.graduation,
      globalRank: rankById.get(item.player.id) ?? null,
    },
  }))
}

export function isBinderGraduationResponse(
  value: unknown,
): value is BinderGraduationResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BinderGraduationResponse>
  return (
    candidate.schemaVersion === BINDER_GRADUATION_SCHEMA_VERSION &&
    candidate.contractVersion === BINDER_GRADUATION_CONTRACT_VERSION &&
    candidate.modelVersion === BINDER_GRADUATION_MODEL_VERSION &&
    Array.isArray(candidate.items) &&
    candidate.items.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false
      const record = item as Partial<BinderGraduationItem>
      const graduation = record.graduation
      if (!graduation) return false
      const index = graduation.index
      return (
        record.recordVersion === BINDER_GRADUATION_RECORD_VERSION &&
        BINDER_GRADUATION_BANDS.includes(graduation.band) &&
        graduation.probability === null &&
        (
          index === null ||
          (
            typeof index === 'number' &&
            Number.isFinite(index) &&
            index >= 0 &&
            index <= 100
          )
        )
      )
    }) &&
    Boolean(candidate.snapshot) &&
    Boolean(candidate.scope) &&
    Boolean(candidate.summary) &&
    Boolean(candidate.page) &&
    candidate.meta?.probabilityAvailable === false
  )
}
