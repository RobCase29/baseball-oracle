import { Buffer } from 'node:buffer'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'
import {
  assertFangraphsCurrentEnvelope,
  buildFangraphsCurrentProspectsUrl,
  fetchWithRetry,
  PARSER_VERSION,
  parseFangraphsEnvelope,
  sourceRecordKey,
  type FangraphsCurrentStatsRole,
} from './fangraphs.js'
import { persistRawLanding } from './raw-landing.js'
import {
  disambiguateSourceRecordKeys,
  currentRefreshDatabaseOptions,
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

const defaultUrl =
  'https://www.fangraphs.com/api/prospects/board/prospects-list-combined?pos=all&lg=2,4,5,6,7,8,9,10,11,14,12,13,15,16,17,18,30,32,33&stats=bat&qual=0&type=0&team=&season=2021&seasonend=2021&draft=2022prospect&valueheader=prospect-new&quickleaderboard=2021all'

export interface IngestFangraphsProspectsOptions {
  enforceCurrentCardinality?: boolean
  season?: number
  signal?: AbortSignal
  statsRole?: FangraphsCurrentStatsRole
  url?: string
}

export interface IngestFangraphsProspectsResult {
  status: 'duplicate' | 'in_progress' | 'stored'
  responseHash: string
  scoutRows: number
  statsRows: number
}

export interface IngestFangraphsCurrentProspectsOptions {
  season: number
  signal?: AbortSignal
}

export interface IngestFangraphsCurrentProspectsResult {
  batting: IngestFangraphsProspectsResult
  pitching: IngestFangraphsProspectsResult
  season: number
  snapshotRows: number
}

export interface FangraphsCurrentSnapshotAudit {
  battingExactMlbamRows: number
  battingResolvedMlbamRows: number
  battingRows: number
  pitchingExactMlbamRows: number
  pitchingResolvedMlbamRows: number
  pitchingRows: number
  totalRows: number
}

function argument(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null
}

function uniqueRecordKeys(
  records: SourceRecord[],
  recordType: 'scout' | 'stats',
): string[] {
  return disambiguateSourceRecordKeys(records, (record) =>
    sourceRecordKey(recordType, record),
  )
}

export async function ingestFangraphsProspects(
  options: IngestFangraphsProspectsOptions = {},
): Promise<IngestFangraphsProspectsResult> {
  options.signal?.throwIfAborted()
  if ((options.season === undefined) !== (options.statsRole === undefined)) {
    throw new Error('Current FanGraphs ingestion requires both season and statsRole')
  }
  const currentUrl = options.season !== undefined && options.statsRole !== undefined
    ? buildFangraphsCurrentProspectsUrl(options.season, options.statsRole)
    : null
  const url = normalizeRequestUrl(
    options.url ?? currentUrl ?? process.env.FANGRAPHS_PROSPECTS_URL ?? defaultUrl,
  )
  const response = await fetchWithRetry(url, 3, options.signal)
  const body = await response.text()
  options.signal?.throwIfAborted()
  const fetchedAt = new Date()
  const envelope = parseFangraphsEnvelope(body)
  if (options.season !== undefined && options.statsRole !== undefined) {
    assertFangraphsCurrentEnvelope(envelope, {
      enforceCardinality: options.enforceCurrentCardinality,
      season: options.season,
      statsRole: options.statsRole,
    })
  }
  const responseHash = sha256(body)
  const scoutKeys = uniqueRecordKeys(envelope.dataScout, 'scout')
  const statsKeys = uniqueRecordKeys(envelope.dataStats, 'stats')
  const counts = {
    scoutRows: envelope.dataScout.length,
    statsRows: envelope.dataStats.length,
    scoutSchema: schemaFingerprint(envelope.dataScout),
    statsSchema: schemaFingerprint(envelope.dataStats),
  }
  const records = [
    ...envelope.dataScout.map((record, index) => ({
      record,
      recordType: 'scout',
      sourceRecordKey: scoutKeys[index],
      recordSha256: sha256(stableStringify(record)),
    })),
    ...envelope.dataStats.map((record, index) => ({
      record,
      recordType: 'stats',
      sourceRecordKey: statsKeys[index],
      recordSha256: sha256(stableStringify(record)),
    })),
  ]

  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions())

  try {
    options.signal?.throwIfAborted()
    const landing = await persistRawLanding(sql, {
      signal: options.signal,
      sourceSlug: 'fangraphs',
      datasetKey: 'prospect-board',
      idempotencyKey: idempotencyKey(url, responseHash),
      mode: options.season === undefined ? 'historical_snapshot' : 'current_snapshot',
      parserVersion: PARSER_VERSION,
      parameters: {
        request: sanitizedRequest(url),
        ...(options.season === undefined || options.statsRole === undefined
          ? {}
          : {
              refreshScope: 'current_prospect_board',
              season: options.season,
              statsRole: options.statsRole,
            }),
      },
      counts,
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
      scoutRows: counts.scoutRows,
      statsRows: counts.statsRows,
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export function assertFangraphsCurrentSnapshot(
  audit: FangraphsCurrentSnapshotAudit | undefined,
): void {
  if (!audit) throw new Error('Current FanGraphs scouting snapshot audit returned no result')
  const counts = [
    audit.battingExactMlbamRows,
    audit.battingResolvedMlbamRows,
    audit.battingRows,
    audit.pitchingExactMlbamRows,
    audit.pitchingResolvedMlbamRows,
    audit.pitchingRows,
    audit.totalRows,
  ]
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error('Current FanGraphs scouting snapshot audit contains invalid counts')
  }
  if (
    audit.totalRows !== audit.battingRows + audit.pitchingRows ||
    audit.battingExactMlbamRows > audit.battingResolvedMlbamRows ||
    audit.battingResolvedMlbamRows > audit.battingRows ||
    audit.pitchingExactMlbamRows > audit.pitchingResolvedMlbamRows ||
    audit.pitchingResolvedMlbamRows > audit.pitchingRows
  ) {
    throw new Error('Current FanGraphs scouting snapshot audit is internally inconsistent')
  }
  if (audit.battingRows < 250 || audit.pitchingRows < 250) {
    throw new Error(
      `Current FanGraphs scouting snapshot is undersized: ` +
        `${audit.battingRows} batting and ${audit.pitchingRows} pitching rows`,
    )
  }
  if (audit.battingExactMlbamRows < 200 || audit.pitchingExactMlbamRows < 200) {
    throw new Error(
      `Current FanGraphs scouting snapshot lacks current exact MLBAM coverage: ` +
        `${audit.battingExactMlbamRows} batting and ` +
        `${audit.pitchingExactMlbamRows} pitching rows`,
    )
  }
}

export async function refreshFangraphsCurrentScoutingSnapshot(
  season: number,
): Promise<number> {
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions())
  try {
    return await sql.begin(async (transaction) => {
      await transaction`
        REFRESH MATERIALIZED VIEW app.fangraphs_current_scouting_snapshot
      `
      await transaction`
        REFRESH MATERIALIZED VIEW app.fangraphs_current_candidate_census
      `
      const [audit] = await transaction<{
        batting_exact_mlbam_rows: number
        batting_resolved_mlbam_rows: number
        batting_rows: number
        pitching_exact_mlbam_rows: number
        pitching_resolved_mlbam_rows: number
        pitching_rows: number
        total_rows: number
      }[]>`
        SELECT
          count(*)::integer AS total_rows,
          count(*) FILTER (WHERE source_role = 'Hitter')::integer AS batting_rows,
          count(*) FILTER (WHERE source_role = 'Pitcher')::integer AS pitching_rows,
          count(*) FILTER (
            WHERE source_role = 'Hitter'
              AND served_mlbam_resolution_status = 'current_exact'
          )::integer AS batting_exact_mlbam_rows,
          count(*) FILTER (
            WHERE source_role = 'Hitter' AND served_resolved_mlbam_id IS NOT NULL
          )::integer AS batting_resolved_mlbam_rows,
          count(*) FILTER (
            WHERE source_role = 'Pitcher'
              AND served_mlbam_resolution_status = 'current_exact'
          )::integer AS pitching_exact_mlbam_rows,
          count(*) FILTER (
            WHERE source_role = 'Pitcher' AND served_resolved_mlbam_id IS NOT NULL
          )::integer AS pitching_resolved_mlbam_rows
        FROM app.fangraphs_current_candidate_bridge_overlay
        WHERE report_season = ${season}
      `
      const normalizedAudit = audit
        ? {
            battingExactMlbamRows: audit.batting_exact_mlbam_rows,
            battingResolvedMlbamRows: audit.batting_resolved_mlbam_rows,
            battingRows: audit.batting_rows,
            pitchingExactMlbamRows: audit.pitching_exact_mlbam_rows,
            pitchingResolvedMlbamRows: audit.pitching_resolved_mlbam_rows,
            pitchingRows: audit.pitching_rows,
            totalRows: audit.total_rows,
          }
        : undefined
      assertFangraphsCurrentSnapshot(normalizedAudit)
      return normalizedAudit?.totalRows ?? 0
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export async function ingestFangraphsCurrentProspects(
  options: IngestFangraphsCurrentProspectsOptions,
): Promise<IngestFangraphsCurrentProspectsResult> {
  options.signal?.throwIfAborted()
  const batting = await ingestFangraphsProspects({
    enforceCurrentCardinality: true,
    season: options.season,
    signal: options.signal,
    statsRole: 'bat',
  })
  options.signal?.throwIfAborted()
  const pitching = await ingestFangraphsProspects({
    enforceCurrentCardinality: true,
    season: options.season,
    signal: options.signal,
    statsRole: 'pit',
  })
  options.signal?.throwIfAborted()

  if (batting.status === 'in_progress' || pitching.status === 'in_progress') {
    throw new Error('Current FanGraphs refresh is still in progress')
  }

  const snapshotRows = await refreshFangraphsCurrentScoutingSnapshot(options.season)
  options.signal?.throwIfAborted()
  return { batting, pitching, season: options.season, snapshotRows }
}

async function runCli(): Promise<void> {
  const result = await ingestFangraphsProspects({ url: argument('url') ?? undefined })

  if (result.status === 'duplicate') {
    process.stdout.write(`Snapshot already present (${result.responseHash.slice(0, 12)})\n`)
    return
  }

  if (result.status === 'in_progress') {
    process.stdout.write(`Snapshot ingestion already running (${result.responseHash.slice(0, 12)})\n`)
    return
  }

  process.stdout.write(
    `Stored FanGraphs snapshot ${result.responseHash.slice(0, 12)}: ` +
      `${result.scoutRows} scouting rows, ${result.statsRows} stat rows\n`,
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
