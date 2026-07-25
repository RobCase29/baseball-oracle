import { createHash } from 'node:crypto'
import {
  binderBaseballModelFreshness,
} from './_binder-scores.js'
import {
  buildBinderGraduationCatalog,
  type BinderGraduationCatalog,
} from './_binder-graduation-index.js'
import type {
  BaseballGraduationUniverse,
} from './_baseball-graduation-universe.js'
import {
  BINDER_GRADUATION_HORIZON_MONTHS,
  BINDER_GRADUATION_BANDS,
  BINDER_GRADUATION_SORT_KEYS,
  buildBinderGraduationAssessment,
  type BinderGraduationBand,
  type BinderGraduationSortKey,
} from '../src/domain/binderGraduationIndex.js'
import {
  BINDER_GRADUATION_SPORTS,
  BINDER_GRADUATION_V2_CONTRACT_VERSION,
  BINDER_GRADUATION_V2_MODEL_VERSION,
  BINDER_GRADUATION_V2_RECORD_VERSION,
  BINDER_GRADUATION_V2_SCHEMA_VERSION,
  withBinderGraduationV2Rank,
  type BinderGraduationPlayerEvidenceStage,
  type BinderGraduationSport,
  type BinderGraduationV2Item,
  type BinderGraduationV2Response,
} from '../src/domain/binderGraduationIndexV2.js'
import {
  normalizeHobbyPlayerName,
} from '../src/domain/hobbyPlayerRanking.js'
import type {
  HobbyMasterFeedItem,
} from '../src/domain/hobbyMasterRanking.js'
import type {
  UnifiedBoardCandidate,
} from './players.js'

export interface BinderGraduationV2Query {
  q?: string
  sport?: BinderGraduationSport | 'all'
  maxAge?: number
  position?: string
  band?: BinderGraduationBand | 'all'
  sort?: BinderGraduationSortKey
  page?: number
  limit?: number
}

interface SourceFreshness {
  status: 'current' | 'stale' | 'unknown'
  reasonCodes: string[]
}

