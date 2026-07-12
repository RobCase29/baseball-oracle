import { createHash } from 'node:crypto'

const ARCHIVE_SCHEMA_VERSION = 'raw-archive-receipt/v1' as const
const ARCHIVE_PREFIX = 'raw/v1'
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SAFE_SEGMENT_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
const MULTIPART_THRESHOLD_BYTES = 100_000_000

export interface ImmutableStorePutRequest {
  pathname: string
  body: Uint8Array
  contentType: string
  contentEncoding?: string
  multipart: boolean
}

export interface ImmutableStorePutResult {
  status: 'created' | 'already-exists'
  pathname: string
  objectUri: string
  byteLength: number
  etag?: string
}

/**
 * A provider adapter must implement this as a create-only operation. It may
 * resolve an existing pathname, but it must never overwrite or delete it.
 */
export interface ImmutableObjectStore {
  putIfAbsent(request: ImmutableStorePutRequest): Promise<ImmutableStorePutResult>
}

export interface ArchiveRawPayloadInput {
  sourceSlug: string
  datasetKey: string
  body: string | Uint8Array
  expectedSha256: string
  expectedByteLength: number
  mediaType: string
  contentEncoding?: string
}

export interface RawArchiveReceipt {
  schemaVersion: typeof ARCHIVE_SCHEMA_VERSION
  sourceSlug: string
  datasetKey: string
  sha256: string
  byteLength: number
  mediaType: string
  contentEncoding?: string
  pathname: string
  objectUri: string
  etag?: string
  storageStatus: 'created' | 'already-exists'
  archivedAt: string
}

function assertSafeSegment(label: string, value: string): void {
  if (!SAFE_SEGMENT_PATTERN.test(value)) {
    throw new Error(
      `${label} must be a lowercase storage-safe identifier of 1-64 characters`,
    )
  }
}

function assertMediaValue(label: string, value: string): void {
  if (!value || value.includes('\r') || value.includes('\n') || value.includes('\0')) {
    throw new Error(`${label} must be non-empty and cannot contain control characters`)
  }
}

function toBytes(body: string | Uint8Array): Uint8Array {
  return typeof body === 'string' ? new TextEncoder().encode(body) : body
}

export function rawArchivePath(
  sourceSlug: string,
  datasetKey: string,
  sha256: string,
): string {
  assertSafeSegment('sourceSlug', sourceSlug)
  assertSafeSegment('datasetKey', datasetKey)
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error('sha256 must be a lowercase hexadecimal SHA-256 digest')
  }

  return `${ARCHIVE_PREFIX}/${sourceSlug}/${datasetKey}/sha256/${sha256.slice(0, 2)}/${sha256}`
}

export function requiresMultipart(byteLength: number): boolean {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error('byteLength must be a non-negative safe integer')
  }
  return byteLength > MULTIPART_THRESHOLD_BYTES
}

export async function archiveRawPayload(
  store: ImmutableObjectStore,
  input: ArchiveRawPayloadInput,
  now: () => Date = () => new Date(),
): Promise<RawArchiveReceipt> {
  const pathname = rawArchivePath(
    input.sourceSlug,
    input.datasetKey,
    input.expectedSha256,
  )
  assertMediaValue('mediaType', input.mediaType)
  if (input.contentEncoding !== undefined) {
    assertMediaValue('contentEncoding', input.contentEncoding)
  }

  if (!Number.isSafeInteger(input.expectedByteLength) || input.expectedByteLength < 0) {
    throw new Error('expectedByteLength must be a non-negative safe integer')
  }

  const body = toBytes(input.body)
  if (body.byteLength !== input.expectedByteLength) {
    throw new Error(
      `Raw payload length mismatch: expected ${input.expectedByteLength}, received ${body.byteLength}`,
    )
  }

  const actualSha256 = createHash('sha256').update(body).digest('hex')
  if (actualSha256 !== input.expectedSha256) {
    throw new Error(
      `Raw payload digest mismatch: expected ${input.expectedSha256}, received ${actualSha256}`,
    )
  }

  const stored = await store.putIfAbsent({
    pathname,
    body,
    contentType: input.mediaType,
    contentEncoding: input.contentEncoding,
    multipart: requiresMultipart(body.byteLength),
  })

  if (stored.pathname !== pathname) {
    throw new Error(
      `Archive store returned unexpected pathname ${stored.pathname}; expected ${pathname}`,
    )
  }
  if (stored.byteLength !== body.byteLength) {
    throw new Error(
      `Archived object length mismatch: expected ${body.byteLength}, received ${stored.byteLength}`,
    )
  }
  if (!stored.objectUri.startsWith('https://')) {
    throw new Error('Archive store must return an HTTPS object URI')
  }

  return {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    sourceSlug: input.sourceSlug,
    datasetKey: input.datasetKey,
    sha256: actualSha256,
    byteLength: body.byteLength,
    mediaType: input.mediaType,
    contentEncoding: input.contentEncoding,
    pathname,
    objectUri: stored.objectUri,
    etag: stored.etag,
    storageStatus: stored.status,
    archivedAt: now().toISOString(),
  }
}
