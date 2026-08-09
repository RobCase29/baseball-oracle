import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import {
  SPOTRAC_CONTRACT_PARSER_VERSION,
  parseSpotracPlayerSourceUrl,
} from './spotrac-contract-parser.js'
import {
  SPOTRAC_CONTRACT_LIST_PARSER_VERSION,
  parseSpotracContractListSourceUrl,
} from './spotrac-contract-list-parser.js'
import {
  SPOTRAC_ROBOTS_POLICY_PARSER_VERSION,
  parseSpotracRobotsPolicy,
} from './spotrac-robots.js'

export const SPOTRAC_PAGE_CACHE_SCHEMA_VERSION =
  'spotrac-player-page-cache/v1' as const
export const SPOTRAC_ROBOTS_CACHE_SCHEMA_VERSION =
  'spotrac-robots-cache/v1' as const
export const SPOTRAC_ROBOTS_POLICY_URL =
  'https://www.spotrac.com/robots.txt' as const
export const SPOTRAC_USER_AGENT =
  'BaseballOracleTeamRunway/1.0 (+authorized research; contact project owner)'
export const SPOTRAC_MIN_REQUEST_INTERVAL_MS = 5_000
export const SPOTRAC_DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1_000
export const SPOTRAC_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
export const SPOTRAC_ROBOTS_CACHE_TTL_MS = 60 * 60 * 1_000
export const SPOTRAC_MAX_ROBOTS_BYTES = 1024 * 1024

interface SpotracPageCacheMetadata {
  schemaVersion: typeof SPOTRAC_PAGE_CACHE_SCHEMA_VERSION
  parserVersion:
    | typeof SPOTRAC_CONTRACT_PARSER_VERSION
    | typeof SPOTRAC_CONTRACT_LIST_PARSER_VERSION
  sourceUrl: string
  retrievedAt: string
  etag: string | null
  lastModified: string | null
  contentType: string
  byteLength: number
  contentSha256: string
}

interface VerifiedCacheEntry {
  metadata: SpotracPageCacheMetadata
  html: string
}

interface SpotracRobotsCacheMetadata {
  schemaVersion: typeof SPOTRAC_ROBOTS_CACHE_SCHEMA_VERSION
  parserVersion: typeof SPOTRAC_ROBOTS_POLICY_PARSER_VERSION
  sourceUrl: typeof SPOTRAC_ROBOTS_POLICY_URL
  retrievedAt: string
  etag: string | null
  lastModified: string | null
  contentType: string
  byteLength: number
  contentSha256: string
}

interface VerifiedRobotsCacheEntry {
  metadata: SpotracRobotsCacheMetadata
  body: string
}

export interface SpotracPageResult {
  sourceUrl: string
  retrievedAt: string
  html: string
  contentSha256: string
  cacheStatus: 'hit' | 'downloaded' | 'revalidated'
}

export interface SpotracRobotsAuthorization {
  policyUrl: typeof SPOTRAC_ROBOTS_POLICY_URL
  parserVersion: typeof SPOTRAC_ROBOTS_POLICY_PARSER_VERSION
  retrievedAt: string
  contentSha256: string
  cacheStatus: 'hit' | 'downloaded' | 'revalidated'
  userAgent: typeof SPOTRAC_USER_AGENT
  userAgentProduct: string
  policyCrawlDelayMs: number | null
  effectiveMinimumRequestIntervalMs: number
  evaluatedUrls: string[]
}

export interface SpotracPageClientOptions {
  cacheDirectory: string
  fetchImpl?: typeof fetch
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
  minimumRequestIntervalMs?: number
  cacheTtlMs?: number
  robotsCacheTtlMs?: number
  maxAttempts?: number
}

export class SpotracPageRequestError extends Error {
  readonly code: string
  readonly status: number | null

