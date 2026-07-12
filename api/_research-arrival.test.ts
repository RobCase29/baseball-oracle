import { describe, expect, it } from 'vitest'
import {
  researchArrivalEstimate,
  researchArrivalProbability,
  researchPreviewSummary,
} from './_research-arrival.js'

describe('research arrival preview', () => {
  it('requires an exact MLBAM and role match', () => {
    const estimate = researchArrivalEstimate('529017', 'Pitcher')

    expect(estimate).not.toBeNull()
    expect(estimate?.status).toBe('research_only')
    expect(estimate?.releaseEligible).toBe(false)
    expect(estimate?.horizons.map((horizon) => horizon.months)).toEqual([12, 24, 36, 48, 60])
    expect(researchArrivalEstimate('529017', 'Hitter')).toBeNull()
    expect(researchArrivalEstimate(null, 'Pitcher')).toBeNull()
  })

  it('keeps probabilities cumulative and the 60-month point unvalidated', () => {
    const estimate = researchArrivalEstimate('529017', 'Pitcher')
    const probabilities = estimate?.horizons.map((horizon) => horizon.probability) ?? []

    expect(probabilities).toEqual(probabilities.toSorted((left, right) => left - right))
    expect(estimate?.horizons.at(-1)?.externallyValidated).toBe(false)
    expect(researchArrivalProbability('529017', 'Pitcher', 36)).toBeCloseTo(0.44055333)
    expect(researchPreviewSummary.releaseEligible).toBe(false)
  })
})
