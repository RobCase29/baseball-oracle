import { describe, expect, it } from 'vitest'
import type { ValueSeasonRow } from '../backfill/baseball-reference-mlb-war.js'
import {
  baseballReferenceCurrentValueUrl,
  currentValueSourceRecordKey,
} from './baseball-reference-current.js'
import {
  assertBaseballReferenceCurrentCardinality,
  BASEBALL_REFERENCE_CURRENT_MINIMUM_ROWS,
} from './current-refresh-quality.js'

describe('current Baseball-Reference ingestion contract', () => {
  it('builds the allowlisted current value page URLs', () => {
    expect(baseballReferenceCurrentValueUrl(2026, 'batting')).toBe(
      'https://www.baseball-reference.com/leagues/majors/2026-value-batting.shtml',
    )
    expect(baseballReferenceCurrentValueUrl(2026, 'pitching')).toBe(
      'https://www.baseball-reference.com/leagues/majors/2026-value-pitching.shtml',
    )
  })

  it('binds a raw row identity to player, season, and side', () => {
    const row = {
      bbref_id: 'judgeaa01',
      season: 2026,
      side: 'batting',
    } as ValueSeasonRow
    expect(currentValueSourceRecordKey(row)).toBe(
      'judgeaa01|season:2026|side:batting',
    )
  })

  it('rejects a structurally valid but implausibly small current page', () => {
    expect(() =>
      assertBaseballReferenceCurrentCardinality(
        BASEBALL_REFERENCE_CURRENT_MINIMUM_ROWS - 1,
        2026,
        'batting',
        null,
      ),
    ).toThrow(`requires at least ${BASEBALL_REFERENCE_CURRENT_MINIMUM_ROWS}`)
  })

  it('requires at least 60 percent of the previous matching page', () => {
    expect(() =>
      assertBaseballReferenceCurrentCardinality(419, 2026, 'pitching', 700),
    ).toThrow('requires at least 420 after 700 rows previously')

    expect(
      assertBaseballReferenceCurrentCardinality(420, 2026, 'pitching', 700),
    ).toMatchObject({
      previousRetentionMinimumRows: 420,
      requiredRows: 420,
    })
  })
})
