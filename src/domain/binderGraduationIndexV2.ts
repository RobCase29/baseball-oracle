import type {
  BinderGraduationAssessment,
  BinderGraduationBand,
  BinderGraduationSortKey,
} from './binderGraduationIndex.js'
import {
  BINDER_GRADUATION_BANDS,
  BINDER_GRADUATION_HORIZON_MONTHS,
} from './binderGraduationIndex.js'
import type {
  HobbyMasterBuildRoute,
  HobbyMasterFeedItem,
} from './hobbyMasterRanking.js'

export const BINDER_GRADUATION_V2_SCHEMA_VERSION =
  'backstop-binder-index.v2' as const
export const BINDER_GRADUATION_V2_CONTRACT_VERSION =
  'backstop-binder-index-contract/v2' as const
export const BINDER_GRADUATION_V2_MODEL_VERSION =
  'binder-graduation-readiness/master-build-v2.1.0' as const
export const BINDER_GRADUATION_V2_RECORD_VERSION =
  'backstop-binder-graduation-item/v2' as const

export const BINDER_GRADUATION_SPORTS = [
  'baseball',
  'football',
  'basketball',
] as const

export type BinderGraduationSport =
  (typeof BINDER_GRADUATION_SPORTS)[number]

export type BinderGraduationPlayerEvidenceStage =
  | 'new'
  | 'developing'
  | 'emerging'
  | 'established'
  | 'prospect'
  | 'rookie'
  | 'early_career'

export type BinderGraduationPlayerBasis =
  | 'dynasty_market_consensus'
  | 'career_index_route_outcome'

export interface BinderGraduationV2Identity {
  status:
    | 'reviewed_exact'
    | 'reviewed_alias'
    | 'unique_normalized_name'
    | 'verified_external_id'
  manualReviewStatus: 'approved' | 'unreviewed'
  provider:
    | 'keeptradecut'
    | 'hashtag_basketball'
    | 'career_oracle'
  providerPlayerId: string
  gemRateSourceKey: string
}

export interface BinderGraduationV2SourceEvidence {
  id:
    | 'gemrate'
    | 'keeptradecut'
    | 'hashtag_basketball'
    | 'career_oracle'
  label:
    | 'GemRate'
    | 'KeepTradeCut'
    | 'Hashtag Basketball'
    | 'Career Oracle'
  url: string
  asOf: string
  fetchedAt: string
  freshness: 'current' | 'stale' | 'unknown'
  permissionBasis: string
  measure: string
}

export interface BinderGraduationV2Item {
  recordVersion: typeof BINDER_GRADUATION_V2_RECORD_VERSION
  player: {
    id: string
    name: string
    normalizedName: string
    sport: BinderGraduationSport
    age: number | null
    positions: string[]
    primaryPosition: string
    team: string | null
    developmentStage: BinderGraduationPlayerEvidenceStage
  }
  graduation: BinderGraduationAssessment
  playerSignal: {
    score: number
    outlook: number
    marketDurability: number
    evidenceYears: number
    evidenceStage: BinderGraduationPlayerEvidenceStage
    inputIntegrity: number
    basis: BinderGraduationPlayerBasis
    modelLabel: string
    ageTreatment:
      | 'filter_only'
      | 'development_runway_embedded_in_outlook'
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
  identity: BinderGraduationV2Identity
  sources: BinderGraduationV2SourceEvidence[]
}

export interface BinderGraduationV2Response {
  schemaVersion: typeof BINDER_GRADUATION_V2_SCHEMA_VERSION
  contractVersion: typeof BINDER_GRADUATION_V2_CONTRACT_VERSION
  modelVersion: typeof BINDER_GRADUATION_V2_MODEL_VERSION
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
  items: BinderGraduationV2Item[]
  scope: {
    sport: BinderGraduationSport | 'all'
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
      'age_is_a_filter_football_basketball_dynasty_outlook_prices_runway_baseball_outlook_embeds_development_runway'
    playerModelPolicy:
      'sport_specific_player_outlook_models_share_one_absolute_master_build_market_target'
    targetBoard: 'hobby-oracle-master-ranking.v2'
    targetBuildCount: number
    rankingUniverseCount: number
    globalTopOneTtmFloorUsd: number
    sports: readonly ['baseball', 'football', 'basketball']
    coverageBySport: Record<BinderGraduationSport, number>
    formula: {
      establishedRoute: string
      escapeVelocityRoute: string
      commonGates: string
      marketPathReadiness: string
      graduationIndex: string
    }
    calibrationPlan: {
      targetHorizonMonths: typeof BINDER_GRADUATION_HORIZON_MONTHS
      durableGraduationDefinition:
        'enter_build_and_remain_build_in_two_of_three_monthly_snapshots'
      minimumObservedTransitionsBeforeProbability: 100
      currentObservedTransitions: 0
    }
  }
}

export function withBinderGraduationV2Rank(
  items: readonly BinderGraduationV2Item[],
): BinderGraduationV2Item[] {
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

export function isBinderGraduationV2Response(
  value: unknown,
): value is BinderGraduationV2Response {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BinderGraduationV2Response>
  return (
    candidate.schemaVersion === BINDER_GRADUATION_V2_SCHEMA_VERSION &&
    candidate.contractVersion === BINDER_GRADUATION_V2_CONTRACT_VERSION &&
    candidate.modelVersion === BINDER_GRADUATION_V2_MODEL_VERSION &&
    Array.isArray(candidate.items) &&
    candidate.items.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false
      const record = item as Partial<BinderGraduationV2Item>
      const graduation = record.graduation
      return Boolean(
        record.recordVersion === BINDER_GRADUATION_V2_RECORD_VERSION &&
        record.player &&
        BINDER_GRADUATION_SPORTS.includes(record.player.sport) &&
        graduation &&
        BINDER_GRADUATION_BANDS.includes(graduation.band) &&
        graduation.probability === null &&
        (
          graduation.index === null ||
          (
            typeof graduation.index === 'number' &&
            Number.isFinite(graduation.index) &&
            graduation.index >= 0 &&
            graduation.index <= 100
          )
        ),
      )
    }) &&
    Boolean(candidate.snapshot) &&
    Boolean(candidate.scope) &&
    Boolean(candidate.summary) &&
    Boolean(candidate.page) &&
    candidate.meta?.probabilityAvailable === false
  )
}

export type {
  BinderGraduationBand,
  BinderGraduationSortKey,
}
