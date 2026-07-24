import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  buildGemRateSalesSnapshot as buildReleaseGemRateSalesSnapshot,
  normalizeAthleteName,
  parseCsv,
  type GemRateAthleteSalesSnapshot,
} from './build-gemrate-sales-snapshot.js'
import {
  buildBinderMarketCatalog,
  parseGemRateSnapshot,
} from '../../api/_binder-scores.js'

const acquiredAt = '2026-07-24T16:55:06.000Z'
const juneMonths = [
  'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026',
]

function buildGemRateSalesSnapshot(
  source: string | Buffer,
  acquired = acquiredAt,
  publishedAt?: string,
): GemRateAthleteSalesSnapshot {
  return buildReleaseGemRateSalesSnapshot(source, acquired, publishedAt, {
    minimumSourceRows: 1,
    minimumBaseballRows: 1,
  })
}

function exportHeaders(months = juneMonths): [string[], string[]] {
  const groupHeader = Array.from({ length: 11 + months.length * 3 }, () => '')
  groupHeader[4] = 'Monthly Sales $ Volume'
  groupHeader[4 + months.length] = 'Monthly $ Change'
  groupHeader[4 + months.length * 2] = 'Monthly % Change'
  groupHeader[6 + months.length * 3] =
    'Sales History Links (* requires subscription)'
  const year = months[0]?.slice(-4) ?? '2026'
  const columnHeader = [
    '',
    'Player',
    'Trailing 12mo Trend',
    `${year} Summary`,
    ...months,
    ...months,
    ...months,
    'Most Graded Year',
    'First Graded Year',
    'CardLadder*',
    'MarketMovers*',
    'CardHedge',
    'eBay Research*',
    'eBay Listings',
  ]
  return [groupHeader, columnHeader]
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function csvRow(values: string[]): string {
  return values.map(csvCell).join(',')
}

interface FixtureRowOptions {
  sport?: string
  name: string
  trailing?: number[]
  months?: number[]
  summary?: number
  mostGradedYear?: string
  firstGradedYear?: string
}

function fixtureRow({
  sport = '⚾',
  name,
  trailing,
  months = [10, 20, 30, 40, 50, 60],
  summary = months.reduce((total, value) => total + value, 0),
  mostGradedYear = '2024',
  firstGradedYear = '2020',
}: FixtureRowOptions): string[] {
  const usd = (value: number): string => `$${value.toLocaleString('en-US')}`
  const trailingValues = trailing ?? [
    ...Array.from(
      { length: 12 - months.length },
      (_, index) => index + 1,
    ),
    ...months,
  ]
  return [
    sport,
    name,
    trailingValues.join(', '),
    usd(summary),
    ...months.map(usd),
    ...months.map(() => '+$1'),
    ...months.map(() => '1%'),
    mostGradedYear,
    firstGradedYear,
    'https://not-persisted.example/card-ladder',
    'https://not-persisted.example/market-movers',
    'https://not-persisted.example/card-hedge',
    'https://not-persisted.example/research',
    'https://not-persisted.example/listings',
  ]
}

function fixture(rows: string[][], months = juneMonths): string {
  const [groupHeader, columnHeader] = exportHeaders(months)
  return [
    csvRow(groupHeader),
    csvRow(columnHeader),
    ...rows.map(csvRow),
  ].join('\r\n') + '\r\n'
}

describe('GemRate sales snapshot CSV parser', () => {
  it('parses a BOM, escaped quotes, commas, CRLF, and quoted newlines', () => {
    expect(parseCsv('\uFEFF"a","b,b","say ""hi"""\r\n"x","line 1\nline 2","z"\r\n')).toEqual([
      ['a', 'b,b', 'say "hi"'],
      ['x', 'line 1\nline 2', 'z'],
    ])
  })

  it('rejects malformed quoting', () => {
    expect(() => parseCsv('"unterminated')).toThrow('unterminated quoted field')
    expect(() => parseCsv('"closed"x')).toThrow('unexpected character after closing quote')
  })
})

describe('GemRate baseball sales snapshot builder', () => {
  it('filters baseball, validates summaries, sorts canonically, and never persists links', () => {
    const source = fixture([
      fixtureRow({ sport: '🏀', name: 'Basketball Player' }),
      fixtureRow({ name: 'Zack Example', mostGradedYear: '', firstGradedYear: '' }),
      fixtureRow({ name: 'Álex Example', summary: 210 }),
    ])
    const snapshot = buildGemRateSalesSnapshot(source, acquiredAt)

    expect(snapshot).toMatchObject({
      schemaVersion: 'gemrate-athlete-sales-snapshot.v1',
      source: {
        url: 'https://www.gemrate.com/sales-trends',
        permissionBasis: 'licensed_user_provided_permission',
        csvSha256: createHash('sha256').update(source).digest('hex'),
      },
      dataThrough: '2026-06-30',
      publishedAt: '2026-07-12T00:00:00.000Z',
      acquiredAt,
      metadata: {
        sourceRowCount: 3,
        baseballRowCount: 2,
        ambiguousNormalizedNames: [],
      },
    })
    expect(snapshot.rows.map((row) => row.athleteName)).toEqual([
      'Álex Example',
      'Zack Example',
    ])
    expect(snapshot.rows[0]).toEqual({
      athleteName: 'Álex Example',
      normalizedName: 'alex example',
      sourceKey: 'Álex Example',
      trailing12SalesUsd: [1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60],
      currentYtdSalesUsd: 210,
      firstGradedYear: 2020,
      mostGradedYear: 2024,
    })
    expect(snapshot.rows[1]?.firstGradedYear).toBeNull()
    expect(snapshot.rows[1]?.mostGradedYear).toBeNull()
    expect(JSON.stringify(snapshot)).not.toContain('not-persisted')
    expect(snapshot.rowsSha256).toBe(
      createHash('sha256').update(JSON.stringify(snapshot.rows)).digest('hex'),
    )
  })

  it('preserves accent/case variants and exposes every ambiguous normalized key', () => {
    const snapshot = buildGemRateSalesSnapshot(fixture([
      fixtureRow({ name: 'Jesús Made' }),
      fixtureRow({ name: 'Jesus Made', trailing: [2, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60] }),
      fixtureRow({ name: 'Jose Soriano' }),
      fixtureRow({ name: 'jose soriano', trailing: [3, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60] }),
    ]), acquiredAt)

    expect(snapshot.rows).toHaveLength(4)
    expect(snapshot.rows.map((row) => row.sourceKey)).toEqual([
      'Jesus Made',
      'Jesús Made',
      'Jose Soriano',
      'jose soriano',
    ])
    expect(snapshot.metadata.ambiguousNormalizedNames).toEqual([
      {
        normalizedName: 'jesus made',
        athleteNames: ['Jesus Made', 'Jesús Made'],
      },
      {
        normalizedName: 'jose soriano',
        athleteNames: ['Jose Soriano', 'jose soriano'],
      },
    ])
  })

  it('treats a blank GemRate monthly-sales cell as zero only when the summaries agree', () => {
    const row = fixtureRow({
      name: 'Sparse Prospect',
      trailing: [0, 0, 0, 0, 0, 0, 0, 20, 0, 40, 50, 60],
      months: [0, 20, 0, 40, 50, 60],
    })
    row[4] = ''
    row[6] = ''
    const snapshot = buildGemRateSalesSnapshot(fixture([row]), acquiredAt)
    expect(snapshot.rows[0]?.currentYtdSalesUsd).toBe(170)
  })

  it('derives and validates a refreshable seven-month July export contract', () => {
    const julyMonths = [
      'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026',
      'May 2026', 'Jun 2026', 'Jul 2026',
    ]
    const monthlySales = [10, 20, 30, 40, 50, 60, 70]
    const publishedAt = '2026-08-12T00:00:00.000Z'
    const snapshot = buildGemRateSalesSnapshot(
      fixture([fixtureRow({ name: 'July Prospect', months: monthlySales })], julyMonths),
      '2026-08-13T10:00:00.000Z',
      publishedAt,
    )

    expect(snapshot).toMatchObject({
      dataThrough: '2026-07-31',
      publishedAt,
      rows: [{
        currentYtdSalesUsd: 280,
        trailing12SalesUsd: [1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 60, 70],
      }],
    })
    const fixtureValidation = { minimumSourceRows: 1, minimumBaseballRows: 1 }
    expect(parseGemRateSnapshot(snapshot, fixtureValidation).dataThrough).toBe('2026-07-31')
    expect(buildBinderMarketCatalog(snapshot, fixtureValidation).cohortId).toBe(
      'gemrate-baseball-trailing-12m-2026-07',
    )
  })

  it('fails malformed or non-identical inferred monthly column groups', () => {
    const julyMonths = [
      'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026',
      'May 2026', 'Jun 2026', 'Jul 2026',
    ]
    const row = fixtureRow({
      name: 'Malformed July',
      months: [10, 20, 30, 40, 50, 60, 70],
    })
    const [unequalGroups, unequalColumns] = exportHeaders(julyMonths)
    unequalGroups[18] = ''
    unequalGroups[19] = 'Monthly % Change'
    const unequal = [
      csvRow(unequalGroups),
      csvRow(unequalColumns),
      csvRow(row),
    ].join('\r\n')
    expect(() => buildGemRateSalesSnapshot(
      unequal,
      '2026-08-13T10:00:00.000Z',
      '2026-08-12T00:00:00.000Z',
    )).toThrow('groups must be equal, contiguous')

    const [sameGroups, mismatchedColumns] = exportHeaders(julyMonths)
    mismatchedColumns[4 + julyMonths.length * 2 + 6] = 'Aug 2026'
    const mismatched = [
      csvRow(sameGroups),
      csvRow(mismatchedColumns),
      csvRow(row),
    ].join('\r\n')
    expect(() => buildGemRateSalesSnapshot(
      mismatched,
      '2026-08-13T10:00:00.000Z',
      '2026-08-12T00:00:00.000Z',
    )).toThrow('must contain identical month sequences')
  })

  it('requires publication provenance for future monthly exports', () => {
    const julyMonths = [
      'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026',
      'May 2026', 'Jun 2026', 'Jul 2026',
    ]
    expect(() => buildGemRateSalesSnapshot(
      fixture([fixtureRow({
        name: 'Missing Publication',
        months: [10, 20, 30, 40, 50, 60, 70],
      })], julyMonths),
      '2026-08-13T10:00:00.000Z',
    )).toThrow('--published-at is required')
  })

  it('enforces release-scale cohorts and chronological source timestamps', () => {
    const source = fixture([fixtureRow({ name: 'Release Gate' })])

    expect(() => buildReleaseGemRateSalesSnapshot(
      source,
      acquiredAt,
    )).toThrow('below the release floor')
    expect(() => buildReleaseGemRateSalesSnapshot(
      source,
      acquiredAt,
      '2026-06-15T00:00:00.000Z',
      { minimumSourceRows: 1, minimumBaseballRows: 1 },
    )).toThrow('publishedAt cannot precede dataThrough')
    expect(() => buildReleaseGemRateSalesSnapshot(
      source,
      '2026-07-01T00:00:00.000Z',
      '2026-07-12T00:00:00.000Z',
      { minimumSourceRows: 1, minimumBaseballRows: 1 },
    )).toThrow('acquiredAt cannot precede publishedAt')
  })

  it.each([
    {
      label: 'wrong trailing-12 length',
      mutate: () => fixtureRow({ name: 'Bad Trend', trailing: [1, 2] }),
      error: 'exactly 12 monthly values',
    },
    {
      label: 'negative trailing value',
      mutate: () => fixtureRow({
        name: 'Negative Trend',
        trailing: [1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, -1],
        months: [10, 20, 30, 40, 50, -1],
        summary: 149,
      }),
      error: 'must be a non-negative integer',
    },
    {
      label: 'mismatched current summary',
      mutate: () => fixtureRow({ name: 'Bad Summary', summary: 999 }),
      error: 'current-year summary mismatch',
    },
    {
      label: 'mismatched trailing/current months',
      mutate: () => fixtureRow({
        name: 'Bad Months',
        trailing: [1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 61],
      }),
      error: 'trailing-12 values do not match',
    },
  ])('rejects $label', ({ mutate, error }) => {
    expect(() => buildGemRateSalesSnapshot(fixture([mutate()]), acquiredAt)).toThrow(error)
  })

  it('fails exact source-key and full-row duplicates', () => {
    const duplicateNameRows = [
      fixtureRow({ name: 'Same Name' }),
      fixtureRow({ name: 'Same Name', trailing: [2, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60] }),
    ]
    expect(() => buildGemRateSalesSnapshot(fixture(duplicateNameRows), acquiredAt)).toThrow(
      'duplicate source athlete key',
    )

    const duplicateRow = fixtureRow({ name: 'Exact Duplicate' })
    expect(() => buildGemRateSalesSnapshot(fixture([duplicateRow, duplicateRow]), acquiredAt)).toThrow(
      'exact duplicate baseball row',
    )
  })

  it('fails a structurally malformed export or one with zero baseball rows', () => {
    const shortRow = fixtureRow({ name: 'Short Row' }).slice(0, 28)
    expect(() => buildGemRateSalesSnapshot(fixture([shortRow]), acquiredAt)).toThrow(
      'has 28 columns',
    )
    expect(() => buildGemRateSalesSnapshot(
      fixture([fixtureRow({ sport: '🏀', name: 'Only Basketball' })]),
      acquiredAt,
    )).toThrow('zero baseball rows')
  })

  it('normalizes Unicode athlete names deterministically', () => {
    expect(normalizeAthleteName("  Josué  O’Neil Jr.  ")).toBe('josue oneil jr')
  })
})

describe('committed GemRate baseball artifact', () => {
  it('has a self-consistent compact contract and explicit ambiguity groups', async () => {
    const body = await readFile('api/_data/gemrate-baseball-sales.json', 'utf8')
    const snapshot = JSON.parse(body) as GemRateAthleteSalesSnapshot

    expect(body.endsWith('\n')).toBe(true)
    expect(body.split('\n')).toHaveLength(2)
    expect(snapshot.schemaVersion).toBe('gemrate-athlete-sales-snapshot.v1')
    expect(snapshot.dataThrough).toBe('2026-06-30')
    expect(snapshot.publishedAt).toBe('2026-07-12T00:00:00.000Z')
    expect(snapshot.acquiredAt).toBe(acquiredAt)
    expect(snapshot.metadata.sourceRowCount).toBe(5000)
    expect(snapshot.metadata.baseballRowCount).toBe(2060)
    expect(snapshot.rows).toHaveLength(2060)
    expect(snapshot.rowsSha256).toBe(
      createHash('sha256').update(JSON.stringify(snapshot.rows)).digest('hex'),
    )
    expect(snapshot.metadata.ambiguousNormalizedNames).toEqual([
      {
        normalizedName: 'elian pena',
        athleteNames: ['Elian Pena', 'Elian Peña'],
      },
      {
        normalizedName: 'jesus made',
        athleteNames: ['Jesus Made', 'Jesús Made'],
      },
      {
        normalizedName: 'jose soriano',
        athleteNames: ['Jose Soriano', 'jose soriano'],
      },
      {
        normalizedName: 'josue briceno',
        athleteNames: ['Josue Briceno', 'Josue Briceño'],
      },
    ])
    expect(snapshot.rows.every((row) => (
      row.trailing12SalesUsd.length === 12 &&
      row.trailing12SalesUsd.every((value) => Number.isSafeInteger(value) && value >= 0) &&
      Number.isSafeInteger(row.currentYtdSalesUsd) &&
      row.currentYtdSalesUsd >= 0
    ))).toBe(true)
    expect(JSON.stringify(snapshot.rows)).not.toContain('http')
  })
})
