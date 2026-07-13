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
import { hasValidCronAuthorization, sendJson } from '../_admin.js'

const jobKey = 'current-baseball-source-refresh-v1'

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
  return date.getUTCMonth() < 2 ? year - 1 : year
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

function configuredSourceStatuses(
  result: CurrentRefreshResult,
): Array<'succeeded' | 'failed'> {
  return [
    result.prospectSavant.status,
    result.baseballReference.status,
    result.fangraphs.status,
  ].filter(
    (status): status is 'succeeded' | 'failed' => status !== 'not_configured',
  )
}

export function deriveRefreshRunStatus(
  result: CurrentRefreshResult,
): RefreshRunStatus {
  const statuses = configuredSourceStatuses(result)
  const successes = statuses.filter((status) => status === 'succeeded').length
  if (successes === statuses.length) return 'succeeded'
  if (successes === 0) return 'failed'
  return 'partial'
}

function aggregateError(
  result: CurrentRefreshResult,
): { sources: Record<string, { message: string }> } | null {
  const sources: Record<string, { message: string }> = {}
  for (const source of ['prospectSavant', 'baseballReference', 'fangraphs'] as const) {
    const outcome = result[source]
    if (outcome.status === 'failed') sources[source] = outcome.error
  }
  return Object.keys(sources).length > 0 ? { sources } : null
}

async function attemptSource<T>(
  collect: () => Promise<T>,
  publish: (result: T) => Promise<void> | void = () => undefined,
): Promise<RefreshSourceResult<T>> {
  let result: T | undefined
  try {
    result = await collect()
    await publish(result)
    return { status: 'succeeded', result }
  } catch (error) {
    return {
      status: 'failed',
      error: safeError(error),
      ...(result === undefined ? {} : { result }),
    }
  }
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
): Promise<CurrentRefreshResult> {
  const slices = buildProspectSavantCurrentSlices(season)
  const prospectSavant = await attemptSource(
    () => dependencies.backfillProspectSavant({
      slices,
      delayMs: 250,
      enforceCurrentCardinality: true,
    }),
    async (sourceResult) => {
      assertProspectSavantComplete(sourceResult, slices.length)
      await dependencies.refreshPlayerDirectorySnapshot()
    },
  )

  const baseballReference = await attemptSource(
    () => dependencies.ingestBaseballReferenceCurrentSeason(
      season,
      { enforceCurrentCardinality: true },
    ),
    async (sourceResult) => {
      assertBaseballReferenceComplete(sourceResult)
      await dependencies.refreshCurrentMlbValueSnapshot()
    },
  )

  let fangraphs: RefreshSourceResult<FangraphsRefreshResult>
  if (fangraphsConfiguration.status === 'not_configured') {
    fangraphs = { status: 'not_configured' }
  } else if (fangraphsConfiguration.status === 'invalid') {
    fangraphs = { status: 'failed', error: fangraphsConfiguration.error }
  } else {
    fangraphs = await attemptSource(
      () => dependencies.ingestFangraphsProspects({
        url: fangraphsConfiguration.url,
      }),
      (sourceResult) => {
        if (sourceResult.status === 'in_progress') {
          throw new Error('FanGraphs refresh is still in progress')
        }
      },
    )
  }

  return { season, prospectSavant, baseballReference, fangraphs }
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
  const sql = postgres(directDatabaseUrl(), {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 15,
  })
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
        AND started_at < now() - interval '15 minutes'
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
    await sql.end({ timeout: 5 })
  }
}
