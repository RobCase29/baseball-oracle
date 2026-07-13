import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  abortableDelay,
  boundedSourceRecordKey,
  CURRENT_REFRESH_DB_LOCK_TIMEOUT_MS,
  CURRENT_REFRESH_DB_STATEMENT_TIMEOUT_MS,
  currentRefreshDatabaseOptions,
  disambiguateSourceRecordKeys,
  fetchWithRetry,
  SOURCE_RECORD_KEY_MAX_BYTES,
} from './shared.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shared ingestion helpers', () => {
  it('gives every repeated identical source row a deterministic unique key', () => {
    const rows = [{ id: 1 }, { id: 1 }, { id: 1 }]
    const keys = disambiguateSourceRecordKeys(rows, (row) => `id:${row.id}`)

    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe('id:1')
    expect(keys[1]).toContain('duplicate:2:')
    expect(keys[2]).toContain('duplicate:3:')
  })

  it('hashes provider keys that cannot safely fit a B-tree index entry', () => {
    const oversized = `Team:${'<a>provider markup</a>'.repeat(400)}`
    const bounded = boundedSourceRecordKey(oversized)

    expect(bounded).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(new TextEncoder().encode(bounded).byteLength).toBeLessThanOrEqual(
      SOURCE_RECORD_KEY_MAX_BYTES,
    )
    expect(boundedSourceRecordKey(oversized)).toBe(bounded)
  })

  it('does not start an HTTP attempt after the parent refresh is aborted', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    controller.abort(new Error('Refresh deadline elapsed'))

    await expect(
      fetchWithRetry('https://example.com/data', {
        attempts: 3,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Refresh deadline elapsed')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancels retry and crawl delays when the parent refresh is aborted', async () => {
    const controller = new AbortController()
    const waiting = abortableDelay(60_000, controller.signal)

    controller.abort(new Error('Source budget elapsed'))

    await expect(waiting).rejects.toThrow('Source budget elapsed')
  })

  it('bounds refresh database statements and lock waits on the server', () => {
    expect(currentRefreshDatabaseOptions()).toMatchObject({
      connection: {
        statement_timeout: CURRENT_REFRESH_DB_STATEMENT_TIMEOUT_MS,
        lock_timeout: CURRENT_REFRESH_DB_LOCK_TIMEOUT_MS,
        idle_in_transaction_session_timeout:
          CURRENT_REFRESH_DB_STATEMENT_TIMEOUT_MS + 5_000,
      },
    })
    expect(currentRefreshDatabaseOptions(10_000).connection.statement_timeout).toBe(10_000)
    expect(() => currentRefreshDatabaseOptions(0)).toThrow(/positive integer/iu)
  })
})
