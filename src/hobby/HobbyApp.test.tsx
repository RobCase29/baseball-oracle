// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import {
  buildHobbyMasterAssessment,
  type HobbyMasterFeedItem,
  type HobbyMasterFeedResponse,
  type MagnificentXDomain,
  type MagnificentXSubjectType,
} from '../domain/hobbyMasterRanking'
import {
  buildBinderScore,
  type BinderRoute,
  type BinderScoreFeedItem,
  type BinderScoresResponse,
} from '../domain/binderScore'
import type {
  BinderGraduationBand,
} from '../domain/binderGraduationIndex'
import type {
  BinderGraduationSport,
  BinderGraduationV2Item,
  BinderGraduationV2Response,
} from '../domain/binderGraduationIndexV2'
import { HobbyApp } from './HobbyApp'

beforeEach(() => {
  window.history.replaceState({}, '', '/hobby')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const months = [
  500_000, 540_000, 520_000, 560_000, 610_000, 620_000,
  650_000, 680_000, 700_000, 720_000, 740_000, 760_000,
  800_000, 830_000, 850_000, 880_000, 900_000, 920_000,
]
const masterMonths = Array(18).fill(2_000_000) as number[]

function feedItem(input: {
  id: string
  name: string
  type: MagnificentXSubjectType
  domain: MagnificentXDomain
  rank: number
  cohortSize: number
  percentile: number
  freshnessStatus?: 'current' | 'stale'
}): HobbyMasterFeedItem {
  const assessment = buildHobbyMasterAssessment({
    row: {
      subjectType: input.type,
      domain: input.domain,
      taxonomyStatus: 'coherent_provider_cohort',
      sourceCategory: input.domain,
      subjectName: input.name,
      normalizedName: input.name.toLocaleLowerCase('en-US'),
      sourceKey: input.id,
      monthlySalesUsd: masterMonths,
      firstGradedYear: input.type === 'athlete' ? 2003 : null,
      mostGradedYear: input.type === 'athlete' ? 2024 : null,
    },
    cohortSize: input.cohortSize,
    withinCohortPercentile: input.percentile,
    globalObservedPercentile: input.percentile,
    identityStatus: 'source_name_only',
    freshnessStatus: input.freshnessStatus ?? 'current',
  })
  return {
    recordVersion: 'hobby-oracle-master-ranking-item/v2',
    subject: {
      id: input.id,
      type: input.type,
      domain: input.domain,
      sourceCategory: input.domain,
      name: input.name,
      identityStatus: 'source_name_only',
      firstGradedYear: input.type === 'athlete' ? 2003 : null,
      mostGradedYear: input.type === 'athlete' ? 2024 : null,
    },
    masterRank: input.rank,
    withinCohortRank: 1,
    assessment,
  }
}

function fixtureResponse(
  freshnessStatus: 'current' | 'stale' = 'current',
): HobbyMasterFeedResponse {
  return {
    schemaVersion: 'hobby-oracle-master-ranking.v2',
    contractVersion: 'hobby-oracle-master-ranking-contract/v2',
    snapshot: {
      id: `hobby-oracle-master-ranking/v2:${'a'.repeat(64)}`,
      historyStart: '2025-01-01',
      historyMonths: 18,
      dataThrough: '2026-06-30',
      publishedAt: '2026-07-12T00:00:00.000Z',
      acquiredAt: '2026-07-24T18:00:00.000Z',
      freshness: {
        status: freshnessStatus,
        cadence: 'monthly',
        nextExpectedBy: '2026-08-20T00:00:00.000Z',
        reasonCodes: freshnessStatus === 'current'
          ? []
          : ['monthly_snapshot_overdue'],
      },
    },
    items: [
      feedItem({
        id: 'pokemon:pikachu',
        name: 'Pikachu',
        type: 'pokemon_character',
        domain: 'pokemon',
        rank: 2,
        cohortSize: 1_022,
        percentile: 99.9,
        freshnessStatus,
      }),
      feedItem({
        id: 'athlete:michael-jordan',
        name: 'Michael Jordan',
        type: 'athlete',
        domain: 'basketball',
        rank: 1,
        cohortSize: 839,
        percentile: 100,
        freshnessStatus,
      }),
    ],
    cohorts: [
      {
        domain: 'pokemon',
        taxonomyStatus: 'coherent_provider_cohort',
        subjectCount: 1_022,
        rankedCount: 1_022,
        buildCount: 1,
      },
      {
        domain: 'basketball',
        taxonomyStatus: 'coherent_provider_cohort',
        subjectCount: 839,
        rankedCount: 839,
        buildCount: 1,
      },
    ],
    page: {
      page: 1,
      limit: 50,
      total: 2,
      totalPages: 1,
    },
    meta: {
      researchOnly: true,
      investmentAdvice: false,
      rankingPolicy:
        'single_observed_universe_absolute_demand_and_durability_order',
      rankingUniverse: 'coherent_unambiguous_gemrate_subject_rows',
      rankingUniverseCount: 5_866,
      buildCount: 2,
      marketSource: 'GemRate Athlete + Pokémon Sales Trends',
      marketMeasure: 'completed_ebay_singles_sales_volume_usd',
      exactCardRecommendationsAvailable: false,
      globalComparisonStatus:
        'observed_snapshot_comparable_not_canonical_hobby_census',
      globalComparisonLimitations: [
        'provider_export_may_be_capped',
        'source_name_identity_is_not_canonical_subject_identity',
      ],
      buildPolicy: {
        fixedDollarAnchors: true,
        establishedTtmFloorUsd: 20_000_000,
        establishedRunRateFloorUsd: 15_000_000,
        escapeTtmFloorUsd: 15_000_000,
        escapeRunRateFloorUsd: 20_000_000,
        positiveMomentumAddsScore: false,
      },
      permissionAttestation: 'docs/permissions/GEMRATE_ATTESTATION.md',
    },
  }
}

function youngPlayer(input: {
  id: string
  name: string
  age: number
  stage: BinderRoute
  careerIndex: number
  demandPercentile: number
}): BinderScoreFeedItem {
  const assessment = buildBinderScore({
    player: {
      id: input.id,
      name: input.name,
      age: input.age,
      route: input.stage,
    },
    baseball: {
      careerIndex: input.careerIndex,
      routeOutcomePercentile: input.careerIndex - 3,
      freshness: {
        status: 'current',
        dataAsOf: '2025-12-31T00:00:00.000Z',
      },
    },
    market: {
      sourcePlayerName: input.name,
      identityStatus: 'unique_normalized_name',
      trailingTwelveMonthDemandPercentile: input.demandPercentile,
      monthlySalesUsd: months.slice(-12),
      freshness: {
        status: 'current',
        dataAsOf: '2026-06-30T23:59:59.999Z',
      },
      cohortId: 'gemrate-baseball',
    },
  })
  return {
    recordVersion: 'binder-score-item/v1',
    player: {
      id: input.id,
      name: input.name,
      mlbamId: input.id,
      age: input.age,
      stage: input.stage,
      playerType: 'Hitter',
      organization: 'Example Club',
      organizationCode: 'EX',
      position: 'SS',
      level: input.stage === 'pre_debut' ? 'AAA' : 'MLB',
    },
    assessment,
  }
}

function youngFixtureResponse(): BinderScoresResponse {
  return {
    schemaVersion: 'binder-scores.v1',
    contractVersion: 'binder-score-contract/v1',
    snapshot: {
      id: `binder-score-snapshot/v1:${'b'.repeat(64)}`,
      baseballDataAsOf: '2025-12-31T00:00:00.000Z',
      baseballFreshness: {
        status: 'current',
        reasonCodes: [],
        cadence: 'completed_season',
      },
      marketDataThrough: '2026-06-30',
      marketPublishedAt: '2026-07-12T00:00:00.000Z',
      marketAcquiredAt: '2026-07-24T18:00:00.000Z',
      marketFreshness: {
        status: 'current',
        reasonCodes: [],
        nextExpectedBy: '2026-08-20T00:00:00.000Z',
        cadence: 'monthly',
      },
    },
    items: [
      youngPlayer({
        id: '805790',
        name: 'Jackson Holliday',
        age: 22,
        stage: 'pre_debut',
        careerIndex: 92,
        demandPercentile: 95,
      }),
      youngPlayer({
        id: '694973',
        name: 'Paul Skenes',
        age: 24,
        stage: 'early_mlb',
        careerIndex: 88,
        demandPercentile: 97,
      }),
    ],
    page: {
      page: 1,
      limit: 50,
      total: 42,
      totalPages: 1,
    },
    meta: {
      researchOnly: true,
      investmentAdvice: false,
      marketSource: 'GemRate Athlete Sales Trends',
      marketMeasure: 'completed_ebay_singles_sales_volume_usd',
      marketMeaning:
        'collector_demand_is_an_ebay_singles_sales_volume_proxy_not_price_appreciation',
      careerMeaning:
        'career_evidence_is_statistical_hall_caliber_trajectory_not_hof_election_odds',
      identityPolicy:
        'exact_oracle_identity_plus_unique_normalized_gemrate_name_no_fuzzy_matching',
      nullPolicy: 'missing_evidence_shrinks_to_prior_and_withholds_action',
      rankingScope: 'cross_stage_research_heuristic',
      sourceRows: 2_060,
      ambiguousSourceKeys: 4,
      matchedUniversePlayers: 517,
      actionableUniversePlayers: 6,
      permissionAttestation: 'docs/permissions/GEMRATE_ATTESTATION.md',
    },
  }
}

function graduationItem(input: {
  id: string
  name: string
  sport: BinderGraduationSport
  age: number
  position: string
  team: string
  globalRank: number
  index: number
  band: Exclude<BinderGraduationBand, 'graduated' | 'withheld'>
  outlook: number
  marketReadiness: number
  ttmSalesUsd: number
  currentRunRateUsd: number
}): BinderGraduationV2Item {
  const football = input.sport === 'football'
  const baseball = input.sport === 'baseball'
  const provider = baseball
    ? 'career_oracle'
    : football
      ? 'keeptradecut'
      : 'hashtag_basketball'
  return {
    recordVersion: 'backstop-binder-graduation-item/v2',
    player: {
      id: input.id,
      name: input.name,
      normalizedName: input.name.toLocaleLowerCase('en-US'),
      sport: input.sport,
      age: input.age,
      positions: [input.position],
      primaryPosition: input.position,
      team: input.team,
      developmentStage: baseball ? 'rookie' : 'established',
    },
    graduation: {
      status: 'ranked',
      index: input.index,
      globalRank: input.globalRank,
      band: input.band,
      horizonMonths: 24,
      probability: null,
      probabilityStatus: 'withheld_no_longitudinal_build_transitions',
      target: {
        designation: 'Master Build',
        schemaVersion: 'hobby-oracle-master-ranking.v2',
        contractVersion: 'hobby-oracle-master-ranking-contract/v2',
        persistenceRule:
          'enter_build_and_remain_build_in_two_of_three_monthly_snapshots',
      },
      projectedRoute: 'durable_scale',
      primaryBlocker: 'ttm_scale',
      marketPathReadiness: input.marketReadiness,
      trajectorySupport: input.outlook,
      trajectory: 'rising',
      routeReadiness: {
        established: input.marketReadiness,
        escapeVelocity: input.marketReadiness - 4,
        commonGates: input.marketReadiness - 2,
      },
      distance: {
        ttmSalesUsd: Math.max(0, 20_000_000 - input.ttmSalesUsd),
        currentRunRateUsd:
          Math.max(0, 15_000_000 - input.currentRunRateUsd),
        masterScorePoints: 8,
        globalTopOneTtmUsd: 2_000_000,
        persistencePoints: 3,
        shockResistancePoints: 2,
        downsideProtectionPoints: 4,
        sixMonthGrowthMultiple: 0,
        threeMonthGrowthMultiple: 0,
      },
      evidence: {
        grade: 'A',
        sourceCurrent: true,
        completeHistory: true,
        identityBridgeValid: true,
        manualIdentityReviewed: true,
      },
      buildGateProgress: {
        passed: 8,
        required: 11,
        reasonCodes: [
          'below_observed_global_top_one_percent',
          'neither_absolute_build_route_cleared',
        ],
      },
    },
    playerSignal: {
      score: input.index,
      outlook: input.outlook,
      marketDurability: input.marketReadiness,
      evidenceYears: football ? 3 : 4,
      evidenceStage: baseball ? 'rookie' : 'established',
      inputIntegrity: 72,
      basis: baseball
        ? 'career_index_route_outcome'
        : 'dynasty_market_consensus',
      modelLabel: baseball
        ? 'Career Index + route outcome'
        : football
          ? 'KeepTradeCut dynasty outlook'
          : 'Hashtag Basketball dynasty outlook',
      ageTreatment: baseball
        ? 'development_runway_embedded_in_outlook'
        : 'filter_only',
    },
    market: {
      masterRank: input.globalRank + 30,
      masterScore: 67,
      boardPosture: 'watch',
      buildRoute: null,
      ttmSalesUsd: input.ttmSalesUsd,
      currentRunRateUsd: input.currentRunRateUsd,
      globalObservedPercentile: 98.7,
      durability: 86,
      persistence: 87,
      shockResistance: 88,
      downsideProtection: 86,
    },
    identity: {
      status: 'reviewed_exact',
      manualReviewStatus: 'approved',
      provider,
      providerPlayerId: `${provider}:${input.id}`,
      gemRateSourceKey: `athlete:${input.id}`,
    },
    sources: [
      {
        id: 'gemrate',
        label: 'GemRate',
        url: 'https://www.gemrate.com/sales-trends',
        asOf: '2026-06-30T00:00:00.000Z',
        fetchedAt: '2026-07-24T18:00:00.000Z',
        freshness: 'current',
        permissionBasis: 'documented permission',
        measure: 'completed eBay singles sales volume',
      },
      baseball
        ? {
            id: 'career_oracle',
            label: 'Career Oracle',
            url: 'https://baseball-oracle.vercel.app/api/players?view=map',
            asOf: '2026-07-12T18:36:27.386Z',
            fetchedAt: '2026-07-12T18:36:27.386Z',
            freshness: 'current',
            permissionBasis: 'first_party_research_model',
            measure: 'Career Index + route outcome',
          }
        : football
        ? {
            id: 'keeptradecut',
            label: 'KeepTradeCut',
            url: 'https://keeptradecut.com/dynasty-rankings?format=2&page=0',
            asOf: '2026-07-23T00:00:00.000Z',
            fetchedAt: '2026-07-24T18:00:00.000Z',
            freshness: 'current',
            permissionBasis: 'public research input',
            measure: 'dynasty player outlook',
          }
        : {
            id: 'hashtag_basketball',
            label: 'Hashtag Basketball',
            url: 'https://hashtagbasketball.com/fantasy-basketball-dynasty-rankings',
            asOf: '2026-07-23T00:00:00.000Z',
            fetchedAt: '2026-07-24T18:00:00.000Z',
            freshness: 'current',
            permissionBasis: 'public research input',
            measure: 'dynasty player outlook',
          },
    ],
  }
}

function graduationFixtureResponse(
  sport: BinderGraduationSport | 'all' = 'all',
  freshnessStatus: 'current' | 'stale' = 'current',
): BinderGraduationV2Response {
  const allItems = [
    graduationItem({
      id: 'football:cj-stroud',
      name: 'C.J. Stroud',
      sport: 'football',
      age: 24,
      position: 'QB',
      team: 'HOU',
      globalRank: 4,
      index: 88.4,
      band: 'on_deck',
      outlook: 92,
      marketReadiness: 86,
      ttmSalesUsd: 8_100_000,
      currentRunRateUsd: 10_200_000,
    }),
    graduationItem({
      id: 'baseball:paul-skenes',
      name: 'Paul Skenes',
      sport: 'baseball',
      age: 24,
      position: 'P',
      team: 'PIT',
      globalRank: 8,
      index: 84.1,
      band: 'approaching',
      outlook: 82.3,
      marketReadiness: 91.6,
      ttmSalesUsd: 15_052_641,
      currentRunRateUsd: 18_300_000,
    }),
    graduationItem({
      id: 'basketball:victor-wembanyama',
      name: 'Victor Wembanyama',
      sport: 'basketball',
      age: 22,
      position: 'C',
      team: 'SAS',
      globalRank: 7,
      index: 76.3,
      band: 'approaching',
      outlook: 96,
      marketReadiness: 71,
      ttmSalesUsd: 6_500_000,
      currentRunRateUsd: 8_400_000,
    }),
  ]
  const selectedItems = allItems.filter(
    (item) => sport === 'all' || item.player.sport === sport,
  )
  const items = freshnessStatus === 'current' ? selectedItems : []
  return {
    schemaVersion: 'backstop-binder-index.v2',
    contractVersion: 'backstop-binder-index-contract/v2',
    modelVersion: 'binder-graduation-readiness/master-build-v2.1.0',
    snapshot: {
      id: `backstop-binder-index/v2:${'c'.repeat(64)}`,
      generatedAt: '2026-07-24T19:30:00.000Z',
      dataThrough: '2026-06-30',
      historyStart: '2025-01-01',
      historyMonths: 18,
      freshness: {
        status: freshnessStatus,
        reasonCodes: freshnessStatus === 'current'
          ? []
          : ['football_ranking_publication_suspended'],
      },
    },
    items,
    scope: {
      sport,
      maxAge: 26,
      position: null,
      band: 'all',
    },
    summary: {
      rankedCount: items.length,
      graduatedCount: 0,
      onDeckCount: items.filter(
        (item) => item.graduation.band === 'on_deck',
      ).length,
      approachingCount: items.filter(
        (item) => item.graduation.band === 'approaching',
      ).length,
      developingCount: 0,
      longRangeCount: 0,
      withheldCount: 0,
    },
    page: {
      page: 1,
      limit: 50,
      total: items.length,
      totalPages: items.length === 0 ? 0 : 1,
    },
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
      targetBuildCount: 23,
      rankingUniverseCount: 569,
      globalTopOneTtmFloorUsd: 8_177_000,
      sports: ['baseball', 'football', 'basketball'],
      coverageBySport: {
        baseball: 1,
        football: 1,
        basketball: 1,
      },
      formula: {
        establishedRoute: 'Established route proximity.',
        escapeVelocityRoute: 'Escape route proximity.',
        commonGates: 'Common gate proximity.',
        marketPathReadiness: 'Market path readiness formula.',
        graduationIndex: 'Weak-link Graduation Index formula.',
      },
      calibrationPlan: {
        targetHorizonMonths: 24,
        durableGraduationDefinition:
          'enter_build_and_remain_build_in_two_of_three_monthly_snapshots',
        minimumObservedTransitionsBeforeProbability: 100,
        currentObservedTransitions: 0,
      },
    },
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function routedFixtureFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input)
  if (url.includes('/api/v2/backstop-binder-index')) {
    const sport = new URL(url, 'https://binder.test').searchParams.get('sport')
    const selectedSport =
      sport === 'baseball' ||
      sport === 'football' ||
      sport === 'basketball'
        ? sport
        : 'all'
    return Promise.resolve(jsonResponse(
      graduationFixtureResponse(selectedSport),
    ))
  }
  if (url.includes('/api/v1/binder-scores')) {
    return Promise.resolve(jsonResponse(youngFixtureResponse()))
  }
  return Promise.resolve(jsonResponse(fixtureResponse()))
}

describe('Backstop Binder Index', () => {
  it('renders the Build Board with the new brand and decision hierarchy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(fixtureResponse())),
    )

    render(<HobbyApp />)

    expect(
      screen.getByRole('heading', { name: 'The Build Board' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Backstop Binder Index' }),
    ).toHaveAttribute('href', '/hobby')
    expect(screen.getByText('Subject-level research only.'))
      .toBeInTheDocument()

    const table = await screen.findByRole('table', {
      name: 'Long-term collection research table',
    })
    const pikachu = within(table).getByText('Pikachu')
    const row = pikachu.closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('Build')).toBeInTheDocument()
    expect(within(row!).getByText('#2')).toBeInTheDocument()
    expect(within(row!).getByText('Cohort #1')).toBeInTheDocument()
    expect(screen.getByText('Exact-card action withheld')).toBeInTheDocument()
    expect(screen.getByText(/One master order/u)).toBeInTheDocument()

    fireEvent.click(
      within(row!).getByRole('button', {
        name: 'Show research detail for Pikachu',
      }),
    )
    expect(screen.getByText(/Character demand only/u)).toBeInTheDocument()
    expect(screen.getByText(/Exact card, grade, scarcity/u)).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Board rank/u }))
      .toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Binder Index/u }))
      .toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /TTM demand/u }))
      .toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'GemRate Pokémon' }),
    ).toHaveAttribute(
      'href',
      'https://www.gemrate.com/sales-trends-pokemon',
    )
  })

  it('persists and resets Build Board controls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtureResponse()))
    vi.stubGlobal('fetch', fetchMock)
    render(<HobbyApp />)

    const table = await screen.findByRole('table', {
      name: 'Long-term collection research table',
    })
    expect(within(table).getByText('Pikachu')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Near-Build candidates' }),
    )
    fireEvent.change(screen.getByLabelText('Cohort'), {
      target: { value: 'pokemon' },
    })
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search every subject' }),
      {
      target: { value: 'Pikachu' },
      },
    )
    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'ttm_sales' },
    })

    await waitFor(() => {
      const latestUrl = String(fetchMock.mock.calls.at(-1)?.[0])
      expect(latestUrl).toContain('/api/v2/hobby-oracle?')
      expect(latestUrl).not.toContain('domain=')
      expect(latestUrl).toContain('posture=all')
      expect(latestUrl).toContain('q=Pikachu')
      expect(latestUrl).toContain('sort=ttm_sales')
      expect(latestUrl).toContain('direction=desc')
      expect(latestUrl).toContain('page=1')
      expect(latestUrl).toContain('limit=50')
    })
    expect(window.location.search).toContain('posture=all')
    expect(window.location.search).toContain('sort=ttm_sales')
    expect(screen.getByLabelText('Cohort')).toHaveValue('all')
    expect(
      screen.getByRole('button', { name: 'All evidence' }),
    ).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByLabelText('Cohort')).toHaveValue('all')
    expect(
      screen.getByRole('button', { name: 'Build Board qualifiers' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('searchbox', { name: 'Search every subject' }),
    ).toHaveValue('')
    expect(screen.getByLabelText('Sort')).toHaveValue('master_rank')
    expect(screen.getByLabelText('Direction')).toHaveValue('asc')
  })

  it('suspends the Build Board when the market snapshot is stale', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      jsonResponse(fixtureResponse('stale')),
    ))
    vi.stubGlobal('fetch', fetchMock)

    render(<HobbyApp />)

    await waitFor(() => {
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
        'posture=needs_refresh',
      )
    })
    expect(
      await screen.findByText('Build Board suspended · refresh queue shown'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Needs refresh').length).toBeGreaterThan(0)
  })

  it('shows one global Graduation rank and persists age, band, and sort', async () => {
    const fetchMock = vi.fn(routedFixtureFetch)
    vi.stubGlobal('fetch', fetchMock)
    render(<HobbyApp />)

    await screen.findByRole('table', {
      name: 'Long-term collection research table',
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: /Graduation Board\. Players projected to earn Build/u,
      }),
    )

    const table = await screen.findByRole('table', {
      name: 'baseball, football, and basketball Binder Graduation rankings',
    })
    const player = within(table).getByText('C.J. Stroud')
    const row = player.closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('#4')).toBeInTheDocument()
    expect(within(row!).getByText('24')).toBeInTheDocument()
    expect(within(row!).getByText('88.4')).toBeInTheDocument()
    expect(within(row!).getByText('On Deck')).toBeInTheDocument()
    expect(screen.getAllByText('C.J. Stroud')).toHaveLength(2)
    expect(within(table).getByRole('columnheader', { name: 'Grad rank' }))
      .toBeInTheDocument()
    expect(
      within(table).getByRole('columnheader', { name: 'Graduation Index' }),
    ).toBeInTheDocument()
    expect(
      within(table).getByRole('columnheader', { name: 'Market readiness' }),
    ).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Next gate' }))
      .toBeInTheDocument()
    expect(screen.getByText('Probability withheld')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Show the global baseball, football, and basketball graduation ranking',
      }),
    ).toHaveAttribute('aria-pressed', 'true')

    await waitFor(() => {
      const latestUrl = String(fetchMock.mock.calls.at(-1)?.[0])
      expect(latestUrl).toContain('/api/v2/backstop-binder-index?')
      expect(latestUrl).toContain('sport=all')
      expect(latestUrl).toContain('maxAge=26')
      expect(latestUrl).toContain('band=all')
      expect(latestUrl).toContain('sort=graduation_rank')
    })

    fireEvent.change(screen.getByLabelText('Age screen'), {
      target: { value: '23' },
    })
    fireEvent.change(screen.getByLabelText('Position'), {
      target: { value: 'QB' },
    })
    fireEvent.change(screen.getByLabelText('Path'), {
      target: { value: 'on_deck' },
    })
    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'market_readiness' },
    })
    fireEvent.change(
      screen.getByRole('searchbox', {
        name: 'Search every graduation candidate',
      }),
      { target: { value: 'Stroud' } },
    )

    await waitFor(() => {
      const latestUrl = String(fetchMock.mock.calls.at(-1)?.[0])
      expect(latestUrl).toContain('/api/v2/backstop-binder-index?')
      expect(latestUrl).toContain('sport=all')
      expect(latestUrl).not.toContain('maxAge=')
      expect(latestUrl).not.toContain('position=')
      expect(latestUrl).toContain('band=all')
      expect(latestUrl).toContain('sort=graduation_rank')
      expect(latestUrl).toContain('q=Stroud')
    })
    expect(window.location.search).toContain('lens=players')
    expect(window.location.search).toContain('sport=all')
    expect(window.location.search).not.toContain('maxAge=')
    expect(window.location.search).not.toContain('position=')
    expect(window.location.search).not.toContain('band=')
    expect(window.location.search).not.toContain('sort=')
  })

  it('keeps baseball in the global order and preserves its rank when filtered', async () => {
    const fetchMock = vi.fn(routedFixtureFetch)
    vi.stubGlobal('fetch', fetchMock)
    render(<HobbyApp />)

    await screen.findByRole('table', {
      name: 'Long-term collection research table',
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: /Graduation Board\. Players projected to earn Build/u,
      }),
    )
    const globalTable = await screen.findByRole('table', {
      name: 'baseball, football, and basketball Binder Graduation rankings',
    })
    const globalSkenesRow = within(globalTable)
      .getByText('Paul Skenes')
      .closest('tr')
    expect(globalSkenesRow).not.toBeNull()
    expect(within(globalSkenesRow!).getByText('#8')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show baseball graduation candidates',
      }),
    )

    const table = await screen.findByRole('table', {
      name: 'baseball Binder Graduation rankings',
    })
    const player = within(table).getByText('Paul Skenes')
    const row = player.closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('#8')).toBeInTheDocument()
    expect(within(row!).getByText('84.1')).toBeInTheDocument()
    expect(within(row!).getByText('Approaching')).toBeInTheDocument()
    expect(within(row!).getByText('runway modeled')).toBeInTheDocument()
    expect(
      screen.getByText(/one global baseball, football, and basketball pipeline/iu),
    ).toBeInTheDocument()
    expect(
      within(table).getByRole('columnheader', { name: 'Grad rank' }),
    ).toBeInTheDocument()

    await waitFor(() => {
      const latestUrl = String(fetchMock.mock.calls.at(-1)?.[0])
      expect(latestUrl).toContain('/api/v2/backstop-binder-index?')
      expect(latestUrl).toContain('sport=baseball')
      expect(latestUrl).toContain('maxAge=26')
      expect(latestUrl).toContain('sort=graduation_rank')
    })
    expect(window.location.search).toContain('lens=players')
    expect(window.location.search).toContain('sport=baseball')

    fireEvent.change(screen.getByLabelText('Age screen'), {
      target: { value: '23' },
    })
    await waitFor(() => {
      const latestUrl = String(fetchMock.mock.calls.at(-1)?.[0])
      expect(latestUrl).toContain('maxAge=23')
      expect(latestUrl).toContain('sport=baseball')
    })
  })

  it('restores a direct Graduation Board URL without reranking the screen', async () => {
    const fetchMock = vi.fn(routedFixtureFetch)
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState(
      {},
      '',
      '/hobby?lens=players&sport=football&maxAge=23&position=QB&band=approaching&sort=market_readiness&q=Stroud',
    )

    render(<HobbyApp />)

    const table = await screen.findByRole('table', {
      name: 'football Binder Graduation rankings',
    })
    const row = within(table).getByText('C.J. Stroud').closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('#4')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /Graduation Board\. Players projected to earn Build/u,
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', {
        name: 'Show football graduation candidates',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Age screen')).toHaveValue('23')
    expect(screen.getByLabelText('Position')).toHaveValue('QB')
    expect(screen.getByLabelText('Path')).toHaveValue('approaching')
    expect(screen.getByLabelText('Sort')).toHaveValue('market_readiness')
    expect(screen.getByRole('searchbox', {
      name: 'Search every graduation candidate',
    }))
      .toHaveValue('Stroud')

    await waitFor(() => {
      const initialUrl = String(fetchMock.mock.calls[0]?.[0])
      expect(initialUrl).toContain('/api/v2/backstop-binder-index?')
      expect(initialUrl).toContain('sport=football')
      expect(initialUrl).toContain('maxAge=23')
      expect(initialUrl).toContain('position=QB')
      expect(initialUrl).toContain('band=approaching')
      expect(initialUrl).toContain('sort=market_readiness')
      expect(initialUrl).toContain('q=Stroud')
    })
    expect(window.location.search).toContain('lens=players')
    expect(window.location.search).toContain('sport=football')
    expect(window.location.search).toContain('band=approaching')
  })

  it('fails closed when a Graduation Board source is stale', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(graduationFixtureResponse('all', 'stale')),
    )
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState({}, '', '/hobby?lens=players&sport=all')

    render(<HobbyApp />)

    expect(
      await screen.findByText('Graduation publication is suspended.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/every readiness rank is withheld/u))
      .toBeInTheDocument()
    expect(
      screen.queryByText(
        'Broaden the path, age, position, or search filters.',
      ),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('table', {
        name: 'baseball, football, and basketball Binder Graduation rankings',
      }),
    ).not.toBeInTheDocument()
  })

  it('clears Graduation rows after a failed filter request', async () => {
    const fetchMock = vi.fn(routedFixtureFetch)
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState({}, '', '/hobby?lens=players&sport=all')
    render(<HobbyApp />)

    const table = await screen.findByRole('table', {
      name: 'baseball, football, and basketball Binder Graduation rankings',
    })
    expect(within(table).getByText('C.J. Stroud')).toBeInTheDocument()

    fetchMock.mockRejectedValueOnce(new Error('Graduation filter failed.'))
    fireEvent.change(screen.getByLabelText('Path'), {
      target: { value: 'approaching' },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Graduation filter failed.',
    )
    expect(screen.queryAllByText('C.J. Stroud')).toHaveLength(0)
    expect(
      screen.queryByRole('table', {
        name: 'baseball, football, and basketball Binder Graduation rankings',
      }),
    ).not.toBeInTheDocument()
  })
})
