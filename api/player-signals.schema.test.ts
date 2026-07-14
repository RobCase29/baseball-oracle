import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Options } from 'ajv'
import type { Ajv2020 as Ajv2020Instance } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import type { PlayerSignalsRecord } from './_player-signals.js'
import { playerSignalsResponse, playerSignalsSnapshotId } from './_player-signals.js'

const schema = JSON.parse(readFileSync(
  new URL('../public/schemas/player-signals.v1.schema.json', import.meta.url),
  'utf8',
)) as object
const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020.js') as new (options?: Options) => Ajv2020Instance
const addFormats = require('ajv-formats') as (instance: Ajv2020Instance) => Ajv2020Instance
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false })
addFormats(ajv)
const validate = ajv.compile(schema)

function schemaErrors(value: unknown): string[] {
  if (validate(value)) return []
  return (validate.errors ?? []).map((error) => (
    `${error.instancePath || '/'} ${error.message ?? 'is invalid'} ${JSON.stringify(error.params)}`
  ))
}

function representativeRecord(): PlayerSignalsRecord {
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
      externalIds: { mlbam: 800001, prospectSavant: 'ps-1', minorMaster: 'sa123' },
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
    milbImpactRanking: { modelVersion: 'milb-impact-five-calendar-year-war-v1' },
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
  } as unknown as PlayerSignalsRecord
}

function representativeResponse(
  record: PlayerSignalsRecord = representativeRecord(),
  freshnessStatus: 'ok' | 'degraded' | 'stale' = 'ok',
) {
  return playerSignalsResponse({
    records: [record],
    snapshotId: playerSignalsSnapshotId({
      rankingSnapshotId: 'oracle-ranking-snapshot/v1:test',
      minorDataAsOf: '2026-07-13T22:00:00.000Z',
      currentMlbDataAsOf: null,
      forecastDataVersion: 'forecast-v1',
      currentResultsDigest: 'sha256:test',
      freshnessStatus,
    }),
    dataAsOf: '2026-07-13T22:00:00.000Z',
    freshness: {
      status: freshnessStatus,
      reasonCodes: freshnessStatus === 'stale' ? ['current_results_stale'] : [],
      statsChangedAt: '2026-07-13T22:00:00.000Z',
      lastCheckedAt: '2026-07-13T22:05:00.000Z',
      nextDueAt: '2026-07-14T10:17:00.000Z',
      cronObserved: true,
    },
    page: { page: 1, limit: 50, total: 1, totalPages: 1 },
    prospectCoverage: null,
  })
}

