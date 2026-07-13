import { Buffer } from 'node:buffer'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'
import {
  buildProspectSavantHistoricalSlices,
  buildProspectSavantLeadersUrl,
  fetchProspectSavantLeaders,
  parseProspectSavantEnvelope,
  PROSPECT_SAVANT_DEFAULT_API_BASE,
  PROSPECT_SAVANT_PARSER_VERSION,
  prospectSavantCohortDependentMetrics,
  prospectSavantLevels,
  prospectSavantRoles,
  prospectSavantSourceRecordKey,
  validateProspectSavantSlice,
  type ProspectSavantLevel,
  type ProspectSavantRole,
  type ProspectSavantSlice,
} from './prospect-savant.js'
import { persistRawLanding } from './raw-landing.js'
import { refreshPlayerDirectorySnapshot } from './player-directory.js'
import {
  assertProspectSavantCurrentCardinality,
  type CurrentRefreshCardinalityGate,
} from './current-refresh-quality.js'
import {
  abortableDelay,
  currentRefreshDatabaseOptions,
  disambiguateSourceRecordKeys,
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

export interface IngestProspectSavantResult {
  status: 'duplicate' | 'in_progress' | 'stored'
  responseHash: string
  rows: number
  slice: ProspectSavantSlice
}

interface ProspectSavantIngestOptions {
  apiBase?: string
  enforceCurrentCardinality?: boolean
  signal?: AbortSignal
}

async function previousProspectSavantSliceRows(
  sql: ReturnType<typeof postgres>,
  slice: ProspectSavantSlice,
): Promise<number | null> {
  const [previous] = await sql<{ rows: number }[]>`
    SELECT (run.counts->>'rows')::integer AS rows
    FROM raw.ingestion_run AS run
    JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
    JOIN catalog.source AS source ON source.id = dataset.source_id
    WHERE source.slug = 'prospect-savant'
      AND dataset.dataset_key = 'minor-league-leaders'
      AND run.status = 'succeeded'
      AND run.parser_version = ${PROSPECT_SAVANT_PARSER_VERSION}
      AND run.parameters->'slice' = ${sql.json(slice as unknown as postgres.JSONValue)}
      AND run.counts->>'rows' ~ '^\\d+$'
    ORDER BY run.finished_at DESC NULLS LAST, run.started_at DESC
    LIMIT 1
  `
  return previous?.rows ?? null
}

export interface ProspectSavantBackfillResult {
  attempted: number
  stored: number
  duplicates: number
  inProgress: number
  rows: number
  failures: Array<{ slice: ProspectSavantSlice; message: string }>
}

function uniqueRecordKeys(
  records: SourceRecord[],
  slice: ProspectSavantSlice,
): string[] {
  return disambiguateSourceRecordKeys(records, (record) =>
    prospectSavantSourceRecordKey(record, slice),
  )
}

export async function ingestProspectSavantSlice(
  inputSlice: ProspectSavantSlice,
  options: ProspectSavantIngestOptions = {},
): Promise<IngestProspectSavantResult> {
  options.signal?.throwIfAborted()
  const slice = validateProspectSavantSlice(inputSlice)
  const url = normalizeRequestUrl(
    buildProspectSavantLeadersUrl(
      slice,
      options.apiBase ??
        process.env.PROSPECT_SAVANT_API_BASE ??
        PROSPECT_SAVANT_DEFAULT_API_BASE,
    ),
  )
  const response = await fetchProspectSavantLeaders(url, options.signal)
  const body = await response.text()
  options.signal?.throwIfAborted()
  const fetchedAt = new Date()
  const { envelope, semanticQuality } = parseProspectSavantEnvelope(body, slice)
  const responseHash = sha256(body)
  const sourceKeys = uniqueRecordKeys(envelope.data, slice)
  const records = envelope.data.map((record, index) => ({
    record,
    recordType: `leaders_${slice.role}`,
    sourceRecordKey: sourceKeys[index],
    recordSha256: sha256(stableStringify(record)),
  }))

  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions())

  try {
    let cardinalityGate: CurrentRefreshCardinalityGate | null = null
    if (options.enforceCurrentCardinality) {
      const previousRows = await previousProspectSavantSliceRows(sql, slice)
      cardinalityGate = assertProspectSavantCurrentCardinality(
        envelope.data.length,
        slice,
        previousRows,
      )
    }
    options.signal?.throwIfAborted()

    const landing = await persistRawLanding(sql, {
      signal: options.signal,
      sourceSlug: 'prospect-savant',
      datasetKey: 'minor-league-leaders',
      idempotencyKey: idempotencyKey(url, responseHash),
      mode: 'historical_backfill',
      parserVersion: PROSPECT_SAVANT_PARSER_VERSION,
      parameters: {
        request: sanitizedRequest(url),
        slice,
        cohortDependentMetrics: prospectSavantCohortDependentMetrics,
        ...(cardinalityGate
          ? { currentRefreshCardinality: cardinalityGate }
          : {}),
        semanticQuality,
        temporalCaveat:
          'Current age and organization fields are not assumed to be historical as-of values.',
      },
      counts: {
        rows: envelope.data.length,
        schema: schemaFingerprint(envelope.data),
        ...(cardinalityGate
          ? { currentRefreshCardinality: cardinalityGate }
          : {}),
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
      rows: envelope.data.length,
      slice,
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export async function backfillProspectSavant(options: {
  slices?: readonly ProspectSavantSlice[]
  delayMs?: number
  apiBase?: string
  enforceCurrentCardinality?: boolean
  signal?: AbortSignal
  onProgress?: (result: IngestProspectSavantResult) => void
} = {}): Promise<ProspectSavantBackfillResult> {
  const slices = options.slices ?? buildProspectSavantHistoricalSlices()
  const delayMs = options.delayMs ?? 500
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error('Prospect Savant backfill delay must be a non-negative integer')
  }

  const summary: ProspectSavantBackfillResult = {
    attempted: 0,
    stored: 0,
    duplicates: 0,
    inProgress: 0,
    rows: 0,
    failures: [],
  }

  for (const [index, slice] of slices.entries()) {
    options.signal?.throwIfAborted()
    summary.attempted += 1
    try {
      const result = await ingestProspectSavantSlice(slice, {
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

    if (index < slices.length - 1 && delayMs > 0) {
      await abortableDelay(delayMs, options.signal)
    }
  }

  return summary
}

function argument(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null
}

function parseList<T extends string>(
  value: string | null,
  allowed: readonly T[],
  label: string,
): T[] | undefined {
  if (!value || value === 'all') return undefined
  const selected = value.split(',').map((item) => item.trim())
  for (const item of selected) {
    if (!allowed.includes(item as T)) throw new Error(`Unsupported ${label}: ${item}`)
  }
  return selected as T[]
}

function parseSeasons(value: string | null): number[] | undefined {
  if (!value || value === 'all') return undefined
  const seasons = new Set<number>()
  for (const part of value.split(',')) {
    const [startText, endText] = part.trim().split('-')
    const start = Number(startText)
    const end = endText ? Number(endText) : start
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      throw new Error(`Invalid season selection: ${part}`)
    }
    for (let season = start; season <= end; season += 1) seasons.add(season)
  }
  return [...seasons]
}

function integerArgument(name: string, fallback: number): number {
  const value = argument(name)
  const parsed = value === null ? fallback : Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer`)
  return parsed
}

async function runCli(): Promise<void> {
  const roles = parseList(
    argument('roles'),
    prospectSavantRoles,
    'Prospect Savant role',
  ) as ProspectSavantRole[] | undefined
  const levels = parseList(
    argument('levels'),
    prospectSavantLevels,
    'Prospect Savant level',
  ) as ProspectSavantLevel[] | undefined
  const slices = buildProspectSavantHistoricalSlices({
    roles,
    levels,
    seasons: parseSeasons(argument('seasons')),
    pitchQualifier: integerArgument('qualifier', 1),
    minAge: integerArgument('min-age', 16),
    maxAge: integerArgument('max-age', 40),
  })

  if (slices.length === 0) throw new Error('No audited Prospect Savant slices matched')

  const result = await backfillProspectSavant({
    slices,
    delayMs: integerArgument('delay-ms', 500),
    onProgress: (progress) => {
      process.stdout.write(
        `${progress.status === 'stored' ? 'Stored' : progress.status === 'duplicate' ? 'Skipped' : 'Running'} ` +
          `${progress.slice.season} ${progress.slice.level} ${progress.slice.role}: ` +
          `${progress.rows} rows (${progress.responseHash.slice(0, 12)})\n`,
      )
    },
  })

  if (result.stored > 0 && result.failures.length === 0) {
    await refreshPlayerDirectorySnapshot()
  }

  process.stdout.write(
    `Prospect Savant backfill: ${result.stored} stored, ` +
      `${result.duplicates} unchanged, ${result.inProgress} already running, ` +
      `${result.failures.length} failed, ` +
      `${result.rows} rows observed\n`,
  )

  if (result.failures.length > 0) process.exitCode = 1
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
