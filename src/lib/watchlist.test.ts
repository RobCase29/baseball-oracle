import { describe, expect, it } from 'vitest'
import type { PlayerRecord } from '../domain/forecast'
import {
  loadStoredWatchlist,
  mergeRefreshedWatchlist,
  serializeWatchlist,
  watchlistIdBatches,
} from './watchlist'

function player(id: string, name: string, metricValue = '1.0 WAR'): PlayerRecord {
  return {
    id,
    name,
    initials: name.split(/\s+/u).map((part) => part[0]).join(''),
    organization: 'Example Club',
    organizationCode: 'EX',
    position: 'CF',
    playerType: 'Hitter',
    stage: 'early_mlb',
    age: 23,
    level: 'MLB',
    batsThrows: 'L/R',
    psScore: null,
    psPercentile: null,
    agePercentile: null,
    opportunity: { label: 'PA', value: '200' },
    metrics: [{
      key: 'current-season-war',
      label: 'Current-season WAR',
      value: metricValue,
      percentile: 70,
      source: 'Baseball-Reference',
    }],
    coverage: {
      label: 'Current statistics',
      hasStatcast: false,
      hasTraditional: true,
      hasComplementaryRows: false,
      levelsObserved: ['MLB'],
      organizationConflict: false,
    },
    provenance: {
      source: 'Baseball-Reference',
      dataset: 'Current MLB value',
      season: 2026,
      retrievedAt: '2026-07-13T10:17:00.000Z',
      cohort: null,
      externalIds: { bbref: id.replace('bbref:', ''), mlbam: 123456 },
    },
    researchEstimate: null,
    milbAlphaSignal: null,
    milbImpactRanking: null,
    minorTraitEvidence: null,
    careerForecast: null,
    playerMap: null,
  }
}

describe('watchlist persistence', () => {
  it('stores only durable identity and context, then restores an honest offline placeholder', () => {
    const saved = player('bbref:example01', 'Example Player')
    const serialized = serializeWatchlist([saved])

    expect(serialized).not.toContain('metrics')
    expect(serialized).not.toContain('careerForecast')
    expect(serialized).not.toContain('1.0 WAR')

    const restored = loadStoredWatchlist(serialized, null).get(saved.id)
    expect(restored).toMatchObject({
      id: saved.id,
      name: saved.name,
      stage: saved.stage,
      organizationCode: saved.organizationCode,
      metrics: [],
      careerForecast: null,
    })
    expect(restored?.provenance.externalIds).toEqual(saved.provenance.externalIds)
    expect(restored?.coverage.label).toContain('current data is temporarily unavailable')
  })

  it('accepts legacy v3 snapshots and does not resurrect them after a valid empty v4 save', () => {
    const legacy = player('bbref:legacy01', 'Legacy Player', '2.5 WAR')
    const legacyRaw = JSON.stringify([legacy])

    expect(loadStoredWatchlist(null, legacyRaw).get(legacy.id)?.metrics[0]?.value).toBe('2.5 WAR')
    expect(loadStoredWatchlist('{"version":4,"items":[]}', legacyRaw).size).toBe(0)
  })

  it('falls back to the legacy save when the v4 payload is corrupt', () => {
    const legacy = player('bbref:legacy01', 'Legacy Player')
    expect(loadStoredWatchlist('{not-json', JSON.stringify([legacy])).has(legacy.id)).toBe(true)
  })
})

describe('watchlist refresh reconciliation', () => {
  it('batches unique IDs within the endpoint limit', () => {
    expect(watchlistIdBatches(['one', 'two', 'one', 'three'], 2)).toEqual([
      ['one', 'two'],
      ['three'],
    ])
    expect(() => watchlistIdBatches(['one'], 0)).toThrow('positive integer')
  })

  it('replaces exact refreshed records without deleting missing saves or adding strangers', () => {
    const first = player('bbref:first01', 'First Player', '1.0 WAR')
    const second = player('bbref:second01', 'Second Player', '2.0 WAR')
    const refreshedFirst = player(first.id, first.name, '3.5 WAR')
    const stranger = player('bbref:stranger01', 'Stranger Player', '9.0 WAR')

    const merged = mergeRefreshedWatchlist(
      new Map([[first.id, first], [second.id, second]]),
      [refreshedFirst, stranger],
    )

    expect(merged.get(first.id)?.metrics[0]?.value).toBe('3.5 WAR')
    expect(merged.get(second.id)?.metrics[0]?.value).toBe('2.0 WAR')
    expect(merged.has(stranger.id)).toBe(false)
    expect(merged.size).toBe(2)
  })
})
