import { describe, expect, it } from 'vitest'
import {
  buildProspectSavantCurrentSlices,
  buildProspectSavantHistoricalSlices,
  buildProspectSavantLeadersUrl,
  parseProspectSavantEnvelope,
  prospectSavantSourceRecordKey,
  type ProspectSavantSlice,
} from './prospect-savant.js'
import {
  assertProspectSavantCurrentCardinality,
  PROSPECT_SAVANT_CURRENT_MINIMUM_ROWS,
} from './current-refresh-quality.js'

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
  age: 20,
  season: 2026,
  level: 'A+',
  pa: 220,
  ba: 0.274,
  obp: 0.351,
  slg: 0.462,
  pscore: 72.5,
  score_p: 0.9,
}

describe('Prospect Savant ingestion contract', () => {
  it('parses the expected envelope using synthetic rows', () => {
    const result = parseProspectSavantEnvelope(
      JSON.stringify({ data: [syntheticRecord] }),
      syntheticSlice,
    )
    expect(result.envelope.data).toEqual([syntheticRecord])
    expect(result.semanticQuality.validRows).toBe(1)
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

  it('builds every current-season role and level without a static year allowlist', () => {
    const slices = buildProspectSavantCurrentSlices(2027)

    expect(slices).toHaveLength(10)
    expect(slices).toContainEqual({
      role: 'hitters',
      level: 'Rk',
      season: 2027,
      pitchQualifier: 1,
      minAge: 16,
      maxAge: 40,
    })
    expect(slices).toContainEqual({
      role: 'pitchers',
      level: 'AAA',
      season: 2027,
      pitchQualifier: 1,
      minAge: 16,
      maxAge: 40,
    })
  })

  it('rejects an empty or implausibly small scheduled current slice', () => {
    expect(() =>
      assertProspectSavantCurrentCardinality(0, syntheticSlice, null),
    ).toThrow(`requires at least ${PROSPECT_SAVANT_CURRENT_MINIMUM_ROWS}`)
    expect(() =>
      assertProspectSavantCurrentCardinality(
        PROSPECT_SAVANT_CURRENT_MINIMUM_ROWS - 1,
        syntheticSlice,
        null,
      ),
    ).toThrow(`requires at least ${PROSPECT_SAVANT_CURRENT_MINIMUM_ROWS}`)
  })

  it('rejects a severe drop from the previous matching current slice', () => {
    expect(() =>
      assertProspectSavantCurrentCardinality(599, syntheticSlice, 1_000),
    ).toThrow('requires at least 600 after 1000 rows previously')

    expect(assertProspectSavantCurrentCardinality(600, syntheticSlice, 1_000)).toMatchObject({
      previousRetentionMinimumRows: 600,
      requiredRows: 600,
    })
  })

  it('rejects an envelope whose rows have no source semantics', () => {
    const arbitraryRows = Array.from({ length: 100 }, (_, index) => ({
      arbitrary: `value-${index}`,
    }))

    expect(() =>
      parseProspectSavantEnvelope(
        JSON.stringify({ data: arbitraryRows }),
        syntheticSlice,
      ),
    ).toThrow('0 of 100 rows have a supported player identifier and expected role fields')
  })

  it('rejects an empty envelope before any ingestion route can publish it', () => {
    expect(() =>
      parseProspectSavantEnvelope(JSON.stringify({ data: [] }), syntheticSlice),
    ).toThrow(
      '0 of 0 rows have a supported player identifier and expected role fields; requires at least 1',
    )
  })

  it('requires at least 95 percent semantically valid rows', () => {
    const validRows = Array.from({ length: 95 }, (_, index) => ({
      ...syntheticRecord,
      id: 200_000 + index,
    }))
    const invalidRows = Array.from({ length: 5 }, (_, index) => ({
      arbitrary: `value-${index}`,
    }))

    expect(
      parseProspectSavantEnvelope(
        JSON.stringify({ data: [...validRows, ...invalidRows] }),
        syntheticSlice,
      ).semanticQuality.validRows,
    ).toBe(95)
    expect(() =>
      parseProspectSavantEnvelope(
        JSON.stringify({ data: [...validRows.slice(1), ...invalidRows, {}] }),
        syntheticSlice,
      ),
    ).toThrow('94 of 100 rows')
  })

  it('accepts a representative hitter row', () => {
    expect(
      parseProspectSavantEnvelope(
        JSON.stringify({
          data: [
            {
              id: 123456,
              name: 'Representative Hitter',
              age: 20,
              season: 2026,
              level: 'A+',
              pa: 220,
              ba: 0.274,
              obp: 0.351,
              slg: 0.462,
            },
          ],
        }),
        syntheticSlice,
      ).semanticQuality,
    ).toMatchObject({
      supportedIdentifierRows: 1,
      expectedCoreRows: 1,
      validRows: 1,
      roleCoreRule: 'hitter_batting_line',
    })
  })

  it('accepts a representative pitcher row', () => {
    const pitcherSlice: ProspectSavantSlice = {
      ...syntheticSlice,
      role: 'pitchers',
    }

    expect(
      parseProspectSavantEnvelope(
        JSON.stringify({
          data: [
            {
              MinorMasterId: 'sa-representative-pitcher',
              name: 'Representative Pitcher',
              age: 21,
              season: 2026,
              level: 'A+',
              ip: 54.2,
              pitches: 850,
              krate: 29.8,
              bbrate: 7.4,
            },
          ],
        }),
        pitcherSlice,
      ).semanticQuality,
    ).toMatchObject({
      supportedIdentifierRows: 1,
      expectedCoreRows: 1,
      validRows: 1,
      roleCoreRule: 'pitcher_workload_and_rates',
    })
  })
})
