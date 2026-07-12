import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { get as vercelGet } from '@vercel/blob'
import {
  ARCHIVE_MEMBER_BYTE_SEMANTICS,
  archiveCheckpointSchema,
  type ArchiveCheckpoint,
} from './archive-catalog.js'
import {
  parseArchiveCatalogLock,
  type ArchiveCatalogLock,
} from './archive-catalog-lock.js'
import { rawArchivePath, type RawArchiveReceipt } from './immutable-raw-archive.js'

const archivedManifestSchema = archiveCheckpointSchema.omit({
  manifestReceipt: true,
})

type ArchivedManifest = ReturnType<typeof archivedManifestSchema.parse>

interface ArchiveBlobGetResult {
  statusCode: number
  stream: ReadableStream<Uint8Array> | null
  blob: {
    pathname: string
    url: string
    size: number | null
    etag: string
    contentType: string | null
  }
}

export interface ArchiveBlobReader {
  get(
    pathname: string,
    options: { access: 'private'; useCache: false },
  ): Promise<ArchiveBlobGetResult | null>
}

type ReadBytes = (filePath: string) => Promise<Uint8Array>

export interface ArchiveCatalogEvidence {
  lock: ArchiveCatalogLock
  checkpointBody: Uint8Array
  checkpointPath: string
  checkpointSource: 'local' | 'blob'
  acquisitionManifestBody: Uint8Array
  acquisitionManifestSource: 'local' | 'blob'
}

export interface LoadArchiveCatalogEvidenceOptions {
  root: string
  lockPath?: string
  readBytes?: ReadBytes
  blobReader?: ArchiveBlobReader
}

interface VerifiedBlobObject {
  body: Uint8Array
  objectUri: string
  etag: string
}

const defaultReadBytes: ReadBytes = async (filePath) => readFile(filePath)
const defaultBlobReader: ArchiveBlobReader = {
  get: (pathname, options) => vercelGet(pathname, options),
}

function sha256(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

function jsonBody(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
}

function parseJson(body: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON`, { cause: error })
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function resolveUnder(
  root: string,
  repositoryPath: string,
  expectedParent: string,
  label: string,
): string {
  if (path.isAbsolute(repositoryPath) || repositoryPath.includes('\\')) {
    throw new Error(`${label} must be a POSIX repository-relative path`)
  }
  const resolved = path.resolve(root, repositoryPath)
  const parent = path.resolve(root, expectedParent)
  const relative = path.relative(parent, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must be under ${expectedParent}`)
  }
  return resolved
}

function logicalReceipts(
  checkpoint: ArchivedManifest | ArchiveCheckpoint,
): Array<(ArchivedManifest | ArchiveCheckpoint)['receipts'][number]> {
  if (checkpoint.logicalMembers === undefined) return checkpoint.receipts
  const receiptByPath = new Map(
    checkpoint.receipts.map((receipt) => [receipt.pathname, receipt]),
  )
  if (receiptByPath.size !== checkpoint.receipts.length) {
    throw new Error('Archive checkpoint contains duplicate physical object receipts')
  }
  return checkpoint.logicalMembers.map((member) => {
    const receipt = receiptByPath.get(member.objectPathname)
    if (!receipt) {
      throw new Error(
        `Archive logical member ${member.resourceKey} has no physical receipt`,
      )
    }
    return receipt
  })
}

function memberBytes(checkpoint: ArchivedManifest | ArchiveCheckpoint): number {
  const total = logicalReceipts(checkpoint).reduce(
    (sum, receipt) => sum + receipt.byteLength,
    0,
  )
  if (!Number.isSafeInteger(total)) {
    throw new Error('Archive member byte total exceeds JavaScript safe integer precision')
  }
  return total
}

function assertCheckpointHeaderMatchesLock(
  checkpoint: ArchivedManifest | ArchiveCheckpoint,
  lock: ArchiveCatalogLock,
): void {
  if (
    (checkpoint.logicalMembers !== undefined &&
      lock.checkpoint.memberByteSemantics !== ARCHIVE_MEMBER_BYTE_SEMANTICS) ||
    checkpoint.startedAt !== lock.checkpoint.startedAt ||
    checkpoint.updatedAt !== lock.checkpoint.completedAt ||
    checkpoint.sourceLockSha256 !== lock.sourceLockSha256 ||
    checkpoint.acquisitionManifestPath !== lock.acquisitionManifest.path ||
    checkpoint.acquisitionManifestSha256 !== lock.acquisitionManifest.sha256 ||
    logicalReceipts(checkpoint).length !== lock.checkpoint.memberCount ||
    memberBytes(checkpoint) !== lock.checkpoint.memberBytes
  ) {
    throw new Error('Archive checkpoint metadata differs from the committed catalog lock')
  }
}

