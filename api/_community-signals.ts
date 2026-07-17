import { neon } from '@neondatabase/serverless'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  COMMUNITY_SIGNALS_CONTRACT_VERSION,
  COMMUNITY_SIGNALS_SCHEMA_VERSION,
  type CommunitySignalItem,
  type CommunitySignalsResponse,
} from '../src/domain/communitySignals.js'

const maximumIds = 100
const canonicalOracleIdPattern = /^[A-Za-z0-9][A-Za-z0-9:._~'@/+-]{0,199}$/u
const mlbamIdPattern = /^\d{1,12}$/u
const prefixedMlbamIdPattern = /^mlbam:(\d{1,12})(?::(?:hitter|pitcher|two-way))?$/iu
const publicCache = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600'

type DatabaseNumber = bigint | number | string | null

export interface CommunitySignalRow {
  oracle_player_id: string | null
  mlbam_id: DatabaseNumber
  hkb_player_id: string
  player_name: string
  dynasty_value: DatabaseNumber
  overall_rank: DatabaseNumber
  overall_universe: DatabaseNumber
  prospect_rank: DatabaseNumber
  prospect_universe: DatabaseNumber
  rank_change_7d: DatabaseNumber
  rank_change_30d: DatabaseNumber
  value_change_7d: DatabaseNumber
  value_change_30d: DatabaseNumber
  rank_history_30d: unknown
  value_history_30d: unknown
  attention_count_30d: DatabaseNumber
  attention_rank_30d: DatabaseNumber
  prospect_attention_count_30d: DatabaseNumber
  prospect_attention_rank_30d: DatabaseNumber
  source_updated_at: string | null
  captured_at: string
  source_url: string | null
}

export interface CommunitySignalsQuery {
  requestedIds: string[]
  oracleIds: string[]
  mlbamIds: string[]
}

export interface CommunitySignalsDependencies {
  databaseUrl: () => string | null
  loadRows: (
    databaseUrl: string,
    oracleIds: string[],
    mlbamIds: string[],
  ) => Promise<CommunitySignalRow[]>
}

function databaseUrl(): string | null {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? null
}

async function loadRows(
  connectionString: string,
  oracleIds: string[],
  mlbamIds: string[],
): Promise<CommunitySignalRow[]> {
  const sql = neon(connectionString)
  const rows = await sql`
    SELECT
      oracle_player_id,
      mlbam_id,
      hkb_player_id,
      player_name,
      dynasty_value,
      overall_rank,
      overall_universe,
      prospect_rank,
      prospect_universe,
      rank_change_7d,
      rank_change_30d,
      value_change_7d,
      value_change_30d,
      rank_history_30d,
      value_history_30d,
      attention_count_30d,
      attention_rank_30d,
      prospect_attention_count_30d,
      prospect_attention_rank_30d,
      source_updated_at::text AS source_updated_at,
      captured_at::text AS captured_at,
      source_url
    FROM app.hkb_current_comparison_signal
    WHERE
      mlbam_id IS NOT NULL
      AND (
        oracle_player_id = ANY(${oracleIds}::text[])
        OR mlbam_id = ANY(${mlbamIds}::bigint[])
      )
    ORDER BY captured_at DESC, hkb_player_id
  `
  return rows as CommunitySignalRow[]
}

const defaultDependencies: CommunitySignalsDependencies = {
  databaseUrl,
  loadRows,
}

function singleQueryParameter(searchParams: URLSearchParams, name: string): string | null {
  const values = searchParams.getAll(name)
  return values.length === 1 ? values[0] : null
}

function normalizedMlbamId(value: string): string | null {
  const match = prefixedMlbamIdPattern.exec(value)
  const digits = match?.[1] ?? (mlbamIdPattern.test(value) ? value : null)
  if (digits === null) return null
  const normalized = digits.replace(/^0+(?=\d)/u, '')
  const numeric = Number(normalized)
  return Number.isSafeInteger(numeric) && numeric > 0 ? normalized : null
}

export function parseCommunitySignalsQuery(request: IncomingMessage): CommunitySignalsQuery | null {
  let url: URL
  try {
    url = new URL(request.url ?? '/', 'https://baseball-oracle.local')
  } catch {
    return null
  }
  if (Array.from(url.searchParams.keys()).some((name) => name !== 'ids')) return null
  const idsValue = singleQueryParameter(url.searchParams, 'ids')
  if (idsValue === null || idsValue.length > 10_000) return null
  const requestedIds = idsValue.split(',').map((value) => value.trim())
  if (
    requestedIds.length === 0 ||
    requestedIds.length > maximumIds ||
    requestedIds.some((value) => value.length === 0 || !canonicalOracleIdPattern.test(value)) ||
    new Set(requestedIds).size !== requestedIds.length
  ) return null

  const oracleIds: string[] = []
  const mlbamIds: string[] = []
  const normalizedRequestKeys = new Set<string>()
  for (const id of requestedIds) {
    const mlbamId = normalizedMlbamId(id)
    const requestKey = mlbamId === null ? `oracle:${id}` : `mlbam:${mlbamId}`
    if (normalizedRequestKeys.has(requestKey)) return null
    normalizedRequestKeys.add(requestKey)
    if (mlbamId === null) oracleIds.push(id)
    else mlbamIds.push(mlbamId)
  }
  return { requestedIds, oracleIds, mlbamIds }
}

function numberOrNull(value: DatabaseNumber): number | null {
  if (value === null) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function integerOrNull(value: DatabaseNumber): number | null {
  const number = numberOrNull(value)
  return number !== null && Number.isSafeInteger(number) ? number : null
}

function positiveIntegerOrNull(value: DatabaseNumber): number | null {
  const number = integerOrNull(value)
  return number !== null && number > 0 ? number : null
}

function requiredPositiveId(value: DatabaseNumber, label: string): string {
  const number = positiveIntegerOrNull(value)
  if (number === null) throw new Error(`Invalid ${label}`)
  return String(number)
}

function dynastyValue(value: DatabaseNumber): number {
  const number = integerOrNull(value)
  if (number === null || number < 10 || number > 10_000) {
    throw new Error('Invalid Dynasty Score value')
  }
  return number
}

function historyValues(
  value: unknown,
  validator: (entry: number) => boolean,
): Array<number | null> | null {
  if (value === null || value === undefined) return null
  let parsed: unknown = value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown
    } catch {
      return null
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 31) return null
  const numbers = parsed.map((entry) => (
    entry === null ? null : typeof entry === 'number' ? entry : Number(entry)
  ))
  return numbers.every((entry) => (
    entry === null || (Number.isSafeInteger(entry) && validator(entry))
  ))
    ? numbers
    : null
}

function timestamp(value: string | null, required: true): string
function timestamp(value: string | null, required: false): string | null
function timestamp(value: string | null, required: boolean): string | null {
  if (value === null || !Number.isFinite(Date.parse(value))) {
    if (required) throw new Error('Invalid community signal timestamp')
    return null
  }
  return new Date(value).toISOString()
}

export function communitySignalItem(row: CommunitySignalRow): CommunitySignalItem {
  const value = dynastyValue(row.dynasty_value)
  const capturedAt = timestamp(row.captured_at, true)
  const itemWithoutVersion: Omit<CommunitySignalItem, 'recordVersion'> = {
    player: {
      oracleId: row.oracle_player_id,
      mlbamId: requiredPositiveId(row.mlbam_id, 'MLBAM ID'),
      name: row.player_name,
    },
    dynastyScore: {
      label: 'Dynasty Score',
      value,
      signalStatus: value <= 10 ? 'default_floor' : 'ranked',
      overallRank: positiveIntegerOrNull(row.overall_rank),
      overallUniverse: positiveIntegerOrNull(row.overall_universe),
      prospectRank: positiveIntegerOrNull(row.prospect_rank),
      prospectUniverse: positiveIntegerOrNull(row.prospect_universe),
      movement: {
        rank7d: integerOrNull(row.rank_change_7d),
        rank30d: integerOrNull(row.rank_change_30d),
        value7d: integerOrNull(row.value_change_7d),
        value30d: integerOrNull(row.value_change_30d),
      },
      attention: {
        views30d: positiveIntegerOrNull(row.attention_count_30d),
        rank30d: positiveIntegerOrNull(row.attention_rank_30d),
        prospectViews30d: positiveIntegerOrNull(row.prospect_attention_count_30d),
        prospectRank30d: positiveIntegerOrNull(row.prospect_attention_rank_30d),
      },
      history: {
        rank30d: historyValues(row.rank_history_30d, (entry) => entry > 0),
        value30d: historyValues(
          row.value_history_30d,
          (entry) => entry >= 10 && entry <= 10_000,
        ),
      },
    },
    observation: {
      capturedAt,
      dataUpdatedAt: timestamp(row.source_updated_at, false),
    },
  }
  const digest = createHash('sha256').update(JSON.stringify(itemWithoutVersion)).digest('hex')
  return { recordVersion: `sha256:${digest}`, ...itemWithoutVersion }
}

function requestedIdMatches(item: CommunitySignalItem, requestedId: string): boolean {
  const mlbamId = normalizedMlbamId(requestedId)
  return mlbamId === null
    ? item.player.oracleId === requestedId
    : item.player.mlbamId === mlbamId
}

function latestTimestamp(values: Array<string | null>): string | null {
  const validValues = values.filter((value): value is string => (
    value !== null && Number.isFinite(Date.parse(value))
  ))
  return validValues.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
}

export function communitySignalsResponse(
  rows: CommunitySignalRow[],
  requestedIds: string[],
): CommunitySignalsResponse {
  const normalizedItems = rows.map(communitySignalItem)
  const items: CommunitySignalItem[] = []
  const unmatchedIds: string[] = []
  const servedMlbamIds = new Set<string>()
  for (const requestedId of requestedIds) {
    const item = normalizedItems.find((candidate) => requestedIdMatches(candidate, requestedId))
    if (!item) {
      unmatchedIds.push(requestedId)
      continue
    }
    if (!servedMlbamIds.has(item.player.mlbamId)) {
      items.push(item)
      servedMlbamIds.add(item.player.mlbamId)
    }
  }

  const observedAt = latestTimestamp(items.map((item) => item.observation.capturedAt))
  const dataUpdatedAt = latestTimestamp(items.map((item) => item.observation.dataUpdatedAt))
  const snapshot = observedAt === null ? null : {
    id: `dynasty-scores-snapshot/v1:${createHash('sha256').update(JSON.stringify({
      schemaVersion: COMMUNITY_SIGNALS_SCHEMA_VERSION,
      contractVersion: COMMUNITY_SIGNALS_CONTRACT_VERSION,
      observedAt,
      dataUpdatedAt,
      records: items.map((item) => item.recordVersion).sort(),
    })).digest('hex')}`,
    observedAt,
    dataUpdatedAt,
  }
  return {
    schemaVersion: COMMUNITY_SIGNALS_SCHEMA_VERSION,
    contractVersion: COMMUNITY_SIGNALS_CONTRACT_VERSION,
    snapshot,
    items,
    meta: {
      excludedFromOracleModel: true,
      nullMeans: 'unavailable_not_zero',
      nullMeansUnavailableNotZero: true,
      identityPolicy: 'exact_mlbam_join_no_name_matching',
      signalType: 'external_dynasty_consensus',
      dynastyScoreScale: {
        minimum: 10,
        maximum: 10_000,
        unit: 'dynasty score points',
        isProbability: false,
      },
      requestedIds,
      unmatchedIds,
    },
  }
}

function setResponseHeaders(response: ServerResponse, cacheControl: string): void {
  response.setHeader('Cache-Control', cacheControl)
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
}

function weakEtagValue(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('W/') ? trimmed.slice(2).trim() : trimmed
}

function matchesIfNoneMatch(
  header: string | string[] | undefined,
  etag: string,
): boolean {
  if (header === undefined) return false
  return (Array.isArray(header) ? header : [header])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .some((value) => value === '*' || weakEtagValue(value) === etag)
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  cacheControl = 'no-store',
): void {
  const json = JSON.stringify(body)
  const etag = `"${createHash('sha256').update(json).digest('base64url')}"`
  response.statusCode = statusCode
  setResponseHeaders(response, cacheControl)
  response.setHeader('ETag', etag)
  if (statusCode === 200 && matchesIfNoneMatch(request.headers?.['if-none-match'], etag)) {
    response.statusCode = 304
    response.removeHeader('Content-Type')
    response.end()
    return
  }
  response.setHeader('Content-Length', Buffer.byteLength(json).toString())
  response.end(request.method === 'HEAD' ? undefined : json)
}

export function createCommunitySignalsHandler(
  dependencies: CommunitySignalsDependencies = defaultDependencies,
) {
  return async function communitySignalsHandler(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD')
      sendJson(request, response, 405, { error: 'Method not allowed' })
      return
    }
    const query = parseCommunitySignalsQuery(request)
    if (!query) {
      sendJson(request, response, 400, { error: 'Invalid query parameters' })
      return
    }
    const connectionString = dependencies.databaseUrl()
    if (!connectionString) {
      sendJson(request, response, 503, { error: 'Community signal data is not configured' })
      return
    }
    try {
      const rows = await dependencies.loadRows(
        connectionString,
        query.oracleIds,
        query.mlbamIds,
      )
      const body = communitySignalsResponse(rows, query.requestedIds)
      if (body.snapshot) response.setHeader('X-Snapshot-Id', body.snapshot.id)
      sendJson(request, response, 200, body, publicCache)
    } catch (error) {
      console.error('Community signals query failed', error)
      sendJson(request, response, 500, { error: 'Community signal data is temporarily unavailable' })
    }
  }
}

export default createCommunitySignalsHandler()
