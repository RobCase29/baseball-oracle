import { describe, expect, it } from 'vitest'
import {
  buildMagnificentXAssessment,
  computeMagnificentXMarketSignal,
  midrankPercentiles,
  researchPostureForAssessment,
  type MagnificentXMarketInput,
} from './magnificentX'

function input(
  monthlySalesUsd: number[],
  overrides: Partial<MagnificentXMarketInput> = {},
): MagnificentXMarketInput {
  return {
    row: {
      subjectType: 'pokemon_character',
      domain: 'pokemon',
      taxonomyStatus: 'coherent_provider_cohort',
      sourceCategory: 'pokemon_character',
      subjectName: 'Examplemon',
      normalizedName: 'examplemon',
      sourceKey: 'pokemon_character|pokemon|Examplemon',
      monthlySalesUsd,
      firstGradedYear: null,
      mostGradedYear: null,
    },
    cohortSize: 1_000,
    withinCohortPercentile: 99,
    globalScalePercentile: null,
    identityStatus: 'source_name_only',
    freshnessStatus: 'current',
    ...overrides,
  }
}

describe('Magnificent X provisional market signal', () => {
  it('computes bounded, auditable components from 18 complete months', () => {
    const months = [
      100, 105, 110, 115, 120, 125,
      130, 135, 140, 145, 150, 155,
      160, 165, 170, 175, 180, 185,
    ]
    const result = computeMagnificentXMarketSignal(input(months))

    expect(result.latestTwelveMonthSalesUsd).toBe(1_890)
    expect(result.currentSixMonthSalesUsd).toBe(1_035)
    expect(result.priorYearSixMonthSalesUsd).toBe(675)
    expect(result.withinCohortPercentile).toBe(99)
    expect(result.globalScalePercentile).toBeNull()
    expect(result.components.scale).toBeGreaterThan(70)
    expect(result.components.persistence).toBeGreaterThan(90)
    expect(result.components.shockResistance).toBeGreaterThan(99)
    expect(result.components.trendContext).toBeGreaterThan(60)
    expect(result.score).toBeGreaterThan(75)
  })

  it('uses average ranks for ties without converting a lone row into zero', () => {
    const rows = [
      { key: 'a', value: 10 },
      { key: 'b', value: 10 },
      { key: 'c', value: 20 },
    ]
    const percentiles = midrankPercentiles(
      rows,
      (row) => row.value,
      (row) => row.key,
    )
    const lone = midrankPercentiles(
      [{ key: 'only', value: 1 }],
      (row) => row.value,
      (row) => row.key,
    )

    expect(percentiles.get('a')).toBe(25)
    expect(percentiles.get('b')).toBe(25)
    expect(percentiles.get('c')).toBe(100)
    expect(lone.get('only')).toBe(100)
  })

  it('withholds every Magnificent designation while core gates are absent', () => {
    const result = buildMagnificentXAssessment(input(Array(18).fill(1_000)))

    expect(result.magnificentX).toMatchObject({
      score: null,
      eligible: false,
      designation: 'withheld',
    })
    expect(result.magnificentX.gates).toMatchObject({
      historyDepth: false,
      canonicalIdentity: false,
      domainFundamentals: false,
      globalScale: false,
      supplyDilution: false,
      exactCardEvidence: false,
      modelValidation: false,
    })
    expect(result.magnificentX.reasonCodes).toContain(
      'pokemon_character_bucket_not_exact_card',
    )
    expect(result.confidence.score).toBeLessThanOrEqual(50)
    expect(result.flags.observedHistoryMonths).toBe(18)
    expect(result.flags.requiredHistoryMonths).toBe(36)
  })

  it('fails closed for mixed or undersized provider cohorts', () => {
    const result = buildMagnificentXAssessment(input(
      Array(18).fill(1_000),
      {
        row: {
          ...input(Array(18).fill(1_000)).row,
          subjectType: 'athlete',
          domain: 'mixed_sport',
          taxonomyStatus: 'mixed_provider_cohort',
          sourceCategory: '🏆',
        },
        cohortSize: 100,
      },
    ))

    expect(result.researchTier).toBe('evidence_needed')
    expect(result.magnificentX.gates.cohortQuality).toBe(false)
    expect(result.magnificentX.reasonCodes).toContain('cohort_quality_gate_not_met')
  })

  it('maps market tiers into research postures while keeping card action withheld', () => {
    const assessment = buildMagnificentXAssessment(input(Array(18).fill(1_000)))
    const cases = [
      ['market_leader', 'build_candidate'],
      ['durable_demand', 'hold_candidate'],
      ['watch', 'watch'],
      ['noise_risk', 'risk_review'],
      ['long_tail', 'pass'],
      ['evidence_needed', 'unrated'],
    ] as const

    for (const [tier, posture] of cases) {
      const candidate = structuredClone(assessment)
      candidate.researchTier = tier
      candidate.magnificentX.gates.marketStrength = tier === 'market_leader'
      expect(researchPostureForAssessment(candidate)).toBe(posture)
      expect(candidate.magnificentX.designation).toBe('withheld')
    }
  })

  it('overrides posture when freshness or evidence quality fails', () => {
    const assessment = buildMagnificentXAssessment(input(Array(18).fill(1_000)))
    assessment.researchTier = 'market_leader'
    assessment.magnificentX.gates.marketStrength = true

    assessment.magnificentX.gates.currentFreshness = false
    expect(researchPostureForAssessment(assessment)).toBe('needs_refresh')

    assessment.magnificentX.gates.currentFreshness = true
    assessment.magnificentX.gates.cohortQuality = false
    expect(researchPostureForAssessment(assessment)).toBe('unrated')
  })
})
