import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import postgres from 'postgres'
import {
  requireChadwickKeyMlbamLookup,
  type ChadwickKeyMlbamLookup,
} from '../../api/_chadwick-key-mlbam.js'
import {
  requireMlbIdentityCrosswalk,
  type MlbIdentityCrosswalk,
} from '../../api/_mlb-identity-crosswalk.js'
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
  abortableDelay,
  currentRefreshDatabaseOptions,
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

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom') as {
  JSDOM: new (html: string) => { window: { document: Document } }
}

export const BASEBALL_REFERENCE_CURRENT_PARSER_VERSION =
  'baseball-reference-current-value/v1'
export const BASEBALL_REFERENCE_CURRENT_FETCH_ATTEMPTS = 2
export const BASEBALL_REFERENCE_EXACT_IDENTITY_PARSER_VERSION =
  'baseball-reference-exact-identity/v1'
export const BASEBALL_REFERENCE_EXACT_IDENTITY_FETCH_ATTEMPTS = 2
export const BASEBALL_REFERENCE_EXACT_IDENTITY_MAX_FETCHES = 6
export const BASEBALL_REFERENCE_EXACT_IDENTITY_BUDGET_MS = 30_000
export const BASEBALL_REFERENCE_EXACT_IDENTITY_REQUEST_TIMEOUT_MS = 10_000
export const BASEBALL_REFERENCE_EXACT_IDENTITY_MAX_RESPONSE_BYTES =
  4 * 1024 * 1024
// The cron's 95-second BRef window still needs room for the 20-second snapshot publish.
export const BASEBALL_REFERENCE_EXACT_IDENTITY_POST_CORE_BUDGET_MS = 8_000
export const BASEBALL_REFERENCE_EXACT_IDENTITY_START_CUTOFF_MS = 40_000
export const MLB_EXACT_IDENTITY_POLICY =
  'exact_cross_provider_ids_no_name_matching' as const

type ValueSide = 'batting' | 'pitching'
type SqlClient = ReturnType<typeof postgres>
type ExactIdentityEvidenceMethod =
  | 'bref_page_meta_pinned_chadwick'
  | 'committed_crosswalk_current_value'

export interface ExactIdentityOverlayRow {
  bbref_id: string
  chadwick_key: string
  mlbam_id: string
  first_mlb_season: number
  evidence_method: ExactIdentityEvidenceMethod
  source_url: string
  retrieved_at: Date
  response_sha256: string
  raw_record_id: string
}

interface ExactPlayerPageMetadata {
  canonicalUrl: string
  bbrefId: string
  chadwickKey: string | null
}

export interface CurrentMlbIdentityEvidence {
  method:
    | 'committed_crosswalk'
    | 'durable_exact_overlay'
    | 'bref_page_meta_pinned_chadwick'
  identityPolicy: string
  chadwickKey: string | null
  sourceUrl?: string
  retrievedAt?: string
  responseSha256?: string
  rawRecordId?: string
  crosswalkAsOf?: string
  chadwickLookupAsOf?: string
  chadwickSourceLockSha256?: string
  firstMlbSeason?: number | null
  seasonEvidence?: string | null
}

export interface EnrichedCurrentValueRow extends ValueSeasonRow {
  mlbam_id: number | null
  mlbam_identity_status:
    | 'resolved_crosswalk'
    | 'resolved_overlay'
    | 'resolved_page_meta'
    | 'unresolved'
  mlbam_identity_evidence: CurrentMlbIdentityEvidence | null
  mlbam_identity_unresolved_reason: string | null
  mlbam_identity_overlay_method: ExactIdentityEvidenceMethod | null
  mlbam_identity_overlay_policy: typeof MLB_EXACT_IDENTITY_POLICY
  mlbam_identity_retrieved_at: string
}

export interface CurrentIdentityResolution {
  mlbamId: number | null
  status: EnrichedCurrentValueRow['mlbam_identity_status']
  evidence: CurrentMlbIdentityEvidence | null
  unresolvedReason: string | null
  needsCurrentValueOverlay: boolean
}

interface ExactPageLanding {
  body: string
  byteLength: number
  mediaType: string
  response: Response
  responseHash: string
  retrievedAt: Date
  metadata: ExactPlayerPageMetadata
}

export interface BaseballReferenceCurrentResult {
  season: number
  batting: { status: 'duplicate' | 'in_progress' | 'stored'; rows: number }
  pitching: { status: 'duplicate' | 'in_progress' | 'stored'; rows: number }
}

type CurrentSideResult = BaseballReferenceCurrentResult['batting']

interface CurrentSideLandingContext {
  season: number
  side: ValueSide
  url: string
  body: string
  mediaType: string
  contentEncoding: string | null
  statusCode: number
  etag: string | null
  lastModified: string | null
  responseHeaders: Record<string, string>
  fetchedAt: Date
  responseHash: string
  rows: ValueSeasonRow[]
  cardinalityGate: CurrentRefreshCardinalityGate | null
}

