import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  archiveLogicalMemberKey,
  type ArchiveLogicalMember,
} from './archive-catalog.js'
import {
  archiveRawPayload,
  rawArchivePath,
  type RawArchiveReceipt,
} from './immutable-raw-archive.js'
import { createArchiveCatalogLock } from './archive-catalog-lock.js'
import { VercelPrivateBlobStore } from './vercel-private-blob-store.js'

interface LockedResource {
  bytes: number
  sha256: string
  url: string
}

interface SourceLock {
  sources: Record<string, { resources: Record<string, LockedResource> }>
}

interface AcquiredResource extends LockedResource {
  key: string
  path: string
  source: string
}

interface AcquisitionManifest {
  acquiredAt: string
  sourceLock: { sha256: string }
  resources: AcquiredResource[]
}

interface ArchiveCheckpoint {
  schemaVersion: 'locked-corpus-archive/v1'
  startedAt: string
  updatedAt: string
  status: 'running' | 'complete'
  sourceLockSha256: string
  acquisitionManifestPath: string
  acquisitionManifestSha256: string
  receipts: RawArchiveReceipt[]
  logicalMembers?: ArchiveLogicalMember[]
  manifestReceipt?: RawArchiveReceipt
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDirectory, '../..')
const sourceLockPath = path.join(root, 'data/source-lock.json')
const acquisitionRoot = path.join(root, 'data/manifests/runs')
const archiveManifestRoot = path.join(root, 'data/manifests/archive')
const checkpointPath = path.join(archiveManifestRoot, 'latest.json')
const catalogLockPath = path.join(root, 'data/archive-catalog-lock.json')

const datasetKeyBySource: Record<string, string> = {
  'chadwick-register': 'people-register',
  'sabr-lahman': 'lahman-database',
  retrosheet: 'biofile',
  'fangraphs-prospect-board': 'prospect-board',
}

