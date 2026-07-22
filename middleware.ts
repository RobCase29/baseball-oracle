import { next } from '@vercel/functions'

const SESSION_COOKIE = 'oracle_session'

function publicPath(pathname: string): boolean {
  return pathname === '/login' ||
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/logout' ||
    pathname === '/favicon.svg' ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/src/') ||
    pathname.startsWith('/@vite/') ||
    pathname === '/@react-refresh' ||
    pathname.startsWith('/node_modules/') ||
    pathname.startsWith('/@fs/')
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== name) continue
    return decodeURIComponent(part.slice(separator + 1).trim())
  }
  return null
}

function constantEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  return authorization.slice(7).trim() || null
}

function serverReadPath(pathname: string): boolean {
  return pathname === '/api/health' ||
    pathname === '/api/model-status' ||
    pathname === '/api/players' ||
    pathname === '/api/v1/dynasty-scores' ||
    pathname === '/api/v1/player-signals'
}

function validServerAuthorization(request: Request, pathname: string): boolean {
  const expected = pathname.startsWith('/api/cron/')
    ? process.env.CRON_SECRET?.trim()
    : pathname.startsWith('/api/admin/')
      ? process.env.INGESTION_SECRET?.trim()
      : serverReadPath(pathname)
        ? process.env.ORACLE_API_KEY?.trim()
        : null
  const provided = bearerToken(request)
  return Boolean(expected && provided && constantEqual(provided, expected))
}

async function sessionSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))
  let binary = ''
  for (const byte of signed) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function validSession(request: Request): Promise<boolean> {
  const secret = process.env.ORACLE_SESSION_SECRET?.trim()
  const token = readCookie(request, SESSION_COOKIE)
  if (!secret || !token) return false
  const separator = token.indexOf('.')
  if (separator < 1) return false
  const expiresAt = Number.parseInt(token.slice(0, separator), 10)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1_000)) return false
  return constantEqual(
    token.slice(separator + 1),
    await sessionSignature(expiresAt.toString(), secret),
  )
}

export default async function oracleAccess(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (publicPath(url.pathname)) return next()
  if (validServerAuthorization(request, url.pathname)) return next()
  if (await validSession(request)) return next()

  if (url.pathname.startsWith('/api/')) {
    return Response.json(
      { error: 'Authentication required' },
      {
        status: 401,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
          'X-Content-Type-Options': 'nosniff',
        },
      },
    )
  }

  const login = new URL('/login', url)
  login.searchParams.set('next', `${url.pathname}${url.search}`)
  return Response.redirect(login, 307)
}

export const config = {
  matcher: '/:path*',
  runtime: 'edge',
}
