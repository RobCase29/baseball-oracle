import { createHash } from 'node:crypto'
import {
  buildHobbyMasterCatalog,
  type HobbyMasterCatalog,
} from './_hobby-master-ranking.js'
import {
  buildHobbyPlayerRankingCatalog,
  type HobbyPlayerRankingCatalog,
} from './_hobby-player-rankings.js'
import {
  BINDER_GRADUATION_CONTRACT_VERSION,
  BINDER_GRADUATION_HORIZON_MONTHS,
  BINDER_GRADUATION_MODEL_VERSION,
  BINDER_GRADUATION_RECORD_VERSION,
  BINDER_GRADUATION_SCHEMA_VERSION,
  buildBinderGraduationAssessment,
  withBinderGraduationRank,
  type BinderGraduationBand,
  type BinderGraduationItem,
  type BinderGraduationResponse,
  type BinderGraduationSortKey,
} from '../src/domain/binderGraduationIndex.js'
import type {
  HobbyPlayerRankingSport,
} from '../src/domain/hobbyPlayerRanking.js'

export interface BinderGraduationQuery {
  q?: string
  sport?: HobbyPlayerRankingSport | 'all'
  maxAge?: number
  position?: string
  band?: BinderGraduationBand | 'all'
  sort?: BinderGraduationSortKey
  page?: number
  limit?: number
}

export interface BinderGraduationCatalog {
  playerCatalog: HobbyPlayerRankingCatalog
  masterCatalog: HobbyMasterCatalog
  items: BinderGraduationItem[]
  globalTopOneTtmFloorUsd: number
  snapshotId: string
}

function quantile(values: readonly number[], percentile: number): number {
  const sorted = values.toSorted((left, right) => left - right)
  if (sorted.length === 0) return 0
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]!
  const upperWeight = index - lower
  return sorted[lower]! * (1 - upperWeight) + sorted[upper]! * upperWeight
}

function globalTopOneTtmFloor(catalog: HobbyMasterCatalog): number {
  return Math.round(quantile(
    catalog.items
      .filter((item) => item.masterRank !== null)
      .map((item) => item.assessment.marketSignal.latestTwelveMonthSalesUsd),
    0.99,
  ))
}

function toBinderGraduationItem(input: {
  player: HobbyPlayerRankingCatalog['items'][number]
  master: HobbyMasterCatalog['items'][number]
  globalTopOneTtmFloorUsd: number
}): BinderGraduationItem {
  const { player, master } = input
  const marketSignal = master.assessment.marketSignal
  return {
    recordVersion: BINDER_GRADUATION_RECORD_VERSION,
    player: {
      id: player.id,
      name: player.name,
      normalizedName: player.normalizedName,
      sport: player.sport,
      age: player.age,
      positions: [...player.positions],
      primaryPosition: player.primaryPosition,
      team: player.team,
    },
    graduation: buildBinderGraduationAssessment({
      player,
      master,
      globalTopOneTtmFloorUsd: input.globalTopOneTtmFloorUsd,
    }),
    playerSignal: {
      score: player.score,
      outlook: player.components.outlook,
      marketDurability: player.components.marketDurability,
      evidenceYears: player.evidence.evidenceYears,
      evidenceStage: player.evidence.evidenceStage,
      inputIntegrity: player.confidence.score,
    },
    market: {
      masterRank: master.masterRank,
      masterScore: marketSignal.score,
      boardPosture: master.assessment.posture,
      buildRoute: master.assessment.buildQualification.route,
      ttmSalesUsd: marketSignal.latestTwelveMonthSalesUsd,
      currentRunRateUsd: marketSignal.annualizedCurrentSixMonthSalesUsd,
      globalObservedPercentile: marketSignal.globalObservedPercentile,
      durability: marketSignal.durabilityScore,
      persistence: marketSignal.components.persistence,
      shockResistance: marketSignal.components.shockResistance,
      downsideProtection: marketSignal.downsideProtectionScore,
    },
    identity: player.identity,
    sources: player.sources.map((source) => ({ ...source })),
  }
}

