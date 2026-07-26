import { describe, expect, it } from 'vitest'
import {
  buildHobbyBreakoutSignal,
  type HobbyBreakoutSignalInput,
} from './hobbyBreakoutSignal'

const camMonths = [
  0, 38, 51, 158, 12, 212,
  5_248, 10_143, 30_806, 456_742, 101_962, 63_564,
  53_086, 104_711, 235_348, 452_540, 547_408, 439_028,
]

function signal(
  monthlySalesUsd: number[],
  overrides: Partial<HobbyBreakoutSignalInput> = {},
) {
  const currentSix = monthlySalesUsd.slice(-6)
    .reduce((total, value) => total + value, 0)
  const latestTwelve = monthlySalesUsd.slice(-12)
    .reduce((total, value) => total + value, 0)
  return buildHobbyBreakoutSignal({
    monthlySalesUsd,
    latestTwelveMonthSalesUsd: latestTwelve,
    annualizedCurrentSixMonthSalesUsd: currentSix * 2,
    persistence: 77.3,
    shockResistance: 91.8,
    comparisonEligible: true,
    sourceCurrent: true,
    completeEighteenMonthHistory: true,
    buildEligible: false,
    baselineSixMonthMultiple: 1.3,
    baselineRecentThreeMonthMultiple: 1.3,
    ...overrides,
  })
}

describe('Hobby Breakout Radar signal', () => {
  it('surfaces a Cam-like cold start on real multi-month dollar expansion', () => {
    const result = signal(camMonths)

    expect(result.surfaced).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(75)
    expect(result.evidence).toBe('volume_confirmed_cold_start')
    expect(result.sixMonthDemandAddedUsd).toBe(1_831_650)
    expect(result.recentThreeMonthDemandAddedUsd).toBe(1_045_831)
    expect(result.confirmingMonths).toBe(6)
    expect(result.currentSixMonthEffectiveMonths).toBeCloseTo(4.4, 1)
    expect(result.currentSixMonthPeakShare).toBeLessThan(0.4)
  })

  it('rejects tiny-dollar percentage noise', () => {
    const result = signal([
      ...Array(6).fill(5),
      ...Array(6).fill(25),
      ...Array(3).fill(1_000),
      ...Array(3).fill(5_000),
    ])

    expect(result.surfaced).toBe(false)
    expect(result.reasonCodes).toContain(
      'current_run_rate_outside_small_mid_band',
    )
    expect(result.reasonCodes).toContain(
      'cold_start_absolute_demand_not_confirmed',
    )
  })

  it('rejects one-month spikes even when absolute demand is high', () => {
    const result = signal([
      ...Array(6).fill(50_000),
      ...Array(6).fill(60_000),
      60_000, 60_000, 60_000, 60_000, 60_000, 2_000_000,
    ])

    expect(result.surfaced).toBe(false)
    expect(result.reasonCodes).toContain(
      'single_month_exceeds_40pct_of_current_six_months',
    )
  })

  it('keeps already-large and Build markets off the radar', () => {
    const result = signal(
      Array(18).fill(2_000_000),
      {
        latestTwelveMonthSalesUsd: 24_000_000,
        annualizedCurrentSixMonthSalesUsd: 24_000_000,
        buildEligible: true,
      },
    )

    expect(result.surfaced).toBe(false)
    expect(result.reasonCodes).toContain('already_on_build_board')
    expect(result.reasonCodes).toContain('ttm_demand_at_or_above_12m')
  })

  it('fails closed when the snapshot is stale', () => {
    const result = signal(camMonths, { sourceCurrent: false })

    expect(result.surfaced).toBe(false)
    expect(result.reasonCodes).toContain('market_snapshot_not_current')
  })
})
