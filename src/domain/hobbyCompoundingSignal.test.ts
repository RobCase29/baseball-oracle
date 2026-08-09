import { describe, expect, it } from 'vitest'
import type {
  HobbyBreakoutSignal,
} from './hobbyBreakoutSignal'
import {
  HOBBY_COMPOUNDING_MODEL_VERSION,
  buildHobbyCompoundingSignal,
  type HobbyCompoundingSignalInput,
} from './hobbyCompoundingSignal'

const broadGrowthMonths = [
  ...Array(6).fill(1_000_000),
  ...Array(6).fill(1_100_000),
  1_100_000, 1_200_000, 1_300_000,
  1_400_000, 1_500_000, 1_600_000,
]

const broadLowGrowthMonths = [
  ...Array(6).fill(1_000_000),
  ...Array(6).fill(1_000_000),
  1_010_000, 1_010_000, 1_010_000,
  1_010_000, 1_010_000, 1_000_000,
]

function breakout(surfaced: boolean): HobbyBreakoutSignal {
  return { surfaced } as HobbyBreakoutSignal
}

function signal(
  overrides: Partial<HobbyCompoundingSignalInput> = {},
) {
  return buildHobbyCompoundingSignal({
    monthlySalesUsd: broadGrowthMonths,
    comparisonEligible: true,
    sourceCurrent: true,
    completeEighteenMonthHistory: true,
    priorSixMonthGlobalPercentile: 99.5,
    currentSixMonthGlobalPercentile: 99.6,
    domainRelativeSixMonthMultiple: 1.1,
    breakoutSignal: breakout(false),
    ...overrides,
  })
}

