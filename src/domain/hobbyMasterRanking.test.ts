import { describe, expect, it } from 'vitest'
import {
  buildHobbyMasterAssessment,
  computeHobbyMasterSignal,
  hobbyMasterMagnitudeScore,
  type HobbyMasterSignalInput,
} from './hobbyMasterRanking'

function input(
  monthlySalesUsd: number[],
  overrides: Partial<HobbyMasterSignalInput> = {},
): HobbyMasterSignalInput {
  return {
    row: {
      subjectType: 'athlete',
      domain: 'football',
      taxonomyStatus: 'coherent_provider_cohort',
      sourceCategory: '🏈',
      subjectName: 'Example Star',
      normalizedName: 'example star',
      sourceKey: 'athlete|football|Example Star',
      monthlySalesUsd,
      firstGradedYear: 2020,
      mostGradedYear: 2024,
    },
    cohortSize: 1_000,
    withinCohortPercentile: 99,
    globalObservedPercentile: 99.9,
    identityStatus: 'source_name_only',
    freshnessStatus: 'current',
    ...overrides,
  }
}

describe('Hobby Oracle master ranking v2', () => {
  it('maps absolute dollars onto a fixed, versioned magnitude scale', () => {
    expect(hobbyMasterMagnitudeScore(100_000)).toBe(0)
    expect(hobbyMasterMagnitudeScore(1_000_000)).toBeGreaterThan(20)
    expect(hobbyMasterMagnitudeScore(25_000_000)).toBeGreaterThan(65)
    expect(hobbyMasterMagnitudeScore(250_000_000)).toBe(100)
  })

  it('does not award score for positive momentum', () => {
    const latestTwelve = Array(12).fill(2_000_000)
    const flat = computeHobbyMasterSignal(input([
      ...Array(6).fill(2_000_000),
      ...latestTwelve,
    ]))
    const fastGrowth = computeHobbyMasterSignal(input([
      ...Array(6).fill(250_000),
      ...latestTwelve,
    ]))

    expect(flat.latestTwelveMonthSalesUsd)
      .toBe(fastGrowth.latestTwelveMonthSalesUsd)
    expect(flat.annualizedCurrentSixMonthSalesUsd)
      .toBe(fastGrowth.annualizedCurrentSixMonthSalesUsd)
    expect(flat.downsideProtectionScore).toBe(100)
    expect(fastGrowth.downsideProtectionScore).toBe(100)
    expect(fastGrowth.score).toBeLessThanOrEqual(flat.score)
    expect(flat.sensitivity.momentumAddsScore).toBe(false)
  })

  it('requires absolute scale instead of promoting a cohort leader', () => {
    const lowVolumeLeader = buildHobbyMasterAssessment(input(
      Array(18).fill(60_000),
      {
        withinCohortPercentile: 100,
        globalObservedPercentile: 90,
      },
    ))

    expect(lowVolumeLeader.buildQualification.eligible).toBe(false)
    expect(lowVolumeLeader.posture).not.toBe('build_candidate')
    expect(lowVolumeLeader.buildQualification.reasonCodes).toContain(
      'below_observed_global_top_one_percent',
    )
  })

  it('supports durable-scale and strict escape-velocity Build routes', () => {
    const durable = buildHobbyMasterAssessment(input(
      Array(18).fill(2_000_000),
    ))
    const escape = buildHobbyMasterAssessment(input([
      ...Array(12).fill(750_000),
      ...Array(6).fill(2_000_000),
    ]))

    expect(durable.buildQualification).toMatchObject({
      eligible: true,
      designation: 'Build',
      route: 'established_durability',
    })
    expect(escape.marketSignal.latestTwelveMonthSalesUsd)
      .toBeGreaterThanOrEqual(15_000_000)
    expect(escape.buildQualification).toMatchObject({
      eligible: true,
      designation: 'Build',
      route: 'escape_velocity',
    })
  })

  it('fails closed for stale or ambiguous source identities', () => {
    for (const overrides of [
      { freshnessStatus: 'stale' as const },
      { identityStatus: 'ambiguous_normalized_name' as const },
    ]) {
      const assessment = buildHobbyMasterAssessment(input(
        Array(18).fill(2_000_000),
        overrides,
      ))
      expect(assessment.buildQualification.eligible).toBe(false)
      expect(assessment.posture).not.toBe('build_candidate')
    }
  })
})
