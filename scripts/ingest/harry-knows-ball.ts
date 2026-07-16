import { Buffer } from 'node:buffer'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { z } from 'zod'
import { directDatabaseUrl } from '../../db/client.js'
import { persistRawLanding, type RawLandingResult } from './raw-landing.js'
import {
  abortableDelay,
  currentRefreshDatabaseOptions,
  fetchWithRetry,
  normalizeRequestUrl,
  requestFingerprint,
  safeResponseHeaders,
  sanitizedRequest,
  schemaFingerprint,
  sha256,
  stableStringify,
} from './shared.js'

export const HKB_PARSER_VERSION = 'harry-knows-ball-dynasty-v1'
export const HKB_IDENTITY_PARSER_VERSION = 'harry-knows-ball-identity-v1'
export const HKB_DEFAULT_BASE_URL = 'https://harryknowsball.com/'
export const HKB_MINIMUM_PLAYER_ROWS = 1_500
export const HKB_MINIMUM_PROSPECT_ROWS = 500
export const HKB_MINIMUM_TOP_VIEWED_ROWS = 5
export const HKB_MAXIMUM_TOP_VIEWED_ROWS = 50
export const HKB_IDENTITY_DEFAULT_LIMIT = 10
export const HKB_IDENTITY_MAXIMUM_LIMIT = 100
export const HKB_IDENTITY_DEFAULT_DELAY_MS = 1_250

const hkbIdSchema = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/u)
const nullableTextSchema = z.string().nullable()
const positionRanksSchema = z.record(z.string(), z.number().int().positive())
const dynastyValueSchema = z.number().int().min(10).max(10_000)

const hkbRankingAssetSchema = z
  .object({
    id: hkbIdSchema,
    originalIndex: z.number().int().nonnegative(),
    rank: z.number().int().positive(),
    name: z.string().trim().min(1),
    age: z.number().nonnegative().nullable(),
    positions: z.array(z.string()),
    positionRanks: positionRanksSchema,
    team: nullableTextSchema,
    level: nullableTextSchema,
    hitterStats: z.unknown().nullable(),
    pitcherStats: z.unknown().nullable(),
    statsYear: z.number().int().nonnegative(),
    activeLevels: nullableTextSchema,
    value: dynastyValueSchema,
    valueChange30Days: z.number().int(),
    rankChange30Days: z.number().int(),
    valueChange7Days: z.number().int(),
    rankChange7Days: z.number().int(),
    assetType: z.enum(['PLAYER', 'PICK']),
    valueHistory30Days: z
      .array(dynastyValueSchema.nullable())
      .length(30)
      .refine((history) => typeof history.at(-1) === 'number'),
    rankHistory30Days: z
      .array(z.number().int().positive().nullable())
      .length(30)
      .refine((history) => typeof history.at(-1) === 'number'),
    active: z.boolean(),
    prospect: z.boolean(),
    fypd: z.boolean(),
    prospectRank: z.number().int().positive().nullable().optional(),
    prospectPositionRanks: positionRanksSchema.nullable().optional(),
    prospectRankChange30Days: z.number().int().nullable().optional(),
  })
  .passthrough()
  .superRefine((asset, context) => {
    if (asset.valueHistory30Days.at(-1) !== asset.value) {
      context.addIssue({
        code: 'custom',
        message: 'Current Dynasty Score does not match its history endpoint',
        path: ['valueHistory30Days', 29],
      })
    }
    if (asset.rankHistory30Days.at(-1) !== asset.rank) {
      context.addIssue({
        code: 'custom',
        message: 'Current overall rank does not match its history endpoint',
        path: ['rankHistory30Days', 29],
      })
    }
  })

