import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isOracleSession,
  ORACLE_SESSION_COOKIE,
  ORACLE_SESSION_MAX_AGE_SECONDS,
} from '../_oracle-auth.js'
import login from './login.js'

const originalAccessCode = process.env.ORACLE_ACCESS_CODE
const originalSessionSecret = process.env.ORACLE_SESSION_SECRET

beforeEach(() => {
  process.env.ORACLE_ACCESS_CODE = 'private-research-code'
  process.env.ORACLE_SESSION_SECRET = 'a-long-independent-session-signing-secret'
})

afterEach(() => {
  if (originalAccessCode === undefined) delete process.env.ORACLE_ACCESS_CODE
  else process.env.ORACLE_ACCESS_CODE = originalAccessCode
  if (originalSessionSecret === undefined) delete process.env.ORACLE_SESSION_SECRET
  else process.env.ORACLE_SESSION_SECRET = originalSessionSecret
})

function request(
  body: unknown,
  method = 'POST',
  ip = '203.0.113.10',
): IncomingMessage {
  const stream = Readable.from([JSON.stringify(body)]) as IncomingMessage
  stream.method = method
  stream.headers = {
    'content-type': 'application/json',
    'x-forwarded-for': ip,
  }
  return stream
}

function responseRecorder() {
  let body: string | undefined
  const headers = new Map<string, string>()
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLocaleLowerCase('en-US'), String(value))
    },
    end(value?: string) {
      body = value
    },
  } as unknown as ServerResponse
  return { response, headers, get body() { return body } }
}

describe('Oracle access-code login', () => {
  it('sets a signed HttpOnly session cookie for the configured access code', async () => {
    const recorder = responseRecorder()
    await login(request({ code: 'private-research-code' }), recorder.response)

    expect(recorder.response.statusCode).toBe(204)
    const setCookie = recorder.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${ORACLE_SESSION_COOKIE}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain(`Max-Age=${ORACLE_SESSION_MAX_AGE_SECONDS}`)

    const cookie = setCookie.split(';')[0]
    expect(isOracleSession({
      headers: { cookie },
    } as IncomingMessage)).toBe(true)
  })

  it('returns a generic rejection without setting a cookie for a bad code', async () => {
    const recorder = responseRecorder()
    await login(request({ code: 'incorrect' }, 'POST', '203.0.113.11'), recorder.response)

    expect(recorder.response.statusCode).toBe(401)
    expect(recorder.headers.has('set-cookie')).toBe(false)
    expect(recorder.body).toContain('Access code not recognized')
  })

  it('fails closed when the session secret is unavailable', async () => {
    delete process.env.ORACLE_SESSION_SECRET
    const recorder = responseRecorder()
    await login(request({ code: 'private-research-code' }, 'POST', '203.0.113.12'), recorder.response)

    expect(recorder.response.statusCode).toBe(503)
    expect(recorder.headers.has('set-cookie')).toBe(false)
  })
})