export function buildBinderGraduationCatalog(
  now = new Date(),
  playerCatalog = buildHobbyPlayerRankingCatalog(
    undefined,
    undefined,
    now,
  ),
  masterCatalog = buildHobbyMasterCatalog(undefined, now),
): BinderGraduationCatalog {
  const masterBySourceKey = new Map(
    masterCatalog.items.map((item) => [item.subject.id, item]),
  )
  const globalTopOneTtmFloorUsd = globalTopOneTtmFloor(masterCatalog)
  if (globalTopOneTtmFloorUsd <= 0) {
    throw new Error('Binder Graduation target universe has no P99 demand floor')
  }
  const unranked = playerCatalog.items.map((player) => {
    const master = masterBySourceKey.get(player.identity.gemRateSourceKey)
    if (!master) {
      throw new Error(
        `Binder Graduation is missing Master Build target ${player.identity.gemRateSourceKey}`,
      )
    }
    return toBinderGraduationItem({
      player,
      master,
      globalTopOneTtmFloorUsd,
    })
  })
  const items = withBinderGraduationRank(unranked)
  const snapshotId = `backstop-binder-index/v1:${
    createHash('sha256').update(JSON.stringify({
      modelVersion: BINDER_GRADUATION_MODEL_VERSION,
      playerSnapshots: playerCatalog.snapshotIdBySport,
      masterSnapshot: masterCatalog.snapshotId,
      globalTopOneTtmFloorUsd,
      ranked: items.map((item) => [
        item.player.id,
        item.graduation.globalRank,
        item.graduation.index,
        item.graduation.band,
        item.graduation.projectedRoute,
        item.graduation.primaryBlocker,
      ]),
    })).digest('hex')
  }`
  return {
    playerCatalog,
    masterCatalog,
    items,
    globalTopOneTtmFloorUsd,
    snapshotId,
  }
}

function compareNullableRank(
  left: number | null,
  right: number | null,
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left - right
}

function displayComparator(
  sort: BinderGraduationSortKey,
): (left: BinderGraduationItem, right: BinderGraduationItem) => number {
  return (left, right) => {
    let comparison = 0
    switch (sort) {
      case 'graduation_rank':
        comparison = compareNullableRank(
          left.graduation.globalRank,
          right.graduation.globalRank,
        )
        break
      case 'graduation_index':
        comparison =
          (right.graduation.index ?? -1) - (left.graduation.index ?? -1)
        break
      case 'market_readiness':
        comparison =
          (right.graduation.marketPathReadiness ?? -1) -
          (left.graduation.marketPathReadiness ?? -1)
        break
      case 'player_outlook':
        comparison =
          right.playerSignal.outlook - left.playerSignal.outlook
        break
      case 'ttm_sales':
        comparison = right.market.ttmSalesUsd - left.market.ttmSalesUsd
        break
      case 'current_run_rate':
        comparison =
          right.market.currentRunRateUsd - left.market.currentRunRateUsd
        break
      case 'age':
        comparison =
          left.player.age === null
            ? right.player.age === null ? 0 : 1
            : right.player.age === null
              ? -1
              : left.player.age - right.player.age
        break
      case 'name':
        comparison = left.player.name.localeCompare(
          right.player.name,
          'en-US',
        )
        break
    }
    return (
      comparison ||
      compareNullableRank(
        left.graduation.globalRank,
        right.graduation.globalRank,
      ) ||
      left.player.name.localeCompare(right.player.name, 'en-US')
    )
  }
}

function summaryFor(
  items: readonly BinderGraduationItem[],
): BinderGraduationResponse['summary'] {
  return {
    rankedCount:
      items.filter((item) => item.graduation.status === 'ranked').length,
    graduatedCount:
      items.filter((item) => item.graduation.band === 'graduated').length,
    onDeckCount:
      items.filter((item) => item.graduation.band === 'on_deck').length,
    approachingCount:
      items.filter((item) => item.graduation.band === 'approaching').length,
    developingCount:
      items.filter((item) => item.graduation.band === 'developing').length,
    longRangeCount:
      items.filter((item) => item.graduation.band === 'long_range').length,
    withheldCount:
      items.filter((item) => item.graduation.band === 'withheld').length,
  }
}

function selectedFreshness(
  catalog: BinderGraduationCatalog,
  sport: HobbyPlayerRankingSport | 'all',
): BinderGraduationResponse['snapshot']['freshness'] {
  const sports =
    sport === 'all' ? (['football', 'basketball'] as const) : [sport]
  const states = sports.map(
    (selectedSport) => catalog.playerCatalog.freshnessBySport[selectedSport],
  )
  const master = catalog.masterCatalog.freshness
  const status =
    master.status === 'stale' || states.some((state) => state.status === 'stale')
      ? 'stale'
      : master.status === 'unknown' ||
          states.some((state) => state.status === 'unknown')
        ? 'unknown'
        : 'current'
  return {
    status,
    reasonCodes: [
      ...master.reasonCodes,
      ...states.flatMap((state) => state.reasonCodes),
      ...(status === 'current' ? [] : ['graduation_ranking_suspended']),
    ].filter((reason, index, reasons) => reasons.indexOf(reason) === index),
  }
}

