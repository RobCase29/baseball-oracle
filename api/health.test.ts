import { describe, expect, it } from 'vitest'
import {
  currentMlbRosterCoverage,
  healthRefreshSourceKey,
  refreshSourceErrors,
  refreshSourceStatuses,
  type CurrentMlbRosterCoverageRow,
} from './health.js'

function rosterCoverageRow(
  overrides: Partial<CurrentMlbRosterCoverageRow> = {},
): CurrentMlbRosterCoverageRow {
  return {
    season: 2026,
    roster_players: '8204',
    distinct_mlbam_ids: '8204',
    rostered_predebut_players: '6524',
    organizations: '30',
    affiliate_roster_players: '7150',
    parent_census_players: '8204',
    active_players: '6712',
    injured_players: '611',
    invalid_identity_rows: '0',
    invalid_core_rows: '0',
    oldest_roster_at: '2026-07-14T13:00:00.000Z',
    newest_roster_at: '2026-07-14T13:00:00.000Z',
    ...overrides,
  }
}

describe('health current-source contract', () => {
  it('recognizes the roster census as a distinct MLB StatsAPI source', () => {
    expect(healthRefreshSourceKey({
      source: 'mlb-statsapi',
      dataset: 'current-milb-rosters',
    })).toBe('mlbRoster')
    expect(healthRefreshSourceKey({
      source: 'mlb-statsapi',
      dataset: 'current-milb-season-stats',
    })).toBe('mlbStatsApi')
  })

  it('exposes roster status and sanitized errors from the five-source receipt', () => {
    const result = {
      prospectSavant: { status: 'succeeded' },
      mlbStatsApi: { status: 'succeeded' },
      mlbRoster: {
        status: 'failed',
        error: { message: 'Roster snapshot cardinality gate failed' },
      },
      baseballReference: { status: 'succeeded' },
      fangraphs: { status: 'succeeded' },
      ignored: { status: 'failed', error: { message: 'not public' } },
    }

    expect(refreshSourceStatuses(result)).toEqual({
      prospectSavant: 'succeeded',
      baseballReference: 'succeeded',
      mlbStatsApi: 'succeeded',
      mlbRoster: 'failed',
      fangraphs: 'succeeded',
    })
    expect(refreshSourceErrors(result)).toEqual({
      mlbRoster: 'Roster snapshot cardinality gate failed',
    })
  })
})

describe('health roster-census coverage', () => {
  it('publishes exact identity and assignment coverage for a complete census', () => {
    expect(currentMlbRosterCoverage(rosterCoverageRow())).toEqual({
      season: 2026,
      rosterPlayers: 8204,
      minimumPlayers: 7000,
      exactMlbamPlayers: 8204,
      rosteredPreDebutPlayers: 6524,
      organizations: 30,
      expectedOrganizations: 30,
      affiliateRosterPlayers: 7150,
      parentCensusPlayers: 8204,
      activePlayers: 6712,
      injuredPlayers: 611,
      invalidIdentityRows: 0,
      invalidCoreRows: 0,
      oldestRosterAt: '2026-07-14T13:00:00.000Z',
      newestRosterAt: '2026-07-14T13:00:00.000Z',
      coverageComplete: true,
    })
  })

  it('fails coverage for a small, identity-conflicted, or incomplete census', () => {
    expect(currentMlbRosterCoverage(rosterCoverageRow({
      roster_players: '6999',
    }))?.coverageComplete).toBe(false)
    expect(currentMlbRosterCoverage(rosterCoverageRow({
      distinct_mlbam_ids: '8203',
    }))?.coverageComplete).toBe(false)
    expect(currentMlbRosterCoverage(rosterCoverageRow({
      invalid_core_rows: '1',
    }))?.coverageComplete).toBe(false)
    expect(currentMlbRosterCoverage(rosterCoverageRow({
      newest_roster_at: null,
    }))?.coverageComplete).toBe(false)
    expect(currentMlbRosterCoverage(undefined)).toBeNull()
  })
})
