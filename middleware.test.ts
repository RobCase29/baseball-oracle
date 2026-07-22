import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createOracleSession, ORACLE_SESSION_COOKIE } from './api/_oracle-auth.js'
import oracleAccess from './middleware.js'

const originalSessionSecret = process.env.ORACLE_SESSION_SECRET
const originalCronSecret = process.env.CRON_SECRET
const originalIngestionSecret = process.env.INGESTION_SECRET

beforeEach(() => {
  process.env.ORACLE_SESSION_SECRET = 'middleware-test-session-signing-secret'
  process.env.CRON_SECRET = 'middleware-test-cron-secret'
  process.env.INGESTION_SECRET = 'middleware-test-ingestion-secret'
})

afterEach(() => {
  if (originalSessionSecret === undefined) delete process.env.ORACLE_SESSION_SECRET
  else process.env.ORACLE_SESSION_SECRET = originalSessionSecret
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalCronSecret
  if (originalIngestionSecret === undefined) delete process.env.INGESTION_SECRET
  else process.env.INGESTION_SECRET = originalIngestionSecret
})

describe('Oracle routing authentication', () => {
  it('returns JSON 401 for an anonymous API request', async () => {
    const response = await oracleAccess(new Request('https://oracle.example/api/players'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required' })
  })

  it('redirects an anonymous page request to login with a safe return path', async () => {
    const response = await oracleAccess(new Request(
      'https://oracle.example/football?format=superflex',
    ))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://oracle.example/login?next=%2Ffootball%3Fformat%3Dsuperflex',
    )
  })

  it('continues for a signed session and for login assets', async () => {
    const token = createOracleSession()
    expect(token).not.toBeNull()
    const authenticated = await oracleAccess(new Request('https://oracle.example/', {
      headers: { cookie: `${ORACLE_SESSION_COOKIE}=${token}` },
    }))
    const login = await oracleAccess(new Request('https://oracle.example/login'))
    const asset = await oracleAccess(new Request('https://oracle.example/assets/app.js'))

    expect(authenticated.headers.get('x-middleware-next')).toBe('1')
    expect(login.headers.get('x-middleware-next')).toBe('1')
    expect(asset.headers.get('x-middleware-next')).toBe('1')
  })

  it('continues for bearer-authenticated cron and admin ingestion requests', async () => {
    const cron = await oracleAccess(new Request(
      'https://oracle.example/api/cron/refresh-current',
      { headers: { authorization: 'Bearer middleware-test-cron-secret' } },
    ))
    const admin = await oracleAccess(new Request(
      'https://oracle.example/api/admin/ingest-fangraphs',
      { headers: { authorization: 'Bearer middleware-test-ingestion-secret' } },
    ))

    expect(cron.headers.get('x-middleware-next')).toBe('1')
    expect(admin.headers.get('x-middleware-next')).toBe('1')
  })

  it('rejects cron and admin requests with missing or incorrect bearer tokens', async () => {
    const anonymousCron = await oracleAccess(new Request(
      'https://oracle.example/api/cron/refresh-current',
    ))
    const incorrectAdmin = await oracleAccess(new Request(
      'https://oracle.example/api/admin/ingest-fangraphs',
      { headers: { authorization: 'Bearer incorrect-secret' } },
    ))

    expect(anonymousCron.status).toBe(401)
    expect(incorrectAdmin.status).toBe(401)
  })
})
