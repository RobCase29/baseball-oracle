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
import {
  buildHobbyMasterAssessment,
  type HobbyMasterFeedItem,
  type HobbyMasterFeedResponse,
} from '../domain/hobbyMasterRanking'
import { ExitWindowBoard } from './ExitWindowBoard'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function exitItem(rank: number): HobbyMasterFeedItem {
  const name = rank === 1 ? 'Exit Candidate' : `Candidate ${rank}`
  const assessment = buildHobbyMasterAssessment({
    row: {
      subjectType: 'athlete',
      domain: rank % 2 === 0 ? 'baseball' : 'football',
      taxonomyStatus: 'coherent_provider_cohort',
      sourceCategory: 'athlete',
      subjectName: name,
      normalizedName: name.toLocaleLowerCase('en-US'),
      sourceKey: `athlete:${rank}`,
      monthlySalesUsd: [
        ...Array(6).fill(100_000),
        ...Array(6).fill(80_000),
        ...Array(6).fill(55_000),
      ],
      firstGradedYear: 2020,
      mostGradedYear: 2026,
    },
    cohortSize: 1_000,
    withinCohortPercentile: 90,
    globalObservedPercentile: 90,
    identityStatus: 'source_name_only',
    freshnessStatus: 'current',
  })
  return {
    recordVersion: 'hobby-oracle-master-ranking-item/v2',
    subject: {
      id: `athlete:${rank}`,
      type: 'athlete',
      domain: rank % 2 === 0 ? 'baseball' : 'football',
      sourceCategory: 'athlete',
      name,
      identityStatus: 'source_name_only',
      firstGradedYear: 2020,
      mostGradedYear: 2026,
      context: {
        age: 24,
        ageAsOf: '2026-06-30T00:00:00.000Z',
        introducedYear: null,
        approximateYearsSinceIntroduction: null,
        introducedGeneration: null,
        nationalDexNumber: null,
        sourceId: rank % 2 === 0
          ? 'backstop_player_rankings'
          : 'keeptradecut',
        evidence: 'verified_player_bridge',
      },
    },
    masterRank: rank + 500,
    withinCohortRank: rank,
    assessment,
  }
}

function exitFixture(): HobbyMasterFeedResponse {
  return {
    schemaVersion: 'hobby-oracle-master-ranking.v2',
    contractVersion: 'hobby-oracle-master-ranking-contract/v2',
    snapshot: {
      id: `hobby-oracle-master-ranking/v2:${'c'.repeat(64)}`,
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
    items: Array.from({ length: 100 }, (_, index) => exitItem(index + 1)),
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
      rankingUniverseCount: 5_866,
      buildCount: 23,
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
  }
}

describe('Backstop Binder Index Exit 100', () => {
  it('loads the exit-window order and prints the complete board', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(exitFixture()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const printMock = vi.spyOn(window, 'print').mockImplementation(() => {})
    vi.stubGlobal('fetch', fetchMock)

    render(<ExitWindowBoard />)

    const table = await screen.findByRole('table', {
      name: 'Backstop Binder Index Exit 100',
    })
    expect(within(table).getAllByRole('row')).toHaveLength(101)
    const firstRow = within(table).getByText('Exit Candidate').closest('tr')
    expect(firstRow).not.toBeNull()
    expect(within(firstRow!).getByText(/Age 24/)).toBeInTheDocument()
    expect(
      within(firstRow!).getByText('Steep decline -45.0%'),
    ).toBeInTheDocument()
    expect(within(table).getByText('Exit Candidate')).toBeInTheDocument()
    expect(within(table).getByText('#1')).toBeInTheDocument()
    expect(within(table).getByText('#100')).toBeInTheDocument()
    expect(screen.getByText('100 / 100')).toBeInTheDocument()

    await waitFor(() => {
      const requestUrl = String(fetchMock.mock.calls[0]?.[0])
      expect(requestUrl).toContain('/api/v2/hobby-oracle?')
      expect(requestUrl).toContain('posture=all')
      expect(requestUrl).toContain('sort=exit_window')
      expect(requestUrl).toContain('direction=desc')
      expect(requestUrl).toContain('limit=100')
    })

    const printButton = screen.getByRole('button', {
      name: 'Print Exit 100',
    })
    expect(printButton).toBeEnabled()
    fireEvent.click(printButton)
    expect(printMock).toHaveBeenCalledOnce()
  })
})
