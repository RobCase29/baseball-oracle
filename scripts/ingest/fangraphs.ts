import { z } from 'zod'
import {
  fetchWithRetry as fetchUrlWithRetry,
  sha256,
  stableStringify,
  type SourceRecord,
} from './shared.js'

export {
  idempotencyKey,
  normalizeRequestUrl,
  requestFingerprint,
  safeResponseHeaders,
  sanitizedRequest,
  schemaFingerprint,
  sha256,
  stableStringify,
  type SourceRecord,
} from './shared.js'

const sourceRecordSchema = z.record(z.string(), z.unknown())

export const fangraphsEnvelopeSchema = z
  .object({
    dataScout: z.array(sourceRecordSchema),
    dataStats: z.array(sourceRecordSchema),
  })
  .passthrough()

export type FangraphsEnvelope = z.infer<typeof fangraphsEnvelopeSchema>
export const PARSER_VERSION = 'fangraphs-prospect-board-v2'

export const FANGRAPHS_CURRENT_STATS_ROLES = ['bat', 'pit'] as const
export type FangraphsCurrentStatsRole =
  (typeof FANGRAPHS_CURRENT_STATS_ROLES)[number]

const prospectLeagueIds = [
  2, 4, 5, 6, 7, 8, 9, 10, 11, 14, 12, 13, 15, 16, 17, 18, 30, 32, 33,
] as const

export const FANGRAPHS_CURRENT_MINIMUM_ROWS = {
  scout: 250,
  stats: 200,
} as const

export interface FangraphsCurrentValidationOptions {
  enforceCardinality?: boolean
  season: number
  statsRole: FangraphsCurrentStatsRole
}

function validSeason(season: number): void {
  if (!Number.isInteger(season) || season < 1900 || season > 2200) {
    throw new Error('FanGraphs season must be an integer between 1900 and 2200')
  }
}

export function buildFangraphsCurrentProspectsUrl(
  season: number,
  statsRole: FangraphsCurrentStatsRole,
): string {
  validSeason(season)
  const url = new URL(
    'https://www.fangraphs.com/api/prospects/board/prospects-list-combined',
  )
  url.searchParams.set('pos', 'all')
  url.searchParams.set('lg', prospectLeagueIds.join(','))
  url.searchParams.set('stats', statsRole)
  url.searchParams.set('qual', '0')
  url.searchParams.set('type', '0')
  url.searchParams.set('team', '')
  url.searchParams.set('season', String(season))
  url.searchParams.set('seasonend', String(season))
  url.searchParams.set('draft', `${season}prospect`)
  url.searchParams.set('valueheader', 'prospect-new')
  url.searchParams.set('quickleaderboard', `${season}all`)
  return url.toString()
}

function integerValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/u.test(value.trim())) {
    return Number(value.trim())
  }
  return null
}

function identifierValue(record: SourceRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() && value.trim() !== '0') {
      return value.trim()
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return String(value)
    }
  }
  return null
}

function assertUniqueExactKeys(
  records: SourceRecord[],
  keyFor: (record: SourceRecord) => string | null,
  label: string,
): void {
  const seen = new Set<string>()
  for (const record of records) {
    const key = keyFor(record)
    if (key === null) continue
    if (seen.has(key)) {
      throw new Error(`FanGraphs ${label} contains duplicate exact identity ${key}`)
    }
    seen.add(key)
  }
}

