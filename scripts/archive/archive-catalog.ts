import { createHash } from 'node:crypto'
import { z } from 'zod'
import { rawArchivePath, type RawArchiveReceipt } from './immutable-raw-archive.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const PRIVATE_BLOB_HOST_SUFFIX = '.private.blob.vercel-storage.com'

const DATASET_KEY_BY_SOURCE: Record<string, string> = {
  'chadwick-register': 'people-register',
  'sabr-lahman': 'lahman-database',
  retrosheet: 'biofile',
  'fangraphs-prospect-board': 'prospect-board',
}

const sha256Schema = z.string().regex(SHA256_PATTERN)
const timestampSchema = z.string().refine(
  (value) => Number.isFinite(Date.parse(value)),
  'must be an ISO-compatible timestamp',
)

export const rawArchiveReceiptSchema = z.object({
  schemaVersion: z.literal('raw-archive-receipt/v1'),
  sourceSlug: z.string().min(1),
  datasetKey: z.string().min(1),
  sha256: sha256Schema,
  byteLength: z.number().int().nonnegative().safe(),
  mediaType: z.string().min(1),
  contentEncoding: z.string().min(1).optional(),
  pathname: z.string().min(1),
  objectUri: z.string().url(),
  etag: z.string().optional(),
  storageStatus: z.enum(['created', 'already-exists']),
  archivedAt: timestampSchema,
}).strict()

export const archiveLogicalMemberSchema = z.object({
  sourceSlug: z.string().min(1),
  datasetKey: z.string().min(1),
  resourceKey: z.string().min(1),
  objectPathname: z.string().min(1),
}).strict()

export const archiveCheckpointSchema = z.object({
  schemaVersion: z.literal('locked-corpus-archive/v1'),
  startedAt: timestampSchema,
  updatedAt: timestampSchema,
  status: z.literal('complete'),
  sourceLockSha256: sha256Schema,
  acquisitionManifestPath: z.string().min(1),
  acquisitionManifestSha256: sha256Schema,
  receipts: z.array(rawArchiveReceiptSchema).min(1),
  logicalMembers: z.array(archiveLogicalMemberSchema).min(1).optional(),
  manifestReceipt: rawArchiveReceiptSchema,
}).strict()

const lockedResourceSchema = z.object({
  bytes: z.number().int().nonnegative().safe(),
  sha256: sha256Schema,
  url: z.string().url(),
}).passthrough()

const sourceLockSchema = z.object({
  sources: z.record(
    z.string(),
    z.object({
      resources: z.record(z.string(), lockedResourceSchema),
    }).passthrough(),
  ),
}).passthrough()

const acquiredResourceSchema = lockedResourceSchema.extend({
  source: z.string().min(1),
  key: z.string().min(1),
  path: z.string().min(1),
})

const acquisitionManifestSchema = z.object({
  acquiredAt: timestampSchema,
  sourceLock: z.object({ sha256: sha256Schema }).passthrough(),
  resources: z.array(acquiredResourceSchema).min(1),
}).passthrough()

export type ArchiveCheckpoint = z.infer<typeof archiveCheckpointSchema>
export type ArchiveLogicalMember = z.infer<typeof archiveLogicalMemberSchema>
type AcquiredResource = z.infer<typeof acquiredResourceSchema>

export const ARCHIVE_MEMBER_BYTE_SEMANTICS = 'logical-membership-bytes/v1' as const

export type ArchiveMemberRole =
  | 'raw_payload'
  | 'source_lock'
  | 'acquisition_manifest'
  | 'permission_evidence'

export interface ArchiveCatalogMember {
  ordinal: number
  receipt: RawArchiveReceipt
  memberRole: ArchiveMemberRole
  resourceKey: string
  sourceUri: string | null
}

export interface ValidatedArchiveCatalog {
  checkpoint: ArchiveCheckpoint
  checkpointPath: string
  checkpointSha256: string
  manifestReceipt: RawArchiveReceipt
  members: ArchiveCatalogMember[]
  memberBytes: number
  objectCount: number
  acquisitionResourceCount: number
}

export interface ArchiveCatalogValidationInput {
  checkpointBody: Uint8Array
  checkpointPath: string
  sourceLockBody: Uint8Array
  sourceLockPath: string
  acquisitionManifestBody: Uint8Array
  permissionEvidenceBody: Uint8Array
  permissionEvidencePath: string
}

interface ExpectedMember {
  sourceSlug: string
  datasetKey: string
  resourceKey: string
  sourceUri: string | null
  sha256: string
  byteLength: number
  mediaType: string
  memberRole: ArchiveMemberRole
}