export interface BinderGraduationV2Catalog {
  legacyCatalog: BinderGraduationCatalog
  baseballUniverse: BaseballGraduationUniverse
  items: BinderGraduationV2Item[]
  sourceFreshness: Record<BinderGraduationSport, SourceFreshness>
  globalTopOneTtmFloorUsd: number
  snapshotId: string
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function legacyStage(
  value: BinderGraduationCatalog['items'][number]['playerSignal']['evidenceStage'],
): BinderGraduationPlayerEvidenceStage {
  return value
}

function legacyItemToV2(
  item: BinderGraduationCatalog['items'][number],
): BinderGraduationV2Item {
  const provider = item.identity.provider
  return {
    recordVersion: BINDER_GRADUATION_V2_RECORD_VERSION,
    player: {
      ...item.player,
      developmentStage: legacyStage(item.playerSignal.evidenceStage),
    },
    graduation: {
      ...item.graduation,
      globalRank: null,
    },
    playerSignal: {
      ...item.playerSignal,
      evidenceStage: legacyStage(item.playerSignal.evidenceStage),
      basis: 'dynasty_market_consensus',
      modelLabel:
        item.player.sport === 'football'
          ? 'KeepTradeCut dynasty outlook'
          : 'Hashtag Basketball dynasty outlook',
      ageTreatment: 'filter_only',
    },
    market: { ...item.market },
    identity: {
      status: item.identity.status,
      manualReviewStatus: item.identity.manualReviewStatus,
      provider,
      providerPlayerId: item.identity.providerPlayerId,
      gemRateSourceKey: item.identity.gemRateSourceKey,
    },
    sources: item.sources.map((source) => ({ ...source })),
  }
}

function candidateForecast(
  candidate: UnifiedBoardCandidate,
) {
  return candidate.stage === 'recent_callup'
    ? candidate.recentCallupPrior?.forecast ?? null
    : candidate.careerForecast
}

function baseballStage(
  candidate: UnifiedBoardCandidate,
): BinderGraduationPlayerEvidenceStage {
  if (candidate.stage === 'pre_debut') return 'prospect'
  if (
    candidate.stage === 'recent_callup' ||
    candidate.careerForecast?.careerChapter?.evidence.mlbSeasonNumber === 1
  ) {
    return 'rookie'
  }
  if (candidate.stage === 'early_mlb') return 'early_career'
  return 'established'
}

function baseballEvidenceYears(candidate: UnifiedBoardCandidate): number {
  if (candidate.stage === 'pre_debut') return 0
  return Math.max(
    1,
    candidate.careerForecast?.careerChapter?.evidence.mlbSeasonNumber ?? 1,
  )
}

function chronologyPlausible(
  candidate: UnifiedBoardCandidate,
  master: HobbyMasterFeedItem,
  now: Date,
): boolean {
  const firstGradedYear = master.subject.firstGradedYear
  if (firstGradedYear === null || candidate.age === null) return true
  const earliestPossibleBirthYear = now.getUTCFullYear() - candidate.age - 1
  return firstGradedYear - earliestPossibleBirthYear >= 10
}

function baseballSourceEvidence(input: {
  universe: BaseballGraduationUniverse
  freshness: SourceFreshness
  masterAcquiredAt: string
  masterDataThrough: string
}): BinderGraduationV2Item['sources'] {
  return [
    {
      id: 'gemrate',
      label: 'GemRate',
      url: 'https://www.gemrate.com/sales-trends',
      asOf: input.masterDataThrough,
      fetchedAt: input.masterAcquiredAt,
      freshness: input.freshness.status,
      permissionBasis: 'licensed_user_provided_permission',
      measure: 'completed eBay singles sales volume in USD',
    },
    {
      id: 'career_oracle',
      label: 'Career Oracle',
      url: 'https://baseball-oracle.vercel.app/api/players?view=map',
      asOf: input.universe.modelDataAsOf,
      fetchedAt: input.universe.previewGeneratedAt,
      freshness: input.freshness.status,
      permissionBasis: 'first_party_research_model',
      measure:
        'Career Index, route-outcome standing, and development runway',
    },
  ]
}

function baseballItems(input: {
  universe: BaseballGraduationUniverse
  legacyCatalog: BinderGraduationCatalog
  freshness: SourceFreshness
  now: Date
}): BinderGraduationV2Item[] {
  const masterCatalog = input.legacyCatalog.masterCatalog
  const ambiguousNames = new Set(
    masterCatalog.snapshot.metadata.ambiguousWithinCohortNames
      .filter((entry) => entry.domain === 'baseball')
      .map((entry) => entry.normalizedName),
  )
  const masterGroups = new Map<string, HobbyMasterFeedItem[]>()
  for (const master of masterCatalog.items) {
    if (
      master.subject.domain !== 'baseball' ||
      master.subject.type !== 'athlete'
    ) {
      continue
    }
    const normalized = normalizeHobbyPlayerName(master.subject.name)
    masterGroups.set(normalized, [
      ...(masterGroups.get(normalized) ?? []),
      master,
    ])
  }
  const candidateNameCounts = new Map<string, number>()
  for (const candidate of input.universe.candidates) {
    const normalized = normalizeHobbyPlayerName(candidate.name)
    candidateNameCounts.set(
      normalized,
      (candidateNameCounts.get(normalized) ?? 0) + 1,
    )
  }
  const sources = baseballSourceEvidence({
    universe: input.universe,
    freshness: input.freshness,
    masterAcquiredAt: masterCatalog.snapshot.acquiredAt,
    masterDataThrough: masterCatalog.snapshot.dataThrough,
  })

  return input.universe.candidates.flatMap((candidate) => {
    const normalizedName = normalizeHobbyPlayerName(candidate.name)
    const masterMatches = masterGroups.get(normalizedName) ?? []
    const assessment = candidate.binderScore
    const outlook = assessment?.components.baseballThesis.score ?? null
    const forecast = candidateForecast(candidate)
    if (
      candidate.mlbamId === null ||
      candidateNameCounts.get(normalizedName) !== 1 ||
      ambiguousNames.has(normalizedName) ||
      masterMatches.length !== 1 ||
      assessment === undefined ||
      outlook === null ||
      forecast === null ||
      !assessment.flags.coreBaseballEvidenceComplete
    ) {
      return []
    }
    const master = masterMatches[0]!
    if (!chronologyPlausible(candidate, master, input.now)) return []
    const manualIdentityReviewed =
      assessment.flags.marketIdentityStatus === 'manual_verified'
    const sourceCurrent =
      input.freshness.status === 'current' &&
      assessment.flags.baseballFreshness === 'current'
    const graduation = buildBinderGraduationAssessment({
      player: {
        outlook,
        sourceCurrent,
        completeHistory: assessment.flags.coreBaseballEvidenceComplete,
        identityBridgeValid: true,
        manualIdentityReviewed,
      },
      master,
      globalTopOneTtmFloorUsd:
        input.legacyCatalog.globalTopOneTtmFloorUsd,
    })
    const stage = baseballStage(candidate)
    const confidence = forecast.confidenceScore === null
      ? 0
      : clamp(forecast.confidenceScore * 100, 0, 100)
    const primaryPosition = candidate.position ??
      (candidate.playerType === 'Pitcher' ? 'P' : 'UTIL')
    const marketSignal = master.assessment.marketSignal
    return [{
      recordVersion: BINDER_GRADUATION_V2_RECORD_VERSION,
      player: {
        id: `baseball:${candidate.source}:${candidate.id}`,
        name: candidate.name,
        normalizedName,
        sport: 'baseball',
        age: candidate.age,
        positions: [primaryPosition],
        primaryPosition,
        team: candidate.organization,
        developmentStage: stage,
      },
      graduation,
      playerSignal: {
        score: outlook,
        outlook,
        marketDurability:
          assessment.components.collectorDemand.components
            .durabilityResilience.effectiveValue,
        evidenceYears: baseballEvidenceYears(candidate),
        evidenceStage: stage,
        inputIntegrity: round(confidence),
        basis: 'career_index_route_outcome',
        modelLabel: 'Career Index + route outcome',
        ageTreatment: 'development_runway_embedded_in_outlook',
      },
      market: {
        masterRank: master.masterRank,
        masterScore: marketSignal.score,
        boardPosture: master.assessment.posture,
        buildRoute: master.assessment.buildQualification.route,
        ttmSalesUsd: marketSignal.latestTwelveMonthSalesUsd,
        currentRunRateUsd:
          marketSignal.annualizedCurrentSixMonthSalesUsd,
        globalObservedPercentile:
          marketSignal.globalObservedPercentile,
        durability: marketSignal.durabilityScore,
        persistence: marketSignal.components.persistence,
        shockResistance: marketSignal.components.shockResistance,
        downsideProtection: marketSignal.downsideProtectionScore,
      },
      identity: {
        status: manualIdentityReviewed
          ? 'verified_external_id'
          : 'unique_normalized_name',
        manualReviewStatus: manualIdentityReviewed
          ? 'approved'
          : 'unreviewed',
        provider: 'career_oracle',
        providerPlayerId: candidate.mlbamId,
        gemRateSourceKey: master.subject.id,
      },
      sources: sources.map((source) => ({ ...source })),
    }]
  })
}

export function buildBinderGraduationV2Catalog(
  baseballUniverse: BaseballGraduationUniverse,
  now = new Date(),
  legacyCatalog = buildBinderGraduationCatalog(now),
): BinderGraduationV2Catalog {
  const baseballModelFreshness = binderBaseballModelFreshness(
    baseballUniverse.modelDataAsOf,
    now,
  )
  const sourceFreshness: BinderGraduationV2Catalog['sourceFreshness'] = {
    football: {
      status: legacyCatalog.playerCatalog.freshnessBySport.football.status,
      reasonCodes: [
        ...legacyCatalog.playerCatalog.freshnessBySport.football.reasonCodes,
      ],
    },
    basketball: {
      status: legacyCatalog.playerCatalog.freshnessBySport.basketball.status,
      reasonCodes: [
        ...legacyCatalog.playerCatalog.freshnessBySport.basketball.reasonCodes,
      ],
    },
    baseball: {
      status: baseballModelFreshness.status,
      reasonCodes: [...(baseballModelFreshness.reasonCodes ?? [])],
    },
  }
  const items = withBinderGraduationV2Rank([
    ...legacyCatalog.items.map(legacyItemToV2),
    ...baseballItems({
      universe: baseballUniverse,
      legacyCatalog,
      freshness: sourceFreshness.baseball,
      now,
    }),
  ])
  const snapshotId = `backstop-binder-index/v2:${
    createHash('sha256').update(JSON.stringify({
      modelVersion: BINDER_GRADUATION_V2_MODEL_VERSION,
      legacySnapshot: legacyCatalog.snapshotId,
      baseballSnapshot: baseballUniverse.snapshotId,
      masterSnapshot: legacyCatalog.masterCatalog.snapshotId,
      globalTopOneTtmFloorUsd:
        legacyCatalog.globalTopOneTtmFloorUsd,
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
    legacyCatalog,
    baseballUniverse,
    items,
    sourceFreshness,
    globalTopOneTtmFloorUsd:
      legacyCatalog.globalTopOneTtmFloorUsd,
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
): (
  left: BinderGraduationV2Item,
  right: BinderGraduationV2Item,
) => number {
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
          (right.graduation.index ?? -1) -
          (left.graduation.index ?? -1)
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
  items: readonly BinderGraduationV2Item[],
): BinderGraduationV2Response['summary'] {
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
  catalog: BinderGraduationV2Catalog,
  sport: BinderGraduationSport | 'all',
): BinderGraduationV2Response['snapshot']['freshness'] {
  const sports = sport === 'all'
    ? BINDER_GRADUATION_SPORTS
    : [sport]
  const states = sports.map(
    (selectedSport) => catalog.sourceFreshness[selectedSport],
  )
  const master = catalog.legacyCatalog.masterCatalog.freshness
  const status =
    master.status === 'stale' ||
    states.some((state) => state.status === 'stale')
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

export function buildBinderGraduationV2Feed(
  catalog: BinderGraduationV2Catalog,
  query: BinderGraduationV2Query = {},
): BinderGraduationV2Response {
  const sport = query.sport ?? 'all'
  const normalizedQuery =
    query.q?.trim().toLocaleLowerCase('en-US') ?? ''
  const position =
    query.position?.trim().toLocaleUpperCase('en-US') || null
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
  const masterCatalog = catalog.legacyCatalog.masterCatalog
  const generatedAt = [
    catalog.legacyCatalog.playerCatalog.snapshotGeneratedAt,
    catalog.legacyCatalog.playerCatalog.snapshotAcquiredAt,
    catalog.baseballUniverse.previewGeneratedAt,
    catalog.baseballUniverse.directoryDataAsOf ?? '',
    masterCatalog.snapshot.acquiredAt,
  ].filter(Boolean).toSorted().at(-1)!
  const targetBuildCount = masterCatalog.items.filter(
    (item) => item.assessment.buildQualification.eligible,
  ).length
  const coverageBySport = Object.fromEntries(
    BINDER_GRADUATION_SPORTS.map((selectedSport) => [
      selectedSport,
      catalog.items.filter(
        (item) => item.player.sport === selectedSport,
      ).length,
    ]),
  ) as Record<BinderGraduationSport, number>

  return {
    schemaVersion: BINDER_GRADUATION_V2_SCHEMA_VERSION,
    contractVersion: BINDER_GRADUATION_V2_CONTRACT_VERSION,
    modelVersion: BINDER_GRADUATION_V2_MODEL_VERSION,
    snapshot: {
      id: catalog.snapshotId,
      generatedAt,
      dataThrough: masterCatalog.snapshot.dataThrough,
      historyStart: `${masterCatalog.snapshot.historyMonths[0]}-01`,
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
        'age_is_a_filter_football_basketball_dynasty_outlook_prices_runway_baseball_outlook_embeds_development_runway',
      playerModelPolicy:
        'sport_specific_player_outlook_models_share_one_absolute_master_build_market_target',
      targetBoard: 'hobby-oracle-master-ranking.v2',
      targetBuildCount,
      rankingUniverseCount:
        catalog.items.filter(
          (item) => item.graduation.status === 'ranked',
        ).length,
      globalTopOneTtmFloorUsd: catalog.globalTopOneTtmFloorUsd,
      sports: BINDER_GRADUATION_SPORTS,
      coverageBySport,
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
          '60% weak link plus 40% geometric mean of sport-specific player outlook and market-path readiness',
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

export const binderGraduationV2SortKeys =
  BINDER_GRADUATION_SORT_KEYS
export const binderGraduationV2Bands = BINDER_GRADUATION_BANDS
export const binderGraduationV2Sports = [
  'all',
  ...BINDER_GRADUATION_SPORTS,
] as const
