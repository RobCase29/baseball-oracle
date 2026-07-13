import { Buffer } from 'node:buffer'
import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'
import {
  CRAWL_DELAY_MS,
  parseValueSeasonPage,
  USER_AGENT,
  type ValueSeasonRow,
} from '../backfill/baseball-reference-mlb-war.js'
import { persistRawLanding } from './raw-landing.js'
import {
  assertBaseballReferenceCurrentCardinality,
  type CurrentRefreshCardinalityGate,
} from './current-refresh-quality.js'
import {
  disambiguateSourceRecordKeys,
  fetchWithRetry,
  idempotencyKey,
  normalizeRequestUrl,
  requestFingerprint,
  safeResponseHeaders,
  sanitizedRequest,
  schemaFingerprint,
  sha256,
  stableStringify,
} from './shared.js'

export const BASEBALL_REFERENCE_CURRENT_PARSER_VERSION =
  'baseball-reference-current-value/v1'

type ValueSide = 'batting' | 'pitching'

export interface BaseballReferenceCurrentResult {
  season: number
  batting: { status: 'duplicate' | 'in_progress' | 'stored'; rows: number }
  pitching: { status: 'duplicate' | 'in_progress' | 'stored'; rows: number }
}

export function baseballReferenceCurrentValueUrl(
  season: number,
  side: ValueSide,
): string {
  if (!Number.isInteger(season) || season < 1871 || season > 2200) {
    throw new Error('Baseball-Reference season must be a plausible integer year')
  }
  return `https://www.baseball-reference.com/leagues/majors/${season}-value-${side}.shtml`
}

export function currentValueSourceRecordKey(row: ValueSeasonRow): string {
  return `${row.bbref_id}|season:${row.season}|side:${row.side}`
}

async function ingestSide(
  season: number,
  side: ValueSide,
  enforceCurrentCardinality: boolean,
): Promise<{ status: 'duplicate' | 'in_progress' | 'stored'; rows: number }> {
  const url = normalizeRequestUrl(baseballReferenceCurrentValueUrl(season, side))
  const response = await fetchWithRetry(url, {
    attempts: 1,
    sourceName: 'Baseball-Reference',
    timeoutMs: 60_000,
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Encoding': 'identity',
      'User-Agent': USER_AGENT,
    },
  })
  const finalUrl = normalizeRequestUrl(response.url || url)
  if (finalUrl !== url) throw new Error(`Unexpected Baseball-Reference redirect to ${finalUrl}`)
  const mediaType = response.headers.get('content-type') ?? 'text/html'
  if (!mediaType.toLowerCase().includes('text/html')) {
    throw new Error(`Unexpected Baseball-Reference content type: ${mediaType}`)
  }
  const body = await response.text()
  const rows = parseValueSeasonPage(body, season, side)
  const fetchedAt = new Date()
  const responseHash = sha256(body)
  const sourceRows = rows.map((row) => row as unknown as Record<string, unknown>)
  const keys = disambiguateSourceRecordKeys(sourceRows, (row) =>
    currentValueSourceRecordKey(row as unknown as ValueSeasonRow),
  )
  const records = rows.map((row, index) => ({
    record: row as unknown as Record<string, unknown>,
    recordType: `current_value_${side}`,
    sourceRecordKey: keys[index],
    recordSha256: sha256(stableStringify(row)),
  }))
  const sql = postgres(directDatabaseUrl(), {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 15,
  })

  try {
    let cardinalityGate: CurrentRefreshCardinalityGate | null = null
    if (enforceCurrentCardinality) {
      const [previous] = await sql<{ rows: number }[]>`
        SELECT (run.counts->>'rows')::integer AS rows
        FROM raw.ingestion_run AS run
        JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
        JOIN catalog.source AS source ON source.id = dataset.source_id
        WHERE source.slug = 'sports-reference'
          AND dataset.dataset_key = 'baseball-player-records'
          AND run.status = 'succeeded'
          AND run.parser_version = ${BASEBALL_REFERENCE_CURRENT_PARSER_VERSION}
          AND run.parameters->>'season' = ${String(season)}
          AND run.parameters->>'side' = ${side}
          AND run.counts->>'rows' ~ '^\\d+$'
        ORDER BY run.finished_at DESC NULLS LAST, run.started_at DESC
        LIMIT 1
      `
      cardinalityGate = assertBaseballReferenceCurrentCardinality(
        rows.length,
        season,
        side,
        previous?.rows ?? null,
      )
    }

    const landing = await persistRawLanding(sql, {
      sourceSlug: 'sports-reference',
      datasetKey: 'baseball-player-records',
      idempotencyKey: idempotencyKey(url, responseHash),
      mode: 'incremental',
      requestedAsOf: fetchedAt,
      parserVersion: BASEBALL_REFERENCE_CURRENT_PARSER_VERSION,
      parameters: {
        request: sanitizedRequest(url),
        season,
        side,
        seasonState: 'in_season',
        ...(cardinalityGate
          ? { currentRefreshCardinality: cardinalityGate }
          : {}),
      },
      counts: {
        rows: rows.length,
        schema: schemaFingerprint(records.map((record) => record.record)),
        ...(cardinalityGate
          ? { currentRefreshCardinality: cardinalityGate }
          : {}),
      },
      fetchedAt,
      request: {
        sanitized: sanitizedRequest(url),
        fingerprint: requestFingerprint(url),
      },
      response: {
        sha256: responseHash,
        byteLength: Buffer.byteLength(body, 'utf8'),
        mediaType,
        contentEncoding: response.headers.get('content-encoding'),
        statusCode: response.status,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        headers: safeResponseHeaders(response),
        bodyText: body,
      },
      records,
    })
    return { status: landing.status, rows: rows.length }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export async function ingestBaseballReferenceCurrentSeason(
  season: number,
  options: { enforceCurrentCardinality?: boolean } = {},
): Promise<BaseballReferenceCurrentResult> {
  const enforceCurrentCardinality = options.enforceCurrentCardinality ?? false
  const batting = await ingestSide(season, 'batting', enforceCurrentCardinality)
  await new Promise((resolve) => setTimeout(resolve, CRAWL_DELAY_MS))
  const pitching = await ingestSide(season, 'pitching', enforceCurrentCardinality)
  return { season, batting, pitching }
}
