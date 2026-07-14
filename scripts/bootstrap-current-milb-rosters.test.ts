import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  currentMilbRosterBootstrapDatabaseOptions,
  currentMilbRosterSeasonForDate,
  decideCurrentMilbRosterBootstrap,
  type CurrentMilbRosterBootstrapCoverage,
} from './bootstrap-current-milb-rosters.js'

const now = new Date('2026-07-14T14:00:00.000Z')

function adequateCoverage(): CurrentMilbRosterBootstrapCoverage {
  return {
    profiles: 8_206,
    distinctMlbamIds: 8_206,
    roles: 2,
    organizations: 30,
    minimumSeason: 2026,
    maximumSeason: 2026,
    latestKnownAt: new Date('2026-04-01T00:00:00.000Z'),
    invalidIdentityRows: 0,
    invalidLevelRows: 0,
    missingCoreRows: 0,
    identityConflictRows: 0,
  }
}

describe('current MiLB roster production bootstrap decision', () => {
  it('keeps the advisory-lock connection open throughout the source fetch', () => {
    expect(currentMilbRosterBootstrapDatabaseOptions()).toMatchObject({
      max: 1,
      idle_timeout: 0,
      connect_timeout: 15,
      connection: { statement_timeout: 300_000 },
    })
  })

  it('does not connect or ingest outside production unless explicitly forced', () => {
    expect(decideCurrentMilbRosterBootstrap({
      coverage: null,
      environment: 'preview',
      now,
    })).toEqual({ action: 'skip', reason: 'not_production', season: 2026 })
    expect(decideCurrentMilbRosterBootstrap({
      coverage: adequateCoverage(),
      environment: 'preview',
      force: true,
      now,
    })).toEqual({ action: 'bootstrap', reason: 'forced', season: 2026 })
  })

  it('uses the completed season through March and the new season beginning in April', () => {
    expect(currentMilbRosterSeasonForDate(new Date('2027-03-31T23:59:59Z'))).toBe(2026)
    expect(currentMilbRosterSeasonForDate(new Date('2027-04-01T00:00:00Z'))).toBe(2027)
    expect(() => currentMilbRosterSeasonForDate(new Date('invalid'))).toThrow(/valid/u)
  })

  it('bootstraps a missing first-deploy snapshot', () => {
    expect(decideCurrentMilbRosterBootstrap({
      coverage: null,
      environment: 'production',
      now,
    })).toEqual({ action: 'bootstrap', reason: 'snapshot_missing', season: 2026 })
  })

  it('no-ops for a complete exact-identity current-season snapshot', () => {
    expect(decideCurrentMilbRosterBootstrap({
      coverage: adequateCoverage(),
      environment: 'production',
      now,
    })).toEqual({ action: 'skip', reason: 'adequate', season: 2026 })
  })

  it.each([
    ['coverage_below_minimum', { profiles: 6_999, distinctMlbamIds: 6_999 }],
    ['duplicate_identity', { distinctMlbamIds: 8_205 }],
    ['roles_incomplete', { roles: 1 }],
    ['organizations_incomplete', { organizations: 29 }],
    ['season_mismatch', { minimumSeason: 2025, maximumSeason: 2025 }],
    ['missing_provenance', { latestKnownAt: null }],
    ['invalid_snapshot_rows', { identityConflictRows: 1 }],
  ] as const)('bootstraps when coverage is %s', (reason, patch) => {
    expect(decideCurrentMilbRosterBootstrap({
      coverage: { ...adequateCoverage(), ...patch },
      environment: 'production',
      now,
    })).toMatchObject({ action: 'bootstrap', reason, season: 2026 })
  })

  it('wires the conditional bootstrap after migration and source seeding', () => {
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'))
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    expect(vercel.buildCommand).toContain(
      'npm run db:deploy && npm run bootstrap:mlb-rosters:remote &&',
    )
    expect(packageJson.scripts['bootstrap:mlb-rosters:remote']).toBe(
      'tsx scripts/bootstrap-current-milb-rosters.ts',
    )
  })
})
