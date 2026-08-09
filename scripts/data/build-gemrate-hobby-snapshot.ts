import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  normalizeAthleteName,
  parseCsv,
  sourceAthleteKey,
} from './build-gemrate-sales-snapshot.js'

export const GEMRATE_HOBBY_SNAPSHOT_SCHEMA_VERSION =
  'gemrate-hobby-sales-snapshot.v1' as const
export const GEMRATE_HOBBY_PERMISSION_BASIS =
  'licensed_user_provided_permission' as const
export const GEMRATE_HOBBY_DATA_THROUGH = '2026-06-30' as const
export const GEMRATE_HOBBY_PUBLISHED_AT = '2026-07-12T00:00:00.000Z' as const

const athleteSourceUrl = 'https://www.gemrate.com/sales-trends'
const pokemonSourceUrl = 'https://www.gemrate.com/sales-trends-pokemon'
const defaultOutputPath = resolve('api/_data/gemrate-hobby-sales.json')
const expectedHistoryMonths = [
  '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
] as const

export type GemRateHobbySubjectType = 'athlete' | 'pokemon_character'
export type GemRateHobbyDomain =
  | 'baseball'
  | 'basketball'
  | 'football'
  | 'soccer'
  | 'hockey'
  | 'golf'
  | 'combat'
  | 'other_sport'
  | 'mixed_sport'
  | 'culture'
  | 'pokemon'
export type GemRateHobbyTaxonomyStatus =
  | 'coherent_provider_cohort'
  | 'small_provider_cohort'
  | 'mixed_provider_cohort'
  | 'outside_sports_scope'

export interface GemRateHobbySource {
  subjectType: GemRateHobbySubjectType
  editionYear: 2025 | 2026
  url: typeof athleteSourceUrl | typeof pokemonSourceUrl
  permissionBasis: typeof GEMRATE_HOBBY_PERMISSION_BASIS
  acquiredAt: string
  csvSha256: string
  sourceRowCount: number
}

export interface GemRateHobbyRow {
  subjectType: GemRateHobbySubjectType
  domain: GemRateHobbyDomain
  taxonomyStatus: GemRateHobbyTaxonomyStatus
  sourceCategory: string
  subjectName: string
  normalizedName: string
  sourceKey: string
  monthlySalesUsd: number[]
  firstGradedYear: number | null
  mostGradedYear: number | null
}

export interface GemRateHobbySnapshot {
  schemaVersion: typeof GEMRATE_HOBBY_SNAPSHOT_SCHEMA_VERSION
  sources: GemRateHobbySource[]
  historyMonths: string[]
  dataThrough: typeof GEMRATE_HOBBY_DATA_THROUGH
  publishedAt: typeof GEMRATE_HOBBY_PUBLISHED_AT
  acquiredAt: string
  rowsSha256: string
  metadata: {
    athleteRowCount: number
    pokemonRowCount: number
    subjectRowCount: number
    overlapChecks: number
    cohortCounts: Array<{
      domain: GemRateHobbyDomain
      sourceCategory: string
      taxonomyStatus: GemRateHobbyTaxonomyStatus
      rowCount: number
    }>
    ambiguousWithinCohortNames: Array<{
      domain: GemRateHobbyDomain
      normalizedName: string
      subjectNames: string[]
    }>
  }
  rows: GemRateHobbyRow[]
}

interface ParsedEditionRow {
  marker: string
  subjectName: string
  normalizedName: string
  monthlySalesUsd: number[]
  trailingTwelveSalesUsd: number[]
  firstGradedYear: number | null
  mostGradedYear: number | null
}

interface ParsedEdition {
  subjectType: GemRateHobbySubjectType
  editionYear: 2025 | 2026
  months: string[]
  rows: ParsedEditionRow[]
}

interface BuildInput {
  subjectType: GemRateHobbySubjectType
  editionYear: 2025 | 2026
  source: string | Buffer
  acquiredAt: string
}

interface BuildOptions {
  minimumAthleteRows?: number
  minimumPokemonRows?: number
}

