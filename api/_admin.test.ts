import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hasValidCronAuthorization,
  hasValidIngestionAuthorization,
} from './_admin.js'

function request(authorization?: string): IncomingMessage {
  return { headers: { authorization } } as IncomingMessage
}

describe('server-side bearer authorization', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('fails closed when CRON_SECRET is absent', () => {
    vi.stubEnv('CRON_SECRET', '')
    expect(hasValidCronAuthorization(request('Bearer anything'))).toBe(false)
  })

  it('accepts only the configured cron bearer token', () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-value')
    expect(hasValidCronAuthorization(request('Bearer cron-secret-value'))).toBe(true)
    expect(hasValidCronAuthorization(request('Bearer wrong-value'))).toBe(false)
    expect(hasValidCronAuthorization(request())).toBe(false)
  })

  it('keeps ingestion and cron credentials independent', () => {
    vi.stubEnv('INGESTION_SECRET', 'ingestion-secret')
    vi.stubEnv('CRON_SECRET', 'cron-secret')
    expect(hasValidIngestionAuthorization(request('Bearer ingestion-secret'))).toBe(true)
    expect(hasValidCronAuthorization(request('Bearer ingestion-secret'))).toBe(false)
  })
})
