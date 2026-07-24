import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const schemaVersion = 'gemrate-athlete-sales-snapshot.v1'
const sourceUrl = 'https://www.gemrate.com/sales-trends'
const permissionBasis = 'licensed_user_provided_permission'
export const minimumGemRateSourceRows = 4_000
export const minimumGemRateBaseballRows = 1_500
const committedJuneDataThrough = '2026-06-30'
const committedJunePublishedAt = '2026-07-12T00:00:00.000Z'
const defaultOutputPath = resolve('api/_data/gemrate-baseball-sales.json')
const baseballMarker = '⚾'
const monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const
const linkHeaders = [
  'CardLadder*',
  'MarketMovers*',
  'CardHedge',
  'eBay Research*',
  'eBay Listings',
] as const

export interface GemRateAthleteSalesRow {
  athleteName: string
  normalizedName: string
  sourceKey: string
  trailing12SalesUsd: number[]
  currentYtdSalesUsd: number
  firstGradedYear: number | null
  mostGradedYear: number | null
}

export interface GemRateAthleteSalesSnapshot {
  schemaVersion: typeof schemaVersion
  source: {
    url: typeof sourceUrl
    permissionBasis: typeof permissionBasis
    csvSha256: string
  }
  dataThrough: string
  publishedAt: string
  acquiredAt: string
  rowsSha256: string
  metadata: {
    sourceRowCount: number
    baseballRowCount: number
    ambiguousNormalizedNames: Array<{
      normalizedName: string
      athleteNames: string[]
    }>
  }
  rows: GemRateAthleteSalesRow[]
}

interface GemRateSnapshotBuildOptions {
  minimumSourceRows?: number
  minimumBaseballRows?: number
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Parses RFC 4180-style CSV without accepting malformed quoting. Embedded
 * commas, escaped quotes, CRLF/LF line endings, and quoted newlines are
 * supported.
 */
export function parseCsv(source: string): string[][] {
  const input = source.startsWith('\uFEFF') ? source.slice(1) : source
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let quoteClosed = false

  const pushField = (): void => {
    row.push(field)
    field = ''
    quoteClosed = false
  }
  const pushRow = (): void => {
    pushField()
    rows.push(row)
    row = []
  }

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!

    if (inQuotes) {
      if (character !== '"') {
        field += character
        continue
      }
      if (input[index + 1] === '"') {
        field += '"'
        index += 1
        continue
      }
      inQuotes = false
      quoteClosed = true
      continue
    }

    if (quoteClosed && character !== ',' && character !== '\n' && character !== '\r') {
      throw new Error(`Malformed CSV: unexpected character after closing quote at offset ${index}`)
    }

    if (character === '"') {
      if (field.length !== 0) {
        throw new Error(`Malformed CSV: quote inside unquoted field at offset ${index}`)
      }
      inQuotes = true
      continue
    }

    if (character === ',') {
      pushField()
      continue
    }

    if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      pushRow()
      continue
    }

    field += character
  }

  if (inQuotes) throw new Error('Malformed CSV: unterminated quoted field')
  if (field.length > 0 || row.length > 0 || quoteClosed) pushRow()
  return rows
}

/**
 * The downstream join key is intentionally accent- and case-insensitive.
 * Ambiguous keys are retained in snapshot metadata and must not be joined
 * automatically.
 */
export function normalizeAthleteName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Retains source spelling, accents, case, and punctuation while removing
 * encoding and whitespace variance. It is the lossless identity guard for
 * one exported source row, not a cross-source player identifier.
 */
export function sourceAthleteKey(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

function parseNonNegativeInteger(value: string, label: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} must be a non-negative integer, received ${JSON.stringify(value)}`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} exceeds the safe integer range`)
  }
  return parsed
}

function parseUsd(value: string, label: string, blankAsZero = false): number {
  // GemRate renders a zero-dollar month as a blank cell in some sparse rows.
  if (blankAsZero && value === '') return 0
  if (!/^\$(?:0|[1-9]\d{0,2}(?:,\d{3})*)$/.test(value)) {
    throw new Error(`${label} must be a non-negative whole-dollar value, received ${JSON.stringify(value)}`)
  }
  return parseNonNegativeInteger(value.slice(1).replaceAll(',', ''), label)
}

function parseTrailing12(value: string, label: string): number[] {
  const values = value.split(',').map((entry) => entry.trim())
  if (values.length !== 12) {
    throw new Error(`${label} must contain exactly 12 monthly values`)
  }
  return values.map((entry, index) => (
    parseNonNegativeInteger(entry, `${label} month ${index + 1}`)
  ))
}

