import { describe, expect, it } from 'vitest'
import type { PlayerRecord } from '../domain/forecast'
import { buildMilbEvidenceRows, buildMilbOpportunityPoints } from './milbVisualizationData'

function playerFixture(overrides: Partial<PlayerRecord> = {}): PlayerRecord {
  return {
    id: 'player-1',
    name: 'Young Prospect',
    initials: 'YP',
    organization: 'Example Club',
    organizationCode: 'EX',
    position: 'SS',
    playerType: 'Hitter',
    stage: 'pre_debut',
    age: 19,
    level: 'AA',
    batsThrows: 'R/R',
    psScore: null,
    psPercentile: null,
    opportunity: null,
    metrics: [],
    coverage: {
      hasStatcast: true,
      hasTraditional: true,
      hasComplementaryRows: false,
      levelsObserved: ['AA'],
      organizationConflict: false,
      label: 'Tracking + traditional',
    },
    provenance: {
      source: 'Test',
      dataset: 'Fixture',
      season: 2026,
      retrievedAt: null,
      cohort: null,
      externalIds: {},
    },
    researchEstimate: null,
    milbAlphaSignal: {
      eligible: true,
      tier: 'priority',
      ageContext: {
        youngerThanPercent: 92,
        referencePlayers: 1200,
        role: 'hitter',
        priorLevel: 'AA',
      },
    } as PlayerRecord['milbAlphaSignal'],
    milbImpactRanking: {
      rank: 4,
      rankPercentile: 99.94,
      universeRows: 6455,
    } as PlayerRecord['milbImpactRanking'],
    minorTraitEvidence: {
      opportunity: {
        state: 'provisional',
        sufficient: false,
        observed: {
          plateAppearances: 80,
          inningsPitched: null,
          pitches: null,
        },
        thresholds: [{ unit: 'PA', provisional: 50, sufficient: 150 }],
      },
      coverage: {
        availableMetricCount: 3,
        coveredPillarCount: 1,
        totalPillarCount: 4,
        requiredCoveredPillars: 3,
        sufficient: false,
        missingPillars: ['Discipline', 'Damage', 'Expected output'],
      },
      corroboration: {
        strongPercentileThreshold: 80,
        strongPillarCount: 1,
        requiredStrongPillars: 2,
        multiPillar: false,
        passesAllDescriptiveGates: false,
      },
      pillars: [{
        key: 'contact',
        label: 'Contact',
        strongestMetric: {
          key: 'zone-contact',
          label: 'Zone contact',
          value: '91.2%',
          percentile: 95,
          pillar: 'contact',
          source: 'Prospect Savant',
        },
      }],
    } as PlayerRecord['minorTraitEvidence'],
    careerForecast: null,
    ...overrides,
  }
}

describe('MiLB decision visualizations', () => {
  it('plots every impact-ranked minor leaguer without requiring an eligible alpha or age context', () => {
    const defaultEvidence = playerFixture().minorTraitEvidence!
    const points = buildMilbOpportunityPoints([
      playerFixture(),
      playerFixture({
        id: 'aiva-like',
        name: 'Aiva Arquette',
        milbAlphaSignal: null,
        milbImpactRanking: {
          rank: 258,
          rankPercentile: 96.02,
          universeRows: 6455,
        } as PlayerRecord['milbImpactRanking'],
        minorTraitEvidence: {
          ...defaultEvidence,
          opportunity: {
            ...defaultEvidence.opportunity,
            observed: {
              plateAppearances: 122,
              inningsPitched: null,
              pitches: null,
            },
          },
          coverage: {
            ...defaultEvidence.coverage,
            coveredPillarCount: 2,
            totalPillarCount: 4,
            missingPillars: ['Damage', 'Expected output'],
          },
        },
      }),
      playerFixture({ id: 'mlb-player', stage: 'early_mlb' }),
    ])

    expect(points).toHaveLength(2)
    expect(points[0]).toEqual(expect.objectContaining({
      playerId: 'player-1',
      impactRank: 4,
      impactPercentile: 99.94,
      ageAdvantage: 92,
      evidenceCoverage: 25,
      tier: 'priority',
    }))
    expect(points[1]).toEqual(expect.objectContaining({
      playerId: 'aiva-like',
      impactRank: 258,
      impactPercentile: 96.02,
      ageAdvantage: null,
      evidenceCoverage: 50,
      coveredPillars: 2,
      totalPillars: 4,
      missingPillars: ['Damage', 'Expected output'],
      sampleState: 'provisional',
      sampleSummary: '122 PA',
      tier: 'context',
    }))
  })

  it('keeps an impact-ranked player on the map when current trait evidence is unavailable', () => {
    const points = buildMilbOpportunityPoints([
      playerFixture({ milbAlphaSignal: null, minorTraitEvidence: null }),
    ])

    expect(points).toEqual([expect.objectContaining({
      playerId: 'player-1',
      ageAdvantage: null,
      evidenceCoverage: 0,
      coveredPillars: 0,
      totalPillars: 0,
      sampleState: 'unavailable',
      sampleSummary: 'Current sample unavailable',
    })])
  })

  it('keeps direct rank, age context, and raw traits as separate rows', () => {
    const rows = buildMilbEvidenceRows(playerFixture())

    expect(rows.map((row) => [row.id, row.kind, row.value])).toEqual([
      ['impact-rank', 'model_rank', 99.94],
      ['age-context', 'age_context', 92],
      ['trait-contact', 'descriptive_trait', 95],
    ])
  })

  it('rejects out-of-range percentile inputs rather than clipping them', () => {
    const points = buildMilbOpportunityPoints([
      playerFixture({
        milbImpactRanking: {
          rank: 4,
          rankPercentile: 104,
          universeRows: 6455,
        } as PlayerRecord['milbImpactRanking'],
      }),
    ])

    expect(points).toEqual([])
  })
})