type LogicalMemberIdentity = Pick<
  ArchiveLogicalMember,
  'sourceSlug' | 'datasetKey' | 'resourceKey'
>

export function archiveLogicalMemberKey(member: LogicalMemberIdentity): string {
  return JSON.stringify([
    member.sourceSlug,
    member.datasetKey,
    member.resourceKey,
  ])
}

function sha256(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

function parseJson(body: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON`, { cause: error })
  }
}

function mediaType(filePath: string): string {
  if (filePath.endsWith('.json')) return 'application/json'
  if (filePath.endsWith('.csv')) return 'text/csv'
  if (filePath.endsWith('.md')) return 'text/markdown'
  if (filePath.endsWith('.txt')) return 'text/plain'
  return 'application/octet-stream'
}

function assertResourceKey(value: string): void {
  if (!value || new TextEncoder().encode(value).byteLength > 1024) {
    throw new Error('Archive member resource key must contain 1-1024 UTF-8 bytes')
  }
}

function assertPrivateReceipt(receipt: RawArchiveReceipt): void {
  const expectedPath = rawArchivePath(
    receipt.sourceSlug,
    receipt.datasetKey,
    receipt.sha256,
  )
  if (receipt.pathname !== expectedPath) {
    throw new Error(`Archive receipt ${receipt.sha256} has a non-canonical pathname`)
  }
  const uri = new URL(receipt.objectUri)
  if (
    uri.protocol !== 'https:' ||
    !uri.hostname.endsWith(PRIVATE_BLOB_HOST_SUFFIX) ||
    uri.username !== '' ||
    uri.password !== ''
  ) {
    throw new Error(
      `Archive receipt ${receipt.sha256} is not private Vercel Blob HTTPS metadata`,
    )
  }
}

function assertReceiptMatches(
  receipt: RawArchiveReceipt,
  expected: ExpectedMember,
): void {
  if (
    receipt.sourceSlug !== expected.sourceSlug ||
    receipt.datasetKey !== expected.datasetKey ||
    receipt.sha256 !== expected.sha256 ||
    receipt.byteLength !== expected.byteLength ||
    receipt.mediaType !== expected.mediaType ||
    receipt.contentEncoding !== undefined
  ) {
    throw new Error(
      `Archive receipt ${receipt.sha256} differs from its locked member metadata`,
    )
  }
}

function expectedRawMembers(resources: AcquiredResource[]): ExpectedMember[] {
  return resources.map((resource) => {
    const datasetKey = DATASET_KEY_BY_SOURCE[resource.source]
    if (!datasetKey) {
      throw new Error(`No archive dataset mapping for ${resource.source}`)
    }
    assertResourceKey(resource.key)
    const sourceUri = new URL(resource.url)
    if (sourceUri.protocol !== 'https:') {
      throw new Error(`Locked resource ${resource.source}/${resource.key} is not HTTPS`)
    }
    const normalizedPath = resource.path.replaceAll('\\', '/')
    if (
      normalizedPath.startsWith('/') ||
      normalizedPath.split('/').includes('..')
    ) {
      throw new Error(`Locked resource ${resource.source}/${resource.key} has an unsafe path`)
    }
    return {
      sourceSlug: resource.source,
      datasetKey,
      resourceKey: resource.key,
      sourceUri: resource.url,
      sha256: resource.sha256,
      byteLength: resource.bytes,
      mediaType: mediaType(resource.path),
      memberRole: 'raw_payload',
    }
  })
}

export function validateArchiveCatalog(
  input: ArchiveCatalogValidationInput,
): ValidatedArchiveCatalog {
  const rawCheckpoint = parseJson(input.checkpointBody, 'Archive checkpoint')
  const checkpoint = archiveCheckpointSchema.parse(rawCheckpoint)
  const sourceLock = sourceLockSchema.parse(
    parseJson(input.sourceLockBody, 'Source lock'),
  )
  const acquisition = acquisitionManifestSchema.parse(
    parseJson(input.acquisitionManifestBody, 'Acquisition manifest'),
  )

  const sourceLockSha256 = sha256(input.sourceLockBody)
  const acquisitionManifestSha256 = sha256(input.acquisitionManifestBody)
  if (
    checkpoint.sourceLockSha256 !== sourceLockSha256 ||
    acquisition.sourceLock.sha256 !== sourceLockSha256
  ) {
    throw new Error('Archive checkpoint and acquisition manifest do not match the source lock')
  }
  if (checkpoint.acquisitionManifestSha256 !== acquisitionManifestSha256) {
    throw new Error('Archive checkpoint does not match the acquisition manifest bytes')
  }
  if (Date.parse(checkpoint.updatedAt) < Date.parse(checkpoint.startedAt)) {
    throw new Error('Archive checkpoint completed before it started')
  }

  const lockedByKey = new Map<string, z.infer<typeof lockedResourceSchema>>()
  for (const [source, entry] of Object.entries(sourceLock.sources)) {
    for (const [key, resource] of Object.entries(entry.resources)) {
      lockedByKey.set(`${source}/${key}`, resource)
    }
  }
  if (acquisition.resources.length !== lockedByKey.size) {
    throw new Error('Acquisition resource count differs from the source lock')
  }
  const acquiredKeys = new Set<string>()
  for (const resource of acquisition.resources) {
    const logicalKey = `${resource.source}/${resource.key}`
    if (acquiredKeys.has(logicalKey)) {
      throw new Error(`Acquisition manifest duplicates ${logicalKey}`)
    }
    acquiredKeys.add(logicalKey)
    const locked = lockedByKey.get(logicalKey)
    if (
      !locked ||
      locked.sha256 !== resource.sha256 ||
      locked.bytes !== resource.bytes ||
      locked.url !== resource.url
    ) {
      throw new Error(`Acquisition resource ${logicalKey} differs from the source lock`)
    }
  }

  const expected: ExpectedMember[] = [
    ...expectedRawMembers(acquisition.resources),
    {
      sourceSlug: 'baseball-oracle',
      datasetKey: 'source-lock',
      resourceKey: input.sourceLockPath,
      sourceUri: null,
      sha256: sourceLockSha256,
      byteLength: input.sourceLockBody.byteLength,
      mediaType: 'application/json',
      memberRole: 'source_lock',
    },
    {
      sourceSlug: 'baseball-oracle',
      datasetKey: 'acquisition-manifest',
      resourceKey: checkpoint.acquisitionManifestPath,
      sourceUri: null,
      sha256: acquisitionManifestSha256,
      byteLength: input.acquisitionManifestBody.byteLength,
      mediaType: 'application/json',
      memberRole: 'acquisition_manifest',
    },
    {
      sourceSlug: 'baseball-oracle',
      datasetKey: 'permission-evidence',
      resourceKey: input.permissionEvidencePath,
      sourceUri: null,
      sha256: sha256(input.permissionEvidenceBody),
      byteLength: input.permissionEvidenceBody.byteLength,
      mediaType: 'text/markdown',
      memberRole: 'permission_evidence',
    },
  ]
  for (const member of expected) assertResourceKey(member.resourceKey)

  const expectedByLogicalKey = new Map<string, ExpectedMember>()
  const expectedByObjectPath = new Map<string, ExpectedMember[]>()
  for (const member of expected) {
    const logicalKey = archiveLogicalMemberKey(member)
    if (expectedByLogicalKey.has(logicalKey)) {
      throw new Error('Archive corpus contains duplicate logical member identities')
    }
    expectedByLogicalKey.set(logicalKey, member)
    const objectPathname = rawArchivePath(
      member.sourceSlug,
      member.datasetKey,
      member.sha256,
    )
    const sharingObject = expectedByObjectPath.get(objectPathname) ?? []
    const first = sharingObject[0]
    if (
      first &&
      (first.byteLength !== member.byteLength ||
        first.mediaType !== member.mediaType)
    ) {
      throw new Error(
        `Logical archive members sharing ${objectPathname} have incompatible object metadata`,
      )
    }
    sharingObject.push(member)
    expectedByObjectPath.set(objectPathname, sharingObject)
  }
  if (checkpoint.receipts.length !== expectedByObjectPath.size) {
    throw new Error(
      `Archive object receipt count mismatch: expected ${expectedByObjectPath.size}, ` +
        `received ${checkpoint.receipts.length}`,
    )
  }

  const receiptPaths = new Set<string>()
  const receiptUris = new Set<string>()
  const receiptByPath = new Map<string, RawArchiveReceipt>()
  for (const receipt of checkpoint.receipts) {
    assertPrivateReceipt(receipt)
    if (
      receiptPaths.has(receipt.pathname) ||
      receiptUris.has(receipt.objectUri)
    ) {
      throw new Error('Archive checkpoint contains duplicate object metadata')
    }
    receiptPaths.add(receipt.pathname)
    receiptUris.add(receipt.objectUri)
    const expectedMembers = expectedByObjectPath.get(receipt.pathname)
    if (!expectedMembers) {
      throw new Error(`Archive receipt ${receipt.sha256} is not in the locked corpus`)
    }
    for (const expectedMember of expectedMembers) {
      assertReceiptMatches(receipt, expectedMember)
    }
    receiptByPath.set(receipt.pathname, receipt)
  }
  if (
    receiptByPath.size !== expectedByObjectPath.size ||
    [...expectedByObjectPath].some(([pathname]) => !receiptByPath.has(pathname))
  ) {
    throw new Error('Archive receipts do not cover every locked physical object')
  }

  let logicalMembers: ArchiveLogicalMember[]
  if (checkpoint.logicalMembers === undefined) {
    if (expectedByObjectPath.size !== expected.length) {
      throw new Error(
        'Archive checkpoint requires logicalMembers to represent shared physical objects',
      )
    }
    logicalMembers = checkpoint.receipts.map((receipt) => {
      const expectedMember = expectedByObjectPath.get(receipt.pathname)?.[0]
      if (!expectedMember) {
        throw new Error(`Archive receipt ${receipt.sha256} is not in the locked corpus`)
      }
      return {
        sourceSlug: expectedMember.sourceSlug,
        datasetKey: expectedMember.datasetKey,
        resourceKey: expectedMember.resourceKey,
        objectPathname: receipt.pathname,
      }
    })
  } else {
    logicalMembers = checkpoint.logicalMembers
  }
  if (logicalMembers.length !== expected.length) {
    throw new Error(
      `Archive logical member count mismatch: expected ${expected.length}, ` +
        `received ${logicalMembers.length}`,
    )
  }

  const logicalKeys = new Set<string>()
  const members = logicalMembers.map((logicalMember, ordinal) => {
    const logicalKey = archiveLogicalMemberKey(logicalMember)
    if (logicalKeys.has(logicalKey)) {
      throw new Error('Archive checkpoint contains duplicate logical member identities')
    }
    logicalKeys.add(logicalKey)
    const expectedMember = expectedByLogicalKey.get(logicalKey)
    if (!expectedMember) {
      throw new Error(
        `Archive logical member ${logicalMember.resourceKey} is not in the locked corpus`,
      )
    }
    const expectedPathname = rawArchivePath(
      expectedMember.sourceSlug,
      expectedMember.datasetKey,
      expectedMember.sha256,
    )
    if (logicalMember.objectPathname !== expectedPathname) {
      throw new Error(
        `Archive logical member ${logicalMember.resourceKey} references the wrong object`,
      )
    }
    const receipt = receiptByPath.get(logicalMember.objectPathname)
    if (!receipt) {
      throw new Error(
        `Archive logical member ${logicalMember.resourceKey} has no physical receipt`,
      )
    }
    assertReceiptMatches(receipt, expectedMember)
    return {
      ordinal,
      receipt,
      memberRole: expectedMember.memberRole,
      resourceKey: expectedMember.resourceKey,
      sourceUri: expectedMember.sourceUri,
    }
  })
  if (logicalKeys.size !== expectedByLogicalKey.size) {
    throw new Error('Archive logical members do not cover every locked member')
  }

  assertPrivateReceipt(checkpoint.manifestReceipt)
  if (
    checkpoint.manifestReceipt.sourceSlug !== 'baseball-oracle' ||
    checkpoint.manifestReceipt.datasetKey !== 'archive-manifest' ||
    receiptPaths.has(checkpoint.manifestReceipt.pathname)
  ) {
    throw new Error('Archive manifest receipt has invalid identity metadata')
  }

  const rawManifest = { ...(rawCheckpoint as Record<string, unknown>) }
  delete rawManifest.manifestReceipt
  const reconstructedManifestBody = new TextEncoder().encode(
    `${JSON.stringify(rawManifest, null, 2)}\n`,
  )
  if (
    sha256(reconstructedManifestBody) !== checkpoint.manifestReceipt.sha256 ||
    reconstructedManifestBody.byteLength !== checkpoint.manifestReceipt.byteLength ||
    checkpoint.manifestReceipt.mediaType !== 'application/json' ||
    checkpoint.manifestReceipt.contentEncoding !== undefined
  ) {
    throw new Error('Archive manifest receipt does not match the reconstructed manifest bytes')
  }

  const memberBytes = members.reduce(
    (total, member) => total + member.receipt.byteLength,
    0,
  )
  if (!Number.isSafeInteger(memberBytes)) {
    throw new Error('Archive member byte total exceeds JavaScript safe integer precision')
  }

  return {
    checkpoint,
    checkpointPath: input.checkpointPath,
    checkpointSha256: sha256(input.checkpointBody),
    manifestReceipt: checkpoint.manifestReceipt,
    members,
    memberBytes,
    objectCount: receiptByPath.size,
    acquisitionResourceCount: acquisition.resources.length,
  }
}
