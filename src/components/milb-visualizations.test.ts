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
  it('plots only exact minor-league rank and age-context matches', () => {
    const points = buildMilbOpportunityPoints([
      playerFixture(),
      playerFixture({ id: 'missing-context', milbAlphaSignal: null }),
      playerFixture({ id: 'mlb-player', stage: 'early_mlb' }),
    ])

    expect(points).toEqual([expect.objectContaining({
      playerId: 'player-1',
      impactRank: 4,
      impactPercentile: 99.94,
      ageAdvantage: 92,
      tier: 'priority',
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