interface IngestedCurrentSide {
  result: CurrentSideResult
  context: CurrentSideLandingContext
  landingIdempotencyKey: string
  resolvedRows: Array<{
    row: EnrichedCurrentValueRow
    resolution: CurrentIdentityResolution
  }>
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

export function baseballReferencePlayerUrl(bbrefId: string): string {
  if (!/^[a-z0-9_'.]+$/u.test(bbrefId)) {
    throw new Error('Baseball-Reference player ID must be a canonical exact identifier')
  }
  return `https://www.baseball-reference.com/players/${bbrefId[0]}/${bbrefId}.shtml`
}

export function parseExactPlayerPageMetadata(
  html: string,
  expectedBbrefId: string,
): ExactPlayerPageMetadata {
  const expectedUrl = baseballReferencePlayerUrl(expectedBbrefId)
  const document = new JSDOM(html).window.document
  const canonicalUrls = [
    ...document.querySelectorAll<HTMLLinkElement>('link[rel~="canonical"]'),
  ].map((element) => element.href)
  if (canonicalUrls.length !== 1 || canonicalUrls[0] !== expectedUrl) {
    throw new Error('Baseball-Reference player page canonical URL mismatch')
  }

  const bbrefValues = [
    ...document.querySelectorAll<HTMLMetaElement>('meta[name="sr-bbref-id"]'),
  ].map((element) => element.content.trim())
  if (bbrefValues.length !== 1 || bbrefValues[0] !== expectedBbrefId) {
    throw new Error('Baseball-Reference sr-bbref-id metadata mismatch')
  }

  const chadwickValues = [
    ...document.querySelectorAll<HTMLMetaElement>('meta[name="sr-chadwick-id"]'),
  ].map((element) => element.content.trim())
  if (chadwickValues.length === 0) {
    return {
      canonicalUrl: expectedUrl,
      bbrefId: expectedBbrefId,
      chadwickKey: null,
    }
  }
  if (
    chadwickValues.length !== 1 ||
    !/^[0-9a-f]{8}$/u.test(chadwickValues[0] ?? '')
  ) {
    throw new Error('Baseball-Reference sr-chadwick-id metadata is ambiguous or invalid')
  }
  return {
    canonicalUrl: expectedUrl,
    bbrefId: expectedBbrefId,
    chadwickKey: chadwickValues[0],
  }
}

export function assertExactIdentityPageByteLength(byteLength: number): void {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > BASEBALL_REFERENCE_EXACT_IDENTITY_MAX_RESPONSE_BYTES
  ) {
    throw new Error(
      `Baseball-Reference exact identity page exceeds ${BASEBALL_REFERENCE_EXACT_IDENTITY_MAX_RESPONSE_BYTES} bytes`,
    )
  }
}

export function exactIdentityPostCoreBudgetMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0
  return elapsedMs < BASEBALL_REFERENCE_EXACT_IDENTITY_START_CUTOFF_MS
    ? BASEBALL_REFERENCE_EXACT_IDENTITY_POST_CORE_BUDGET_MS
    : 0
}

export async function readExactIdentityPageText(
  response: Response,
  signal?: AbortSignal,
): Promise<{ body: string; byteLength: number }> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength && /^\d+$/u.test(declaredLength)) {
    assertExactIdentityPageByteLength(Number(declaredLength))
  }
  if (!response.body) return { body: '', byteLength: 0 }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let byteLength = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      byteLength += chunk.value.byteLength
      assertExactIdentityPageByteLength(byteLength)
      chunks.push(Buffer.from(chunk.value))
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  return {
    body: Buffer.concat(chunks, byteLength).toString('utf8'),
    byteLength,
  }
}

export function exactPageFirstMlbSeason(
  crosswalk: MlbIdentityCrosswalk,
  bbrefId: string,
  mlbamId: number,
  observedSeason: number,
): number | null {
  const staticIdentity = crosswalk.byMlbam(mlbamId)
  if (
    staticIdentity?.bbref !== null &&
    staticIdentity?.bbref !== undefined &&
    staticIdentity.bbref !== bbrefId
  ) {
    return null
  }
  return staticIdentity?.firstMlbSeason ?? observedSeason
}

function enrichedCurrentValueSourceRecordKey(row: EnrichedCurrentValueRow): string {
  return currentValueSourceRecordKey(row)
}

function exactIdentitySourceRecordKey(bbrefId: string): string {
  return `bbref:${bbrefId}`
}

export interface ExactIdentityRawEvidence {
  rawRecordId: string
  retrievedAt: Date
  responseSha256: string
}

