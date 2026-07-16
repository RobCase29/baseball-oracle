import type { FootballPosition, FootballUniverse } from './footballData'
import type {
  FootballMarketComparisonScope,
  FootballMarketRanking as LiveFootballMarketRanking,
  FootballMarketProviderId,
} from './marketFeedContract'

export interface MarketRanking {
  name: string
  normalizedName: string
  universe: FootballUniverse
  position: FootballPosition
  source: string
  formatId: string
  positionRank: number
  positionUniverseSize: number
  positionPercentile: number
  asOf: string
  provider?: FootballMarketProviderId
  providerPlayerId?: string
  requestedFormatId?: string
  comparisonScope?: FootballMarketComparisonScope
  overallRank?: number | null
  value?: number | null
  tier?: number | null
  sourceUrl?: string
  fetchedAt?: string
}

export interface MarketConsensus {
  positionRank: number
  positionPercentile: number
  sourceCount: number
  sources: readonly string[]
  asOf: string
}

const REQUIRED_COLUMNS = [
  'name',
  'universe',
  'position',
  'source',
  'format_id',
  'position_rank',
  'position_universe_size',
  'as_of',
  'rights_attested',
] as const
const POSITIONS = new Set<FootballPosition>(['QB', 'WR', 'RB', 'TE'])
const UNIVERSES = new Set<FootballUniverse>(['college', 'nfl'])
const RESERVED_AUTOMATED_SOURCE_KEYS = ['keeptradecut', 'dynastydaddy', 'adpdaddy'] as const

export function normalizeFootballPlayerName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      values.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }

  if (quoted) throw new Error('The CSV contains an unterminated quoted value.')
  values.push(current.trim())
  return values
}

function normalizeSourceKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isReservedAutomatedSource(value: string): boolean {
  const key = normalizeSourceKey(value)
  return key === 'ktc' || RESERVED_AUTOMATED_SOURCE_KEYS.some((reservedKey) => key.includes(reservedKey))
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function positionPercentile(positionRank: number, positionUniverseSize: number): number {
  if (positionUniverseSize === 1) return 100
  return 100 * (1 - ((positionRank - 1) / (positionUniverseSize - 1)))
}

export function parseMarketRankingsCsv(input: string): MarketRanking[] {
  const lines = input
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)

  if (lines.length < 2) throw new Error('Add a header and at least one ranking row.')

  const headers = parseCsvLine(lines[0]).map((value) => value.toLowerCase())
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column))
  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns: ${missingColumns.join(', ')}.`)
  }

  const column = Object.fromEntries(headers.map((header, index) => [header, index]))
  const rankings = lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line)
    const rowNumber = rowIndex + 2
    const name = values[column.name]?.trim() ?? ''
    const universe = values[column.universe]?.trim().toLowerCase() as FootballUniverse
    const position = values[column.position]?.trim().toUpperCase() as FootballPosition
    const source = values[column.source]?.trim() ?? ''
    const formatId = values[column.format_id]?.trim().toLowerCase() ?? ''
    const positionRank = Number(values[column.position_rank])
    const positionUniverseSize = Number(values[column.position_universe_size])
    const asOf = values[column.as_of]?.trim() ?? ''
    const rightsAttested = values[column.rights_attested]?.trim().toLowerCase() ?? ''

    if (!name || !normalizeFootballPlayerName(name)) throw new Error(`Row ${rowNumber}: name is required.`)
    if (!UNIVERSES.has(universe)) throw new Error(`Row ${rowNumber}: universe must be college or nfl.`)
    if (!POSITIONS.has(position)) throw new Error(`Row ${rowNumber}: position must be QB, WR, RB, or TE.`)
    if (!source) throw new Error(`Row ${rowNumber}: source is required.`)
    if (isReservedAutomatedSource(source)) {
      throw new Error(`Row ${rowNumber}: ${source} is reserved for the verified automated feed.`)
    }
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(formatId)) {
      throw new Error(`Row ${rowNumber}: format_id must be a lowercase underscore-delimited identifier.`)
    }
    if (!Number.isInteger(positionRank) || positionRank < 1) {
      throw new Error(`Row ${rowNumber}: position_rank must be a positive integer.`)
    }
    if (!Number.isInteger(positionUniverseSize) || positionUniverseSize < 1) {
      throw new Error(`Row ${rowNumber}: position_universe_size must be a positive integer.`)
    }
    if (positionRank > positionUniverseSize) {
      throw new Error(`Row ${rowNumber}: position_rank cannot exceed position_universe_size.`)
    }
    if (!isIsoCalendarDate(asOf)) {
      throw new Error(`Row ${rowNumber}: as_of must use YYYY-MM-DD.`)
    }
    if (rightsAttested !== 'true') {
      throw new Error(`Row ${rowNumber}: rights_attested must be true for display and comparison.`)
    }

    return {
      name,
      normalizedName: normalizeFootballPlayerName(name),
      universe,
      position,
      source,
      formatId,
      positionRank,
      positionUniverseSize,
      positionPercentile: positionPercentile(positionRank, positionUniverseSize),
      asOf,
    }
  })

  const keys = rankings.map((ranking) => (
    `${ranking.normalizedName}:${ranking.universe}:${ranking.position}:${normalizeSourceKey(ranking.source)}:${ranking.formatId}`
  ))
  if (new Set(keys).size !== keys.length) {
    throw new Error('The CSV contains duplicate player, universe, position, source, and format rows.')
  }

  return rankings
}

export function marketRankingFromLiveFeed(ranking: LiveFootballMarketRanking): MarketRanking {
  return {
    name: ranking.name,
    normalizedName: ranking.normalizedName,
    universe: ranking.universe,
    position: ranking.position,
    source: ranking.providerLabel,
    formatId: ranking.formatId,
    positionRank: ranking.positionRank,
    positionUniverseSize: ranking.positionUniverseSize,
    positionPercentile: ranking.positionPercentile,
    asOf: ranking.fetchedAt.slice(0, 10),
    provider: ranking.provider,
    providerPlayerId: ranking.providerPlayerId,
    requestedFormatId: ranking.requestedFormatId,
    comparisonScope: ranking.comparisonScope,
    overallRank: ranking.overallRank,
    value: ranking.value,
    tier: ranking.tier,
    sourceUrl: ranking.sourceUrl,
    fetchedAt: ranking.fetchedAt,
  }
}

export function marketRankingsForPlayer(
  rankings: readonly MarketRanking[],
  name: string,
  universe: FootballUniverse,
  position: FootballPosition,
  formatId: string,
): MarketRanking[] {
  const normalizedName = normalizeFootballPlayerName(name)
  return rankings
    .filter((ranking) => (
      ranking.normalizedName === normalizedName &&
      ranking.universe === universe &&
      ranking.position === position &&
      (
        ranking.formatId === formatId ||
        (
          ranking.comparisonScope === 'provider_default_directional' &&
          ranking.requestedFormatId === formatId
        )
      )
    ))
    .sort((left, right) => {
      if (left.comparisonScope === right.comparisonScope) return left.source.localeCompare(right.source)
      return left.comparisonScope === 'provider_default_directional' ? 1 : -1
    })
}

export function marketConsensusFor(
  rankings: readonly MarketRanking[],
  name: string,
  universe: FootballUniverse,
  position: FootballPosition,
  formatId: string,
): MarketConsensus | null {
  const normalizedName = normalizeFootballPlayerName(name)
  const matches = rankings.filter((ranking) => (
    ranking.normalizedName === normalizedName &&
    ranking.universe === universe &&
    ranking.position === position &&
    ranking.formatId === formatId
  ))
  if (matches.length === 0) return null

  const ranks = matches.map((ranking) => ranking.positionRank).sort((left, right) => left - right)
  const middle = Math.floor(ranks.length / 2)
  const median = ranks.length % 2 === 0
    ? (ranks[middle - 1] + ranks[middle]) / 2
    : ranks[middle]
  const percentiles = matches
    .map((ranking) => ranking.positionPercentile)
    .sort((left, right) => left - right)
  const percentileMedian = percentiles.length % 2 === 0
    ? (percentiles[middle - 1] + percentiles[middle]) / 2
    : percentiles[middle]

  return {
    positionRank: median,
    positionPercentile: percentileMedian,
    sourceCount: matches.length,
    sources: [...new Set(matches.map((ranking) => ranking.source))].sort(),
    asOf: matches.map((ranking) => ranking.asOf).sort().at(-1)!,
  }
}
