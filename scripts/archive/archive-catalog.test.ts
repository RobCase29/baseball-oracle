import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_MEMBER_BYTE_SEMANTICS,
  validateArchiveCatalog,
} from './archive-catalog.js'
import { createArchiveCatalogLock } from './archive-catalog-lock.js'
import { rawArchivePath, type RawArchiveReceipt } from './immutable-raw-archive.js'

const encoder = new TextEncoder()

function sha256(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

function jsonBody(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`)
}

function receipt(
  sourceSlug: string,
  datasetKey: string,
  body: Uint8Array,
  mediaType: string,
): RawArchiveReceipt {
  const digest = sha256(body)
  const pathname = rawArchivePath(sourceSlug, datasetKey, digest)
  return {
    schemaVersion: 'raw-archive-receipt/v1',
    sourceSlug,
    datasetKey,
    sha256: digest,
    byteLength: body.byteLength,
    mediaType,
    pathname,
    objectUri: `https://test.private.blob.vercel-storage.com/${pathname}`,
    etag: `"${digest.slice(0, 16)}"`,
    storageStatus: 'created',
    archivedAt: '2026-07-11T20:01:00.000Z',
  }
}

type DuplicateMode = 'none' | 'different-paths' | 'shared-object'

function fixture(duplicateMode: DuplicateMode = 'none') {
  const duplicateRawDigest = duplicateMode !== 'none'
  const sharedObject = duplicateMode === 'shared-object'
  const rawBody = encoder.encode('same immutable raw bytes')
  const retrosheetResources: Record<
    string,
    { bytes: number; sha256: string; url: string }
  > = {
    'biofile0.csv': {
      bytes: rawBody.byteLength,
      sha256: sha256(rawBody),
      url: 'https://example.test/biofile0.csv',
    },
  }
  if (sharedObject) {
    retrosheetResources['biofile-copy.csv'] = {
      bytes: rawBody.byteLength,
      sha256: sha256(rawBody),
      url: 'https://example.test/biofile-copy.csv',
    }
  }
  const sourceLock = {
    sources: {
      retrosheet: {
        resources: retrosheetResources,
      },
      ...(duplicateRawDigest && !sharedObject
        ? {
            'sabr-lahman': {
              resources: {
                'People.csv': {
                  bytes: rawBody.byteLength,
                  sha256: sha256(rawBody),
                  url: 'https://example.test/People.csv',
                },
              },
            },
          }
        : {}),
    },
  }
  const sourceLockBody = jsonBody(sourceLock)
  const sourceLockSha256 = sha256(sourceLockBody)
  const resources = [
    {
      source: 'retrosheet',
      key: 'biofile0.csv',
      path: 'data/raw/retrosheet/biofile0.csv',
      ...sourceLock.sources.retrosheet.resources['biofile0.csv'],
    },
    ...(sharedObject
      ? [
          {
            source: 'retrosheet',
            key: 'biofile-copy.csv',
            path: 'data/raw/retrosheet/biofile-copy.csv',
            ...sourceLock.sources.retrosheet.resources['biofile-copy.csv'],
          },
        ]
      : []),
    ...(duplicateRawDigest && !sharedObject
      ? [
          {
            source: 'sabr-lahman',
            key: 'People.csv',
            path: 'data/raw/sabr-lahman/People.csv',
            bytes: rawBody.byteLength,
            sha256: sha256(rawBody),
            url: 'https://example.test/People.csv',
          },
        ]
      : []),
  ]
  const acquisitionManifest = {
    acquiredAt: '2026-07-11T20:00:00.000Z',
    sourceLock: { sha256: sourceLockSha256 },
    resources,
  }
  const acquisitionManifestBody = jsonBody(acquisitionManifest)
  const permissionEvidenceBody = encoder.encode('research permission evidence\n')
  const rawReceipt = receipt('retrosheet', 'biofile', rawBody, 'text/csv')
  const sourceLockReceipt = receipt(
    'baseball-oracle',
    'source-lock',
    sourceLockBody,
    'application/json',
  )
  const acquisitionReceipt = receipt(
    'baseball-oracle',
    'acquisition-manifest',
    acquisitionManifestBody,
    'application/json',
  )
  const permissionReceipt = receipt(
    'baseball-oracle',
    'permission-evidence',
    permissionEvidenceBody,
    'text/markdown',
  )
  const receipts = [
    rawReceipt,
    ...(duplicateRawDigest && !sharedObject
      ? [receipt('sabr-lahman', 'lahman-database', rawBody, 'text/csv')]
      : []),
    sourceLockReceipt,
    acquisitionReceipt,
    permissionReceipt,
  ]
  const logicalMembers = sharedObject
    ? [
        {
          sourceSlug: 'retrosheet',
          datasetKey: 'biofile',
          resourceKey: 'biofile0.csv',
          objectPathname: rawReceipt.pathname,
        },
        {
          sourceSlug: 'retrosheet',
          datasetKey: 'biofile',
          resourceKey: 'biofile-copy.csv',
          objectPathname: rawReceipt.pathname,
        },
        {
          sourceSlug: 'baseball-oracle',
          datasetKey: 'source-lock',
          resourceKey: 'data/source-lock.json',
          objectPathname: sourceLockReceipt.pathname,
        },
        {
          sourceSlug: 'baseball-oracle',
          datasetKey: 'acquisition-manifest',
          resourceKey: 'data/manifests/runs/acquisition.json',
          objectPathname: acquisitionReceipt.pathname,
        },
        {
          sourceSlug: 'baseball-oracle',
          datasetKey: 'permission-evidence',
          resourceKey: 'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md',
          objectPathname: permissionReceipt.pathname,
        },
      ]
    : undefined
  const checkpointWithoutManifest = {
    schemaVersion: 'locked-corpus-archive/v1',
    startedAt: '2026-07-11T20:00:00.000Z',
    updatedAt: '2026-07-11T20:02:00.000Z',
    status: 'complete',
    sourceLockSha256,
    acquisitionManifestPath: 'data/manifests/runs/acquisition.json',
    acquisitionManifestSha256: sha256(acquisitionManifestBody),
    receipts,
    ...(logicalMembers ? { logicalMembers } : {}),
  }
  const manifestBody = jsonBody(checkpointWithoutManifest)
  const checkpoint = {
    ...checkpointWithoutManifest,
    manifestReceipt: receipt(
      'baseball-oracle',
      'archive-manifest',
      manifestBody,
      'application/json',
    ),
  }
  return {
    checkpoint,
    rawBody,
    input: {
      checkpointBody: jsonBody(checkpoint),
      checkpointPath: 'data/manifests/archive/latest.json',
      sourceLockBody,
      sourceLockPath: 'data/source-lock.json',
      acquisitionManifestBody,
      permissionEvidenceBody,
      permissionEvidencePath:
        'docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md',
    },
  }
}