export function exactIdentityRawEvidenceFromRow(row: {
  id: string
  fetched_at: Date | string
  response_sha256: string
}): ExactIdentityRawEvidence {
  const retrievedAt = row.fetched_at instanceof Date
    ? row.fetched_at
    : new Date(row.fetched_at)
  if (!Number.isFinite(retrievedAt.getTime()) || !/^[0-9a-f]{64}$/u.test(row.response_sha256)) {
    throw new Error('Exact identity raw evidence metadata is invalid')
  }
  return {
    rawRecordId: row.id,
    retrievedAt,
    responseSha256: row.response_sha256,
  }
}

async function exactIdentityRawEvidence(
  sql: SqlClient,
  datasetKey: string,
  landingIdempotencyKey: string,
  recordType: string,
  sourceRecordKey: string,
): Promise<ExactIdentityRawEvidence> {
  const [record] = await sql<{
    id: string
    fetched_at: Date | string
    response_sha256: string
  }[]>`
    SELECT
      raw_record.id,
      source_fetch.fetched_at,
      raw_blob.sha256 AS response_sha256
    FROM raw.record AS raw_record
    JOIN raw.fetch AS source_fetch ON source_fetch.id = raw_record.fetch_id
    JOIN raw.blob AS raw_blob ON raw_blob.id = source_fetch.blob_id
    JOIN raw.ingestion_run AS ingestion ON ingestion.id = source_fetch.run_id
    JOIN catalog.dataset AS dataset ON dataset.id = ingestion.dataset_id
    JOIN catalog.source AS source ON source.id = dataset.source_id
    WHERE source.slug = 'sports-reference'
      AND dataset.dataset_key = ${datasetKey}
      AND ingestion.idempotency_key = ${landingIdempotencyKey}
      AND ingestion.status = 'succeeded'
      AND raw_record.record_type = ${recordType}
      AND raw_record.source_record_key = ${sourceRecordKey}
    ORDER BY raw_record.ingested_at DESC, raw_record.id DESC
    LIMIT 1
  `
  if (!record) throw new Error('Exact identity raw evidence record is unavailable')
  return exactIdentityRawEvidenceFromRow(record)
}

async function observeExactIdentityOverlay(
  sql: SqlClient,
  input: {
    bbrefId: string
    chadwickKey: string
    mlbamId: number
    firstMlbSeason: number
    evidenceMethod: ExactIdentityEvidenceMethod
    sourceUrl: string
    retrievedAt: Date
    responseSha256: string
    rawRecordId: string
  },
): Promise<ExactIdentityOverlayRow> {
  const [row] = await sql<ExactIdentityOverlayRow[]>`
    SELECT *
    FROM core.observe_mlb_exact_identity_overlay(
      ${input.bbrefId},
      ${input.chadwickKey},
      ${input.mlbamId},
      ${input.firstMlbSeason},
      ${input.evidenceMethod},
      ${input.sourceUrl},
      ${input.retrievedAt},
      ${input.responseSha256},
      ${MLB_EXACT_IDENTITY_POLICY},
      ${input.rawRecordId}
    )
  `
  if (!row) throw new Error('Exact identity overlay observation returned no row')
  return row
}

export function resolutionFromOverlay(
  row: ExactIdentityOverlayRow,
  crosswalk: MlbIdentityCrosswalk,
  chadwickLookup: ChadwickKeyMlbamLookup,
): CurrentIdentityResolution {
  const mlbamId = Number(row.mlbam_id)
  if (!Number.isSafeInteger(mlbamId) || mlbamId < 1) {
    return unresolved('durable_overlay_invalid_mlbam')
  }
  if (chadwickLookup.byKeyPerson(row.chadwick_key) !== mlbamId) {
    return unresolved('durable_overlay_pinned_chadwick_conflict')
  }
  const staticByBbref = crosswalk.byBbref(row.bbref_id)
  if (staticByBbref !== null && staticByBbref.mlbam !== mlbamId) {
    return unresolved('durable_overlay_static_bbref_conflict')
  }
  const staticByMlbam = crosswalk.byMlbam(mlbamId)
  if (
    staticByMlbam?.bbref !== null &&
    staticByMlbam?.bbref !== undefined &&
    staticByMlbam.bbref !== row.bbref_id
  ) {
    return unresolved('durable_overlay_static_mlbam_conflict')
  }
  return {
    mlbamId,
    status: 'resolved_overlay',
    evidence: {
      method: 'durable_exact_overlay',
      identityPolicy: MLB_EXACT_IDENTITY_POLICY,
      chadwickKey: row.chadwick_key,
      sourceUrl: row.source_url,
      retrievedAt: row.retrieved_at.toISOString(),
      responseSha256: row.response_sha256,
      rawRecordId: row.raw_record_id,
      chadwickLookupAsOf: chadwickLookup.summary.asOf,
      chadwickSourceLockSha256:
        chadwickLookup.summary.source.chadwickRegister.sourceLockSha256,
      firstMlbSeason: row.first_mlb_season,
      seasonEvidence: 'durable-exact-overlay',
    },
    unresolvedReason: null,
    needsCurrentValueOverlay: false,
  }
}

