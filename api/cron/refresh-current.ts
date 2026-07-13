import type { IncomingMessage, ServerResponse } from 'node:http'
import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'
import {
  ingestBaseballReferenceCurrentSeason,
  type BaseballReferenceCurrentResult,
} from '../../scripts/ingest/baseball-reference-current.js'
import { ingestFangraphsProspects } from '../../scripts/ingest/fangraphs-prospects.js'
import {
  refreshCurrentMlbValueSnapshot,
  refreshPlayerDirectorySnapshot,
} from '../../scripts/ingest/player-directory.js'
import {
  backfillProspectSavant,
  type ProspectSavantBackfillResult,
} from '../../scripts/ingest/prospect-savant-leaders.js'
import { buildProspectSavantCurrentSlices } from '../../scripts/ingest/prospect-savant.js'
import { currentRefreshDatabaseOptions } from '../../scripts/ingest/shared.js'
import { hasValidCronAuthorization, sendJson } from '../_admin.js'

const jobKey = 'current-baseball-source-refresh-v1'

export const CURRENT_REFRESH_EXECUTION_BUDGET_MS = 260_000
export const CURRENT_REFRESH_STALE_RUN_MS = 6 * 60_000
export const CURRENT_REFRESH_SOURCE_BUDGETS_MS = {
  prospectSavant: 105_000,
  baseballReference: 95_000,
  fangraphs: 10_000,
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

interface RefreshSourceNotConfigured {
  status: 'not_configured'
}

type RefreshSourceResult<T> =
  | RefreshSourceSuccess<T>
  | RefreshSourceFailure<T>
  | RefreshSourceNotConfigured

type FangraphsRefreshResult = Awaited<ReturnType<typeof ingestFangraphsProspects>>

export interface CurrentRefreshResult {
  season: number
  sourceSeasons: {
    prospectSavant: {
      standardLevels: number
      rookieLevel: number
    }
    baseballReference: number
  }
  prospectSavant: RefreshSourceResult<ProspectSavantBackfillResult>
  baseballReference: RefreshSourceResult<BaseballReferenceCurrentResult>
  fangraphs: RefreshSourceResult<FangraphsRefreshResult>
}

export interface CurrentRefreshDependencies {
  backfillProspectSavant: typeof backfillProspectSavant
  refreshPlayerDirectorySnapshot: typeof refreshPlayerDirectorySnapshot
  ingestBaseballReferenceCurrentSeason: typeof ingestBaseballReferenceCurrentSeason
  refreshCurrentMlbValueSnapshot: typeof refreshCurrentMlbValueSnapshot
  ingestFangraphsProspects: typeof ingestFangraphsProspects
}

export type FangraphsRefreshConfiguration =
  | { status: 'not_configured' }
  | { status: 'configured'; url: string }
  | { status: 'invalid'; error: { message: string } }

const defaultDependencies: CurrentRefreshDependencies = {
  backfillProspectSavant,
  refreshPlayerDirectorySnapshot,
  ingestBaseballReferenceCurrentSeason,
  refreshCurrentMlbValueSnapshot,
  ingestFangraphsProspects,
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

export function currentFangraphsConfiguration(): FangraphsRefreshConfiguration {
  const configured = process.env.FANGRAPHS_CURRENT_PROSPECTS_URL?.trim()
  if (!configured) return { status: 'not_configured' }
  try {
    const url = new URL(configured)
    const isFangraphsHost =
      url.hostname === 'fangraphs.com' || url.hostname.endsWith('.fangraphs.com')
    if (url.protocol !== 'https:' || !isFangraphsHost) {
      throw new Error('FANGRAPHS_CURRENT_PROSPECTS_URL must be an HTTPS FanGraphs URL')
    }
    return { status: 'configured', url: url.toString() }
  } catch (error) {
    return { status: 'invalid', error: safeError(error) }
  }
}

export function deriveRefreshRunStatus(
  result: CurrentRefreshResult,
): RefreshRunStatus {
  const requiredStatuses = [
    result.prospectSavant.status,
    result.baseballReference.status,
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
  for (const source of ['prospectSavant', 'baseballReference'] as const) {
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
  fangraphsConfiguration: FangraphsRefreshConfiguration,
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
  const prospectSavantSignal = sourceDeadlineSignal(
    options.signal,
    CURRENT_REFRESH_SOURCE_BUDGETS_MS.prospectSavant,
  )
  const prospectSavant = await attemptSource(
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
  )

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

  let fangraphs: RefreshSourceResult<FangraphsRefreshResult>
  if (fangraphsConfiguration.status === 'not_configured') {
    fangraphs = { status: 'not_configured' }
  } else if (fangraphsConfiguration.status === 'invalid') {
    fangraphs = { status: 'failed', error: fangraphsConfiguration.error }
  } else {
    const fangraphsSignal = sourceDeadlineSignal(
      options.signal,
      CURRENT_REFRESH_SOURCE_BUDGETS_MS.fangraphs,
    )
    fangraphs = await attemptSource(
      () => dependencies.ingestFangraphsProspects({
        signal: fangraphsSignal,
        url: fangraphsConfiguration.url,
      }),
      (sourceResult) => {
        if (sourceResult.status === 'in_progress') {
          throw new Error('FanGraphs refresh is still in progress')
        }
      },
      fangraphsSignal,
    )
  }

  return {
    season,
    sourceSeasons: {
      prospectSavant: {
        standardLevels: prospectSavantSeason,
        rookieLevel: prospectSavantRookieSeason,
      },
      baseballReference: season,
    },
    prospectSavant,
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
      currentFangraphsConfiguration(),
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
