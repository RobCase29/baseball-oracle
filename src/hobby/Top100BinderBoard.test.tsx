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
  HobbyMasterFeedResponse,
} from '../domain/hobbyMasterRanking'
import { Top100BinderBoard } from './Top100BinderBoard'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function top100Fixture(): HobbyMasterFeedResponse {
  const items = Array.from({ length: 100 }, (_, index) => {
    const rank = index + 1
    const pokemon = rank === 1
    return {
      recordVersion: 'hobby-oracle-master-ranking-item/v2',
      subject: {
        id: pokemon ? 'pokemon:pikachu' : `athlete:player-${rank}`,
        type: pokemon ? 'pokemon_character' : 'athlete',
        domain: pokemon
          ? 'pokemon'
          : rank % 2 === 0
            ? 'basketball'
            : 'football',
        sourceCategory: pokemon ? 'pokemon' : 'athlete',
        name: pokemon ? 'Pikachu' : `Player ${rank}`,
        identityStatus: 'source_name_only',
        firstGradedYear: pokemon ? null : 2003,
        mostGradedYear: pokemon ? null : 2026,
      },
      masterRank: rank,
      withinCohortRank: rank,
      assessment: {
        schemaVersion: 'hobby-oracle-master-ranking.v2',
        contractVersion: 'hobby-oracle-master-ranking-contract/v2',
        modelVersion:
          'hobby-oracle-absolute-demand-durability/18m-v2.0.0',
        posture: rank <= 20 ? 'build_candidate' : 'hold_candidate',
        marketSignal: {
          score: 96 - rank * 0.3,
          demandMagnitudeScore: 98 - rank * 0.2,
          durabilityScore: 97 - rank * 0.15,
          downsideProtectionScore: 95,
          latestTwelveMonthSalesUsd: 50_000_000 - rank * 100_000,
          currentSixMonthSalesUsd: 24_000_000 - rank * 40_000,
          annualizedCurrentSixMonthSalesUsd:
            48_000_000 - rank * 80_000,
          priorYearSixMonthSalesUsd: 20_000_000,
          globalObservedPercentile: 100 - rank * 0.01,
          withinCohortPercentile: 100 - rank * 0.02,
          components: {
            trailingTwelveMonthMagnitude: 95,
            currentRunRateMagnitude: 94,
            persistence: 96,
            shockResistance: 95,
            downsideProtection: 95,
          },
          diagnostics: {},
          sensitivity: {},
        },
        buildQualification: {
          eligible: rank <= 20,
          designation: rank <= 20 ? 'Build' : 'withheld',
          route: rank <= 20 ? 'established_durability' : null,
          passed: rank <= 20 ? 8 : 7,
          required: 8,
          checks: {},
          reasonCodes: [],
        },
        flags: {},
      },
    }
  })

  return {
    schemaVersion: 'hobby-oracle-master-ranking.v2',
    contractVersion: 'hobby-oracle-master-ranking-contract/v2',
    snapshot: {
      id: `hobby-oracle-master-ranking/v2:${'a'.repeat(64)}`,
      historyStart: '2025-01-01',
      historyMonths: 18,
      dataThrough: '2026-06-30',
      publishedAt: '2026-07-25T11:51:54.196Z',
      acquiredAt: '2026-07-25T11:51:54.196Z',
      freshness: {
        status: 'current',
        cadence: 'monthly',
        nextExpectedBy: '2026-08-20T00:00:00.000Z',
        reasonCodes: [],
      },
    },
    items,
    cohorts: [],
    page: {
      page: 1,
      limit: 100,
      total: 6_022,
      totalPages: 61,
    },
    meta: {
      researchOnly: true,
      investmentAdvice: false,
      rankingPolicy:
        'single_observed_universe_absolute_demand_and_durability_order',
      rankingUniverse: 'coherent_unambiguous_gemrate_subject_rows',
      rankingUniverseCount: 6_022,
      buildCount: 20,
      marketSource: 'GemRate Athlete + Pokémon Sales Trends',
      marketMeasure: 'completed_ebay_singles_sales_volume_usd',
      exactCardRecommendationsAvailable: false,
      globalComparisonStatus:
        'observed_snapshot_comparable_not_canonical_hobby_census',
      globalComparisonLimitations: [],
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
  } as unknown as HobbyMasterFeedResponse
}

describe('Backstop Binder Index score-ranked Top 100', () => {
  it('loads the actual Binder Index order and prints the complete board', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(top100Fixture()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const printMock = vi.spyOn(window, 'print').mockImplementation(() => {})
    vi.stubGlobal('fetch', fetchMock)

    render(<Top100BinderBoard />)

    const table = await screen.findByRole('table', {
      name: 'Backstop Binder Index score-ranked Top 100',
    })
    expect(within(table).getAllByRole('row')).toHaveLength(101)
    expect(within(table).getByText('Pikachu')).toBeInTheDocument()
    expect(within(table).getByText('#1')).toBeInTheDocument()
    expect(within(table).getByText('#100')).toBeInTheDocument()
    expect(screen.getByText('100 / 100')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'By Binder Index' }),
    ).toBeInTheDocument()

    await waitFor(() => {
      const requestUrl = String(fetchMock.mock.calls[0]?.[0])
      expect(requestUrl).toContain('/api/v2/hobby-oracle?')
      expect(requestUrl).toContain('posture=all')
      expect(requestUrl).toContain('sort=master_rank')
      expect(requestUrl).toContain('direction=asc')
      expect(requestUrl).toContain('limit=100')
      expect(requestUrl).not.toContain('maxAge')
      expect(requestUrl).not.toContain('backstop-binder-index')
    })

    const printButton = screen.getByRole('button', {
      name: 'Print Top 100',
    })
    expect(printButton).toBeEnabled()
    fireEvent.click(printButton)
    expect(printMock).toHaveBeenCalledOnce()
  })
})
