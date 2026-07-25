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
    identityStatus: 'reviewed_exact',
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
    recentSixMonthVolumePercentile: 90,
    fullHistoryVolumePercentile: 90,
    evidenceYears: 3,
    evidenceStage: 'established',
    evidenceBasis:
      sport === 'football' ? 'nfl_draft_year' : 'basketball_age_proxy',
    careerStartYear: sport === 'football' ? 2023 : null,
    firstGradedYear: 2023,
    mostGradedYear: 2025,
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

  it('withholds Build when freshness, history, or review fails', () => {
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

  it('keeps evidence stage out of the score peer baseline', () => {
    const stagePeers = [
      ...Array.from({ length: 8 }, (_, index) => candidate(
        `emerging-peer-${index}`,
        'basketball',
        {
          evidenceYears: 2,
          evidenceStage: 'emerging',
          providerPercentiles: {
            oneQb: null,
            superflex: null,
            fiveSeason: 55,
            keeper: 55,
          },
          volumePercentile: 95,
        },
      )),
      ...Array.from({ length: 8 }, (_, index) => candidate(
        `established-peer-${index}`,
        'basketball',
        {
          evidenceYears: 8,
          evidenceStage: 'established',
          providerPercentiles: {
            oneQb: null,
            superflex: null,
            fiveSeason: 95,
            keeper: 95,
          },
          volumePercentile: 55,
        },
      )),
    ]
    const rows = rankHobbyPlayerCandidates([
      ...stagePeers,
      candidate('same-signal-emerging', 'basketball', {
        evidenceYears: 2,
        evidenceStage: 'emerging',
        providerPercentiles: {
          oneQb: null,
          superflex: null,
          fiveSeason: 80,
          keeper: 80,
        },
        volumePercentile: 80,
      }),
      candidate('same-signal-established', 'basketball', {
        evidenceYears: 8,
        evidenceStage: 'established',
        providerPercentiles: {
          oneQb: null,
          superflex: null,
          fiveSeason: 80,
          keeper: 80,
        },
        volumePercentile: 80,
      }),
    ])
    const emerging = rows.find(
      (row) => row.input.id === 'same-signal-emerging',
    )!
    const established = rows.find(
      (row) => row.input.id === 'same-signal-established',
    )!

    expect(emerging.diagnostics.attentionGapBaseline).toBe(
      established.diagnostics.attentionGapBaseline,
    )
    expect(emerging.score).toBe(established.score)
  })

  it('uses career depth as a Build gate without adding rookie bonus points', () => {
    const rows = rankHobbyPlayerCandidates([
      candidate('a-rookie', 'football', {
        age: null,
        evidenceYears: 0,
        evidenceStage: 'new',
        careerStartYear: 2026,
      }),
      candidate('b-established', 'football'),
    ])
    const rookie = rows.find((row) => row.input.id === 'a-rookie')!
    const established = rows.find((row) => row.input.id === 'b-established')!

    expect(rookie.score).toBe(established.score)
    expect(rookie.gates.checks.minimumEvidenceDepth).toBe(false)
    expect(rookie.gates.reasonCodes).toContain(
      'minimum_career_evidence_depth_not_reached',
    )
    expect(rookie.posture).toBe('Watch')
  })

  it('accepts unknown football rookie age but not unknown basketball age', () => {
    expect(() => rankHobbyPlayerCandidates([
      candidate('football-rookie', 'football', {
        age: null,
        evidenceYears: 0,
        evidenceStage: 'new',
        careerStartYear: 2026,
      }),
    ])).not.toThrow()
    expect(() => rankHobbyPlayerCandidates([
      candidate('basketball-unknown', 'basketball', { age: null }),
    ])).toThrow(/plausible age/u)
  })

  it('flags sport-relative sales concentration instead of rewarding one spike', () => {
    const rows = rankHobbyPlayerCandidates([
      candidate('steady', 'basketball'),
      candidate('spike', 'basketball', {
        monthlySalesUsd: [
          ...Array(17).fill(1),
          17_983,
        ],
      }),
    ])
    const steady = rows.find((row) => row.input.id === 'steady')!
    const spike = rows.find((row) => row.input.id === 'spike')!

    expect(spike.diagnostics.salesConcentrationHhi).toBeGreaterThan(
      steady.diagnostics.salesConcentrationHhi,
    )
    expect(spike.gates.checks.concentrationBelowSportP90).toBe(false)
    expect(spike.posture).not.toBe('Build')
  })
})
