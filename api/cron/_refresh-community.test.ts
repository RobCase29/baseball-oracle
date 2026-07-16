import { describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_REFRESH_EXECUTION_BUDGET_MS,
  COMMUNITY_REFRESH_IDENTITY_DELAY_MS,
  COMMUNITY_REFRESH_IDENTITY_LIMIT,
  deriveCommunityRefreshStatus,
  refreshCommunitySignals,
  type CommunityRefreshDependencies,
  type CommunityRefreshResult,
} from './refresh-community.js'

function completeResult(
  overrides: Partial<CommunityRefreshResult> = {},
): CommunityRefreshResult {
  return {
    snapshot: {
      status: 'stored',
      captureId: 'a'.repeat(64),
      capturedAt: '2026-07-16T18:00:00.000Z',
      rankingRows: 1_726,
      topViewedPlayerRows: 10,
      topViewedProspectRows: 10,
      identitiesBackfilled: 0,
    },
    identities: {
      status: 'succeeded',
      result: { attempted: 25, stored: 25, duplicates: 0, failures: [] },
    },
    coverage: { rows: 1_726, mappedRows: 1_500 },
    ...overrides,
  }
}

function dependencies(): CommunityRefreshDependencies {
  const baseline = completeResult()
  if (baseline.identities.status !== 'succeeded') {
    throw new Error('Expected the community refresh fixture to succeed')
  }
  const identityResult = baseline.identities.result
  return {
    ingestSnapshot: vi.fn(async () => baseline.snapshot),
    backfillIdentities: vi.fn(async () => identityResult),
    refreshViews: vi.fn(async () => baseline.coverage),
  }
}

describe('community signal refresh', () => {
  it('keeps its bounded identity work inside the Vercel execution window', () => {
    expect(COMMUNITY_REFRESH_EXECUTION_BUDGET_MS).toBeLessThan(300_000)
    expect(COMMUNITY_REFRESH_IDENTITY_LIMIT * COMMUNITY_REFRESH_IDENTITY_DELAY_MS)
      .toBeLessThan(COMMUNITY_REFRESH_EXECUTION_BUDGET_MS / 2)
  })

  it('refreshes HKB independently and publishes exact-ID coverage', async () => {
    const stubs = dependencies()
    const result = await refreshCommunitySignals(stubs)

    expect(stubs.ingestSnapshot).toHaveBeenCalledWith({ signal: undefined })
    expect(stubs.backfillIdentities).toHaveBeenCalledWith({
      delayMs: COMMUNITY_REFRESH_IDENTITY_DELAY_MS,
      limit: COMMUNITY_REFRESH_IDENTITY_LIMIT,
      signal: undefined,
    })
    expect(stubs.refreshViews).toHaveBeenCalledOnce()
    expect(result.coverage).toEqual({ rows: 1_726, mappedRows: 1_500 })
    expect(deriveCommunityRefreshStatus(result)).toBe('succeeded')
  })

  it('retains row-level identity gaps without downgrading a valid source snapshot', async () => {
    const mostlyResolved = completeResult({
      identities: {
        status: 'succeeded',
        result: {
          attempted: 25,
          stored: 24,
          duplicates: 0,
          failures: [{ hkbPlayerId: 'missing1', message: 'No MLBAM ID' }],
        },
      },
    })
    expect(deriveCommunityRefreshStatus(mostlyResolved)).toBe('succeeded')
    expect(deriveCommunityRefreshStatus(completeResult({
      identities: {
        status: 'succeeded',
        result: {
          attempted: 1,
          stored: 0,
          duplicates: 0,
          failures: [{ hkbPlayerId: 'missing1', message: 'No MLBAM ID' }],
        },
      },
    }))).toBe('partial')
    expect(deriveCommunityRefreshStatus(completeResult({
      identities: { status: 'failed', error: { message: 'identity source failed' } },
    }))).toBe('partial')
  })

  it('honors an execution abort before source work begins', async () => {
    const stubs = dependencies()
    const controller = new AbortController()
    controller.abort(new Error('deadline elapsed'))

    await expect(refreshCommunitySignals(stubs, { signal: controller.signal }))
      .rejects.toThrow('deadline elapsed')
    expect(stubs.ingestSnapshot).not.toHaveBeenCalled()
  })
})