function sha256(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

function mediaType(filePath: string): string {
  if (filePath.endsWith('.json')) return 'application/json'
  if (filePath.endsWith('.csv')) return 'text/csv'
  if (filePath.endsWith('.md')) return 'text/markdown'
  if (filePath.endsWith('.txt')) return 'text/plain'
  return 'application/octet-stream'
}

export function resolveRawResourcePath(projectRoot: string, resourcePath: string): string {
  const expectedRoot = path.resolve(projectRoot, 'data/raw')
  const resolved = path.resolve(projectRoot, resourcePath)
  const relative = path.relative(expectedRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Locked resource path must remain inside data/raw: ${resourcePath}`)
  }
  return resolved
}

export function matchesLockedResource(
  acquired: AcquiredResource,
  locked: LockedResource,
): boolean {
  return (
    acquired.bytes === locked.bytes &&
    acquired.sha256 === locked.sha256 &&
    acquired.url === locked.url
  )
}

export function recordArchiveLogicalMember(
  checkpoint: Pick<ArchiveCheckpoint, 'receipts' | 'logicalMembers'>,
  member: ArchiveLogicalMember,
): boolean {
  const receipt = checkpoint.receipts.find(
    (candidate) => candidate.pathname === member.objectPathname,
  )
  if (!receipt) {
    throw new Error(
      `Archive logical member ${member.resourceKey} has no physical receipt`,
    )
  }
  checkpoint.logicalMembers ??= []
  const logicalKey = archiveLogicalMemberKey(member)
  const existing = checkpoint.logicalMembers.filter(
    (candidate) => archiveLogicalMemberKey(candidate) === logicalKey,
  )
  if (existing.length > 1) {
    throw new Error(`Archive checkpoint duplicates logical member ${member.resourceKey}`)
  }
  if (existing[0]) {
    if (existing[0].objectPathname !== member.objectPathname) {
      throw new Error(
        `Archive logical member ${member.resourceKey} changed its physical object`,
      )
    }
    return false
  }
  checkpoint.logicalMembers.push(member)
  return true
}

function relativeToRoot(filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function checkpointBody(checkpoint: ArchiveCheckpoint): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(checkpoint, null, 2)}\n`)
}

async function writeCheckpoint(checkpoint: ArchiveCheckpoint): Promise<Uint8Array> {
  await mkdir(archiveManifestRoot, { recursive: true })
  const temporary = `${checkpointPath}.${process.pid}.part`
  const body = checkpointBody(checkpoint)
  await writeFile(temporary, body)
  await rename(temporary, checkpointPath)
  return body
}

async function writeCatalogLock(checkpoint: Uint8Array): Promise<void> {
  const lock = createArchiveCatalogLock(
    checkpoint,
    relativeToRoot(checkpointPath),
  )
  const temporary = `${catalogLockPath}.${process.pid}.part`
  await writeFile(temporary, `${JSON.stringify(lock, null, 2)}\n`)
  await rename(temporary, catalogLockPath)
}

async function latestCompleteAcquisition(
  sourceLock: SourceLock,
  sourceLockSha256: string,
): Promise<{ path: string; body: Uint8Array; manifest: AcquisitionManifest }> {
  const expected = new Map(
    Object.entries(sourceLock.sources).flatMap(([source, entry]) =>
      Object.entries(entry.resources).map(([key, resource]) => [
        `${source}/${key}`,
        resource,
      ] as const),
    ),
  )
  const candidates = (await readdir(acquisitionRoot))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .reverse()
  for (const name of candidates) {
    const manifestPath = path.join(acquisitionRoot, name)
    const body = await readFile(manifestPath)
    const candidate = JSON.parse(body.toString('utf8')) as Partial<AcquisitionManifest>
    if (
      !Array.isArray(candidate.resources) ||
      typeof candidate.sourceLock?.sha256 !== 'string'
    ) {
      continue
    }
    const manifest = candidate as AcquisitionManifest
    const actualKeys = manifest.resources.map(
      (resource) => `${resource.source}/${resource.key}`,
    )
    const actual = new Set(actualKeys)
    if (
      manifest.sourceLock.sha256 === sourceLockSha256 &&
      manifest.resources.length === expected.size &&
      actual.size === expected.size &&
      [...expected].every(([key]) => actual.has(key)) &&
      manifest.resources.every((resource) => {
        const locked = expected.get(`${resource.source}/${resource.key}`)
        return locked !== undefined && matchesLockedResource(resource, locked)
      })
    ) {
      return { path: manifestPath, body, manifest }
    }
  }
  throw new Error('No complete acquisition manifest matches data/source-lock.json')
}

async function loadCheckpoint(
  sourceLockSha256: string,
  acquisitionManifestSha256: string,
): Promise<{ body: Uint8Array; checkpoint: ArchiveCheckpoint } | null> {
  try {
    const body = await readFile(checkpointPath)
    const checkpoint = JSON.parse(body.toString('utf8')) as ArchiveCheckpoint
    if (
      checkpoint.sourceLockSha256 === sourceLockSha256 &&
      checkpoint.acquisitionManifestSha256 === acquisitionManifestSha256
    ) {
      return { body, checkpoint }
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
  return null
}

async function main(): Promise<void> {
  const sourceLockBody = await readFile(sourceLockPath)
  const sourceLockSha256 = sha256(sourceLockBody)
  const sourceLock = JSON.parse(sourceLockBody.toString('utf8')) as SourceLock
  const acquisition = await latestCompleteAcquisition(sourceLock, sourceLockSha256)
  const acquisitionManifestSha256 = sha256(acquisition.body)
  const existing = await loadCheckpoint(
    sourceLockSha256,
    acquisitionManifestSha256,
  )
  if (existing?.checkpoint.status === 'complete' && existing.checkpoint.manifestReceipt) {
    await writeCatalogLock(existing.body)
    process.stdout.write(
      `Archive already complete: ${existing.checkpoint.receipts.length} evidence objects; ` +
        `manifest ${existing.checkpoint.manifestReceipt.sha256}\n`,
    )
    return
  }
  const checkpoint: ArchiveCheckpoint = existing?.checkpoint ?? {
    schemaVersion: 'locked-corpus-archive/v1',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
    sourceLockSha256,
    acquisitionManifestPath: relativeToRoot(acquisition.path),
    acquisitionManifestSha256,
    receipts: [],
    logicalMembers: [],
  }
  checkpoint.status = 'running'
  const archived = new Set(checkpoint.receipts.map((receipt) => receipt.pathname))
  if (archived.size !== checkpoint.receipts.length) {
    throw new Error('Archive checkpoint contains duplicate physical object receipts')
  }
  checkpoint.logicalMembers ??= []
  const store = new VercelPrivateBlobStore()

  const resources = [...acquisition.manifest.resources].sort((left, right) =>
    `${left.source}/${left.key}`.localeCompare(`${right.source}/${right.key}`),
  )
  for (const [index, resource] of resources.entries()) {
    const datasetKey = datasetKeyBySource[resource.source]
    if (!datasetKey) throw new Error(`No archive dataset mapping for ${resource.source}`)
    const expectedPathname = rawArchivePath(
      resource.source,
      datasetKey,
      resource.sha256,
    )
    const logicalMember: ArchiveLogicalMember = {
      sourceSlug: resource.source,
      datasetKey,
      resourceKey: resource.key,
      objectPathname: expectedPathname,
    }
    if (archived.has(expectedPathname)) {
      const receipt = checkpoint.receipts.find(
        (candidate) => candidate.pathname === expectedPathname,
      )
      if (receipt?.mediaType !== mediaType(resource.path)) {
        throw new Error(
          `Logical resource ${resource.source}/${resource.key} has incompatible media metadata`,
        )
      }
      if (recordArchiveLogicalMember(checkpoint, logicalMember)) {
        checkpoint.updatedAt = new Date().toISOString()
        await writeCheckpoint(checkpoint)
      }
      process.stdout.write(`[${index + 1}/${resources.length}] ${resource.source}/${resource.key} cached\n`)
      continue
    }
    const filePath = resolveRawResourcePath(root, resource.path)
    const body = await readFile(filePath)
    const fileStats = await stat(filePath)
    if (
      fileStats.size !== resource.bytes ||
      sha256(body) !== resource.sha256
    ) {
      throw new Error(`Locked resource is missing or changed: ${resource.path}`)
    }
    const receipt = await archiveRawPayload(store, {
      sourceSlug: resource.source,
      datasetKey,
      body,
      expectedSha256: resource.sha256,
      expectedByteLength: resource.bytes,
      mediaType: mediaType(filePath),
    })
    checkpoint.receipts.push(receipt)
    archived.add(receipt.pathname)
    recordArchiveLogicalMember(checkpoint, logicalMember)
    checkpoint.updatedAt = new Date().toISOString()
    await writeCheckpoint(checkpoint)
    process.stdout.write(
      `[${index + 1}/${resources.length}] ${resource.source}/${resource.key} ${receipt.storageStatus}\n`,
    )
  }

  const evidenceFiles = [
    {
      sourceSlug: 'baseball-oracle',
      datasetKey: 'source-lock',
      path: sourceLockPath,
      body: sourceLockBody,
    },
    {
      sourceSlug: 'baseball-oracle',
      datasetKey: 'acquisition-manifest',
      path: acquisition.path,
      body: acquisition.body,
    },
    {
      sourceSlug: 'baseball-oracle',
      datasetKey: 'permission-evidence',
      path: path.join(root, 'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md'),
      body: await readFile(
        path.join(root, 'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md'),
      ),
    },
  ]
  for (const evidence of evidenceFiles) {
    const digest = sha256(evidence.body)
    const expectedPathname = rawArchivePath(
      evidence.sourceSlug,
      evidence.datasetKey,
      digest,
    )
    const logicalMember: ArchiveLogicalMember = {
      sourceSlug: evidence.sourceSlug,
      datasetKey: evidence.datasetKey,
      resourceKey: relativeToRoot(evidence.path),
      objectPathname: expectedPathname,
    }
    let changed = false
    if (!archived.has(expectedPathname)) {
      const receipt = await archiveRawPayload(store, {
        sourceSlug: evidence.sourceSlug,
        datasetKey: evidence.datasetKey,
        body: evidence.body,
        expectedSha256: digest,
        expectedByteLength: evidence.body.byteLength,
        mediaType: mediaType(evidence.path),
      })
      checkpoint.receipts.push(receipt)
      archived.add(receipt.pathname)
      changed = true
    }
    if (recordArchiveLogicalMember(checkpoint, logicalMember)) changed = true
    if (changed) {
      checkpoint.updatedAt = new Date().toISOString()
      await writeCheckpoint(checkpoint)
    }
  }

  const expectedLogicalMemberCount = resources.length + evidenceFiles.length
  if (checkpoint.logicalMembers.length !== expectedLogicalMemberCount) {
    throw new Error(
      `Archive logical member count mismatch: expected ${expectedLogicalMemberCount}, ` +
        `received ${checkpoint.logicalMembers.length}`,
    )
  }
  checkpoint.status = 'complete'
  checkpoint.updatedAt = new Date().toISOString()
  const manifestBody = new TextEncoder().encode(
    `${JSON.stringify({ ...checkpoint, manifestReceipt: undefined }, null, 2)}\n`,
  )
  checkpoint.manifestReceipt = await archiveRawPayload(store, {
    sourceSlug: 'baseball-oracle',
    datasetKey: 'archive-manifest',
    body: manifestBody,
    expectedSha256: sha256(manifestBody),
    expectedByteLength: manifestBody.byteLength,
    mediaType: 'application/json',
  })
  const finalCheckpointBody = await writeCheckpoint(checkpoint)
  await writeCatalogLock(finalCheckpointBody)
  process.stdout.write(
    `Archived ${checkpoint.receipts.length} evidence objects; manifest ${checkpoint.manifestReceipt.sha256}\n`,
  )
}

const directInvocation =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (directInvocation) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unknown archive error'}\n`)
    process.exitCode = 1
  })
}
