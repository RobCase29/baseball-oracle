import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  matchesLockedResource,
  recordArchiveLogicalMember,
  resolveRawResourcePath,
} from './archive-locked-corpus.js'
import { rawArchivePath, type RawArchiveReceipt } from './immutable-raw-archive.js'

describe('locked corpus archive input validation', () => {
  it('resolves only files contained by the project raw root', () => {
    const root = path.resolve('/tmp/baseball-oracle')

    expect(
      resolveRawResourcePath(root, 'data/raw/source/version/payload.json'),
    ).toBe(path.join(root, 'data/raw/source/version/payload.json'))
    expect(() => resolveRawResourcePath(root, '../secret')).toThrow(
      'must remain inside data/raw',
    )
    expect(() => resolveRawResourcePath(root, '/tmp/outside.json')).toThrow(
      'must remain inside data/raw',
    )
    expect(() => resolveRawResourcePath(root, 'data/raw')).toThrow(
      'must remain inside data/raw',
    )
  })

  it('requires acquisition bytes, digest, and URL to match the source lock', () => {
    const locked = {
      bytes: 7,
      sha256: 'a'.repeat(64),
      url: 'https://example.test/payload',
    }
    const acquired = {
      ...locked,
      key: 'payload',
      path: 'data/raw/source/payload',
      source: 'source',
    }

    expect(matchesLockedResource(acquired, locked)).toBe(true)
    expect(matchesLockedResource({ ...acquired, bytes: 8 }, locked)).toBe(false)
    expect(
      matchesLockedResource({ ...acquired, sha256: 'b'.repeat(64) }, locked),
    ).toBe(false)
    expect(
      matchesLockedResource(
        { ...acquired, url: 'https://example.test/substitute' },
        locked,
      ),
    ).toBe(false)
  })

  it('records distinct logical resources against one physical receipt', () => {
    const digest = 'a'.repeat(64)
    const pathname = rawArchivePath('retrosheet', 'biofile', digest)
    const receipt: RawArchiveReceipt = {
      schemaVersion: 'raw-archive-receipt/v1',
      sourceSlug: 'retrosheet',
      datasetKey: 'biofile',
      sha256: digest,
      byteLength: 7,
      mediaType: 'text/csv',
      pathname,
      objectUri: `https://test.private.blob.vercel-storage.com/${pathname}`,
      storageStatus: 'created',
      archivedAt: '2026-07-11T20:00:00.000Z',
    }
    const checkpoint = { receipts: [receipt], logicalMembers: [] }
    const first = {
      sourceSlug: 'retrosheet',
      datasetKey: 'biofile',
      resourceKey: 'first.csv',
      objectPathname: pathname,
    }
    const second = { ...first, resourceKey: 'second.csv' }

    expect(recordArchiveLogicalMember(checkpoint, first)).toBe(true)
    expect(recordArchiveLogicalMember(checkpoint, second)).toBe(true)
    expect(recordArchiveLogicalMember(checkpoint, first)).toBe(false)
    expect(checkpoint.receipts).toHaveLength(1)
    expect(checkpoint.logicalMembers).toEqual([first, second])
  })
})
