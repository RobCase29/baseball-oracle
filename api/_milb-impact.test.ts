import impactPreviewJson from './_data/milb-impact-2025.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'
import {
  researchMilbImpactRanking,
  researchMilbImpactSummary,
  validateMilbImpactArtifact,
} from './_milb-impact.js'

describe('MiLB impact research artifact', () => {
  it('loads a probability-free, exact-identity ranking', () => {
    const ranking = researchMilbImpactRanking('804606', 'Hitter')

    expect(ranking).toMatchObject({
      rank: 1,
      rankPercentile: 100,
      priorRank: 1,
      priorRankPercentile: 100,
      role: 'hitter',
      universeRows: 6455,
      frozenAsOf: '2025-12-31T00:00:00.000Z',
      selectedModel: 'regularized_logistic',
      thinSampleModel: 'age_level_role_performance_prior',
      thinSampleTieBreaker: 'regularized_logistic',
      releaseEligible: false,
      gates: {
        tailCalibrationPassed: false,
        prospectiveValidationPassed: false,
        knowledgeTimeVerified: false,
      },
    })
    expect(ranking?.target.id).toBe('mlb_war_next_5_ge_5')
    expect(Object.keys(ranking ?? {}).some((key) => /probability/iu.test(key))).toBe(false)
  })

  it('does not cross roles or accept malformed identifiers', () => {
    expect(researchMilbImpactRanking('804606', 'Pitcher')).toBeNull()
    expect(researchMilbImpactRanking('804606.0', 'Hitter')).toBeNull()
    expect(researchMilbImpactRanking(null, 'Hitter')).toBeNull()
  })

  it('publishes the frozen OOF rank evidence without claiming release validation', () => {
    expect(researchMilbImpactSummary.oofRankEvidence).toMatchObject({
      rows: 35747,
      players: 15326,
      eventPlayers: 197,
      topDecileLift: 8.09841735,
      foldTopDecileLiftRange: {
        minimum: 7.23772729,
        maximum: 8.27586207,
        folds: 5,
        validationSeasons: [2015, 2016, 2017, 2018, 2019],
      },
    })
    expect(researchMilbImpactSummary.thinSampleOofRankEvidence).toMatchObject({
      rows: 35747,
      players: 15326,
      eventPlayers: 197,
      averagePrecision: 0.09218755,
      rocAuc: 0.86554195,
      brier: 0.00922001,
      topDecileLift: 6.5010009,
    })
    expect(researchMilbImpactSummary.gates.prospectiveValidationPassed).toBe(false)
  })

  it('rejects rank drift and probability-bearing fields', () => {
    const rankDrift = structuredClone(impactPreviewJson) as Record<string, any>
    rankDrift.estimates['804606:hitter'].rank = 2
    expect(() => validateMilbImpactArtifact(rankDrift)).toThrow(/rank/iu)

    const probabilityLeak = structuredClone(impactPreviewJson) as Record<string, any>
    probabilityLeak.estimates['804606:hitter'].impactProbability = 0.96
    expect(() => validateMilbImpactArtifact(probabilityLeak)).toThrow(/cannot expose a probability value/iu)

    const priorRankDrift = structuredClone(impactPreviewJson) as Record<string, any>
    priorRankDrift.estimates['804606:hitter'].priorRank = 2
    expect(() => validateMilbImpactArtifact(priorRankDrift)).toThrow(/prior rank/iu)
  })
})
