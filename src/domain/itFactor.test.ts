import { describe, expect, it } from 'vitest'
import {
  IT_FACTOR_METHOD_VERSION,
  IT_FACTOR_SCHEMA_VERSION,
  filterItFactorEntries,
  findItFactorEntry,
  isItFactorBoardResponse,
  isItFactorScoreInTier,
  normalizeItFactorName,
  type ItFactorBoardResponse,
} from './itFactor'

function fixture(): ItFactorBoardResponse {
  return {
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
      scoreInterpretation: 'Editorial strength, not probability.',
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
        id: 'research',
        label: 'Research',
        publisher: 'League',
        url: 'https://example.com/research',
        publishedAt: '2026-07-25',
        accessedAt: '2026-07-26',
        kind: 'official',
      },
      {
        id: 'market',
        label: 'Market',
        publisher: 'Market',
        url: 'https://example.com/market',
        publishedAt: '2026-07-12',
        accessedAt: '2026-07-26',
        kind: 'hobby_market',
      },
    ],
    entries: [
      {
        id: 'nfl-hou-cj-stroud',
        player: {
          name: 'C.J. Stroud',
          normalizedName: 'cj stroud',
          position: 'QB',
          status: 'young_star',
        },
        sport: 'football',
        league: 'NFL',
        team: {
          code: 'HOU',
          name: 'Houston Texans',
        },
        score: 88,
        tier: 'high',
        confidence: 90,
        trajectory: 'holding',
        rationale:
          'A test fixture with enough substantive language for contract validation.',
        signals: ['draft pedigree', 'hobby demand'],
        recheckTriggers: ['Material team or market change.'],
        sourceIds: ['research', 'market'],
        market: {
          evidence: 'confirmed',
          sourceKey: 'athlete|football|CJ Stroud',
          sourceName: 'CJ Stroud',
          identityStatus: 'normalized',
          trailingTwelveMonthSalesUsd: 1_000_000,
          recentSixMonthSalesUsd: 600_000,
          priorSixMonthSalesUsd: 400_000,
          sportRank: 5,
          sportPercentile: 98,
        },
        lastReviewedAt: '2026-07-26',
      },
    ],
    coverage: {
      teamCount: 1,
      entryCount: 1,
      bySport: {
        baseball: { teamCount: 0, entryCount: 0 },
        football: { teamCount: 1, entryCount: 1 },
        basketball: { teamCount: 0, entryCount: 0 },
        hockey: { teamCount: 0, entryCount: 0 },
      },
    },
  }
}

describe('IT Factor board contract', () => {
  it('normalizes punctuated initials for cross-board identity matching', () => {
    expect(normalizeItFactorName('C.J. Stroud')).toBe('cj stroud')
    expect(normalizeItFactorName('CJ Stroud')).toBe('cj stroud')
    expect(findItFactorEntry(fixture().entries, 'football', 'CJ Stroud')?.id)
      .toBe('nfl-hou-cj-stroud')
  })

  it('searches player, team, code, and league without changing the board', () => {
    const board = fixture()
    expect(filterItFactorEntries(board.entries, 'Texans')).toHaveLength(1)
    expect(filterItFactorEntries(board.entries, 'HOU')).toHaveLength(1)
    expect(filterItFactorEntries(board.entries, 'NBA')).toHaveLength(0)
    expect(board.entries).toHaveLength(1)
  })

  it('fails closed when evidence links or review triggers are missing', () => {
    const board = fixture()
    expect(isItFactorBoardResponse(board)).toBe(true)
    const malformed = structuredClone(board)
    malformed.entries[0].recheckTriggers = []
    expect(isItFactorBoardResponse(malformed)).toBe(false)
    malformed.entries[0].recheckTriggers = ['Review later.']
    malformed.entries[0].sourceIds = ['missing', 'market']
    expect(isItFactorBoardResponse(malformed)).toBe(false)
  })

  it('fails closed on impossible market ranks and inconsistent coverage', () => {
    const malformedMarket = fixture()
    malformedMarket.entries[0].market.sportPercentile = 101
    expect(isItFactorBoardResponse(malformedMarket)).toBe(false)

    const malformedCoverage = fixture()
    malformedCoverage.coverage.entryCount = 2
    expect(isItFactorBoardResponse(malformedCoverage)).toBe(false)
  })

  it('keeps score labels inside their published tier bands', () => {
    expect(isItFactorScoreInTier(92, 'icon')).toBe(true)
    expect(isItFactorScoreInTier(91, 'icon')).toBe(false)
    expect(isItFactorScoreInTier(60, 'watch')).toBe(true)
  })
})
