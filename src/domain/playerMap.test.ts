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
      careerForecast: {
        asOf: '2025-12-31T00:00:00.000Z',
        rank: 258,
        hofCaliberProbability: 0.001,
        confidenceScore: 0.35,
        confidenceState: 'Low',
        finalCareerWar: { p10: 0, p25: 0, p50: 1, p75: 4, p90: 12 },
        decomposition: { estimatedDebutAge: 23 },
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
      target: 'mlb-debut-age-mixed-final-standard-bridge-v1',
      asOf: '2025-12-31T00:00:00.000Z',
      definition: 'Rounded stage-specific modeled outcome rank percentile; not a probability or composite score',
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

  it('uses projected debut age for career ceiling and withholds a fragile Carson-like impact rank', () => {
    const profile = buildPlayerMap(makePlayer({
      name: 'Carson Taylor',
      age: 27,
      level: 'AAA',
      milbImpactRanking: {
        rank: 8,
        rankPercentile: 99.891534,
        universeRows: 6_455,
        frozenAsOf: '2025-12-31T00:00:00.000Z',
        target: { id: 'mlb_war_next_5_ge_5' },
      },
      milbAlphaSignal: {
        eligible: false,
        rank: null,
        asOf: '2025-12-31T00:00:00.000Z',
        ageContext: {
          youngerThanPercent: 2,
          referencePlayers: 1_499,
          priorLevel: 'AAA',
        },
        gates: {
          supportedHistoricalContext: true,
          youngForRoleAndLevel: false,
          minimumRawWorkload: false,
          minimumPrimaryProbability: true,
          positivePrimaryModelEdge: true,
          positiveLongHorizonModelEdge: false,
        },
      },
      careerForecast: {
        asOf: '2025-12-31T00:00:00.000Z',
        rank: 2_121,
        hofCaliberProbability: 0.00012714,
        confidenceScore: 0.25,
        confidenceState: 'Low',
        finalCareerWar: { p10: -0.76, p25: -0.33, p50: -0.04, p75: 0.36, p90: 3.04 },
        decomposition: { estimatedDebutAge: 28 },
      },
      minorTraitEvidence: {
        opportunity: {
          state: 'sufficient',
          observed: { plateAppearances: 226, inningsPitched: null, pitches: null },
          thresholds: [{ unit: 'PA', provisional: 75, sufficient: 150 }],
        },
        coverage: {
          coveredPillarCount: 4,
          totalPillarCount: 4,
          missingPillars: [],
        },
        corroboration: { passesAllDescriptiveGates: false },
        strongestMetrics: [],
      },
    }), { minorUniverse: 6_179 })

    expect(profile.oracleScore).toMatchObject({
      value: 66,
      rank: 2_121,
      universe: 6_179,
      target: 'mlb-debut-age-mixed-final-standard-bridge-v1',
    })
    expect(profile.state).toBe('mapped')
    expect(profile.scores.outcome).toMatchObject({
      display: 'Needs more data',
      status: 'withheld',
      value: null,
      rank: null,
    })
    expect(profile.scores.trajectory).toMatchObject({
      display: 'Age 28',
      target: 'estimated_mlb_debut_age',
    })
    expect(profile.summary).toContain('Projected MLB arrival age is 28')
    expect(profile.signals.map((signal) => signal.code)).not.toContain('ceiling_readiness_split')
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

  it('keeps a Joe-like prospect prior while showing MLB confirmation separately', () => {
    const profile = buildPlayerMap(makePlayer({
      name: 'Joe Mack',
      stage: 'recent_callup',
      age: 23,
      level: 'MLB',
      metrics: [
        {
          key: 'current-season-war',
          label: 'Current-season WAR',
          value: '1.0 WAR',
          percentile: 72.7,
          source: 'Baseball-Reference',
        },
      ],
      careerForecast: {
        asOf: '2026-07-12T18:08:42.478Z',
        rank: null,
        hofCaliberProbability: null,
        confidenceScore: null,
        confidenceState: 'Withheld',
      },
      recentCallup: {
        version: 'rookie-track-v1',
        status: 'monitoring',
        reason: 'first_mlb_season_partial_only',
        prospectPrior: {
          rank: 167,
          universe: 6_455,
          target: 'mlb-debut-age-mixed-final-standard-bridge-v1',
          asOf: '2025-12-31T00:00:00.000Z',
          forecast: {
            confidenceState: 'Low',
            finalCareerWar: {
              p10: -1.034,
              p25: -0.355,
              p50: 0,
              p75: 2.494,
              p90: 12.988,
            },
          },
        },
        currentMlbEvidence: {
          asOf: '2026-07-13T13:19:52.068Z',
          opportunity: { label: 'PA', value: '172' },
          war: 1,
          warPercentile: 72.7,
        },
      },
    }), { mlbUniverse: 948, minorUniverse: 4_319 })

    expect(profile.route).toBe('rookie')
    expect(profile.mappingStatus).toBe('scored')
    expect(profile.state).toBe('discovery')
    expect(profile.oracleScore).toMatchObject({
      value: 97,
      route: 'rookie',
      rank: 167,
      universe: 6_455,
      target: 'mlb-debut-age-mixed-final-standard-bridge-v1',
      asOf: '2025-12-31T00:00:00.000Z',
    })
    expect(profile.scores.outcome).toMatchObject({
      display: 'P97',
      rank: 167,
      universe: 6_455,
      status: 'research',
    })
    expect(profile.scores.readiness).toMatchObject({
      display: 'Reached MLB',
      status: 'observed',
    })
    expect(profile.scores.trajectory).toMatchObject({
      label: 'Current MLB WAR standing',
      value: 72.7,
      display: 'P73',
      status: 'observed',
    })
    expect(profile.scores.evidence).toMatchObject({
      display: '172 PA',
      status: 'observed',
    })
    expect(profile.signals.map((signal) => signal.code)).toEqual([
      'prospect_prior_preserved',
      'mlb_confirmation',
    ])
    expect(profile.summary).toContain('Live evidence does not change the prospect-prior score')
  })

  it('keeps an unmatched first-season player in Rookie Track without inventing an Oracle Score', () => {
    const profile = buildPlayerMap(makePlayer({
      name: 'Coverage Gap Rookie',
      stage: 'recent_callup',
      age: 24,
      level: 'MLB',
      metrics: [],
      careerForecast: {
        asOf: '2026-07-12T18:08:42.478Z',
        rank: null,
        hofCaliberProbability: null,
        confidenceScore: null,
        confidenceState: 'Withheld',
      },
      recentCallup: {
        version: 'rookie-track-v1',
        status: 'monitoring',
        reason: 'first_mlb_season_partial_only',
        prospectPrior: null,
        currentMlbEvidence: {
          asOf: '2026-07-13T13:19:52.068Z',
          opportunity: { label: 'PA', value: '61' },
          war: 0.2,
          warPercentile: 41,
        },
      },
    }), { mlbUniverse: 948, minorUniverse: 4_319 })

    expect(profile.route).toBe('rookie')
    expect(profile.mappingStatus).toBe('coverage_gap')
    expect(profile.claimStatus).toBe('withheld')
    expect(profile.state).toBe('profile_only')
    expect(profile.oracleScore).toMatchObject({
      value: null,
      route: 'rookie',
      rank: null,
      universe: null,
      target: null,
      asOf: null,
    })
    expect(profile.scores.outcome).toMatchObject({
      value: null,
      display: 'Unavailable',
      status: 'withheld',
    })
    expect(profile.scores.trajectory).toMatchObject({
      value: 41,
      display: 'P41',
      status: 'observed',
    })
    expect(profile.signals.map((signal) => signal.code)).toEqual(['mlb_confirmation'])
    expect(profile.missingEvidence).toContain('Exact frozen prospect prior')
    expect(profile.summary).toContain('exact frozen prospect prior is unavailable')
  })
})
