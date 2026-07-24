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
  buildMagnificentXAssessment,
  type MagnificentXDomain,
  type MagnificentXFeedItem,
  type MagnificentXFeedResponse,
  type MagnificentXSubjectType,
} from '../domain/magnificentX'
import {
  buildBinderScore,
  type BinderRoute,
  type BinderScoreFeedItem,
  type BinderScoresResponse,
} from '../domain/binderScore'
import type {
  HobbyPlayerRankingSport,
  HobbyPlayerRankingsResponse,
} from '../domain/hobbyPlayerRanking'
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

function feedItem(input: {
  id: string
  name: string
  type: MagnificentXSubjectType
  domain: MagnificentXDomain
  rank: number
  cohortSize: number
  percentile: number
  freshnessStatus?: 'current' | 'stale'
}): MagnificentXFeedItem {
  const assessment = buildMagnificentXAssessment({
    row: {
      subjectType: input.type,
      domain: input.domain,
      taxonomyStatus: 'coherent_provider_cohort',
      sourceCategory: input.domain,
      subjectName: input.name,
      normalizedName: input.name.toLocaleLowerCase('en-US'),
      sourceKey: input.id,
      monthlySalesUsd: months,
      firstGradedYear: input.type === 'athlete' ? 2003 : null,
      mostGradedYear: input.type === 'athlete' ? 2024 : null,
    },
    cohortSize: input.cohortSize,
    withinCohortPercentile: input.percentile,
    globalScalePercentile: null,
    identityStatus: 'source_name_only',
    freshnessStatus: input.freshnessStatus ?? 'current',
  })
  return {
    recordVersion: 'magnificent-x-feed-item/v1',
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
    withinCohortRank: input.rank,
    assessment,
  }
}

