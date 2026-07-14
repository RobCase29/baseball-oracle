import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { directDatabaseUrl } from '../db/client.js'
import {
  ingestMlbStatsApiMilbRosterCensus,
  MLB_STATSAPI_MILB_ROSTER_MINIMUM_ORGANIZATIONS,
  MLB_STATSAPI_MILB_ROSTER_MINIMUM_UNIQUE_PLAYERS,
  type IngestMlbStatsApiMilbRosterResult,
} from './ingest/mlb-statsapi-milb-roster.js'
import { refreshCurrentMilbRosterSnapshot } from './ingest/player-directory.js'
import {
  abortableDelay,
  currentRefreshDatabaseOptions,
} from './ingest/shared.js'

const bootstrapAdvisoryLockId = 2_026_071_402
const advisoryLockWaitMs = 5_000
const advisoryLockMaximumAttempts = 60
const inProgressWaitMs = 5_000
const inProgressMaximumAttempts = 24

type SqlClient = ReturnType<typeof postgres>

export function currentMilbRosterBootstrapDatabaseOptions() {
  return {
    ...currentRefreshDatabaseOptions(300_000),
    // The session-level advisory lock must survive the long source fetch.
    idle_timeout: 0,
  } as const
}

export interface CurrentMilbRosterBootstrapCoverage {
  profiles: number
  distinctMlbamIds: number
  roles: number
  organizations: number
  minimumSeason: number | null
  maximumSeason: number | null
  latestKnownAt: Date | null
  invalidIdentityRows: number
  invalidLevelRows: number
  missingCoreRows: number
  identityConflictRows: number
}

export type CurrentMilbRosterBootstrapReason =
  | 'not_production'
  | 'forced'
  | 'snapshot_missing'
  | 'coverage_below_minimum'
  | 'duplicate_identity'
  | 'roles_incomplete'
  | 'organizations_incomplete'
  | 'season_mismatch'
  | 'missing_provenance'
  | 'invalid_snapshot_rows'
  | 'adequate'

export interface CurrentMilbRosterBootstrapDecision {
  action: 'bootstrap' | 'skip'
  reason: CurrentMilbRosterBootstrapReason
  season: number
}

export interface CurrentMilbRosterBootstrapResult {
  decision: CurrentMilbRosterBootstrapDecision
  coverage: CurrentMilbRosterBootstrapCoverage | null
  ingestion: IngestMlbStatsApiMilbRosterResult | null
}

export function currentMilbRosterSeasonForDate(date: Date): number {
  const time = date.getTime()
  if (!Number.isFinite(time)) throw new Error('Roster bootstrap date must be valid')
  const year = date.getUTCFullYear()
  return date.getUTCMonth() < 3 ? year - 1 : year
}

export function decideCurrentMilbRosterBootstrap(input: {
  coverage: CurrentMilbRosterBootstrapCoverage | null
  environment?: string
  force?: boolean
  now: Date
}): CurrentMilbRosterBootstrapDecision {
  const season = currentMilbRosterSeasonForDate(input.now)
  if (input.environment !== 'production' && !input.force) {
    return { action: 'skip', reason: 'not_production', season }
  }
  if (input.force) return { action: 'bootstrap', reason: 'forced', season }
  const coverage = input.coverage
  if (!coverage) return { action: 'bootstrap', reason: 'snapshot_missing', season }
  if (coverage.profiles < MLB_STATSAPI_MILB_ROSTER_MINIMUM_UNIQUE_PLAYERS) {
    return { action: 'bootstrap', reason: 'coverage_below_minimum', season }
  }
  if (coverage.distinctMlbamIds !== coverage.profiles) {
    return { action: 'bootstrap', reason: 'duplicate_identity', season }
  }
  if (coverage.roles !== 2) {
    return { action: 'bootstrap', reason: 'roles_incomplete', season }
  }
  if (coverage.organizations < MLB_STATSAPI_MILB_ROSTER_MINIMUM_ORGANIZATIONS) {
    return { action: 'bootstrap', reason: 'organizations_incomplete', season }
  }
  if (coverage.minimumSeason !== season || coverage.maximumSeason !== season) {
    return { action: 'bootstrap', reason: 'season_mismatch', season }
  }
  if (!coverage.latestKnownAt) {
    return { action: 'bootstrap', reason: 'missing_provenance', season }
  }
  if (
    coverage.invalidIdentityRows > 0 ||
    coverage.invalidLevelRows > 0 ||
    coverage.missingCoreRows > 0 ||
    coverage.identityConflictRows > 0
  ) {
    return { action: 'bootstrap', reason: 'invalid_snapshot_rows', season }
  }
  return { action: 'skip', reason: 'adequate', season }
}

function finiteInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Roster bootstrap coverage query returned an invalid count')
  }
  return parsed
}

function nullableSeason(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new Error('Roster bootstrap coverage query returned an invalid season')
  }
  return parsed
}

function nullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  const parsed = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('Roster bootstrap coverage query returned an invalid known-at timestamp')
  }
  return parsed
}

