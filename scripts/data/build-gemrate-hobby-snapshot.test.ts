import { describe, expect, it } from 'vitest'
import {
  buildGemRateHobbySnapshot,
  parseGemRateHobbyEdition,
  type GemRateHobbySubjectType,
} from './build-gemrate-hobby-snapshot.js'

const acquiredAt = '2026-07-24T18:15:00.000Z'
const months2025 = [
  'Jan 2025', 'Feb 2025', 'Mar 2025', 'Apr 2025', 'May 2025', 'Jun 2025',
  'Jul 2025', 'Aug 2025', 'Sep 2025', 'Oct 2025', 'Nov 2025', 'Dec 2025',
]
const months2026 = [
  'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026',
]
const athlete2025Sales = [
  10, 20, 30, 40, 50, 60,
  70, 80, 90, 100, 110, 120,
]
const athlete2026Sales = [130, 140, 150, 160, 170, 180]
const pokemon2025Sales = [
  11, 21, 31, 41, 51, 61,
  71, 81, 91, 101, 111, 121,
]
const pokemon2026Sales = [131, 141, 151, 161, 171, 181]

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function csvRow(values: string[]): string {
  return values.map(csvCell).join(',')
}

function usd(value: number): string {
  return `$${value.toLocaleString('en-US')}`
}

interface EditionFixtureOptions {
  subjectType: GemRateHobbySubjectType
  editionYear: 2025 | 2026
  marker: string
  subjectName: string
  monthlySalesUsd: number[]
  trailingTwelveSalesUsd: number[]
  includeGradingYears?: boolean
}

function editionFixture({
  subjectType,
  editionYear,
  marker,
  subjectName,
  monthlySalesUsd,
  trailingTwelveSalesUsd,
  includeGradingYears = subjectType === 'athlete',
}: EditionFixtureOptions): string {
  const months = editionYear === 2025 ? months2025 : months2026
  const groupHeader = Array.from({
    length: 4 + months.length * 3 + (includeGradingYears ? 2 : 0) + 5,
  }, () => '')
  groupHeader[4] = 'Monthly Sales $ Volume'
  groupHeader[4 + months.length] = 'Monthly $ Change'
  groupHeader[4 + months.length * 2] = 'Monthly % Change'
  groupHeader[4 + months.length * 3 + (includeGradingYears ? 2 : 0)] =
    'Sales History Links (* requires subscription)'

  const columnHeader = [
    '',
    subjectType === 'athlete' ? 'Player' : 'Character',
    editionYear === 2025 ? '2025 Trend' : 'Trailing 12mo Trend',
    `${editionYear} Summary`,
    ...months,
    ...months,
    ...months,
    ...(includeGradingYears ? ['Most Graded Year', 'First Graded Year'] : []),
    'CardLadder*',
    'MarketMovers*',
    'CardHedge',
    'eBay Research*',
    'eBay Listings',
  ]
  const dataRow = [
    marker,
    subjectName,
    trailingTwelveSalesUsd.join(', '),
    usd(monthlySalesUsd.reduce((sum, value) => sum + value, 0)),
    ...monthlySalesUsd.map(usd),
    ...monthlySalesUsd.map(() => '+$1'),
    ...monthlySalesUsd.map(() => '1%'),
    ...(includeGradingYears ? ['2024', '2020'] : []),
    'https://not-persisted.example/card-ladder',
    'https://not-persisted.example/market-movers',
    'https://not-persisted.example/card-hedge',
    'https://not-persisted.example/research',
    'https://not-persisted.example/listings',
  ]

  return [
    csvRow(groupHeader),
    csvRow(columnHeader),
    csvRow(dataRow),
  ].join('\r\n') + '\r\n'
}

function buildInputs(
  athlete2026PriorSix = athlete2025Sales.slice(6),
): Parameters<typeof buildGemRateHobbySnapshot>[0] {
  return [
    {
      subjectType: 'athlete',
      editionYear: 2025,
      source: editionFixture({
        subjectType: 'athlete',
        editionYear: 2025,
        marker: '⚾',
        subjectName: 'Baseball Star',
        monthlySalesUsd: athlete2025Sales,
        trailingTwelveSalesUsd: athlete2025Sales,
      }),
      acquiredAt,
    },
    {
      subjectType: 'athlete',
      editionYear: 2026,
      source: editionFixture({
        subjectType: 'athlete',
        editionYear: 2026,
        marker: '⚾️',
        subjectName: 'Baseball Star',
        monthlySalesUsd: athlete2026Sales,
        trailingTwelveSalesUsd: [
          ...athlete2026PriorSix,
          ...athlete2026Sales,
        ],
      }),
      acquiredAt,
    },
    {
      subjectType: 'pokemon_character',
      editionYear: 2025,
      source: editionFixture({
        subjectType: 'pokemon_character',
        editionYear: 2025,
        marker: 'https://gemrate-images.example/pokeball.png',
        subjectName: 'Pikachu',
        monthlySalesUsd: pokemon2025Sales,
        trailingTwelveSalesUsd: pokemon2025Sales,
      }),
      acquiredAt,
    },
    {
      subjectType: 'pokemon_character',
      editionYear: 2026,
      source: editionFixture({
        subjectType: 'pokemon_character',
        editionYear: 2026,
        marker: 'https://gemrate-images.example/pokeball.png',
        subjectName: 'Pikachu',
        monthlySalesUsd: pokemon2026Sales,
        trailingTwelveSalesUsd: [
          ...pokemon2025Sales.slice(6),
          ...pokemon2026Sales,
        ],
      }),
      acquiredAt,
    },
  ]
}

