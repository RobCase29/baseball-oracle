import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'
import { currentRefreshDatabaseOptions } from './shared.js'

export async function refreshPlayerDirectorySnapshot(): Promise<void> {
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions())

  try {
    await sql`REFRESH MATERIALIZED VIEW app.player_directory_snapshot`
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export interface CurrentMilbTraditionalSnapshotAudit {
  profiles: number
  roles: number
  invalid_identity_rows: number
  invalid_level_rows: number
  missing_workload_rows: number
}

export async function refreshCurrentMilbTraditionalSnapshot(): Promise<void> {
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions())

  try {
    await sql.begin(async (transaction) => {
      await transaction`REFRESH MATERIALIZED VIEW app.current_milb_traditional_snapshot`
      const [audit] = await transaction<CurrentMilbTraditionalSnapshotAudit[]>`
        SELECT
          count(*)::integer AS profiles,
          count(DISTINCT player_type)::integer AS roles,
          count(*) FILTER (
            WHERE mlbam_id IS NULL OR mlbam_id <= 0 OR known_at IS NULL
          )::integer AS invalid_identity_rows,
          count(*) FILTER (
            WHERE highest_observed_level NOT IN ('Rk', 'A', 'A+', 'AA', 'AAA')
              OR (current_level IS NOT NULL AND current_level NOT IN ('Rk', 'A', 'A+', 'AA', 'AAA'))
          )::integer AS invalid_level_rows,
          count(*) FILTER (
            WHERE (player_type = 'Hitter' AND pa IS NULL)
              OR (player_type = 'Pitcher' AND outs IS NULL)
          )::integer AS missing_workload_rows
        FROM app.current_milb_traditional_snapshot
      `
      assertCurrentMilbTraditionalSnapshot(audit)
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export function assertCurrentMilbTraditionalSnapshot(
  audit: CurrentMilbTraditionalSnapshotAudit | undefined,
): void {
  if (!audit) throw new Error('Current MiLB traditional-stat audit returned no result')
  if (audit.profiles === 0 || audit.roles !== 2) {
    throw new Error(
      `Current MiLB traditional-stat snapshot has ${audit.profiles} profile(s) across ` +
        `${audit.roles} role(s); expected a non-empty two-role universe`,
    )
  }
  if (audit.invalid_identity_rows > 0) {
    throw new Error(
      `Current MiLB traditional-stat snapshot contains ${audit.invalid_identity_rows} invalid exact-identity row(s)`,
    )
  }
  if (audit.invalid_level_rows > 0) {
    throw new Error(
      `Current MiLB traditional-stat snapshot contains ${audit.invalid_level_rows} invalid level row(s)`,
    )
  }
  if (audit.missing_workload_rows > 0) {
    throw new Error(
      `Current MiLB traditional-stat snapshot contains ${audit.missing_workload_rows} row(s) without role workload`,
    )
  }
}

export async function refreshCurrentMlbValueSnapshot(): Promise<void> {
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions())

  try {
    await sql.begin(async (transaction) => {
      await transaction`REFRESH MATERIALIZED VIEW app.current_mlb_value_snapshot`
      const [audit] = await transaction<{
        invalid_two_way_rows: number
        invalid_small_cohort_percentiles: number
        identity_conflicts: number
      }[]>`
        SELECT
          count(*) FILTER (
            WHERE observed_role = 'Two-way'
              AND NOT (has_substantive_batting AND has_substantive_pitching)
          )::integer AS invalid_two_way_rows,
          count(*) FILTER (
            WHERE role_peer_count < 25
              AND current_war_percentile IS NOT NULL
          )::integer AS invalid_small_cohort_percentiles,
          count(*) FILTER (WHERE identity_conflict)::integer AS identity_conflicts
        FROM app.current_mlb_value_snapshot
      `
      assertCurrentMlbRoleSnapshot(audit)
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export function assertCurrentMlbRoleSnapshot(
  audit: {
    invalid_two_way_rows: number
    invalid_small_cohort_percentiles: number
    identity_conflicts: number
  } | undefined,
): void {
  if (!audit) throw new Error('Current MLB role-cohort audit returned no result')
  if (audit.invalid_two_way_rows > 0) {
    throw new Error(
      `Current MLB snapshot contains ${audit.invalid_two_way_rows} nominal two-way row(s) without meaningful hitting and pitching opportunity`,
    )
  }
  if (audit.invalid_small_cohort_percentiles > 0) {
    throw new Error(
      `Current MLB snapshot published ${audit.invalid_small_cohort_percentiles} percentile(s) from undersized role cohorts`,
    )
  }
  if (audit.identity_conflicts > 0) {
    throw new Error(
      `Current MLB snapshot contains ${audit.identity_conflicts} conflicting batting/pitching MLBAM identity pair(s)`,
    )
  }
}
