import type { IncomingMessage, ServerResponse } from 'node:http'
import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'
import {
  ingestBaseballReferenceCurrentSeason,
  type BaseballReferenceCurrentResult,
} from '../../scripts/ingest/baseball-reference-current.js'
import { ingestFangraphsCurrentProspects } from '../../scripts/ingest/fangraphs-prospects.js'
import {
  refreshCurrentMlbValueSnapshot,
  refreshCurrentMilbRosterSnapshot,
  refreshCurrentMilbTraditionalSnapshot,
  refreshPlayerDirectorySnapshot,
} from '../../scripts/ingest/player-directory.js'
import {
  ingestMlbStatsApiMilbRosterCensus,
  type IngestMlbStatsApiMilbRosterResult,
} from '../../scripts/ingest/mlb-statsapi-milb-roster.js'
import {
  backfillMlbStatsApiMilb,
  buildMlbStatsApiMilbSlices,
  type MlbStatsApiMilbBackfillResult,
} from '../../scripts/ingest/mlb-statsapi-milb.js'
import {
  backfillProspectSavant,
  type ProspectSavantBackfillResult,
} from '../../scripts/ingest/prospect-savant-leaders.js'
import { buildProspectSavantCurrentSlices } from '../../scripts/ingest/prospect-savant.js'
import { currentRefreshDatabaseOptions } from '../../scripts/ingest/shared.js'
import { hasValidCronAuthorization, sendJson } from '../_admin.js'

const jobKey = 'current-baseball-source-refresh-v1'

export const CURRENT_REFRESH_EXECUTION_BUDGET_MS = 270_000
export const CURRENT_REFRESH_STALE_RUN_MS = 6 * 60_000
export const CURRENT_REFRESH_SOURCE_BUDGETS_MS = {
  prospectSavant: 130_000,
  mlbStatsApi: 130_000,
  mlbRoster: 140_000,
  baseballReference: 80_000,
  fangraphs: 40_000,
} as const

export type RefreshRunStatus = 'succeeded' | 'partial' | 'failed'

interface RefreshSourceSuccess<T> {
  status: 'succeeded'
  result: T
}

interface RefreshSourceFailure<T> {
  status: 'failed'
  error: { message: string }
  result?: T
}

type RefreshSourceResult<T> =
  | RefreshSourceSuccess<T>
  | RefreshSourceFailure<T>

type FangraphsRefreshResult = Awaited<ReturnType<typeof ingestFangraphsCurrentProspects>>

export interface CurrentRefreshResult {
  season: number
  sourceSeasons: {
    prospectSavant: {
      standardLevels: number
      rookieLevel: number
    }
    mlbStatsApi: {
      standardLevels: number
      rookieLevel: number
    }
    mlbRoster: number
    baseballReference: number
    fangraphs: number
  }
  prospectSavant: RefreshSourceResult<ProspectSavantBackfillResult>
  mlbStatsApi: RefreshSourceResult<MlbStatsApiMilbBackfillResult>
  mlbRoster: RefreshSourceResult<IngestMlbStatsApiMilbRosterResult>
  baseballReference: RefreshSourceResult<BaseballReferenceCurrentResult>
  fangraphs: RefreshSourceResult<FangraphsRefreshResult>
}

export interface CurrentRefreshDependencies {
  backfillProspectSavant: typeof backfillProspectSavant
  refreshPlayerDirectorySnapshot: typeof refreshPlayerDirectorySnapshot
  backfillMlbStatsApiMilb: typeof backfillMlbStatsApiMilb
  refreshCurrentMilbTraditionalSnapshot: typeof refreshCurrentMilbTraditionalSnapshot
  ingestMlbStatsApiMilbRosterCensus: typeof ingestMlbStatsApiMilbRosterCensus
  refreshCurrentMilbRosterSnapshot: typeof refreshCurrentMilbRosterSnapshot
  ingestBaseballReferenceCurrentSeason: typeof ingestBaseballReferenceCurrentSeason
  refreshCurrentMlbValueSnapshot: typeof refreshCurrentMlbValueSnapshot
  ingestFangraphsCurrentProspects: typeof ingestFangraphsCurrentProspects
}

