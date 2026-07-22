import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { BaseballReferenceCurrentResult } from '../../scripts/ingest/baseball-reference-current.js'
import type {
  IngestFangraphsCurrentProspectsResult,
  IngestFangraphsProspectsResult,
} from '../../scripts/ingest/fangraphs-prospects.js'
import type { MlbStatsApiMilbBackfillResult } from '../../scripts/ingest/mlb-statsapi-milb.js'
import type { IngestMlbStatsApiMilbRosterResult } from '../../scripts/ingest/mlb-statsapi-milb-roster.js'
import type { ProspectSavantBackfillResult } from '../../scripts/ingest/prospect-savant-leaders.js'
import {
  baseballSeasonForDate,
  CURRENT_REFRESH_EXECUTION_BUDGET_MS,
  CURRENT_REFRESH_PLATFORM_BUDGET_MS,
  CURRENT_REFRESH_SOURCE_BUDGETS_MS,
  CURRENT_REFRESH_STALE_RUN_MS,
  attemptSource,
  deriveRefreshRunStatus,
  prospectSavantRookieSeasonForDate,
  refreshCurrentSources,
  type CurrentRefreshDependencies,
} from './refresh-current.js'

const refreshCurrentSource = readFileSync(
  new URL('./refresh-current.ts', import.meta.url),
  'utf8',
)

const completeProspectSavant: ProspectSavantBackfillResult = {
  attempted: 10,
  stored: 10,
  duplicates: 0,
  inProgress: 0,
  rows: 2_500,
  failures: [],
}

const completeMlbStatsApi: MlbStatsApiMilbBackfillResult = {
  attempted: 10,
  stored: 10,
  duplicates: 0,
  inProgress: 0,
  rows: 7_500,
  failures: [],
}

const completeMlbRoster: IngestMlbStatsApiMilbRosterResult = {
  status: 'stored',
  responseHash: 'c'.repeat(64),
  teams: 231,
  rosterRows: 15_400,
  uniquePlayers: 8_200,
  season: 2026,
}

const completeBaseballReference: BaseballReferenceCurrentResult = {
  season: 2026,
  batting: { status: 'stored', rows: 700 },
  pitching: { status: 'stored', rows: 800 },
}

const completeFangraphsSide: IngestFangraphsProspectsResult = {
  status: 'stored',
  responseHash: 'a'.repeat(64),
  scoutRows: 600,
  statsRows: 550,
}

const completeFangraphs: IngestFangraphsCurrentProspectsResult = {
  batting: completeFangraphsSide,
  pitching: { ...completeFangraphsSide, responseHash: 'b'.repeat(64) },
  season: 2026,
  snapshotRows: 1_200,
}