describe('player-signals.v1 JSON Schema', () => {
  it('accepts a response produced by the normalized serializer', () => {
    expect(schemaErrors(representativeResponse())).toEqual([])
  })

  it('rejects a fabricated global rank and cross-stage estimand claims', () => {
    const drifted = structuredClone(representativeResponse()) as unknown as {
      items: Array<{
        signals: {
          backstopRank: { availability: string; rank: number | null }
          careerOutlook: { estimandComparableAcrossStages: boolean }
        }
      }>
    }
    drifted.items[0].signals.backstopRank.availability = 'available'
    drifted.items[0].signals.backstopRank.rank = 1
    drifted.items[0].signals.careerOutlook.estimandComparableAcrossStages = true

    const errors = schemaErrors(drifted).join('\n')
    expect(errors).toContain('/signals/backstopRank/availability')
    expect(errors).toContain('/signals/backstopRank/rank')
    expect(errors).toContain('/signals/careerOutlook/estimandComparableAcrossStages')
  })

  it('rejects route-label drift between a prospect and its stage rank', () => {
    const drifted = structuredClone(representativeResponse()) as unknown as {
      items: Array<{ signals: { stageRank: { label: string; metricId: string } } }>
    }
    drifted.items[0].signals.stageRank.label = 'MLB Career Rank'
    drifted.items[0].signals.stageRank.metricId = 'mlb_career_outlook_standing'

    const errors = schemaErrors(drifted).join('\n')
    expect(errors).toContain('/signals/stageRank/label')
    expect(errors).toContain('/signals/stageRank/metricId')
  })

  it('allows a ranked thin-sample prior but rejects unavailable results represented as zero', () => {
    const thin = structuredClone(representativeResponse()) as unknown as {
      items: Array<{
        signals: {
          stageRank: { availability: string; reasonCodes: string[] }
          currentResults: {
            availability: string
            source: string | null
            hitting: unknown
            totalWar: number | null
          }
        }
      }>
    }
    thin.items[0].signals.stageRank.availability = 'insufficient_sample'
    thin.items[0].signals.stageRank.reasonCodes = ['thin_sample_prior']
    expect(schemaErrors(thin)).toEqual([])

    thin.items[0].signals.currentResults.availability = 'unavailable'
    thin.items[0].signals.currentResults.source = null
    thin.items[0].signals.currentResults.hitting = null
    thin.items[0].signals.currentResults.totalWar = 0
    expect(schemaErrors(thin).join('\n')).toContain('/signals/currentResults/totalWar')
  })

  it('publishes live in-season ranks with explicit evidence time and volatility', () => {
    const live = structuredClone(representativeResponse()) as unknown as {
      items: Array<{
        signals: {
          stageRank: {
            availability: string
            reasonCodes: string[]
            evidenceTier: string
            volatility: string
            asOf: string | null
            modelVersion: string | null
          }
        }
      }>
      meta: { prospectCoverage: Record<string, unknown> | null }
    }
    Object.assign(live.items[0].signals.stageRank, {
      availability: 'insufficient_sample',
      reasonCodes: ['live_in_season_prior'],
      evidenceTier: 'live_in_season_prior',
      volatility: 'high',
      asOf: '2026-07-13T22:00:00.000Z',
      modelVersion: 'milb-impact-live-prior-v1',
    })
    live.meta.prospectCoverage = {
      version: 'prospect-coverage/v1',
      census: {
        source: 'MLB StatsAPI affiliated full rosters',
        asOf: '2026-07-13T22:00:00.000Z',
        rosterPlayers: 8_200,
        rosteredPreDebutPlayers: 6_500,
        servedRosteredPreDebutPlayers: 6_500,
        missingRosteredPreDebutPlayers: 0,
        status: 'complete',
      },
      sourceUnionPreDebutPlayers: 6_900,
      identity: { mlbamLinkedPlayers: 6_850, profileOnlyPlayers: 50 },
      prospectRank: {
        availablePlayers: 6_700,
        fullModelPlayers: 4_000,
        thinSamplePriorPlayers: 600,
        liveInSeasonPriorPlayers: 2_100,
        frozenModelGapPlayers: 200,
        coverageRate: 0.971,
        frozenAsOf: '2025-12-31T00:00:00.000Z',
      },
      careerOutlook: { availablePlayers: 4_600, coverageRate: 0.667 },
      currentResults: { availablePlayers: 6_100, coverageRate: 0.884 },
      nullPolicy: 'unavailable_not_zero',
    }

    expect(schemaErrors(live)).toEqual([])
    const veryHighVolatility = structuredClone(live)
    veryHighVolatility.items[0].signals.stageRank.volatility = 'very_high'
    expect(schemaErrors(veryHighVolatility)).toEqual([])

    const understated = structuredClone(live)
    understated.items[0].signals.stageRank.reasonCodes = []
    understated.items[0].signals.stageRank.volatility = 'standard'
    understated.items[0].signals.stageRank.asOf = null
    const errors = schemaErrors(understated).join('\n')
    expect(errors).toContain('/signals/stageRank/reasonCodes')
    expect(errors).toContain('/signals/stageRank/volatility')
    expect(errors).toContain('/signals/stageRank/asOf')

    const incompleteCoverage = structuredClone(live) as unknown as {
      meta: { prospectCoverage: { prospectRank: Record<string, unknown> } }
    }
    delete incompleteCoverage.meta.prospectCoverage.prospectRank.liveInSeasonPriorPlayers
    expect(schemaErrors(incompleteCoverage).join('\n')).toContain(
      '/meta/prospectCoverage/prospectRank',
    )
  })

  it('requires rank evidence fields to be null when Stage Rank is unavailable', () => {
    const unavailable = structuredClone(representativeResponse()) as unknown as {
      items: Array<{
        signals: {
          stageRank: {
            availability: string
            reasonCodes: string[]
            rank: number | null
            universe: number | null
            evidenceTier: string | null
            volatility: string | null
          }
        }
      }>
    }
    Object.assign(unavailable.items[0].signals.stageRank, {
      availability: 'unavailable',
      reasonCodes: ['frozen_model_coverage_gap'],
      rank: null,
      universe: null,
      evidenceTier: null,
      volatility: null,
    })
    expect(schemaErrors(unavailable)).toEqual([])

    unavailable.items[0].signals.stageRank.evidenceTier = 'completed_season_full_model'
    unavailable.items[0].signals.stageRank.volatility = 'standard'
    const errors = schemaErrors(unavailable).join('\n')
    expect(errors).toContain('/signals/stageRank/evidenceTier')
    expect(errors).toContain('/signals/stageRank/volatility')
  })

  it('accepts rookie, two-way MLB, stale, and unavailable result states', () => {
    const base = representativeRecord()
    const rookie = {
      ...base,
      stage: 'recent_callup',
      level: 'MLB',
      currentMinorStats: null,
      currentMlbStats: {
        source: 'Baseball-Reference',
        season: 2026,
        asOf: '2026-07-14T10:19:21.507Z',
        totalWar: 1.03,
        warPercentile: 73.8,
        hitting: { pa: 172, war: 1.03 },
        pitching: null,
      },
      recentCallup: {
        prospectPrior: {
          impactRank: { modelVersion: 'milb-impact-five-calendar-year-war-v1' },
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
    } as unknown as PlayerSignalsRecord
    expect(schemaErrors(representativeResponse(rookie))).toEqual([])

    const twoWayMlb = {
      ...base,
      playerType: 'Two-way',
      stage: 'established_mlb',
      level: 'MLB',
      currentMinorStats: null,
      currentMlbStats: {
        source: 'Baseball-Reference',
        season: 2026,
        asOf: '2026-07-14T10:19:21.507Z',
        totalWar: 6,
        warPercentile: 99.9,
        hitting: { pa: 406, war: 5.1 },
        pitching: { ip: 42, outs: 126, games: 10, gamesStarted: 10, war: 0.9 },
      },
      careerForecast: {
        finalCareerWar: { p10: 20, p25: 35, p50: 50, p75: 70, p90: 90 },
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
    } as unknown as PlayerSignalsRecord
    expect(schemaErrors(representativeResponse(twoWayMlb))).toEqual([])
    expect(schemaErrors(representativeResponse(twoWayMlb, 'stale'))).toEqual([])

    const unavailable = {
      ...base,
      currentMinorStats: null,
    } as unknown as PlayerSignalsRecord
    expect(schemaErrors(representativeResponse(unavailable))).toEqual([])
  })
})
