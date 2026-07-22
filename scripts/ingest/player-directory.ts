import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'
import {
  MLB_STATSAPI_MILB_ROSTER_MINIMUM_ORGANIZATIONS,
  MLB_STATSAPI_MILB_ROSTER_MINIMUM_UNIQUE_PLAYERS,
} from './mlb-statsapi-milb-roster.js'
import { awaitCancelableQuery, currentRefreshDatabaseOptions } from './shared.js'

export async function refreshPlayerDirectorySnapshot(
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions())

  try {
    await awaitCancelableQuery(sql`
      REFRESH MATERIALIZED VIEW CONCURRENTLY app.player_directory_snapshot
    `.execute(), signal)
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

export async function refreshCurrentMilbTraditionalSnapshot(
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions())

  try {
    await awaitCancelableQuery(sql`
      REFRESH MATERIALIZED VIEW CONCURRENTLY app.current_milb_traditional_snapshot
    `.execute(), signal)
    const [audit] = await sql<CurrentMilbTraditionalSnapshotAudit[]>`
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
    signal?.throwIfAborted()
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

export interface CurrentMilbRosterSnapshotAudit {
  profiles: number
  distinct_mlbam_ids: number
  roles: number
  organizations: number
  invalid_identity_rows: number
  invalid_level_rows: number
  missing_core_rows: number
  identity_conflict_rows: number
}

export async function refreshCurrentMilbRosterSnapshot(
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions(60_000))

  try {
    signal?.throwIfAborted()
    await awaitCancelableQuery(sql`
      REFRESH MATERIALIZED VIEW CONCURRENTLY app.current_milb_roster_snapshot
    `.execute(), signal)
    const [audit] = await sql<CurrentMilbRosterSnapshotAudit[]>`
      SELECT
        count(*)::integer AS profiles,
        count(DISTINCT mlbam_id)::integer AS distinct_mlbam_ids,
        count(DISTINCT player_type)::integer AS roles,
        count(DISTINCT organization_mlbam_id)::integer AS organizations,
        count(*) FILTER (
          WHERE mlbam_id IS NULL
            OR mlbam_id <= 0
            OR known_at IS NULL
        )::integer AS invalid_identity_rows,
        count(*) FILTER (
          WHERE current_level IS NOT NULL
            AND current_level NOT IN ('Rk', 'A', 'A+', 'AA', 'AAA')
        )::integer AS invalid_level_rows,
        count(*) FILTER (
          WHERE display_name IS NULL
            OR active IS NULL
            OR roster_status_code IS NULL
            OR roster_status_description IS NULL
            OR position IS NULL
            OR organization_mlbam_id IS NULL
            OR organization_name IS NULL
            OR season IS NULL
            OR roster_membership_count < 1
        )::integer AS missing_core_rows,
        count(*) FILTER (
          WHERE role_count <> 1 OR organization_count <> 1
        )::integer AS identity_conflict_rows
      FROM app.current_milb_roster_snapshot
    `
    assertCurrentMilbRosterSnapshot(audit)
    signal?.throwIfAborted()
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export function assertCurrentMilbRosterSnapshot(
  audit: CurrentMilbRosterSnapshotAudit | undefined,
): void {
  if (!audit) throw new Error('Current MiLB roster census audit returned no result')
  if (audit.profiles < MLB_STATSAPI_MILB_ROSTER_MINIMUM_UNIQUE_PLAYERS) {
    throw new Error(
      `Current MiLB roster census has ${audit.profiles} profiles; expected at least ` +
        `${MLB_STATSAPI_MILB_ROSTER_MINIMUM_UNIQUE_PLAYERS}`,
    )
  }
  if (audit.profiles !== audit.distinct_mlbam_ids) {
    throw new Error(
      `Current MiLB roster census has ${audit.profiles} profiles but ` +
        `${audit.distinct_mlbam_ids} distinct MLBAM identities`,
    )
  }
  if (audit.roles !== 2) {
    throw new Error(
      `Current MiLB roster census has ${audit.roles} player role(s); expected Hitter and Pitcher`,
    )
  }
  if (audit.organizations < MLB_STATSAPI_MILB_ROSTER_MINIMUM_ORGANIZATIONS) {
    throw new Error(
      `Current MiLB roster census covers ${audit.organizations} organizations; expected at ` +
        `least ${MLB_STATSAPI_MILB_ROSTER_MINIMUM_ORGANIZATIONS}`,
    )
  }
  if (audit.invalid_identity_rows > 0) {
    throw new Error(
      `Current MiLB roster census contains ${audit.invalid_identity_rows} invalid exact-identity row(s)`,
    )
  }
  if (audit.invalid_level_rows > 0) {
    throw new Error(
      `Current MiLB roster census contains ${audit.invalid_level_rows} invalid level row(s)`,
    )
  }
  if (audit.missing_core_rows > 0) {
    throw new Error(
      `Current MiLB roster census contains ${audit.missing_core_rows} row(s) without required roster context`,
    )
  }
  if (audit.identity_conflict_rows > 0) {
    throw new Error(
      `Current MiLB roster census contains ${audit.identity_conflict_rows} cross-membership role or organization conflict(s)`,
    )
  }
}

export async function refreshCurrentMlbValueSnapshot(
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions())

  try {
    await awaitCancelableQuery(sql`
      REFRESH MATERIALIZED VIEW CONCURRENTLY app.current_mlb_value_snapshot
    `.execute(), signal)
    const [audit] = await sql<{
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
    signal?.throwIfAborted()
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
