import { describe, expect, it, vi } from 'vitest'
import type { BaseballReferenceCurrentResult } from '../../scripts/ingest/baseball-reference-current.js'
import type { IngestFangraphsProspectsResult } from '../../scripts/ingest/fangraphs-prospects.js'
import type { ProspectSavantBackfillResult } from '../../scripts/ingest/prospect-savant-leaders.js'
import { CURRENT_REFRESH_DB_STATEMENT_TIMEOUT_MS } from '../../scripts/ingest/shared.js'
import {
  baseballSeasonForDate,
  CURRENT_REFRESH_EXECUTION_BUDGET_MS,
  CURRENT_REFRESH_SOURCE_BUDGETS_MS,
  CURRENT_REFRESH_STALE_RUN_MS,
  deriveRefreshRunStatus,
  prospectSavantRookieSeasonForDate,
  refreshCurrentSources,
  type CurrentRefreshDependencies,
} from './refresh-current.js'

const completeProspectSavant: ProspectSavantBackfillResult = {
  attempted: 10,
  stored: 10,
  duplicates: 0,
  inProgress: 0,
  rows: 2_500,
  failures: [],
}

const completeBaseballReference: BaseballReferenceCurrentResult = {
  season: 2026,
  batting: { status: 'stored', rows: 700 },
  pitching: { status: 'stored', rows: 800 },
}

const completeFangraphs: IngestFangraphsProspectsResult = {
  status: 'stored',
  responseHash: 'a'.repeat(64),
  scoutRows: 200,
  statsRows: 200,
}

function dependencies(): CurrentRefreshDependencies {
  return {
    backfillProspectSavant: vi.fn<CurrentRefreshDependencies['backfillProspectSavant']>(
      async () => completeProspectSavant,
    ),
    refreshPlayerDirectorySnapshot: vi.fn<CurrentRefreshDependencies['refreshPlayerDirectorySnapshot']>(
      async () => undefined,
    ),
    ingestBaseballReferenceCurrentSeason: vi.fn<CurrentRefreshDependencies['ingestBaseballReferenceCurrentSeason']>(
      async () => completeBaseballReference,
    ),
    refreshCurrentMlbValueSnapshot: vi.fn<CurrentRefreshDependencies['refreshCurrentMlbValueSnapshot']>(
      async () => undefined,
    ),
    ingestFangraphsProspects: vi.fn<CurrentRefreshDependencies['ingestFangraphsProspects']>(
      async () => completeFangraphs,
    ),
  }
}

describe('current baseball season selection', () => {
  it('uses the current year for MLB from April onward', () => {
    expect(baseballSeasonForDate(new Date('2026-07-13T12:00:00Z'))).toBe(2026)
    expect(baseballSeasonForDate(new Date('2027-04-01T00:00:00Z'))).toBe(2027)
  })

  it('holds only Rookie-level slices on the prior season until June', () => {
    expect(prospectSavantRookieSeasonForDate(new Date('2027-04-01T00:00:00Z'))).toBe(2026)
    expect(prospectSavantRookieSeasonForDate(new Date('2027-05-31T23:59:59Z'))).toBe(2026)
    expect(prospectSavantRookieSeasonForDate(new Date('2027-06-01T00:00:00Z'))).toBe(2027)
  })

  it('continues refreshing the prior season before April', () => {
    expect(baseballSeasonForDate(new Date('2027-01-15T12:00:00Z'))).toBe(2026)
    expect(baseballSeasonForDate(new Date('2027-02-28T12:00:00Z'))).toBe(2026)
    expect(baseballSeasonForDate(new Date('2027-03-31T23:59:59Z'))).toBe(2026)
  })

  it('keeps source and stale-run budgets within the Vercel execution window', () => {
    const sourceBudget = Object.values(CURRENT_REFRESH_SOURCE_BUDGETS_MS)
      .reduce((total, value) => total + value, 0)

    expect(CURRENT_REFRESH_EXECUTION_BUDGET_MS).toBeLessThan(300_000)
    expect(sourceBudget).toBeLessThan(CURRENT_REFRESH_EXECUTION_BUDGET_MS)
    expect(
      sourceBudget + 3 * CURRENT_REFRESH_DB_STATEMENT_TIMEOUT_MS + 15_000,
    ).toBeLessThan(300_000)
    expect(CURRENT_REFRESH_STALE_RUN_MS).toBeGreaterThan(
      CURRENT_REFRESH_EXECUTION_BUDGET_MS,
    )
  })
})