const athleteCategoryPolicy: Record<string, {
  domain: GemRateHobbyDomain
  taxonomyStatus: GemRateHobbyTaxonomyStatus
}> = {
  '⚾': { domain: 'baseball', taxonomyStatus: 'coherent_provider_cohort' },
  '🏀': { domain: 'basketball', taxonomyStatus: 'coherent_provider_cohort' },
  '🏈': { domain: 'football', taxonomyStatus: 'coherent_provider_cohort' },
  '⚽': { domain: 'soccer', taxonomyStatus: 'coherent_provider_cohort' },
  '🏒': { domain: 'hockey', taxonomyStatus: 'coherent_provider_cohort' },
  '⛳': { domain: 'golf', taxonomyStatus: 'small_provider_cohort' },
  '🤼': { domain: 'combat', taxonomyStatus: 'coherent_provider_cohort' },
  '🏆': { domain: 'mixed_sport', taxonomyStatus: 'mixed_provider_cohort' },
  '🏅': { domain: 'other_sport', taxonomyStatus: 'mixed_provider_cohort' },
  '🎬': { domain: 'culture', taxonomyStatus: 'outside_sports_scope' },
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalMarker(value: string): string {
  return value.normalize('NFC').replaceAll('\uFE0F', '').trim()
}

function validateIsoTimestamp(value: string, label: string): void {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC ISO timestamp`)
  }
}

function parseNonNegativeInteger(value: string, label: string): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe integer range`)
  return parsed
}

function parseUsd(value: string, label: string): number {
  if (value === '') return 0
  if (!/^\$(?:0|[1-9]\d{0,2}(?:,\d{3})*)$/u.test(value)) {
    throw new Error(`${label} must be a non-negative whole-dollar value`)
  }
  return parseNonNegativeInteger(value.slice(1).replaceAll(',', ''), label)
}

function parseTrend(value: string, label: string): number[] {
  // A fully blank GemRate trend accompanies a blank $0 summary and twelve
  // blank monthly cells for newly introduced, no-sales subjects.
  if (value === '') return Array.from({ length: 12 }, () => 0)
  const values = value.split(',').map((entry) => entry.trim())
  if (values.length !== 12) throw new Error(`${label} must contain exactly 12 values`)
  return values.map((entry, index) => parseNonNegativeInteger(entry, `${label} month ${index + 1}`))
}

function parseOptionalYear(
  value: string | undefined,
  label: string,
  latestYear: number,
): number | null {
  if (!value) return null
  if (!/^\d{4}$/u.test(value)) throw new Error(`${label} must be a four-digit year or blank`)
  const parsed = Number(value)
  if (parsed < 1800 || parsed > latestYear) throw new Error(`${label} is outside the supported range`)
  return parsed
}

function firstGroupIndex(groupHeader: string[], label: string): number {
  const index = groupHeader.indexOf(label)
  if (index < 0 || groupHeader.lastIndexOf(label) !== index) {
    throw new Error(`GemRate group header ${JSON.stringify(label)} must occur exactly once`)
  }
  return index
}

function monthKey(header: string, editionYear: number): string {
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/u.exec(header)
  if (!match || Number(match[2]) !== editionYear) {
    throw new Error(`Unexpected GemRate monthly sales header ${JSON.stringify(header)}`)
  }
  const month = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ].indexOf(match[1]!) + 1
  return `${match[2]}-${month.toString().padStart(2, '0')}`
}

