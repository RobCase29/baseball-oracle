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

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Magnificent X investor board', () => {
  it('renders a dense decision table and keeps exact-card action withheld', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(fixtureResponse())),
    )

    render(<HobbyApp />)

    expect(
      screen.getByRole('heading', { name: 'Investor Board' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Research posture—not a card order.'),
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
    expect(screen.getByRole('link', { name: 'Baseball' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(screen.getByRole('link', { name: /Pokémon data/u })).toHaveAttribute(
      'href',
      'https://www.gemrate.com/sales-trends-pokemon',
    )
  })

  it('persists posture, cohort, search, and full-universe sort controls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtureResponse()))
    vi.stubGlobal('fetch', fetchMock)
    render(<HobbyApp />)

    await screen.findByText('Pikachu')
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }))
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
      expect(latestUrl).toContain('/api/v1/magnificent-x?')
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
    expect(await screen.findByText('Suspended')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getAllByText('Needs refresh')).toHaveLength(2)
  })

  it('does not leave stale rows visible after a failed screen request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtureResponse()))
    vi.stubGlobal('fetch', fetchMock)
    render(<HobbyApp />)

    await screen.findByText('Pikachu')
    fetchMock.mockRejectedValueOnce(new Error('Filter request failed.'))
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }))

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