export function assertFangraphsCurrentEnvelope(
  envelope: FangraphsEnvelope,
  options: FangraphsCurrentValidationOptions,
): void {
  validSeason(options.season)
  if (
    options.enforceCardinality &&
    envelope.dataScout.length < FANGRAPHS_CURRENT_MINIMUM_ROWS.scout
  ) {
    throw new Error(
      `FanGraphs ${options.statsRole} scouting feed returned ${envelope.dataScout.length} rows; ` +
        `expected at least ${FANGRAPHS_CURRENT_MINIMUM_ROWS.scout}`,
    )
  }
  if (
    options.enforceCardinality &&
    envelope.dataStats.length < FANGRAPHS_CURRENT_MINIMUM_ROWS.stats
  ) {
    throw new Error(
      `FanGraphs ${options.statsRole} statistics feed returned ${envelope.dataStats.length} rows; ` +
        `expected at least ${FANGRAPHS_CURRENT_MINIMUM_ROWS.stats}`,
    )
  }

  const wrongScoutSeason = envelope.dataScout.find(
    (record) => integerValue(record.Season) !== options.season,
  )
  const wrongStatsSeason = envelope.dataStats.find(
    (record) => integerValue(record.Season) !== options.season,
  )
  if (wrongScoutSeason || wrongStatsSeason) {
    throw new Error(
      `FanGraphs ${options.statsRole} feed contains a row outside requested season ${options.season}`,
    )
  }

  const expectedWorkloadField = options.statsRole === 'bat' ? 'PA' : 'IP'
  if (
    envelope.dataStats.some((record) => !(expectedWorkloadField in record))
  ) {
    throw new Error(
      `FanGraphs ${options.statsRole} feed is missing ${expectedWorkloadField} from a statistics row`,
    )
  }

  const incompleteStatsIdentity = envelope.dataStats.find((record) => {
    const upid = identifierValue(record, 'UPID')
    const minorMaster = identifierValue(record, 'minormasterid', 'minorMasterId')
    const mlbam = identifierValue(record, 'xMLBAMID')
    return upid === null || minorMaster === null || mlbam === null
  })
  if (incompleteStatsIdentity) {
    throw new Error(
      `FanGraphs ${options.statsRole} feed contains a statistics row without exact UPID, MinorMaster, and MLBAM identifiers`,
    )
  }

  assertUniqueExactKeys(
    envelope.dataScout,
    (record) => {
      const upid = identifierValue(record, 'UPID', 'PlayerId')
      const minorMaster = identifierValue(record, 'minorMasterId', 'minormasterid')
      return upid && minorMaster ? `${upid}:${minorMaster}` : null
    },
    `${options.statsRole} scouting feed`,
  )
  assertUniqueExactKeys(
    envelope.dataStats,
    (record) => {
      const upid = identifierValue(record, 'UPID')
      const minorMaster = identifierValue(record, 'minormasterid', 'minorMasterId')
      const mlbam = identifierValue(record, 'xMLBAMID')
      return upid && minorMaster && mlbam ? `${upid}:${minorMaster}:${mlbam}` : null
    },
    `${options.statsRole} statistics feed`,
  )
  for (const [label, keys] of [
    ['UPID', ['UPID']],
    ['MinorMaster', ['minormasterid', 'minorMasterId']],
    ['MLBAM', ['xMLBAMID']],
  ] as const) {
    assertUniqueExactKeys(
      envelope.dataStats,
      (record) => identifierValue(record, ...keys),
      `${options.statsRole} statistics ${label} mapping`,
    )
  }
}

function identifier(record: SourceRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return `${key}:${value.trim()}`
    if (typeof value === 'number' && Number.isFinite(value)) return `${key}:${value}`
  }
  return null
}

export function sourceRecordKey(
  recordType: 'scout' | 'stats',
  record: SourceRecord,
): string {
  if (recordType === 'scout') {
    return (
      identifier(record, ['RowID', 'ID', 'PlayerId', 'UPID', 'minorMasterId']) ??
      `hash:${sha256(stableStringify(record))}`
    )
  }

  const player =
    identifier(record, ['UPID', 'minormasterid', 'xMLBAMID', 'playerids']) ??
    `hash:${sha256(stableStringify(record)).slice(0, 24)}`
  const context = ['Season', 'level', 'aLevel', 'Team', 'AffId', 'playerTeamId']
    .map((key) => `${key}:${String(record[key] ?? '')}`)
    .join('|')

  return `${player}|${context}`
}

export function parseFangraphsEnvelope(body: string): FangraphsEnvelope {
  return fangraphsEnvelopeSchema.parse(JSON.parse(body))
}

export async function fetchWithRetry(
  url: string,
  attempts = 3,
  signal?: AbortSignal,
): Promise<Response> {
  return fetchUrlWithRetry(url, {
    attempts,
    signal,
    sourceName: 'FanGraphs',
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'BaseballOracleResearch/0.1 (+https://github.com/RobCase29/baseball-oracle)',
    },
  })
}
