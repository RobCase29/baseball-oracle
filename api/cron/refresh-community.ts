import type { IncomingMessage, ServerResponse } from 'node:http'
import postgres from 'postgres'
import { directDatabaseUrl } from '../../db/client.js'
import {
  backfillHarryKnowsBallIdentities,
  ingestHarryKnowsBallSnapshot,
  refreshHarryKnowsBallViews,
  type BackfillHarryKnowsBallIdentitiesResult,
  type IngestHarryKnowsBallSnapshotResult,
  type RefreshHarryKnowsBallViewsResult,
} from '../../scripts/ingest/harry-knows-ball.js'
import { currentRefreshDatabaseOptions } from '../../scripts/ingest/shared.js'
import { hasValidCronAuthorization, sendJson } from '../_admin.js'

export const COMMUNITY_REFRESH_JOB_KEY = 'harry-knows-ball-community-refresh-v1'
export const COMMUNITY_REFRESH_EXECUTION_BUDGET_MS = 180_000
export const COMMUNITY_REFRESH_STALE_RUN_MS = 4 * 60_000
export const COMMUNITY_REFRESH_IDENTITY_LIMIT = 25
export const COMMUNITY_REFRESH_IDENTITY_DELAY_MS = 750

export type CommunityRefreshStatus = 'succeeded' | 'partial' | 'failed'

export interface CommunityRefreshResult {
  snapshot: IngestHarryKnowsBallSnapshotResult
  identities:
    | { status: 'succeeded'; result: BackfillHarryKnowsBallIdentitiesResult }
    | { status: 'failed'; error: { message: string } }
  coverage: RefreshHarryKnowsBallViewsResult
}

export interface CommunityRefreshDependencies {
  ingestSnapshot: typeof ingestHarryKnowsBallSnapshot
  backfillIdentities: typeof backfillHarryKnowsBallIdentities
  refreshViews: typeof refreshHarryKnowsBallViews
}

const defaultDependencies: CommunityRefreshDependencies = {
  ingestSnapshot: ingestHarryKnowsBallSnapshot,
  backfillIdentities: backfillHarryKnowsBallIdentities,
  refreshViews: refreshHarryKnowsBallViews,
}

function safeError(error: unknown): { message: string } {
  return { message: error instanceof Error ? error.message : 'Unknown refresh error' }
}

function cronTrigger(request: IncomingMessage): string {
  const userAgent = request.headers['user-agent']
  const value = Array.isArray(userAgent) ? userAgent[0] : userAgent
  return value === 'vercel-cron/1.0' ? 'vercel_cron' : 'authenticated_manual'
}

export function deriveCommunityRefreshStatus(
  result: CommunityRefreshResult,
): CommunityRefreshStatus {
  if (result.snapshot.status === 'in_progress') return 'partial'
  if (result.identities.status === 'failed') return 'partial'
  const identity = result.identities.result
  return identity.attempted > 0 && identity.failures.length === identity.attempted
    ? 'partial'
    : 'succeeded'
}

export async function refreshCommunitySignals(
  dependencies: CommunityRefreshDependencies = defaultDependencies,
  options: { signal?: AbortSignal } = {},
): Promise<CommunityRefreshResult> {
  options.signal?.throwIfAborted()
  const snapshot = await dependencies.ingestSnapshot({ signal: options.signal })
  options.signal?.throwIfAborted()

  let identities: CommunityRefreshResult['identities']
  try {
    identities = {
      status: 'succeeded',
      result: await dependencies.backfillIdentities({
        delayMs: COMMUNITY_REFRESH_IDENTITY_DELAY_MS,
        limit: COMMUNITY_REFRESH_IDENTITY_LIMIT,
        signal: options.signal,
      }),
    }
  } catch (error) {
    options.signal?.throwIfAborted()
    identities = { status: 'failed', error: safeError(error) }
  }

  options.signal?.throwIfAborted()
  const coverage = await dependencies.refreshViews()
  return { snapshot, identities, coverage }
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

  const controller = new AbortController()
  const deadline = setTimeout(() => {
    controller.abort(new Error(
      `Community refresh exceeded its ${COMMUNITY_REFRESH_EXECUTION_BUDGET_MS / 1_000}-second execution budget`,
    ))
  }, COMMUNITY_REFRESH_EXECUTION_BUDGET_MS)
  deadline.unref()

  const sql = postgres(directDatabaseUrl(), currentRefreshDatabaseOptions(10_000))
  let runId: string | null = null
  let result: CommunityRefreshResult | null = null

  try {
    const now = new Date()
    await sql`
      UPDATE ops.refresh_run
      SET
        status = 'failed',
        finished_at = now(),
        error = jsonb_build_object('message', 'Refresh exceeded the stale-run timeout')
      WHERE job_key = ${COMMUNITY_REFRESH_JOB_KEY}
        AND status = 'running'
        AND started_at < ${new Date(now.getTime() - COMMUNITY_REFRESH_STALE_RUN_MS)}
    `

    const claimed = await sql<{ id: string }[]>`
      INSERT INTO ops.refresh_run (
        job_key,
        trigger_kind,
        status,
        code_commit
      ) VALUES (
        ${COMMUNITY_REFRESH_JOB_KEY},
        ${cronTrigger(request)},
        'running',
        ${process.env.VERCEL_GIT_COMMIT_SHA ?? 'local'}
      )
      ON CONFLICT (job_key) WHERE status = 'running' DO NOTHING
      RETURNING id
    `
    if (claimed.length === 0) {
      sendJson(response, 409, {
        status: 'already_running',
        jobKey: COMMUNITY_REFRESH_JOB_KEY,
      })
      return
    }
    runId = claimed[0].id

    result = await refreshCommunitySignals(defaultDependencies, {
      signal: controller.signal,
    })
    const status = deriveCommunityRefreshStatus(result)
    const error = status === 'partial'
      ? {
          message: result.identities.status === 'failed'
            ? result.identities.error.message
            : result.snapshot.status === 'in_progress'
              ? 'The source capture is already in progress'
              : `All ${result.identities.result.failures.length} attempted identity pages failed to resolve`,
        }
      : null

    await sql`
      UPDATE ops.refresh_run
      SET
        status = ${status},
        finished_at = now(),
        result = ${sql.json(result as unknown as postgres.JSONValue)},
        error = ${error === null ? null : sql.json(error)}
      WHERE id = ${runId}
    `
    sendJson(response, status === 'partial' ? 207 : 200, {
      status,
      jobKey: COMMUNITY_REFRESH_JOB_KEY,
      ...result,
    })
  } catch (error) {
    if (runId) {
      await sql`
        UPDATE ops.refresh_run
        SET
          status = 'failed',
          finished_at = now(),
          result = ${sql.json((result ?? {}) as unknown as postgres.JSONValue)},
          error = ${sql.json(safeError(error))}
        WHERE id = ${runId}
      `.catch(() => undefined)
    }
    console.error('Community signal refresh failed', error)
    sendJson(response, 500, {
      status: 'failed',
      jobKey: COMMUNITY_REFRESH_JOB_KEY,
      ...safeError(error),
    })
  } finally {
    clearTimeout(deadline)
    await sql.end({ timeout: 5 })
  }
}
