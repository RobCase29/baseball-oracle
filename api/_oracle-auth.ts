import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export const ORACLE_SESSION_COOKIE = 'oracle_session'
export const ORACLE_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

function sessionSecret(): string | null {
  return process.env.ORACLE_SESSION_SECRET?.trim() || null
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function equalStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function cookieValue(request: IncomingMessage, name: string): string | null {
  const cookie = request.headers.cookie
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== name) continue
    return decodeURIComponent(part.slice(separator + 1).trim())
  }
  return null
}

export function createOracleSession(now = Date.now()): string | null {
  const secret = sessionSecret()
  if (!secret) return null
  const expiresAt = Math.floor(now / 1_000) + ORACLE_SESSION_MAX_AGE_SECONDS
  const payload = expiresAt.toString()
  return `${payload}.${signature(payload, secret)}`
}

export function isOracleSession(request: IncomingMessage, now = Date.now()): boolean {
  const secret = sessionSecret()
  const token = cookieValue(request, ORACLE_SESSION_COOKIE)
  if (!secret || !token) return false
  const separator = token.indexOf('.')
  if (separator < 1) return false
  const expiresAt = Number.parseInt(token.slice(0, separator), 10)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1_000)) return false
  return equalStrings(token.slice(separator + 1), signature(expiresAt.toString(), secret))
}

export function oracleAccessCodeMatches(value: string): boolean {
  const configured = process.env.ORACLE_ACCESS_CODE?.trim()
  return Boolean(configured) && equalStrings(value, configured ?? '')
}

export function oracleSessionCookie(token: string): string {
  return [
    `${ORACLE_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${ORACLE_SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ')
}

export function expiredOracleSessionCookie(): string {
  return `${ORACLE_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}