describe('current source refresh isolation', () => {
  it('reports success when every configured source publishes completely', async () => {
    const stubs = dependencies()

    const result = await refreshCurrentSources(
      2026,
      { status: 'not_configured' },
      stubs,
    )

    expect(result.prospectSavant.status).toBe('succeeded')
    expect(result.baseballReference.status).toBe('succeeded')
    expect(result.fangraphs.status).toBe('not_configured')
    expect(result.sourceSeasons).toEqual({
      prospectSavant: { standardLevels: 2026, rookieLevel: 2026 },
      baseballReference: 2026,
    })
    expect(deriveRefreshRunStatus(result)).toBe('succeeded')
  })

  it('refreshes MLB and the complete minor-league universe on separate season clocks', async () => {
    const stubs = dependencies()

    const result = await refreshCurrentSources(
      2027,
      { status: 'not_configured' },
      stubs,
      { prospectSavantSeason: 2027, prospectSavantRookieSeason: 2026 },
    )

    const prospectOptions = vi.mocked(stubs.backfillProspectSavant).mock.calls[0]![0]
    expect(prospectOptions?.slices?.filter((slice) => slice.level !== 'Rk')
      .every((slice) => slice.season === 2027)).toBe(true)
    expect(prospectOptions?.slices?.filter((slice) => slice.level === 'Rk')
      .every((slice) => slice.season === 2026)).toBe(true)
    expect(stubs.ingestBaseballReferenceCurrentSeason).toHaveBeenCalledWith(
      2027,
      expect.any(Object),
    )
    expect(result.sourceSeasons).toEqual({
      prospectSavant: { standardLevels: 2027, rookieLevel: 2026 },
      baseballReference: 2027,
    })
  })

  it('propagates an execution abort and does not start later sources', async () => {
    const stubs = dependencies()
    const controller = new AbortController()
    vi.mocked(stubs.backfillProspectSavant).mockImplementationOnce(
      async (options) => {
        controller.abort(new Error('Refresh execution budget elapsed'))
        options?.signal?.throwIfAborted()
        return completeProspectSavant
      },
    )

    await expect(
      refreshCurrentSources(
        2026,
        { status: 'not_configured' },
        stubs,
        { signal: controller.signal },
      ),
    ).rejects.toThrow('Refresh execution budget elapsed')

    expect(stubs.ingestBaseballReferenceCurrentSeason).not.toHaveBeenCalled()
    expect(stubs.ingestFangraphsProspects).not.toHaveBeenCalled()
  })

  it('retries directory publication when all Prospect Savant payloads are duplicates', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.backfillProspectSavant).mockResolvedValueOnce({
      ...completeProspectSavant,
      stored: 0,
      duplicates: 10,
    })

    const result = await refreshCurrentSources(
      2026,
      { status: 'not_configured' },
      stubs,
    )

    expect(result.prospectSavant.status).toBe('succeeded')
    expect(stubs.refreshPlayerDirectorySnapshot).toHaveBeenCalledOnce()
  })

  it('continues Baseball-Reference and FanGraphs when Prospect Savant fails', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.backfillProspectSavant).mockRejectedValueOnce(
      new Error('Prospect Savant unavailable'),
    )

    const result = await refreshCurrentSources(
      2026,
      { status: 'configured', url: 'https://www.fangraphs.com/api/prospects/current' },
      stubs,
    )

    expect(result.prospectSavant.status).toBe('failed')
    expect(result.baseballReference.status).toBe('succeeded')
    expect(result.fangraphs.status).toBe('succeeded')
    expect(stubs.refreshPlayerDirectorySnapshot).not.toHaveBeenCalled()
    expect(stubs.ingestBaseballReferenceCurrentSeason).toHaveBeenCalledOnce()
    expect(stubs.refreshCurrentMlbValueSnapshot).toHaveBeenCalledOnce()
    expect(stubs.ingestFangraphsProspects).toHaveBeenCalledOnce()
    expect(deriveRefreshRunStatus(result)).toBe('partial')
  })

  it('does not publish the directory when any Prospect Savant slice is incomplete', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.backfillProspectSavant).mockResolvedValueOnce({
      ...completeProspectSavant,
      stored: 9,
      inProgress: 1,
    })

    const result = await refreshCurrentSources(
      2026,
      { status: 'not_configured' },
      stubs,
    )

    expect(result.prospectSavant.status).toBe('failed')
    expect(stubs.refreshPlayerDirectorySnapshot).not.toHaveBeenCalled()
    expect(result.baseballReference.status).toBe('succeeded')
    expect(deriveRefreshRunStatus(result)).toBe('partial')
  })

  it('continues Prospect Savant while keeping the MLB view unchanged after a BRef failure', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.ingestBaseballReferenceCurrentSeason).mockRejectedValueOnce(
      new Error('Baseball-Reference unavailable'),
    )

    const result = await refreshCurrentSources(
      2026,
      { status: 'not_configured' },
      stubs,
    )

    expect(result.prospectSavant.status).toBe('succeeded')
    expect(stubs.refreshPlayerDirectorySnapshot).toHaveBeenCalledOnce()
    expect(result.baseballReference.status).toBe('failed')
    expect(stubs.refreshCurrentMlbValueSnapshot).not.toHaveBeenCalled()
    expect(deriveRefreshRunStatus(result)).toBe('partial')
  })

  it('does not publish the MLB view while either BRef side remains in progress', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.ingestBaseballReferenceCurrentSeason).mockResolvedValueOnce({
      ...completeBaseballReference,
      pitching: { status: 'in_progress', rows: 800 },
    })

    const result = await refreshCurrentSources(
      2026,
      { status: 'not_configured' },
      stubs,
    )

    expect(result.baseballReference.status).toBe('failed')
    expect(stubs.refreshCurrentMlbValueSnapshot).not.toHaveBeenCalled()
  })

  it('reports total failure when no configured source succeeds', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.backfillProspectSavant).mockRejectedValueOnce(new Error('PS failed'))
    vi.mocked(stubs.ingestBaseballReferenceCurrentSeason).mockRejectedValueOnce(
      new Error('BRef failed'),
    )
    vi.mocked(stubs.ingestFangraphsProspects).mockRejectedValueOnce(
      new Error('FanGraphs failed'),
    )

    const result = await refreshCurrentSources(
      2026,
      { status: 'configured', url: 'https://www.fangraphs.com/api/prospects/current' },
      stubs,
    )

    expect(deriveRefreshRunStatus(result)).toBe('failed')
  })

  it('keeps a core-success run successful when optional FanGraphs configuration fails', async () => {
    const stubs = dependencies()

    const result = await refreshCurrentSources(
      2026,
      { status: 'invalid', error: { message: 'FanGraphs URL is invalid' } },
      stubs,
    )

    expect(result.prospectSavant.status).toBe('succeeded')
    expect(result.baseballReference.status).toBe('succeeded')
    expect(result.fangraphs.status).toBe('failed')
    expect(stubs.ingestFangraphsProspects).not.toHaveBeenCalled()
    expect(deriveRefreshRunStatus(result)).toBe('succeeded')
  })

  it('keeps a core-success run successful when optional FanGraphs collection fails', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.ingestFangraphsProspects).mockRejectedValueOnce(
      new Error('FanGraphs unavailable'),
    )

    const result = await refreshCurrentSources(
      2026,
      { status: 'configured', url: 'https://www.fangraphs.com/api/prospects/current' },
      stubs,
    )

    expect(result.fangraphs.status).toBe('failed')
    expect(deriveRefreshRunStatus(result)).toBe('succeeded')
  })

  it('preserves required-source success when the request budget expires in optional FanGraphs', async () => {
    const stubs = dependencies()
    const controller = new AbortController()
    vi.mocked(stubs.ingestFangraphsProspects).mockImplementationOnce(
      async (options) => {
        controller.abort(new Error('Refresh execution budget elapsed'))
        options?.signal?.throwIfAborted()
        return completeFangraphs
      },
    )

    const result = await refreshCurrentSources(
      2026,
      { status: 'configured', url: 'https://www.fangraphs.com/api/prospects/current' },
      stubs,
      { signal: controller.signal },
    )

    expect(result.prospectSavant.status).toBe('succeeded')
    expect(result.baseballReference.status).toBe('succeeded')
    expect(result.fangraphs.status).toBe('failed')
    expect(deriveRefreshRunStatus(result)).toBe('succeeded')
  })
})
