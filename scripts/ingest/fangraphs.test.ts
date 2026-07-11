import { describe, expect, it } from 'vitest'
import {
  idempotencyKey,
  normalizeRequestUrl,
  parseFangraphsEnvelope,
  requestFingerprint,
  schemaFingerprint,
  sourceRecordKey,
  stableStringify,
} from './fangraphs.js'

const syntheticEnvelope = {
  dataScout: [
    {
      RowID: 'invented-scout-1',
      UPID: 'invented-player-1',
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
})