function fixtureResponse(
  freshnessStatus: 'current' | 'stale' = 'current',
): MagnificentXFeedResponse {
  return {
    schemaVersion: 'magnificent-x-feed.v1',
    contractVersion: 'magnificent-x-contract/v1',
    snapshot: {
      id: `magnificent-x-snapshot/v1:${'a'.repeat(64)}`,
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
        marketLeaderCount: 8,
        magnificentEligibleCount: 0,
      },
      {
        domain: 'basketball',
        taxonomyStatus: 'coherent_provider_cohort',
        subjectCount: 839,
        marketLeaderCount: 6,
        magnificentEligibleCount: 0,
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
      magnificentEligibleCount: 0,
      marketSource: 'GemRate Athlete + Pokémon Sales Trends',
      marketMeasure: 'completed_ebay_singles_sales_volume_usd',
      rawExportsPublished: false,
      globalRankingAvailable: false,
      globalRankingReason:
        'provider_export_cap_and_cross_subject_overlap_not_independently_verified',
      exactCardRecommendationsAvailable: false,
      ageIncluded: false,
      agePolicy:
        'age_requires_canonical_sport_identity_and_validated_domain_adapter_not_inferred_from_name',
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

function playerRankingFixtureResponse(
  sport: HobbyPlayerRankingSport,
): HobbyPlayerRankingsResponse {
  const football = sport === 'football'
  const name = football ? 'C.J. Stroud' : 'Victor Wembanyama'
  const provider = football ? 'keeptradecut' : 'hashtag_basketball'
  const providerSource = football
    ? {
        id: 'keeptradecut' as const,
        label: 'KeepTradeCut' as const,
        url: 'https://keeptradecut.com/dynasty-rankings?format=2&page=0',
      }
    : {
        id: 'hashtag_basketball' as const,
        label: 'Hashtag Basketball' as const,
        url: 'https://hashtagbasketball.com/fantasy-basketball-dynasty-rankings',
      }
  const monthlySalesUsd = [
    120_000, 126_000, 124_000, 130_000, 132_000, 138_000,
    140_000, 144_000, 148_000, 151_000, 155_000, 159_000,
    163_000, 166_000, 169_000, 172_000, 176_000, 181_000,
  ]
  return {
    schemaVersion: 'hobby-player-rankings.v1',
    contractVersion: 'hobby-player-rankings-contract/v1',
    modelVersion: 'hobby-player-durable-signal/18m-rules-v1.0.0',
    snapshot: {
      id: `hobby-player-rankings:${sport}:${'c'.repeat(64)}`,
      generatedAt: '2026-07-24T19:30:00.000Z',
      historyStart: '2025-01',
      historyMonths: 18,
      dataThrough: '2026-06',
      publishedAt: '2026-07-12T00:00:00.000Z',
      acquiredAt: '2026-07-24T18:00:00.000Z',
      freshness: {
        status: 'current',
        marketStatus: 'current',
        fundamentalsStatus: 'current',
        nextExpectedBy: '2026-08-20T00:00:00.000Z',
        reasonCodes: [],
      },
    },
    items: [
      {
        recordVersion: 'hobby-player-ranking-item/v1',
        id: `${sport}:${name.toLocaleLowerCase().replaceAll(/[^a-z]/gu, '')}`,
        name,
        normalizedName: name.toLocaleLowerCase().replaceAll(/[^a-z]/gu, ''),
        sport,
        age: football ? 24 : 22,
        positions: football ? ['QB'] : ['C', 'PF'],
        primaryPosition: football ? 'QB' : 'C',
        team: football ? 'HOU' : 'SAS',
        sportRank: 4,
        screenRank: 1,
        sportPercentile: 99.1,
        score: 88.4,
        posture: 'Build',
        confidence: {
          score: 82,
          band: 'moderate',
          meaning: 'evidence_quality_not_statistical_confidence_interval',
          reasonCodes: [],
        },
        components: {
          outlook: 92,
          marketDurability: 86,
          volumePercentile: 91,
          resilience: 79,
          trendContext: 58,
          hypePenalty: 1.8,
        },
        diagnostics: {
          monthlySalesUsd,
          trailingTwelveSalesUsd: 1_984_000,
          currentSixMonthSalesUsd: 1_027_000,
          priorSixMonthSalesUsd: 917_000,
          recentThreeMonthSalesUsd: 529_000,
          priorThreeMonthSalesUsd: 498_000,
          positiveMonthRatio: 1,
          observedHistoryRatio: 1,
          lowerQuartileToMedianRatio: 0.83,
          attentionGap: 0,
          accelerationLog: 0.06,
          accelerationContext: 56,
          providerPercentiles: football
            ? {
                oneQb: 96,
                superflex: 94,
                fiveSeason: null,
                keeper: null,
              }
            : {
                oneQb: null,
                superflex: null,
                fiveSeason: 98,
                keeper: 96,
              },
        },
        identity: {
          status: 'unique_exact',
          manualReviewStatus: 'approved',
          provider,
          providerPlayerId: `${provider}:${name}`,
          gemRateSourceKey: `gemrate:${name}`,
        },
        gates: {
          buildEligible: true,
          passed: 12,
          required: 12,
          checks: {
            scoreAtLeast82: true,
            outlookAtLeast80: true,
            marketDurabilityAtLeast75: true,
            volumePercentileAtLeast65: true,
            resilienceAtLeast70: true,
            hypePenaltyBelow4: true,
            topFivePercent: true,
            sourcesCurrent: true,
            completeEighteenMonthHistory: true,
            uniqueExactIdentity: true,
            manualIdentityReviewed: true,
            sensitivityStableTopDecile: true,
          },
          reasonCodes: [],
        },
        sensitivity: {
          stableTopDecile: true,
          ranks: {
            outlookHeavy: 3,
            balanced: 4,
            marketHeavy: 5,
          },
          scores: {
            outlookHeavy: 89,
            balanced: 88.4,
            marketHeavy: 87.5,
          },
          scoreSpread: 1.5,
        },
        evidence: {
          marketHistoryMonths: 18,
          requiredMarketHistoryMonths: 18,
          rankWithinSportOnly: true,
          ageIncludedInScore: false,
          momentumCanOnlyPenalize: true,
          exactCardPricingAvailable: false,
          populationDataAvailable: false,
          expectedReturnValidated: false,
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
          {
            ...providerSource,
            asOf: '2026-07-23T00:00:00.000Z',
            fetchedAt: '2026-07-24T18:00:00.000Z',
            freshness: 'current',
            permissionBasis: 'public research input',
            measure: 'dynasty player outlook',
          },
        ],
        formulaVersion: 'hobby-player-durable-signal/18m-rules-v1.0.0',
      },
    ],
    cohorts: [
      {
        sport,
        rankedCount: football ? 302 : 267,
        buildCount: 7,
        holdCount: 28,
        watchCount: 96,
        deprioritizeCount: football ? 171 : 136,
      },
    ],
    page: {
      page: 1,
      limit: 50,
      total: football ? 302 : 267,
      totalPages: football ? 7 : 6,
    },
    meta: {
      researchOnly: true,
      investmentAdvice: false,
      expectedReturnClaim: false,
      rankingPolicy: 'within_sport_only',
      agePolicy: 'display_and_filter_only_not_scored',
      momentumPolicy: 'penalty_or_flag_only_never_positive_score_driver',
      marketMeasure: 'subject_level_completed_ebay_singles_sales_volume_usd',
      exactCardRecommendationsAvailable: false,
      populationDataAvailable: false,
      outcomeValidationStatus: 'not_yet_outcome_validated',
      methodology: {
        formulas: {
          outlookFootball: 'Football outlook formula.',
          outlookBasketball: 'Basketball outlook formula.',
          resilience: 'Resilience formula.',
          marketDurability: 'Market durability formula.',
          attentionGap: 'Attention gap formula.',
          hypePenalty: 'Hype penalty formula.',
          durableScore: 'Durable Growth formula.',
          sensitivity: 'Sensitivity formula.',
          age: 'Age is excluded from the score.',
        },
        buildGate: 'All twelve evidence gates must pass.',
      },
      quarantine: {
        total: 9,
        ambiguousProviderIdentity: 1,
        ambiguousMarketIdentity: 2,
        missingMarketMatch: 3,
        incompleteProviderRanks: 1,
        invalidAge: 2,
      },
      availableFilters: {
        sports: ['football', 'basketball'],
        postures: ['Build', 'Hold', 'Watch', 'Deprioritize'],
        sortKeys: [
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
        ],
        positionsBySport: {
          football: ['QB', 'RB', 'WR', 'TE'],
          basketball: ['PG', 'SG', 'SF', 'PF', 'C'],
        },
        ageRange: {
          minimum: 18,
          maximum: 42,
        },
      },
      provenance: [
        {
          id: 'gemrate',
          label: 'GemRate',
          url: 'https://www.gemrate.com/sales-trends',
          permissionBasis: 'documented permission',
          asOf: '2026-06-30T00:00:00.000Z',
          fetchedAt: '2026-07-24T18:00:00.000Z',
          semantics: 'subject-level completed sales volume',
        },
        {
          ...providerSource,
          permissionBasis: 'public research input',
          asOf: '2026-07-23T00:00:00.000Z',
          fetchedAt: '2026-07-24T18:00:00.000Z',
          semantics: 'dynasty player outlook',
        },
      ],
      permissionAttestation: 'docs/permissions/GEMRATE_ATTESTATION.md',
    },
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Hobby Oracle investor workbench', () => {
  it('renders a dense decision table and keeps exact-card action withheld', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(fixtureResponse())),
    )

    render(<HobbyApp />)

    expect(
      screen.getByRole('heading', { name: 'Investor Workbench' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Subject demand is the screen.'),
    ).toBeInTheDocument()

    const pikachu = await screen.findByText('Pikachu')
    const row = pikachu.closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('Build candidate')).toBeInTheDocument()
    expect(within(row!).getByText('#2')).toBeInTheDocument()
    expect(within(row!).getByText('99.9 pct')).toBeInTheDocument()
    expect(screen.getByText('Exact-card action withheld')).toBeInTheDocument()
    expect(
      screen.getByText(/Cross-hobby order is a screen only/u),
    ).toBeInTheDocument()

    fireEvent.click(
      within(row!).getByRole('button', {
        name: 'Show research detail for Pikachu',
      }),
    )
    expect(
      screen.getByText(/Character demand only/u),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Exact-card, grade, scarcity, and price evidence/u),
    ).toBeInTheDocument()

    expect(screen.getByRole('columnheader', { name: /TTM demand/u }))
      .toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /6M YoY/u }))
      .toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Baseball Oracle' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(screen.getByRole('link', { name: 'GemRate Pokémon' })).toHaveAttribute(
      'href',
      'https://www.gemrate.com/sales-trends-pokemon',
    )
  })

  it('persists posture, cohort, search, and full-universe sort controls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtureResponse()))
    vi.stubGlobal('fetch', fetchMock)
    render(<HobbyApp />)

    await screen.findByText('Pikachu')
    fireEvent.click(screen.getByRole('button', { name: 'Core Hold' }))
    fireEvent.change(screen.getByLabelText('Cohort'), {
      target: { value: 'pokemon' },
    })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Subject' }), {
      target: { value: 'Pikachu' },
    })
    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'ttm_sales' },
    })

    await waitFor(() => {
      const latestUrl = String(fetchMock.mock.calls.at(-1)?.[0])
      expect(latestUrl).toContain('/api/v1/hobby-oracle?')
      expect(latestUrl).toContain('domain=pokemon')
      expect(latestUrl).toContain('posture=hold_candidate')
      expect(latestUrl).toContain('q=Pikachu')
      expect(latestUrl).toContain('sort=ttm_sales')
      expect(latestUrl).toContain('direction=desc')
      expect(latestUrl).toContain('page=1')
      expect(latestUrl).toContain('limit=50')
    })
    expect(window.location.search).toContain('posture=hold_candidate')
    expect(window.location.search).toContain('sort=ttm_sales')

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByLabelText('Cohort')).toHaveValue('all')
    expect(screen.getByRole('button', { name: 'Build' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('searchbox', { name: 'Subject' })).toHaveValue('')
    expect(screen.getByLabelText('Sort')).toHaveValue('cohort_rank')
    expect(screen.getByLabelText('Direction')).toHaveValue('asc')
  })

  it('suspends the build screen when the market snapshot is stale', async () => {
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
      await screen.findByText('Build rank suspended · refresh queue shown'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Needs refresh')).toHaveLength(2)
  })

  it('re-ranks the verified young-player slice without promoting its Binder call', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      return Promise.resolve(
        jsonResponse(
          url.includes('/api/v1/binder-scores')
            ? youngFixtureResponse()
            : fixtureResponse(),
        ),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<HobbyApp />)

    await screen.findByText('Pikachu')
    fireEvent.click(screen.getByRole('button', { name: 'Player Rankings' }))

    const player = await screen.findByText('Jackson Holliday')
    const row = player.closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('#1')).toBeInTheDocument()
    expect(within(row!).getByText('of 42')).toBeInTheDocument()
    expect(within(row!).getByText('Action withheld')).toBeInTheDocument()
    expect(within(row!).getByText('Provisional')).toBeInTheDocument()
    expect(screen.getByText('Age is a lens—not a shortcut.')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Young player rank' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Player Rankings' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await waitFor(() => {
      const latestUrl = String(fetchMock.mock.calls.at(-1)?.[0])
      expect(latestUrl).toContain('/api/v1/binder-scores?')
      expect(latestUrl).toContain('maxAge=25')
      expect(latestUrl).toContain('stage=All')
      expect(latestUrl).toContain('rankedOnly=true')
      expect(latestUrl).toContain('sort=binderScore')
    })
    expect(window.location.search).toContain('lens=players')
    expect(window.location.search).toContain('sport=baseball')
    expect(window.location.search).toContain('maxAge=25')

    fireEvent.change(screen.getByLabelText('Age ceiling'), {
      target: { value: '23' },
    })
    fireEvent.change(screen.getByLabelText('Career stage'), {
      target: { value: 'Minors' },
    })
    await waitFor(() => {
      const latestUrl = String(fetchMock.mock.calls.at(-1)?.[0])
      expect(latestUrl).toContain('maxAge=23')
      expect(latestUrl).toContain('stage=Minors')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Positions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Core Hold' }))
    await screen.findByText('Pikachu')
    await waitFor(() => {
      const latestUrl = String(fetchMock.mock.calls.at(-1)?.[0])
      expect(latestUrl).toContain('/api/v1/hobby-oracle?')
      expect(latestUrl).toContain('posture=hold_candidate')
      expect(latestUrl).toContain('sort=name')
      expect(latestUrl).toContain('direction=asc')
    })
    expect(
      screen.queryByRole('columnheader', { name: 'Build rank' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('#2')).not.toBeInTheDocument()
  })

  it('ranks football players within sport and preserves the evidence boundary', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/hobby-player-rankings')) {
        const sport = new URL(url, 'https://oracle.test').searchParams.get('sport')
        return Promise.resolve(jsonResponse(
          playerRankingFixtureResponse(
            sport === 'basketball' ? 'basketball' : 'football',
          ),
        ))
      }
      if (url.includes('/api/v1/binder-scores')) {
        return Promise.resolve(jsonResponse(youngFixtureResponse()))
      }
      return Promise.resolve(jsonResponse(fixtureResponse()))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<HobbyApp />)

    await screen.findByText('Pikachu')
    fireEvent.click(screen.getByRole('button', { name: 'Player Rankings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Football' }))

    const player = await screen.findByText('C.J. Stroud')
    const row = player.closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('#4')).toBeInTheDocument()
    expect(within(row!).getByText('88.4')).toBeInTheDocument()
    expect(within(row!).getByText('Build candidate')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Build Score' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Build-candidate screen—not expected return.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Build candidates 7/u)).toBeInTheDocument()

    await waitFor(() => {
      const latestUrl = String(fetchMock.mock.calls.at(-1)?.[0])
      expect(latestUrl).toContain('/api/v1/hobby-player-rankings?')
      expect(latestUrl).toContain('sport=football')
      expect(latestUrl).toContain('posture=all')
      expect(latestUrl).toContain('sort=score')
    })
    expect(window.location.search).toContain('lens=players')
    expect(window.location.search).toContain('sport=football')

    fireEvent.click(
      within(row!).getByRole('button', {
        name: 'Show investor evidence for C.J. Stroud',
      }),
    )
    expect(
      screen.getByText(/not expected return, ROI/u),
    ).toBeInTheDocument()
    expect(screen.getByText('12 of 12 gates passed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'KeepTradeCut' })).toHaveAttribute(
      'href',
      'https://keeptradecut.com/dynasty-rankings?format=2&page=0',
    )

    fireEvent.change(screen.getByLabelText('Age screen'), {
      target: { value: '26' },
    })
    fireEvent.change(screen.getByLabelText('Position'), {
      target: { value: 'QB' },
    })
    fireEvent.change(screen.getByLabelText('Action'), {
      target: { value: 'Build' },
    })
    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'attention_gap' },
    })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Player' }), {
      target: { value: 'Stroud' },
    })

    await waitFor(() => {
      const latestUrl = String(fetchMock.mock.calls.at(-1)?.[0])
      expect(latestUrl).toContain('maxAge=26')
      expect(latestUrl).toContain('position=QB')
      expect(latestUrl).toContain('posture=Build')
      expect(latestUrl).toContain('sort=attention_gap')
      expect(latestUrl).toContain('q=Stroud')
    })
    const filteredRow = (await screen.findByText('C.J. Stroud')).closest('tr')
    expect(filteredRow).not.toBeNull()
    expect(within(filteredRow!).getByText('#1')).toBeInTheDocument()
    expect(within(filteredRow!).getByText('Sport #4')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Screen rank' }),
    ).toBeInTheDocument()
    expect(window.location.search).toContain('maxAge=26')

    fireEvent.click(screen.getByRole('button', { name: 'Basketball' }))
    expect(await screen.findByText('Victor Wembanyama')).toBeInTheDocument()
    await waitFor(() => {
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
        'sport=basketball',
      )
    })
    expect(window.location.search).toContain('sport=basketball')
    expect(screen.queryByText('Football Beta')).not.toBeInTheDocument()
  })

  it('opens direct and legacy player-ranking URLs without falling back to Positions', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/hobby-player-rankings')) {
        return Promise.resolve(jsonResponse(
          playerRankingFixtureResponse('football'),
        ))
      }
      return Promise.resolve(jsonResponse(fixtureResponse()))
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState(
      {},
      '',
      '/hobby?lens=young&sport=football',
    )

    render(<HobbyApp />)

    expect(await screen.findByText('C.J. Stroud')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Player Rankings' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(window.location.search).toContain('lens=players')
    expect(window.location.search).not.toContain('lens=young')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/v1/hobby-player-rankings?sport=football',
    )
  })

  it('explains a fail-closed source suspension instead of suggesting filters', async () => {
    const staleResponse = playerRankingFixtureResponse('football')
    staleResponse.snapshot.freshness = {
      status: 'stale',
      marketStatus: 'current',
      fundamentalsStatus: 'stale',
      nextExpectedBy: '2026-07-23T00:00:00.000Z',
      reasonCodes: [
        'keeptradecut-dynasty-football_snapshot_overdue',
        'football_ranking_publication_suspended',
      ],
    }
    staleResponse.items = []
    staleResponse.page = {
      page: 1,
      limit: 50,
      total: 0,
      totalPages: 0,
    }
    staleResponse.cohorts[0] = {
      sport: 'football',
      rankedCount: 0,
      buildCount: 0,
      holdCount: 0,
      watchCount: 0,
      deprioritizeCount: 0,
    }
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      return Promise.resolve(jsonResponse(
        url.includes('/api/v1/hobby-player-rankings')
          ? staleResponse
          : fixtureResponse(),
      ))
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState(
      {},
      '',
      '/hobby?lens=players&sport=football',
    )

    render(<HobbyApp />)

    expect(
      await screen.findByText('Rank publication is suspended.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/withheld every rank/u)).toBeInTheDocument()
    expect(
      screen.queryByText('Broaden the age, position, action, or search filters.'),
    ).not.toBeInTheDocument()
  })

  it('does not leave stale rows visible after a failed screen request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtureResponse()))
    vi.stubGlobal('fetch', fetchMock)
    render(<HobbyApp />)

    await screen.findByText('Pikachu')
    fetchMock.mockRejectedValueOnce(new Error('Filter request failed.'))
    fireEvent.click(screen.getByRole('button', { name: 'Core Hold' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Filter request failed.',
    )
    expect(screen.queryByText('Pikachu')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('table', {
        name: 'Long-term collection research table',
      }),
    ).not.toBeInTheDocument()
  })
})