export async function readCurrentMilbRosterBootstrapCoverage(
  sql: SqlClient,
): Promise<CurrentMilbRosterBootstrapCoverage | null> {
  const [relation] = await sql<{ snapshot_exists: boolean }[]>`
    SELECT to_regclass('app.current_milb_roster_snapshot') IS NOT NULL
      AS snapshot_exists
  `
  if (!relation?.snapshot_exists) return null

  const [row] = await sql<Record<string, unknown>[]>`
    SELECT
      count(*)::integer AS profiles,
      count(DISTINCT mlbam_id)::integer AS distinct_mlbam_ids,
      count(DISTINCT player_type)::integer AS roles,
      count(DISTINCT organization_mlbam_id)::integer AS organizations,
      min(season)::integer AS minimum_season,
      max(season)::integer AS maximum_season,
      max(known_at) AS latest_known_at,
      count(*) FILTER (
        WHERE mlbam_id IS NULL OR mlbam_id <= 0 OR known_at IS NULL
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
  if (!row) return null
  return {
    profiles: finiteInteger(row.profiles),
    distinctMlbamIds: finiteInteger(row.distinct_mlbam_ids),
    roles: finiteInteger(row.roles),
    organizations: finiteInteger(row.organizations),
    minimumSeason: nullableSeason(row.minimum_season),
    maximumSeason: nullableSeason(row.maximum_season),
    latestKnownAt: nullableDate(row.latest_known_at),
    invalidIdentityRows: finiteInteger(row.invalid_identity_rows),
    invalidLevelRows: finiteInteger(row.invalid_level_rows),
    missingCoreRows: finiteInteger(row.missing_core_rows),
    identityConflictRows: finiteInteger(row.identity_conflict_rows),
  }
}

async function acquireBootstrapAdvisoryLock(
  sql: SqlClient,
  signal?: AbortSignal,
): Promise<void> {
  for (let attempt = 0; attempt < advisoryLockMaximumAttempts; attempt += 1) {
    signal?.throwIfAborted()
    const [result] = await sql<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(${bootstrapAdvisoryLockId}) AS acquired
    `
    if (result?.acquired) return
    await abortableDelay(advisoryLockWaitMs, signal)
  }
  throw new Error('Timed out waiting for the MiLB roster bootstrap advisory lock')
}

async function refreshAndRequireAdequateCoverage(input: {
  now: Date
  sql: SqlClient
}): Promise<CurrentMilbRosterBootstrapCoverage> {
  await refreshCurrentMilbRosterSnapshot()
  const coverage = await readCurrentMilbRosterBootstrapCoverage(input.sql)
  const decision = decideCurrentMilbRosterBootstrap({
    coverage,
    environment: 'production',
    force: false,
    now: input.now,
  })
  if (decision.action !== 'skip' || decision.reason !== 'adequate' || !coverage) {
    throw new Error(
      `Current MiLB roster bootstrap completed but the snapshot remains ` +
        `${decision.reason} for season ${decision.season}`,
    )
  }
  return coverage
}

async function waitForConcurrentLanding(input: {
  now: Date
  signal?: AbortSignal
  sql: SqlClient
}): Promise<CurrentMilbRosterBootstrapCoverage> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < inProgressMaximumAttempts; attempt += 1) {
    await abortableDelay(inProgressWaitMs, input.signal)
    try {
      return await refreshAndRequireAdequateCoverage({
        now: input.now,
        sql: input.sql,
      })
    } catch (error) {
      lastError = error
    }
  }
  const message = lastError instanceof Error ? lastError.message : 'unknown concurrent landing error'
  throw new Error(`Timed out waiting for the concurrent MiLB roster census: ${message}`)
}

export async function bootstrapCurrentMilbRosterSnapshot(options: {
  environment?: string
  force?: boolean
  now?: Date
  signal?: AbortSignal
} = {}): Promise<CurrentMilbRosterBootstrapResult> {
  const environment = options.environment ?? process.env.VERCEL_ENV
  const force = options.force ?? process.env.FORCE_MILB_ROSTER_BOOTSTRAP === '1'
  const now = options.now ?? new Date()
  const initialDecision = decideCurrentMilbRosterBootstrap({
    coverage: null,
    environment,
    force,
    now,
  })
  if (initialDecision.reason === 'not_production') {
    return { decision: initialDecision, coverage: null, ingestion: null }
  }

  const sql = postgres(directDatabaseUrl(), currentMilbRosterBootstrapDatabaseOptions())
  let locked = false
  try {
    options.signal?.throwIfAborted()
    await acquireBootstrapAdvisoryLock(sql, options.signal)
    locked = true
    options.signal?.throwIfAborted()

    const existingCoverage = await readCurrentMilbRosterBootstrapCoverage(sql)
    const decision = decideCurrentMilbRosterBootstrap({
      coverage: existingCoverage,
      environment,
      force,
      now,
    })
    if (decision.action === 'skip') {
      return { decision, coverage: existingCoverage, ingestion: null }
    }

    const ingestion = await ingestMlbStatsApiMilbRosterCensus(decision.season, {
      signal: options.signal,
    })
    const coverage = ingestion.status === 'in_progress'
      ? await waitForConcurrentLanding({
          now,
          signal: options.signal,
          sql,
        })
      : await refreshAndRequireAdequateCoverage({
          now,
          sql,
        })
    return { decision, coverage, ingestion }
  } finally {
    if (locked) {
      await sql`SELECT pg_advisory_unlock(${bootstrapAdvisoryLockId})`.catch(() => undefined)
    }
    await sql.end({ timeout: 5 })
  }
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  bootstrapCurrentMilbRosterSnapshot()
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        action: result.decision.action,
        reason: result.decision.reason,
        season: result.decision.season,
        profiles: result.coverage?.profiles ?? null,
        ingestionStatus: result.ingestion?.status ?? null,
      })}\n`)
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown roster bootstrap error'
      process.stderr.write(`${message}\n`)
      process.exitCode = 1
    })
}
