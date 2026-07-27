// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import {
  IT_FACTOR_METHOD_VERSION,
  IT_FACTOR_SCHEMA_VERSION,
  type ItFactorBoardResponse,
} from '../domain/itFactor'
import { ItFactorBoard } from './ItFactorBoard'

afterEach(cleanup)

const response: ItFactorBoardResponse = {
  schemaVersion: IT_FACTOR_SCHEMA_VERSION,
  methodVersion: IT_FACTOR_METHOD_VERSION,
  snapshot: {
    asOf: '2026-07-26',
    generatedAt: '2026-07-26T18:00:00.000Z',
    marketDataThrough: '2026-06-30',
    marketRowsSha256:
      '9584f55d14a1abb63014ff95dd6f2c7cc145731e1a54cd57cfe7fdb4c75f22c7',
    nextReviewBy: '2026-10-26',
    status: 'current',
  },
  rubric: {
    definition: 'Narrative ceiling',
    scoreInterpretation:
      'A directional editorial synthesis, not a probability or return forecast.',
    confidenceInterpretation: 'Evidence confidence only.',
    tierThresholds: {
      icon: '92–100',
      high: '84–91',
      emerging: '74–83',
      watch: '60–73',
    },
    scoreInputs: ['consensus'],
  },
  sources: [
    {
      id: 'league',
      label: 'League research',
      publisher: 'MLB.com',
      url: 'https://www.mlb.com/prospects',
      publishedAt: '2026-07-25',
      accessedAt: '2026-07-26',
      kind: 'official',
    },
    {
      id: 'market',
      label: 'Market research',
      publisher: 'GemRate',
      url: 'https://www.gemrate.com/sales-trends',
      publishedAt: '2026-07-12',
      accessedAt: '2026-07-26',
      kind: 'hobby_market',
    },
  ],
  entries: [
    {
      id: 'mlb-lad-shohei-ohtani',
      player: {
        name: 'Shohei Ohtani',
        normalizedName: 'shohei ohtani',
        position: 'DH/RHP',
        status: 'established_star',
      },
      sport: 'baseball',
      league: 'MLB',
      team: { code: 'LAD', name: 'Los Angeles Dodgers' },
      score: 100,
      tier: 'icon',
      confidence: 100,
      trajectory: 'holding',
      rationale:
        'A singular two-way identity and global reach make this narrative durable.',
      signals: ['two-way singularity', 'global face'],
      recheckTriggers: ['Historic milestone or material demand change.'],
      sourceIds: ['market', 'league'],
      market: {
        evidence: 'confirmed',
        sourceKey: 'athlete|baseball|Shohei Ohtani',
        sourceName: 'Shohei Ohtani',
        identityStatus: 'exact',
        trailingTwelveMonthSalesUsd: 12_000_000,
        recentSixMonthSalesUsd: 7_000_000,
        priorSixMonthSalesUsd: 5_000_000,
        sportRank: 1,
        sportPercentile: 100,
      },
      lastReviewedAt: '2026-07-26',
    },
  ],
  coverage: {
    teamCount: 1,
    entryCount: 1,
    bySport: {
      baseball: { teamCount: 1, entryCount: 1 },
      football: { teamCount: 0, entryCount: 0 },
      basketball: { teamCount: 0, entryCount: 0 },
      hockey: { teamCount: 0, entryCount: 0 },
    },
  },
}

describe('ItFactorBoard', () => {
  it('renders score, confidence, market evidence, sources, and recheck cue', () => {
    render(
      <ItFactorBoard
        response={response}
        loading={false}
        error={null}
        search=""
        onResetSearch={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Shohei Ohtani' }))
      .toBeInTheDocument()
    expect(screen.getByRole('img', {
      name: /Icon · IT 100 · 100% classification confidence/u,
    })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'IT Board filters' }))
      .toBeInTheDocument()
    expect(screen.getByText('$12.0M TTM · P100 in sport'))
      .toBeInTheDocument()
    expect(screen.getByText('Historic milestone or material demand change.'))
      .toBeInTheDocument()
    expect(screen.getByRole('link', { name: /MLB\.com/u }))
      .toHaveAttribute('href', 'https://www.mlb.com/prospects')
    expect(screen.getByRole('link', { name: 'Market evidence' }))
      .toHaveAttribute(
        'href',
        '/hobby?lens=market&q=Shohei+Ohtani',
      )
    expect(screen.getByRole('link', { name: 'Player path' }))
      .toHaveAttribute(
        'href',
        '/hobby?lens=players&q=Shohei+Ohtani',
      )
  })

  it('filters without mutating the source board and resets every control', () => {
    const onResetSearch = vi.fn()
    render(
      <ItFactorBoard
        response={response}
        loading={false}
        error={null}
        search=""
        onResetSearch={onResetSearch}
      />,
    )

    fireEvent.change(screen.getByLabelText('Sport'), {
      target: { value: 'basketball' },
    })
    expect(screen.getByText('No IT player matches these filters.'))
      .toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reset IT Board' }))
    expect(screen.getByRole('heading', { name: 'Shohei Ohtani' }))
      .toBeInTheDocument()
    expect(onResetSearch).toHaveBeenCalledOnce()
    expect(response.entries).toHaveLength(1)
  })

  it('progressively reveals team groups instead of mounting the full board', () => {
    const entries = Array.from({ length: 13 }, (_, index) => {
      const number = index + 1
      return {
        ...response.entries[0]!,
        id: `player-${number}`,
        player: {
          ...response.entries[0]!.player,
          name: `Player ${number}`,
          normalizedName: `player ${number}`,
        },
        team: {
          code: `T${number}`,
          name: `Team ${number.toString().padStart(2, '0')}`,
        },
        market: {
          ...response.entries[0]!.market,
          sourceKey: `athlete|baseball|Player ${number}`,
          sourceName: `Player ${number}`,
        },
      }
    })
    render(
      <ItFactorBoard
        response={{ ...response, entries }}
        loading={false}
        error={null}
        search=""
        onResetSearch={vi.fn()}
      />,
    )

    expect(screen.queryByRole('heading', { name: 'Player 13' }))
      .not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more teams' }))
    expect(screen.getByRole('heading', { name: 'Player 13' }))
      .toBeInTheDocument()
  })
})
