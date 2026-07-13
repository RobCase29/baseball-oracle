import { Buffer } from 'node:buffer'
import postgres from 'postgres'
import { z } from 'zod'
import { directDatabaseUrl } from '../../db/client.js'
import {
  assertMlbStatsApiMilbCurrentCardinality,
  type CurrentRefreshCardinalityGate,
} from './current-refresh-quality.js'
import { persistRawLanding } from './raw-landing.js'
import {
  abortableDelay,
  currentRefreshDatabaseOptions,
  fetchWithRetry,
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

const statsBlockSchema = z
  .object({
    type: z.object({ displayName: z.string() }).passthrough(),
    group: z.object({ displayName: z.string() }).passthrough(),
    totalSplits: z.number().int().nonnegative(),
    splits: z.array(sourceRecordSchema),
  })
  .passthrough()

export const mlbStatsApiEnvelopeSchema = z
  .object({
    copyright: z.string().optional(),
    stats: z.array(statsBlockSchema),
  })
  .passthrough()

export const MLB_STATSAPI_MILB_PARSER_VERSION = 'mlb-statsapi-milb-season-v1'
export const MLB_STATSAPI_DEFAULT_BASE = 'https://statsapi.mlb.com/api/v1/'
export const MLB_STATSAPI_MILB_LIMIT = 5_000

export const mlbStatsApiMilbRoles = ['hitter', 'pitcher'] as const
export type MlbStatsApiMilbRole = (typeof mlbStatsApiMilbRoles)[number]

export const mlbStatsApiMilbLevels = [
  { level: 'Rk', sportId: 16, levelRank: 1 },
  { level: 'A', sportId: 14, levelRank: 2 },
  { level: 'A+', sportId: 13, levelRank: 3 },
  { level: 'AA', sportId: 12, levelRank: 4 },
  { level: 'AAA', sportId: 11, levelRank: 5 },
] as const

export type MlbStatsApiMilbLevel = (typeof mlbStatsApiMilbLevels)[number]['level']

export interface MlbStatsApiMilbSlice {
  season: number
  role: MlbStatsApiMilbRole
  level: MlbStatsApiMilbLevel
  sportId: number
}

export interface MlbStatsApiMilbSemanticQuality {
  expectedRows: number
  observedRows: number
  exactMlbamRows: number
  uniqueMlbamRows: number
  matchingSeasonRows: number
  matchingSportRows: number
  validCoreRows: number
  roleCoreRule: 'hitter_workload_and_line' | 'pitcher_outs_workload_and_rates'
}

export interface ParsedMlbStatsApiMilbEnvelope {
  records: SourceRecord[]
  semanticQuality: MlbStatsApiMilbSemanticQuality
}

export interface IngestMlbStatsApiMilbResult {
  status: 'duplicate' | 'in_progress' | 'stored'
  responseHash: string
  rows: number
  slice: MlbStatsApiMilbSlice
}

export interface MlbStatsApiMilbBackfillResult {
  attempted: number
  stored: number
  duplicates: number
  inProgress: number
  rows: number
  failures: Array<{ slice: MlbStatsApiMilbSlice; message: string }>
}

interface MlbStatsApiMilbIngestOptions {
  apiBase?: string
  enforceCurrentCardinality?: boolean
  signal?: AbortSignal
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nestedRecord(record: SourceRecord, key: string): SourceRecord | null {
  const value = record[key]
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as SourceRecord
    : null
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNumber(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function roleGroup(role: MlbStatsApiMilbRole): 'hitting' | 'pitching' {
  return role === 'hitter' ? 'hitting' : 'pitching'
}

export function validateMlbStatsApiMilbSlice(
  slice: MlbStatsApiMilbSlice,
): MlbStatsApiMilbSlice {
  if (!Number.isInteger(slice.season) || slice.season < 1871 || slice.season > 2200) {
    throw new Error('MLB StatsAPI MiLB season must be a plausible integer year')
  }
  if (!mlbStatsApiMilbRoles.includes(slice.role)) {
    throw new Error(`Unsupported MLB StatsAPI MiLB role: ${slice.role}`)
  }
  const level = mlbStatsApiMilbLevels.find((candidate) => candidate.level === slice.level)
  if (!level || level.sportId !== slice.sportId) {
    throw new Error(
      `Unsupported MLB StatsAPI MiLB level/sport pair: ${slice.level}/${slice.sportId}`,
    )
  }
  return slice
}

export function buildMlbStatsApiMilbSlices(options: {
  season: number
  rookieSeason?: number
}): MlbStatsApiMilbSlice[] {
  if (!Number.isInteger(options.season)) {
    throw new Error('MLB StatsAPI MiLB season must be an integer')
  }
  const rookieSeason = options.rookieSeason ?? options.season
  return mlbStatsApiMilbLevels.flatMap((level) =>
    mlbStatsApiMilbRoles.map((role) =>
      validateMlbStatsApiMilbSlice({
        season: level.level === 'Rk' ? rookieSeason : options.season,
        role,
        level: level.level,
        sportId: level.sportId,
      }),
    ),
  )
}

export function buildMlbStatsApiMilbUrl(
  inputSlice: MlbStatsApiMilbSlice,
  apiBase = MLB_STATSAPI_DEFAULT_BASE,
): string {
  const slice = validateMlbStatsApiMilbSlice(inputSlice)
  const url = new URL('stats', apiBase.endsWith('/') ? apiBase : `${apiBase}/`)
  url.searchParams.set('stats', 'season')
  url.searchParams.set('group', roleGroup(slice.role))
  url.searchParams.set('season', String(slice.season))
  url.searchParams.set('sportIds', String(slice.sportId))
  url.searchParams.set('playerPool', 'ALL')
  url.searchParams.set('limit', String(MLB_STATSAPI_MILB_LIMIT))
  url.searchParams.set('hydrate', 'person(currentTeam),team')
  return normalizeRequestUrl(url.toString())
}

function hasRoleCore(record: SourceRecord, role: MlbStatsApiMilbRole): boolean {
  const stat = nestedRecord(record, 'stat')
  if (!stat) return false
  if (role === 'hitter') {
    return ['gamesPlayed', 'plateAppearances', 'atBats', 'hits', 'baseOnBalls', 'strikeOuts']
      .every((field) => finiteNumber(stat[field]) !== null)
  }
  return [
    'gamesPlayed',
    'outs',
    'inningsPitched',
    'battersFaced',
    'numberOfPitches',
    'hits',
    'baseOnBalls',
    'strikeOuts',
    'earnedRuns',
  ].every((field) => finiteNumber(stat[field]) !== null)
}

export function parseMlbStatsApiMilbEnvelope(
  body: string,
  inputSlice: MlbStatsApiMilbSlice,
): ParsedMlbStatsApiMilbEnvelope {
  const slice = validateMlbStatsApiMilbSlice(inputSlice)
  const envelope = mlbStatsApiEnvelopeSchema.parse(JSON.parse(body))
  const group = roleGroup(slice.role)
  const block = envelope.stats.find(
    (candidate) => candidate.type.displayName === 'season' && candidate.group.displayName === group,
  )
  if (!block) {
    throw new Error(`MLB StatsAPI response omitted the season ${group} stats block`)
  }
  if (block.totalSplits !== block.splits.length) {
    throw new Error(
      `MLB StatsAPI ${slice.season} ${slice.level} ${slice.role} returned ` +
        `${block.splits.length} of ${block.totalSplits} rows; increase the request limit`,
    )
  }

  const playerIds = block.splits.map((record) =>
    positiveInteger(nestedRecord(record, 'player')?.id),
  )
  const exactMlbamRows = playerIds.filter((id) => id !== null).length
  const uniqueMlbamRows = new Set(playerIds.filter((id): id is number => id !== null)).size
  const matchingSeasonRows = block.splits.filter(
    (record) => finiteNumber(record.season) === slice.season,
  ).length
  const matchingSportRows = block.splits.filter(
    (record) => positiveInteger(nestedRecord(record, 'sport')?.id) === slice.sportId,
  ).length
  const validCoreRows = block.splits.filter((record) => hasRoleCore(record, slice.role)).length
  const semanticQuality: MlbStatsApiMilbSemanticQuality = {
    expectedRows: block.totalSplits,
    observedRows: block.splits.length,
    exactMlbamRows,
    uniqueMlbamRows,
    matchingSeasonRows,
    matchingSportRows,
    validCoreRows,
    roleCoreRule:
      slice.role === 'hitter'
        ? 'hitter_workload_and_line'
        : 'pitcher_outs_workload_and_rates',
  }

  const expected = block.splits.length
  if (
    exactMlbamRows !== expected ||
    uniqueMlbamRows !== expected ||
    matchingSeasonRows !== expected ||
    matchingSportRows !== expected ||
    validCoreRows !== expected
  ) {
    throw new Error(
      `MLB StatsAPI ${slice.season} ${slice.level} ${slice.role} failed the exact-ID/schema gate: ` +
        `${exactMlbamRows} MLBAM IDs (${uniqueMlbamRows} unique), ` +
        `${matchingSeasonRows} matching seasons, ${matchingSportRows} matching sports, ` +
        `${validCoreRows} valid role rows of ${expected}`,
    )
  }

  return { records: block.splits, semanticQuality }
}

export function mlbStatsApiMilbSourceRecordKey(
  record: SourceRecord,
  inputSlice: MlbStatsApiMilbSlice,
): string {
  const slice = validateMlbStatsApiMilbSlice(inputSlice)
  const mlbamId = positiveInteger(nestedRecord(record, 'player')?.id)
  if (mlbamId === null) throw new Error('MLB StatsAPI MiLB record has no exact MLBAM ID')
  return [
    `mlbam:${mlbamId}`,
    `role:${slice.role}`,
    `season:${slice.season}`,
    `level:${slice.level}`,
    `sport:${slice.sportId}`,
  ].join('|')
}

export async function fetchMlbStatsApiMilb(
  url: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetchWithRetry(url, {
    sourceName: 'MLB StatsAPI',
    signal,
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'BaseballOracleResearch/0.1 (+https://github.com/RobCase29/baseball-oracle)',
    },
    timeoutMs: 60_000,
  })
}

async function previousMlbStatsApiMilbSliceRows(
  sql: ReturnType<typeof postgres>,
  slice: MlbStatsApiMilbSlice,
): Promise<number | null> {
  const [previous] = await sql<{ rows: number }[]>`
    SELECT (run.counts->>'rows')::integer AS rows
    FROM raw.ingestion_run AS run
    JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
    JOIN catalog.source AS source ON source.id = dataset.source_id
    WHERE source.slug = 'mlb-statsapi'
      AND dataset.dataset_key = 'current-milb-season-stats'
      AND run.status = 'succeeded'
      AND run.parser_version = ${MLB_STATSAPI_MILB_PARSER_VERSION}
      AND run.parameters->'slice' = ${sql.json(slice as unknown as postgres.JSONValue)}
      AND run.counts->>'rows' ~ '^\\d+$'
    ORDER BY run.finished_at DESC NULLS LAST, run.started_at DESC
    LIMIT 1
  `
  return previous?.rows ?? null
}

export async function ingestMlbStatsApiMilbSlice(
  inputSlice: MlbStatsApiMilbSlice,
  options: MlbStatsApiMilbIngestOptions = {},
): Promise<IngestMlbStatsApiMilbResult> {
  options.signal?.throwIfAborted()
  const slice = validateMlbStatsApiMilbSlice(inputSlice)
  const url = buildMlbStatsApiMilbUrl(
    slice,
    options.apiBase ?? process.env.MLB_STATSAPI_BASE ?? MLB_STATSAPI_DEFAULT_BASE,
  )
  const response = await fetchMlbStatsApiMilb(url, options.signal)
  const body = await response.text()
  options.signal?.throwIfAborted()
  const fetchedAt = new Date()
  const { records: sourceRecords, semanticQuality } = parseMlbStatsApiMilbEnvelope(
    body,
    slice,
  )
  const responseHash = sha256(body)
  const records = sourceRecords.map((record) => ({
    record,
    recordType: `milb_season_${slice.role}`,
    sourceRecordKey: mlbStatsApiMilbSourceRecordKey(record, slice),
    recordSha256: sha256(stableStringify(record)),
  }))
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions())

  try {
    let cardinalityGate: CurrentRefreshCardinalityGate | null = null
    if (options.enforceCurrentCardinality) {
      const previousRows = await previousMlbStatsApiMilbSliceRows(sql, slice)
      cardinalityGate = assertMlbStatsApiMilbCurrentCardinality(
        sourceRecords.length,
        slice,
        previousRows,
      )
    }
    options.signal?.throwIfAborted()

    const landing = await persistRawLanding(sql, {
      signal: options.signal,
      sourceSlug: 'mlb-statsapi',
      datasetKey: 'current-milb-season-stats',
      idempotencyKey: idempotencyKey(url, responseHash),
      mode: 'incremental',
      requestedAsOf: fetchedAt,
      parserVersion: MLB_STATSAPI_MILB_PARSER_VERSION,
      parameters: {
        request: sanitizedRequest(url),
        slice,
        playerPool: 'ALL',
        hydration: 'person(currentTeam),team',
        identityPolicy: 'exact_mlbam_only',
        ...(cardinalityGate ? { currentRefreshCardinality: cardinalityGate } : {}),
        semanticQuality,
      },
      counts: {
        rows: sourceRecords.length,
        schema: schemaFingerprint(sourceRecords),
        ...(cardinalityGate ? { currentRefreshCardinality: cardinalityGate } : {}),
        semanticQuality,
      },
      fetchedAt,
      request: {
        sanitized: sanitizedRequest(url),
        fingerprint: requestFingerprint(url),
      },
      response: {
        sha256: responseHash,
        byteLength: Buffer.byteLength(body, 'utf8'),
        mediaType: response.headers.get('content-type') ?? 'application/json',
        contentEncoding: response.headers.get('content-encoding'),
        statusCode: response.status,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        headers: safeResponseHeaders(response),
        bodyText: body,
      },
      records,
    })
    options.signal?.throwIfAborted()
    return {
      status: landing.status,
      responseHash,
      rows: sourceRecords.length,
      slice,
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export async function backfillMlbStatsApiMilb(options: {
  slices: readonly MlbStatsApiMilbSlice[]
  delayMs?: number
  apiBase?: string
  enforceCurrentCardinality?: boolean
  signal?: AbortSignal
  onProgress?: (result: IngestMlbStatsApiMilbResult) => void
}): Promise<MlbStatsApiMilbBackfillResult> {
  const delayMs = options.delayMs ?? 100
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error('MLB StatsAPI MiLB delay must be a non-negative integer')
  }
  const summary: MlbStatsApiMilbBackfillResult = {
    attempted: 0,
    stored: 0,
    duplicates: 0,
    inProgress: 0,
    rows: 0,
    failures: [],
  }

  for (const [index, slice] of options.slices.entries()) {
    options.signal?.throwIfAborted()
    summary.attempted += 1
    try {
      const result = await ingestMlbStatsApiMilbSlice(slice, {
        apiBase: options.apiBase,
        enforceCurrentCardinality: options.enforceCurrentCardinality,
        signal: options.signal,
      })
      if (result.status === 'stored') summary.stored += 1
      else if (result.status === 'duplicate') summary.duplicates += 1
      else summary.inProgress += 1
      summary.rows += result.rows
      options.onProgress?.(result)
    } catch (error) {
      options.signal?.throwIfAborted()
      summary.failures.push({
        slice,
        message: error instanceof Error ? error.message : 'Unknown ingestion error',
      })
    }
    if (index < options.slices.length - 1 && delayMs > 0) {
      await abortableDelay(delayMs, options.signal)
    }
  }

  return summary
}
