// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type {
  BinderGraduationSport,
  BinderGraduationV2Response,
} from '../domain/binderGraduationIndexV2'
import { Top100BinderBoard } from './Top100BinderBoard'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function top100Fixture(): BinderGraduationV2Response {
  const sports: BinderGraduationSport[] = [
    'basketball',
    'football',
    'baseball',
  ]
  const items = Array.from({ length: 100 }, (_, index) => {
    const rank = index + 1
    const sport = sports[index % sports.length]!
    const name =
      rank === 1
        ? 'Luka Doncic'
        : rank === 8
          ? 'Paul Skenes'
          : `Player ${rank}`
    return {
      recordVersion: 'backstop-binder-graduation-item/v2' as const,
      player: {
        id: `${sport}:player-${rank}`,
        name,
        normalizedName: name.toLocaleLowerCase('en-US'),
        sport,
        age: 20 + (rank % 12),
        positions: [
          sport === 'baseball' ? 'SS' : sport === 'football' ? 'QB' : 'PG',
        ],
        primaryPosition:
          sport === 'baseball' ? 'SS' : sport === 'football' ? 'QB' : 'PG',
        team: `T${rank}`,
        developmentStage: 'early_career' as const,
      },
      graduation: {
        status: 'ranked' as const,
        globalRank: rank,
        index: Math.max(40, 96 - rank * 0.45),
        probability: null,
        probabilityStatus:
          'withheld_no_longitudinal_build_transitions' as const,
        horizonMonths: 24 as const,
        band: rank <= 5
          ? 'on_deck' as const
          : rank <= 20
            ? 'approaching' as const
            : 'developing' as const,
        projectedRoute: 'escape_velocity' as const,
        primaryBlocker: 'ttm_scale' as const,
        marketPathReadiness: Math.max(45, 97 - rank * 0.4),
        trajectorySupport: Math.max(50, 95 - rank * 0.3),
        trajectory: 'rising' as const,
        routeReadiness: {
          established: 78,
          escapeVelocity: 84,
          commonGates: 82,
        },
        buildGateProgress: {
          passed: 5,
          required: 8,
          reasonCodes: ['ttm_scale_below_target'],
        },
        target: {
          designation: 'Master Build' as const,
          schemaVersion: 'hobby-oracle-master-ranking.v2' as const,
          contractVersion:
            'hobby-oracle-master-ranking-contract/v2' as const,
          persistenceRule:
            'enter_build_and_remain_build_in_two_of_three_monthly_snapshots' as const,
        },
        distance: {
          ttmSalesUsd: 2_000_000,
          currentRunRateUsd: 3_000_000,
          masterScorePoints: 4,
          globalTopOneTtmUsd: 0,
          persistencePoints: 3,
          shockResistancePoints: 2,
          downsideProtectionPoints: 5,
          sixMonthGrowthMultiple: 0.4,
          threeMonthGrowthMultiple: 0.2,
        },
        evidence: {
          grade: 'A' as const,
          sourceCurrent: true,
          completeHistory: true,
          identityBridgeValid: true,
          manualIdentityReviewed: true,
        },
      },
      playerSignal: {
        score: 88,
        outlook: 88,
        marketDurability: 82,
        evidenceYears: 3,
        evidenceStage: 'early_career' as const,
        inputIntegrity: 91,
        basis:
          sport === 'baseball'
            ? 'career_index_route_outcome' as const
            : 'dynasty_market_consensus' as const,
        modelLabel:
          sport === 'baseball'
            ? 'Career Index + route outcome'
            : 'Dynasty outlook',
        ageTreatment:
          sport === 'baseball'
            ? 'development_runway_embedded_in_outlook' as const
            : 'filter_only' as const,
      },
      market: {
        masterRank: rank + 20,
        masterScore: 71,
        boardPosture: 'watch' as const,
        buildRoute: null,
        ttmSalesUsd: 10_000_000 - rank * 10_000,
        currentRunRateUsd: 12_000_000 - rank * 10_000,
        globalObservedPercentile: 97,
        durability: 83,
        persistence: 87,
        shockResistance: 88,
        downsideProtection: 85,
      },
      identity: {
        status: 'reviewed_exact' as const,
        manualReviewStatus: 'approved' as const,
        provider:
          sport === 'baseball'
            ? 'career_oracle' as const
            : sport === 'football'
              ? 'keeptradecut' as const
              : 'hashtag_basketball' as const,
        providerPlayerId: `provider-${rank}`,
        gemRateSourceKey: `gemrate-${rank}`,
      },
      sources: [],
    }
  })

  return {
    schemaVersion: 'backstop-binder-index.v2',
    contractVersion: 'backstop-binder-index-contract/v2',
    modelVersion: 'binder-graduation-readiness/master-build-v2.1.0',
    snapshot: {
      id: `backstop-binder-index/v2:${'a'.repeat(64)}`,
      generatedAt: '2026-07-25T11:51:54.196Z',
      dataThrough: '2026-06-30',
      historyStart: '2025-01-01',
      historyMonths: 18,
      freshness: {
        status: 'current',
        reasonCodes: [],
      },
    },
    items,
    scope: {
      sport: 'all',
      maxAge: null,
      position: null,
      band: 'all',
    },
    summary: {
      rankedCount: 100,
      graduatedCount: 0,
      onDeckCount: 5,
      approachingCount: 15,
      developingCount: 80,
      longRangeCount: 0,
      withheldCount: 0,
    },
    page: {
      page: 1,
      limit: 100,
      total: 1_000,
      totalPages: 10,
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
      rankingUniverseCount: 1_000,
      globalTopOneTtmFloorUsd: 8_177_000,
      sports: ['baseball', 'football', 'basketball'],
      coverageBySport: {
        baseball: 333,
        football: 334,
        basketball: 333,
      },
      formula: {
        establishedRoute: 'Established route',
        escapeVelocityRoute: 'Escape route',
        commonGates: 'Common gates',
        marketPathReadiness: 'Market readiness',
        graduationIndex: 'Graduation Index',
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

describe('Backstop Binder Index Top 100', () => {
  it('loads the unfiltered global top 100 and prints the complete board', async () => {
    const response = top100Fixture()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const printMock = vi.spyOn(window, 'print').mockImplementation(() => {})
    vi.stubGlobal('fetch', fetchMock)

    render(<Top100BinderBoard />)

    const table = await screen.findByRole('table', {
      name: 'Backstop Binder Index global Top 100',
    })
    expect(within(table).getAllByRole('row')).toHaveLength(101)
    expect(within(table).getByText('Luka Doncic')).toBeInTheDocument()
    expect(within(table).getByText('#1')).toBeInTheDocument()
    expect(within(table).getByText('#100')).toBeInTheDocument()
    expect(screen.getByText('100 / 100')).toBeInTheDocument()

    await waitFor(() => {
      const requestUrl = String(fetchMock.mock.calls[0]?.[0])
      expect(requestUrl).toContain('/api/v2/backstop-binder-index?')
      expect(requestUrl).toContain('sport=all')
      expect(requestUrl).toContain('sort=graduation_rank')
      expect(requestUrl).toContain('limit=100')
      expect(requestUrl).not.toContain('maxAge')
    })

    const printButton = screen.getByRole('button', {
      name: 'Print Top 100',
    })
    expect(printButton).toBeEnabled()
    fireEvent.click(printButton)
    expect(printMock).toHaveBeenCalledOnce()
  })
})
