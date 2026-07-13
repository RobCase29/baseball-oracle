import { describe, expect, it } from 'vitest'
import {
  researchArrivalEstimate,
  researchArrivalProbability,
  researchMilbAlphaSignal,
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

  it('keeps probabilities cumulative and every failed-gate horizon unvalidated', () => {
    const estimate = researchArrivalEstimate('529017', 'Pitcher')
    const probabilities = estimate?.horizons.map((horizon) => horizon.probability) ?? []

    expect(probabilities).toEqual(probabilities.toSorted((left, right) => left - right))
    expect(estimate?.horizons.every((horizon) => !horizon.externallyValidated)).toBe(true)
    expect(estimate?.horizons.at(0)?.externalEvaluationStatus).toBe('failed_release_gate')
    expect(estimate?.horizons.at(-1)?.externalEvaluationStatus).toBe('immature')
    expect(researchArrivalProbability('529017', 'Pitcher', 36)).toBeCloseTo(0.44055333)
    expect(researchPreviewSummary.releaseEligible).toBe(false)
  })

  it('retains every frozen diagnostic while ranking only model-gated arrival anomalies', () => {
    const signal = researchMilbAlphaSignal('815908', 'Hitter')
    const aiva = researchMilbAlphaSignal('804109', 'Hitter')

    expect(signal).toMatchObject({
      version: 'milb-alpha-signal-v1',
      releaseEligible: false,
      eligible: true,
      tier: 'priority',
      rank: 1,
      validation: {
        status: 'external_validation_failed',
        validatedHorizons: [],
      },
    })
    expect(signal?.primaryEdge.probabilityDelta).toBeCloseTo(0.91808361)
    expect(signal?.releaseGates.probabilityCalibrationPassed).toBe(false)
    expect(aiva).toMatchObject({
      eligible: false,
      tier: 'none',
      rank: null,
      ageContext: {
        youngerThanPercent: 83.54,
        referencePlayers: 1985,
        priorLevel: 'Adv A',
      },
      gates: {
        supportedHistoricalContext: true,
        youngForRoleAndLevel: true,
        minimumRawWorkload: true,
        minimumPrimaryProbability: false,
        positivePrimaryModelEdge: false,
        positiveLongHorizonModelEdge: false,
      },
    })
    expect(researchMilbAlphaSignal('815908', 'Pitcher')).toBeNull()
    expect(researchPreviewSummary.milbAlphaSignalCoverage).toBe(6455)
    expect(researchPreviewSummary.milbAlphaSignalEligible).toBe(210)
  })
})
