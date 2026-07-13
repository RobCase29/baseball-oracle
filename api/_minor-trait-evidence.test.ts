import { describe, expect, it } from 'vitest'
import {
  minorTraitEvidence,
  type MinorTraitMetricInput,
} from './_minor-trait-evidence.js'

function metric(
  key: string,
  percentile: number | null,
  label = key,
): MinorTraitMetricInput {
  return {
    key,
    label,
    value: 'observed',
    percentile,
    source: 'Prospect Savant',
  }
}

describe('minorTraitEvidence', () => {
  it('corroborates a sufficiently observed hitter across distinct raw-trait pillars', () => {
    const evidence = minorTraitEvidence({
      playerType: 'Hitter',
      opportunity: { plateAppearances: 220 },
      metrics: [
        metric('exit-velocity-90', 94),
        metric('whiff-rate', 87),
        metric('chase-rate', 72),
        metric('xwoba', 66),
      ],
    })

    expect(evidence.status).toBe('descriptive_source_evidence_only')
    expect(evidence.predictiveValidation).toBe(false)
    expect(evidence.opportunity.state).toBe('sufficient')
    expect(evidence.coverage).toMatchObject({
      availableMetricCount: 4,
      coveredPillarCount: 4,
      sufficient: true,
    })
    expect(evidence.corroboration).toMatchObject({
      strongPillarCount: 2,
      multiPillar: true,
      passesAllDescriptiveGates: true,
    })
    expect(evidence.strongestMetrics.map((entry) => entry.key)).toEqual([
      'exit-velocity-90',
      'whiff-rate',
      'chase-rate',
      'xwoba',
    ])
  })

  it('excludes provider composites even when they have the strongest percentile', () => {
    const evidence = minorTraitEvidence({
      playerType: 'Hitter',
      opportunity: { plateAppearances: 220 },
      metrics: [
        metric('ps-score', 100, 'PS score'),
        metric('score_p', 99, 'PS percentile'),
        metric('exit-velocity-90', 91),
        metric('whiff-rate', 88),
        metric('chase-rate', 77),
        metric('xwoba', 70),
      ],
    })

    expect(evidence.exclusions.providerCompositeMetricCount).toBe(2)
    expect(evidence.strongestMetrics.map((entry) => entry.key)).not.toContain(
      'ps-score',
    )
    expect(evidence.warnings).toContain('provider_composite_metric_excluded')
  })

  it('withholds the known-suspicious K-BB percentile instead of treating zero or 100 as evidence', () => {
    const evidence = minorTraitEvidence({
      playerType: 'Pitcher',
      opportunity: { pitches: 720 },
      metrics: [
        metric('k-minus-bb-rate', 100, 'K-BB rate'),
        metric('velocity', 92),
        metric('whiff-rate', 89),
        metric('walk-rate', 84),
        metric('xwoba', 79),
      ],
    })

    expect(evidence.exclusions.kMinusBbPercentileCount).toBe(1)
    expect(evidence.strongestMetrics.map((entry) => entry.key)).toEqual([
      'velocity',
      'whiff-rate',
      'walk-rate',
      'xwoba',
    ])
    expect(evidence.warnings).toContain(
      'source_k_minus_bb_percentile_withheld',
    )
  })

  it('keeps provider favorable-direction percentiles as published for each role', () => {
    const evidence = minorTraitEvidence({
      playerType: 'Pitcher',
      opportunity: { inningsPitched: 45 },
      metrics: [
        metric('velocity', 81),
        metric('strikeout-rate', 82),
        metric('walk-rate', 93),
        metric('chase-rate', 90),
        metric('xwoba', 96),
      ],
    })

    expect(evidence.opportunity.state).toBe('sufficient')
    expect(
      evidence.strongestMetrics.map(({ key, percentile }) => [key, percentile]),
    ).toEqual([
      ['xwoba', 96],
      ['walk-rate', 93],
      ['chase-rate', 90],
      ['strikeout-rate', 82],
      ['velocity', 81],
    ])
  })

  it('does not pass the descriptive gate on a provisional sample', () => {
    const evidence = minorTraitEvidence({
      playerType: 'Hitter',
      opportunity: { observed: { label: 'PA', value: '100' } },
      metrics: [
        metric('exit-velocity-90', 95),
        metric('zone-contact-rate', 90),
        metric('walk-rate', 82),
        metric('xwoba', 70),
      ],
    })

    expect(evidence.opportunity).toMatchObject({
      state: 'provisional',
      sufficient: false,
      observed: { plateAppearances: 100 },
    })
    expect(evidence.corroboration.multiPillar).toBe(true)
    expect(evidence.corroboration.passesAllDescriptiveGates).toBe(false)
    expect(evidence.warnings).toContain('provisional_opportunity')
  })

  it('excludes conflicting duplicate source metrics deterministically', () => {
    const metrics = [
      metric('velocity', 90),
      metric('velocity', 10),
      metric('whiff-rate', 91),
      metric('walk-rate', 83),
      metric('xwoba', 82),
    ]
    const evidence = minorTraitEvidence({
      playerType: 'Pitcher',
      opportunity: { pitches: '650' },
      metrics: [...metrics].reverse(),
    })

    expect(evidence.exclusions.duplicateMetricKeyCount).toBe(1)
    expect(evidence.strongestMetrics.map((entry) => entry.key)).not.toContain(
      'velocity',
    )
    expect(evidence.coverage.missingPillars).toContain('Arsenal')
    expect(evidence.warnings).toContain('duplicate_metric_key_excluded')
  })

  it('does not mix percentiles from an unrecognized source into the evidence', () => {
    const unsupported = {
      ...metric('xwoba', 99),
      source: 'Another provider',
    }
    const evidence = minorTraitEvidence({
      playerType: 'Hitter',
      opportunity: { plateAppearances: 200 },
      metrics: [
        unsupported,
        metric('exit-velocity-90', 90),
        metric('whiff-rate', 85),
        metric('walk-rate', 81),
      ],
    })

    expect(evidence.exclusions.unsupportedSourceMetricCount).toBe(1)
    expect(evidence.coverage.missingPillars).toContain('Expected output')
    expect(evidence.warnings).toContain('unsupported_metric_source_excluded')
  })
})