function assertCheckpointMatchesLock(
  checkpoint: ArchiveCheckpoint,
  lock: ArchiveCatalogLock,
): void {
  assertCheckpointHeaderMatchesLock(checkpoint, lock)
  const manifest = checkpoint.manifestReceipt
  if (
    manifest.sourceSlug !== 'baseball-oracle' ||
    manifest.datasetKey !== 'archive-manifest' ||
    manifest.sha256 !== lock.manifest.sha256 ||
    manifest.byteLength !== lock.manifest.byteLength ||
    manifest.mediaType !== lock.manifest.mediaType ||
    manifest.pathname !== lock.manifest.pathname ||
    manifest.storageStatus !== lock.manifest.storageStatus ||
    manifest.archivedAt !== lock.manifest.archivedAt
  ) {
    throw new Error('Archive manifest metadata differs from the committed catalog lock')
  }
}

async function readBlobStream(
  stream: ReadableStream<Uint8Array>,
  expectedByteLength: number,
  pathname: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > expectedByteLength) {
        await reader.cancel()
        throw new Error(`Private archive object length mismatch at ${pathname}`)
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Private archive object')) {
      throw error
    }
    throw new Error(`Unable to read private archive object ${pathname}`, {
      cause: error,
    })
  }
  if (byteLength !== expectedByteLength) {
    throw new Error(`Private archive object length mismatch at ${pathname}`)
  }

  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function getVerifiedBlobObject(
  blobReader: ArchiveBlobReader,
  expected: {
    pathname: string
    sha256: string
    byteLength: number
    mediaType: string
  },
): Promise<VerifiedBlobObject> {
  let result: ArchiveBlobGetResult | null
  try {
    result = await blobReader.get(expected.pathname, {
      access: 'private',
      useCache: false,
    })
  } catch (error) {
    throw new Error(`Unable to retrieve private archive object ${expected.pathname}`, {
      cause: error,
    })
  }
  if (
    result?.statusCode !== 200 ||
    result.stream === null ||
    result.blob.size === null
  ) {
    throw new Error(`Private archive object is unavailable at ${expected.pathname}`)
  }
  if (
    result.blob.pathname !== expected.pathname ||
    result.blob.contentType !== expected.mediaType
  ) {
    throw new Error(`Private archive object metadata mismatch at ${expected.pathname}`)
  }

  // Private Blob can report zero when a streamed response has no Content-Length.
  // The streamed byte count and digest below remain authoritative.
  if (result.blob.size !== 0 && result.blob.size !== expected.byteLength) {
    throw new Error(`Private archive object length mismatch at ${expected.pathname}`)
  }

  const body = await readBlobStream(
    result.stream,
    expected.byteLength,
    expected.pathname,
  )
  if (sha256(body) !== expected.sha256) {
    throw new Error(`Private archive object digest mismatch at ${expected.pathname}`)
  }
  return {
    body,
    objectUri: result.blob.url,
    etag: result.blob.etag,
  }
}

function parseCheckpointBody(
  checkpointBody: Uint8Array,
  lock: ArchiveCatalogLock,
): ArchiveCheckpoint {
  if (sha256(checkpointBody) !== lock.checkpoint.sha256) {
    throw new Error('Archive checkpoint digest differs from the committed catalog lock')
  }
  const checkpoint = archiveCheckpointSchema.parse(
    parseJson(checkpointBody, 'Archive checkpoint'),
  )
  assertCheckpointMatchesLock(checkpoint, lock)
  return checkpoint
}

function objectUriCandidates(objectUri: string): string[] {
  let normalized: string
  try {
    normalized = new URL(objectUri).href
  } catch (error) {
    throw new Error('Private archive object returned an invalid URL', { cause: error })
  }
  return [...new Set([objectUri, normalized])]
}