describe('archive catalog validation', () => {
  it('reconciles member counts, bytes, hashes, and private object metadata', () => {
    const { input } = fixture()

    const catalog = validateArchiveCatalog(input)

    expect(catalog.members).toHaveLength(4)
    expect(catalog.acquisitionResourceCount).toBe(1)
    expect(catalog.memberBytes).toBe(
      catalog.members.reduce((total, member) => total + member.receipt.byteLength, 0),
    )
    expect(catalog.members.map((member) => member.memberRole)).toEqual([
      'raw_payload',
      'source_lock',
      'acquisition_manifest',
      'permission_evidence',
    ])
  })

  it('preserves identical bytes archived under different logical paths', () => {
    const { input } = fixture('different-paths')

    const catalog = validateArchiveCatalog(input)

    const rawMembers = catalog.members.filter(
      (member) => member.memberRole === 'raw_payload',
    )
    expect(rawMembers).toHaveLength(2)
    expect(rawMembers[0].receipt.sha256).toBe(rawMembers[1].receipt.sha256)
    expect(rawMembers[0].receipt.pathname).not.toBe(rawMembers[1].receipt.pathname)
  })

  it('preserves two logical resources that share one physical object', () => {
    const { input, rawBody } = fixture('shared-object')

    const catalog = validateArchiveCatalog(input)
    const lock = createArchiveCatalogLock(
      input.checkpointBody,
      input.checkpointPath,
    )
    const rawMembers = catalog.members.filter(
      (member) => member.memberRole === 'raw_payload',
    )

    expect(rawMembers.map((member) => member.resourceKey)).toEqual([
      'biofile0.csv',
      'biofile-copy.csv',
    ])
    expect(rawMembers[0].receipt.pathname).toBe(rawMembers[1].receipt.pathname)
    expect(catalog.members).toHaveLength(5)
    expect(catalog.objectCount).toBe(4)
    expect(catalog.memberBytes).toBe(
      catalog.members.reduce(
        (total, member) => total + member.receipt.byteLength,
        0,
      ),
    )
    expect(catalog.memberBytes).toBeGreaterThan(
      catalog.members
        .filter((member, index, members) =>
          members.findIndex(
            (candidate) => candidate.receipt.pathname === member.receipt.pathname,
          ) === index,
        )
        .reduce((total, member) => total + member.receipt.byteLength, 0),
    )
    expect(lock.checkpoint).toMatchObject({
      memberCount: 5,
      memberBytes: catalog.memberBytes,
      memberByteSemantics: ARCHIVE_MEMBER_BYTE_SEMANTICS,
    })
    expect(rawBody.byteLength).toBe(rawMembers[0].receipt.byteLength)
  })

  it('requires an explicit logical map when physical objects are shared', () => {
    const { checkpoint, input } = fixture('shared-object')
    const rawCheckpoint = { ...checkpoint } as Record<string, unknown>
    delete rawCheckpoint.logicalMembers
    delete rawCheckpoint.manifestReceipt
    const manifestBody = jsonBody(rawCheckpoint)
    const withoutLogicalMembers = {
      ...rawCheckpoint,
      manifestReceipt: receipt(
        'baseball-oracle',
        'archive-manifest',
        manifestBody,
        'application/json',
      ),
    }
    input.checkpointBody = jsonBody(withoutLogicalMembers)

    expect(() => validateArchiveCatalog(input)).toThrow(
      'requires logicalMembers',
    )
  })

  it('rejects public or non-Vercel object metadata', () => {
    const { checkpoint, input } = fixture()
    checkpoint.receipts[0].objectUri = 'https://public.example.test/raw-object'
    input.checkpointBody = jsonBody(checkpoint)

    expect(() => validateArchiveCatalog(input)).toThrow(
      'not private Vercel Blob HTTPS metadata',
    )
  })

  it('rejects a checkpoint whose archived manifest hash no longer matches', () => {
    const { checkpoint, input } = fixture()
    checkpoint.updatedAt = '2026-07-11T20:03:00.000Z'
    input.checkpointBody = jsonBody(checkpoint)

    expect(() => validateArchiveCatalog(input)).toThrow(
      'does not match the reconstructed manifest bytes',
    )
  })

  it('rejects source-lock or acquisition count drift', () => {
    const { input } = fixture()
    const acquisition = JSON.parse(
      new TextDecoder().decode(input.acquisitionManifestBody),
    ) as { resources: unknown[] }
    acquisition.resources = []
    input.acquisitionManifestBody = jsonBody(acquisition)

    expect(() => validateArchiveCatalog(input)).toThrow()
  })
})
