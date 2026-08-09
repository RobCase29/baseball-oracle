import { describe, expect, it } from 'vitest'
import {
  buildHobbySalesTrend,
  hobbySalesTrendDomainMedians,
  type HobbySalesTrendInput,
} from './hobbySalesTrend'

function input(
  overrides: Partial<HobbySalesTrendInput> = {},
): HobbySalesTrendInput {
  const monthlySalesUsd = [
    20_000, 20_000, 20_000, 20_000, 20_000, 20_000,
    20_000, 20_000, 20_000, 20_000, 20_000, 20_000,
    24_000, 24_000, 24_000, 24_000, 24_000, 24_000,
  ]
  return {
    monthlySalesUsd,
    currentSixMonthSalesUsd: 144_000,
    priorYearSixMonthSalesUsd: 120_000,
    effectiveSalesMonths: 12,
    sixMonthLogGrowth: Math.log(1.2),
    recentThreeMonthLogGrowth: Math.log(1.2),
    domainMedianSixMonthLogGrowth: Math.log(1.3),
    freshnessStatus: 'current',
    ...overrides,
  }
}

describe('hobby sales trend', () => {
  it('uses symmetric log-space rise and decline bands', () => {
    expect(buildHobbySalesTrend(input({
      sixMonthLogGrowth: Math.log(1.5),
      recentThreeMonthLogGrowth: Math.log(1.5),
    })).state).toBe('surging')
    expect(buildHobbySalesTrend(input({
      monthlySalesUsd: [
        30_000, 30_000, 30_000, 30_000, 30_000, 30_000,
        20_000, 20_000, 20_000, 20_000, 20_000, 20_000,
        20_000, 20_000, 20_000, 20_000, 20_000, 20_000,
      ],
      currentSixMonthSalesUsd: 120_000,
      priorYearSixMonthSalesUsd: 180_000,
      sixMonthLogGrowth: -Math.log(1.5),
      recentThreeMonthLogGrowth: -Math.log(1.5),
    })).state).toBe('steep_decline')
  })

  it('calls opposing recent windows cooling and rebounding', () => {
    expect(buildHobbySalesTrend(input({
      recentThreeMonthLogGrowth: Math.log(0.55),
    })).state).toBe('cooling')
    expect(buildHobbySalesTrend(input({
      monthlySalesUsd: [
        25_000, 25_000, 25_000, 25_000, 25_000, 25_000,
        10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
        20_000, 20_000, 20_000, 20_000, 20_000, 20_000,
      ],
      currentSixMonthSalesUsd: 120_000,
      priorYearSixMonthSalesUsd: 150_000,
      sixMonthLogGrowth: Math.log(0.8),
      recentThreeMonthLogGrowth: Math.log(1.55),
    })).state).toBe('rebounding')
  })

  it('marks zero or small comparison windows as a thin base', () => {
    const trend = buildHobbySalesTrend(input({
      priorYearSixMonthSalesUsd: 0,
      sixMonthLogGrowth: Math.log(144_001),
    }))
    expect(trend.sixMonthChangePct).toBeNull()
    expect(trend.evidence).toBe('thin_base')
    expect(trend.reasonCodes).toContain('prior_six_month_base_below_50k')
  })

  it('withholds a directional label when the market snapshot is stale', () => {
    const trend = buildHobbySalesTrend(input({ freshnessStatus: 'stale' }))
    expect(trend).toMatchObject({
      available: false,
      state: 'withheld',
      label: 'Refresh needed',
      evidence: 'withheld',
    })
  })

  it('compares a subject with a robust same-domain baseline', () => {
    const rows = [
      {
        domain: 'football' as const,
        taxonomyStatus: 'coherent_provider_cohort' as const,
        monthlySalesUsd: [
          ...Array<number>(6).fill(20_000),
          ...Array<number>(6).fill(22_000),
          ...Array<number>(6).fill(30_000),
        ],
      },
      {
        domain: 'football' as const,
        taxonomyStatus: 'coherent_provider_cohort' as const,
        monthlySalesUsd: [
          ...Array<number>(6).fill(20_000),
          ...Array<number>(6).fill(22_000),
          ...Array<number>(6).fill(20_000),
        ],
      },
      {
        domain: 'football' as const,
        taxonomyStatus: 'coherent_provider_cohort' as const,
        monthlySalesUsd: [
          ...Array<number>(6).fill(1_000),
          ...Array<number>(6).fill(1_000),
          ...Array<number>(6).fill(20_000),
        ],
      },
    ]
    const median = hobbySalesTrendDomainMedians(rows).get('football')
    expect(median).toBeCloseTo((Math.log(1.5) + Math.log(1)) / 2)
    expect(buildHobbySalesTrend(input({
      sixMonthLogGrowth: Math.log(1.6),
      recentThreeMonthLogGrowth: Math.log(1.6),
      domainMedianSixMonthLogGrowth: median ?? null,
    })).relativeToDomain).toBe('ahead')
  })
})
