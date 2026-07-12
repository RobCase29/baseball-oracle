import { describe, expect, it } from 'vitest'
import {
  assertArchiveObjectRow,
  parseRegisterArchiveCatalogArgs,
  redactArchiveCatalogError,
  uniqueArchiveObjectReceipts,
} from './register-archive-catalog.js'

describe('archive catalog registration CLI', () => {
  it('supports an explicit validation-only mode and rejects unknown arguments', () => {
    expect(parseRegisterArchiveCatalogArgs([])).toEqual({ validateOnly: false })
    expect(parseRegisterArchiveCatalogArgs(['--validate-only'])).toEqual({
      validateOnly: true,
    })
    expect(() => parseRegisterArchiveCatalogArgs(['--unknown'])).toThrow('Usage:')
  })

  it('redacts private Blob URLs and credentials from top-level errors', () => {
    const message = redactArchiveCatalogError(
      new Error(
        'failed https://store.private.blob.vercel-storage.com/raw/object ' +
          'BLOB_READ_WRITE_TOKEN=vercel_blob_rw_example-token',
      ),
    )

    expect(message).toContain('[private-blob-uri]')
    expect(message).toContain('[redacted-blob-token]')
    expect(message).not.toContain('raw/object')
    expect(message).not.toContain('example-token')
  })

  it('reuses immutable content when provider receipt metadata is normalized later', () => {
    const receipt = {
      schemaVersion: 'raw-archive-receipt/v1' as const,
      sourceSlug: 'source',
      datasetKey: 'dataset',
      sha256: 'a'.repeat(64),
      byteLength: 7,
      mediaType: 'text/plain',
      pathname: `raw/v1/source/dataset/sha256/aa/${'a'.repeat(64)}`,
      objectUri: 'https://new.private.blob.vercel-storage.com/raw/object',
      etag: 'new-etag',
      storageStatus: 'already-exists' as const,
      archivedAt: '2026-07-12T01:00:00.000Z',
    }
    const row = {
      id: 'object-id',
      sha256: receipt.sha256,
      byte_length: '7',
      media_type: 'text/plain',
      content_encoding: null,
      storage_provider: 'vercel_blob',
      access_scope: 'private',
      pathname: receipt.pathname,
      object_uri: 'https://original.private.blob.vercel-storage.com/raw/object',
      etag: 'original-etag',
      archived_at: new Date('2026-07-11T20:00:00.000Z'),
    }

    expect(() => assertArchiveObjectRow(row, receipt)).not.toThrow()
    expect(uniqueArchiveObjectReceipts([receipt, { ...receipt }])).toEqual([
      receipt,
    ])
    expect(() =>
      assertArchiveObjectRow({ ...row, sha256: 'b'.repeat(64) }, receipt),
    ).toThrow('conflicts')
  })
})