function dependencies(): CurrentRefreshDependencies {
  return {
    backfillProspectSavant: vi.fn<CurrentRefreshDependencies['backfillProspectSavant']>(
      async () => completeProspectSavant,
    ),
    refreshPlayerDirectorySnapshot: vi.fn<CurrentRefreshDependencies['refreshPlayerDirectorySnapshot']>(
      async () => undefined,
    ),
    backfillMlbStatsApiMilb: vi.fn<CurrentRefreshDependencies['backfillMlbStatsApiMilb']>(
      async () => completeMlbStatsApi,
    ),
    refreshCurrentMilbTraditionalSnapshot: vi.fn<CurrentRefreshDependencies['refreshCurrentMilbTraditionalSnapshot']>(
      async () => undefined,
    ),
    ingestMlbStatsApiMilbRosterCensus: vi.fn<CurrentRefreshDependencies['ingestMlbStatsApiMilbRosterCensus']>(
      async (season) => ({ ...completeMlbRoster, season }),
    ),
    refreshCurrentMilbRosterSnapshot: vi.fn<CurrentRefreshDependencies['refreshCurrentMilbRosterSnapshot']>(
      async () => undefined,
    ),
    ingestBaseballReferenceCurrentSeason: vi.fn<CurrentRefreshDependencies['ingestBaseballReferenceCurrentSeason']>(
      async () => completeBaseballReference,
    ),
    refreshCurrentMlbValueSnapshot: vi.fn<CurrentRefreshDependencies['refreshCurrentMlbValueSnapshot']>(
      async () => undefined,
    ),
    ingestFangraphsCurrentProspects: vi.fn<CurrentRefreshDependencies['ingestFangraphsCurrentProspects']>(
      async (options) => ({ ...completeFangraphs, season: options.season }),
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

  it('keeps sequential source and stale-run budgets within the Vercel execution window', () => {
    expect(CURRENT_REFRESH_EXECUTION_BUDGET_MS).toBeLessThan(
      CURRENT_REFRESH_PLATFORM_BUDGET_MS,
    )
    expect(Object.values(CURRENT_REFRESH_SOURCE_BUDGETS_MS).every(
      (budget) => budget < CURRENT_REFRESH_EXECUTION_BUDGET_MS,
    )).toBe(true)
    expect(Object.values(CURRENT_REFRESH_SOURCE_BUDGETS_MS).reduce(
      (total, budget) => total + budget,
      0,
    )).toBeLessThan(CURRENT_REFRESH_EXECUTION_BUDGET_MS)
    expect(CURRENT_REFRESH_EXECUTION_BUDGET_MS + 50_000).toBeLessThanOrEqual(
      CURRENT_REFRESH_PLATFORM_BUDGET_MS,
    )
    expect(CURRENT_REFRESH_STALE_RUN_MS).toBeGreaterThan(
      CURRENT_REFRESH_EXECUTION_BUDGET_MS,
    )
  })

  it('terminates stale active and abandoned-transaction snapshot sessions', () => {
    expect(refreshCurrentSource).toContain("state = 'active'")
    expect(refreshCurrentSource).toContain("state LIKE 'idle in transaction%'")
    expect(refreshCurrentSource).toContain('pg_terminate_backend')
    expect(refreshCurrentSource).toContain('pg_locks')
    expect(refreshCurrentSource).toContain("'current_milb_roster_snapshot'")
    expect(refreshCurrentSource).toContain('CURRENT_REFRESH_DB_APPLICATION_NAME')
    expect(refreshCurrentSource).toContain('currentRefreshMaterializedViewPattern')
  })
})

describe('current source refresh isolation', () => {
  it('returns a failed source result when a collector ignores its abort signal', async () => {
    const controller = new AbortController()
    const neverSettles = new Promise<never>(() => undefined)
    const attempt = attemptSource(
      'stuck-source',
      () => neverSettles,
      () => undefined,
      controller.signal,
    )
    controller.abort(new Error('source deadline elapsed'))

    await expect(attempt).resolves.toEqual({
      status: 'failed',
      error: { message: 'source deadline elapsed' },
    })
  })

  it('reports success when every current source publishes completely', async () => {
    const stubs = dependencies()
    const result = await refreshCurrentSources(2026, stubs)

    expect(result.prospectSavant.status).toBe('succeeded')
    expect(result.mlbStatsApi.status).toBe('succeeded')
    expect(result.mlbRoster.status).toBe('succeeded')
    expect(result.baseballReference.status).toBe('succeeded')
    expect(result.fangraphs.status).toBe('succeeded')
    expect(result.sourceSeasons).toEqual({
      prospectSavant: { standardLevels: 2026, rookieLevel: 2026 },
      mlbStatsApi: { standardLevels: 2026, rookieLevel: 2026 },
      mlbRoster: 2026,
      baseballReference: 2026,
      fangraphs: 2026,
    })
    expect(stubs.ingestFangraphsCurrentProspects).toHaveBeenCalledWith({
      season: 2026,
      signal: expect.any(AbortSignal),
    })
    expect(stubs.refreshCurrentMilbTraditionalSnapshot).toHaveBeenCalledOnce()
    expect(stubs.refreshCurrentMilbTraditionalSnapshot).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    )
    expect(stubs.ingestMlbStatsApiMilbRosterCensus).toHaveBeenCalledWith(
      2026,
      { signal: expect.any(AbortSignal) },
    )
    expect(stubs.refreshCurrentMilbRosterSnapshot).toHaveBeenCalledOnce()
    expect(stubs.refreshCurrentMilbRosterSnapshot).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    )
    expect(stubs.refreshCurrentMlbValueSnapshot).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    )
    expect(
      vi.mocked(stubs.backfillProspectSavant).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(stubs.backfillMlbStatsApiMilb).mock.invocationCallOrder[0]!,
    )
    expect(stubs.refreshPlayerDirectorySnapshot).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    )
    expect(
      vi.mocked(stubs.backfillMlbStatsApiMilb).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(stubs.ingestMlbStatsApiMilbRosterCensus).mock.invocationCallOrder[0]!,
    )
    expect(deriveRefreshRunStatus(result)).toBe('succeeded')
  })

  it('refreshes sources on their correct season clocks', async () => {
    const stubs = dependencies()
    const result = await refreshCurrentSources(
      2027,
      stubs,
      { prospectSavantSeason: 2027, prospectSavantRookieSeason: 2026 },
    )

    const prospectOptions = vi.mocked(stubs.backfillProspectSavant).mock.calls[0]![0]
    expect(prospectOptions).toMatchObject({
      requestAttempts: 1,
      requestTimeoutMs: 30_000,
      stopOnFailure: true,
    })
    expect(prospectOptions?.slices?.filter((slice) => slice.level !== 'Rk')
      .every((slice) => slice.season === 2027)).toBe(true)
    expect(prospectOptions?.slices?.filter((slice) => slice.level === 'Rk')
      .every((slice) => slice.season === 2026)).toBe(true)
    const statsApiOptions = vi.mocked(stubs.backfillMlbStatsApiMilb).mock.calls[0]![0]
    expect(statsApiOptions.slices.filter((slice) => slice.level !== 'Rk')
      .every((slice) => slice.season === 2027)).toBe(true)
    expect(statsApiOptions.slices.filter((slice) => slice.level === 'Rk')
      .every((slice) => slice.season === 2026)).toBe(true)
    expect(stubs.ingestBaseballReferenceCurrentSeason).toHaveBeenCalledWith(
      2027,
      expect.any(Object),
    )
    expect(stubs.ingestFangraphsCurrentProspects).toHaveBeenCalledWith({
      season: 2027,
      signal: expect.any(AbortSignal),
    })
    expect(result.sourceSeasons).toEqual({
      prospectSavant: { standardLevels: 2027, rookieLevel: 2026 },
      mlbStatsApi: { standardLevels: 2027, rookieLevel: 2026 },
      mlbRoster: 2027,
      baseballReference: 2027,
      fangraphs: 2027,
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
      refreshCurrentSources(2026, stubs, { signal: controller.signal }),
    ).rejects.toThrow('Refresh execution budget elapsed')

    expect(stubs.ingestBaseballReferenceCurrentSeason).not.toHaveBeenCalled()
    expect(stubs.ingestFangraphsCurrentProspects).not.toHaveBeenCalled()
  })

  it('retries directory publication when all Prospect Savant payloads are duplicates', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.backfillProspectSavant).mockResolvedValueOnce({
      ...completeProspectSavant,
      stored: 0,
      duplicates: 10,
    })

    const result = await refreshCurrentSources(2026, stubs)

    expect(result.prospectSavant.status).toBe('succeeded')
    expect(stubs.refreshPlayerDirectorySnapshot).toHaveBeenCalledOnce()
  })

  it('continues Baseball-Reference and FanGraphs when Prospect Savant fails', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.backfillProspectSavant).mockRejectedValueOnce(
      new Error('Prospect Savant unavailable'),
    )

    const result = await refreshCurrentSources(2026, stubs)

    expect(result.prospectSavant.status).toBe('failed')
    expect(result.mlbStatsApi.status).toBe('succeeded')
    expect(result.baseballReference.status).toBe('succeeded')
    expect(result.fangraphs.status).toBe('succeeded')
    expect(stubs.refreshPlayerDirectorySnapshot).not.toHaveBeenCalled()
    expect(stubs.refreshCurrentMlbValueSnapshot).toHaveBeenCalledOnce()
    expect(stubs.ingestFangraphsCurrentProspects).toHaveBeenCalledOnce()
    expect(deriveRefreshRunStatus(result)).toBe('partial')
  })

  it('does not publish the directory when a Prospect Savant slice is incomplete', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.backfillProspectSavant).mockResolvedValueOnce({
      ...completeProspectSavant,
      stored: 9,
      inProgress: 1,
    })

    const result = await refreshCurrentSources(2026, stubs)

    expect(result.prospectSavant.status).toBe('failed')
    expect(stubs.refreshPlayerDirectorySnapshot).not.toHaveBeenCalled()
    expect(result.baseballReference.status).toBe('succeeded')
    expect(deriveRefreshRunStatus(result)).toBe('partial')
  })

  it('publishes complete official MiLB cohorts while marking an incomplete slice', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.backfillMlbStatsApiMilb).mockResolvedValueOnce({
      ...completeMlbStatsApi,
      stored: 9,
      inProgress: 1,
    })

    const result = await refreshCurrentSources(2026, stubs)

    expect(result.mlbStatsApi.status).toBe('failed')
    expect(stubs.refreshCurrentMilbTraditionalSnapshot).toHaveBeenCalledOnce()
    expect(result.prospectSavant.status).toBe('succeeded')
    expect(result.baseballReference.status).toBe('succeeded')
    expect(deriveRefreshRunStatus(result)).toBe('partial')
  })

  it('isolates a roster-census collection failure from every other source', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.ingestMlbStatsApiMilbRosterCensus).mockRejectedValueOnce(
      new Error('Roster census unavailable'),
    )

    const result = await refreshCurrentSources(2026, stubs)

    expect(result.mlbRoster.status).toBe('failed')
    expect(stubs.refreshCurrentMilbRosterSnapshot).not.toHaveBeenCalled()
    expect(result.prospectSavant.status).toBe('succeeded')
    expect(result.mlbStatsApi.status).toBe('succeeded')
    expect(result.baseballReference.status).toBe('succeeded')
    expect(result.fangraphs.status).toBe('succeeded')
    expect(deriveRefreshRunStatus(result)).toBe('partial')
  })

  it('does not publish an in-progress roster census', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.ingestMlbStatsApiMilbRosterCensus).mockResolvedValueOnce({
      ...completeMlbRoster,
      status: 'in_progress',
    })

    const result = await refreshCurrentSources(2026, stubs)

    expect(result.mlbRoster).toMatchObject({
      status: 'failed',
      error: { message: expect.stringContaining('remains in progress') },
      result: { status: 'in_progress' },
    })
    expect(stubs.refreshCurrentMilbRosterSnapshot).not.toHaveBeenCalled()
    expect(deriveRefreshRunStatus(result)).toBe('partial')
  })

  it('marks roster refresh failed when the served census audit rejects it', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.refreshCurrentMilbRosterSnapshot).mockRejectedValueOnce(
      new Error('Roster snapshot cardinality gate failed'),
    )

    const result = await refreshCurrentSources(2026, stubs)

    expect(result.mlbRoster).toMatchObject({
      status: 'failed',
      error: { message: 'Roster snapshot cardinality gate failed' },
      result: completeMlbRoster,
    })
    expect(deriveRefreshRunStatus(result)).toBe('partial')
  })

  it('keeps the MLB view unchanged after a Baseball-Reference failure', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.ingestBaseballReferenceCurrentSeason).mockRejectedValueOnce(
      new Error('Baseball-Reference unavailable'),
    )

    const result = await refreshCurrentSources(2026, stubs)

    expect(result.prospectSavant.status).toBe('succeeded')
    expect(stubs.refreshPlayerDirectorySnapshot).toHaveBeenCalledOnce()
    expect(result.baseballReference.status).toBe('failed')
    expect(stubs.refreshCurrentMlbValueSnapshot).not.toHaveBeenCalled()
    expect(result.fangraphs.status).toBe('succeeded')
    expect(deriveRefreshRunStatus(result)).toBe('partial')
  })

  it('does not publish the MLB view while either BRef side remains in progress', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.ingestBaseballReferenceCurrentSeason).mockResolvedValueOnce({
      ...completeBaseballReference,
      pitching: { status: 'in_progress', rows: 800 },
    })

    const result = await refreshCurrentSources(2026, stubs)

    expect(result.baseballReference.status).toBe('failed')
    expect(stubs.refreshCurrentMlbValueSnapshot).not.toHaveBeenCalled()
  })

  it('reports total failure when no current source succeeds', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.backfillProspectSavant).mockRejectedValueOnce(new Error('PS failed'))
    vi.mocked(stubs.backfillMlbStatsApiMilb).mockRejectedValueOnce(
      new Error('StatsAPI failed'),
    )
    vi.mocked(stubs.ingestMlbStatsApiMilbRosterCensus).mockRejectedValueOnce(
      new Error('Roster census failed'),
    )
    vi.mocked(stubs.ingestBaseballReferenceCurrentSeason).mockRejectedValueOnce(
      new Error('BRef failed'),
    )
    vi.mocked(stubs.ingestFangraphsCurrentProspects).mockRejectedValueOnce(
      new Error('FanGraphs failed'),
    )

    const result = await refreshCurrentSources(2026, stubs)
    expect(deriveRefreshRunStatus(result)).toBe('failed')
  })

  it('marks the run partial when automatic FanGraphs collection fails', async () => {
    const stubs = dependencies()
    vi.mocked(stubs.ingestFangraphsCurrentProspects).mockRejectedValueOnce(
      new Error('FanGraphs unavailable'),
    )

    const result = await refreshCurrentSources(2026, stubs)

    expect(result.fangraphs.status).toBe('failed')
    expect(deriveRefreshRunStatus(result)).toBe('partial')
  })

  it('propagates the request deadline when it expires in FanGraphs', async () => {
    const stubs = dependencies()
    const controller = new AbortController()
    vi.mocked(stubs.ingestFangraphsCurrentProspects).mockImplementationOnce(
      async (options) => {
        controller.abort(new Error('Refresh execution budget elapsed'))
        options.signal?.throwIfAborted()
        return completeFangraphs
      },
    )

    await expect(
      refreshCurrentSources(2026, stubs, { signal: controller.signal }),
    ).rejects.toThrow('Refresh execution budget elapsed')
  })
})
