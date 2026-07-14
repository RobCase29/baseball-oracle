import { describe, expect, it } from 'vitest'
import type { PlayerSignalsRecord } from './_player-signals.js'
import {
  playerSignalsItem,
  playerSignalsResponse,
  playerSignalsSnapshotId,
} from './_player-signals.js'
import {
  currentMlbStatsSnapshot,
  currentResultsSnapshotDigest,
  type CurrentMinorStatsRow,
  type CurrentMlbValueRow,
} from './players.js'

function currentMinorRow(overrides: Partial<CurrentMinorStatsRow> = {}): CurrentMinorStatsRow {
  return {
    mlbam_id: 800001,
    player_type: 'Hitter',
    season: 2026,
    current_level: 'AA',
    highest_observed_level: 'AA',
    levels_observed: ['AA'],
    known_at: '2026-07-13T22:00:00.000Z',
    pa: 250,
    ba: 0.285,
    obp: 0.36,
    slg: 0.47,
    ops: 0.83,
    home_runs: 12,
    walks: 30,
    strikeouts: 44,
    stolen_bases: 18,
    ip: null,
    outs: null,
    era: null,
    whip: null,
    pitching_strikeout_rate: null,
    pitching_walk_rate: null,
    k_minus_bb_rate: null,
    pitching_strikeouts: null,
    walks_allowed: null,
    ...overrides,
  }
}

function currentMlbRow(overrides: Partial<CurrentMlbValueRow> = {}): CurrentMlbValueRow {
  return {
    bbref_id: 'mackjo01',
    mlbam_id: 691176,
    player_name: 'Joe Mack',
    season: 2026,
    observed_role: 'Hitter',
    team: 'MIA',
    position: 'C',
    age: 23,
    b_pa: 172,
    b_war: 1.03,
    p_ip: null,
    p_ip_outs: null,
    p_games: null,
    p_games_started: null,
    p_war: null,
    total_war: 1.03,
    current_war_percentile: 73.8,
    known_at: '2026-07-14T10:19:21.507Z',
    ...overrides,
  }
}

function record(overrides: Record<string, unknown> = {}): PlayerSignalsRecord {
  return {
    id: 'prospect-savant:minor:sa123:hitters',
    name: 'Test Prospect',
    organization: 'Miami Marlins',
    organizationCode: 'MIA',
    position: 'SS',
    playerType: 'Hitter',
    stage: 'pre_debut',
    age: 19,
    level: 'AA',
    provenance: {
      season: 2026,
      retrievedAt: '2026-07-13T22:00:00.000Z',
      externalIds: {
        mlbam: 800001,
        bbref: null,
        prospectSavant: 'ps-1',
        minorMaster: 'sa123',
      },
    },
    currentMinorStats: {
      source: 'MLB StatsAPI',
      season: 2026,
      asOf: '2026-07-13T22:00:00.000Z',
      currentLevel: 'AA',
      highestObservedLevel: 'AA',
      levelsObserved: ['AA'],
      opportunity: { label: 'PA', value: '250' },
      hitting: {
        pa: 250,
        ba: 0.285,
        obp: 0.36,
        slg: 0.47,
        ops: 0.83,
        homeRuns: 12,
        walks: 30,
        strikeouts: 44,
        stolenBases: 18,
      },
      pitching: null,
    },
    careerForecast: {
      finalCareerWarConditionalOnArrival: {
        p10: -1,
        p25: 1,
        p50: 8,
        p75: 24,
        p90: 48,
      },
    },
    milbImpactRanking: {
      modelVersion: 'milb-impact-five-calendar-year-war-v1',
    },
    playerMap: {
      route: 'milb',
      mappingStatus: 'scored',
      handling: { primary: null, notes: [] },
      careerIndex: {
        version: 'career-index-war-v2',
        value: 52.4,
        basis: 'conditional_on_mlb_arrival',
        status: 'research',
        asOf: '2025-12-31T00:00:00.000Z',
        forecastLineage: { modelVersion: 'career-bridge-v1' },
      },
      scores: {
        outcome: {
          rank: 14,
          universe: 6455,
          target: 'mlb_war_next_5_ge_5',
          asOf: '2025-12-31T00:00:00.000Z',
        },
      },
      stageStanding: {
        rank: 9,
        universe: 6412,
        target: 'legacy-target',
        cohort: 'prospect_forecast',
        asOf: '2025-12-31T00:00:00.000Z',
      },
    },
    ...overrides,
  } as unknown as PlayerSignalsRecord
}

