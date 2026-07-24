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
  buildMagnificentXAssessment,
  type MagnificentXDomain,
  type MagnificentXFeedItem,
  type MagnificentXFeedResponse,
  type MagnificentXSubjectType,
  type MagnificentXTaxonomyStatus,
} from '../domain/magnificentX'
import { HobbyApp } from './HobbyApp'

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
  taxonomyStatus?: MagnificentXTaxonomyStatus
  rank: number
  cohortSize: number
  percentile: number
}): MagnificentXFeedItem {
  const assessment = buildMagnificentXAssessment({
    row: {
      subjectType: input.type,
      domain: input.domain,
      taxonomyStatus:
        input.taxonomyStatus ?? 'coherent_provider_cohort',
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
    freshnessStatus: 'current',
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

function fixtureResponse(): MagnificentXFeedResponse {
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
        status: 'current',
        cadence: 'monthly',
        nextExpectedBy: '2026-08-20T00:00:00.000Z',
        reasonCodes: [],
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
      }),
      feedItem({
        id: 'athlete:michael-jordan',
        name: 'Michael Jordan',
        type: 'athlete',
        domain: 'basketball',
        rank: 1,
        cohortSize: 839,
        percentile: 100,
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
      limit: 24,
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

describe('Magnificent X hobby research UI', () => {
  it('renders provisional cohort evidence while explicitly withholding every full designation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(fixtureResponse())),
    )

    render(<HobbyApp />)

    expect(
      screen.getByRole('heading', { name: /Find enduring hobby demand/u }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'No full designations. By design.' }),
    ).toBeInTheDocument()

    const pikachuHeading = await screen.findByRole('heading', { name: 'Pikachu' })
    const pikachuCard = pikachuHeading.closest('article')
    expect(pikachuCard).not.toBeNull()
    expect(within(pikachuCard!).getByText(/Rank/u)).toHaveTextContent(
      'Rank #2 of 1,022',
    )
    expect(
      within(pikachuCard!).getByText(/Character-level demand only/u),
    ).toBeInTheDocument()
    expect(
      within(pikachuCard!).getByText(/Why designation is withheld/u),
    ).toBeInTheDocument()

    fireEvent.click(
      within(pikachuCard!).getByText(/Why designation is withheld/u),
    )
    expect(
      within(pikachuCard!).getByText(
        'Exact-card set, year, variation, grade, scarcity, and price evidence are missing.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/18 complete months/u)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Baseball Oracle/u })).toHaveAttribute(
      'href',
      '/',
    )
    expect(screen.getByRole('link', { name: /Football Oracle/u })).toHaveAttribute(
      'href',
      '/football',
    )
    expect(screen.getByRole('link', { name: /Pokémon source/u })).toHaveAttribute(
      'href',
      'https://www.gemrate.com/sales-trends-pokemon',
    )
  })

  it('sends domain, tier, and search filters through the versioned API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtureResponse()))
    vi.stubGlobal('fetch', fetchMock)
    render(<HobbyApp />)

    await screen.findByRole('heading', { name: 'Pikachu' })
    fireEvent.change(screen.getByLabelText('Provider cohort'), {
      target: { value: 'pokemon' },
    })
    fireEvent.change(screen.getByLabelText('Research tier'), {
      target: { value: 'market_leader' },
    })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search subjects' }), {
      target: { value: 'Pikachu' },
    })

    await waitFor(() => {
      const latestUrl = String(fetchMock.mock.calls.at(-1)?.[0])
      expect(latestUrl).toContain('/api/v1/magnificent-x?')
      expect(latestUrl).toContain('domain=pokemon')
      expect(latestUrl).toContain('tier=market_leader')
      expect(latestUrl).toContain('q=Pikachu')
      expect(latestUrl).toContain('page=1')
      expect(latestUrl).toContain('limit=24')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByLabelText('Provider cohort')).toHaveValue('all')
    expect(screen.getByLabelText('Research tier')).toHaveValue('all')
    expect(screen.getByRole('searchbox', { name: 'Search subjects' })).toHaveValue('')
  })
})
