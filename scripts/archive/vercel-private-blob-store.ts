import { createHash } from 'node:crypto'
import { get as vercelGet, put as vercelPut } from '@vercel/blob'
import type {
  ImmutableObjectStore,
  ImmutableStorePutRequest,
  ImmutableStorePutResult,
} from './immutable-raw-archive.js'

interface BlobPutResult {
  pathname: string
  url: string
  etag: string
}

interface BlobGetResult {
  statusCode: number
  stream: ReadableStream<Uint8Array> | null
  blob: {
    pathname: string
    url: string
    size: number | null
    etag: string
  }
}

export interface PrivateBlobClient {
  put(
    pathname: string,
    body: Buffer,
    options: {
      access: 'private'
      addRandomSuffix: false
      allowOverwrite: false
      contentType: string
      multipart: boolean
    },
  ): Promise<BlobPutResult>
  get(
    pathname: string,
    options: { access: 'private'; useCache: false },
  ): Promise<BlobGetResult | null>
}

const defaultClient: PrivateBlobClient = {
  put: vercelPut,
  get: vercelGet,
}

async function streamEvidence(
  stream: ReadableStream<Uint8Array>,
): Promise<{ sha256: string; byteLength: number }> {
  const digest = createHash('sha256')
  const reader = stream.getReader()
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    digest.update(value)
    byteLength += value.byteLength
  }
  return { sha256: digest.digest('hex'), byteLength }
}

export class VercelPrivateBlobStore implements ImmutableObjectStore {
  constructor(private readonly client: PrivateBlobClient = defaultClient) {}

  async putIfAbsent(
    request: ImmutableStorePutRequest,
  ): Promise<ImmutableStorePutResult> {
    try {
      const created = await this.client.put(
        request.pathname,
        Buffer.from(request.body),
        {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: request.contentType,
          multipart: request.multipart,
        },
      )
      return {
        status: 'created',
        pathname: created.pathname,
        objectUri: created.url,
        byteLength: request.body.byteLength,
        etag: created.etag,
      }
    } catch (uploadError) {
      const existing = await this.client.get(request.pathname, {
        access: 'private',
        useCache: false,
      })
      if (
        existing?.statusCode !== 200 ||
        existing.stream === null ||
        existing.blob.size === null
      ) {
        throw uploadError
      }

      const expectedDigest = request.pathname.split('/').at(-1)
      const streamed = await streamEvidence(existing.stream)
      if (
        existing.blob.pathname !== request.pathname ||
        (existing.blob.size !== 0 &&
          existing.blob.size !== request.body.byteLength) ||
        streamed.byteLength !== request.body.byteLength ||
        streamed.sha256 !== expectedDigest
      ) {
        throw new Error(`Content-addressed Blob collision at ${request.pathname}`)
      }
      return {
        status: 'already-exists',
        pathname: existing.blob.pathname,
        objectUri: existing.blob.url,
        byteLength: streamed.byteLength,
        etag: existing.blob.etag,
      }
    }
  }
}