  constructor(code: string, message: string, status: number | null = null) {
    super(message)
    this.name = 'SpotracPageRequestError'
    this.code = code
    this.status = status
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class SpotracRequestPacer {
  private tail: Promise<void> = Promise.resolve()
  private lastStartedAt = Number.NEGATIVE_INFINITY
  private minimumIntervalMs: number

  constructor(
    minimumIntervalMs = SPOTRAC_MIN_REQUEST_INTERVAL_MS,
    private readonly clock: () => number = Date.now,
    private readonly sleep: (milliseconds: number) => Promise<void> =
      defaultSleep,
  ) {
    if (
      !Number.isFinite(minimumIntervalMs) ||
      minimumIntervalMs < 0
    ) {
      throw new Error('Spotrac request interval must be non-negative.')
    }
    this.minimumIntervalMs = minimumIntervalMs
  }

  getMinimumInterval(): number {
    return this.minimumIntervalMs
  }

  ensureMinimumInterval(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error('Spotrac request interval must be non-negative.')
    }
    this.minimumIntervalMs = Math.max(
      this.minimumIntervalMs,
      milliseconds,
    )
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const delay = Math.max(
        0,
        this.lastStartedAt + this.minimumIntervalMs - this.clock(),
      )
      if (delay > 0) await this.sleep(delay)
      this.lastStartedAt = this.clock()
      return operation()
    })
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function cachePaths(
  cacheDirectory: string,
  sourceUrl: string,
): { body: string; metadata: string } {
  const key = sha256(sourceUrl)
  return {
    body: path.join(cacheDirectory, `${key}.html`),
    metadata: path.join(cacheDirectory, `${key}.json`),
  }
}

function robotsCachePaths(
  cacheDirectory: string,
): { body: string; metadata: string } {
  const key = sha256(SPOTRAC_ROBOTS_POLICY_URL)
  return {
    body: path.join(cacheDirectory, `${key}.robots.txt`),
    metadata: path.join(cacheDirectory, `${key}.robots.json`),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseMetadata(
  value: unknown,
  expectedUrl: string,
  expectedParserVersion: SpotracPageCacheMetadata['parserVersion'],
): SpotracPageCacheMetadata {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SPOTRAC_PAGE_CACHE_SCHEMA_VERSION ||
    value.parserVersion !== expectedParserVersion ||
    value.sourceUrl !== expectedUrl ||
    typeof value.retrievedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.retrievedAt)) ||
    (
      value.etag !== null &&
      typeof value.etag !== 'string'
    ) ||
    (
      value.lastModified !== null &&
      typeof value.lastModified !== 'string'
    ) ||
    typeof value.contentType !== 'string' ||
    !value.contentType.toLocaleLowerCase('en-US').includes('text/html') ||
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) < 1 ||
    typeof value.contentSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.contentSha256)
  ) {
    throw new SpotracPageRequestError(
      'invalid_cache_metadata',
      'Spotrac cache metadata failed validation.',
    )
  }
  return value as unknown as SpotracPageCacheMetadata
}

async function readVerifiedCache(
  cacheDirectory: string,
  sourceUrl: string,
  parserVersion: SpotracPageCacheMetadata['parserVersion'],
): Promise<VerifiedCacheEntry | null> {
  const paths = cachePaths(cacheDirectory, sourceUrl)
  let metadataBody: string
  let html: string
  try {
    [metadataBody, html] = await Promise.all([
      readFile(paths.metadata, 'utf8'),
      readFile(paths.body, 'utf8'),
    ])
  } catch (error) {
    if (
      isRecord(error) &&
      error.code === 'ENOENT'
    ) {
      return null
    }
    throw error
  }
  const metadata = parseMetadata(
    JSON.parse(metadataBody),
    sourceUrl,
    parserVersion,
  )
  const bytes = new TextEncoder().encode(html)
  if (
    bytes.byteLength !== metadata.byteLength ||
    sha256(bytes) !== metadata.contentSha256
  ) {
    throw new SpotracPageRequestError(
      'cache_integrity_failure',
      'Spotrac cached response failed its byte-length or SHA-256 check.',
    )
  }
  return { metadata, html }
}

function parseRobotsMetadata(value: unknown): SpotracRobotsCacheMetadata {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SPOTRAC_ROBOTS_CACHE_SCHEMA_VERSION ||
    value.parserVersion !== SPOTRAC_ROBOTS_POLICY_PARSER_VERSION ||
    value.sourceUrl !== SPOTRAC_ROBOTS_POLICY_URL ||
    typeof value.retrievedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.retrievedAt)) ||
    (
      value.etag !== null &&
      typeof value.etag !== 'string'
    ) ||
    (
      value.lastModified !== null &&
      typeof value.lastModified !== 'string'
    ) ||
    typeof value.contentType !== 'string' ||
    !value.contentType.toLocaleLowerCase('en-US').includes('text/plain') ||
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) < 1 ||
    (value.byteLength as number) > SPOTRAC_MAX_ROBOTS_BYTES ||
    typeof value.contentSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.contentSha256)
  ) {
    throw new SpotracPageRequestError(
      'invalid_robots_cache_metadata',
      'Spotrac robots cache metadata failed validation.',
    )
  }
  return value as unknown as SpotracRobotsCacheMetadata
}