export function parseGemRateHobbyEdition(input: BuildInput): ParsedEdition {
  validateIsoTimestamp(input.acquiredAt, 'source acquiredAt')
  const source = Buffer.isBuffer(input.source)
    ? input.source.toString('utf8')
    : input.source
  const parsed = parseCsv(source)
  if (parsed.length < 3) throw new Error('GemRate export must include two headers and data')
  const groupHeader = parsed[0]!
  const columnHeader = parsed[1]!
  if (groupHeader.length !== columnHeader.length) {
    throw new Error('GemRate export header rows have different widths')
  }
  const salesStart = firstGroupIndex(groupHeader, 'Monthly Sales $ Volume')
  const changeStart = firstGroupIndex(groupHeader, 'Monthly $ Change')
  const linksStart = firstGroupIndex(
    groupHeader,
    'Sales History Links (* requires subscription)',
  )
  if (salesStart !== 4 || changeStart <= salesStart || linksStart <= changeStart) {
    throw new Error('GemRate export group ordering is invalid')
  }
  const expectedIdentityHeader =
    input.subjectType === 'athlete' ? 'Player' : 'Character'
  if (
    columnHeader[0] !== '' ||
    columnHeader[1] !== expectedIdentityHeader ||
    columnHeader[3] !== `${input.editionYear} Summary`
  ) {
    throw new Error(`GemRate ${input.subjectType} fixed headers are invalid`)
  }
  const expectedTrendHeader =
    input.editionYear === 2026 ? 'Trailing 12mo Trend' : '2025 Trend'
  if (columnHeader[2] !== expectedTrendHeader) {
    throw new Error(`GemRate ${input.subjectType} trend header is invalid`)
  }
  const months = columnHeader
    .slice(salesStart, changeStart)
    .map((header) => monthKey(header, input.editionYear))
  const expectedMonths = input.editionYear === 2025
    ? expectedHistoryMonths.slice(0, 12)
    : expectedHistoryMonths.slice(12)
  if (JSON.stringify(months) !== JSON.stringify(expectedMonths)) {
    throw new Error(`GemRate ${input.editionYear} monthly sales sequence is incomplete`)
  }

  const mostGradedYearIndex = columnHeader.indexOf('Most Graded Year')
  const firstGradedYearIndex = columnHeader.indexOf('First Graded Year')
  if (
    input.subjectType === 'athlete' &&
    (mostGradedYearIndex < changeStart || firstGradedYearIndex !== mostGradedYearIndex + 1)
  ) {
    throw new Error('GemRate athlete grading-year columns are missing')
  }
  if (
    input.subjectType === 'pokemon_character' &&
    (mostGradedYearIndex >= 0 || firstGradedYearIndex >= 0)
  ) {
    throw new Error('GemRate Pokémon export unexpectedly contains athlete grading-year fields')
  }

  const rows = parsed.slice(2).map((row, index): ParsedEditionRow => {
    const label = `GemRate ${input.subjectType} ${input.editionYear} row ${index + 3}`
    if (row.length !== columnHeader.length) {
      throw new Error(`${label} has ${row.length} columns; expected ${columnHeader.length}`)
    }
    const subjectName = sourceAthleteKey(row[1]!)
    const normalizedName = normalizeAthleteName(subjectName)
    if (!subjectName || !normalizedName || row[1] !== subjectName) {
      throw new Error(`${label} has a non-canonical subject name`)
    }
    const monthlySalesUsd = row
      .slice(salesStart, changeStart)
      .map((value, monthIndex) => parseUsd(value, `${label} sales month ${monthIndex + 1}`))
    const summary = parseUsd(row[3]!, `${label} summary`)
    if (monthlySalesUsd.reduce((sum, value) => sum + value, 0) !== summary) {
      throw new Error(`${label} monthly sales do not equal the summary`)
    }
    const trailingTwelveSalesUsd = parseTrend(row[2]!, `${label} trend`)
    const matchingTrendMonths =
      input.editionYear === 2025 ? trailingTwelveSalesUsd : trailingTwelveSalesUsd.slice(6)
    if (JSON.stringify(matchingTrendMonths) !== JSON.stringify(monthlySalesUsd)) {
      throw new Error(`${label} trend does not match its monthly sales columns`)
    }
    const mostGradedYear = input.subjectType === 'athlete'
      ? parseOptionalYear(row[mostGradedYearIndex], `${label} most graded year`, 2026)
      : null
    const firstGradedYear = input.subjectType === 'athlete'
      ? parseOptionalYear(row[firstGradedYearIndex], `${label} first graded year`, 2026)
      : null
    if (
      firstGradedYear !== null &&
      mostGradedYear !== null &&
      firstGradedYear > mostGradedYear
    ) {
      throw new Error(`${label} first graded year follows most graded year`)
    }
    return {
      marker: canonicalMarker(row[0]!),
      subjectName,
      normalizedName,
      monthlySalesUsd,
      trailingTwelveSalesUsd,
      firstGradedYear,
      mostGradedYear,
    }
  })

  const sourceNames = new Set<string>()
  for (const row of rows) {
    if (sourceNames.has(row.subjectName)) {
      throw new Error(`GemRate ${input.subjectType} export duplicates ${JSON.stringify(row.subjectName)}`)
    }
    sourceNames.add(row.subjectName)
  }
  return {
    subjectType: input.subjectType,
    editionYear: input.editionYear,
    months: [...months],
    rows,
  }
}

