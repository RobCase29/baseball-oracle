import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  dynastyDaddyFormatFor,
  footballMarketFormatFamily,
  isFootballMarketFormatId,
  normalizeFootballMarketPlayerName,
  type FootballMarketFeedRequest,
  type FootballMarketFeedResponse,
  type FootballMarketFormatId,
  type FootballMarketPosition,
  type FootballMarketProviderErrorCode,
  type FootballMarketProviderStatus,
  type FootballMarketRanking,
  type FootballMarketUniverse,
} from '../../src/football/marketFeedContract.js'

const KTC_DYNASTY_URL = 'https://keeptradecut.com/dynasty-rankings'
const KTC_DEVY_URL = 'https://keeptradecut.com/devy-rankings'
const DYNASTY_DADDY_SOURCE_URL = 'https://dynasty-daddy.com/fantasy-rankings'
const DYNASTY_DADDY_FEED_URL = 'https://dynasty-daddy.com/api/v1/player/all/today?market=14'
const KTC_PLAYERS_MARKER = 'var playersArray = '
const KTC_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const DYNASTY_DADDY_MAX_RESPONSE_BYTES = 3 * 1024 * 1024
const MIN_SOURCE_ROWS = 25
const MAX_SOURCE_ROWS = 5_000
const DEFAULT_FETCH_TIMEOUT_MS = 15_000
const PUBLIC_CACHE_CONTROL = 'public, max-age=0, s-maxage=900, stale-while-revalidate=3600'
const NO_STORE = 'no-store'
const USER_AGENT = 'Baseball Oracle Football Market Feed/1.0 (+https://baseball-oracle.vercel.app/football)'
const SKILL_POSITIONS = new Set<FootballMarketPosition>(['QB', 'WR', 'RB', 'TE'])
const KTC_POSITIONS = new Set([...SKILL_POSITIONS, 'RDP'])
const DYNASTY_DADDY_POSITIONS = new Set([...SKILL_POSITIONS, 'PI'])

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface FootballMarketFeedDependencies {
  fetchFn?: FetchLike
  now?: () => Date
  timeoutMs?: number
}

export interface MarketParserContext {
  universe: FootballMarketUniverse
  formatId: FootballMarketFormatId
  fetchedAt: string
}

export class FootballMarketFeedError extends Error {
  readonly code: FootballMarketProviderErrorCode

  constructor(code: FootballMarketProviderErrorCode, message: string) {
    super(message)
    this.name = 'FootballMarketFeedError'
    this.code = code
  }
}

function schemaDrift(message: string): never {
  throw new FootballMarketFeedError('schema_drift', message)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    schemaDrift(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string, maxLength = 160): string {
  if (typeof value !== 'string') schemaDrift(`${label} must be a string`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) schemaDrift(`${label} is invalid`)
  return normalized
}

function providerId(value: unknown, label: string): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) schemaDrift(`${label} is invalid`)
    return String(value)
  }
  return requiredString(value, label, 120)
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    schemaDrift(`${label} must be an integer between ${minimum} and ${maximum}`)
  }
  return value as number
}

function nullableRank(value: unknown, label: string): number | null {
  if (value === null) return null
  const parsed = boundedInteger(value, label, 0, 10_000)
  return parsed === 0 ? null : parsed
}