function etagCandidates(etag: string): string[] {
  return [...new Set([etag, etag.replace(/^W\//u, '')])]
}

async function reconstructCheckpoint(
  lock: ArchiveCatalogLock,
  blobReader: ArchiveBlobReader,
): Promise<{ body: Uint8Array; checkpoint: ArchiveCheckpoint }> {
  const archivedObject = await getVerifiedBlobObject(blobReader, {
    pathname: lock.manifest.pathname,
    sha256: lock.manifest.sha256,
    byteLength: lock.manifest.byteLength,
    mediaType: lock.manifest.mediaType,
  })
  const rawManifest = parseJson(archivedObject.body, 'Archived manifest')
  const archivedManifest = archivedManifestSchema.parse(rawManifest)
  assertCheckpointHeaderMatchesLock(archivedManifest, lock)

  const receiptMetadata = {
    schemaVersion: 'raw-archive-receipt/v1',
    sourceSlug: 'baseball-oracle',
    datasetKey: 'archive-manifest',
    sha256: lock.manifest.sha256,
    byteLength: lock.manifest.byteLength,
    mediaType: lock.manifest.mediaType,
    pathname: lock.manifest.pathname,
  } as const
  for (const objectUri of objectUriCandidates(archivedObject.objectUri)) {
    for (const etag of etagCandidates(archivedObject.etag)) {
      const manifestReceipt: RawArchiveReceipt = {
        ...receiptMetadata,
        objectUri,
        etag,
        storageStatus: lock.manifest.storageStatus,
        archivedAt: lock.manifest.archivedAt,
      }
      const checkpointBody = jsonBody({
        ...(rawManifest as Record<string, unknown>),
        manifestReceipt,
      })
      if (sha256(checkpointBody) === lock.checkpoint.sha256) {
        return {
          body: checkpointBody,
          checkpoint: parseCheckpointBody(checkpointBody, lock),
        }
      }
    }
  }
  throw new Error('Archive checkpoint digest differs from the committed catalog lock')
}

function acquisitionReceipt(
  checkpoint: ArchiveCheckpoint,
  lock: ArchiveCatalogLock,
): RawArchiveReceipt {
  const matches = checkpoint.receipts.filter(
    (receipt) =>
      receipt.sourceSlug === 'baseball-oracle' &&
      receipt.datasetKey === 'acquisition-manifest' &&
      receipt.sha256 === lock.acquisitionManifest.sha256,
  )
  if (matches.length !== 1) {
    throw new Error('Archive checkpoint has no unique acquisition-manifest receipt')
  }
  return matches[0]
}

async function loadAcquisitionManifest(
  acquisitionPath: string,
  checkpoint: ArchiveCheckpoint,
  lock: ArchiveCatalogLock,
  readBytes: ReadBytes,
  blobReader: ArchiveBlobReader,
): Promise<{ body: Uint8Array; source: 'local' | 'blob' }> {
  try {
    const body = await readBytes(acquisitionPath)
    if (sha256(body) !== lock.acquisitionManifest.sha256) {
      throw new Error(
        'Local acquisition manifest digest differs from the committed catalog lock',
      )
    }
    return { body, source: 'local' }
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }

  const receipt = acquisitionReceipt(checkpoint, lock)
  const expectedPathname = rawArchivePath(
    'baseball-oracle',
    'acquisition-manifest',
    lock.acquisitionManifest.sha256,
  )
  if (
    receipt.pathname !== expectedPathname ||
    receipt.mediaType !== 'application/json'
  ) {
    throw new Error('Acquisition-manifest receipt has invalid object metadata')
  }
  const archivedObject = await getVerifiedBlobObject(blobReader, {
    pathname: receipt.pathname,
    sha256: receipt.sha256,
    byteLength: receipt.byteLength,
    mediaType: receipt.mediaType,
  })
  if (
    !objectUriCandidates(archivedObject.objectUri).includes(receipt.objectUri) ||
    (receipt.etag !== undefined &&
      !etagCandidates(archivedObject.etag).includes(receipt.etag))
  ) {
    throw new Error('Acquisition-manifest Blob metadata differs from its receipt')
  }
  return { body: archivedObject.body, source: 'blob' }
}

export async function loadArchiveCatalogEvidence(
  options: LoadArchiveCatalogEvidenceOptions,
): Promise<ArchiveCatalogEvidence> {
  const readBytes = options.readBytes ?? defaultReadBytes
  const blobReader = options.blobReader ?? defaultBlobReader
  const lockPath = options.lockPath ?? path.join(
    options.root,
    'data/archive-catalog-lock.json',
  )
  const lock = parseArchiveCatalogLock(await readBytes(lockPath))
  if (Date.parse(lock.checkpoint.completedAt) < Date.parse(lock.checkpoint.startedAt)) {
    throw new Error('Archive catalog lock completed before it started')
  }
  const checkpointPath = resolveUnder(
    options.root,
    lock.checkpoint.path,
    'data/manifests/archive',
    'Archive checkpoint path',
  )
  const acquisitionPath = resolveUnder(
    options.root,
    lock.acquisitionManifest.path,
    'data/manifests/runs',
    'Acquisition manifest path',
  )
  const expectedManifestPathname = rawArchivePath(
    'baseball-oracle',
    'archive-manifest',
    lock.manifest.sha256,
  )
  if (lock.manifest.pathname !== expectedManifestPathname) {
    throw new Error('Archive catalog lock has a non-canonical manifest pathname')
  }

  let checkpointBody: Uint8Array
  let checkpoint: ArchiveCheckpoint
  let checkpointSource: 'local' | 'blob'
  try {
    checkpointBody = await readBytes(checkpointPath)
    checkpoint = parseCheckpointBody(checkpointBody, lock)
    checkpointSource = 'local'
  } catch (error) {
    if (!isMissingFile(error)) throw error
    const reconstructed = await reconstructCheckpoint(lock, blobReader)
    checkpointBody = reconstructed.body
    checkpoint = reconstructed.checkpoint
    checkpointSource = 'blob'
  }

  const acquisition = await loadAcquisitionManifest(
    acquisitionPath,
    checkpoint,
    lock,
    readBytes,
    blobReader,
  )
  return {
    lock,
    checkpointBody,
    checkpointPath: lock.checkpoint.path,
    checkpointSource,
    acquisitionManifestBody: acquisition.body,
    acquisitionManifestSource: acquisition.source,
  }
}
