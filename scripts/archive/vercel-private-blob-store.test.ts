import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  VercelPrivateBlobStore,
  type PrivateBlobClient,
} from './vercel-private-blob-store.js'

function stream(body: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(body)
      controller.close()
    },
  })
}

function request(body: string) {
  const bytes = new TextEncoder().encode(body)
  const digest = createHash('sha256').update(bytes).digest('hex')
  return {
    pathname: `raw/v1/source/dataset/sha256/${digest.slice(0, 2)}/${digest}`,
    body: bytes,
    contentType: 'application/json',
    multipart: false,
  }
}

describe('Vercel private Blob archive adapter', () => {
  it('creates a private non-overwritable object with an exact pathname', async () => {
    const input = request('{"ok":true}')
    const client: PrivateBlobClient = {
      put: async (pathname, body, options) => {
        expect(body).toEqual(Buffer.from(input.body))
        expect(options).toMatchObject({
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
        })
        return {
          pathname,
          url: `https://store.private.blob.vercel-storage.com/${pathname}`,
          etag: 'created',
        }
      },
      get: async () => null,
    }

    await expect(
      new VercelPrivateBlobStore(client).putIfAbsent(input),
    ).resolves.toMatchObject({ status: 'created', pathname: input.pathname })
  })

  it('verifies exact existing bytes before accepting an idempotent replay', async () => {
    const input = request('{"same":true}')
    const client: PrivateBlobClient = {
      put: async () => {
        throw new Error('pathname already exists')
      },
      get: async (pathname) => ({
        statusCode: 200,
        stream: stream(input.body),
        blob: {
          pathname,
          url: `https://store.private.blob.vercel-storage.com/${pathname}`,
          // Vercel can omit Content-Length for a private streamed response.
          size: 0,
          etag: 'existing',
        },
      }),
    }

    await expect(
      new VercelPrivateBlobStore(client).putIfAbsent(input),
    ).resolves.toMatchObject({
      status: 'already-exists',
      etag: 'existing',
      byteLength: input.body.byteLength,
    })
  })

  it('fails closed when an existing content-addressed object is corrupted', async () => {
    const input = request('{"expected":true}')
    const wrong = new TextEncoder().encode('{"expected":fals}')
    expect(wrong.byteLength).toBe(input.body.byteLength)
    const client: PrivateBlobClient = {
      put: async () => {
        throw new Error('pathname already exists')
      },
      get: async (pathname) => ({
        statusCode: 200,
        stream: stream(wrong),
        blob: {
          pathname,
          url: `https://store.private.blob.vercel-storage.com/${pathname}`,
          size: wrong.byteLength,
          etag: 'wrong',
        },
      }),
    }

    await expect(
      new VercelPrivateBlobStore(client).putIfAbsent(input),
    ).rejects.toThrow('Content-addressed Blob collision')
  })
})
