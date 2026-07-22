import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'
import {
  MLB_STATSAPI_MILB_ROSTER_MINIMUM_ORGANIZATIONS,
  MLB_STATSAPI_MILB_ROSTER_MINIMUM_UNIQUE_PLAYERS,
  mlbStatsApiMilbRosterPlayerType,
  type FetchedMlbStatsApiMilbRosterCensus,
  type MlbStatsApiMilbRosterTeam,
} from './mlb-statsapi-milb-roster.js'
import { awaitCancelableQuery, currentRefreshDatabaseOptions } from './shared.js'

async function logRosterSnapshotWait(refreshPid: number): Promise<void> {
  const diagnostics = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions(5_000))
  try {
    const rows = await diagnostics<{
      blocked_state: string | null
      blocked_wait_event_type: string | null
      blocked_wait_event: string | null
      blocker_pid: number | null
      blocker_application_name: string | null
      blocker_state: string | null
      blocker_wait_event_type: string | null
      blocker_wait_event: string | null
      blocker_query_age_seconds: number | null
      blocker_transaction_age_seconds: number | null
      blocker_query: string | null
    }[]>`
      SELECT
        blocked.state AS blocked_state,
        blocked.wait_event_type AS blocked_wait_event_type,
        blocked.wait_event AS blocked_wait_event,
        blocker.pid AS blocker_pid,
        blocker.application_name AS blocker_application_name,
        blocker.state AS blocker_state,
        blocker.wait_event_type AS blocker_wait_event_type,
        blocker.wait_event AS blocker_wait_event,
        extract(epoch FROM now() - blocker.query_start)::integer
          AS blocker_query_age_seconds,
        extract(epoch FROM now() - blocker.xact_start)::integer
          AS blocker_transaction_age_seconds,
        left(regexp_replace(blocker.query, E'\\s+', ' ', 'g'), 160)
          AS blocker_query
      FROM pg_stat_activity AS blocked
      LEFT JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS blocked_by(pid)
        ON true
      LEFT JOIN pg_stat_activity AS blocker
        ON blocker.pid = blocked_by.pid
      WHERE blocked.pid = ${refreshPid}
    `
    console.warn('[snapshot-refresh] roster publication wait diagnostic', rows)
  } catch (error) {
    console.error('[snapshot-refresh] roster wait diagnostic failed', error)
  } finally {
    await diagnostics.end({ timeout: 5 })
  }
}

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

interface CurrentMilbRosterSnapshotRow {
  profile_id: string
  mlbam_id: number
  membership_kind: 'affiliate' | 'parent_census'
  player_type: 'Hitter' | 'Pitcher'
  display_name: string
  age: number | null
  mlb_debut_date: string | null
  active: boolean
  roster_status_code: string
  roster_status_description: string
  roster_status_group: string
  position: string
  bats: string | null
  throws: string | null
  organization_mlbam_id: number
  organization_name: string
  current_team_mlbam_id: number | null
  current_team_name: string | null
  current_level: string | null
  sport_id: number | null
  current_league_name: string | null
  current_league_abbreviation: string | null
  rookie_affiliate_family: string | null
  season: number
  known_at: Date
  roster_membership_count: number
  affiliate_roster_membership_count: number
  parent_census_membership_count: number
  role_count: number
  organization_count: number
  roster_memberships: Record<string, unknown>[]
}

interface CurrentMilbRosterMembership {
  row: Omit<
    CurrentMilbRosterSnapshotRow,
    | 'profile_id'
    | 'roster_membership_count'
    | 'affiliate_roster_membership_count'
    | 'parent_census_membership_count'
    | 'role_count'
    | 'organization_count'
    | 'roster_memberships'
  >
  level_rank: number
}

const currentMilbRosterSnapshotColumns = [
  'profile_id',
  'mlbam_id',
  'membership_kind',
  'player_type',
  'display_name',
  'age',
  'mlb_debut_date',
  'active',
  'roster_status_code',
  'roster_status_description',
  'roster_status_group',
  'position',
  'bats',
  'throws',
  'organization_mlbam_id',
  'organization_name',
  'current_team_mlbam_id',
  'current_team_name',
  'current_level',
  'sport_id',
  'current_league_name',
  'current_league_abbreviation',
  'rookie_affiliate_family',
  'season',
  'known_at',
  'roster_membership_count',
  'affiliate_roster_membership_count',
  'parent_census_membership_count',
  'role_count',
  'organization_count',
  'roster_memberships',
] as const

function rosterStatusGroup(description: string): string {
  const normalized = description.toLowerCase()
  if (description === 'Active') return 'active'
  if (description === 'Rehab Assignment') return 'rehab'
  if (normalized.startsWith('injured')) return 'injured'
  if (description === 'Development List') return 'development'
  if (normalized.includes('restricted')) return 'restricted'
  if ([
    'Administrative Leave',
    'Military Leave',
    'Not Yet Reported',
    'Reserve List (Minors)',
    'Suspended # days',
    'Temporary Inactive List',
  ].includes(description)) return 'inactive'
  return 'other'
}

