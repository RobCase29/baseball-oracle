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
  BinderGraduationV2Response,
} from '../domain/binderGraduationIndexV2'
import { Under25BinderBoard } from './Under25BinderBoard'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function under25Fixture(): BinderGraduationV2Response {
  const items = Array.from({ length: 25 }, (_, index) => {
    const rank = index + 1
    const sport =
      rank % 3 === 0
        ? 'baseball'
        : rank % 2 === 0
          ? 'football'
          : 'basketball'
    return {
      recordVersion: 'backstop-binder-graduation-item/v2',
      player: {
        id: `${sport}:player-${rank}`,
        name: rank === 1 ? 'Victor Wembanyama' : `Young Player ${rank}`,
        normalizedName:
          rank === 1 ? 'victor wembanyama' : `young player ${rank}`,
        sport,
        age: 19 + (rank % 7),
        positions: [sport === 'baseball' ? 'SS' : sport === 'football' ? 'QB' : 'C'],
        primaryPosition:
          sport === 'baseball' ? 'SS' : sport === 'football' ? 'QB' : 'C',
        team: `T${rank}`,
        developmentStage: 'early_career',
      },
      graduation: {
        status: 'ranked',
        globalRank: rank + 10,
        index: 94 - rank * 0.6,
        probability: null,
        band: rank <= 5 ? 'on_deck' : 'approaching',
        marketPathReadiness: 92 - rank * 0.5,
        trajectory: 'rising',
        primaryBlocker: 'ttm_scale',
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
        evidence: { grade: 'A' },
      },
      playerSignal: {
        outlook: 90 - rank * 0.2,
      },
      market: {
        ttmSalesUsd: 15_000_000 - rank * 50_000,
        currentRunRateUsd: 18_000_000 - rank * 50_000,
      },
    }
  })

  return {
    schemaVersion: 'backstop-binder-index.v2',
    contractVersion: 'backstop-binder-index-contract/v2',
    modelVersion: 'binder-graduation-readiness/master-build-v2.1.0',
    snapshot: {
      id: `backstop-binder-index/v2:${'b'.repeat(64)}`,
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
      maxAge: 25,
      position: null,
      band: 'all',
    },
    summary: {},
    page: {
      page: 1,
      limit: 100,
      total: 200,
      totalPages: 2,
    },
    meta: {
      probabilityAvailable: false,
      rankingPolicy:
        'one_global_rank_before_sport_age_position_or_search_filters',
    },
  } as unknown as BinderGraduationV2Response
}

describe('Backstop Binder Index 25 Under 25', () => {
  it('loads the age-screened Graduation Index order and prints 25 rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(under25Fixture()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const printMock = vi.spyOn(window, 'print').mockImplementation(() => {})
    vi.stubGlobal('fetch', fetchMock)

    render(<Under25BinderBoard />)

    const table = await screen.findByRole('table', {
      name: 'Backstop Binder Index 25 Under 25',
    })
    expect(within(table).getAllByRole('row')).toHaveLength(26)
    expect(within(table).getByText('Victor Wembanyama')).toBeInTheDocument()
    expect(within(table).getByText('#1')).toBeInTheDocument()
    expect(within(table).getByText('#25')).toBeInTheDocument()
    expect(within(table).getByText('global #11')).toBeInTheDocument()
    expect(screen.getByText('25 / 25')).toBeInTheDocument()

    await waitFor(() => {
      const requestUrl = String(fetchMock.mock.calls[0]?.[0])
      expect(requestUrl).toContain('/api/v2/backstop-binder-index?')
      expect(requestUrl).toContain('sport=all')
      expect(requestUrl).toContain('maxAge=25')
      expect(requestUrl).toContain('sort=graduation_index')
      expect(requestUrl).toContain('limit=100')
    })

    const printButton = screen.getByRole('button', {
      name: 'Print 25 Under 25',
    })
    expect(printButton).toBeEnabled()
    fireEvent.click(printButton)
    expect(printMock).toHaveBeenCalledOnce()
  })
})