function unresolved(reason: string): CurrentIdentityResolution {
  return {
    mlbamId: null,
    status: 'unresolved',
    evidence: null,
    unresolvedReason: reason,
    needsCurrentValueOverlay: false,
  }
}

export class CurrentMlbIdentityResolver {
  readonly #crosswalk: MlbIdentityCrosswalk
  readonly #chadwickLookup: ChadwickKeyMlbamLookup
  readonly #unknownCache = new Map<string, Promise<CurrentIdentityResolution>>()
  readonly #unknownResolverOverride: ((
    bbrefId: string,
    season: number,
    sql: SqlClient,
    signal?: AbortSignal,
  ) => Promise<CurrentIdentityResolution>) | undefined
  #exactFetches = 0
  #identityBudgetStartedAt: number | null = null
  #lastBaseballReferenceRequestAt: number | null = null

  constructor(
    crosswalk: MlbIdentityCrosswalk = requireMlbIdentityCrosswalk(),
    chadwickLookup: ChadwickKeyMlbamLookup = requireChadwickKeyMlbamLookup(),
    unknownResolverOverride?: (
      bbrefId: string,
      season: number,
      sql: SqlClient,
      signal?: AbortSignal,
    ) => Promise<CurrentIdentityResolution>,
  ) {
    this.#crosswalk = crosswalk
    this.#chadwickLookup = chadwickLookup
    this.#unknownResolverOverride = unknownResolverOverride
  }

  noteBaseballReferenceRequest(): void {
    this.#lastBaseballReferenceRequestAt = Date.now()
  }

  async resolve(
    bbrefId: string,
    season: number,
    sql: SqlClient,
    signal?: AbortSignal,
    allowAuxiliary = true,
  ): Promise<CurrentIdentityResolution> {
    const committed = this.#crosswalk.byBbref(bbrefId)
    if (committed) {
      const chadwickKey = this.#chadwickLookup.keyPersonByMlbam(committed.mlbam)
      return {
        mlbamId: committed.mlbam,
        status: 'resolved_crosswalk',
        evidence: {
          method: 'committed_crosswalk',
          identityPolicy: this.#crosswalk.summary.identityPolicy,
          chadwickKey,
          crosswalkAsOf: this.#crosswalk.summary.asOf,
          chadwickLookupAsOf: this.#chadwickLookup.summary.asOf,
          chadwickSourceLockSha256:
            this.#chadwickLookup.summary.source.chadwickRegister.sourceLockSha256,
          firstMlbSeason: committed.firstMlbSeason,
          seasonEvidence: committed.seasonEvidence,
        },
        unresolvedReason: null,
        needsCurrentValueOverlay:
          committed.firstMlbSeason === null && chadwickKey !== null,
      }
    }

    if (!allowAuxiliary) return unresolved('exact_identity_lookup_deferred')

    const cached = this.#unknownCache.get(bbrefId)
    if (cached) return cached
    const pending = this.#unknownResolverOverride
      ? this.#unknownResolverOverride(bbrefId, season, sql, signal)
      : this.#resolveUnknown(bbrefId, season, sql, signal)
    this.#unknownCache.set(bbrefId, pending)
    return pending
  }

  async #resolveUnknown(
    bbrefId: string,
    season: number,
    sql: SqlClient,
    signal?: AbortSignal,
  ): Promise<CurrentIdentityResolution> {
    signal?.throwIfAborted()
    try {
      const [existing] = await sql<ExactIdentityOverlayRow[]>`
        SELECT
          bbref_id,
          chadwick_key,
          mlbam_id::text AS mlbam_id,
          first_mlb_season,
          evidence_method,
          source_url,
          retrieved_at,
          response_sha256,
          raw_record_id
        FROM core.mlb_exact_identity_overlay
        WHERE bbref_id = ${bbrefId}
        LIMIT 1
      `
      if (existing) {
        return resolutionFromOverlay(
          existing,
          this.#crosswalk,
          this.#chadwickLookup,
        )
      }

      if (this.#exactFetches >= BASEBALL_REFERENCE_EXACT_IDENTITY_MAX_FETCHES) {
        return unresolved('exact_page_fetch_limit_reached')
      }
      const now = Date.now()
      this.#identityBudgetStartedAt ??= now
      const elapsed = now - this.#identityBudgetStartedAt
      const remaining = BASEBALL_REFERENCE_EXACT_IDENTITY_BUDGET_MS - elapsed
      const crawlWait = Math.max(
        0,
        (this.#lastBaseballReferenceRequestAt ?? now - CRAWL_DELAY_MS) +
          CRAWL_DELAY_MS - now,
      )
      if (remaining <= crawlWait + 1_000) {
        return unresolved('exact_page_fetch_budget_exhausted')
      }

      const budgetSignal = AbortSignal.timeout(remaining)
      const requestSignal = signal
        ? AbortSignal.any([signal, budgetSignal])
        : budgetSignal
      try {
        await abortableDelay(crawlWait, requestSignal)
        signal?.throwIfAborted()
        this.#exactFetches += 1
        this.noteBaseballReferenceRequest()
        return await this.#fetchPersistAndObserve(
          bbrefId,
          season,
          sql,
          requestSignal,
        )
      } catch (error) {
        signal?.throwIfAborted()
        if (budgetSignal.aborted) {
          return unresolved('exact_page_fetch_budget_exhausted')
        }
        const message = error instanceof Error ? error.message : 'unknown error'
        console.warn(`Exact identity lookup left ${bbrefId} unresolved: ${message}`)
        return unresolved('exact_page_evidence_unavailable')
      }
    } catch (error) {
      signal?.throwIfAborted()
      const message = error instanceof Error ? error.message : 'unknown error'
      console.warn(`Exact identity overlay lookup left ${bbrefId} unresolved: ${message}`)
      return unresolved('exact_identity_auxiliary_failure')
    }
  }

  async #fetchPersistAndObserve(
    bbrefId: string,
    season: number,
    sql: SqlClient,
    signal: AbortSignal,
  ): Promise<CurrentIdentityResolution> {
    const url = normalizeRequestUrl(baseballReferencePlayerUrl(bbrefId))
    const response = await fetchWithRetry(url, {
      attempts: BASEBALL_REFERENCE_EXACT_IDENTITY_FETCH_ATTEMPTS,
      sourceName: 'Baseball-Reference exact identity page',
      signal,
      timeoutMs: BASEBALL_REFERENCE_EXACT_IDENTITY_REQUEST_TIMEOUT_MS,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'identity',
        'User-Agent': USER_AGENT,
      },
    })
    const finalUrl = normalizeRequestUrl(response.url || url)
    if (response.redirected || finalUrl !== url) {
      throw new Error(`Unexpected Baseball-Reference player-page redirect to ${finalUrl}`)
    }
    const mediaType = response.headers.get('content-type') ?? 'text/html'
    if (!mediaType.toLowerCase().includes('text/html')) {
      throw new Error(`Unexpected Baseball-Reference player-page type: ${mediaType}`)
    }
    const { body, byteLength } = await readExactIdentityPageText(response, signal)
    signal.throwIfAborted()
    const page: ExactPageLanding = {
      body,
      byteLength,
      mediaType,
      response,
      responseHash: sha256(body),
      retrievedAt: new Date(),
      metadata: parseExactPlayerPageMetadata(body, bbrefId),
    }
    const chadwickKey = page.metadata.chadwickKey
    const mlbamId = chadwickKey === null
      ? null
      : this.#chadwickLookup.byKeyPerson(chadwickKey)
    const staticMlbamIdentity = mlbamId === null
      ? null
      : this.#crosswalk.byMlbam(mlbamId)
    const firstMlbSeason = mlbamId === null
      ? null
      : exactPageFirstMlbSeason(this.#crosswalk, bbrefId, mlbamId, season)
    const metadataStatus = chadwickKey === null
      ? 'missing_sr_chadwick_id'
      : mlbamId === null
        ? 'chadwick_key_absent_from_pinned_lookup'
        : firstMlbSeason === null
          ? 'static_mlbam_bbref_conflict'
          : 'resolved'
    const record = {
      bbref_id: bbrefId,
      chadwick_key: chadwickKey,
      mlbam_id: mlbamId,
      first_mlb_season: firstMlbSeason,
      source_url: url,
      canonical_url: page.metadata.canonicalUrl,
      retrieved_at: page.retrievedAt.toISOString(),
      response_sha256: page.responseHash,
      identity_policy: MLB_EXACT_IDENTITY_POLICY,
      evidence_method: 'bref_page_meta_pinned_chadwick',
      metadata_status: metadataStatus,
      chadwick_lookup: {
        schemaVersion: this.#chadwickLookup.summary.schemaVersion,
        asOf: this.#chadwickLookup.summary.asOf,
        sourceLockSha256:
          this.#chadwickLookup.summary.source.chadwickRegister.sourceLockSha256,
      },
      static_crosswalk: {
        schemaVersion: this.#crosswalk.summary.schemaVersion,
        asOf: this.#crosswalk.summary.asOf,
        matchedMlbamRecord: staticMlbamIdentity,
      },
    }
    const landingHash = sha256(
      `${page.responseHash}:${stableStringify({
        parserVersion: BASEBALL_REFERENCE_EXACT_IDENTITY_PARSER_VERSION,
        evidenceMethod: 'bref_page_meta_pinned_chadwick',
        identityPolicy: MLB_EXACT_IDENTITY_POLICY,
        chadwickKey,
        mlbamId,
        firstMlbSeason,
        chadwickLookup: record.chadwick_lookup,
        staticCrosswalk: record.static_crosswalk,
      })}`,
    )
    const landingIdempotencyKey = idempotencyKey(url, landingHash)
    await persistRawLanding(sql, {
      signal,
      sourceSlug: 'sports-reference',
      datasetKey: 'baseball-exact-identity-pages',
      idempotencyKey: landingIdempotencyKey,
      mode: 'incremental',
      requestedAsOf: page.retrievedAt,
      parserVersion: BASEBALL_REFERENCE_EXACT_IDENTITY_PARSER_VERSION,
      parameters: {
        request: sanitizedRequest(url),
        bbrefId,
        observedCurrentValueSeason: season,
        identityPolicy: MLB_EXACT_IDENTITY_POLICY,
      },
      counts: {
        rows: 1,
        resolved: mlbamId === null ? 0 : 1,
        schema: schemaFingerprint([record]),
      },
      fetchedAt: page.retrievedAt,
      request: {
        sanitized: sanitizedRequest(url),
        fingerprint: requestFingerprint(url),
      },
      response: {
        sha256: page.responseHash,
        byteLength: page.byteLength,
        mediaType: page.mediaType,
        contentEncoding: page.response.headers.get('content-encoding'),
        statusCode: page.response.status,
        etag: page.response.headers.get('etag'),
        lastModified: page.response.headers.get('last-modified'),
        headers: safeResponseHeaders(page.response),
        bodyText: page.body,
      },
      records: [{
        record,
        recordType: 'baseball_reference_exact_identity',
        sourceRecordKey: exactIdentitySourceRecordKey(bbrefId),
        recordSha256: sha256(stableStringify(record)),
      }],
    })
    signal.throwIfAborted()
    if (chadwickKey === null) return unresolved('sr_chadwick_id_metadata_absent')
    if (mlbamId === null) return unresolved('chadwick_key_absent_from_pinned_lookup')
    if (firstMlbSeason === null) return unresolved('static_mlbam_bbref_conflict')

    const rawEvidence = await exactIdentityRawEvidence(
      sql,
      'baseball-exact-identity-pages',
      landingIdempotencyKey,
      'baseball_reference_exact_identity',
      exactIdentitySourceRecordKey(bbrefId),
    )
    const overlay = await observeExactIdentityOverlay(sql, {
      bbrefId,
      chadwickKey,
      mlbamId,
      firstMlbSeason,
      evidenceMethod: 'bref_page_meta_pinned_chadwick',
      sourceUrl: url,
      retrievedAt: rawEvidence.retrievedAt,
      responseSha256: rawEvidence.responseSha256,
      rawRecordId: rawEvidence.rawRecordId,
    })
    return {
      mlbamId,
      status: 'resolved_page_meta',
      evidence: {
        method: 'bref_page_meta_pinned_chadwick',
        identityPolicy: MLB_EXACT_IDENTITY_POLICY,
        chadwickKey,
        sourceUrl: url,
        retrievedAt: overlay.retrieved_at.toISOString(),
        responseSha256: overlay.response_sha256,
        rawRecordId: overlay.raw_record_id,
        chadwickLookupAsOf: this.#chadwickLookup.summary.asOf,
        chadwickSourceLockSha256:
          this.#chadwickLookup.summary.source.chadwickRegister.sourceLockSha256,
        firstMlbSeason,
        seasonEvidence: staticMlbamIdentity?.seasonEvidence ?? 'current-value-page',
      },
      unresolvedReason: null,
      needsCurrentValueOverlay: false,
    }
  }
}

