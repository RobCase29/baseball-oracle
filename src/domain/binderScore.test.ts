import { describe, expect, it } from 'vitest'
import {
  BINDER_SCORE_COHORT_PRIOR,
  BINDER_SCORE_MAX_CONFIDENCE,
  BINDER_SCORE_MAX_HYPE_PENALTY,
  BINDER_SCORE_MODEL_VERSION,
  ageRunwayScore,
  buildBinderScore,
  calculateBinderMarketSignal,
  normalizePlayerName,
  percentileFromRank,
  rankFromPercentile,
  type BinderCandidateInput,
} from './binderScore'

function completeCandidate(
  overrides: Partial<BinderCandidateInput> = {},
): BinderCandidateInput {
  const base: BinderCandidateInput = {
    player: {
      id: 'mlbam:1',
      name: 'Example Player',
      age: 23,
      route: 'early_mlb',
    },
    baseball: {
      careerIndex: 88,
      routeOutcomePercentile: 92,
      freshness: { status: 'current', dataAsOf: '2026-07-20' },
    },
    market: {
      sourcePlayerName: 'Example Player',
      identityStatus: 'manual_verified',
      trailingTwelveMonthDemandPercentile: 86,
      monthlySalesUsd: [
        100, 105, 110, 112, 118, 120, 120, 125, 130, 132, 135, 140,
      ],
      freshness: { status: 'current', dataAsOf: '2026-06-30' },
      cohortId: 'gemrate-baseball-trailing-12m-2026-06',
    },
  }
  return {
    ...base,
    ...overrides,
    player: { ...base.player, ...overrides.player },
    baseball: { ...base.baseball, ...overrides.baseball },
    market:
      overrides.market === undefined
        ? base.market
        : overrides.market === null
          ? null
          : { ...base.market, ...overrides.market },
  }
}

describe('Binder Score v1 utilities', () => {
  it('normalizes names without claiming that a normalized key proves identity', () => {
    expect(normalizePlayerName('  Ronald Acuña Jr. ')).toBe('ronald acuna jr')
    expect(normalizePlayerName("Ke'Bryan—Hayes")).toBe('kebryan hayes')
  })

  it('converts between cohort rank and percentile with neutral singleton handling', () => {
    expect(percentileFromRank(1, 101)).toBe(100)
    expect(percentileFromRank(51, 101)).toBe(50)
    expect(percentileFromRank(101, 101)).toBe(0)
    expect(rankFromPercentile(50, 101)).toBe(51)
    expect(percentileFromRank(1, 1)).toBe(BINDER_SCORE_COHORT_PRIOR)
    expect(percentileFromRank(0, 10)).toBeNull()
  })

  it('makes age a bounded, route-aware, modest runway input', () => {
    expect(ageRunwayScore(19, 'pre_debut')).toBe(100)
    expect(ageRunwayScore(24, 'pre_debut')).toBe(50)
    expect(ageRunwayScore(30, 'established_mlb')).toBe(79)
    expect(ageRunwayScore(42, 'inactive')).toBe(BINDER_SCORE_COHORT_PRIOR)
    expect(ageRunwayScore(null, 'early_mlb')).toBeNull()
  })
})

describe('GemRate-style market signals', () => {
  it('calculates trailing demand, durability, and capped recent momentum', () => {
    const signal = calculateBinderMarketSignal([
      100, 100, 100, 100, 100, 100, 100, 100, 100, 200, 200, 200,
    ])

    expect(signal.trailingTwelveMonthSalesUsd).toBe(1500)
    expect(signal.observedMonths).toBe(12)
    expect(signal.durabilityResilienceScore).toBe(100)
    expect(signal.recentMomentumRate).toBe(1)
    expect(signal.recentMomentumScore).toBe(75)
  })

  it('keeps unavailable months null rather than silently turning them into zero', () => {
    const signal = calculateBinderMarketSignal([
      100,
      100,
      100,
      null,
      100,
      100,
      100,
      100,
      100,
      null,
      100,
      100,
    ])

    expect(signal.observedMonths).toBe(10)
    expect(signal.trailingTwelveMonthSalesUsd).toBe(1000)
    expect(signal.recentMomentumScore).toBeNull()
    expect(signal.coverageRatio).toBeCloseTo(0.833, 3)
  })
})