function rankPercentile(rank: number, universeSize: number): number {
  if (universeSize === 1) return 100
  return 100 * (1 - ((rank - 1) / (universeSize - 1)))
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function assertSourceRowCount(rows: unknown[], source: string): void {
  if (rows.length < MIN_SOURCE_ROWS || rows.length > MAX_SOURCE_ROWS) {
    schemaDrift(`${source} returned ${rows.length} rows outside the accepted bounds`)
  }
}

function selectedKtcValues(
  row: Record<string, unknown>,
  formatId: FootballMarketFormatId,
  rowLabel: string,
  position: FootballMarketPosition,
): Record<string, unknown> {
  const family = footballMarketFormatFamily(formatId)
  const baseKey = family.lineup === 'sf' ? 'superflexValues' : 'oneQBValues'
  const base = record(row[baseKey], `${rowLabel}.${baseKey}`)
  if (family.tightEndPremium === 'no_tep') return base

  const premium = record(base[family.tightEndPremium], `${rowLabel}.${baseKey}.${family.tightEndPremium}`)
  return {
    value: premium.value,
    rank: premium.rank,
    positionalRank: position === 'TE' ? premium.positionalRank : base.positionalRank,
    positionalTier: position === 'TE' ? premium.positionalTier : base.positionalTier,
  }
}

function validateKtcLeagueType(html: string, universe: FootballMarketUniverse): void {
  const matches = [...html.matchAll(/\bvar\s+leagueType\s*=\s*([12])\s*;/gu)]
  if (matches.length !== 1) schemaDrift('KTC leagueType marker must occur exactly once')
  const expected = universe === 'college' ? '2' : '1'
  if (matches[0][1] !== expected) schemaDrift(`KTC leagueType does not match ${universe}`)
}

function finalizePositionUniverses(rows: Array<Omit<FootballMarketRanking, 'positionUniverseSize' | 'positionPercentile'>>): FootballMarketRanking[] {
  const sizes = new Map<FootballMarketPosition, number>()
  for (const row of rows) {
    sizes.set(row.position, Math.max(sizes.get(row.position) ?? 0, row.positionRank))
  }
  for (const position of SKILL_POSITIONS) {
    if (!sizes.has(position)) schemaDrift(`source omitted ranked ${position} rows`)
  }

  return rows
    .map((row) => {
      const positionUniverseSize = sizes.get(row.position)!
      return {
        ...row,
        positionUniverseSize,
        positionPercentile: rankPercentile(row.positionRank, positionUniverseSize),
      }
    })
    .sort((left, right) => (
      (left.overallRank ?? Number.POSITIVE_INFINITY) - (right.overallRank ?? Number.POSITIVE_INFINITY) ||
      left.position.localeCompare(right.position) ||
      left.positionRank - right.positionRank ||
      left.name.localeCompare(right.name)
    ))
}

export function extractKtcPlayersArray(html: string): unknown[] {
  if (utf8ByteLength(html) > KTC_MAX_RESPONSE_BYTES) {
    throw new FootballMarketFeedError('response_too_large', 'KTC response exceeded the byte limit')
  }

  const markerIndex = html.indexOf(KTC_PLAYERS_MARKER)
  if (markerIndex < 0 || html.indexOf(KTC_PLAYERS_MARKER, markerIndex + KTC_PLAYERS_MARKER.length) >= 0) {
    schemaDrift('KTC playersArray marker must occur exactly once')
  }

  let start = markerIndex + KTC_PLAYERS_MARKER.length
  while (/\s/u.test(html[start] ?? '')) start += 1
  if (html[start] !== '[') schemaDrift('KTC playersArray assignment must start with a JSON array')

  let depth = 0
  let inString = false
  let escaped = false
  let end = -1
  for (let index = start; index < html.length; index += 1) {
    const character = html[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
    } else if (character === '[') {
      depth += 1
    } else if (character === ']') {
      depth -= 1
      if (depth < 0) schemaDrift('KTC playersArray brackets are malformed')
      if (depth === 0) {
        end = index + 1
        break
      }
    }
  }
  if (inString || depth !== 0 || end < 0) schemaDrift('KTC playersArray is unterminated')
  if (!html.slice(end).trimStart().startsWith(';')) {
    schemaDrift('KTC playersArray assignment is missing its terminator')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(html.slice(start, end))
  } catch {
    schemaDrift('KTC playersArray is not valid JSON')
  }
  if (!Array.isArray(parsed)) schemaDrift('KTC playersArray did not decode to an array')
  assertSourceRowCount(parsed, 'KTC')
  return parsed
}

export function parseKtcMarketRankings(html: string, context: MarketParserContext): FootballMarketRanking[] {
  const sourceUrl = context.universe === 'college' ? KTC_DEVY_URL : KTC_DYNASTY_URL
  validateKtcLeagueType(html, context.universe)
  const parsed = extractKtcPlayersArray(html)
  const seenIds = new Set<string>()
  const seenSlugs = new Set<string>()
  const normalized: Array<Omit<FootballMarketRanking, 'positionUniverseSize' | 'positionPercentile'>> = []

  parsed.forEach((value, index) => {
    const rowLabel = `KTC row ${index + 1}`
    const row = record(value, rowLabel)
    const id = providerId(row.playerID, `${rowLabel}.playerID`)
    if (seenIds.has(id)) schemaDrift(`${rowLabel}.playerID is duplicated`)
    seenIds.add(id)
    const slug = requiredString(row.slug, `${rowLabel}.slug`, 180)
    if (seenSlugs.has(slug)) schemaDrift(`${rowLabel}.slug is duplicated`)
    seenSlugs.add(slug)
    const name = requiredString(row.playerName, `${rowLabel}.playerName`)
    const normalizedName = normalizeFootballMarketPlayerName(name)
    if (!normalizedName) schemaDrift(`${rowLabel}.playerName cannot be normalized`)
    if (typeof row.position !== 'string' || !KTC_POSITIONS.has(row.position)) {
      schemaDrift(`${rowLabel}.position is unsupported`)
    }
    if (!SKILL_POSITIONS.has(row.position as FootballMarketPosition)) return

    const position = row.position as FootballMarketPosition
    const values = selectedKtcValues(row, context.formatId, rowLabel, position)
    const positionRank = boundedInteger(values.positionalRank, `${rowLabel}.positionalRank`, 1, 10_000)
    const overallRank = boundedInteger(values.rank, `${rowLabel}.rank`, 1, 10_000)
    const rawValue = boundedInteger(values.value, `${rowLabel}.value`, -1, 1_000_000)
    const tier = boundedInteger(values.positionalTier, `${rowLabel}.positionalTier`, 1, 1_000)

    normalized.push({
      provider: 'keeptradecut',
      providerLabel: context.universe === 'college' ? 'KeepTradeCut Devy' : 'KeepTradeCut Dynasty',
      providerPlayerId: id,
      name,
      normalizedName,
      universe: context.universe,
      position,
      requestedFormatId: context.formatId,
      formatId: context.formatId,
      comparisonScope: 'exact_format',
      positionRank,
      overallRank,
      value: rawValue < 0 ? null : rawValue,
      tier,
      sourceUrl,
      fetchedAt: context.fetchedAt,
    })
  })

  if (normalized.length < MIN_SOURCE_ROWS) schemaDrift('KTC returned too few ranked skill-position rows')
  return finalizePositionUniverses(normalized)
}

export function parseDynastyDaddyMarketRankings(json: string, context: MarketParserContext): FootballMarketRanking[] {
  if (context.universe !== 'nfl') schemaDrift('Dynasty Daddy market 14 is not a college player source')
  if (utf8ByteLength(json) > DYNASTY_DADDY_MAX_RESPONSE_BYTES) {
    throw new FootballMarketFeedError('response_too_large', 'Dynasty Daddy response exceeded the byte limit')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    schemaDrift('Dynasty Daddy response is not valid JSON')
  }
  if (!Array.isArray(parsed)) schemaDrift('Dynasty Daddy response must be an array')
  assertSourceRowCount(parsed, 'Dynasty Daddy')

  const lineup = footballMarketFormatFamily(context.formatId).lineup
  const formatId = dynastyDaddyFormatFor(context.formatId)
  const rankKey = lineup === 'sf' ? 'sf_position_rank' : 'position_rank'
  const overallRankKey = lineup === 'sf' ? 'sf_overall_rank' : 'overall_rank'
  const valueKey = lineup === 'sf' ? 'sf_trade_value' : 'trade_value'
  const seenIds = new Set<string>()
  const normalized: Array<Omit<FootballMarketRanking, 'positionUniverseSize' | 'positionPercentile'>> = []

  parsed.forEach((value, index) => {
    const rowLabel = `Dynasty Daddy row ${index + 1}`
    const row = record(value, rowLabel)
    const id = providerId(row.name_id, `${rowLabel}.name_id`)
    if (seenIds.has(id)) schemaDrift(`${rowLabel}.name_id is duplicated`)
    seenIds.add(id)
    const name = requiredString(row.full_name, `${rowLabel}.full_name`)
    const normalizedName = normalizeFootballMarketPlayerName(name)
    if (!normalizedName) schemaDrift(`${rowLabel}.full_name cannot be normalized`)
    if (typeof row.position !== 'string' || !DYNASTY_DADDY_POSITIONS.has(row.position)) {
      schemaDrift(`${rowLabel}.position is unsupported`)
    }
    if (!SKILL_POSITIONS.has(row.position as FootballMarketPosition)) return
    if (!(rankKey in row) || !(overallRankKey in row) || !(valueKey in row)) {
      schemaDrift(`${rowLabel} is missing selected ${lineup} fields`)
    }

    const positionRank = nullableRank(row[rankKey], `${rowLabel}.${rankKey}`)
    const overallRank = nullableRank(row[overallRankKey], `${rowLabel}.${overallRankKey}`)
    const marketValue = boundedInteger(row[valueKey], `${rowLabel}.${valueKey}`, 0, 1_000_000)
    if (positionRank === null || marketValue <= 0) return

    normalized.push({
      provider: 'dynasty-daddy',
      providerLabel: 'Dynasty Daddy',
      providerPlayerId: id,
      name,
      normalizedName,
      universe: 'nfl',
      position: row.position as FootballMarketPosition,
      requestedFormatId: context.formatId,
      formatId,
      comparisonScope: 'provider_default_directional',
      positionRank,
      overallRank,
      value: marketValue,
      tier: null,
      sourceUrl: DYNASTY_DADDY_SOURCE_URL,
      fetchedAt: context.fetchedAt,
    })
  })

  if (normalized.length < MIN_SOURCE_ROWS) {
    schemaDrift('Dynasty Daddy returned too few ranked skill-position rows')
  }
  return finalizePositionUniverses(normalized)
}

export async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number(contentLength)
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new FootballMarketFeedError('response_too_large', 'Upstream Content-Length exceeded the byte limit')
    }
  }

  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let receivedBytes = 0
  let output = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      receivedBytes += chunk.value.byteLength
      if (receivedBytes > maxBytes) {
        await reader.cancel()
        throw new FootballMarketFeedError('response_too_large', 'Upstream body exceeded the byte limit')
      }
      output += decoder.decode(chunk.value, { stream: true })
    }
    output += decoder.decode()
    return output
  } finally {
    reader.releaseLock()
  }
}