const hkbNextDataSchema = z
  .object({
    props: z
      .object({
        pageProps: z
          .object({
            players: z.array(hkbRankingAssetSchema),
            lastUpdated: z.string().min(1),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough()

const hkbTopViewedSchema = z.array(
  z
    .object({
      player: hkbRankingAssetSchema,
      viewCount: z.number().int().positive(),
    })
    .passthrough(),
)

const hkbPlayerPageSchema = z
  .object({
    props: z
      .object({
        pageProps: z
          .object({
            player: z
              .object({
                id: hkbIdSchema,
                mlbId: z.number().int().positive(),
                name: z.string().trim().min(1),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough()

const hkbIdentityEvidenceSchema = z.object({
  hkbPlayerId: hkbIdSchema,
  mlbamId: z.number().int().positive(),
  playerName: z.string().trim().min(1),
  sourceUrl: z.string().url(),
  requestedUrl: z.string().url(),
  observedAt: z.string().min(1),
  responseSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  evidenceMethod: z.literal('hkb_player_page_published_mlbam'),
  identityPolicy: z.literal(
    'exact_hkb_player_page_published_mlbam_no_name_matching',
  ),
})

export type HarryKnowsBallRankingAsset = z.infer<typeof hkbRankingAssetSchema>
export type HarryKnowsBallTopViewedRow = z.infer<typeof hkbTopViewedSchema>[number]

export interface ParsedHarryKnowsBallRankings {
  players: HarryKnowsBallRankingAsset[]
  sourceAssets: number
  sourceUpdatedAt: string
}

export interface ParsedHarryKnowsBallPlayerPage {
  hkbPlayerId: string
  mlbamId: number
  playerName: string
}

export interface HarryKnowsBallSnapshotQuality {
  activePlayers: number
  nonFloorPlayers: number
  players: number
  prospects: number
  sourceAssets: number
  topViewedPlayers: number
  topViewedProspects: number
  sourceUpdatedAt: string
}

export interface HarryKnowsBallPreviousSnapshot {
  activePlayers: number | null
  nonFloorPlayers: number | null
  players: number | null
  prospects: number | null
  sourceUpdatedAt: string | null
}

export interface HarryKnowsBallSnapshotRetention {
  previous: HarryKnowsBallPreviousSnapshot | null
  required: {
    activePlayers: number
    nonFloorPlayers: number
    players: number
    prospects: number
  }
}

export type HarryKnowsBallIdentityFailureKind =
  | 'transient'
  | 'mlbam_collision'
  | 'identity_changed'
  | 'provider_id_mismatch'
  | 'provider_evidence_mismatch'

export interface HarryKnowsBallIdentityFailureDisposition {
  failureKind: HarryKnowsBallIdentityFailureKind
  quarantined: boolean
}

export interface IngestHarryKnowsBallSnapshotOptions {
  baseUrl?: string
  identityBackfillLimit?: number
  identityDelayMs?: number
  signal?: AbortSignal
}

export interface IngestHarryKnowsBallSnapshotResult {
  status: 'duplicate' | 'in_progress' | 'stored'
  captureId: string
  capturedAt: string
  rankingRows: number
  topViewedPlayerRows: number
  topViewedProspectRows: number
  identitiesBackfilled: number
}

export interface BackfillHarryKnowsBallIdentitiesOptions {
  baseUrl?: string
  delayMs?: number
  hkbPlayerIds?: readonly string[]
  limit?: number
  signal?: AbortSignal
}

export interface BackfillHarryKnowsBallIdentitiesResult {
  attempted: number
  stored: number
  duplicates: number
  failures: Array<{ hkbPlayerId: string; message: string }>
}

export interface RefreshHarryKnowsBallViewsResult {
  rows: number
  mappedRows: number
}

export interface HarryKnowsBallIdentityObservation {
  hkbPlayerId: string
  mlbamId: number
  observedAt: Date
  playerName: string
  rawRecordId: string
  responseSha256: string
  sourceUrl: string
}

interface CapturedResponse {
  bodyText: string
  byteLength: number
  contentEncoding: string | null
  etag: string | null
  fetchedAt: Date
  headers: Record<string, string>
  lastModified: string | null
  mediaType: string
  responseHash: string
  statusCode: number
  url: string
}

type HkbEndpoint =
  | 'rankings'
  | 'top_viewed_players'
  | 'top_viewed_prospects'

function baseUrl(value: string | undefined): URL {
  const parsed = new URL(value ?? HKB_DEFAULT_BASE_URL)
  parsed.hash = ''
  parsed.search = ''
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('HarryKnowsBall base URL must use HTTP or HTTPS')
  }
  return parsed
}

export function buildHarryKnowsBallUrl(
  endpoint: HkbEndpoint | 'player',
  options: { baseUrl?: string; hkbPlayerId?: string } = {},
): string {
  const root = baseUrl(options.baseUrl)
  const path = endpoint === 'rankings'
    ? '/rankings'
    : endpoint === 'top_viewed_players'
      ? '/hkb/topViewedPlayers'
      : endpoint === 'top_viewed_prospects'
        ? '/hkb/topViewedProspects'
        : `/player/${encodeURIComponent(hkbIdSchema.parse(options.hkbPlayerId))}`
  return normalizeRequestUrl(new URL(path, root).toString())
}

function nextDataJson(html: string): unknown {
  const match = html.match(
    /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/iu,
  )
  if (!match) throw new Error('HarryKnowsBall page is missing __NEXT_DATA__')

  try {
    return JSON.parse(match[1])
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON error'
    throw new Error(`HarryKnowsBall __NEXT_DATA__ is invalid JSON: ${message}`)
  }
}

function isoTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a valid timestamp`)
  return new Date(parsed).toISOString()
}

export function parseHarryKnowsBallRankingsHtml(
  html: string,
): ParsedHarryKnowsBallRankings {
  const parsed = hkbNextDataSchema.parse(nextDataJson(html)).props.pageProps
  return {
    players: parsed.players.filter((asset) => asset.assetType === 'PLAYER'),
    sourceAssets: parsed.players.length,
    sourceUpdatedAt: isoTimestamp(
      parsed.lastUpdated,
      'HarryKnowsBall rankings lastUpdated',
    ),
  }
}

export function parseHarryKnowsBallTopViewed(
  body: string,
): HarryKnowsBallTopViewedRow[] {
  let decoded: unknown
  try {
    decoded = JSON.parse(body)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON error'
    throw new Error(`HarryKnowsBall top-viewed response is invalid JSON: ${message}`)
  }
  return hkbTopViewedSchema.parse(decoded)
}

export function parseHarryKnowsBallPlayerPage(
  html: string,
  expectedHkbPlayerId?: string,
): ParsedHarryKnowsBallPlayerPage {
  const player = hkbPlayerPageSchema.parse(nextDataJson(html)).props.pageProps.player
  if (expectedHkbPlayerId !== undefined && player.id !== expectedHkbPlayerId) {
    throw new Error(
      `HarryKnowsBall player page returned ${player.id} for requested ${expectedHkbPlayerId}`,
    )
  }
  return {
    hkbPlayerId: player.id,
    mlbamId: player.mlbId,
    playerName: player.name,
  }
}

function assertUniqueIds(
  rows: readonly { id: string }[],
  label: string,
): void {
  const unique = new Set(rows.map((row) => row.id))
  if (unique.size !== rows.length) {
    throw new Error(
      `${label} contains ${rows.length - unique.size} duplicate HKB player ID row(s)`,
    )
  }
}

function assertTopViewed(
  rows: readonly HarryKnowsBallTopViewedRow[],
  rankingsById: ReadonlyMap<string, HarryKnowsBallRankingAsset>,
  label: string,
): void {
  if (
    rows.length < HKB_MINIMUM_TOP_VIEWED_ROWS ||
    rows.length > HKB_MAXIMUM_TOP_VIEWED_ROWS
  ) {
    throw new Error(
      `${label} has ${rows.length} rows; expected ${HKB_MINIMUM_TOP_VIEWED_ROWS}-${HKB_MAXIMUM_TOP_VIEWED_ROWS}`,
    )
  }
  assertUniqueIds(rows.map((row) => row.player), label)

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!rankingsById.has(row.player.id)) {
      throw new Error(`${label} contains unknown HKB player ${row.player.id}`)
    }
    if (index > 0 && row.viewCount > rows[index - 1].viewCount) {
      throw new Error(`${label} is not ordered by descending view count`)
    }
  }
}

export function assertHarryKnowsBallSnapshot(
  rankings: ParsedHarryKnowsBallRankings,
  topViewedPlayers: readonly HarryKnowsBallTopViewedRow[],
  topViewedProspects: readonly HarryKnowsBallTopViewedRow[],
  capturedAt = new Date(),
): HarryKnowsBallSnapshotQuality {
  if (rankings.players.length < HKB_MINIMUM_PLAYER_ROWS) {
    throw new Error(
      `HarryKnowsBall rankings has ${rankings.players.length} player rows; expected at least ${HKB_MINIMUM_PLAYER_ROWS}`,
    )
  }
  assertUniqueIds(rankings.players, 'HarryKnowsBall rankings')

  const prospects = rankings.players.filter(
    (player) => typeof player.prospectRank === 'number',
  )
  if (prospects.length < HKB_MINIMUM_PROSPECT_ROWS) {
    throw new Error(
      `HarryKnowsBall rankings has ${prospects.length} prospect-ranked players; expected at least ${HKB_MINIMUM_PROSPECT_ROWS}`,
    )
  }
  if (prospects.some((player) => !player.prospect)) {
    throw new Error('HarryKnowsBall assigned a prospect rank to a non-prospect player')
  }
  const prospectRanks = prospects.map((player) => player.prospectRank as number)
  if (
    new Set(prospectRanks).size !== prospects.length ||
    Math.min(...prospectRanks) !== 1 ||
    Math.max(...prospectRanks) !== prospects.length
  ) {
    throw new Error('HarryKnowsBall prospect ranks are not a complete 1-based sequence')
  }

  const sourceUpdatedAt = new Date(rankings.sourceUpdatedAt)
  if (sourceUpdatedAt.getTime() > capturedAt.getTime() + 24 * 60 * 60 * 1_000) {
    throw new Error('HarryKnowsBall rankings source timestamp is implausibly in the future')
  }
  if (sourceUpdatedAt.getTime() < capturedAt.getTime() - 14 * 24 * 60 * 60 * 1_000) {
    throw new Error('HarryKnowsBall rankings source timestamp is more than 14 days stale')
  }

  const rankingsById = new Map(rankings.players.map((player) => [player.id, player]))
  assertTopViewed(topViewedPlayers, rankingsById, 'HarryKnowsBall most-viewed players')
  assertTopViewed(topViewedProspects, rankingsById, 'HarryKnowsBall most-viewed prospects')

  const currentProspectRows = topViewedProspects.filter(
    (row) => rankingsById.get(row.player.id)?.prospect,
  ).length
  const requiredProspectRows = Math.ceil(topViewedProspects.length * 0.8)
  if (currentProspectRows < requiredProspectRows) {
    throw new Error(
      `HarryKnowsBall most-viewed prospects has only ${currentProspectRows} current prospects; expected at least ${requiredProspectRows}`,
    )
  }

  return {
    activePlayers: rankings.players.filter((player) => player.active).length,
    nonFloorPlayers: rankings.players.filter((player) => player.value > 10).length,
    players: rankings.players.length,
    prospects: prospects.length,
    sourceAssets: rankings.sourceAssets,
    topViewedPlayers: topViewedPlayers.length,
    topViewedProspects: topViewedProspects.length,
    sourceUpdatedAt: rankings.sourceUpdatedAt,
  }
}

export function assertHarryKnowsBallPreviousRetention(
  current: HarryKnowsBallSnapshotQuality,
  previous: HarryKnowsBallPreviousSnapshot | null,
): HarryKnowsBallSnapshotRetention {
  const required = {
    activePlayers: 0,
    nonFloorPlayers: 0,
    players: 0,
    prospects: 0,
  }
  if (previous === null) return { previous, required }

  if (previous.sourceUpdatedAt !== null) {
    const previousUpdatedAt = Date.parse(previous.sourceUpdatedAt)
    const currentUpdatedAt = Date.parse(current.sourceUpdatedAt)
    if (!Number.isFinite(previousUpdatedAt)) {
      throw new Error('Previous HarryKnowsBall source timestamp is invalid')
    }
    if (currentUpdatedAt < previousUpdatedAt) {
      throw new Error(
        `HarryKnowsBall source timestamp regressed from ${new Date(previousUpdatedAt).toISOString()} to ${current.sourceUpdatedAt}`,
      )
    }
  }

  const metrics = [
    ['players', 'players'],
    ['activePlayers', 'active players'],
    ['prospects', 'prospect-ranked players'],
    ['nonFloorPlayers', 'non-floor Dynasty Scores'],
  ] as const
  for (const [key, label] of metrics) {
    const previousValue = previous[key]
    if (previousValue === null) continue
    const requiredValue = Math.ceil(previousValue * 0.8)
    required[key] = requiredValue
    if (current[key] < requiredValue) {
      throw new Error(
        `HarryKnowsBall rankings retained ${current[key]} ${label} after ${previousValue} previously; expected at least ${requiredValue}`,
      )
    }
  }
  return { previous, required }
}

export function buildHarryKnowsBallCaptureId(hashes: {
  rankings: string
  topViewedPlayers: string
  topViewedProspects: string
}): string {
  return sha256(
    [
      HKB_PARSER_VERSION,
      hashes.rankings,
      hashes.topViewedPlayers,
      hashes.topViewedProspects,
    ].join(':'),
  )
}

async function captureResponse(url: string, signal?: AbortSignal): Promise<CapturedResponse> {
  const response = await fetchWithRetry(url, {
    attempts: 3,
    headers: {
      accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      'user-agent': 'Baseball-Oracle-Research/1.0 (+https://baseball-oracle.vercel.app)',
    },
    signal,
    sourceName: 'HarryKnowsBall',
    timeoutMs: 45_000,
  })
  const bodyText = await response.text()
  signal?.throwIfAborted()
  return {
    bodyText,
    byteLength: Buffer.byteLength(bodyText, 'utf8'),
    contentEncoding: response.headers.get('content-encoding'),
    etag: response.headers.get('etag'),
    fetchedAt: new Date(),
    headers: safeResponseHeaders(response),
    lastModified: response.headers.get('last-modified'),
    mediaType: response.headers.get('content-type') ?? 'application/octet-stream',
    responseHash: sha256(bodyText),
    statusCode: response.status,
    url: normalizeRequestUrl(response.url || url),
  }
}

function captureIdempotencyKey(captureId: string, endpoint: HkbEndpoint): string {
  return sha256(`${HKB_PARSER_VERSION}:${captureId}:${endpoint}`)
}

function landingStatus(results: readonly RawLandingResult[]): IngestHarryKnowsBallSnapshotResult['status'] {
  if (results.some((result) => result.status === 'in_progress')) return 'in_progress'
  if (results.every((result) => result.status === 'duplicate')) return 'duplicate'
  return 'stored'
}

export async function refreshHarryKnowsBallViews(): Promise<RefreshHarryKnowsBallViewsResult> {
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions(60_000))
  try {
    return await sql.begin(async (transaction) => {
      await transaction`REFRESH MATERIALIZED VIEW app.hkb_current_comparison_signal`
      const [audit] = await transaction<{ rows: number; mapped_rows: number }[]>`
        SELECT
          count(*)::integer AS rows,
          count(*) FILTER (WHERE mlbam_id IS NOT NULL)::integer AS mapped_rows
        FROM app.hkb_current_comparison_signal
      `
      return {
        rows: audit?.rows ?? 0,
        mappedRows: audit?.mapped_rows ?? 0,
      }
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export async function ingestHarryKnowsBallSnapshot(
  options: IngestHarryKnowsBallSnapshotOptions = {},
): Promise<IngestHarryKnowsBallSnapshotResult> {
  options.signal?.throwIfAborted()
  const rankingsUrl = buildHarryKnowsBallUrl('rankings', options)
  const topViewedPlayersUrl = buildHarryKnowsBallUrl('top_viewed_players', options)
  const topViewedProspectsUrl = buildHarryKnowsBallUrl('top_viewed_prospects', options)

  const [rankingResponse, topPlayersResponse, topProspectsResponse] = await Promise.all([
    captureResponse(rankingsUrl, options.signal),
    captureResponse(topViewedPlayersUrl, options.signal),
    captureResponse(topViewedProspectsUrl, options.signal),
  ])
  options.signal?.throwIfAborted()

  const capturedAt = new Date()
  const rankings = parseHarryKnowsBallRankingsHtml(rankingResponse.bodyText)
  const topViewedPlayers = parseHarryKnowsBallTopViewed(topPlayersResponse.bodyText)
  const topViewedProspects = parseHarryKnowsBallTopViewed(topProspectsResponse.bodyText)
  const quality = assertHarryKnowsBallSnapshot(
    rankings,
    topViewedPlayers,
    topViewedProspects,
    capturedAt,
  )
  const captureId = buildHarryKnowsBallCaptureId({
    rankings: rankingResponse.responseHash,
    topViewedPlayers: topPlayersResponse.responseHash,
    topViewedProspects: topProspectsResponse.responseHash,
  })

  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions(60_000))
  let results: RawLandingResult[]
  try {
    const [previous] = await sql<{
      active_players: number | null
      non_floor_players: number | null
      players: number | null
      prospects: number | null
      source_updated_at: string | null
    }[]>`
      SELECT
        (ingestion.counts ->> 'activePlayers')::integer AS active_players,
        (ingestion.counts ->> 'nonFloorPlayers')::integer AS non_floor_players,
        (ingestion.counts ->> 'players')::integer AS players,
        (ingestion.counts ->> 'prospects')::integer AS prospects,
        complete.source_updated_at::text AS source_updated_at
      FROM app.hkb_complete_capture AS complete
      JOIN raw.ingestion_run AS ingestion
        ON ingestion.parameters ->> 'captureId' = complete.capture_id
        AND ingestion.parameters ->> 'endpoint' = 'rankings'
        AND ingestion.status = 'succeeded'
      ORDER BY
        complete.source_updated_at DESC NULLS LAST,
        complete.captured_at DESC,
        complete.capture_id DESC
      LIMIT 1
    `
    const retention = assertHarryKnowsBallPreviousRetention(
      quality,
      previous
        ? {
            activePlayers: previous.active_players,
            nonFloorPlayers: previous.non_floor_players,
            players: previous.players,
            prospects: previous.prospects,
            sourceUpdatedAt: previous.source_updated_at,
          }
        : null,
    )
    const commonParameters = {
      captureId,
      capturePolicy: 'publish_only_when_rankings_and_both_attention_feeds_succeed',
      externalSignalPolicy: 'comparison_only_excluded_from_oracle_model',
      identityPolicy: 'exact_hkb_player_page_published_mlbam_no_name_matching',
      sourceUpdatedAt: rankings.sourceUpdatedAt,
      previousSnapshotRetention: retention,
    }
    const rankingRecords = rankings.players.map((player) => ({
      record: player as Record<string, unknown>,
      recordType: 'hkb_dynasty_player',
      sourceRecordKey: `hkb:${player.id}`,
      recordSha256: sha256(stableStringify(player)),
    }))
    const topPlayerRecords = topViewedPlayers.map((row) => ({
      record: row as unknown as Record<string, unknown>,
      recordType: 'hkb_top_viewed_player',
      sourceRecordKey: `hkb:${row.player.id}`,
      recordSha256: sha256(stableStringify(row)),
    }))
    const topProspectRecords = topViewedProspects.map((row) => ({
      record: row as unknown as Record<string, unknown>,
      recordType: 'hkb_top_viewed_prospect',
      sourceRecordKey: `hkb:${row.player.id}`,
      recordSha256: sha256(stableStringify(row)),
    }))

    const land = (
      endpoint: HkbEndpoint,
      url: string,
      response: CapturedResponse,
      records: typeof rankingRecords,
    ) => persistRawLanding(sql, {
      sourceSlug: 'harry-knows-ball',
      datasetKey: 'dynasty-rankings',
      idempotencyKey: captureIdempotencyKey(captureId, endpoint),
      mode: 'incremental_snapshot',
      parserVersion: HKB_PARSER_VERSION,
      parameters: {
        ...commonParameters,
        endpoint,
        request: sanitizedRequest(url),
      },
      counts: {
        ...quality,
        endpointRows: records.length,
        previousSnapshotRetention: retention,
        schema: schemaFingerprint(records.map((record) => record.record)),
      },
      fetchedAt: response.fetchedAt,
      request: {
        sanitized: sanitizedRequest(url),
        fingerprint: requestFingerprint(url),
      },
      response: {
        sha256: response.responseHash,
        byteLength: response.byteLength,
        mediaType: response.mediaType,
        contentEncoding: response.contentEncoding,
        statusCode: response.statusCode,
        etag: response.etag,
        lastModified: response.lastModified,
        headers: response.headers,
        bodyText: response.bodyText,
      },
      records,
    })

    results = []
    results.push(await land(
      'rankings',
      rankingsUrl,
      rankingResponse,
      rankingRecords,
    ))
    results.push(await land(
      'top_viewed_players',
      topViewedPlayersUrl,
      topPlayersResponse,
      topPlayerRecords,
    ))
    results.push(await land(
      'top_viewed_prospects',
      topViewedProspectsUrl,
      topProspectsResponse,
      topProspectRecords,
    ))
  } finally {
    await sql.end({ timeout: 5 })
  }

  const status = landingStatus(results)
  let identitiesBackfilled = 0
  if (status !== 'in_progress') {
    await refreshHarryKnowsBallViews()
    const identityLimit = options.identityBackfillLimit ?? 0
    if (identityLimit > 0) {
      const identity = await backfillHarryKnowsBallIdentities({
        baseUrl: options.baseUrl,
        delayMs: options.identityDelayMs,
        limit: identityLimit,
        signal: options.signal,
      })
      identitiesBackfilled = identity.attempted - identity.failures.length
    }
  }

  return {
    status,
    captureId,
    capturedAt: capturedAt.toISOString(),
    rankingRows: rankings.players.length,
    topViewedPlayerRows: topViewedPlayers.length,
    topViewedProspectRows: topViewedProspects.length,
    identitiesBackfilled,
  }
}

function assertIdentityLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > HKB_IDENTITY_MAXIMUM_LIMIT) {
    throw new Error(
      `HarryKnowsBall identity limit must be an integer from 1-${HKB_IDENTITY_MAXIMUM_LIMIT}`,
    )
  }
  return value
}

function errorField(error: unknown, field: string): string | null {
  if (!error || typeof error !== 'object') return null
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}

function identityFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown identity error'
  return message.trim() || 'Unknown identity error'
}

export function classifyHarryKnowsBallIdentityFailure(
  error: unknown,
): HarryKnowsBallIdentityFailureDisposition {
  const code = errorField(error, 'code')
  const constraint = errorField(error, 'constraint_name') ?? errorField(error, 'constraint')
  const message = identityFailureMessage(error)
  if (
    code === 'P2001' ||
    (code === '23505' && constraint === 'hkb_exact_identity_mlbam_id_key') ||
    message.startsWith('MLBAM identity ')
  ) {
    return { failureKind: 'mlbam_collision', quarantined: true }
  }
  if (code === 'P2002' || /^HarryKnowsBall player .+ changed MLBAM identity/u.test(message)) {
    return { failureKind: 'identity_changed', quarantined: true }
  }
  if (message.startsWith('HarryKnowsBall player page returned ')) {
    return { failureKind: 'provider_id_mismatch', quarantined: true }
  }
  if (
    code === 'P2003' ||
    constraint?.startsWith('hkb_exact_identity_') === true ||
    message.startsWith('HarryKnowsBall exact identity evidence does not match')
  ) {
    return { failureKind: 'provider_evidence_mismatch', quarantined: true }
  }
  return { failureKind: 'transient', quarantined: false }
}

async function recordIdentityBackfillFailure(
  sql: ReturnType<typeof postgres>,
  hkbPlayerId: string,
  error: unknown,
): Promise<void> {
  const disposition = classifyHarryKnowsBallIdentityFailure(error)
  const message = identityFailureMessage(error)
  const status = disposition.quarantined ? 'quarantined' : 'retryable'
  await sql`
    INSERT INTO core.hkb_identity_backfill_attempt AS target (
      hkb_player_id,
      attempt_count,
      status,
      failure_kind,
      last_error,
      last_attempted_at,
      next_attempt_at
    ) VALUES (
      ${hkbPlayerId},
      1,
      ${status},
      ${disposition.failureKind},
      ${message},
      now(),
      CASE
        WHEN ${disposition.quarantined} THEN NULL
        ELSE now() + interval '15 minutes'
      END
    )
    ON CONFLICT (hkb_player_id) DO UPDATE SET
      attempt_count = target.attempt_count + 1,
      status = CASE
        WHEN target.status = 'quarantined' OR EXCLUDED.status = 'quarantined'
          THEN 'quarantined'
        ELSE 'retryable'
      END,
      failure_kind = CASE
        WHEN target.status = 'quarantined' THEN target.failure_kind
        ELSE EXCLUDED.failure_kind
      END,
      last_error = CASE
        WHEN target.status = 'quarantined' THEN target.last_error
        ELSE EXCLUDED.last_error
      END,
      last_attempted_at = now(),
      next_attempt_at = CASE
        WHEN target.status = 'quarantined' OR EXCLUDED.status = 'quarantined'
          THEN NULL
        ELSE now() + least(
          interval '24 hours',
          interval '15 minutes' * power(
            2::double precision,
            least(target.attempt_count, 7)::double precision
          )
        )
      END,
      updated_at = now()
  `
}

async function candidateIdentityIds(
  sql: ReturnType<typeof postgres>,
  options: BackfillHarryKnowsBallIdentitiesOptions,
): Promise<string[]> {
  const limit = assertIdentityLimit(options.limit ?? HKB_IDENTITY_DEFAULT_LIMIT)
  if (options.hkbPlayerIds) {
    return [...new Set(options.hkbPlayerIds.map((id) => hkbIdSchema.parse(id)))].slice(
      0,
      limit,
    )
  }

  const rows = await sql<{ hkb_player_id: string }[]>`
    SELECT hkb_player_id
    FROM app.hkb_identity_backfill_queue
    ORDER BY
      identity_last_attempted_at ASC NULLS FIRST,
      active DESC NULLS LAST,
      prospect_rank ASC NULLS LAST,
      overall_rank ASC,
      hkb_player_id
    LIMIT ${limit}
  `
  return rows.map((row) => row.hkb_player_id)
}

interface StoredIdentityEvidenceRow {
  blob_sha256: string
  fetched_at: Date
  id: string
  record_json: unknown
}

export function identityObservationFromStoredRaw(
  row: StoredIdentityEvidenceRow,
): HarryKnowsBallIdentityObservation {
  const evidence = hkbIdentityEvidenceSchema.parse(row.record_json)
  const observedAt = new Date(isoTimestamp(
    evidence.observedAt,
    'HarryKnowsBall identity observedAt',
  ))
  if (observedAt.getTime() !== row.fetched_at.getTime()) {
    throw new Error('HarryKnowsBall identity evidence timestamp differs from raw fetch')
  }
  if (evidence.responseSha256 !== row.blob_sha256) {
    throw new Error('HarryKnowsBall identity evidence hash differs from raw blob')
  }
  return {
    hkbPlayerId: evidence.hkbPlayerId,
    mlbamId: evidence.mlbamId,
    observedAt,
    playerName: evidence.playerName,
    rawRecordId: row.id,
    responseSha256: row.blob_sha256,
    sourceUrl: evidence.sourceUrl,
  }
}

async function exactIdentityRawEvidence(
  sql: ReturnType<typeof postgres>,
  sourceRecordKey: string,
): Promise<HarryKnowsBallIdentityObservation> {
  const [evidence] = await sql<StoredIdentityEvidenceRow[]>`
    SELECT
      record.id,
      source_fetch.fetched_at,
      raw_blob.sha256 AS blob_sha256,
      record.record_json
    FROM raw.record AS record
    JOIN raw.fetch AS source_fetch ON source_fetch.id = record.fetch_id
    JOIN raw.blob AS raw_blob ON raw_blob.id = source_fetch.blob_id
    JOIN raw.ingestion_run AS ingestion ON ingestion.id = source_fetch.run_id
    JOIN catalog.dataset AS dataset ON dataset.id = ingestion.dataset_id
    JOIN catalog.source AS source ON source.id = dataset.source_id
    WHERE source.slug = 'harry-knows-ball'
      AND dataset.dataset_key = 'player-identity-pages'
      AND ingestion.status = 'succeeded'
      AND record.parser_schema_version = ${HKB_IDENTITY_PARSER_VERSION}
      AND record.record_type = 'hkb_exact_player_identity'
      AND record.source_record_key = ${sourceRecordKey}
    ORDER BY source_fetch.fetched_at DESC, record.ingested_at DESC
    LIMIT 1
  `
  if (!evidence) throw new Error('HarryKnowsBall identity raw record could not be resolved')
  return identityObservationFromStoredRaw(evidence)
}

async function backfillOneIdentity(
  sql: ReturnType<typeof postgres>,
  hkbPlayerId: string,
  options: BackfillHarryKnowsBallIdentitiesOptions,
): Promise<'duplicate' | 'stored'> {
  const requestedUrl = buildHarryKnowsBallUrl('player', {
    baseUrl: options.baseUrl,
    hkbPlayerId,
  })
  const response = await captureResponse(requestedUrl, options.signal)
  const parsed = parseHarryKnowsBallPlayerPage(response.bodyText, hkbPlayerId)
  const identityPolicy = 'exact_hkb_player_page_published_mlbam_no_name_matching'
  const evidenceMethod = 'hkb_player_page_published_mlbam'
  const evidence = {
    hkbPlayerId: parsed.hkbPlayerId,
    mlbamId: parsed.mlbamId,
    playerName: parsed.playerName,
    sourceUrl: response.url,
    requestedUrl,
    observedAt: response.fetchedAt.toISOString(),
    responseSha256: response.responseHash,
    evidenceMethod,
    identityPolicy,
  }
  const sourceRecordKey = `hkb:${parsed.hkbPlayerId}|mlbam:${parsed.mlbamId}`
  const landing = await persistRawLanding(sql, {
    signal: options.signal,
    sourceSlug: 'harry-knows-ball',
    datasetKey: 'player-identity-pages',
    idempotencyKey: sha256(
      `${HKB_IDENTITY_PARSER_VERSION}:${parsed.hkbPlayerId}:${response.responseHash}`,
    ),
    mode: 'identity_backfill',
    parserVersion: HKB_IDENTITY_PARSER_VERSION,
    parameters: {
      hkbPlayerId: parsed.hkbPlayerId,
      identityPolicy,
      request: sanitizedRequest(requestedUrl),
    },
    counts: { rows: 1, exactMlbamRows: 1 },
    fetchedAt: response.fetchedAt,
    request: {
      sanitized: sanitizedRequest(requestedUrl),
      fingerprint: requestFingerprint(requestedUrl),
    },
    response: {
      sha256: response.responseHash,
      byteLength: response.byteLength,
      mediaType: response.mediaType,
      contentEncoding: response.contentEncoding,
      statusCode: response.statusCode,
      etag: response.etag,
      lastModified: response.lastModified,
      headers: response.headers,
      bodyText: response.bodyText,
    },
    records: [{
      record: evidence,
      recordType: 'hkb_exact_player_identity',
      sourceRecordKey,
      recordSha256: sha256(stableStringify(evidence)),
    }],
  })
  if (landing.status === 'in_progress') {
    throw new Error(`HarryKnowsBall identity ${hkbPlayerId} is already being ingested`)
  }

  const storedEvidence = await exactIdentityRawEvidence(sql, sourceRecordKey)
  await sql`
    SELECT core.observe_hkb_exact_identity(
      ${storedEvidence.hkbPlayerId},
      ${storedEvidence.mlbamId},
      ${storedEvidence.playerName},
      ${storedEvidence.sourceUrl},
      ${storedEvidence.observedAt},
      ${storedEvidence.responseSha256},
      ${storedEvidence.rawRecordId}::uuid
    )
  `
  return landing.status
}

export async function backfillHarryKnowsBallIdentities(
  options: BackfillHarryKnowsBallIdentitiesOptions = {},
): Promise<BackfillHarryKnowsBallIdentitiesResult> {
  options.signal?.throwIfAborted()
  const delayMs = options.delayMs ?? HKB_IDENTITY_DEFAULT_DELAY_MS
  if (!Number.isInteger(delayMs) || delayMs < 500) {
    throw new Error('HarryKnowsBall identity delay must be an integer of at least 500ms')
  }

  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions(60_000))
  const summary: BackfillHarryKnowsBallIdentitiesResult = {
    attempted: 0,
    stored: 0,
    duplicates: 0,
    failures: [],
  }
  try {
    const ids = await candidateIdentityIds(sql, options)
    for (const [index, hkbPlayerId] of ids.entries()) {
      options.signal?.throwIfAborted()
      summary.attempted += 1
      try {
        const status = await backfillOneIdentity(sql, hkbPlayerId, options)
        if (status === 'stored') summary.stored += 1
        else summary.duplicates += 1
      } catch (error) {
        options.signal?.throwIfAborted()
        await recordIdentityBackfillFailure(sql, hkbPlayerId, error)
        summary.failures.push({
          hkbPlayerId,
          message: identityFailureMessage(error),
        })
      }
      if (index < ids.length - 1) await abortableDelay(delayMs, options.signal)
    }
  } finally {
    await sql.end({ timeout: 5 })
  }

  if (summary.stored + summary.duplicates > 0) {
    await refreshHarryKnowsBallViews()
  }
  return summary
}

function argument(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null
}

function integerArgument(name: string, fallback: number): number {
  const raw = argument(name)
  const value = raw === null ? fallback : Number(raw)
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer`)
  return value
}

async function runCli(): Promise<void> {
  const identityOnly = process.argv.includes('--identity-only')
  if (identityOnly) {
    const result = await backfillHarryKnowsBallIdentities({
      baseUrl: argument('base-url') ?? undefined,
      delayMs: integerArgument('identity-delay-ms', HKB_IDENTITY_DEFAULT_DELAY_MS),
      limit: integerArgument('identity-limit', HKB_IDENTITY_DEFAULT_LIMIT),
    })
    process.stdout.write(
      `HarryKnowsBall identity backfill: ${result.stored} stored, ` +
        `${result.duplicates} unchanged, ${result.failures.length} failed\n`,
    )
    if (result.failures.length > 0) process.exitCode = 1
    return
  }

  const result = await ingestHarryKnowsBallSnapshot({
    baseUrl: argument('base-url') ?? undefined,
    identityBackfillLimit: integerArgument('identity-limit', 0),
    identityDelayMs: integerArgument(
      'identity-delay-ms',
      HKB_IDENTITY_DEFAULT_DELAY_MS,
    ),
  })
  process.stdout.write(
    `HarryKnowsBall ${result.status}: ${result.rankingRows} Dynasty Score rows, ` +
      `${result.topViewedPlayerRows}/${result.topViewedProspectRows} attention rows, ` +
      `${result.identitiesBackfilled} identities backfilled ` +
      `(${result.captureId.slice(0, 12)})\n`,
  )
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectExecution) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown ingestion error'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
