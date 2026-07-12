import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'
import {
  ARCHIVE_MEMBER_BYTE_SEMANTICS,
  validateArchiveCatalog,
  type ValidatedArchiveCatalog,
} from './archive-catalog.js'
import { loadArchiveCatalogEvidence } from './archive-catalog-loader.js'
import type { RawArchiveReceipt } from './immutable-raw-archive.js'

export interface ArchiveObjectRow {
  id: string
  sha256: string
  byte_length: string
  media_type: string
  content_encoding: string | null
  storage_provider: string
  access_scope: string
  pathname: string
  object_uri: string
  etag: string | null
  archived_at: Date
}

interface ArchiveManifestRow {
  id: string
  archive_object_id: string
  manifest_sha256: string
  schema_version: string
  status: string
  source_lock_sha256: string
  acquisition_manifest_path: string
  acquisition_manifest_sha256: string
  checkpoint_path: string
  checkpoint_sha256: string
  member_count: number
  member_bytes: string
  started_at: Date
  completed_at: Date
  metadata: Record<string, unknown>
}

interface ArchiveMemberRow {
  ordinal: number
  archive_object_id: string
  member_role: string
  source_slug: string
  dataset_key: string
  resource_key: string
  source_uri: string | null
  storage_status: string
  archived_at: Date
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDirectory, '../..')
const sourceLockPath = path.join(root, 'data/source-lock.json')
const permissionEvidencePath = path.join(
  root,
  'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md',
)

