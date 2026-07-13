import { Buffer } from 'node:buffer'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'
import {
  fetchWithRetry,
  PARSER_VERSION,
  parseFangraphsEnvelope,
  sourceRecordKey,
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
  signal?: AbortSignal
  url?: string
}

export interface IngestFangraphsProspectsResult {
  status: 'duplicate' | 'in_progress' | 'stored'
  responseHash: string
  scoutRows: number
  statsRows: number
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
  const url = normalizeRequestUrl(
    options.url ?? process.env.FANGRAPHS_PROSPECTS_URL ?? defaultUrl,
  )
  const response = await fetchWithRetry(url, 3, options.signal)
  const body = await response.text()
  options.signal?.throwIfAborted()
  const fetchedAt = new Date()
  const envelope = parseFangraphsEnvelope(body)
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
      mode: 'historical_snapshot',
      parserVersion: PARSER_VERSION,
      parameters: { request: sanitizedRequest(url) },
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