function sourceUrlFor(subjectType: GemRateHobbySubjectType): string {
  return subjectType === 'athlete' ? athleteSourceUrl : pokemonSourceUrl
}

function domainPolicy(
  subjectType: GemRateHobbySubjectType,
  marker: string,
): {
  domain: GemRateHobbyDomain
  taxonomyStatus: GemRateHobbyTaxonomyStatus
  sourceCategory: string
} {
  if (subjectType === 'pokemon_character') {
    return {
      domain: 'pokemon',
      taxonomyStatus: 'coherent_provider_cohort',
      sourceCategory: 'pokemon_character',
    }
  }
  const policy = athleteCategoryPolicy[marker]
  if (!policy) throw new Error(`Unrecognized GemRate athlete category marker ${JSON.stringify(marker)}`)
  return { ...policy, sourceCategory: marker }
}

function mergeEditions(
  earlier: ParsedEdition,
  current: ParsedEdition,
): { rows: GemRateHobbyRow[]; overlapChecks: number } {
  if (
    earlier.subjectType !== current.subjectType ||
    earlier.editionYear !== 2025 ||
    current.editionYear !== 2026
  ) {
    throw new Error('GemRate editions must be paired as 2025 and 2026 for one subject type')
  }
  const earlierByName = new Map(earlier.rows.map((row) => [row.subjectName, row]))
  const currentByName = new Map(current.rows.map((row) => [row.subjectName, row]))
  if (
    earlierByName.size !== currentByName.size ||
    [...earlierByName.keys()].some((name) => !currentByName.has(name))
  ) {
    throw new Error(`GemRate ${earlier.subjectType} edition subject sets differ`)
  }
  let overlapChecks = 0
  const rows = current.rows.map((currentRow): GemRateHobbyRow => {
    const earlierRow = earlierByName.get(currentRow.subjectName)!
    if (
      currentRow.marker !== earlierRow.marker ||
      currentRow.normalizedName !== earlierRow.normalizedName
    ) {
      throw new Error(`GemRate subject identity changed across editions: ${currentRow.subjectName}`)
    }
    for (let index = 0; index < 6; index += 1) {
      overlapChecks += 1
      if (earlierRow.monthlySalesUsd[index + 6] !== currentRow.trailingTwelveSalesUsd[index]) {
        throw new Error(
          `GemRate overlap mismatch for ${currentRow.subjectName} at 2025 month ${index + 7}`,
        )
      }
    }
    if (
      current.subjectType === 'athlete' &&
      (
        currentRow.firstGradedYear !== earlierRow.firstGradedYear ||
        currentRow.mostGradedYear !== earlierRow.mostGradedYear
      )
    ) {
      throw new Error(`GemRate grading-year identity changed for ${currentRow.subjectName}`)
    }
    const policy = domainPolicy(current.subjectType, currentRow.marker)
    return {
      subjectType: current.subjectType,
      domain: policy.domain,
      taxonomyStatus: policy.taxonomyStatus,
      sourceCategory: policy.sourceCategory,
      subjectName: currentRow.subjectName,
      normalizedName: currentRow.normalizedName,
      sourceKey: `${current.subjectType}|${policy.domain}|${currentRow.subjectName}`,
      monthlySalesUsd: [
        ...earlierRow.monthlySalesUsd,
        ...currentRow.monthlySalesUsd,
      ],
      firstGradedYear: currentRow.firstGradedYear,
      mostGradedYear: currentRow.mostGradedYear,
    }
  })
  return { rows, overlapChecks }
}