const defaultDependencies: CurrentRefreshDependencies = {
  backfillProspectSavant,
  refreshPlayerDirectorySnapshot,
  backfillMlbStatsApiMilb,
  refreshCurrentMilbTraditionalSnapshot,
  ingestMlbStatsApiMilbRosterCensus,
  refreshCurrentMilbRosterSnapshot,
  ingestBaseballReferenceCurrentSeason,
  refreshCurrentMlbValueSnapshot,
  ingestFangraphsCurrentProspects,
}

export function baseballSeasonForDate(date: Date): number {
  const year = date.getUTCFullYear()
  return date.getUTCMonth() < 3 ? year - 1 : year
}

export function prospectSavantRookieSeasonForDate(date: Date): number {
  const year = date.getUTCFullYear()
  return date.getUTCMonth() < 5 ? year - 1 : year
}

function cronTrigger(request: IncomingMessage): string {
  const userAgent = request.headers['user-agent']
  const value = Array.isArray(userAgent) ? userAgent[0] : userAgent
  return value === 'vercel-cron/1.0' ? 'vercel_cron' : 'authenticated_manual'
}

function safeError(error: unknown): { message: string } {
  return { message: error instanceof Error ? error.message : 'Unknown refresh error' }
}

export function deriveRefreshRunStatus(
  result: CurrentRefreshResult,
): RefreshRunStatus {
  const requiredStatuses = [
    result.prospectSavant.status,
    result.mlbStatsApi.status,
    result.mlbRoster.status,
    result.baseballReference.status,
    result.fangraphs.status,
  ]
  const successes = requiredStatuses.filter((status) => status === 'succeeded').length
  if (successes === requiredStatuses.length) return 'succeeded'
  if (successes === 0) return 'failed'
  return 'partial'
}

function aggregateError(
  result: CurrentRefreshResult,
): { sources: Record<string, { message: string }> } | null {
  const sources: Record<string, { message: string }> = {}
  for (const source of [
    'prospectSavant',
    'mlbStatsApi',
    'mlbRoster',
    'baseballReference',
    'fangraphs',
  ] as const) {
    const outcome = result[source]
    if (outcome.status === 'failed') sources[source] = outcome.error
  }
  return Object.keys(sources).length > 0 ? { sources } : null
}

async function attemptSource<T>(
  collect: () => Promise<T>,
  publish: (result: T) => Promise<void> | void = () => undefined,
  signal?: AbortSignal,
  fatalSignal?: AbortSignal,
): Promise<RefreshSourceResult<T>> {
  let result: T | undefined
  try {
    signal?.throwIfAborted()
    result = await collect()
    signal?.throwIfAborted()
    await publish(result)
    signal?.throwIfAborted()
    return { status: 'succeeded', result }
  } catch (error) {
    fatalSignal?.throwIfAborted()
    return {
      status: 'failed',
      error: safeError(error),
      ...(result === undefined ? {} : { result }),
    }
  }
}

function sourceDeadlineSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal
}

function assertProspectSavantComplete(
  result: ProspectSavantBackfillResult,
  expectedSlices: number,
): void {
  const completed = result.stored + result.duplicates
  if (
    result.attempted !== expectedSlices ||
    result.failures.length > 0 ||
    result.inProgress > 0 ||
    completed !== expectedSlices
  ) {
    throw new Error(
      `Prospect Savant refresh completed ${completed} of ${expectedSlices} slices; ` +
        `${result.failures.length} failed and ${result.inProgress} remain in progress`,
    )
  }
}

function assertMlbStatsApiComplete(
  result: MlbStatsApiMilbBackfillResult,
  expectedSlices: number,
): void {
  const completed = result.stored + result.duplicates
  if (
    result.attempted !== expectedSlices ||
    result.failures.length > 0 ||
    result.inProgress > 0 ||
    completed !== expectedSlices
  ) {
    throw new Error(
      `MLB StatsAPI refresh completed ${completed} of ${expectedSlices} slices; ` +
        `${result.failures.length} failed and ${result.inProgress} remain in progress`,
    )
  }
}

function assertMlbRosterComplete(
  result: IngestMlbStatsApiMilbRosterResult,
): void {
  if (result.status === 'in_progress') {
    throw new Error('MLB StatsAPI MiLB roster census remains in progress')
  }
}

