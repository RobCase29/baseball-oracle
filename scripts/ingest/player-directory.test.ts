import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertCurrentMlbRoleSnapshot,
  assertCurrentMilbRosterSnapshot,
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
const currentMilbRosterMigration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0019_mlb_statsapi_current_milb_roster.sql'),
  'utf8',
)
const optimizedCurrentMilbRosterMigration = readFileSync(
  resolve(
    process.cwd(),
    'db/migrations/0020_optimize_current_milb_roster_source.sql',
  ),
  'utf8',
)
const atomicCurrentMilbRosterMigration = readFileSync(
  resolve(
    process.cwd(),
    'db/migrations/0021_atomic_current_milb_roster_publication.sql',
  ),
  'utf8',
)
const playerDirectorySource = readFileSync(
  resolve(process.cwd(), 'scripts/ingest/player-directory.ts'),
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

describe('official current MiLB roster census', () => {
  const validAudit = {
    profiles: 8_200,
    distinct_mlbam_ids: 8_200,
    roles: 2,
    organizations: 30,
    invalid_identity_rows: 0,
    invalid_level_rows: 0,
    missing_core_rows: 0,
    identity_conflict_rows: 0,
  }

  it('accepts one exact-identity row per player across both roles and every organization', () => {
    expect(() => assertCurrentMilbRosterSnapshot(validAudit)).not.toThrow()
  })

  it('rejects incomplete, duplicated, malformed, or conflicting snapshots', () => {
    expect(() => assertCurrentMilbRosterSnapshot({
      ...validAudit,
      profiles: 6_999,
      distinct_mlbam_ids: 6_999,
    })).toThrow(/expected at least 7000/u)
    expect(() => assertCurrentMilbRosterSnapshot({
      ...validAudit,
      distinct_mlbam_ids: 8_199,
    })).toThrow(/distinct MLBAM identities/u)
    expect(() => assertCurrentMilbRosterSnapshot({
      ...validAudit,
      missing_core_rows: 1,
    })).toThrow(/without required roster context/u)
    expect(() => assertCurrentMilbRosterSnapshot({
      ...validAudit,
      identity_conflict_rows: 1,
    })).toThrow(/role or organization conflict/u)
    expect(() => assertCurrentMilbRosterSnapshot(undefined)).toThrow(/no result/u)
  })

  it('retains parent-only players without inventing a level and prefers affiliate memberships', () => {
    expect(currentMilbRosterMigration).toContain(
      "record.record_json ->> 'membershipKind' IN ('affiliate', 'parent_census')",
    )
    expect(currentMilbRosterMigration).toContain(
      "CASE membership_kind WHEN 'affiliate' THEN 1 ELSE 2 END",
    )
    expect(currentMilbRosterMigration).toContain(
      "record.record_json -> 'assignmentTeam' = 'null'::jsonb",
    )
    expect(currentMilbRosterMigration).toContain('representative.mlb_debut_date')
    expect(currentMilbRosterMigration).toContain('representative.roster_status_description')
    expect(currentMilbRosterMigration).toContain('representative.rookie_affiliate_family')
    expect(currentMilbRosterMigration).toContain(
      'CREATE UNIQUE INDEX current_milb_roster_mlbam_uidx',
    )
  })

  it('parses each roster numeric field once before the two snapshot aggregates', () => {
    expect(optimizedCurrentMilbRosterMigration).toContain(
      'parsed_record AS MATERIALIZED',
    )
    expect(optimizedCurrentMilbRosterMigration).toContain(
      'source_record AS MATERIALIZED',
    )
    expect(optimizedCurrentMilbRosterMigration).toContain(
      "source_record.membership_kind IN ('affiliate', 'parent_census')",
    )
    expect(optimizedCurrentMilbRosterMigration).toContain(
      "source_record.record_json -> 'assignmentTeam' = 'null'::jsonb",
    )
    expect(optimizedCurrentMilbRosterMigration).not.toContain('app.jsonb_number')
  })

  it('publishes materialized core snapshots without blocking API readers', () => {
    for (const view of [
      'player_directory_snapshot',
      'current_milb_traditional_snapshot',
      'current_mlb_value_snapshot',
    ]) {
      expect(playerDirectorySource).toContain(
        `REFRESH MATERIALIZED VIEW CONCURRENTLY app.${view}`,
      )
    }
    expect(playerDirectorySource).toContain('awaitCancelableQuery')
  })

  it('stages, validates, and atomically replaces the served roster table', () => {
    expect(atomicCurrentMilbRosterMigration).toContain(
      'roster_source AS MATERIALIZED',
    )
    expect(atomicCurrentMilbRosterMigration).toContain(
      'CREATE TABLE app.current_milb_roster_snapshot AS',
    )
    expect(playerDirectorySource).toContain(
      'CREATE TEMP TABLE current_milb_roster_snapshot_stage',
    )
    expect(playerDirectorySource).toContain(
      'currentMilbRosterSnapshotRows(census, knownAt)',
    )
    expect(playerDirectorySource).toContain(
      'FROM app.current_milb_roster_computed',
    )
    expect(playerDirectorySource).toContain(
      'DELETE FROM app.current_milb_roster_snapshot',
    )
    expect(playerDirectorySource).toContain(
      'INSERT INTO app.current_milb_roster_snapshot',
    )
  })
})
