import { describe, expect, it } from 'vitest'
import {
  assertFangraphsCurrentEnvelope,
  buildFangraphsCurrentProspectsUrl,
  idempotencyKey,
  normalizeRequestUrl,
  parseFangraphsEnvelope,
  requestFingerprint,
  schemaFingerprint,
  sourceRecordKey,
  stableStringify,
} from './fangraphs.js'
import { assertFangraphsCurrentSnapshot } from './fangraphs-prospects.js'

const syntheticEnvelope = {
  dataScout: [
    {
      RowID: 'invented-scout-1',
      UPID: 'invented-player-1',
      minorMasterId: 'invented-minor-1',
      Season: 2021,
      FirstName: 'Sample',
      LastName: 'Hitter',
      FV_Current: '45+',
      pHit: 40,
      fHit: 55,
      Summary: '<p>Invented fixture prose.</p>',
    },
  ],
  dataStats: [
    {
      UPID: 'invented-player-1',
      minormasterid: 'invented-minor-1',
      Season: 2021,
      level: 'AA',
      Team: 'SYN',
      PA: 250,
      xMLBAMID: 999_001,
      HR: 12,
      wRC: 118,
    },
  ],
}

describe('FanGraphs ingestion contract', () => {
  it('parses the expected envelope without depending on live row values', () => {
    const parsed = parseFangraphsEnvelope(JSON.stringify(syntheticEnvelope))
    expect(parsed.dataScout).toHaveLength(1)
    expect(parsed.dataStats).toHaveLength(1)
  })

  it('normalizes query order for stable request identity', () => {
    const left = normalizeRequestUrl('https://example.test/data?season=2021&team=SEA')
    const right = normalizeRequestUrl('https://example.test/data?team=SEA&season=2021')
    expect(left).toBe(right)
    expect(requestFingerprint(left)).toBe(requestFingerprint(right))
  })

  it('builds source keys from opaque IDs and stats context', () => {
    expect(sourceRecordKey('scout', syntheticEnvelope.dataScout[0])).toBe(
      'RowID:invented-scout-1',
    )
    expect(sourceRecordKey('stats', syntheticEnvelope.dataStats[0])).toContain(
      'UPID:invented-player-1|Season:2021|level:AA',
    )
  })

  it('creates order-independent record and schema fingerprints', () => {
    const left = { b: 2, a: { d: 4, c: 3 } }
    const right = { a: { c: 3, d: 4 }, b: 2 }
    expect(stableStringify(left)).toBe(stableStringify(right))
    expect(schemaFingerprint([left])).toBe(schemaFingerprint([right]))
  })

  it('changes idempotency when response content changes', () => {
    const url = 'https://example.test/data?season=2021'
    expect(idempotencyKey(url, 'hash-a')).not.toBe(idempotencyKey(url, 'hash-b'))
  })

  it('derives every season-bearing current query parameter for both roles', () => {
    for (const role of ['bat', 'pit'] as const) {
      const url = new URL(buildFangraphsCurrentProspectsUrl(2026, role))
      expect(url.hostname).toBe('www.fangraphs.com')
      expect(url.searchParams.get('stats')).toBe(role)
      expect(url.searchParams.get('season')).toBe('2026')
      expect(url.searchParams.get('seasonend')).toBe('2026')
      expect(url.searchParams.get('draft')).toBe('2026prospect')
      expect(url.searchParams.get('quickleaderboard')).toBe('2026all')
    }
  })

  it('accepts role-correct current rows carrying exact provider identities', () => {
    const parsed = parseFangraphsEnvelope(JSON.stringify(syntheticEnvelope))
    expect(() => assertFangraphsCurrentEnvelope(parsed, {
      season: 2021,
      statsRole: 'bat',
    })).not.toThrow()
  })

  it('rejects stale seasons, wrong role semantics, and undersized current feeds', () => {
    const parsed = parseFangraphsEnvelope(JSON.stringify(syntheticEnvelope))
    expect(() => assertFangraphsCurrentEnvelope(parsed, {
      season: 2026,
      statsRole: 'bat',
    })).toThrow(/outside requested season 2026/u)
    expect(() => assertFangraphsCurrentEnvelope(parsed, {
      season: 2021,
      statsRole: 'pit',
    })).toThrow(/missing IP/u)
    expect(() => assertFangraphsCurrentEnvelope(parsed, {
      enforceCardinality: true,
      season: 2021,
      statsRole: 'bat',
    })).toThrow(/expected at least/u)
  })

  it('rejects incomplete or conflicting exact identity tuples', () => {
    const incomplete = parseFangraphsEnvelope(JSON.stringify({
      ...syntheticEnvelope,
      dataStats: [{ ...syntheticEnvelope.dataStats[0], xMLBAMID: null }],
    }))
    expect(() => assertFangraphsCurrentEnvelope(incomplete, {
      season: 2021,
      statsRole: 'bat',
    })).toThrow(/without exact UPID, MinorMaster, and MLBAM/u)

    const duplicate = parseFangraphsEnvelope(JSON.stringify({
      ...syntheticEnvelope,
      dataStats: [syntheticEnvelope.dataStats[0], syntheticEnvelope.dataStats[0]],
    }))
    expect(() => assertFangraphsCurrentEnvelope(duplicate, {
      season: 2021,
      statsRole: 'bat',
    })).toThrow(/duplicate exact identity/u)

    const conflictingMlbam = parseFangraphsEnvelope(JSON.stringify({
      ...syntheticEnvelope,
      dataStats: [
        syntheticEnvelope.dataStats[0],
        {
          ...syntheticEnvelope.dataStats[0],
          UPID: 'invented-player-2',
          minormasterid: 'invented-minor-2',
        },
      ],
    }))
    expect(() => assertFangraphsCurrentEnvelope(conflictingMlbam, {
      season: 2021,
      statsRole: 'bat',
    })).toThrow(/duplicate exact identity 999001/u)
  })

  it('fails closed when the normalized snapshot is undersized', () => {
    expect(() => assertFangraphsCurrentSnapshot({
      battingExactMlbamRows: 200,
      battingResolvedMlbamRows: 225,
      battingRows: 250,
      pitchingExactMlbamRows: 200,
      pitchingResolvedMlbamRows: 225,
      pitchingRows: 250,
      totalRows: 500,
    })).not.toThrow()
    expect(() => assertFangraphsCurrentSnapshot({
      battingExactMlbamRows: 199,
      battingResolvedMlbamRows: 249,
      battingRows: 250,
      pitchingExactMlbamRows: 200,
      pitchingResolvedMlbamRows: 249,
      pitchingRows: 250,
      totalRows: 500,
    })).toThrow(/lacks current exact MLBAM coverage/u)
    expect(() => assertFangraphsCurrentSnapshot({
      battingExactMlbamRows: 225,
      battingResolvedMlbamRows: 224,
      battingRows: 250,
      pitchingExactMlbamRows: 225,
      pitchingResolvedMlbamRows: 225,
      pitchingRows: 250,
      totalRows: 500,
    })).toThrow(/internally inconsistent/u)
    expect(() => assertFangraphsCurrentSnapshot(undefined)).toThrow(/no result/u)
  })
})
