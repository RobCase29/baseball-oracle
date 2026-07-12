import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  ARCHIVE_MEMBER_BYTE_SEMANTICS,
  archiveCheckpointSchema,
} from './archive-catalog.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/

const sha256Schema = z.string().regex(SHA256_PATTERN)
const timestampSchema = z.string().refine(
  (value) => Number.isFinite(Date.parse(value)),
  'must be an ISO-compatible timestamp',
)

export const archiveCatalogLockSchema = z.object({
  schemaVersion: z.literal('archive-catalog-lock/v1'),
  checkpoint: z.object({
    path: z.string().min(1),
    sha256: sha256Schema,
    startedAt: timestampSchema,
    completedAt: timestampSchema,
    memberCount: z.number().int().positive().safe(),
    memberBytes: z.number().int().nonnegative().safe(),
    memberByteSemantics: z.literal(ARCHIVE_MEMBER_BYTE_SEMANTICS).optional(),
  }).strict(),
  sourceLockSha256: sha256Schema,
  acquisitionManifest: z.object({
    path: z.string().min(1),
    sha256: sha256Schema,
  }).strict(),
  manifest: z.object({
    sha256: sha256Schema,
    byteLength: z.number().int().positive().safe(),
    mediaType: z.literal('application/json'),
    pathname: z.string().min(1),
    storageStatus: z.enum(['created', 'already-exists']),
    archivedAt: timestampSchema,
  }).strict(),
}).strict()

export type ArchiveCatalogLock = z.infer<typeof archiveCatalogLockSchema>

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

export function parseArchiveCatalogLock(body: Uint8Array): ArchiveCatalogLock {
  return archiveCatalogLockSchema.parse(parseJson(body, 'Archive catalog lock'))
}

export function createArchiveCatalogLock(
  checkpointBody: Uint8Array,
  checkpointPath: string,
): ArchiveCatalogLock {
  const checkpoint = archiveCheckpointSchema.parse(
    parseJson(checkpointBody, 'Archive checkpoint'),
  )
  const receiptByPath = new Map(
    checkpoint.receipts.map((receipt) => [receipt.pathname, receipt]),
  )
  if (receiptByPath.size !== checkpoint.receipts.length) {
    throw new Error('Archive checkpoint contains duplicate physical object receipts')
  }
  const logicalReceipts = checkpoint.logicalMembers === undefined
    ? checkpoint.receipts
    : checkpoint.logicalMembers.map((member) => {
        const receipt = receiptByPath.get(member.objectPathname)
        if (!receipt) {
          throw new Error(
            `Archive logical member ${member.resourceKey} has no physical receipt`,
          )
        }
        return receipt
      })
  const memberBytes = logicalReceipts.reduce(
    (total, receipt) => total + receipt.byteLength,
    0,
  )
  if (!Number.isSafeInteger(memberBytes)) {
    throw new Error('Archive member byte total exceeds JavaScript safe integer precision')
  }

  return archiveCatalogLockSchema.parse({
    schemaVersion: 'archive-catalog-lock/v1',
    checkpoint: {
      path: checkpointPath,
      sha256: sha256(checkpointBody),
      startedAt: checkpoint.startedAt,
      completedAt: checkpoint.updatedAt,
      memberCount: logicalReceipts.length,
      memberBytes,
      ...(checkpoint.logicalMembers === undefined
        ? {}
        : { memberByteSemantics: ARCHIVE_MEMBER_BYTE_SEMANTICS }),
    },
    sourceLockSha256: checkpoint.sourceLockSha256,
    acquisitionManifest: {
      path: checkpoint.acquisitionManifestPath,
      sha256: checkpoint.acquisitionManifestSha256,
    },
    manifest: {
      sha256: checkpoint.manifestReceipt.sha256,
      byteLength: checkpoint.manifestReceipt.byteLength,
      mediaType: checkpoint.manifestReceipt.mediaType,
      pathname: checkpoint.manifestReceipt.pathname,
      storageStatus: checkpoint.manifestReceipt.storageStatus,
      archivedAt: checkpoint.manifestReceipt.archivedAt,
    },
  })
}
