import { describe, expect, it } from 'vitest'
import { buildPlayerMap, PLAYER_MAP_VERSION, type PlayerMapInput } from './playerMap'

function makePlayer(overrides: Partial<PlayerMapInput> = {}): PlayerMapInput {
  return {
    name: 'Aiva Arquette',
    playerType: 'Hitter',
    stage: 'pre_debut',
    age: 22,
    level: 'AA',
    metrics: [],
    provenance: { retrievedAt: '2026-07-12T18:36:27.386Z' },
    careerForecast: null,
    ...overrides,
  }
}

describe('Player Map', () => {
  it('turns an Aiva-like ceiling and readiness disagreement into a useful discovery profile', () => {
    const profile = buildPlayerMap(makePlayer({
      milbImpactRanking: {
        rank: 258,
        rankPercentile: 96.017973,
        universeRows: 6_455,
        frozenAsOf: '2025-12-31T00:00:00.000Z',
        target: { id: 'mlb_war_next_5_ge_5' },
      },
      milbAlphaSignal: {
        eligible: false,
        rank: null,
        asOf: '2025-12-31T00:00:00.000Z',
        ageContext: {
          youngerThanPercent: 83.54,
          referencePlayers: 1_985,
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
      },
      minorTraitEvidence: {
        opportunity: {
          state: 'provisional',
          observed: { plateAppearances: 122, inningsPitched: null, pitches: null },
          thresholds: [{ unit: 'PA', provisional: 75, sufficient: 150 }],
        },
        coverage: {
          coveredPillarCount: 2,
          totalPillarCount: 4,
          missingPillars: ['Damage', 'Expected output'],
        },
        corroboration: { passesAllDescriptiveGates: false },
        strongestMetrics: [
          {
            key: 'whiff_rate',
            label: 'Whiff rate',
            value: '18.3%',
            percentile: 90.8,
            pillar: 'contact',
            source: 'Prospect Savant',
          },
          {
            key: 'walk_rate',
            label: 'Walk rate',
            value: '5.7%',
            percentile: 14.3,
            pillar: 'swing-decisions',
            source: 'Prospect Savant',
          },
          {
            key: 'chase_rate',
            label: 'Chase rate',
            value: '34.5%',
            percentile: 16.1,
            pillar: 'swing-decisions',
            source: 'Prospect Savant',
          },
        ],
      },
    }))

    expect(profile.version).toBe(PLAYER_MAP_VERSION)
    expect(profile.mappingStatus).toBe('scored')
    expect(profile.claimStatus).toBe('research_rank_only')
    expect(profile.state).toBe('discovery')
    expect(profile.stateLabel).toBe('Discovery')
    expect(profile.oracleScore).toEqual({
      value: 96,
      scale: 'stage_rank_percentile',
      route: 'milb',
      rank: 258,
      universe: 6_455,
      target: 'mlb_war_next_5_ge_5',
      asOf: '2025-12-31T00:00:00.000Z',
      definition: 'Rounded stage-specific outcome rank percentile; not a probability or composite score',
    })
    expect(profile.scores.outcome).toMatchObject({
      value: 96.017973,
      display: 'P96',
      rank: 258,
      universe: 6_455,
    })
    expect(profile.scores.readiness.display).toBe('Not confirmed')
    expect(profile.scores.trajectory.value).toBe(83.54)
    expect(profile.scores.evidence).toMatchObject({ value: 50, display: '2 / 4 pillars' })
    expect(profile.strengths[0]).toMatchObject({ key: 'whiff_rate', percentile: 90.8 })
    expect(profile.risks.map((risk) => risk.key)).toEqual(['walk_rate', 'chase_rate'])
    expect(profile.signals.map((signal) => signal.code)).toEqual([
      'ceiling_readiness_split',
      'thin_data_upside',
      'live_evidence_split',
    ])
    expect(profile.nextEvidence).toContain('28 PA to the sufficient current-sample threshold')
    expect(profile.marketIndependent).toBe(true)
    expect(profile.marketInputsIncluded).toBe(false)
    expect(JSON.stringify(profile)).not.toContain('primaryProbability')
    expect(JSON.stringify(profile)).not.toContain('arrivalProbability')
  })

  it('maps an MLB player without comparing the rank to the MiLB universe', () => {
    const profile = buildPlayerMap(makePlayer({
      name: 'Major Player',
      stage: 'early_mlb',
      age: 23,
      level: 'MLB',
      metrics: [
        {
          key: 'current-season-war',
          label: 'Current-season WAR',
          value: '3.1 WAR',
          percentile: 92,
          source: 'Baseball-Reference',
        },
      ],
      careerForecast: {
        asOf: '2025-12-31T00:00:00.000Z',
        rank: 20,
        hofCaliberProbability: 0.04,
        confidenceScore: 0.72,
        confidenceState: 'Moderate',
        careerChapter: {
          status: 'research',
          label: 'Foundation',
          trajectoryState: 'rising',
          evidence: { historicalPacePercentile: 88 },
          exceptionalTrajectory: {
            probability: 0.25,
            target: 'next_three_war_ge_global_training_q90',
          },
        },
        alphaSignal: { status: 'research', eligible: false },
      },
    }), { mlbUniverse: 100 })

    expect(profile.route).toBe('mlb')
    expect(profile.mappingStatus).toBe('scored')
    expect(profile.state).toBe('rising')
    expect(profile.scores.outcome).toMatchObject({
      value: 80.8080808080808,
      rank: 20,
      universe: 100,
    })
    expect(profile.oracleScore).toMatchObject({
      value: 81,
      route: 'mlb',
      rank: 20,
      universe: 100,
      target: 'hof-caliber-point-in-time-jaws-v1',
    })
    expect(profile.scores.readiness).toMatchObject({ value: 25, display: '25.0%' })
    expect(profile.scores.evidence).toMatchObject({ value: 72, display: '72 / 100' })
    expect(profile.scores.bestTrait).toMatchObject({
      label: 'Current-season performance',
      value: 92,
      display: 'P92',
      status: 'observed',
    })
    expect(profile.strengths[0]).toMatchObject({
      key: 'current-season-war',
      percentile: 92,
    })
    expect(profile.signals.map((signal) => signal.code)).toContain('trait_corroborated')
    expect(profile.missingEvidence).not.toContain('Current MLB performance')
    expect(profile.comparableWithinStageOnly).toBe(true)
  })
})