export function buildGemRateHobbySnapshot(
  inputs: BuildInput[],
  options: BuildOptions = {},
): GemRateHobbySnapshot {
  const requiredKeys = [
    'athlete:2025',
    'athlete:2026',
    'pokemon_character:2025',
    'pokemon_character:2026',
  ]
  const inputByKey = new Map(inputs.map((input) => [
    `${input.subjectType}:${input.editionYear}`,
    input,
  ]))
  if (
    inputs.length !== requiredKeys.length ||
    requiredKeys.some((key) => !inputByKey.has(key))
  ) {
    throw new Error('Exactly four GemRate athlete/Pokémon 2025/2026 inputs are required')
  }
  for (const input of inputs) {
    validateIsoTimestamp(input.acquiredAt, 'source acquiredAt')
    if (Date.parse(input.acquiredAt) < Date.parse(GEMRATE_HOBBY_PUBLISHED_AT)) {
      throw new Error('GemRate source acquisition predates the current edition publication')
    }
  }

  const parsed = new Map(requiredKeys.map((key) => {
    const input = inputByKey.get(key)!
    return [key, parseGemRateHobbyEdition(input)] as const
  }))
  const athleteMerge = mergeEditions(
    parsed.get('athlete:2025')!,
    parsed.get('athlete:2026')!,
  )
  const pokemonMerge = mergeEditions(
    parsed.get('pokemon_character:2025')!,
    parsed.get('pokemon_character:2026')!,
  )
  const minimumAthleteRows = options.minimumAthleteRows ?? 4_000
  const minimumPokemonRows = options.minimumPokemonRows ?? 750
  if (athleteMerge.rows.length < minimumAthleteRows) {
    throw new Error(`GemRate athlete row count is below ${minimumAthleteRows}`)
  }
  if (pokemonMerge.rows.length < minimumPokemonRows) {
    throw new Error(`GemRate Pokémon row count is below ${minimumPokemonRows}`)
  }

  const rows = [...athleteMerge.rows, ...pokemonMerge.rows].toSorted((left, right) => (
    compareText(left.domain, right.domain) ||
    compareText(left.normalizedName, right.normalizedName) ||
    compareText(left.sourceKey, right.sourceKey)
  ))
  const sourceKeys = new Set<string>()
  for (const row of rows) {
    if (sourceKeys.has(row.sourceKey)) throw new Error(`Duplicate hobby source key ${row.sourceKey}`)
    sourceKeys.add(row.sourceKey)
  }
  const cohorts = new Map<string, GemRateHobbySnapshot['metadata']['cohortCounts'][number]>()
  const namesByCohort = new Map<string, Map<string, string[]>>()
  for (const row of rows) {
    const cohortKey = `${row.domain}|${row.sourceCategory}`
    const cohort = cohorts.get(cohortKey) ?? {
      domain: row.domain,
      sourceCategory: row.sourceCategory,
      taxonomyStatus: row.taxonomyStatus,
      rowCount: 0,
    }
    cohort.rowCount += 1
    cohorts.set(cohortKey, cohort)
    const names = namesByCohort.get(cohortKey) ?? new Map<string, string[]>()
    const sourceNames = names.get(row.normalizedName) ?? []
    sourceNames.push(row.subjectName)
    names.set(row.normalizedName, sourceNames)
    namesByCohort.set(cohortKey, names)
  }
  const ambiguousWithinCohortNames = [...namesByCohort].flatMap(([cohortKey, names]) => {
    const domain = cohortKey.split('|')[0] as GemRateHobbyDomain
    return [...names]
      .filter(([, sourceNames]) => sourceNames.length > 1)
      .map(([normalizedName, subjectNames]) => ({
        domain,
        normalizedName,
        subjectNames: subjectNames.toSorted(compareText),
      }))
  }).toSorted((left, right) => (
    compareText(left.domain, right.domain) ||
    compareText(left.normalizedName, right.normalizedName)
  ))
  const acquiredAt = inputs
    .map((input) => input.acquiredAt)
    .toSorted(compareText)
    .at(-1)!
  const sources = inputs.map((input): GemRateHobbySource => ({
    subjectType: input.subjectType,
    editionYear: input.editionYear,
    url: sourceUrlFor(input.subjectType) as GemRateHobbySource['url'],
    permissionBasis: GEMRATE_HOBBY_PERMISSION_BASIS,
    acquiredAt: input.acquiredAt,
    csvSha256: sha256(input.source),
    sourceRowCount: parsed.get(`${input.subjectType}:${input.editionYear}`)!.rows.length,
  })).toSorted((left, right) => (
    compareText(left.subjectType, right.subjectType) ||
    left.editionYear - right.editionYear
  ))

  return {
    schemaVersion: GEMRATE_HOBBY_SNAPSHOT_SCHEMA_VERSION,
    sources,
    historyMonths: [...expectedHistoryMonths],
    dataThrough: GEMRATE_HOBBY_DATA_THROUGH,
    publishedAt: GEMRATE_HOBBY_PUBLISHED_AT,
    acquiredAt,
    rowsSha256: sha256(JSON.stringify(rows)),
    metadata: {
      athleteRowCount: athleteMerge.rows.length,
      pokemonRowCount: pokemonMerge.rows.length,
      subjectRowCount: rows.length,
      overlapChecks: athleteMerge.overlapChecks + pokemonMerge.overlapChecks,
      cohortCounts: [...cohorts.values()].toSorted((left, right) => (
        compareText(left.domain, right.domain)
      )),
      ambiguousWithinCohortNames,
    },
    rows,
  }
}