function relativeToRoot(filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function timestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

export function uniqueArchiveObjectReceipts(
  receipts: RawArchiveReceipt[],
): RawArchiveReceipt[] {
  const byPath = new Map<string, RawArchiveReceipt>()
  for (const receipt of receipts) {
    const existing = byPath.get(receipt.pathname)
    if (
      existing &&
      (existing.sha256 !== receipt.sha256 ||
        existing.byteLength !== receipt.byteLength ||
        existing.mediaType !== receipt.mediaType ||
        existing.contentEncoding !== receipt.contentEncoding ||
        existing.sourceSlug !== receipt.sourceSlug ||
        existing.datasetKey !== receipt.datasetKey)
    ) {
      throw new Error(`Logical members disagree about object ${receipt.pathname}`)
    }
    if (!existing) byPath.set(receipt.pathname, receipt)
  }
  return [...byPath.values()]
}

export function assertArchiveObjectRow(
  row: ArchiveObjectRow | undefined,
  receipt: RawArchiveReceipt,
): asserts row is ArchiveObjectRow {
  if (
    !row ||
    row.sha256 !== receipt.sha256 ||
    BigInt(row.byte_length) !== BigInt(receipt.byteLength) ||
    row.media_type !== receipt.mediaType ||
    row.content_encoding !== (receipt.contentEncoding ?? null) ||
    row.storage_provider !== 'vercel_blob' ||
    row.access_scope !== 'private' ||
    row.pathname !== receipt.pathname
  ) {
    throw new Error(`Existing archive object conflicts with ${receipt.pathname}`)
  }
}

function assertArchiveManifestRow(
  row: ArchiveManifestRow | undefined,
  catalog: ValidatedArchiveCatalog,
  archiveObjectId: string,
  metadata: Record<string, unknown>,
): asserts row is ArchiveManifestRow {
  const checkpoint = catalog.checkpoint
  if (
    !row ||
    row.archive_object_id !== archiveObjectId ||
    row.manifest_sha256 !== catalog.manifestReceipt.sha256 ||
    row.schema_version !== checkpoint.schemaVersion ||
    row.status !== checkpoint.status ||
    row.source_lock_sha256 !== checkpoint.sourceLockSha256 ||
    row.acquisition_manifest_path !== checkpoint.acquisitionManifestPath ||
    row.acquisition_manifest_sha256 !== checkpoint.acquisitionManifestSha256 ||
    row.checkpoint_path !== catalog.checkpointPath ||
    row.checkpoint_sha256 !== catalog.checkpointSha256 ||
    row.member_count !== catalog.members.length ||
    BigInt(row.member_bytes) !== BigInt(catalog.memberBytes) ||
    timestamp(row.started_at) !== timestamp(checkpoint.startedAt) ||
    timestamp(row.completed_at) !== timestamp(checkpoint.updatedAt) ||
    row.metadata.storage_provider !== metadata.storage_provider ||
    row.metadata.access_scope !== metadata.access_scope ||
    row.metadata.acquisition_resource_count !== metadata.acquisition_resource_count ||
    row.metadata.evidence_member_count !== metadata.evidence_member_count ||
    (row.metadata.member_byte_semantics !== undefined &&
      row.metadata.member_byte_semantics !== metadata.member_byte_semantics) ||
    (row.metadata.member_object_count !== undefined &&
      row.metadata.member_object_count !== metadata.member_object_count)
  ) {
    throw new Error(
      `Existing archive manifest conflicts with ${catalog.manifestReceipt.sha256}`,
    )
  }
}

function assertArchiveMemberRow(
  row: ArchiveMemberRow | undefined,
  expected: ValidatedArchiveCatalog['members'][number],
  archiveObjectId: string,
): void {
  if (
    !row ||
    row.ordinal !== expected.ordinal ||
    row.archive_object_id !== archiveObjectId ||
    row.member_role !== expected.memberRole ||
    row.source_slug !== expected.receipt.sourceSlug ||
    row.dataset_key !== expected.receipt.datasetKey ||
    row.resource_key !== expected.resourceKey ||
    row.source_uri !== expected.sourceUri ||
    row.storage_status !== expected.receipt.storageStatus ||
    timestamp(row.archived_at) !== timestamp(expected.receipt.archivedAt)
  ) {
    throw new Error(`Existing archive member conflicts at ordinal ${expected.ordinal}`)
  }
}

export async function registerArchiveCatalog(
  catalog: ValidatedArchiveCatalog,
): Promise<void> {
  const sql = postgres(directDatabaseUrl(), {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 15,
  })

  try {
    await sql.begin(async (transaction) => {
      const objectIds = new Map<string, string>()
      const receipts = uniqueArchiveObjectReceipts([
        ...catalog.members.map((member) => member.receipt),
        catalog.manifestReceipt,
      ])
      if (receipts.length !== catalog.objectCount + 1) {
        throw new Error('Archive object registration plan does not reconcile')
      }
      for (const receipt of receipts) {
        const inserted = await transaction<ArchiveObjectRow[]>`
          INSERT INTO raw.archive_object (
            sha256,
            byte_length,
            media_type,
            content_encoding,
            storage_provider,
            access_scope,
            pathname,
            object_uri,
            etag,
            archived_at
          ) VALUES (
            ${receipt.sha256},
            ${receipt.byteLength},
            ${receipt.mediaType},
            ${receipt.contentEncoding ?? null},
            'vercel_blob',
            'private',
            ${receipt.pathname},
            ${receipt.objectUri},
            ${receipt.etag ?? null},
            ${receipt.archivedAt}
          )
          ON CONFLICT (pathname) DO NOTHING
          RETURNING
            id,
            sha256,
            byte_length,
            media_type,
            content_encoding,
            storage_provider,
            access_scope,
            pathname,
            object_uri,
            etag,
            archived_at
        `
        const selected = inserted[0] ?? (
          await transaction<ArchiveObjectRow[]>`
            SELECT
              id,
              sha256,
              byte_length,
              media_type,
              content_encoding,
              storage_provider,
              access_scope,
              pathname,
              object_uri,
              etag,
              archived_at
            FROM raw.archive_object
            WHERE pathname = ${receipt.pathname}
          `
        )[0]
        assertArchiveObjectRow(selected, receipt)
        objectIds.set(receipt.pathname, selected.id)
      }

      const manifestObjectId = objectIds.get(catalog.manifestReceipt.pathname)
      if (!manifestObjectId) throw new Error('Archive manifest object was not registered')
      const metadata = {
        storage_provider: 'vercel_blob',
        access_scope: 'private',
        acquisition_resource_count: catalog.acquisitionResourceCount,
        evidence_member_count: catalog.members.length - catalog.acquisitionResourceCount,
        member_byte_semantics: ARCHIVE_MEMBER_BYTE_SEMANTICS,
        member_object_count: catalog.objectCount,
      }
      const checkpoint = catalog.checkpoint
      const insertedManifest = await transaction<ArchiveManifestRow[]>`
        INSERT INTO raw.archive_manifest (
          archive_object_id,
          manifest_sha256,
          schema_version,
          status,
          source_lock_sha256,
          acquisition_manifest_path,
          acquisition_manifest_sha256,
          checkpoint_path,
          checkpoint_sha256,
          member_count,
          member_bytes,
          started_at,
          completed_at,
          metadata
        ) VALUES (
          ${manifestObjectId},
          ${catalog.manifestReceipt.sha256},
          ${checkpoint.schemaVersion},
          ${checkpoint.status},
          ${checkpoint.sourceLockSha256},
          ${checkpoint.acquisitionManifestPath},
          ${checkpoint.acquisitionManifestSha256},
          ${catalog.checkpointPath},
          ${catalog.checkpointSha256},
          ${catalog.members.length},
          ${catalog.memberBytes},
          ${checkpoint.startedAt},
          ${checkpoint.updatedAt},
          ${transaction.json(metadata)}
        )
        ON CONFLICT (manifest_sha256) DO NOTHING
        RETURNING *
      `
      const manifest = insertedManifest[0] ?? (
        await transaction<ArchiveManifestRow[]>`
          SELECT *
          FROM raw.archive_manifest
          WHERE manifest_sha256 = ${catalog.manifestReceipt.sha256}
        `
      )[0]
      assertArchiveManifestRow(manifest, catalog, manifestObjectId, metadata)

      for (const member of catalog.members) {
        const archiveObjectId = objectIds.get(member.receipt.pathname)
        if (!archiveObjectId) {
          throw new Error(`Archive member object was not registered: ${member.receipt.pathname}`)
        }
        const insertedMember = await transaction<ArchiveMemberRow[]>`
          INSERT INTO raw.archive_manifest_member (
            manifest_id,
            ordinal,
            archive_object_id,
            member_role,
            source_slug,
            dataset_key,
            resource_key,
            source_uri,
            storage_status,
            archived_at
          ) VALUES (
            ${manifest.id},
            ${member.ordinal},
            ${archiveObjectId},
            ${member.memberRole},
            ${member.receipt.sourceSlug},
            ${member.receipt.datasetKey},
            ${member.resourceKey},
            ${member.sourceUri},
            ${member.receipt.storageStatus},
            ${member.receipt.archivedAt}
          )
          ON CONFLICT (manifest_id, ordinal) DO NOTHING
          RETURNING
            ordinal,
            archive_object_id,
            member_role,
            source_slug,
            dataset_key,
            resource_key,
            source_uri,
            storage_status,
            archived_at
        `
        const selectedMember = insertedMember[0] ?? (
          await transaction<ArchiveMemberRow[]>`
            SELECT
              ordinal,
              archive_object_id,
              member_role,
              source_slug,
              dataset_key,
              resource_key,
              source_uri,
              storage_status,
              archived_at
            FROM raw.archive_manifest_member
            WHERE manifest_id = ${manifest.id}
              AND ordinal = ${member.ordinal}
          `
        )[0]
        assertArchiveMemberRow(selectedMember, member, archiveObjectId)
      }

      const [reconciliation] = await transaction<
        { member_count: number; member_bytes: string }[]
      >`
        SELECT
          count(*)::integer AS member_count,
          COALESCE(sum(object_row.byte_length), 0)::text AS member_bytes
        FROM raw.archive_manifest_member AS member
        JOIN raw.archive_object AS object_row ON object_row.id = member.archive_object_id
        WHERE member.manifest_id = ${manifest.id}
      `
      if (
        reconciliation.member_count !== catalog.members.length ||
        BigInt(reconciliation.member_bytes) !== BigInt(catalog.memberBytes)
      ) {
        throw new Error('Registered archive manifest members do not reconcile')
      }
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export function parseRegisterArchiveCatalogArgs(
  args: string[],
): { validateOnly: boolean } {
  if (args.length === 0) return { validateOnly: false }
  if (args.length === 1 && args[0] === '--validate-only') {
    return { validateOnly: true }
  }
  throw new Error('Usage: register-archive-catalog.ts [--validate-only]')
}

export function redactArchiveCatalogError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown archive catalog error'
  return message
    .replace(
      /https:\/\/[^\s"'`]+[.]private[.]blob[.]vercel-storage[.]com\/[^\s"'`]*/giu,
      '[private-blob-uri]',
    )
    .replace(/vercel_blob_rw_[a-z0-9._-]+/giu, '[redacted-blob-token]')
    .replace(
      /(BLOB_READ_WRITE_TOKEN\s*=\s*)[^\s]+/giu,
      '$1[redacted-blob-token]',
    )
}

async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const { validateOnly } = parseRegisterArchiveCatalogArgs(args)
  const evidence = await loadArchiveCatalogEvidence({ root })
  const catalog = validateArchiveCatalog({
    checkpointBody: evidence.checkpointBody,
    checkpointPath: evidence.checkpointPath,
    sourceLockBody: await readFile(sourceLockPath),
    sourceLockPath: relativeToRoot(sourceLockPath),
    acquisitionManifestBody: evidence.acquisitionManifestBody,
    permissionEvidenceBody: await readFile(permissionEvidencePath),
    permissionEvidencePath: relativeToRoot(permissionEvidencePath),
  })
  if (validateOnly) {
    process.stdout.write(
      `Validated archive manifest ${catalog.manifestReceipt.sha256}: ` +
        `${catalog.members.length} members, ${catalog.memberBytes} bytes ` +
        `(checkpoint ${evidence.checkpointSource}, ` +
        `acquisition ${evidence.acquisitionManifestSource})\n`,
    )
    return
  }
  await registerArchiveCatalog(catalog)
  process.stdout.write(
    `Registered archive manifest ${catalog.manifestReceipt.sha256}: ` +
      `${catalog.members.length} members, ${catalog.memberBytes} bytes\n`,
  )
}

const directInvocation =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (directInvocation) {
  main().catch((error: unknown) => {
    process.stderr.write(`${redactArchiveCatalogError(error)}\n`)
    process.exitCode = 1
  })
}
