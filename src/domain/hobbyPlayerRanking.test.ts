import { describe, expect, it } from 'vitest'
import {
  computeHobbyPlayerHypePenalty,
  computeHobbyPlayerOutlook,
  percentileFromProviderRank,
  rankHobbyPlayerCandidates,
  type HobbyPlayerRankingCandidateInput,
} from './hobbyPlayerRanking'

function candidate(
  id: string,
  sport: 'football' | 'basketball',
  overrides: Partial<HobbyPlayerRankingCandidateInput> = {},
): HobbyPlayerRankingCandidateInput {
  return {
    id,
    name: id,
    normalizedName: id,
    sport,
    age: sport === 'football' ? 24 : 23,
    positions: sport === 'football' ? ['WR'] : ['PG'],
    primaryPosition: sport === 'football' ? 'WR' : 'PG',
    team: null,
    provider: sport === 'football' ? 'keeptradecut' : 'hashtag_basketball',
    providerPlayerId: id,
    gemRateSourceKey: `athlete|${sport}|${id}`,
    providerPercentiles: sport === 'football'
      ? {
          oneQb: 90,
          superflex: 90,
          fiveSeason: null,
          keeper: null,
        }
      : {
          oneQb: null,
          superflex: null,
          fiveSeason: 90,
          keeper: 90,
        },
    monthlySalesUsd: Array(18).fill(1_000),
    volumePercentile: 90,
    marketFreshness: 'current',
    fundamentalsFreshness: 'current',
    manualReviewStatus: 'approved',
    ...overrides,
  }
}

describe('Hobby player durable ranking', () => {
  it('converts provider ranks into bounded percentiles and guards null ranks', () => {
    expect(percentileFromProviderRank(1, 500)).toBe(100)
    expect(percentileFromProviderRank(500, 500)).toBe(0)
    expect(percentileFromProviderRank(null, 500)).toBeNull()
    expect(percentileFromProviderRank(501, 500)).toBeNull()
    expect(computeHobbyPlayerOutlook('football', {
      oneQb: null,
      superflex: 90,
      fiveSeason: null,
      keeper: null,
    })).toBeNull()
  })

  it('uses the specified sport adapters without allowing one format to dominate', () => {
    expect(computeHobbyPlayerOutlook('football', {
      oneQb: 80,
      superflex: 100,
      fiveSeason: null,
      keeper: null,
    })).toBeCloseTo(83.8, 1)
    expect(computeHobbyPlayerOutlook('basketball', {
      oneQb: null,
      superflex: null,
      fiveSeason: 80,
      keeper: 100,
    })).toBe(85)
  })

  it('preserves the weak link instead of averaging away a bad market domain', () => {
    const [balanced, weakMarket] = rankHobbyPlayerCandidates([
      candidate('balanced', 'football', {
        providerPercentiles: {
          oneQb: 85,
          superflex: 85,
          fiveSeason: null,
          keeper: null,
        },
        volumePercentile: 85,
      }),
      candidate('weak-market', 'football', {
        providerPercentiles: {
          oneQb: 100,
          superflex: 100,
          fiveSeason: null,
          keeper: null,
        },
        volumePercentile: 20,
      }),
    ]).toSorted((left, right) => left.input.id.localeCompare(right.input.id))

    expect(balanced!.input.id).toBe('balanced')
    expect(balanced!.score).toBeGreaterThan(weakMarket!.score)
    expect(weakMarket!.score).toBeLessThan(60)
  })

  it('caps penalties from excess attention and sharp acceleration', () => {
    expect(computeHobbyPlayerHypePenalty(5, 50)).toBe(0)
    expect(computeHobbyPlayerHypePenalty(45, 50)).toBe(7.5)
    expect(computeHobbyPlayerHypePenalty(45, 100)).toBeGreaterThan(
      computeHobbyPlayerHypePenalty(45, 50),
    )
    expect(computeHobbyPlayerHypePenalty(100, 100)).toBeLessThanOrEqual(12)
  })

  it('ranks each sport in isolation', () => {
    const initial = rankHobbyPlayerCandidates([
      candidate('football-one', 'football'),
      candidate('basketball-one', 'basketball', { volumePercentile: 75 }),
      candidate('basketball-two', 'basketball', { volumePercentile: 65 }),
    ])
    const expanded = rankHobbyPlayerCandidates([
      ...Array.from({ length: 20 }, (_, index) => candidate(
        `football-${index + 2}`,
        'football',
        { volumePercentile: Math.max(0, 80 - index) },
      )),
      candidate('football-one', 'football'),
      candidate('basketball-one', 'basketball', { volumePercentile: 75 }),
      candidate('basketball-two', 'basketball', { volumePercentile: 65 }),
    ])

    const basketballRanks = (rows: typeof initial) => rows
      .filter((row) => row.input.sport === 'basketball')
      .map((row) => [row.input.id, row.sportRank])
    expect(basketballRanks(expanded)).toEqual(basketballRanks(initial))
  })

  it('withholds Build when freshness, history, review, or sensitivity fails', () => {
    const [row] = rankHobbyPlayerCandidates([
      candidate('stale', 'football', {
        monthlySalesUsd: [null, ...Array(17).fill(100_000)],
        marketFreshness: 'stale',
        manualReviewStatus: 'unreviewed',
      }),
    ])

    expect(row!.posture).not.toBe('Build')
    expect(row!.confidence.band).toBe('withheld')
    expect(row!.gates.checks).toMatchObject({
      sourcesCurrent: false,
      completeEighteenMonthHistory: false,
      manualIdentityReviewed: false,
    })
    expect(row!.gates.buildEligible).toBe(false)
  })

  it('marks an otherwise eligible unreviewed leader as Watch for review', () => {
    const [row] = rankHobbyPlayerCandidates([
      candidate('review-pending', 'football', {
        manualReviewStatus: 'unreviewed',
      }),
    ])

    expect(row!.gates.reasonCodes).toEqual([
      'manual_identity_review_not_completed',
    ])
    expect(row!.posture).toBe('Watch')
  })

  it('does not use age in the score', () => {
    const rows = rankHobbyPlayerCandidates([
      candidate('young', 'basketball', { age: 19 }),
      candidate('old', 'basketball', { age: 38 }),
    ])
    expect(rows[0]!.score).toBe(rows[1]!.score)
  })
})