async function persistCurrentValueOverlayCandidates(
  sql: SqlClient,
  candidates: Array<{
    row: EnrichedCurrentValueRow
    resolution: CurrentIdentityResolution
  }>,
  input: {
    url: string
    landingIdempotencyKey: string
  },
  signal?: AbortSignal,
): Promise<void> {
  for (const { row, resolution } of candidates) {
    if (signal?.aborted) return
    if (!resolution.needsCurrentValueOverlay || resolution.mlbamId === null) continue
    const chadwickKey = resolution.evidence?.chadwickKey
    if (!chadwickKey) continue
    try {
      const rawEvidence = await exactIdentityRawEvidence(
        sql,
        'baseball-player-records',
        input.landingIdempotencyKey,
        `current_value_${row.side}`,
        enrichedCurrentValueSourceRecordKey(row),
      )
      await observeExactIdentityOverlay(sql, {
        bbrefId: row.bbref_id,
        chadwickKey,
        mlbamId: resolution.mlbamId,
        firstMlbSeason: row.season,
        evidenceMethod: 'committed_crosswalk_current_value',
        sourceUrl: input.url,
        retrievedAt: rawEvidence.retrievedAt,
        responseSha256: rawEvidence.responseSha256,
        rawRecordId: rawEvidence.rawRecordId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      console.warn(
        `Current-value identity overlay left ${row.bbref_id} unpersisted: ${message}`,
      )
    }
  }
}

function enrichCurrentValueRow(
  row: ValueSeasonRow,
  resolution: CurrentIdentityResolution,
  fetchedAt: Date,
): EnrichedCurrentValueRow {
  return {
    ...row,
    mlbam_id: resolution.mlbamId,
    mlbam_identity_status: resolution.status,
    mlbam_identity_evidence: resolution.evidence,
    mlbam_identity_unresolved_reason: resolution.unresolvedReason,
    mlbam_identity_overlay_method: resolution.needsCurrentValueOverlay
      ? 'committed_crosswalk_current_value'
      : null,
    mlbam_identity_overlay_policy: MLB_EXACT_IDENTITY_POLICY,
    mlbam_identity_retrieved_at: fetchedAt.toISOString(),
  }
}

async function persistCurrentSideLanding(
  sql: SqlClient,
  context: CurrentSideLandingContext,
  resolvedRows: Array<{
    row: EnrichedCurrentValueRow
    resolution: CurrentIdentityResolution
  }>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const enrichedRows = resolvedRows.map(({ row }) => row)
  const sourceRows = enrichedRows.map(
    (row) => row as unknown as Record<string, unknown>,
  )
  const keys = disambiguateSourceRecordKeys(sourceRows, (row) =>
    enrichedCurrentValueSourceRecordKey(
      row as unknown as EnrichedCurrentValueRow,
    ),
  )
  const records = enrichedRows.map((row, index) => ({
    record: row as unknown as Record<string, unknown>,
    recordType: `current_value_${context.side}`,
    sourceRecordKey: keys[index],
    recordSha256: sha256(stableStringify(row)),
  }))
  const identityCounts = Object.fromEntries(
    [
      'resolved_crosswalk',
      'resolved_overlay',
      'resolved_page_meta',
      'unresolved',
    ].map((status) => [
      status,
      enrichedRows.filter((row) => row.mlbam_identity_status === status).length,
    ]),
  )
  const identityMappingHash = sha256(stableStringify({
    policy: MLB_EXACT_IDENTITY_POLICY,
    parserVersion: BASEBALL_REFERENCE_CURRENT_PARSER_VERSION,
    mappings: enrichedRows.map((row) => ({
      bbrefId: row.bbref_id,
      mlbamId: row.mlbam_id,
      status: row.mlbam_identity_status,
      unresolvedReason: row.mlbam_identity_unresolved_reason,
      overlayMethod: row.mlbam_identity_overlay_method,
      evidence: row.mlbam_identity_evidence,
    })),
  }))
  const landingIdempotencyKey = idempotencyKey(
    context.url,
    sha256(`${context.responseHash}:${identityMappingHash}`),
  )
  const landing = await persistRawLanding(sql, {
    signal,
    sourceSlug: 'sports-reference',
    datasetKey: 'baseball-player-records',
    idempotencyKey: landingIdempotencyKey,
    mode: 'incremental',
    requestedAsOf: context.fetchedAt,
    parserVersion: BASEBALL_REFERENCE_CURRENT_PARSER_VERSION,
    parameters: {
      request: sanitizedRequest(context.url),
      season: context.season,
      side: context.side,
      seasonState: 'in_season',
      currentIdentity: {
        policy: MLB_EXACT_IDENTITY_POLICY,
        mappingSha256: identityMappingHash,
        ...identityCounts,
      },
      ...(context.cardinalityGate
        ? { currentRefreshCardinality: context.cardinalityGate }
        : {}),
    },
    counts: {
      rows: context.rows.length,
      schema: schemaFingerprint(records.map((record) => record.record)),
      currentIdentity: identityCounts,
      ...(context.cardinalityGate
        ? { currentRefreshCardinality: context.cardinalityGate }
        : {}),
    },
    fetchedAt: context.fetchedAt,
    request: {
      sanitized: sanitizedRequest(context.url),
      fingerprint: requestFingerprint(context.url),
    },
    response: {
      sha256: context.responseHash,
      byteLength: Buffer.byteLength(context.body, 'utf8'),
      mediaType: context.mediaType,
      contentEncoding: context.contentEncoding,
      statusCode: context.statusCode,
      etag: context.etag,
      lastModified: context.lastModified,
      headers: context.responseHeaders,
      bodyText: context.body,
    },
    records,
  })
  return { landing, landingIdempotencyKey }
}

async function ingestSide(
  season: number,
  side: ValueSide,
  enforceCurrentCardinality: boolean,
  identityResolver: CurrentMlbIdentityResolver,
  signal?: AbortSignal,
): Promise<IngestedCurrentSide> {
  signal?.throwIfAborted()
  const url = normalizeRequestUrl(baseballReferenceCurrentValueUrl(season, side))
  const response = await fetchWithRetry(url, {
    attempts: BASEBALL_REFERENCE_CURRENT_FETCH_ATTEMPTS,
    sourceName: 'Baseball-Reference',
    signal,
    timeoutMs: 60_000,
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Encoding': 'identity',
      'User-Agent': USER_AGENT,
    },
  })
  identityResolver.noteBaseballReferenceRequest()
  const finalUrl = normalizeRequestUrl(response.url || url)
  if (finalUrl !== url) throw new Error(`Unexpected Baseball-Reference redirect to ${finalUrl}`)
  const mediaType = response.headers.get('content-type') ?? 'text/html'
  if (!mediaType.toLowerCase().includes('text/html')) {
    throw new Error(`Unexpected Baseball-Reference content type: ${mediaType}`)
  }
  const body = await response.text()
  signal?.throwIfAborted()
  const rows = parseValueSeasonPage(body, season, side)
  const fetchedAt = new Date()
  const responseHash = sha256(body)
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions())

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
    const context: CurrentSideLandingContext = {
      season,
      side,
      url,
      body,
      mediaType,
      contentEncoding: response.headers.get('content-encoding'),
      statusCode: response.status,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      responseHeaders: safeResponseHeaders(response),
      fetchedAt,
      responseHash,
      rows,
      cardinalityGate,
    }
    const resolvedRows: Array<{
      row: EnrichedCurrentValueRow
      resolution: CurrentIdentityResolution
    }> = []
    for (const row of rows) {
      signal?.throwIfAborted()
      const resolution = await identityResolver.resolve(
        row.bbref_id,
        season,
        sql,
        signal,
        false,
      )
      resolvedRows.push({
        row: enrichCurrentValueRow(row, resolution, fetchedAt),
        resolution,
      })
    }
    const persisted = await persistCurrentSideLanding(
      sql,
      context,
      resolvedRows,
      signal,
    )
    return {
      result: { status: persisted.landing.status, rows: rows.length },
      context,
      landingIdempotencyKey: persisted.landingIdempotencyKey,
      resolvedRows,
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function enrichDeferredCurrentSide(
  ingested: IngestedCurrentSide,
  identityResolver: CurrentMlbIdentityResolver,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions(5_000))
  try {
    if (ingested.result.status === 'in_progress') return
    await persistCurrentValueOverlayCandidates(
      sql,
      ingested.resolvedRows,
      {
        url: ingested.context.url,
        landingIdempotencyKey: ingested.landingIdempotencyKey,
      },
      signal,
    )
    if (signal?.aborted) return
    const enrichedRows = [] as IngestedCurrentSide['resolvedRows']
    let newlyResolved = 0
    for (const initial of ingested.resolvedRows) {
      if (initial.resolution.mlbamId !== null) {
        enrichedRows.push(initial)
        continue
      }
      let resolution: CurrentIdentityResolution
      try {
        resolution = await identityResolver.resolve(
          initial.row.bbref_id,
          ingested.context.season,
          sql,
          signal,
          true,
        )
      } catch (error) {
        if (signal?.aborted) return
        const message = error instanceof Error ? error.message : 'unknown error'
        console.warn(
          `Deferred exact identity lookup left ${initial.row.bbref_id} unresolved: ${message}`,
        )
        resolution = initial.resolution
      }
      if (resolution.mlbamId !== null) newlyResolved += 1
      enrichedRows.push({
        row: enrichCurrentValueRow(
          initial.row,
          resolution,
          ingested.context.fetchedAt,
        ),
        resolution,
      })
    }
    if (newlyResolved === 0 || signal?.aborted) return
    await persistCurrentSideLanding(
      sql,
      ingested.context,
      enrichedRows,
      signal,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.warn(`Deferred exact identity enrichment did not re-land stats: ${message}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export async function ingestBaseballReferenceCurrentSeason(
  season: number,
  options: { enforceCurrentCardinality?: boolean; signal?: AbortSignal } = {},
): Promise<BaseballReferenceCurrentResult> {
  const startedAt = Date.now()
  const enforceCurrentCardinality = options.enforceCurrentCardinality ?? false
  const identityResolver = new CurrentMlbIdentityResolver()
  const batting = await ingestSide(
    season,
    'batting',
    enforceCurrentCardinality,
    identityResolver,
    options.signal,
  )
  await abortableDelay(CRAWL_DELAY_MS, options.signal)
  const pitching = await ingestSide(
    season,
    'pitching',
    enforceCurrentCardinality,
    identityResolver,
    options.signal,
  )
  const auxiliaryBudgetMs = exactIdentityPostCoreBudgetMs(Date.now() - startedAt)
  if (auxiliaryBudgetMs > 0 && !options.signal?.aborted) {
    const localAuxiliarySignal = AbortSignal.timeout(auxiliaryBudgetMs)
    const auxiliarySignal = options.signal
      ? AbortSignal.any([options.signal, localAuxiliarySignal])
      : localAuxiliarySignal
    await enrichDeferredCurrentSide(batting, identityResolver, auxiliarySignal)
    await enrichDeferredCurrentSide(pitching, identityResolver, auxiliarySignal)
  }
  return { season, batting: batting.result, pitching: pitching.result }
}
