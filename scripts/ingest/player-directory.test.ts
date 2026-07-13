import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertCurrentMlbRoleSnapshot,
  assertCurrentMilbTraditionalSnapshot,
} from './player-directory.js'

const originalDirectoryView = readFileSync(
  resolve(process.cwd(), 'db/migrations/0003_real_player_directory.sql'),
  'utf8',
)
const mixedSeasonDirectoryView = readFileSync(
  resolve(process.cwd(), 'db/migrations/0012_serve_latest_valid_milb_slices.sql'),
  'utf8',
)
const currentMlbSnapshotMigration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0011_align_two_way_role_policy.sql'),
  'utf8',
)
const currentMilbTraditionalMigration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0014_mlb_statsapi_current_milb.sql'),
  'utf8',
)

function directoryProjection(sql: string): string {
  const projection = sql.match(
    /SELECT\n(  'prospect-savant:'[\s\S]*?)\nFROM representative\n/u,
  )?.[1]
  if (!projection) throw new Error('Player-directory projection not found')
  return projection
}

describe('mixed-season minor-league directory migration', () => {
  it('advances each paired level slice independently without changing the view contract', () => {
    expect(mixedSeasonDirectoryView).toContain(
      'SELECT DISTINCT ON (level)',
    )
    expect(mixedSeasonDirectoryView).toContain(
      "WHERE source_role IN ('hitters', 'pitchers')",
    )
    expect(mixedSeasonDirectoryView).toContain(
      ') = 2\n  ORDER BY level, season DESC',
    )
    expect(mixedSeasonDirectoryView).toContain(
      'JOIN selected_cohort USING (level, season)',
    )
    expect(mixedSeasonDirectoryView).toContain(
      "WHERE latest.source_role IN ('hitters', 'pitchers')",
    )
    expect(mixedSeasonDirectoryView).toContain('representative.season,')
    expect(mixedSeasonDirectoryView).toContain(
      'REFRESH MATERIALIZED VIEW app.player_directory_snapshot;',
    )
    expect(mixedSeasonDirectoryView).not.toContain('complete_season')
    expect(directoryProjection(mixedSeasonDirectoryView)).toBe(
      directoryProjection(originalDirectoryView),
    )
  })
})

describe('current MLB role snapshot audit', () => {
  it('prefers a later enriched landing when source timestamps tie', () => {
    expect(currentMlbSnapshotMigration).toContain(
      'source_fetch.fetched_at DESC,\n    run.finished_at DESC NULLS LAST,',
    )
  })

  it('accepts substantive role cohorts', () => {
    expect(() => assertCurrentMlbRoleSnapshot({
      invalid_two_way_rows: 0,
      invalid_small_cohort_percentiles: 0,
      identity_conflicts: 0,
    })).not.toThrow()
  })

  it('rejects nominal two-way rows and undersized percentiles', () => {
    expect(() => assertCurrentMlbRoleSnapshot({
      invalid_two_way_rows: 1,
      invalid_small_cohort_percentiles: 0,
      identity_conflicts: 0,
    })).toThrow(/nominal two-way/u)
    expect(() => assertCurrentMlbRoleSnapshot({
      invalid_two_way_rows: 0,
      invalid_small_cohort_percentiles: 1,
      identity_conflicts: 0,
    })).toThrow(/undersized role cohorts/u)
    expect(() => assertCurrentMlbRoleSnapshot({
      invalid_two_way_rows: 0,
      invalid_small_cohort_percentiles: 0,
      identity_conflicts: 1,
    })).toThrow(/conflicting batting\/pitching MLBAM/iu)
    expect(() => assertCurrentMlbRoleSnapshot(undefined)).toThrow(/no result/u)
  })
})

describe('current MiLB traditional-stat snapshot audit', () => {
  const validAudit = {
    profiles: 4_200,
    roles: 2,
    invalid_identity_rows: 0,
    invalid_level_rows: 0,
    missing_workload_rows: 0,
  }

  it('accepts a non-empty exact-ID two-role snapshot', () => {
    expect(() => assertCurrentMilbTraditionalSnapshot(validAudit)).not.toThrow()
  })

  it('rejects incomplete universes and invalid normalized rows', () => {
    expect(() => assertCurrentMilbTraditionalSnapshot({
      ...validAudit,
      profiles: 0,
      roles: 0,
    })).toThrow(/non-empty two-role universe/u)
    expect(() => assertCurrentMilbTraditionalSnapshot({
      ...validAudit,
      invalid_identity_rows: 1,
    })).toThrow(/invalid exact-identity/u)
    expect(() => assertCurrentMilbTraditionalSnapshot({
      ...validAudit,
      invalid_level_rows: 1,
    })).toThrow(/invalid level/u)
    expect(() => assertCurrentMilbTraditionalSnapshot({
      ...validAudit,
      missing_workload_rows: 1,
    })).toThrow(/without role workload/u)
  })
})

describe('official current MiLB traditional-stat migration', () => {
  it('keeps exact identity, verified current assignment, level history, and aggregation distinct', () => {
    expect(currentMilbTraditionalMigration).toContain(
      "app.jsonb_number(record.record_json -> 'player', 'id')::bigint AS mlbam_id",
    )
    expect(currentMilbTraditionalMigration).toContain(
      'WHERE current_team_id = team_id',
    )
    expect(currentMilbTraditionalMigration).toContain(
      'representative.level AS highest_observed_level',
    )
    expect(currentMilbTraditionalMigration).toContain(
      'jsonb_agg(',
    )
    expect(currentMilbTraditionalMigration).toContain(
      'sum(coalesce(plate_appearances, 0))',
    )
    expect(currentMilbTraditionalMigration).toContain(
      'CREATE UNIQUE INDEX current_milb_traditional_profile_uidx',
    )
    expect(currentMilbTraditionalMigration).not.toContain(
      'DROP MATERIALIZED VIEW',
    )
  })
})