describe('player signals normalization', () => {
  it('keeps the future global Backstop Rank withheld and publishes an honest Prospect Rank', () => {
    const item = playerSignalsItem(record())

    expect(item.signals.backstopRank).toMatchObject({
      availability: 'withheld',
      rank: null,
      universe: null,
      comparableAcrossStages: false,
      intendedComparableAcrossStages: true,
    })
    expect(item.signals.stageRank).toMatchObject({
      label: 'Prospect Rank',
      availability: 'available',
      rank: 14,
      universe: 6455,
      metricId: 'milb_five_year_impact',
      comparableAcrossStages: false,
    })
    expect(item.signals.careerOutlook).toMatchObject({
      value: 52.4,
      band: { id: 'mlb_regular', label: 'MLB regular' },
      arrivalDependent: true,
      scaleComparableAcrossStages: true,
      estimandComparableAcrossStages: false,
    })
  })

  it('normalizes numeric MiLB results without blending them into a forecast', () => {
    const results = playerSignalsItem(record()).signals.currentResults

    expect(results).toMatchObject({
      availability: 'available',
      competition: 'MiLB',
      source: 'MLB StatsAPI',
      workload: { plateAppearances: 250, inningsPitched: null },
      totalWar: null,
      hitting: { pa: 250, ba: 0.285, homeRuns: 12, war: null },
      pitching: null,
    })
  })

  it('marks a ranked thin-sample prospect as insufficient sample instead of fully available', () => {
    const item = playerSignalsItem(record({
      playerMap: {
        ...(record().playerMap),
        mappingStatus: 'insufficient_sample',
      },
    }))

    expect(item.signals.stageRank).toMatchObject({
      rank: 14,
      availability: 'insufficient_sample',
      reasonCodes: ['thin_sample_prior'],
    })
  })

  it('preserves a rookie pre-debut rank while adding live MLB confirmation', () => {
    const base = record()
    const item = playerSignalsItem(record({
      stage: 'recent_callup',
      level: 'MLB',
      currentMinorStats: null,
      currentMlbStats: {
        source: 'Baseball-Reference',
        season: 2026,
        asOf: '2026-07-13T22:00:00.000Z',
        totalWar: 1,
        warPercentile: 71.4,
        hitting: { pa: 172, war: 1 },
        pitching: null,
      },
      recentCallup: {
        prospectPrior: {
          impactRank: {
            modelVersion: 'milb-impact-five-calendar-year-war-v1',
          },
          forecast: base.careerForecast,
        },
      },
      playerMap: {
        ...base.playerMap,
        route: 'rookie',
        stageStanding: {
          rank: 189,
          universe: 6455,
          target: 'mlb_war_next_5_ge_5',
          cohort: 'frozen_prospect_prior',
          asOf: '2025-12-31T00:00:00.000Z',
        },
      },
    }))

    expect(item.transition).toEqual({
      status: 'rookie_monitoring',
      priorRoute: 'milb',
      priorRankPreserved: true,
      updatePolicy: 'frozen_pre_debut_prior_with_live_confirmation',
    })
    expect(item.signals.stageRank).toMatchObject({
      label: 'Pre-Debut Rank',
      rank: 189,
      carriedForward: true,
      originRoute: 'milb',
    })
    expect(item.signals.currentResults).toMatchObject({
      competition: 'MLB',
      totalWar: 1,
      workload: { plateAppearances: 172, inningsPitched: null },
    })
  })

  it('treats a two-way player as a hitter for ranking while retaining both observed roles', () => {
    const base = record()
    const item = playerSignalsItem(record({
      playerType: 'Two-way',
      stage: 'established_mlb',
      level: 'MLB',
      currentMinorStats: null,
      currentMlbStats: {
        source: 'Baseball-Reference',
        season: 2026,
        asOf: '2026-07-13T22:00:00.000Z',
        totalWar: 6,
        warPercentile: 99.9,
        hitting: { pa: 406, war: 5.1 },
        pitching: { ip: 42, outs: 126, games: 10, gamesStarted: 10, war: 0.9 },
      },
      playerMap: {
        ...base.playerMap,
        route: 'mlb',
        careerIndex: {
          ...base.playerMap.careerIndex,
          basis: 'current_mlb_terminal',
        },
        stageStanding: {
          rank: 13,
          universe: 949,
          target: 'hof-caliber-point-in-time-jaws-v1',
          cohort: 'current_mlb',
          asOf: '2025-12-31T00:00:00.000Z',
        },
      },
    }))

    expect(item.classification).toMatchObject({
      rankingRole: 'hitter',
      observedRoles: ['hitter', 'pitcher'],
    })
    expect(item.signals.currentResults).toMatchObject({
      hitting: { pa: 406, war: 5.1 },
      pitching: { ip: 42, outs: 126, war: 0.9 },
    })
  })

  it('uses pitching outs instead of parsing baseball innings notation as a decimal', () => {
    const stats = currentMlbStatsSnapshot({
      bbref_id: 'pitchte01',
      player_name: 'Test Pitcher',
      season: 2026,
      observed_role: 'Pitcher',
      team: 'MIA',
      position: 'P',
      age: 24,
      b_pa: 0,
      b_war: 0,
      p_ip: '12.2',
      p_ip_outs: 38,
      p_games: 4,
      p_games_started: 3,
      p_war: 0.4,
      total_war: 0.4,
      current_war_percentile: 60,
      known_at: '2026-07-13T22:00:00.000Z',
    })

    expect(stats?.pitching).toMatchObject({ outs: 38, ip: 38 / 3 })
    expect(stats?.pitching?.ip).not.toBe(12.2)
  })

  it('changes record and snapshot versions when normalized results change', () => {
    const first = playerSignalsItem(record())
    const changedRecord = record({
      currentMinorStats: {
        ...record().currentMinorStats,
        hitting: { ...record().currentMinorStats?.hitting, pa: 251 },
      },
    })
    const second = playerSignalsItem(changedRecord)
    expect(first.recordVersion).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(second.recordVersion).not.toBe(first.recordVersion)

    const firstSnapshot = playerSignalsSnapshotId({
      rankingSnapshotId: 'oracle-ranking-snapshot/v1:first',
      minorDataAsOf: '2026-07-13T22:00:00.000Z',
      currentMlbDataAsOf: null,
      forecastDataVersion: 'forecast-v1',
      currentResultsDigest: 'sha256:first',
      freshnessStatus: 'ok',
    })
    const secondSnapshot = playerSignalsSnapshotId({
      rankingSnapshotId: 'oracle-ranking-snapshot/v1:first',
      minorDataAsOf: '2026-07-14T10:00:00.000Z',
      currentMlbDataAsOf: null,
      forecastDataVersion: 'forecast-v1',
      currentResultsDigest: 'sha256:second',
      freshnessStatus: 'ok',
    })
    expect(firstSnapshot).toMatch(/^player-signals-snapshot\/v1:[a-f0-9]{64}$/u)
    expect(secondSnapshot).not.toBe(firstSnapshot)
  })

  it('makes the current-results digest order-independent and sensitive to served stats', () => {
    const firstMinor = currentMinorRow()
    const secondMinor = currentMinorRow({ mlbam_id: 800002, pa: 110, home_runs: 4 })
    const firstMlb = currentMlbRow()
    const secondMlb = currentMlbRow({
      bbref_id: 'ohtansh01',
      mlbam_id: 660271,
      player_name: 'Shohei Ohtani',
      observed_role: 'Two-way',
      b_pa: 406,
      b_war: 5.1,
      p_ip: '42.0',
      p_ip_outs: 126,
      p_games: 10,
      p_games_started: 10,
      p_war: 0.9,
      total_war: 6,
      current_war_percentile: 99.9,
    })

    const canonical = currentResultsSnapshotDigest(
      [firstMinor, secondMinor],
      [firstMlb, secondMlb],
    )
    const reordered = currentResultsSnapshotDigest(
      [secondMinor, firstMinor],
      [secondMlb, firstMlb],
    )
    const changedMinor = currentResultsSnapshotDigest(
      [firstMinor, { ...secondMinor, home_runs: 5 }],
      [firstMlb, secondMlb],
    )
    const changedMlb = currentResultsSnapshotDigest(
      [firstMinor, secondMinor],
      [firstMlb, { ...secondMlb, p_ip_outs: 127 }],
    )

    expect(canonical).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(reordered).toBe(canonical)
    expect(changedMinor).not.toBe(canonical)
    expect(changedMlb).not.toBe(canonical)
  })

  it('marks current results stale with the response snapshot and withholds protected quantiles', () => {
    const staleResponse = playerSignalsResponse({
      records: [record()],
      snapshotId: playerSignalsSnapshotId({
        rankingSnapshotId: 'oracle-ranking-snapshot/v1:stale',
        minorDataAsOf: '2026-07-01T00:00:00.000Z',
        currentMlbDataAsOf: null,
        forecastDataVersion: 'forecast-v1',
        currentResultsDigest: 'sha256:stale',
        freshnessStatus: 'stale',
      }),
      dataAsOf: '2026-07-01T00:00:00.000Z',
      freshness: {
        status: 'stale',
        reasonCodes: ['current_minor_stats_stale'],
        statsChangedAt: '2026-07-01T00:00:00.000Z',
        lastCheckedAt: '2026-07-14T10:17:00.000Z',
        nextDueAt: '2026-07-14T22:17:00.000Z',
        cronObserved: true,
      },
      page: { page: 1, limit: 50, total: 1, totalPages: 1 },
    })
    expect(staleResponse.items[0].signals.currentResults).toMatchObject({
      availability: 'stale',
      reasonCodes: ['source_snapshot_stale'],
    })

    const withheld = playerSignalsItem(record({
      playerMap: {
        ...record().playerMap,
        careerIndex: {
          ...record().playerMap.careerIndex,
          status: 'withheld',
          value: 52.4,
        },
      },
    }))
    expect(withheld.signals.careerOutlook).toMatchObject({
      availability: 'withheld',
      value: null,
      band: null,
      finalCareerWar: null,
    })
  })

  it('publishes explicit contract limitations in the response metadata', () => {
    const response = playerSignalsResponse({
      records: [record()],
      snapshotId: playerSignalsSnapshotId({
        rankingSnapshotId: 'oracle-ranking-snapshot/v1:test',
        minorDataAsOf: '2026-07-13T22:00:00.000Z',
        currentMlbDataAsOf: null,
        forecastDataVersion: 'forecast-v1',
        currentResultsDigest: 'sha256:test',
        freshnessStatus: 'ok',
      }),
      dataAsOf: '2026-07-13T22:00:00.000Z',
      freshness: {
        status: 'ok',
        reasonCodes: [],
        statsChangedAt: '2026-07-13T22:00:00.000Z',
        lastCheckedAt: '2026-07-13T22:05:00.000Z',
        nextDueAt: '2026-07-14T10:17:00.000Z',
        cronObserved: true,
      },
      page: { page: 1, limit: 50, total: 1, totalPages: 1 },
    })

    expect(response).toMatchObject({
      schemaVersion: 'player-signals.v1',
      contractVersion: 'player-signals-contract/v1',
      meta: {
        backstopRankStatus: 'withheld_pending_unified_unconditional_model',
        stageRanksComparableAcrossStages: false,
        currentResultsNormalizedAcrossStages: true,
      },
    })
  })
})
