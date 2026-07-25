import { describe, expect, it } from 'vitest'
import {
  buildHobbyMasterAssessment,
  type HobbyMasterFeedItem,
} from './hobbyMasterRanking'
import {
  buildHobbyExitWindowSignal,
} from './hobbyLiquidationSignal'

function item(
  monthlySalesUsd: number[],
  input: {
    name?: string
    globalObservedPercentile?: number
  } = {},
): HobbyMasterFeedItem {
  const name = input.name ?? 'Example Exit'
  const assessment = buildHobbyMasterAssessment({
    row: {
      subjectType: 'athlete',
      domain: 'football',
      taxonomyStatus: 'coherent_provider_cohort',
      sourceCategory: 'football',
      subjectName: name,
      normalizedName: name.toLocaleLowerCase('en-US'),
      sourceKey: `football:${name}`,
      monthlySalesUsd,
      firstGradedYear: 2020,
      mostGradedYear: 2026,
    },
    cohortSize: 1_000,
    withinCohortPercentile: 90,
    globalObservedPercentile: input.globalObservedPercentile ?? 90,
    identityStatus: 'source_name_only',
    freshnessStatus: 'current',
  })
  return {
    recordVersion: 'hobby-oracle-master-ranking-item/v2',
    subject: {
      id: `football:${name}`,
      type: 'athlete',
      domain: 'football',
      sourceCategory: 'football',
      name,
      identityStatus: 'source_name_only',
      firstGradedYear: 2020,
      mostGradedYear: 2026,
    },
    masterRank: 500,
    withinCohortRank: 100,
    assessment,
  }
}

describe('Binder Exit Window signal', () => {
  it('requires active demand, material decline, and no Build or Hold label', () => {
    const declining = buildHobbyExitWindowSignal(item([
      ...Array(6).fill(100_000),
      ...Array(6).fill(80_000),
      ...Array(6).fill(55_000),
    ]))
    const flat = buildHobbyExitWindowSignal(item(
      Array(18).fill(55_000),
      { name: 'Flat Market' },
    ))
    const illiquid = buildHobbyExitWindowSignal(item([
      ...Array(6).fill(20_000),
      ...Array(6).fill(10_000),
      ...Array(6).fill(5_000),
    ], { name: 'Thin Market' }))
    const build = buildHobbyExitWindowSignal(item(
      Array(18).fill(2_000_000),
      { name: 'Durable Build', globalObservedPercentile: 99.9 },
    ))

    expect(declining).toMatchObject({
      eligible: true,
      reasonCodes: [],
      interpretation:
        'subject_level_exit_window_proxy_not_exact_card_liquidity_or_sell_advice',
    })
    expect(declining.score).toBeGreaterThan(0)
    expect(declining.resaleHeat).toBeGreaterThan(0)
    expect(declining.declinePressure).toBeGreaterThan(0)
    expect(flat.reasonCodes).toContain(
      'six_month_decline_below_materiality_floor',
    )
    expect(illiquid.reasonCodes).toContain(
      'current_run_rate_below_exit_floor',
    )
    expect(build.reasonCodes).toContain('build_or_hold_designation')
    expect(flat.score).toBe(0)
    expect(illiquid.score).toBe(0)
    expect(build.score).toBe(0)
  })
})