describe('Binder Score v1', () => {
  it('publishes a transparent research-only build signal for complete evidence', () => {
    const result = buildBinderScore(completeCandidate())

    expect(result.version.modelVersion).toBe(BINDER_SCORE_MODEL_VERSION)
    expect(result.semantics.publicationStatus).toBe('research_only')
    expect(result.semantics.marketMeaning).toContain('not_price_appreciation')
    expect(result.semantics.careerMeaning).toContain('not_hof_election_odds')
    expect(result.score).toBeGreaterThanOrEqual(78)
    expect(result.action).toBe('build')
    expect(result.confidence.band).toBe('moderate')
    expect(result.confidence.score).toBe(BINDER_SCORE_MAX_CONFIDENCE)
    expect(result.flags).toMatchObject({
      coreBaseballEvidenceComplete: true,
      marketEvidenceComplete: true,
      overallWithheld: false,
    })
  })

  it('uses fixed weights and the prior for optional missing age without reweighting', () => {
    const result = buildBinderScore(
      completeCandidate({ player: { id: 'mlbam:1', name: 'Example Player', age: null, route: 'early_mlb' } }),
    )
    const age = result.components.baseballThesis.components.ageRunway

    expect(age).toMatchObject({
      rawValue: null,
      effectiveValue: BINDER_SCORE_COHORT_PRIOR,
      imputedToPrior: true,
      weight: 0.15,
      weightedContribution: 7.5,
    })
    expect(result.components.baseballThesis.components.careerIndex.weight).toBe(0.6)
    expect(result.components.baseballThesis.components.routeOutcomePercentile.weight).toBe(
      0.25,
    )
    expect(result.score).not.toBeNull()
    expect(result.confidence.score).toBeLessThan(100)
  })

  it.each([
    { careerIndex: null, routeOutcomePercentile: 80 },
    { careerIndex: 80, routeOutcomePercentile: null },
  ])('withholds the overall score when core baseball evidence is missing', (baseball) => {
    const result = buildBinderScore(
      completeCandidate({
        baseball: {
          ...baseball,
          freshness: { status: 'current', dataAsOf: '2026-07-20' },
        },
      }),
    )

    expect(result.components.baseballThesis.score).toBeNull()
    expect(result.score).toBeNull()
    expect(result.action).toBe('insufficient_evidence')
    expect(result.confidence.band).toBe('withheld')
    expect(result.flags.overallWithheld).toBe(true)
  })

  it('keeps a provisional score but withholds action when market evidence is missing', () => {
    const result = buildBinderScore(completeCandidate({ market: null }))

    expect(result.score).not.toBeNull()
    expect(result.components.collectorDemand.score).toBe(BINDER_SCORE_COHORT_PRIOR)
    expect(
      result.components.collectorDemand.components.trailingTwelveMonthDemandPercentile,
    ).toMatchObject({
      rawValue: null,
      effectiveValue: BINDER_SCORE_COHORT_PRIOR,
      imputedToPrior: true,
    })
    expect(result.action).toBe('insufficient_evidence')
    expect(result.confidence.score).toBe(0)
    expect(result.flags.marketEvidenceComplete).toBe(false)
  })

  it('withholds action for ambiguous identity and stale inputs', () => {
    const result = buildBinderScore(
      completeCandidate({
        market: {
          sourcePlayerName: 'Example Player',
          identityStatus: 'ambiguous',
          trailingTwelveMonthDemandPercentile: 90,
          monthlySalesUsd: Array.from({ length: 12 }, () => 100),
          freshness: { status: 'stale', dataAsOf: '2025-12-31' },
          cohortId: 'old-cohort',
        },
      }),
    )

    expect(result.action).toBe('insufficient_evidence')
    expect(result.flags.marketIdentityConfirmed).toBe(false)
    expect(result.flags.marketFreshness).toBe('stale')
    expect(result.confidence.score).toBe(0)
  })

  it('withholds action for provisional name-only identity and unknown freshness', () => {
    const nameOnly = buildBinderScore(
      completeCandidate({
        market: {
          ...completeCandidate().market!,
          identityStatus: 'unique_normalized_name',
        },
      }),
    )
    const unknownBaseball = buildBinderScore(
      completeCandidate({
        baseball: {
          careerIndex: 88,
          routeOutcomePercentile: 92,
          freshness: { status: 'unknown', dataAsOf: null },
        },
      }),
    )

    expect(nameOnly.score).not.toBeNull()
    expect(nameOnly.action).toBe('insufficient_evidence')
    expect(nameOnly.flags.marketIdentityConfirmed).toBe(false)
    expect(unknownBaseball.score).not.toBeNull()
    expect(unknownBaseball.action).toBe('insufficient_evidence')
    expect(unknownBaseball.flags.baseballFreshness).toBe('unknown')
  })

  it('caps the hype penalty and favors trim_hype when demand outruns baseball evidence', () => {
    const result = buildBinderScore(
      completeCandidate({
        player: {
          id: 'mlbam:2',
          name: 'Hype Player',
          age: 27,
          route: 'early_mlb',
        },
        baseball: {
          careerIndex: 30,
          routeOutcomePercentile: 35,
          freshness: { status: 'current', dataAsOf: '2026-07-20' },
        },
        market: {
          sourcePlayerName: 'Hype Player',
          identityStatus: 'manual_verified',
          trailingTwelveMonthDemandPercentile: 100,
          monthlySalesUsd: [
            10, 10, 10, 10, 10, 10, 10, 10, 10, 1000, 1000, 1000,
          ],
          freshness: { status: 'current', dataAsOf: '2026-06-30' },
          cohortId: 'gemrate-baseball-trailing-12m-2026-06',
        },
      }),
    )

    expect(result.components.hypePenalty.value).toBeGreaterThanOrEqual(4)
    expect(result.components.hypePenalty.value).toBeLessThanOrEqual(
      BINDER_SCORE_MAX_HYPE_PENALTY,
    )
    expect(result.action).toBe('trim_hype')
  })
})
