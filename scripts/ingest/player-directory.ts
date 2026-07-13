import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'

export async function refreshPlayerDirectorySnapshot(): Promise<void> {
  const sql = postgres(directDatabaseUrl(), {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 15,
  })

  try {
    await sql`REFRESH MATERIALIZED VIEW app.player_directory_snapshot`
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export async function refreshCurrentMlbValueSnapshot(): Promise<void> {
  const sql = postgres(directDatabaseUrl(), {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 15,
  })

  try {
    await sql`REFRESH MATERIALIZED VIEW app.current_mlb_value_snapshot`
    const [audit] = await sql<{
      invalid_two_way_rows: number
      invalid_small_cohort_percentiles: number
    }[]>`
      SELECT
        count(*) FILTER (
          WHERE observed_role = 'Two-way'
            AND NOT (has_substantive_batting AND has_substantive_pitching)
        )::integer AS invalid_two_way_rows,
        count(*) FILTER (
          WHERE role_peer_count < 25
            AND current_war_percentile IS NOT NULL
        )::integer AS invalid_small_cohort_percentiles
      FROM app.current_mlb_value_snapshot
    `
    assertCurrentMlbRoleSnapshot(audit)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export function assertCurrentMlbRoleSnapshot(
  audit: {
    invalid_two_way_rows: number
    invalid_small_cohort_percentiles: number
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
}
