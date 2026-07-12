import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createArchiveCatalogLock,
  parseArchiveCatalogLock,
} from './archive-catalog-lock.js'
import {
  loadArchiveCatalogEvidence,
  type ArchiveBlobReader,
} from './archive-catalog-loader.js'
import { rawArchivePath, type RawArchiveReceipt } from './immutable-raw-archive.js'
import { createHash } from 'node:crypto'

const encoder = new TextEncoder()

function sha256(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

function jsonBody(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`)
}

function stream(body: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(body)
      controller.close()
    },
  })
}

function missingFile(filePath: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`Missing test file ${filePath}`), {
    code: 'ENOENT',
  })
}

function receipt(
  sourceSlug: string,
  datasetKey: string,
  body: Uint8Array,
  objectUri: string,
  etag: string,
): RawArchiveReceipt {
  const digest = sha256(body)
  return {
    schemaVersion: 'raw-archive-receipt/v1',
    sourceSlug,
    datasetKey,
    sha256: digest,
    byteLength: body.byteLength,
    mediaType: 'application/json',
    pathname: rawArchivePath(sourceSlug, datasetKey, digest),
    objectUri,
    etag,
    storageStatus: 'created',
    archivedAt: '2026-07-11T20:01:00.000Z',
  }
}

function fixture(sharedLogicalObject = false) {
  const root = path.resolve('/workspace/baseball-oracle')
  const checkpointPath = 'data/manifests/archive/latest.json'
  const acquisitionPath = 'data/manifests/runs/acquisition.json'
  const acquisitionBody = jsonBody({ acquiredAt: '2026-07-11T20:00:00.000Z' })
  const acquisition = receipt(
    'baseball-oracle',
    'acquisition-manifest',
    acquisitionBody,
    'https://fixture.private.blob.vercel-storage.com/acquisition',
    'acquisition-etag',
  )
  const manifest = {
    schemaVersion: 'locked-corpus-archive/v1',
    startedAt: '2026-07-11T20:00:00.000Z',
    updatedAt: '2026-07-11T20:02:00.000Z',
    status: 'complete',
    sourceLockSha256: 'a'.repeat(64),
    acquisitionManifestPath: acquisitionPath,
    acquisitionManifestSha256: sha256(acquisitionBody),
    receipts: [acquisition],
    ...(sharedLogicalObject
      ? {
          logicalMembers: [
            {
              sourceSlug: acquisition.sourceSlug,
              datasetKey: acquisition.datasetKey,
              resourceKey: 'acquisition-primary.json',
              objectPathname: acquisition.pathname,
            },
            {
              sourceSlug: acquisition.sourceSlug,
              datasetKey: acquisition.datasetKey,
              resourceKey: 'acquisition-copy.json',
              objectPathname: acquisition.pathname,
            },
          ],
        }
      : {}),
  } as const
  const manifestBody = jsonBody(manifest)
  const manifestReceipt = receipt(
    'baseball-oracle',
    'archive-manifest',
    manifestBody,
    'https://fixture.private.blob.vercel-storage.com/archive-manifest',
    'manifest-etag',
  )
  const checkpointBody = jsonBody({ ...manifest, manifestReceipt })
  const lock = createArchiveCatalogLock(checkpointBody, checkpointPath)
  const lockBody = jsonBody(lock)
  const lockPath = path.join(root, 'data/archive-catalog-lock.json')
  const localCheckpointPath = path.join(root, checkpointPath)
  const localAcquisitionPath = path.join(root, acquisitionPath)
  const objects = new Map([
    [
      manifestReceipt.pathname,
      {
        body: manifestBody,
        contentType: manifestReceipt.mediaType,
        url: manifestReceipt.objectUri,
        etag: manifestReceipt.etag as string,
      },
    ],
    [
      acquisition.pathname,
      {
        body: acquisitionBody,
        contentType: acquisition.mediaType,
        url: acquisition.objectUri,
        etag: acquisition.etag as string,
      },
    ],
  ])
  const get = vi.fn<ArchiveBlobReader['get']>(async (pathname, options) => {
    expect(options).toEqual({ access: 'private', useCache: false })
    const object = objects.get(pathname)
    if (!object) return null
    return {
      statusCode: 200,
      stream: stream(object.body),
      blob: {
        pathname,
        url: object.url.replace('fixture.private', 'Fixture.private'),
        size: pathname === manifestReceipt.pathname ? 0 : object.body.byteLength,
        etag: `W/${object.etag}`,
        contentType: object.contentType,
      },
    }
  })
  return {
    root,
    checkpointBody,
    acquisitionBody,
    lock,
    lockBody,
    lockPath,
    localCheckpointPath,
    localAcquisitionPath,
    blobReader: { get } satisfies ArchiveBlobReader,
    get,
  }
}

describe('archive catalog evidence loader', () => {
  it('reconstructs the ignored checkpoint and acquisition manifest from private Blob', async () => {
    const data = fixture()
    const files = new Map([[data.lockPath, data.lockBody]])

    const evidence = await loadArchiveCatalogEvidence({
      root: data.root,
      readBytes: async (filePath) => files.get(filePath) ?? Promise.reject(missingFile(filePath)),
      blobReader: data.blobReader,
    })

    expect(evidence.checkpointBody).toEqual(data.checkpointBody)
    expect(evidence.acquisitionManifestBody).toEqual(data.acquisitionBody)
    expect(evidence.checkpointSource).toBe('blob')
    expect(evidence.acquisitionManifestSource).toBe('blob')
    expect(data.get).toHaveBeenCalledTimes(2)
  })

  it('uses exact local evidence without contacting Blob', async () => {
    const data = fixture()
    const files = new Map([
      [data.lockPath, data.lockBody],
      [data.localCheckpointPath, data.checkpointBody],
      [data.localAcquisitionPath, data.acquisitionBody],
    ])

    const evidence = await loadArchiveCatalogEvidence({
      root: data.root,
      readBytes: async (filePath) => files.get(filePath) ?? Promise.reject(missingFile(filePath)),
      blobReader: data.blobReader,
    })

    expect(evidence.checkpointSource).toBe('local')
    expect(evidence.acquisitionManifestSource).toBe('local')
    expect(data.get).not.toHaveBeenCalled()
  })

  it('reconstructs a checkpoint whose logical members share an object', async () => {
    const data = fixture(true)
    const files = new Map([[data.lockPath, data.lockBody]])

    const evidence = await loadArchiveCatalogEvidence({
      root: data.root,
      readBytes: async (filePath) => files.get(filePath) ?? Promise.reject(missingFile(filePath)),
      blobReader: data.blobReader,
    })

    expect(evidence.checkpointBody).toEqual(data.checkpointBody)
    expect(evidence.lock.checkpoint.memberCount).toBe(2)
    expect(evidence.lock.checkpoint.memberBytes).toBe(
      data.acquisitionBody.byteLength * 2,
    )
  })

  it('fails closed on a changed local checkpoint instead of falling back to Blob', async () => {
    const data = fixture()
    const files = new Map([
      [data.lockPath, data.lockBody],
      [data.localCheckpointPath, encoder.encode('{"changed":true}\n')],
    ])

    await expect(
      loadArchiveCatalogEvidence({
        root: data.root,
        readBytes: async (filePath) => files.get(filePath) ?? Promise.reject(missingFile(filePath)),
        blobReader: data.blobReader,
      }),
    ).rejects.toThrow('checkpoint digest differs')
    expect(data.get).not.toHaveBeenCalled()
  })

  it('rejects secret-bearing fields in the committed lock', () => {
    const data = fixture()
    expect(() =>
      parseArchiveCatalogLock(
        jsonBody({ ...data.lock, objectUri: 'https://example.test/private' }),
      ),
    ).toThrow()
  })
})
