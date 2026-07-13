import { describe, expect, it, vi } from 'vitest'
import type { BaseballReferenceCurrentResult } from '../../scripts/ingest/baseball-reference-current.js'
import type { IngestFangraphsProspectsResult } from '../../scripts/ingest/fangraphs-prospects.js'
import type { ProspectSavantBackfillResult } from '../../scripts/ingest/prospect-savant-leaders.js'
import {
  baseballSeasonForDate,
  deriveRefreshRunStatus,
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
  it('uses the current year from March onward', () => {
    expect(baseballSeasonForDate(new Date('2026-07-13T12:00:00Z'))).toBe(2026)
  })

  it('continues refreshing the prior season in January and February', () => {
    expect(baseballSeasonForDate(new Date('2027-01-15T12:00:00Z'))).toBe(2026)
    expect(baseballSeasonForDate(new Date('2027-02-28T12:00:00Z'))).toBe(2026)
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
    expect(deriveRefreshRunStatus(result)).toBe('succeeded')
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

  it('treats an invalid configured FanGraphs URL as partial without blocking core sources', async () => {
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
    expect(deriveRefreshRunStatus(result)).toBe('partial')
  })
})