function parseOptionalYear(value: string, label: string, latestYear: number): number | null {
  if (value === '') return null
  if (!/^\d{4}$/.test(value)) {
    throw new Error(`${label} must be a four-digit year or blank`)
  }
  const year = Number(value)
  if (year < 1800 || year > latestYear) {
    throw new Error(`${label} is outside the supported range: ${year}`)
  }
  return year
}

function validateIsoTimestamp(value: string, label: string): void {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC ISO timestamp, received ${JSON.stringify(value)}`)
  }
}

interface ExportContract {
  currentYear: number
  dataThrough: string
  expectedColumnCount: number
  firstGradedYearIndex: number
  monthCount: number
  mostGradedYearIndex: number
  salesStartIndex: number
}

function oneHeaderIndex(header: string[], label: string): number {
  const indices = header.flatMap((value, index) => value === label ? [index] : [])
  if (indices.length !== 1) {
    throw new Error(`GemRate group header ${JSON.stringify(label)} must occur exactly once`)
  }
  return indices[0]!
}

function inferExportContract(parsed: string[][]): ExportContract {
  if (parsed.length < 3) throw new Error('GemRate CSV must contain two header rows and data')
  const [groupHeader, columnHeader] = parsed
  if (!groupHeader || !columnHeader || groupHeader.length !== columnHeader.length) {
    throw new Error('GemRate CSV header rows must have equal column counts')
  }
  const salesStartIndex = oneHeaderIndex(groupHeader, 'Monthly Sales $ Volume')
  const changeStartIndex = oneHeaderIndex(groupHeader, 'Monthly $ Change')
  const percentStartIndex = oneHeaderIndex(groupHeader, 'Monthly % Change')
  const linksStartIndex = oneHeaderIndex(
    groupHeader,
    'Sales History Links (* requires subscription)',
  )
  const monthCount = changeStartIndex - salesStartIndex
  const mostGradedYearIndex = percentStartIndex + monthCount
  const firstGradedYearIndex = mostGradedYearIndex + 1
  const expectedColumnCount = linksStartIndex + linkHeaders.length

  if (
    salesStartIndex !== 4 ||
    monthCount < 1 ||
    monthCount > 12 ||
    percentStartIndex - changeStartIndex !== monthCount ||
    linksStartIndex - firstGradedYearIndex !== 1 ||
    groupHeader.length !== expectedColumnCount
  ) {
    throw new Error(
      'GemRate monthly Sales/Change/% groups must be equal, contiguous, and followed by grading/link fields',
    )
  }

  const expectedGroups = new Map<number, string>([
    [salesStartIndex, 'Monthly Sales $ Volume'],
    [changeStartIndex, 'Monthly $ Change'],
    [percentStartIndex, 'Monthly % Change'],
    [linksStartIndex, 'Sales History Links (* requires subscription)'],
  ])
  for (const [index, value] of groupHeader.entries()) {
    if (value !== '' && expectedGroups.get(index) !== value) {
      throw new Error(`Unexpected GemRate group header at column ${index + 1}`)
    }
  }

  if (
    columnHeader[0] !== '' ||
    columnHeader[1] !== 'Player' ||
    columnHeader[2] !== 'Trailing 12mo Trend'
  ) {
    throw new Error('Unexpected fixed GemRate identity/trailing-sales headers')
  }
  const summaryMatch = columnHeader[3]?.match(/^(\d{4}) Summary$/u)
  if (!summaryMatch) throw new Error('GemRate current-year summary header is malformed')
  const currentYear = Number(summaryMatch[1])

  const salesMonths = columnHeader.slice(salesStartIndex, changeStartIndex)
  const changeMonths = columnHeader.slice(changeStartIndex, percentStartIndex)
  const percentMonths = columnHeader.slice(percentStartIndex, mostGradedYearIndex)
  if (
    JSON.stringify(salesMonths) !== JSON.stringify(changeMonths) ||
    JSON.stringify(salesMonths) !== JSON.stringify(percentMonths)
  ) {
    throw new Error('GemRate monthly Sales/Change/% headers must contain identical month sequences')
  }
  const expectedMonths = monthNames
    .slice(0, monthCount)
    .map((month) => `${month} ${currentYear}`)
  if (JSON.stringify(salesMonths) !== JSON.stringify(expectedMonths)) {
    throw new Error(
      `GemRate monthly headers must be a contiguous Jan-to-current sequence for ${currentYear}`,
    )
  }
  if (
    columnHeader[mostGradedYearIndex] !== 'Most Graded Year' ||
    columnHeader[firstGradedYearIndex] !== 'First Graded Year'
  ) {
    throw new Error('Unexpected GemRate grading-year headers')
  }
  for (const [offset, label] of linkHeaders.entries()) {
    if (columnHeader[linksStartIndex + offset] !== label) {
      throw new Error(`Unexpected GemRate sales-history header at column ${linksStartIndex + offset + 1}`)
    }
  }

  const dataThrough = new Date(Date.UTC(currentYear, monthCount, 0))
    .toISOString()
    .slice(0, 10)
  return {
    currentYear,
    dataThrough,
    expectedColumnCount,
    firstGradedYearIndex,
    monthCount,
    mostGradedYearIndex,
    salesStartIndex,
  }
}

function buildSalesRow(
  row: string[],
  sourceRowNumber: number,
  contract: ExportContract,
): GemRateAthleteSalesRow {
  const label = `GemRate source row ${sourceRowNumber}`
  const athleteName = row[1]!
  const sourceKey = sourceAthleteKey(athleteName)
  const normalizedName = normalizeAthleteName(athleteName)
  if (!sourceKey || !normalizedName) throw new Error(`${label} has an empty athlete name`)
  if (athleteName !== sourceKey) {
    throw new Error(`${label} athlete name contains non-canonical surrounding or repeated whitespace`)
  }

  const trailing12SalesUsd = parseTrailing12(row[2]!, `${label} trailing-12 sales`)
  const currentYtdSalesUsd = parseUsd(row[3]!, `${label} current-year summary`)
  const currentMonths = row
    .slice(contract.salesStartIndex, contract.salesStartIndex + contract.monthCount)
    .map((value, index) => (
      parseUsd(value, `${label} ${contract.currentYear} month ${index + 1}`, true)
    ))
  const monthlyTotal = currentMonths.reduce((total, value) => total + value, 0)
  if (monthlyTotal !== currentYtdSalesUsd) {
    throw new Error(
      `${label} current-year summary mismatch: summary ${currentYtdSalesUsd}, months ${monthlyTotal}`,
    )
  }
  const trailingCurrentMonths = trailing12SalesUsd.slice(-contract.monthCount)
  if (trailingCurrentMonths.some((value, index) => value !== currentMonths[index])) {
    throw new Error(`${label} trailing-12 values do not match the current-year monthly summary`)
  }

  const mostGradedYear = parseOptionalYear(
    row[contract.mostGradedYearIndex]!,
    `${label} most graded year`,
    contract.currentYear,
  )
  const firstGradedYear = parseOptionalYear(
    row[contract.firstGradedYearIndex]!,
    `${label} first graded year`,
    contract.currentYear,
  )
  if (
    firstGradedYear !== null &&
    mostGradedYear !== null &&
    mostGradedYear < firstGradedYear
  ) {
    throw new Error(`${label} most graded year precedes first graded year`)
  }

  return {
    athleteName,
    normalizedName,
    sourceKey,
    trailing12SalesUsd,
    currentYtdSalesUsd,
    firstGradedYear,
    mostGradedYear,
  }
}

export function buildGemRateSalesSnapshot(
  source: string | Buffer,
  acquiredAt = new Date().toISOString(),
  publishedAt?: string,
  options: GemRateSnapshotBuildOptions = {},
): GemRateAthleteSalesSnapshot {
  validateIsoTimestamp(acquiredAt, 'acquiredAt')
  const sourceBuffer = Buffer.isBuffer(source) ? source : Buffer.from(source, 'utf8')
  const parsed = parseCsv(sourceBuffer.toString('utf8'))
  const contract = inferExportContract(parsed)
  const resolvedPublishedAt = publishedAt ?? (
    contract.dataThrough === committedJuneDataThrough
      ? committedJunePublishedAt
      : null
  )
  if (!resolvedPublishedAt) {
    throw new Error(
      `--published-at is required for GemRate data through ${contract.dataThrough}`,
    )
  }
  validateIsoTimestamp(resolvedPublishedAt, 'publishedAt')
  const dataThroughEnd = Date.parse(`${contract.dataThrough}T23:59:59.999Z`)
  if (dataThroughEnd > Date.parse(resolvedPublishedAt)) {
    throw new Error('GemRate publishedAt cannot precede dataThrough')
  }
  if (Date.parse(resolvedPublishedAt) > Date.parse(acquiredAt)) {
    throw new Error('GemRate acquiredAt cannot precede publishedAt')
  }
  const sourceRows = parsed.slice(2)
  const minimumSourceRows =
    options.minimumSourceRows ?? minimumGemRateSourceRows
  if (sourceRows.length < minimumSourceRows) {
    throw new Error(
      `GemRate source row count ${sourceRows.length} is below the release floor ` +
      `${minimumSourceRows}`,
    )
  }

  for (const [index, row] of sourceRows.entries()) {
    if (row.length !== contract.expectedColumnCount) {
      throw new Error(
        `GemRate source row ${index + 3} has ${row.length} columns; ` +
        `expected ${contract.expectedColumnCount}`,
      )
    }
  }

  const baseballSourceRows = sourceRows
    .map((row, index) => ({ row, sourceRowNumber: index + 3 }))
    .filter(({ row }) => row[0] === baseballMarker)
  if (baseballSourceRows.length === 0) {
    throw new Error('GemRate CSV contains zero baseball rows')
  }
  const minimumBaseballRows =
    options.minimumBaseballRows ?? minimumGemRateBaseballRows
  if (baseballSourceRows.length < minimumBaseballRows) {
    throw new Error(
      `GemRate baseball row count ${baseballSourceRows.length} is below the release floor ` +
      `${minimumBaseballRows}`,
    )
  }

  const fullRows = new Set<string>()
  const sourceKeys = new Set<string>()
  const rows = baseballSourceRows.map(({ row, sourceRowNumber }) => {
    const serializedSourceRow = JSON.stringify(row)
    if (fullRows.has(serializedSourceRow)) {
      throw new Error(`GemRate CSV contains an exact duplicate baseball row at source row ${sourceRowNumber}`)
    }
    fullRows.add(serializedSourceRow)

    const salesRow = buildSalesRow(row, sourceRowNumber, contract)
    if (sourceKeys.has(salesRow.sourceKey)) {
      throw new Error(`GemRate CSV contains duplicate source athlete key ${JSON.stringify(salesRow.sourceKey)}`)
    }
    sourceKeys.add(salesRow.sourceKey)
    return salesRow
  }).toSorted((left, right) => (
    compareText(left.normalizedName, right.normalizedName) ||
    compareText(left.sourceKey, right.sourceKey)
  ))

  const namesByNormalizedName = new Map<string, string[]>()
  for (const row of rows) {
    const names = namesByNormalizedName.get(row.normalizedName) ?? []
    names.push(row.athleteName)
    namesByNormalizedName.set(row.normalizedName, names)
  }
  const ambiguousNormalizedNames = [...namesByNormalizedName]
    .filter(([, athleteNames]) => athleteNames.length > 1)
    .map(([normalizedName, athleteNames]) => ({
      normalizedName,
      athleteNames: athleteNames.toSorted(compareText),
    }))
    .toSorted((left, right) => compareText(left.normalizedName, right.normalizedName))

  return {
    schemaVersion,
    source: {
      url: sourceUrl,
      permissionBasis,
      csvSha256: sha256(sourceBuffer),
    },
    dataThrough: contract.dataThrough,
    publishedAt: resolvedPublishedAt,
    acquiredAt,
    rowsSha256: sha256(JSON.stringify(rows)),
    metadata: {
      sourceRowCount: sourceRows.length,
      baseballRowCount: rows.length,
      ambiguousNormalizedNames,
    },
    rows,
  }
}

interface CliArguments {
  inputPath: string
  outputPath: string
  acquiredAt: string
  publishedAt?: string
}

function parseCliArguments(arguments_: string[]): CliArguments {
  let inputPath = ''
  let outputPath = defaultOutputPath
  let acquiredAt = new Date().toISOString()
  let publishedAt: string | undefined

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (
      argument === '--input' ||
      argument === '--output' ||
      argument === '--acquired-at' ||
      argument === '--published-at'
    ) {
      if (!value) throw new Error(`${argument} requires a value`)
      if (argument === '--input') inputPath = resolve(value)
      if (argument === '--output') outputPath = resolve(value)
      if (argument === '--acquired-at') acquiredAt = value
      if (argument === '--published-at') publishedAt = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument ${JSON.stringify(argument)}`)
  }

  if (!inputPath) throw new Error('--input is required')
  return { inputPath, outputPath, acquiredAt, publishedAt }
}

async function run(): Promise<void> {
  const arguments_ = parseCliArguments(process.argv.slice(2))
  const source = await readFile(arguments_.inputPath)
  const snapshot = buildGemRateSalesSnapshot(
    source,
    arguments_.acquiredAt,
    arguments_.publishedAt,
  )
  await writeFile(arguments_.outputPath, `${JSON.stringify(snapshot)}\n`)
  process.stdout.write(
    `Wrote ${snapshot.metadata.baseballRowCount} GemRate baseball rows ` +
    `(${snapshot.metadata.ambiguousNormalizedNames.length} ambiguous normalized-name groups) ` +
    `to ${arguments_.outputPath}\n`,
  )
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  run().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unknown error'}\n`)
    process.exitCode = 1
  })
}
