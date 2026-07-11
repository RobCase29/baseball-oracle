import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const maxBodyBytes = 16 * 1024

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function hasValidIngestionAuthorization(request: IncomingMessage): boolean {
  const expected = process.env.INGESTION_SECRET?.trim()
  const authorization = request.headers.authorization
  const header = Array.isArray(authorization) ? authorization[0] : authorization
  const provided = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''

  if (!expected || !provided) return false
  return timingSafeEqual(digest(expected), digest(provided))
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let byteLength = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    byteLength += buffer.byteLength
    if (byteLength > maxBodyBytes) throw new Error('Request body is too large')
    chunks.push(buffer)
  }

  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.statusCode = statusCode
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(body))
}

export function requirePostAndAuthorization(
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    sendJson(response, 405, { error: 'Method not allowed' })
    return false
  }

  if (!process.env.INGESTION_SECRET?.trim()) {
    sendJson(response, 503, { error: 'Ingestion is not configured' })
    return false
  }

  if (!hasValidIngestionAuthorization(request)) {
    sendJson(response, 401, { error: 'Unauthorized' })
    return false
  }

  return true
}