export function buildBinderGraduationFeed(
  catalog: BinderGraduationCatalog,
  query: BinderGraduationQuery = {},
): BinderGraduationResponse {
  const sport = query.sport ?? 'all'
  const normalizedQuery = query.q?.trim().toLocaleLowerCase('en-US') ?? ''
  const position = query.position?.trim().toLocaleUpperCase('en-US') || null
  const band = query.band ?? 'all'
  const sort = query.sort ?? 'graduation_rank'
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const limit = Math.max(1, Math.min(100, Math.floor(query.limit ?? 50)))
  const freshness = selectedFreshness(catalog, sport)
  const publishable = freshness.status === 'current' ? catalog.items : []
  const filtered = publishable
    .filter((item) => (
      (sport === 'all' || item.player.sport === sport) &&
      (
        query.maxAge === undefined ||
        (item.player.age !== null && item.player.age <= query.maxAge)
      ) &&
      (!position || item.player.positions.includes(position)) &&
      (band === 'all' || item.graduation.band === band) &&
      (
        normalizedQuery.length === 0 ||
        item.player.name
          .toLocaleLowerCase('en-US')
          .includes(normalizedQuery)
      )
    ))
    .toSorted(displayComparator(sort))
  const total = filtered.length
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit)
  const offset = (page - 1) * limit
  const playerSnapshotDates = [
    catalog.playerCatalog.snapshotGeneratedAt,
    catalog.playerCatalog.snapshotAcquiredAt,
  ]
  const generatedAt = [
    ...playerSnapshotDates,
    catalog.masterCatalog.snapshot.acquiredAt,
  ].toSorted().at(-1)!
  const targetBuildCount = catalog.masterCatalog.items.filter(
    (item) => item.assessment.buildQualification.eligible,
  ).length

  return {
    schemaVersion: BINDER_GRADUATION_SCHEMA_VERSION,
    contractVersion: BINDER_GRADUATION_CONTRACT_VERSION,
    modelVersion: BINDER_GRADUATION_MODEL_VERSION,
    snapshot: {
      id: catalog.snapshotId,
      generatedAt,
      dataThrough: catalog.masterCatalog.snapshot.dataThrough,
      historyStart: `${catalog.masterCatalog.snapshot.historyMonths[0]}-01`,
      historyMonths: 18,
      freshness,
    },
    items: filtered.slice(offset, offset + limit),
    scope: {
      sport,
      maxAge: query.maxAge ?? null,
      position,
      band,
    },
    summary: summaryFor(filtered),
    page: { page, limit, total, totalPages },
    meta: {
      researchOnly: true,
      investmentAdvice: false,
      probabilityAvailable: false,
      probabilityReason:
        'no_longitudinal_master_build_transitions_or_prospective_holdout',
      rankingPolicy:
        'one_global_rank_before_sport_age_position_or_search_filters',
      agePolicy:
        'age_is_a_filter_not_a_score_input_because_dynasty_outlook_already_prices_runway',
      targetBoard: 'hobby-oracle-master-ranking.v2',
      targetBuildCount,
      rankingUniverseCount:
        catalog.items.filter(
          (item) => item.graduation.status === 'ranked',
        ).length,
      globalTopOneTtmFloorUsd: catalog.globalTopOneTtmFloorUsd,
      formula: {
        establishedRoute:
          'weighted geometric proximity to $20M TTM, $15M current run rate, and Master Score 75',
        escapeVelocityRoute:
          'weighted geometric proximity to $15M TTM, $20M current run rate, Master Score 70, 2.5x six-month growth, and 2.0x three-month growth',
        commonGates:
          'geometric proximity to observed P99 TTM demand, persistence 90, shock resistance 90, and downside protection 90',
        marketPathReadiness:
          '65%/35% geometric blend of the better absolute route and common-gate readiness',
        graduationIndex:
          '60% weak link plus 40% geometric mean of player outlook and market-path readiness',
      },
      calibrationPlan: {
        targetHorizonMonths: BINDER_GRADUATION_HORIZON_MONTHS,
        durableGraduationDefinition:
          'enter_build_and_remain_build_in_two_of_three_monthly_snapshots',
        minimumObservedTransitionsBeforeProbability: 100,
        currentObservedTransitions: 0,
      },
    },
  }
}

export const binderGraduationSortKeys = [
  'graduation_rank',
  'graduation_index',
  'market_readiness',
  'player_outlook',
  'ttm_sales',
  'current_run_rate',
  'age',
  'name',
] as const satisfies readonly BinderGraduationSortKey[]

export const binderGraduationBands = [
  'graduated',
  'on_deck',
  'approaching',
  'developing',
  'long_range',
  'withheld',
] as const satisfies readonly BinderGraduationBand[]

export const binderGraduationSports = [
  'all',
  'football',
  'basketball',
] as const