async function fetchBoundedText(
  fetchFn: FetchLike,
  url: string,
  accept: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(url, {
      headers: { Accept: accept, 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new FootballMarketFeedError('upstream_http_error', `Upstream returned HTTP ${response.status}`)
    }
    return await readResponseTextWithLimit(response, maxBytes)
  } catch (error) {
    if (error instanceof FootballMarketFeedError) throw error
    if (controller.signal.aborted) {
      throw new FootballMarketFeedError('upstream_timeout', 'Upstream request timed out')
    }
    throw new FootballMarketFeedError('network_error', 'Upstream request failed')
  } finally {
    clearTimeout(timeout)
  }
}

function providerErrorCode(error: unknown): FootballMarketProviderErrorCode {
  return error instanceof FootballMarketFeedError ? error.code : 'network_error'
}

function ktcStatus(
  request: FootballMarketFeedRequest,
  status: FootballMarketProviderStatus['status'],
  fetchedAt: string | null,
  rowCount: number,
  errorCode: FootballMarketProviderErrorCode | null,
): FootballMarketProviderStatus {
  return {
    provider: 'keeptradecut',
    label: request.universe === 'college' ? 'KeepTradeCut Devy' : 'KeepTradeCut Dynasty',
    status,
    sourceUrl: request.universe === 'college' ? KTC_DEVY_URL : KTC_DYNASTY_URL,
    fetchedAt,
    rowCount,
    errorCode,
    comparisonScope: 'exact_format',
    formatId: request.formatId,
  }
}

function dynastyDaddyStatus(
  request: FootballMarketFeedRequest,
  status: FootballMarketProviderStatus['status'],
  fetchedAt: string | null,
  rowCount: number,
  errorCode: FootballMarketProviderErrorCode | null,
): FootballMarketProviderStatus {
  return {
    provider: 'dynasty-daddy',
    label: 'Dynasty Daddy',
    status,
    sourceUrl: DYNASTY_DADDY_SOURCE_URL,
    fetchedAt,
    rowCount,
    errorCode,
    comparisonScope: 'provider_default_directional',
    formatId: dynastyDaddyFormatFor(request.formatId),
  }
}

export async function loadFootballMarketFeed(
  request: FootballMarketFeedRequest,
  dependencies: FootballMarketFeedDependencies = {},
): Promise<FootballMarketFeedResponse> {
  const fetchFn = dependencies.fetchFn ?? globalThis.fetch
  const fetchedAt = (dependencies.now ?? (() => new Date()))().toISOString()
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const ktcUrl = request.universe === 'college' ? KTC_DEVY_URL : KTC_DYNASTY_URL
  const context: MarketParserContext = { ...request, fetchedAt }

  const ktcPromise = fetchBoundedText(
    fetchFn,
    ktcUrl,
    'text/html,application/xhtml+xml;q=0.9',
    KTC_MAX_RESPONSE_BYTES,
    timeoutMs,
  )
    .then((body) => parseKtcMarketRankings(body, context))
    .then((rows) => ({ rows, status: ktcStatus(request, 'available', fetchedAt, rows.length, null) }))
    .catch((error: unknown) => ({
      rows: [] as FootballMarketRanking[],
      status: ktcStatus(request, 'unavailable', null, 0, providerErrorCode(error)),
    }))

  const dynastyDaddyPromise = request.universe === 'college'
    ? Promise.resolve({
        rows: [] as FootballMarketRanking[],
        status: dynastyDaddyStatus(request, 'unsupported', null, 0, 'unsupported_universe'),
      })
    : fetchBoundedText(
        fetchFn,
        DYNASTY_DADDY_FEED_URL,
        'application/json',
        DYNASTY_DADDY_MAX_RESPONSE_BYTES,
        timeoutMs,
      )
        .then((body) => parseDynastyDaddyMarketRankings(body, context))
        .then((rows) => ({
          rows,
          status: dynastyDaddyStatus(request, 'available', fetchedAt, rows.length, null),
        }))
        .catch((error: unknown) => ({
          rows: [] as FootballMarketRanking[],
          status: dynastyDaddyStatus(request, 'unavailable', null, 0, providerErrorCode(error)),
        }))

  const [ktc, dynastyDaddy] = await Promise.all([ktcPromise, dynastyDaddyPromise])
  return {
    schemaVersion: 'football-market-feed.v1',
    generatedAt: fetchedAt,
    request,
    providers: [ktc.status, dynastyDaddy.status],
    rankings: [...ktc.rows, ...dynastyDaddy.rows],
  }
}

export function parseFootballMarketFeedQuery(request: IncomingMessage): FootballMarketFeedRequest | null {
  if (!request.url) return null
  let url: URL
  try {
    url = new URL(request.url, 'http://localhost')
  } catch {
    return null
  }
  const keys = [...url.searchParams.keys()]
  if (keys.some((key) => key !== 'universe' && key !== 'format')) return null
  if (url.searchParams.getAll('universe').length !== 1 || url.searchParams.getAll('format').length !== 1) {
    return null
  }
  const universe = url.searchParams.get('universe')
  const formatId = url.searchParams.get('format')
  if ((universe !== 'college' && universe !== 'nfl') || !formatId || !isFootballMarketFormatId(formatId)) {
    return null
  }
  return { universe, formatId }
}

function responseHeaders(response: ServerResponse, cacheControl: string): void {
  response.setHeader('Cache-Control', cacheControl)
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('X-Content-Type-Options', 'nosniff')
}

export function createFootballMarketFeedHandler(dependencies: FootballMarketFeedDependencies = {}) {
  return async function footballMarketFeedHandler(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD')
      responseHeaders(response, NO_STORE)
      response.statusCode = 405
      response.end()
      return
    }

    const query = parseFootballMarketFeedQuery(request)
    if (!query) {
      responseHeaders(response, NO_STORE)
      response.statusCode = 400
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ error: 'invalid_query' }))
      return
    }

    try {
      const result = await loadFootballMarketFeed(query, dependencies)
      responseHeaders(response, PUBLIC_CACHE_CONTROL)
      response.statusCode = 200
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(result))
    } catch {
      responseHeaders(response, NO_STORE)
      response.statusCode = 500
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ error: 'market_feed_unavailable' }))
    }
  }
}

export default createFootballMarketFeedHandler()
