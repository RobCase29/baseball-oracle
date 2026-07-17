import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  createOracleSession,
  oracleAccessCodeMatches,
  oracleSessionCookie,
} from '../_oracle-auth.js'

const MAX_BODY_BYTES = 2_048
const ATTEMPT_WINDOW_MS = 15 * 60 * 1_000
const MAX_ATTEMPTS = 8

const attempts = new Map<string, { count: number; resetAt: number }>()

function clientKey(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return value?.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown'
}

function rateLimited(key: string, now: number): boolean {
  const current = attempts.get(key)
  if (!current || now >= current.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS })
    return false
  }
  current.count += 1
  return current.count > MAX_ATTEMPTS
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request_too_large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
}

function errorResponse(response: ServerResponse, status: number, error: string): void {
  const body = JSON.stringify({ error })
  response.statusCode = status
  securityHeaders(response)
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body).toString())
  response.end(body)
}

export default async function login(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    errorResponse(response, 405, 'Method not allowed')
    return
  }

  const now = Date.now()
  const key = clientKey(request)
  if (rateLimited(key, now)) {
    response.setHeader('Retry-After', Math.ceil(ATTEMPT_WINDOW_MS / 1_000).toString())
    errorResponse(response, 429, 'Too many sign-in attempts')
    return
  }

  try {
    const input = await readJson(request)
    const code = typeof input === 'object' && input !== null && 'code' in input
      ? (input as { code?: unknown }).code
      : null
    if (typeof code !== 'string' || code.length > 256 || !oracleAccessCodeMatches(code)) {
      errorResponse(response, 401, 'Access code not recognized')
      return
    }
    const token = createOracleSession(now)
    if (!token) {
      errorResponse(response, 503, 'Sign-in is not configured')
      return
    }
    attempts.delete(key)
    response.statusCode = 204
    securityHeaders(response)
    response.setHeader('Set-Cookie', oracleSessionCookie(token))
    response.end()
  } catch {
    errorResponse(response, 400, 'Invalid sign-in request')
  }
}