function teamRecord(team: MlbStatsApiMilbRosterTeam | null): Record<string, unknown> | null {
  return team as Record<string, unknown> | null
}

function nestedString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function assignmentLevel(team: MlbStatsApiMilbRosterTeam | null): {
  level: string | null
  rank: number
} {
  const sportId = team?.sport.id
  if (sportId === 16) return { level: 'Rk', rank: 1 }
  if (sportId === 14) return { level: 'A', rank: 2 }
  if (sportId === 13) return { level: 'A+', rank: 3 }
  if (sportId === 12) return { level: 'AA', rank: 4 }
  if (sportId === 11) return { level: 'AAA', rank: 5 }
  return { level: null, rank: 0 }
}

function membershipPriority(membership: CurrentMilbRosterMembership): number[] {
  const statusPriority = new Map([
    ['rehab', 1],
    ['active', 2],
    ['development', 3],
    ['injured', 4],
    ['restricted', 5],
    ['inactive', 6],
  ])
  return [
    membership.row.membership_kind === 'affiliate' ? 1 : 2,
    statusPriority.get(membership.row.roster_status_group) ?? 7,
    -membership.level_rank,
    membership.row.current_team_mlbam_id ?? Number.MAX_SAFE_INTEGER,
  ]
}

function compareMemberships(
  left: CurrentMilbRosterMembership,
  right: CurrentMilbRosterMembership,
): number {
  const leftPriority = membershipPriority(left)
  const rightPriority = membershipPriority(right)
  for (let index = 0; index < leftPriority.length; index += 1) {
    const difference = leftPriority[index] - rightPriority[index]
    if (difference !== 0) return difference
  }
  return 0
}

export function currentMilbRosterSnapshotRows(
  census: FetchedMlbStatsApiMilbRosterCensus,
  knownAt: Date,
): CurrentMilbRosterSnapshotRow[] {
  const affiliateTeamsById = new Map(census.teams.map((team) => [team.id, team]))
  const membershipsByPlayer = new Map<number, CurrentMilbRosterMembership[]>()

  for (const response of census.rosterResponses) {
    for (const entry of response.roster) {
      const currentTeam = entry.person.currentTeam
      const currentTeamRecord = currentTeam !== null &&
        typeof currentTeam === 'object' &&
        !Array.isArray(currentTeam)
        ? currentTeam as Record<string, unknown>
        : null
      const currentTeamId = typeof currentTeamRecord?.id === 'number'
        ? currentTeamRecord.id
        : null
      const assignmentTeam = response.membershipKind === 'affiliate'
        ? response.team
        : currentTeamId === null
          ? null
          : affiliateTeamsById.get(currentTeamId) ?? null
      const assignment = teamRecord(assignmentTeam)
      const league = assignment?.league !== null &&
        typeof assignment?.league === 'object' &&
        !Array.isArray(assignment.league)
        ? assignment.league as Record<string, unknown>
        : null
      const { level, rank } = assignmentLevel(assignmentTeam)
      const statusGroup = rosterStatusGroup(entry.status.description)
      const rookieAffiliateFamily = assignmentTeam?.name.startsWith('ACL ')
        ? 'ACL'
        : assignmentTeam?.name.startsWith('FCL ')
          ? 'FCL'
          : assignmentTeam?.name.startsWith('DSL ')
            ? 'DSL'
            : null
      const membership: CurrentMilbRosterMembership = {
        level_rank: rank,
        row: {
          mlbam_id: entry.person.id,
          membership_kind: response.membershipKind,
          player_type: mlbStatsApiMilbRosterPlayerType(entry),
          display_name: entry.person.fullName,
          age: entry.person.currentAge ?? null,
          mlb_debut_date: entry.person.mlbDebutDate?.match(/^\d{4}-\d{2}-\d{2}$/u)
            ? entry.person.mlbDebutDate
            : null,
          active: entry.person.active,
          roster_status_code: entry.status.code,
          roster_status_description: entry.status.description,
          roster_status_group: statusGroup,
          position: entry.person.primaryPosition.abbreviation || entry.position.abbreviation,
          bats: entry.person.batSide?.code ?? null,
          throws: entry.person.pitchHand?.code ?? null,
          organization_mlbam_id: response.team.parentOrgId,
          organization_name: response.team.parentOrgName,
          current_team_mlbam_id: assignmentTeam?.id ?? null,
          current_team_name: assignmentTeam?.name ?? null,
          current_level: level,
          sport_id: assignmentTeam?.sport.id ?? null,
          current_league_name: nestedString(league, 'name'),
          current_league_abbreviation: nestedString(league, 'abbreviation'),
          rookie_affiliate_family: rookieAffiliateFamily,
          season: census.season,
          known_at: knownAt,
        },
      }
      const memberships = membershipsByPlayer.get(entry.person.id) ?? []
      memberships.push(membership)
      membershipsByPlayer.set(entry.person.id, memberships)
    }
  }

  return [...membershipsByPlayer.entries()]
    .sort(([left], [right]) => left - right)
    .map(([mlbamId, memberships]) => {
      memberships.sort(compareMemberships)
      const representative = memberships[0].row
      return {
        profile_id: `mlb-statsapi-roster:${mlbamId}`,
        ...representative,
        roster_membership_count: memberships.length,
        affiliate_roster_membership_count: memberships.filter(
          ({ row }) => row.membership_kind === 'affiliate',
        ).length,
        parent_census_membership_count: memberships.filter(
          ({ row }) => row.membership_kind === 'parent_census',
        ).length,
        role_count: new Set(memberships.map(({ row }) => row.player_type)).size,
        organization_count: new Set(
          memberships.map(({ row }) => row.organization_mlbam_id),
        ).size,
        roster_memberships: memberships.map(({ row }) => ({
          teamMlbamId: row.current_team_mlbam_id,
          teamName: row.current_team_name,
          organizationMlbamId: row.organization_mlbam_id,
          organizationName: row.organization_name,
          level: row.current_level,
          sportId: row.sport_id,
          statusCode: row.roster_status_code,
          statusDescription: row.roster_status_description,
          statusGroup: row.roster_status_group,
          membershipKind: row.membership_kind,
        })),
      }
    })
}

