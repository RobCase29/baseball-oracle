import { createHash } from 'node:crypto'

export type SourceRecord = Record<string, unknown>

export interface RetryOptions {
  attempts?: number
  headers?: HeadersInit
  retryStatuses?: ReadonlySet<number>
  sourceName?: string
  timeoutMs?: number
}

const defaultRetryStatuses = new Set([429, 500, 502, 503, 504])

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function disambiguateSourceRecordKeys(
  records: SourceRecord[],
  sourceKey: (record: SourceRecord) => string,
): string[] {
  const seen = new Map<string, number>()
  return records.map((record) => {
    const base = sourceKey(record)
    const priorCount = seen.get(base) ?? 0
    seen.set(base, priorCount + 1)
    return priorCount === 0
      ? base
      : `${base}|duplicate:${priorCount + 1}:${sha256(stableStringify(record)).slice(0, 12)}`
  })
}

export function normalizeRequestUrl(input: string): string {
  const url = new URL(input)
  url.hash = ''
  url.searchParams.sort()
  return url.toString()
}

export function requestFingerprint(input: string): string {
  return sha256(normalizeRequestUrl(input))
}

export function schemaFingerprint(records: SourceRecord[]): string {
  const shape = new Map<string, Set<string>>()

  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      const valueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
      const types = shape.get(key) ?? new Set<string>()
      types.add(valueType)
      shape.set(key, types)
    }
  }

  const manifest = [...shape.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, types]) => [key, [...types].sort()])

  return sha256(JSON.stringify(manifest))
}

export function idempotencyKey(url: string, responseHash: string): string {
  return sha256(`${requestFingerprint(url)}:${responseHash}`)
}

export function sanitizedRequest(url: string): {
  method: string
  origin: string
  pathname: string
  query: Record<string, string>
} {
  const normalized = new URL(normalizeRequestUrl(url))
  return {
    method: 'GET',
    origin: normalized.origin,
    pathname: normalized.pathname,
    query: Object.fromEntries(normalized.searchParams.entries()),
  }
}

export function safeResponseHeaders(response: Response): Record<string, string> {
  const allowed = ['cache-control', 'content-type', 'content-encoding', 'etag', 'last-modified']
  return Object.fromEntries(
    allowed
      .map((key) => [key, response.headers.get(key)] as const)
      .filter((entry): entry is [string, string] => entry[1] !== null),
  )
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000)

    const retryAt = Date.parse(retryAfter)
    if (Number.isFinite(retryAt)) return Math.min(Math.max(retryAt - Date.now(), 0), 30_000)
  }
  return Math.min(1_000 * 2 ** attempt + Math.floor(Math.random() * 250), 10_000)
}

export async function fetchWithRetry(
  url: string,
  options: RetryOptions = {},
): Promise<Response> {
  const attempts = options.attempts ?? 3
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('Retry attempts must be a positive integer')
  }

  const retryStatuses = options.retryStatuses ?? defaultRetryStatuses
  const sourceName = options.sourceName ?? 'Source'
  let lastError: Error | null = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: options.headers,
        signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
      })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(`Unknown ${sourceName} request error`)
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt, null)))
      }
      continue
    }

    if (response.ok) return response

    lastError = new Error(`${sourceName} request failed with HTTP ${response.status}`)
    if (!retryStatuses.has(response.status)) throw lastError

    if (attempt < attempts - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelay(attempt, response.headers.get('retry-after'))),
      )
    }
  }

  throw lastError ?? new Error(`${sourceName} request failed`)
}