function assertBaseballReferenceComplete(result: BaseballReferenceCurrentResult): void {
  const incomplete = [result.batting, result.pitching]
    .filter((side) => side.status === 'in_progress')
    .length
  if (incomplete > 0) {
    throw new Error(
      `Baseball-Reference refresh has ${incomplete} side(s) still in progress`,
    )
  }
}

export async function refreshCurrentSources(
  season: number,
  dependencies: CurrentRefreshDependencies = defaultDependencies,
  options: {
    signal?: AbortSignal
    prospectSavantSeason?: number
    prospectSavantRookieSeason?: number
  } = {},
): Promise<CurrentRefreshResult> {
  options.signal?.throwIfAborted()
  const prospectSavantSeason = options.prospectSavantSeason ?? season
  const prospectSavantRookieSeason =
    options.prospectSavantRookieSeason ?? prospectSavantSeason
  const slices = buildProspectSavantCurrentSlices(prospectSavantSeason).map((slice) => (
    slice.level === 'Rk' ? { ...slice, season: prospectSavantRookieSeason } : slice
  ))
  const mlbStatsApiSlices = buildMlbStatsApiMilbSlices({
    season: prospectSavantSeason,
    rookieSeason: prospectSavantRookieSeason,
  })
  const prospectSavantSignal = sourceDeadlineSignal(
    options.signal,
    CURRENT_REFRESH_SOURCE_BUDGETS_MS.prospectSavant,
  )
  const mlbStatsApiSignal = sourceDeadlineSignal(
    options.signal,
    CURRENT_REFRESH_SOURCE_BUDGETS_MS.mlbStatsApi,
  )
  const mlbRosterSignal = sourceDeadlineSignal(
    options.signal,
    CURRENT_REFRESH_SOURCE_BUDGETS_MS.mlbRoster,
  )
  const [prospectSavant, mlbStatsApi, mlbRoster] = await Promise.all([
    attemptSource(
      () => dependencies.backfillProspectSavant({
        slices,
        delayMs: 250,
        enforceCurrentCardinality: true,
        signal: prospectSavantSignal,
      }),
      async (sourceResult) => {
        assertProspectSavantComplete(sourceResult, slices.length)
        prospectSavantSignal.throwIfAborted()
        await dependencies.refreshPlayerDirectorySnapshot()
      },
      prospectSavantSignal,
      options.signal,
    ),
    attemptSource(
      () => dependencies.backfillMlbStatsApiMilb({
        slices: mlbStatsApiSlices,
        delayMs: 100,
        enforceCurrentCardinality: true,
        signal: mlbStatsApiSignal,
      }),
      async (sourceResult) => {
        mlbStatsApiSignal.throwIfAborted()
        await dependencies.refreshCurrentMilbTraditionalSnapshot()
        assertMlbStatsApiComplete(sourceResult, mlbStatsApiSlices.length)
      },
      mlbStatsApiSignal,
      options.signal,
    ),
    attemptSource(
      () => dependencies.ingestMlbStatsApiMilbRosterCensus(season, {
        signal: mlbRosterSignal,
      }),
      async (sourceResult) => {
        assertMlbRosterComplete(sourceResult)
        mlbRosterSignal.throwIfAborted()
        await dependencies.refreshCurrentMilbRosterSnapshot()
      },
      mlbRosterSignal,
      options.signal,
    ),
  ])

  const baseballReferenceSignal = sourceDeadlineSignal(
    options.signal,
    CURRENT_REFRESH_SOURCE_BUDGETS_MS.baseballReference,
  )
  const baseballReference = await attemptSource(
    () => dependencies.ingestBaseballReferenceCurrentSeason(
      season,
      {
        enforceCurrentCardinality: true,
        signal: baseballReferenceSignal,
      },
    ),
    async (sourceResult) => {
      assertBaseballReferenceComplete(sourceResult)
      baseballReferenceSignal.throwIfAborted()
      await dependencies.refreshCurrentMlbValueSnapshot()
    },
    baseballReferenceSignal,
    options.signal,
  )

  const fangraphsSignal = sourceDeadlineSignal(
    options.signal,
    CURRENT_REFRESH_SOURCE_BUDGETS_MS.fangraphs,
  )
  const fangraphs = await attemptSource(
    () => dependencies.ingestFangraphsCurrentProspects({
      season,
      signal: fangraphsSignal,
    }),
    () => undefined,
    fangraphsSignal,
    options.signal,
  )

  return {
    season,
    sourceSeasons: {
      prospectSavant: {
        standardLevels: prospectSavantSeason,
        rookieLevel: prospectSavantRookieSeason,
      },
      mlbStatsApi: {
        standardLevels: prospectSavantSeason,
        rookieLevel: prospectSavantRookieSeason,
      },
      mlbRoster: season,
      baseballReference: season,
      fangraphs: season,
    },
    prospectSavant,
    mlbStatsApi,
    mlbRoster,
    baseballReference,
    fangraphs,
  }
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    sendJson(response, 405, { error: 'Method not allowed' })
    return
  }

  if (!process.env.CRON_SECRET?.trim()) {
    sendJson(response, 503, { error: 'Scheduled refresh is not configured' })
    return
  }
  if (!hasValidCronAuthorization(request)) {
    sendJson(response, 401, { error: 'Unauthorized' })
    return
  }

  const now = new Date()
  const season = baseballSeasonForDate(now)
  const prospectSavantRookieSeason = prospectSavantRookieSeasonForDate(now)
  const refreshController = new AbortController()
  const deadline = setTimeout(() => {
    refreshController.abort(
      new Error(
        `Current source refresh exceeded its ${CURRENT_REFRESH_EXECUTION_BUDGET_MS / 1000}-second execution budget`,
      ),
    )
  }, CURRENT_REFRESH_EXECUTION_BUDGET_MS)
  deadline.unref()
  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions(10_000))
  let runId: string | null = null
  let result: CurrentRefreshResult | null = null

  try {
    await sql`
      UPDATE ops.refresh_run
      SET
        status = 'failed',
        finished_at = now(),
        error = jsonb_build_object('message', 'Refresh exceeded the stale-run timeout')
      WHERE job_key = ${jobKey}
        AND status = 'running'
        AND started_at < ${new Date(now.getTime() - CURRENT_REFRESH_STALE_RUN_MS)}
    `

    const claimed = await sql<{ id: string }[]>`
      INSERT INTO ops.refresh_run (
        job_key,
        trigger_kind,
        season,
        status,
        code_commit
      ) VALUES (
        ${jobKey},
        ${cronTrigger(request)},
        ${season},
        'running',
        ${process.env.VERCEL_GIT_COMMIT_SHA ?? 'local'}
      )
      ON CONFLICT (job_key) WHERE status = 'running' DO NOTHING
      RETURNING id
    `

    if (claimed.length === 0) {
      sendJson(response, 409, { status: 'already_running', jobKey })
      return
    }
    runId = claimed[0].id

    result = await refreshCurrentSources(
      season,
      defaultDependencies,
      { signal: refreshController.signal, prospectSavantRookieSeason },
    )
    const status = deriveRefreshRunStatus(result)
    const error = aggregateError(result)

    await sql`
      UPDATE ops.refresh_run
      SET
        status = ${status},
        finished_at = now(),
        result = ${sql.json(result as unknown as postgres.JSONValue)},
        error = ${error === null ? null : sql.json(error)}
      WHERE id = ${runId}
    `
    sendJson(response, status === 'failed' ? 500 : status === 'partial' ? 207 : 200, {
      status,
      jobKey,
      ...result,
    })
  } catch (error) {
    if (runId) {
      await sql`
        UPDATE ops.refresh_run
        SET
          status = 'failed',
          finished_at = now(),
          result = ${sql.json((result ?? { season }) as unknown as postgres.JSONValue)},
          error = ${sql.json(safeError(error))}
        WHERE id = ${runId}
      `.catch(() => undefined)
    }
    console.error('Current source refresh failed', error)
    sendJson(response, 500, { status: 'failed', jobKey, ...safeError(error) })
  } finally {
    clearTimeout(deadline)
    await sql.end({ timeout: 5 })
  }
}
