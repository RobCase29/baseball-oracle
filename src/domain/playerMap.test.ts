import { describe, expect, it } from 'vitest'
import {
  buildCareerIndex,
  buildPlayerMap,
  buildStageStanding,
  CAREER_INDEX_DEFINITION,
  CAREER_INDEX_VERSION,
  careerIndexValue,
  careerIndexValueForWar,
  PLAYER_MAP_VERSION,
  stageTailBand,
  type PlayerMapInput,
} from './playerMap'

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
  it('keeps a post-debut assignment on the MLB career route', () => {
    const profile = buildPlayerMap(makePlayer({
      stage: 'post_debut_minors',
      careerForecast: null,
    }), { minorUniverse: 6_412, mlbUniverse: 1_000 })

    expect(profile.route).toBe('mlb')
    expect(profile.careerIndex.value).toBeNull()
    expect(profile.stageStanding).toMatchObject({ rank: null, universe: null })
    expect(profile.handling.primary?.code).toBe('post_debut_minor_assignment')
  })

  it('maps career WAR scenarios to a fixed, roster-independent career index', () => {
    expect(careerIndexValueForWar(-2)).toBe(0)
    expect(careerIndexValueForWar(5)).toBe(20)
    expect(careerIndexValueForWar(10)).toBeCloseTo(28.333, 3)
    expect(careerIndexValueForWar(60)).toBe(80)
    expect(careerIndexValueForWar(120)).toBe(100)
    expect(careerIndexValueForWar(Number.NaN)).toBeNull()

    expect(careerIndexValue({ p50: 0, p75: 2.494, p90: 12.988 })).toBe(9.7)
    expect(careerIndexValue({ p50: 20, p75: 40, p90: 60 })).toBe(58)
    expect(careerIndexValue({ p50: 20, p75: 10, p90: 60 })).toBeNull()

    expect(buildCareerIndex('rookie', { p50: 0, p75: 2.494, p90: 12.988 }, '2025-12-31')).toEqual({
      version: CAREER_INDEX_VERSION,
      value: 9.7,
      scale: 'fixed_career_value_index',
      route: 'rookie',
      basis: 'conditional_on_mlb_arrival',
      status: 'research',
      asOf: '2025-12-31',
      definition: CAREER_INDEX_DEFINITION,
      forecastLineage: {
        modelVersion: null,
        targetVersion: null,
        dataVersion: null,
        providerVersion: null,
      },
    })
    expect(buildCareerIndex('mlb', null, '2025-12-31')).toMatchObject({
      value: null,
      status: 'withheld',
      asOf: '2025-12-31',
    })
    expect(buildCareerIndex(
      'mlb',
      { p50: 40, p75: 60, p90: 80 },
      '2025-12-31',
      'withheld',
    )).toMatchObject({ value: null, status: 'withheld' })
  })

  it('keeps prospect arrival confidence separate from career magnitude if MLB is reached', () => {
    const profile = buildPlayerMap(makePlayer({
      name: 'Luis Arana',
      age: 18,
      agePercentile: 99.6,
      level: 'A',
      careerForecast: {
        asOf: '2025-12-31T00:00:00.000Z',
        rank: 194,
        hofCaliberProbability: 0.00234748,
        confidenceScore: 0.25,
        confidenceState: 'Low',
        finalCareerWar: { p10: 0, p25: 0, p50: 0, p75: 0.001, p90: 0.002 },
        finalCareerWarConditionalOnArrival: {
          p10: -1.08,
          p25: -0.27,
          p50: 0.33,
          p75: 10.17,
          p90: 29.425,
        },
        decomposition: { estimatedDebutAge: 21 },
      },
    }), { minorUniverse: 6_412 })

    expect(profile.careerIndex).toMatchObject({
      value: 20.1,
      basis: 'conditional_on_mlb_arrival',
      status: 'research',
    })
    expect(profile.stageStanding).toMatchObject({ rank: 194, universe: 6_412 })
    expect(profile.scores.trajectory).toMatchObject({ value: 99.6 })
  })

  it('keeps individualized young-player scores distinct when the conditional ceiling is tied', () => {
    const sharedForecast: NonNullable<PlayerMapInput['careerForecast']> = {
      asOf: '2025-12-31T00:00:00.000Z',
      rank: 100,
      hofCaliberProbability: 0.002,
      confidenceScore: 0.25,
      confidenceState: 'Low',
      finalCareerWar: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
      finalCareerWarConditionalOnArrival: {
        p10: -1.08,
        p25: -0.27,
        p50: 0.33,
        p75: 10.17,
        p90: 29.425,
      },
      decomposition: { estimatedDebutAge: 21 },
    }
    const players = [
      ['Edward Florentino', 34, 99.49],
      ['Dauri Fernandez', 163, 97.49],
      ['Jorge Quintana', 329, 94.92],
      ['Anderson Araujo', 2_280, 64.69],
      ['Daniel Hernandez', 4_585, 28.97],
    ] as const
    const profiles = players.map(([name, rank, percentile]) => buildPlayerMap(makePlayer({
      name,
      age: 19,
      level: 'A',
      careerForecast: sharedForecast,
      milbImpactRanking: {
        rank,
        rankPercentile: percentile,
        universeRows: 6_455,
        frozenAsOf: '2025-12-31T00:00:00.000Z',
        target: { id: 'mlb_war_next_5_ge_5' },
      },
    })))

    expect(new Set(profiles.map((profile) => profile.careerIndex.value))).toEqual(new Set([20.1]))
    expect(profiles.map((profile) => profile.scores.outcome.value)).toEqual([
      99.49,
      97.49,
      94.92,
      64.69,
      28.97,
    ])
    expect(profiles.map((profile) => profile.scores.outcome.rank)).toEqual([
      34,
      163,
      329,
      2_280,
      4_585,
    ])
    expect(profiles[0]?.scores.outcome).toMatchObject({
      label: 'Prospect Score',
      target: 'mlb_war_next_5_ge_5',
      universe: 6_455,
      status: 'research',
    })
  })

  it('withholds both index and standing when a forecast is explicitly withheld', () => {
    const profile = buildPlayerMap(makePlayer({
      stage: 'early_mlb',
      careerForecast: {
        publicationState: 'withheld',
        asOf: '2025-12-31T00:00:00.000Z',
        rank: 1,
        hofCaliberProbability: 0.5,
        confidenceScore: 0.5,
        confidenceState: 'Withheld',
        finalCareerWar: { p10: 10, p25: 20, p50: 40, p75: 60, p90: 80 },
      },
    }), { mlbUniverse: 100 })

    expect(profile.careerIndex).toMatchObject({ value: null, status: 'withheld' })
    expect(profile.stageStanding).toMatchObject({ rank: null, universe: null, topPercent: null })
    expect(profile.mappingStatus).toBe('withheld')
    expect(profile.claimStatus).toBe('withheld')
  })

  it('handles a two-way player explicitly while retaining observed career value', () => {
    const profile = buildPlayerMap(makePlayer({
      name: 'Shohei Ohtani',
      playerType: 'Two-way',
      stage: 'established_mlb',
      level: 'MLB',
      metrics: [
        {
          key: 'current-season-war',
          label: 'Current-season WAR',
          value: '6.0 WAR',
          percentile: null,
          source: 'Baseball-Reference',
        },
      ],
      provenance: {
        retrievedAt: '2026-07-13T12:00:00.000Z',
        externalIds: { mlbam: '660271', bbref: 'ohtansh01' },
      },
      careerForecast: {
        publicationState: 'withheld',
        asOf: '2025-12-31T00:00:00.000Z',
        rank: null,
        hofCaliberProbability: null,
        confidenceScore: null,
        confidenceState: 'Withheld',
        finalCareerWar: null,
        warnings: ['two_way_target_not_preregistered_forecast_withheld'],
      },
    }), { mlbUniverse: 948 })

    expect(profile.handling.primary).toMatchObject({
      code: 'two_way_model_scope',
      label: 'Two-way model pending',
    })
    expect(profile.summary.toLocaleLowerCase()).toContain('two-way')
    expect(profile.missingEvidence).toContain('Validated two-way career target and forecast')
    expect(profile.missingEvidence).not.toContain('Current MLB performance')
    expect(profile.nextEvidence).not.toContain('Current MLB performance and tracking ingestion')
    expect(profile.scores.bestTrait).toMatchObject({
      display: '6.0 WAR',
      status: 'observed',
      value: null,
    })
    expect(profile.scores.bestTrait.basis).toContain('role-relative percentile is unavailable')
    expect(profile.careerIndex.value).toBeNull()
    expect(profile.stageStanding.rank).toBeNull()
  })

  it('expresses stage rank as an exact top-share band without changing the career index', () => {
    expect(stageTailBand(0.1)).toBe('Top 0.1%')
    expect(stageTailBand(0.11)).toBe('Top 1%')
    expect(stageTailBand(5)).toBe('Top 5%')
    expect(stageTailBand(25.01)).toBe('Outside top 25%')
    expect(stageTailBand(null)).toBeNull()

    const joeStanding = buildStageStanding('rookie', 167, 6_455, '2025-12-31')
    expect(joeStanding).toMatchObject({
      version: 'stage-standing-v1',
      metric: 'prospect_career_outcome_rank',
      method: 'frozen_model_artifact_rank',
      direction: 'lower_is_better',
      scope: 'declared_model_cohort',
      isFilteredResultOrdinal: false,
      rank: 167,
      universe: 6_455,
      tailBand: 'Top 5%',
      cohort: 'frozen_prospect_prior',
      asOf: '2025-12-31',
    })
    expect(joeStanding.topPercent).toBeCloseTo(2.5871, 4)
    const boundaryStanding = buildStageStanding('milb', 323, 6_455, null)
    expect(boundaryStanding.topPercent).toBeCloseTo(5.0039, 4)
    expect(boundaryStanding.tailBand).toBe('Top 10%')
    expect(buildStageStanding('milb', null, 6_455, null)).toMatchObject({
      rank: null,
      universe: null,
      topPercent: null,
      tailBand: null,
      cohort: 'prospect_forecast',
    })
  })

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
        finalCareerWarConditionalOnArrival: { p10: 0, p25: 0, p50: 1, p75: 4, p90: 12 },
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
    expect(profile.claimStatus).toBe('research_only')
    expect(profile.state).toBe('discovery')
    expect(profile.stateLabel).toBe('Discovery')
    expect(profile.oracleScore).toEqual({
      deprecated: true,
      replacement: 'careerIndex',
      value: 96,
      scale: 'stage_rank_percentile',
      route: 'milb',
      rank: 258,
      universe: 6_455,
      target: 'mlb-debut-age-mixed-final-standard-bridge-v1',
      asOf: '2025-12-31T00:00:00.000Z',
      definition: 'Rounded stage-specific modeled outcome rank percentile; not a probability or composite score',
    })
    expect(profile.careerIndex).toMatchObject({
      version: CAREER_INDEX_VERSION,
      value: 13.1,
      route: 'milb',
      status: 'research',
    })
    expect(profile.stageStanding).toMatchObject({
      rank: 258,
      universe: 6_455,
      tailBand: 'Top 5%',
      cohort: 'prospect_forecast',
      asOf: '2025-12-31T00:00:00.000Z',
    })
    expect(profile.stageStanding.topPercent).toBeCloseTo(3.9969, 4)
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

  it('uses projected debut age for career ceiling and shrinks a fragile Carson-like impact rank', () => {
    const profile = buildPlayerMap(makePlayer({
      name: 'Carson Taylor',
      age: 27,
      level: 'AAA',
      milbImpactRanking: {
        rank: 8,
        rankPercentile: 99.891534,
        priorRank: 1_052,
        priorRankPercentile: 83.715525,
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
        finalCareerWarConditionalOnArrival: { p10: -0.76, p25: -0.33, p50: -0.04, p75: 0.36, p90: 3.04 },
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
    expect(profile.careerIndex).toMatchObject({ value: 2.9, status: 'research' })
    expect(profile.mappingStatus).toBe('insufficient_sample')
    expect(profile.state).toBe('monitor')
    expect(profile.scores.outcome).toMatchObject({
      display: 'P84',
      status: 'research',
      value: 83.715525,
      rank: 1_052,
    })
    expect(profile.scores.outcome.basis).toContain('hierarchical age, level, role, and performance prior')
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
        finalCareerWar: { p10: 5, p25: 10, p50: 20, p75: 40, p90: 60 },
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
    expect(profile.careerIndex).toMatchObject({
      value: 58,
      route: 'mlb',
      status: 'research',
    })
    expect(profile.stageStanding).toMatchObject({
      version: 'stage-standing-v1',
      metric: 'mlb_hof_caliber_rank',
      method: 'current_census_probability_rank',
      target: 'hof-caliber-point-in-time-jaws-v1',
      rank: 20,
      universe: 100,
      topPercent: 20,
      tailBand: 'Top 25%',
      cohort: 'current_mlb',
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
    expect(profile.careerIndexComparableAcrossRoutes).toBe(true)
    expect(profile.stageStandingComparableWithinStageOnly).toBe(true)
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
            finalCareerWarConditionalOnArrival: {
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
    expect(profile.careerIndex).toMatchObject({
      version: CAREER_INDEX_VERSION,
      value: 9.7,
      route: 'rookie',
      status: 'research',
      asOf: '2025-12-31T00:00:00.000Z',
    })
    expect(profile.stageStanding).toMatchObject({
      version: 'stage-standing-v1',
      metric: 'prospect_career_outcome_rank',
      method: 'frozen_model_artifact_rank',
      target: 'mlb-debut-age-mixed-final-standard-bridge-v1',
      rank: 167,
      universe: 6_455,
      tailBand: 'Top 5%',
      cohort: 'frozen_prospect_prior',
      asOf: '2025-12-31T00:00:00.000Z',
    })
    expect(profile.stageStanding.topPercent).toBeCloseTo(2.5871, 4)
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
    expect(profile.careerIndex).toMatchObject({
      value: null,
      route: 'rookie',
      status: 'withheld',
      asOf: null,
    })
    expect(profile.stageStanding).toEqual({
      version: 'stage-standing-v1',
      metric: 'prospect_career_outcome_rank',
      method: 'frozen_model_artifact_rank',
      direction: 'lower_is_better',
      scope: 'declared_model_cohort',
      isFilteredResultOrdinal: false,
      target: null,
      rank: null,
      universe: null,
      topPercent: null,
      tailBand: null,
      cohort: 'frozen_prospect_prior',
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