describe('Hobby compounding tail signal', () => {
  it('classifies a retained tail with broad absolute and share growth', () => {
    const result = signal()

    expect(result).toMatchObject({
      modelVersion: HOBBY_COMPOUNDING_MODEL_VERSION,
      state: 'tail_compounder',
      available: true,
      surfaced: true,
      baseSixMonthSalesUsd: 6_000_000,
      middleSixMonthSalesUsd: 6_600_000,
      currentSixMonthSalesUsd: 8_100_000,
      latestTwelveMonthSalesUsd: 14_700_000,
      sixMonthDemandAddedUsd: 1_500_000,
      sixMonthMultiple: 1.2273,
      confirmingMonths: 5,
      checks: {
        retainedTail: true,
        absoluteCompounding: true,
        shareCompounding: true,
        breadthConfirmed: true,
      },
      reasonCodes: [],
    })
    expect(result.currentSixMonthEffectiveMonths)
      .toBeGreaterThan(5.5)
    expect(result.latestTwelveMonthEffectiveMonths)
      .toBeGreaterThan(11)
  })

  it('separates a broad tail resident from a new tail entrant', () => {
    const resident = signal({
      monthlySalesUsd: broadLowGrowthMonths,
      domainRelativeSixMonthMultiple: 1.2,
    })
    const categoryLaggingResident = signal({
      domainRelativeSixMonthMultiple: 0.99,
    })
    const entrant = signal({
      priorSixMonthGlobalPercentile: 98.9,
      currentSixMonthGlobalPercentile: 99,
      domainRelativeSixMonthMultiple: 0.8,
    })

    expect(resident.state).toBe('tail_resident')
    expect(resident.checks.breadthConfirmed).toBe(true)
    expect(resident.checks.absoluteCompounding).toBe(false)
    expect(resident.reasonCodes).toContain(
      'six_month_multiple_below_1_15',
    )
    expect(categoryLaggingResident.state).toBe('tail_resident')
    expect(categoryLaggingResident.checks.absoluteCompounding).toBe(true)
    expect(categoryLaggingResident.checks.shareCompounding).toBe(false)
    expect(categoryLaggingResident.reasonCodes).toContain(
      'domain_relative_six_month_multiple_below_1',
    )
    expect(entrant.state).toBe('tail_entrant')
    expect(entrant.checks.enteredTail).toBe(true)
    expect(entrant.checks.shareCompounding).toBe(false)
  })

  it('keeps an unconfirmed current-tail crossing as a transition', () => {
    const result = signal({
      monthlySalesUsd: broadLowGrowthMonths,
      priorSixMonthGlobalPercentile: 98.9,
      currentSixMonthGlobalPercentile: 99,
    })

    expect(result.state).toBe('tail_transition')
    expect(result.surfaced).toBe(true)
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'six_month_multiple_below_1_15',
      'six_month_dollar_lift_below_250k',
    ]))
  })

  it('flags concentrated tail demand before calling it compounding', () => {
    const result = signal({
      monthlySalesUsd: [
        ...Array(6).fill(50_000),
        ...Array(6).fill(100_000),
        100_000, 100_000, 100_000, 100_000, 100_000, 2_000_000,
      ],
    })

    expect(result.state).toBe('tail_concentration')
    expect(result.checks.absoluteCompounding).toBe(true)
    expect(result.checks.breadthConfirmed).toBe(false)
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'current_six_month_demand_too_concentrated',
      'single_month_exceeds_40pct_of_current_six_months',
    ]))
  })

  it('gives tail pressure precedence over failed breadth', () => {
    const demandPressure = signal({
      monthlySalesUsd: [
        ...Array(6).fill(1_000_000),
        ...Array(6).fill(900_000),
        ...Array(6).fill(800_000),
      ],
    })
    const rankPressure = signal({
      currentSixMonthGlobalPercentile: 98.4,
    })

    expect(demandPressure.state).toBe('tail_pressure')
    expect(demandPressure.checks.breadthConfirmed).toBe(false)
    expect(demandPressure.reasonCodes).toContain(
      'six_month_multiple_below_0_9',
    )
    expect(rankPressure.state).toBe('tail_pressure')
    expect(rankPressure.reasonCodes).toContain(
      'current_six_global_percentile_below_98_5',
    )
  })

  it('uses Breakout only as a forming fallback outside the tail', () => {
    const forming = signal({
      priorSixMonthGlobalPercentile: 95,
      currentSixMonthGlobalPercentile: 97,
      breakoutSignal: breakout(true),
    })
    const absent = signal({
      priorSixMonthGlobalPercentile: 95,
      currentSixMonthGlobalPercentile: 97,
      breakoutSignal: breakout(false),
    })

    expect(forming).toMatchObject({
      state: 'forming',
      surfaced: true,
      reasonCodes: ['breakout_surfaced_outside_observed_tail'],
    })
    expect(absent).toMatchObject({
      state: 'not_surfaced',
      surfaced: false,
    })
  })

  it('fails closed when comparison evidence is unavailable', () => {
    for (const overrides of [
      { comparisonEligible: false },
      { sourceCurrent: false },
      { completeEighteenMonthHistory: false },
    ]) {
      const result = signal(overrides)
      expect(result.state).toBe('withheld')
      expect(result.available).toBe(false)
      expect(result.surfaced).toBe(false)
      expect(result.reasonCodes.length).toBeGreaterThan(0)
    }
  })

  it('uses inclusive tail and compounding thresholds', () => {
    const result = signal({
      monthlySalesUsd: [
        333_333, 333_333, 333_333, 333_333, 333_334, 333_334,
        333_333, 333_333, 333_333, 333_333, 333_334, 333_334,
        380_000, 380_000, 380_000, 380_000, 380_000, 400_000,
      ],
      priorSixMonthGlobalPercentile: 99,
      currentSixMonthGlobalPercentile: 98.5,
      domainRelativeSixMonthMultiple: 1,
    })

    expect(result.sixMonthMultiple).toBe(1.15)
    expect(result.checks).toMatchObject({
      priorSixGlobalPercentileAtLeast99: true,
      currentSixGlobalPercentileAtLeast98_5: true,
      sixMonthMultipleAtLeast1_15: true,
      sixMonthDemandAddedAtLeast250k: true,
      domainRelativeSixMonthMultipleAtLeast1: true,
    })
    expect(result.state).toBe('tail_compounder')
  })

  it('validates every numeric input and never publishes a synthetic score', () => {
    for (const overrides of [
      { monthlySalesUsd: Array(17).fill(1_000) },
      { monthlySalesUsd: [...Array(17).fill(1_000), -1] },
      { monthlySalesUsd: [...Array(17).fill(1_000), 1.5] },
      { priorSixMonthGlobalPercentile: -0.1 },
      { currentSixMonthGlobalPercentile: 100.1 },
      { domainRelativeSixMonthMultiple: Number.NaN },
    ]) {
      expect(() => signal(overrides)).toThrow()
    }

    const result = signal()
    expect(result).not.toHaveProperty('score')
    expect(result).not.toHaveProperty('probability')
    expect(result).not.toHaveProperty('expectedReturn')
    expect(JSON.stringify(result)).not.toMatch(
      /buy_recommendation|price_target/iu,
    )
  })

  it('is deterministic and does not mutate the monthly source row', () => {
    const months = Object.freeze([...broadGrowthMonths])
    const input: HobbyCompoundingSignalInput = {
      monthlySalesUsd: months,
      comparisonEligible: true,
      sourceCurrent: true,
      completeEighteenMonthHistory: true,
      priorSixMonthGlobalPercentile: 99.2,
      currentSixMonthGlobalPercentile: 99.4,
      domainRelativeSixMonthMultiple: 1.05,
      breakoutSignal: null,
    }

    const first = buildHobbyCompoundingSignal(input)
    const second = buildHobbyCompoundingSignal(input)
    const zeroBase = buildHobbyCompoundingSignal({
      ...input,
      monthlySalesUsd: Array(18).fill(0),
      priorSixMonthGlobalPercentile: 0,
      currentSixMonthGlobalPercentile: 0,
      domainRelativeSixMonthMultiple: 0,
    })

    expect(second).toEqual(first)
    expect(months).toEqual(broadGrowthMonths)
    const numericValues = Object.values(first).filter(
      (value): value is number => typeof value === 'number',
    )
    expect(numericValues.every(Number.isFinite)).toBe(true)
    expect(Object.values(zeroBase).filter(
      (value): value is number => typeof value === 'number',
    ).every(Number.isFinite)).toBe(true)
  })
})
