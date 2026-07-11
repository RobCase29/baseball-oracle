import { describe, expect, it } from 'vitest'
import {
  buildProspectSavantHistoricalSlices,
  buildProspectSavantLeadersUrl,
  parseProspectSavantEnvelope,
  prospectSavantSourceRecordKey,
  type ProspectSavantSlice,
} from './prospect-savant.js'

const syntheticSlice: ProspectSavantSlice = {
  role: 'hitters',
  level: 'A+',
  season: 2026,
  pitchQualifier: 1,
  minAge: 16,
  maxAge: 40,
}

const syntheticRecord = {
  id: 123456,
  MLBAMId: 654321,
  MinorMasterId: 'synthetic-minor-id',
  name: 'Invented Player',
  pscore: 72.5,
  score_p: 0.9,
}

describe('Prospect Savant ingestion contract', () => {
  it('parses the expected envelope using synthetic rows', () => {
    const result = parseProspectSavantEnvelope(
      JSON.stringify({ data: [syntheticRecord] }),
    )
    expect(result.data).toEqual([syntheticRecord])
  })

  it('encodes the High-A path segment without changing cohort parameters', () => {
    const url = buildProspectSavantLeadersUrl(syntheticSlice)
    expect(url).toContain('/leaders/hitters/A%2B/2026/1/16/40')
  })

  it('uses the Prospect Savant row ID and full cohort in source identity', () => {
    expect(prospectSavantSourceRecordKey(syntheticRecord, syntheticSlice)).toBe(
      'id:123456|role:hitters|season:2026|level:A+|qualifier:1|ages:16-40',
    )
  })

  it('builds the audited non-empty historical coverage matrix', () => {
    const slices = buildProspectSavantHistoricalSlices()
    expect(slices).toHaveLength(22)
    expect(slices.filter((slice) => slice.season === 2023)).toHaveLength(4)
    expect(slices.filter((slice) => slice.season === 2026)).toHaveLength(10)
  })

  it('filters the manifest while retaining the fixed broad cohort', () => {
    const slices = buildProspectSavantHistoricalSlices({
      roles: ['pitchers'],
      seasons: [2023, 2024],
      levels: ['AAA'],
    })
    expect(slices).toEqual([
      {
        role: 'pitchers',
        level: 'AAA',
        season: 2023,
        pitchQualifier: 1,
        minAge: 16,
        maxAge: 40,
      },
      {
        role: 'pitchers',
        level: 'AAA',
        season: 2024,
        pitchQualifier: 1,
        minAge: 16,
        maxAge: 40,
      },
    ])
  })
})