async function readVerifiedRobotsCache(
  cacheDirectory: string,
): Promise<VerifiedRobotsCacheEntry | null> {
  const paths = robotsCachePaths(cacheDirectory)
  let metadataBody: string
  let body: string
  try {
    [metadataBody, body] = await Promise.all([
      readFile(paths.metadata, 'utf8'),
      readFile(paths.body, 'utf8'),
    ])
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return null
    throw error
  }
  let metadataValue: unknown
  try {
    metadataValue = JSON.parse(metadataBody)
  } catch {
    throw new SpotracPageRequestError(
      'invalid_robots_cache_metadata',
      'Spotrac robots cache metadata is not valid JSON.',
    )
  }
  const metadata = parseRobotsMetadata(metadataValue)
  const bytes = new TextEncoder().encode(body)
  if (
    bytes.byteLength !== metadata.byteLength ||
    sha256(bytes) !== metadata.contentSha256
  ) {
    throw new SpotracPageRequestError(
      'robots_cache_integrity_failure',
      'Spotrac cached robots policy failed its integrity check.',
    )
  }
  return { metadata, body }
}

async function atomicWrite(
  destination: string,
  body: string,
): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.tmp`
  await writeFile(temporary, body, 'utf8')
  await rename(temporary, destination)
}

async function persistCache(
  cacheDirectory: string,
  metadata: SpotracPageCacheMetadata,
  html: string,
): Promise<void> {
  await mkdir(cacheDirectory, { recursive: true })
  const paths = cachePaths(cacheDirectory, metadata.sourceUrl)
  await atomicWrite(paths.body, html)
  await atomicWrite(paths.metadata, `${JSON.stringify(metadata)}\n`)
}

async function persistRobotsCache(
  cacheDirectory: string,
  metadata: SpotracRobotsCacheMetadata,
  body: string,
): Promise<void> {
  await mkdir(cacheDirectory, { recursive: true })
  const paths = robotsCachePaths(cacheDirectory)
  await atomicWrite(paths.body, body)
  await atomicWrite(paths.metadata, `${JSON.stringify(metadata)}\n`)
}

function retryAfterMilliseconds(
  response: Response,
  now: Date,
): number | null {
  const value = response.headers.get('retry-after')
  if (!value) return null
  if (/^\d+$/u.test(value)) return Number(value) * 1_000
  const until = Date.parse(value)
  return Number.isFinite(until)
    ? Math.max(0, until - now.valueOf())
    : null
}

function assertResponseBody(html: string): void {
  const lower = html.toLocaleLowerCase('en-US')
  if (
    lower.includes('403 error') ||
    lower.includes('request blocked') ||
    lower.includes('update your browser — spotrac') ||
    lower.includes("your browser isn't supported") ||
    lower.includes('captcha')
  ) {
    throw new SpotracPageRequestError(
      'blocked_response',
      'Spotrac returned a block or unsupported-browser page.',
    )
  }
}

export function createSpotracPageClient(
  options: SpotracPageClientOptions,
): {
  getPlayerPage: (sourceUrl: string) => Promise<SpotracPageResult>
  authorizeTeamContractListPages: (
    sourceUrls: readonly string[],
  ) => Promise<SpotracRobotsAuthorization>
  getTeamContractListPage: (
    sourceUrl: string,
  ) => Promise<SpotracPageResult>
} {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date())
  const sleep = options.sleep ?? defaultSleep
  const cacheTtlMs =
    options.cacheTtlMs ?? SPOTRAC_DEFAULT_CACHE_TTL_MS
  const robotsCacheTtlMs =
    options.robotsCacheTtlMs ?? SPOTRAC_ROBOTS_CACHE_TTL_MS
  const maxAttempts = options.maxAttempts ?? 3
  if (
    !Number.isFinite(cacheTtlMs) ||
    cacheTtlMs < 0 ||
    !Number.isFinite(robotsCacheTtlMs) ||
    robotsCacheTtlMs < 0 ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 3
  ) {
    throw new Error('Spotrac page client options are invalid.')
  }
  const pacer = new SpotracRequestPacer(
    options.minimumRequestIntervalMs,
    () => now().valueOf(),
    sleep,
  )
  let authorizedTeamUrls = new Set<string>()

  async function getRobotsPolicy(): Promise<{
    body: string
    retrievedAt: string
    contentSha256: string
    cacheStatus: 'hit' | 'downloaded' | 'revalidated'
  }> {
    const cache = await readVerifiedRobotsCache(options.cacheDirectory)
    if (
      cache &&
      now().valueOf() - Date.parse(cache.metadata.retrievedAt) <=
        robotsCacheTtlMs
    ) {
      return {
        body: cache.body,
        retrievedAt: cache.metadata.retrievedAt,
        contentSha256: cache.metadata.contentSha256,
        cacheStatus: 'hit',
      }
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const headers = new Headers({
        Accept: 'text/plain',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': SPOTRAC_USER_AGENT,
      })
      if (cache?.metadata.etag) {
        headers.set('If-None-Match', cache.metadata.etag)
      }
      if (cache?.metadata.lastModified) {
        headers.set('If-Modified-Since', cache.metadata.lastModified)
      }

      let response: Response
      try {
        response = await pacer.run(() => fetchImpl(
          SPOTRAC_ROBOTS_POLICY_URL,
          {
            method: 'GET',
            headers,
            redirect: 'follow',
          },
        ))
      } catch (error) {
        if (attempt < maxAttempts) {
          await sleep(Math.min(10_000, 1_000 * (2 ** (attempt - 1))))
          continue
        }
        throw new SpotracPageRequestError(
          'robots_network_failure',
          `Spotrac robots request failed after ${maxAttempts} bounded ` +
          `attempts: ${
            error instanceof Error ? error.message : 'unknown network error'
          }.`,
        )
      }

      if (response.status === 304 && cache) {
        const metadata: SpotracRobotsCacheMetadata = {
          ...cache.metadata,
          retrievedAt: now().toISOString(),
          etag: response.headers.get('etag') ?? cache.metadata.etag,
          lastModified:
            response.headers.get('last-modified') ??
            cache.metadata.lastModified,
        }
        await persistRobotsCache(
          options.cacheDirectory,
          metadata,
          cache.body,
        )
        return {
          body: cache.body,
          retrievedAt: metadata.retrievedAt,
          contentSha256: metadata.contentSha256,
          cacheStatus: 'revalidated',
        }
      }

      if (response.status === 429 || response.status === 503) {
        const retryAfter = retryAfterMilliseconds(response, now())
        if (
          attempt < maxAttempts &&
          retryAfter !== null &&
          retryAfter <= 60_000
        ) {
          await sleep(retryAfter)
          continue
        }
        throw new SpotracPageRequestError(
          'robots_rate_limited',
          `Spotrac robots.txt returned ${response.status}; stop and retry later.`,
          response.status,
        )
      }
      if (response.status !== 200) {
        throw new SpotracPageRequestError(
          'robots_unavailable',
          `Spotrac robots.txt returned unexpected status ${response.status}.`,
          response.status,
        )
      }

      if (response.url) {
        const finalUrl = new URL(response.url)
        const hostname = finalUrl.hostname.toLocaleLowerCase('en-US')
        if (
          finalUrl.protocol !== 'https:' ||
          !['spotrac.com', 'www.spotrac.com'].includes(hostname) ||
          finalUrl.pathname !== '/robots.txt' ||
          finalUrl.search ||
          finalUrl.hash
        ) {
          throw new SpotracPageRequestError(
            'robots_unexpected_redirect',
            'Spotrac robots.txt redirected outside its supported origin.',
            response.status,
          )
        }
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.toLocaleLowerCase('en-US').includes('text/plain')) {
        throw new SpotracPageRequestError(
          'robots_unexpected_content_type',
          'Spotrac robots response was not plain text.',
          response.status,
        )
      }
      const reportedLength = Number(response.headers.get('content-length'))
      if (
        Number.isFinite(reportedLength) &&
        reportedLength > SPOTRAC_MAX_ROBOTS_BYTES
      ) {
        throw new SpotracPageRequestError(
          'robots_response_too_large',
          'Spotrac robots response exceeds the configured byte limit.',
          response.status,
        )
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (
        bytes.byteLength < 1 ||
        bytes.byteLength > SPOTRAC_MAX_ROBOTS_BYTES
      ) {
        throw new SpotracPageRequestError(
          'robots_invalid_response_size',
          'Spotrac robots response size is outside the supported range.',
          response.status,
        )
      }
      const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const metadata: SpotracRobotsCacheMetadata = {
        schemaVersion: SPOTRAC_ROBOTS_CACHE_SCHEMA_VERSION,
        parserVersion: SPOTRAC_ROBOTS_POLICY_PARSER_VERSION,
        sourceUrl: SPOTRAC_ROBOTS_POLICY_URL,
        retrievedAt: now().toISOString(),
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        contentType,
        byteLength: bytes.byteLength,
        contentSha256: sha256(bytes),
      }
      await persistRobotsCache(options.cacheDirectory, metadata, body)
      return {
        body,
        retrievedAt: metadata.retrievedAt,
        contentSha256: metadata.contentSha256,
        cacheStatus: 'downloaded',
      }
    }
    throw new SpotracPageRequestError(
      'robots_request_exhausted',
      'Spotrac robots request attempts were exhausted.',
    )
  }

  async function authorizeTeamContractListPages(
    sourceUrls: readonly string[],
  ): Promise<SpotracRobotsAuthorization> {
    if (sourceUrls.length === 0) {
      throw new SpotracPageRequestError(
        'robots_empty_plan',
        'At least one Spotrac team URL is required for robots authorization.',
      )
    }
    const canonicalUrls = [...new Set(sourceUrls.map(
      (sourceUrl) => parseSpotracContractListSourceUrl(sourceUrl).canonicalUrl,
    ))]
    pacer.ensureMinimumInterval(SPOTRAC_MIN_REQUEST_INTERVAL_MS)
    const result = await getRobotsPolicy()
    const policy = parseSpotracRobotsPolicy(
      result.body,
      SPOTRAC_USER_AGENT,
    )
    for (const sourceUrl of canonicalUrls) {
      const url = new URL(sourceUrl)
      if (!policy.isAllowedPath(`${url.pathname}${url.search}`)) {
        throw new SpotracPageRequestError(
          'robots_disallowed',
          `Spotrac robots.txt disallows planned team page ${sourceUrl}.`,
        )
      }
    }

    const effectiveMinimumRequestIntervalMs = Math.max(
      SPOTRAC_MIN_REQUEST_INTERVAL_MS,
      pacer.getMinimumInterval(),
      policy.crawlDelayMs ?? 0,
    )
    pacer.ensureMinimumInterval(effectiveMinimumRequestIntervalMs)
    authorizedTeamUrls = new Set(canonicalUrls)
    return {
      policyUrl: SPOTRAC_ROBOTS_POLICY_URL,
      parserVersion: policy.parserVersion,
      retrievedAt: result.retrievedAt,
      contentSha256: result.contentSha256,
      cacheStatus: result.cacheStatus,
      userAgent: SPOTRAC_USER_AGENT,
      userAgentProduct: policy.userAgentProduct,
      policyCrawlDelayMs: policy.crawlDelayMs,
      effectiveMinimumRequestIntervalMs,
      evaluatedUrls: canonicalUrls,
    }
  }

  async function getPage(
    sourceUrl: string,
    parserVersion: SpotracPageCacheMetadata['parserVersion'],
    canonicalize: (value: string) => { canonicalUrl: string },
  ): Promise<SpotracPageResult> {
    const source = canonicalize(sourceUrl)
    const cache = await readVerifiedCache(
      options.cacheDirectory,
      source.canonicalUrl,
      parserVersion,
    )
    if (
      cache &&
      now().valueOf() - Date.parse(cache.metadata.retrievedAt) <= cacheTtlMs
    ) {
      return {
        sourceUrl: source.canonicalUrl,
        retrievedAt: cache.metadata.retrievedAt,
        html: cache.html,
        contentSha256: cache.metadata.contentSha256,
        cacheStatus: 'hit',
      }
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const headers = new Headers({
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': SPOTRAC_USER_AGENT,
      })
      if (cache?.metadata.etag) {
        headers.set('If-None-Match', cache.metadata.etag)
      }
      if (cache?.metadata.lastModified) {
        headers.set('If-Modified-Since', cache.metadata.lastModified)
      }
      let response: Response
      try {
        response = await pacer.run(() => fetchImpl(source.canonicalUrl, {
          method: 'GET',
          headers,
          redirect: 'follow',
        }))
      } catch (error) {
        if (attempt < maxAttempts) {
          await sleep(Math.min(10_000, 1_000 * (2 ** (attempt - 1))))
          continue
        }
        throw new SpotracPageRequestError(
          'network_failure',
          `Spotrac request failed after ${maxAttempts} bounded attempts: ${
            error instanceof Error ? error.message : 'unknown network error'
          }.`,
        )
      }

      if (response.status === 304 && cache) {
        const metadata = {
          ...cache.metadata,
          retrievedAt: now().toISOString(),
          etag: response.headers.get('etag') ?? cache.metadata.etag,
          lastModified:
            response.headers.get('last-modified') ??
            cache.metadata.lastModified,
        }
        await persistCache(options.cacheDirectory, metadata, cache.html)
        return {
          sourceUrl: source.canonicalUrl,
          retrievedAt: metadata.retrievedAt,
          html: cache.html,
          contentSha256: metadata.contentSha256,
          cacheStatus: 'revalidated',
        }
      }

      if (response.status === 429 || response.status === 503) {
        const retryAfter = retryAfterMilliseconds(response, now())
        if (
          attempt < maxAttempts &&
          retryAfter !== null &&
          retryAfter <= 60_000
        ) {
          await sleep(retryAfter)
          continue
        }
        throw new SpotracPageRequestError(
          'rate_limited',
          `Spotrac returned ${response.status}; stop and retry later.`,
          response.status,
        )
      }

      if (response.status !== 200) {
        throw new SpotracPageRequestError(
          'unexpected_status',
          `Spotrac returned unexpected status ${response.status}.`,
          response.status,
        )
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.toLocaleLowerCase('en-US').includes('text/html')) {
        throw new SpotracPageRequestError(
          'unexpected_content_type',
          'Spotrac response was not HTML.',
          response.status,
        )
      }
      const reportedLength = Number(response.headers.get('content-length'))
      if (
        Number.isFinite(reportedLength) &&
        reportedLength > SPOTRAC_MAX_RESPONSE_BYTES
      ) {
        throw new SpotracPageRequestError(
          'response_too_large',
          'Spotrac response exceeds the configured byte limit.',
          response.status,
        )
      }
      const body = new Uint8Array(await response.arrayBuffer())
      if (body.byteLength < 200 || body.byteLength > SPOTRAC_MAX_RESPONSE_BYTES) {
        throw new SpotracPageRequestError(
          'invalid_response_size',
          'Spotrac response size is outside the supported range.',
          response.status,
        )
      }
      const html = new TextDecoder().decode(body)
      assertResponseBody(html)
      const metadata: SpotracPageCacheMetadata = {
        schemaVersion: SPOTRAC_PAGE_CACHE_SCHEMA_VERSION,
        parserVersion,
        sourceUrl: source.canonicalUrl,
        retrievedAt: now().toISOString(),
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        contentType,
        byteLength: body.byteLength,
        contentSha256: sha256(body),
      }
      await persistCache(options.cacheDirectory, metadata, html)
      return {
        sourceUrl: source.canonicalUrl,
        retrievedAt: metadata.retrievedAt,
        html,
        contentSha256: metadata.contentSha256,
        cacheStatus: 'downloaded',
      }
    }
    throw new SpotracPageRequestError(
      'request_exhausted',
      'Spotrac request attempts were exhausted.',
    )
  }

  return {
    getPlayerPage: (sourceUrl) => getPage(
      sourceUrl,
      SPOTRAC_CONTRACT_PARSER_VERSION,
      parseSpotracPlayerSourceUrl,
    ),
    authorizeTeamContractListPages,
    getTeamContractListPage: async (sourceUrl) => {
      const source = parseSpotracContractListSourceUrl(sourceUrl)
      if (!authorizedTeamUrls.has(source.canonicalUrl)) {
        throw new SpotracPageRequestError(
          'robots_authorization_required',
          'Spotrac team pages require a current robots authorization.',
        )
      }
      return getPage(
        source.canonicalUrl,
        SPOTRAC_CONTRACT_LIST_PARSER_VERSION,
        parseSpotracContractListSourceUrl,
      )
    },
  }
}