interface CliArguments {
  athlete2025Path: string
  athlete2026Path: string
  pokemon2025Path: string
  pokemon2026Path: string
  outputPath: string
}

function parseCliArguments(arguments_: string[]): CliArguments {
  const paths: Record<string, string> = {}
  let outputPath = defaultOutputPath
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!
    const value = arguments_[index + 1]
    if (!value) throw new Error(`${argument} requires a value`)
    if (argument === '--output') outputPath = resolve(value)
    else if (
      argument === '--athlete-2025' ||
      argument === '--athlete-2026' ||
      argument === '--pokemon-2025' ||
      argument === '--pokemon-2026'
    ) {
      paths[argument] = resolve(value)
    } else {
      throw new Error(`Unknown argument ${JSON.stringify(argument)}`)
    }
    index += 1
  }
  for (const key of ['--athlete-2025', '--athlete-2026', '--pokemon-2025', '--pokemon-2026']) {
    if (!paths[key]) throw new Error(`${key} is required`)
  }
  return {
    athlete2025Path: paths['--athlete-2025']!,
    athlete2026Path: paths['--athlete-2026']!,
    pokemon2025Path: paths['--pokemon-2025']!,
    pokemon2026Path: paths['--pokemon-2026']!,
    outputPath,
  }
}

async function inputFromFile(
  path: string,
  subjectType: GemRateHobbySubjectType,
  editionYear: 2025 | 2026,
): Promise<BuildInput> {
  const [source, fileStat] = await Promise.all([readFile(path), stat(path)])
  return {
    subjectType,
    editionYear,
    source,
    acquiredAt: new Date(Math.floor(fileStat.mtimeMs / 1_000) * 1_000).toISOString(),
  }
}

async function run(): Promise<void> {
  const arguments_ = parseCliArguments(process.argv.slice(2))
  const inputs = await Promise.all([
    inputFromFile(arguments_.athlete2025Path, 'athlete', 2025),
    inputFromFile(arguments_.athlete2026Path, 'athlete', 2026),
    inputFromFile(arguments_.pokemon2025Path, 'pokemon_character', 2025),
    inputFromFile(arguments_.pokemon2026Path, 'pokemon_character', 2026),
  ])
  const snapshot = buildGemRateHobbySnapshot(inputs)
  await writeFile(arguments_.outputPath, `${JSON.stringify(snapshot)}\n`)
  process.stdout.write(
    `Wrote ${snapshot.metadata.subjectRowCount} GemRate hobby subjects across ` +
    `${snapshot.metadata.cohortCounts.length} provider cohorts to ${arguments_.outputPath}\n`,
  )
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  run().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unknown error'}\n`)
    process.exitCode = 1
  })
}