const lowRowFloors = {
  minimumAthleteRows: 1,
  minimumPokemonRows: 1,
}

describe('GemRate hobby snapshot builder', () => {
  it('parses the distinct athlete and Pokémon export schemas', () => {
    const athlete = parseGemRateHobbyEdition(buildInputs()[1]!)
    const pokemon = parseGemRateHobbyEdition(buildInputs()[3]!)

    expect(athlete).toMatchObject({
      subjectType: 'athlete',
      editionYear: 2026,
      months: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
      rows: [{
        subjectName: 'Baseball Star',
        firstGradedYear: 2020,
        mostGradedYear: 2024,
      }],
    })
    expect(pokemon).toMatchObject({
      subjectType: 'pokemon_character',
      editionYear: 2026,
      rows: [{
        subjectName: 'Pikachu',
        firstGradedYear: null,
        mostGradedYear: null,
      }],
    })
  })

  it('merges the 2025 and 2026 editions into an 18-month history', () => {
    const snapshot = buildGemRateHobbySnapshot(buildInputs(), lowRowFloors)
    const athlete = snapshot.rows.find((row) => row.subjectType === 'athlete')
    const pokemon = snapshot.rows.find((row) => row.subjectType === 'pokemon_character')

    expect(snapshot.historyMonths).toEqual([
      '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
      '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    ])
    expect(athlete?.monthlySalesUsd).toEqual([
      ...athlete2025Sales,
      ...athlete2026Sales,
    ])
    expect(pokemon?.monthlySalesUsd).toEqual([
      ...pokemon2025Sales,
      ...pokemon2026Sales,
    ])
    expect(snapshot.metadata).toMatchObject({
      athleteRowCount: 1,
      pokemonRowCount: 1,
      subjectRowCount: 2,
      overlapChecks: 12,
    })
  })

  it('normalizes the baseball emoji variation selector across editions', () => {
    const snapshot = buildGemRateHobbySnapshot(buildInputs(), lowRowFloors)
    const athlete = snapshot.rows.find((row) => row.subjectType === 'athlete')

    expect(athlete).toMatchObject({
      domain: 'baseball',
      sourceCategory: '⚾',
      sourceKey: 'athlete|baseball|Baseball Star',
    })
  })

  it('rejects a disagreement in the six-month edition overlap', () => {
    const mismatchedPriorSix = [
      athlete2025Sales[6]! + 1,
      ...athlete2025Sales.slice(7),
    ]

    expect(() => buildGemRateHobbySnapshot(
      buildInputs(mismatchedPriorSix),
      lowRowFloors,
    )).toThrow('GemRate overlap mismatch for Baseball Star at 2025 month 7')
  })

  it('enforces each configurable row floor while allowing small test cohorts', () => {
    expect(
      buildGemRateHobbySnapshot(buildInputs(), lowRowFloors).metadata.subjectRowCount,
    ).toBe(2)
    expect(() => buildGemRateHobbySnapshot(buildInputs(), {
      minimumAthleteRows: 2,
      minimumPokemonRows: 1,
    })).toThrow('GemRate athlete row count is below 2')
    expect(() => buildGemRateHobbySnapshot(buildInputs(), {
      minimumAthleteRows: 1,
      minimumPokemonRows: 2,
    })).toThrow('GemRate Pokémon row count is below 2')
  })

  it('requires Pokémon exports to omit athlete grading-year columns', () => {
    const source = editionFixture({
      subjectType: 'pokemon_character',
      editionYear: 2026,
      marker: 'https://gemrate-images.example/pokeball.png',
      subjectName: 'Pikachu',
      monthlySalesUsd: pokemon2026Sales,
      trailingTwelveSalesUsd: [
        ...pokemon2025Sales.slice(6),
        ...pokemon2026Sales,
      ],
      includeGradingYears: true,
    })

    expect(() => parseGemRateHobbyEdition({
      subjectType: 'pokemon_character',
      editionYear: 2026,
      source,
      acquiredAt,
    })).toThrow('GemRate Pokémon export unexpectedly contains athlete grading-year fields')
  })
})