export async function refreshCurrentMilbRosterSnapshot(
  signal?: AbortSignal,
  census?: FetchedMlbStatsApiMilbRosterCensus,
  knownAt = new Date(),
): Promise<void> {
  signal?.throwIfAborted()
  const statementTimeoutMs = 320_000
  const lockTimeoutMs = 5_000
  const sql = postgres(
    directDatabaseUrl(),
    currentRefreshDatabaseOptions(statementTimeoutMs),
  )
  let waitProbe: ReturnType<typeof setTimeout> | null = null

  try {
    signal?.throwIfAborted()
    await sql`
      SELECT
        set_config('statement_timeout', ${statementTimeoutMs.toString()}, false),
        set_config('lock_timeout', ${lockTimeoutMs.toString()}, false)
    `
    const [session] = await sql<{
      pid: number
      statement_timeout: string
      lock_timeout: string
      application_name: string
    }[]>`
      SELECT
        pg_backend_pid() AS pid,
        current_setting('statement_timeout') AS statement_timeout,
        current_setting('lock_timeout') AS lock_timeout,
        current_setting('application_name') AS application_name
    `
    if (!session) throw new Error('Roster snapshot database session is unavailable')
    console.log('[snapshot-refresh] roster publication session', session)
    waitProbe = setTimeout(() => {
      void logRosterSnapshotWait(session.pid)
    }, 10_000)
    waitProbe.unref()
    await sql.begin(async (transaction) => {
      if (census) {
        const rows = currentMilbRosterSnapshotRows(census, knownAt)
        await transaction`
          CREATE TEMP TABLE current_milb_roster_snapshot_stage (
            LIKE app.current_milb_roster_snapshot INCLUDING DEFAULTS
          ) ON COMMIT DROP
        `
        for (let offset = 0; offset < rows.length; offset += 1_000) {
          signal?.throwIfAborted()
          const batch = rows.slice(offset, offset + 1_000).map((row) => ({
            ...row,
            roster_memberships: transaction.json(
              row.roster_memberships as postgres.JSONValue,
            ),
          }))
          await transaction`
            INSERT INTO current_milb_roster_snapshot_stage ${transaction(
              batch,
              ...currentMilbRosterSnapshotColumns,
            )}
          `
        }
      } else {
        await awaitCancelableQuery(transaction`
          CREATE TEMP TABLE current_milb_roster_snapshot_stage
          ON COMMIT DROP
          AS
          SELECT *
          FROM app.current_milb_roster_computed
        `.execute(), signal)
      }
      signal?.throwIfAborted()

      const [audit] = await transaction<CurrentMilbRosterSnapshotAudit[]>`
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
        FROM current_milb_roster_snapshot_stage
      `
      assertCurrentMilbRosterSnapshot(audit)
      signal?.throwIfAborted()

      await transaction`DELETE FROM app.current_milb_roster_snapshot`
      await transaction`
        INSERT INTO app.current_milb_roster_snapshot
        SELECT *
        FROM current_milb_roster_snapshot_stage
      `
    })
    clearTimeout(waitProbe)
    waitProbe = null
    signal?.throwIfAborted()
  } finally {
    if (waitProbe) clearTimeout(waitProbe)
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
