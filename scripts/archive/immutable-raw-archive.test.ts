import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  archiveRawPayload,
  rawArchivePath,
  requiresMultipart,
  type ImmutableObjectStore,
  type ImmutableStorePutRequest,
  type ImmutableStorePutResult,
} from './immutable-raw-archive.js'

class MemoryCreateOnlyStore implements ImmutableObjectStore {
  readonly objects = new Map<string, Uint8Array>()
  requests: ImmutableStorePutRequest[] = []

  async putIfAbsent(
    request: ImmutableStorePutRequest,
  ): Promise<ImmutableStorePutResult> {
    this.requests.push(request)
    const existing = this.objects.get(request.pathname)
    if (existing) {
      return {
        status: 'already-exists',
        pathname: request.pathname,
        objectUri: `https://archive.private.blob.vercel-storage.com/${request.pathname}`,
        byteLength: existing.byteLength,
        etag: 'existing-etag',
      }
    }

    this.objects.set(request.pathname, request.body.slice())
    return {
      status: 'created',
      pathname: request.pathname,
      objectUri: `https://archive.private.blob.vercel-storage.com/${request.pathname}`,
      byteLength: request.body.byteLength,
      etag: 'created-etag',
    }
  }
}

function sha256(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

describe('immutable raw archive', () => {
  it('stores exact UTF-8 bytes at a deterministic content-addressed path', async () => {
    const store = new MemoryCreateOnlyStore()
    const body = '{"player":"Jos\u00e9 Ram\u00edrez"}'
    const bytes = new TextEncoder().encode(body)
    const digest = sha256(body)

    const receipt = await archiveRawPayload(
      store,
      {
        sourceSlug: 'fangraphs',
        datasetKey: 'prospect-board',
        body,
        expectedSha256: digest,
        expectedByteLength: bytes.byteLength,
        mediaType: 'application/json',
      },
      () => new Date('2026-07-11T20:00:00.000Z'),
    )

    expect(receipt.pathname).toBe(
      `raw/v1/fangraphs/prospect-board/sha256/${digest.slice(0, 2)}/${digest}`,
    )
    expect(receipt.storageStatus).toBe('created')
    expect(receipt.archivedAt).toBe('2026-07-11T20:00:00.000Z')
    expect(store.requests[0]).toMatchObject({
      contentType: 'application/json',
      multipart: false,
    })
    expect(store.objects.get(receipt.pathname)).toEqual(bytes)
  })

  it('is idempotent when the exact content-addressed object already exists', async () => {
    const store = new MemoryCreateOnlyStore()
    const body = 'same immutable response'
    const input = {
      sourceSlug: 'retrosheet',
      datasetKey: 'event-files',
      body,
      expectedSha256: sha256(body),
      expectedByteLength: body.length,
      mediaType: 'text/plain',
    }

    const first = await archiveRawPayload(store, input)
    const second = await archiveRawPayload(store, input)

    expect(first.storageStatus).toBe('created')
    expect(second.storageStatus).toBe('already-exists')
    expect(store.objects).toHaveLength(1)
  })

  it('fails before storage when the declared bytes or digest do not match', async () => {
    const store = new MemoryCreateOnlyStore()
    const body = 'payload'

    await expect(
      archiveRawPayload(store, {
        sourceSlug: 'fangraphs',
        datasetKey: 'prospect-board',
        body,
        expectedSha256: '0'.repeat(64),
        expectedByteLength: body.length,
        mediaType: 'application/json',
      }),
    ).rejects.toThrow('digest mismatch')

    await expect(
      archiveRawPayload(store, {
        sourceSlug: 'fangraphs',
        datasetKey: 'prospect-board',
        body,
        expectedSha256: sha256(body),
        expectedByteLength: body.length + 1,
        mediaType: 'application/json',
      }),
    ).rejects.toThrow('length mismatch')

    expect(store.requests).toHaveLength(0)
  })

  it('rejects traversal, ambiguous digests, and invalid provider receipts', async () => {
    expect(() => rawArchivePath('../fangraphs', 'prospects', 'a'.repeat(64))).toThrow(
      'storage-safe identifier',
    )
    expect(() => rawArchivePath('fangraphs', 'prospects', 'A'.repeat(64))).toThrow(
      'lowercase hexadecimal',
    )

    const body = 'payload'
    const badStore: ImmutableObjectStore = {
      putIfAbsent: async (request) => ({
        status: 'created',
        pathname: `${request.pathname}-wrong`,
        objectUri: 'https://archive.example/wrong',
        byteLength: request.body.byteLength,
      }),
    }

    await expect(
      archiveRawPayload(badStore, {
        sourceSlug: 'fangraphs',
        datasetKey: 'prospects',
        body,
        expectedSha256: sha256(body),
        expectedByteLength: body.length,
        mediaType: 'application/json',
      }),
    ).rejects.toThrow('unexpected pathname')
  })

  it('selects multipart storage only above the provider recommendation', () => {
    expect(requiresMultipart(100_000_000)).toBe(false)
    expect(requiresMultipart(100_000_001)).toBe(true)
    expect(() => requiresMultipart(-1)).toThrow('non-negative safe integer')
  })
})
