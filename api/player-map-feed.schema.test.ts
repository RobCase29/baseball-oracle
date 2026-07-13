import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Options } from 'ajv'
import type { Ajv2020 as Ajv2020Instance } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { buildPlayerMap } from '../src/domain/playerMap.js'
import type { PlayerMapFeedResponse } from '../src/domain/forecast.js'
import {
  playerMapFeedItem,
  playerMapResponseMeta,
  responseOrdering,
  snapshotId,
  type UnifiedBoardCandidate,
} from './players.js'

const schema = JSON.parse(readFileSync(
  new URL('../public/schemas/player-map-feed.v4.schema.json', import.meta.url),
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

function representativeResponse(): PlayerMapFeedResponse {
  const forecast = {
    publicationState: 'research' as const,
    asOf: '2026-07-12T00:00:00.000Z',
    rank: 258,
    hofCaliberProbability: 0.04,
    confidenceScore: 0.62,
    confidenceState: 'Moderate',
    lineage: {
      modelVersion: 'career-v1',
      targetVersion: 'mlb-debut-age-mixed-final-standard-bridge-v1',
      dataVersion: 'data-v1',
      providerVersion: null,
    },
    finalCareerWar: { p10: 1, p25: 4, p50: 12, p75: 28, p90: 52 },
    finalCareerWarConditionalOnArrival: { p10: 1, p25: 4, p50: 12, p75: 28, p90: 52 },
    decomposition: { estimatedDebutAge: 24 },
    careerChapter: null,
    alphaSignal: null,
  }
  const playerMap = buildPlayerMap({
    name: 'Aiva Arquette',
    playerType: 'Hitter',
    stage: 'pre_debut',
    age: 22,
    level: 'AA',
    metrics: [],
    provenance: { retrievedAt: '2026-07-13T00:00:00.000Z' },
    careerForecast: forecast,
  }, { minorUniverse: 6_455 })
  const item = playerMapFeedItem({
    id: 'prospect-savant:804109',
    name: 'Aiva Arquette',
    playerType: 'Hitter',
    stage: 'pre_debut',
    age: 22,
    level: 'AA',
    organization: 'Miami Marlins',
    organizationCode: 'MIA',
    position: 'SS',
    provenance: {
      externalIds: { mlbam: 804109, prospectSavant: 'aiva-arquette', bbref: null },
    },
    playerMap,
  } as unknown as Parameters<typeof playerMapFeedItem>[0])
  const candidate = {
    id: 'prospect-savant:804109',
    source: 'minor',
    name: 'Aiva Arquette',
    playerType: 'Hitter',
    stage: 'pre_debut',
    age: 22,
    level: 'AA',
    organization: 'Miami Marlins',
    organizationCode: 'MIA',
    position: 'SS',
    mlbamId: '804109',
    opportunityScore: 100,
    careerForecast: forecast,
    milbAlphaSignal: null,
    milbImpactRanking: null,
    arrivalProbability36: null,
    minorProfileId: 'prospect-savant:804109',
    previewPlayer: null,
    recentCallupPrior: null,
  } as unknown as UnifiedBoardCandidate

  return {
    schemaVersion: 'player-map-feed.v4',
    items: [item],
    page: { page: 1, limit: 50, total: 1, totalPages: 1 },
    meta: {
      source: 'Baseball Oracle',
      dataAsOf: '2026-07-13T00:00:00.000Z',
      season: 2026,
      coverage: 'Representative compact feed contract',
      forecastStatus: 'research_only',
      snapshotId: snapshotId({
        minorDataAsOf: '2026-07-13T00:00:00.000Z',
        currentMlbDataAsOf: '2026-07-13T00:00:00.000Z',
        forecastDataVersion: 'data-v1',
        candidates: [candidate],
      }),
      snapshotScope: 'ranking_and_census',
      ...playerMapResponseMeta([candidate]),
      ordering: responseOrdering({ stage: 'All', sort: 'careerIndex', view: 'map' }),
      identity: {
        minorRoleRows: 1,
        canonicalMinorPlayers: 1,
        duplicateMinorRoleRowsRemoved: 0,
        minorTwoWayPlayers: 0,
        crossStageDuplicatesRemoved: 0,
        minorPlayersMissingMlbam: 0,
        mlbPlayersMissingMlbam: 0,
        currentMlbProfilesOutsideModelCensus: 0,
        experiencedMinorRowsExcludedFromRankings: 0,
        currentSeasonDebutMinorRowsIdentified: 0,
        minorIdsRecoveredFromExactCrosswalk: 0,
        identityPolicy:
          'exact_mlbam_bbref_plus_durable_chadwick_overlay_no_name_matching',
        identityCrosswalkAsOf: '2026-07-12T18:30:20.537Z',
        identityCrosswalkRecords: 23_752,
        identityCrosswalkStatus: 'current',
        identityCrosswalkAgeHours: 5.5,
        identityCrosswalkMaxAgeHours: 168,
        identityOverlayRecords: 0,
        identityOverlayConflicts: 0,
        identityOverlayNewestObservedAt: null,
        currentMlbRows: 1,
        unmatchedCurrentBbrefIds: 0,
        conflictingCurrentMlbIds: 0,
      },
    },
  }
}

describe('player-map-feed.v4 JSON Schema', () => {
  it('accepts a representative response produced by the compact feed serializers', () => {
    expect(schemaErrors(representativeResponse())).toEqual([])
  })

  it('rejects ranking semantic drift and incomplete migration markers', () => {
    const response = representativeResponse()
    response.meta.prospectScoreContract = playerMapResponseMeta([], {
      stage: 'Minors',
      sort: 'prospectScore',
      view: 'map',
    }).prospectScoreContract
    const drifted = structuredClone(response) as unknown as {
      items: Array<{
        assessment: {
          careerIndex: { scale: string }
          stageStanding: { cohort: string }
          oracleScore: Record<string, unknown>
        }
      }>
      meta: {
        snapshotId: string
        prospectScoreContract: {
          calibratedProbability: boolean
        }
        ordering: {
          requestedSort: string
          appliedSort: string
          legacyAliasUsed: boolean
          field: string | null
          fieldExposed: boolean
        }
      }
    }
    drifted.items[0].assessment.careerIndex.scale = 'probability_percent'
    drifted.items[0].assessment.stageStanding.cohort = 'current_mlb'
    delete drifted.items[0].assessment.oracleScore.deprecated
    drifted.meta.snapshotId = 'moving-target'
    drifted.meta.prospectScoreContract.calibratedProbability = true
    drifted.meta.ordering.fieldExposed = false
    drifted.meta.ordering.requestedSort = 'alphaOpportunity'
    drifted.meta.ordering.appliedSort = 'name'
    drifted.meta.ordering.legacyAliasUsed = false

    const errors = schemaErrors(drifted).join('\n')
    expect(errors).toContain('/assessment/careerIndex/scale')
    expect(errors).toContain('/assessment/stageStanding/cohort')
    expect(errors).toContain('/assessment/oracleScore must have required property')
    expect(errors).toContain('/meta/snapshotId must match pattern')
    expect(errors).toContain('/meta/prospectScoreContract/calibratedProbability must be equal to constant')
    expect(errors).toContain('/meta/ordering/field must be null')
    expect(errors).toContain('/meta/ordering/appliedSort must be equal to constant')
    expect(errors).toContain('/meta/ordering/legacyAliasUsed must be equal to constant')
  })

  it('requires a complete, single-role official minor-league stat payload', () => {
    const response = structuredClone(representativeResponse()) as unknown as {
      items: Array<{
        currentEvidence: {
          minorStats: Record<string, unknown> | null
        }
      }>
    }
    response.items[0].currentEvidence.minorStats = {
      source: 'MLB StatsAPI',
      season: 2026,
      asOf: '2026-07-13T00:00:00.000Z',
      currentLevel: 'A',
      highestObservedLevel: 'A',
      levelsObserved: ['A', 'Rk'],
      opportunity: { label: 'PA', value: '208' },
      hitting: null,
      pitching: null,
    }

    const errors = schemaErrors(response).join('\n')
    expect(errors).toContain('/currentEvidence/minorStats')
  })
})
