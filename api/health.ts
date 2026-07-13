import { neon } from '@neondatabase/serverless'
import type { IncomingMessage, ServerResponse } from 'node:http'
import artifactStatus from './_data/artifact-status.json' with { type: 'json' }

interface HealthRow {
  database_time: string
  migration_count: string
}

interface DirectoryRow {
  rows: string
  season: number | null
  oldest_source_at: string | null
  newest_source_at: string | null
}

interface SourceRow {
  source: string
  dataset: string
  last_attempt_status: string | null
  last_attempt_started_at: string | null
  last_attempt_finished_at: string | null
  last_success_finished_at: string | null
  last_changed_at: string | null
  parser_version: string | null
  requested_season: string | null
  counts: Record<string, unknown> | null
}

interface SliceCoverageRow {
  season: number
  observed_slices: string
  oldest_slice_at: string
  newest_slice_at: string
}

interface RefreshRow {
  job_key: string
  status: string
  season: number | null
  started_at: string
  finished_at: string | null
  trigger_kind: string
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== 'GET') {
    response.statusCode = 405
    response.setHeader('Allow', 'GET')
    response.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!databaseUrl) {
    response.statusCode = 503
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ status: 'unconfigured' }))
    return
  }

  try {
    const sql = neon(databaseUrl)
    const [healthResult, directoryResult, sourceResult, prospectCoverageResult,
      baseballReferenceCoverageResult, refreshResult] = await Promise.all([
      sql`
        SELECT
          now()::text AS database_time,
          count(*)::text AS migration_count
        FROM public.schema_migration
      `,
      sql`
        SELECT
          count(*)::text AS rows,
          max(season)::integer AS season,
          min(latest_known_at)::text AS oldest_source_at,
          max(latest_known_at)::text AS newest_source_at
        FROM app.player_directory_snapshot
      `,
      sql`
        WITH latest_attempt AS (
          SELECT DISTINCT ON (run.dataset_id)
            run.dataset_id,
            run.status,
            run.started_at,
            run.finished_at
          FROM raw.ingestion_run AS run
          ORDER BY run.dataset_id, run.started_at DESC, run.id DESC
        ),
        latest_success AS (
          SELECT DISTINCT ON (run.dataset_id)
            run.dataset_id,
            run.finished_at,
            run.parser_version,
            run.parameters,
            run.counts,
            source_fetch.fetched_at
          FROM raw.ingestion_run AS run
          JOIN raw.fetch AS source_fetch ON source_fetch.run_id = run.id
          WHERE run.status = 'succeeded'
          ORDER BY run.dataset_id, source_fetch.fetched_at DESC, source_fetch.id DESC
        )
        SELECT
          source.slug AS source,
          dataset.dataset_key AS dataset,
          latest_attempt.status AS last_attempt_status,
          latest_attempt.started_at::text AS last_attempt_started_at,
          latest_attempt.finished_at::text AS last_attempt_finished_at,
          latest_success.finished_at::text AS last_success_finished_at,
          latest_success.fetched_at::text AS last_changed_at,
          latest_success.parser_version,
          coalesce(
            latest_success.parameters #>> '{slice,season}',
            latest_success.parameters ->> 'season',
            latest_success.parameters #>> '{request,query,season}'
          ) AS requested_season,
          latest_success.counts
        FROM catalog.dataset AS dataset
        JOIN catalog.source AS source ON source.id = dataset.source_id
        LEFT JOIN latest_attempt ON latest_attempt.dataset_id = dataset.id
        LEFT JOIN latest_success ON latest_success.dataset_id = dataset.id
        ORDER BY source.slug, dataset.dataset_key
      `,
      sql`
        WITH latest_slice AS (
          SELECT DISTINCT ON (
            (run.parameters #>> '{slice,season}')::integer,
            run.parameters #>> '{slice,role}',
            run.parameters #>> '{slice,level}'
          )
            (run.parameters #>> '{slice,season}')::integer AS season,
            run.parameters #>> '{slice,role}' AS role,
            run.parameters #>> '{slice,level}' AS level,
            source_fetch.fetched_at
          FROM raw.ingestion_run AS run
          JOIN raw.fetch AS source_fetch ON source_fetch.run_id = run.id
          JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
          JOIN catalog.source AS source ON source.id = dataset.source_id
          WHERE source.slug = 'prospect-savant'
            AND dataset.dataset_key = 'minor-league-leaders'
            AND run.status = 'succeeded'
            AND run.parameters #>> '{slice,pitchQualifier}' = '1'
            AND run.parameters #>> '{slice,minAge}' = '16'
            AND run.parameters #>> '{slice,maxAge}' = '40'
          ORDER BY
            (run.parameters #>> '{slice,season}')::integer,
            run.parameters #>> '{slice,role}',
            run.parameters #>> '{slice,level}',
            source_fetch.fetched_at DESC
        )
        SELECT
          season,
          count(*)::text AS observed_slices,
          min(fetched_at)::text AS oldest_slice_at,
          max(fetched_at)::text AS newest_slice_at
        FROM latest_slice
        WHERE season = (SELECT max(season) FROM latest_slice)
        GROUP BY season
      `,
      sql`
        WITH latest_side AS (
          SELECT DISTINCT ON (
            (run.parameters ->> 'season')::integer,
            run.parameters ->> 'side'
          )
            (run.parameters ->> 'season')::integer AS season,
            run.parameters ->> 'side' AS side,
            source_fetch.fetched_at
          FROM raw.ingestion_run AS run
          JOIN raw.fetch AS source_fetch ON source_fetch.run_id = run.id
          JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
          JOIN catalog.source AS source ON source.id = dataset.source_id
          WHERE source.slug = 'sports-reference'
            AND dataset.dataset_key = 'baseball-player-records'
            AND run.status = 'succeeded'
            AND run.parser_version = 'baseball-reference-current-value/v1'
          ORDER BY
            (run.parameters ->> 'season')::integer,
            run.parameters ->> 'side',
            source_fetch.fetched_at DESC
        )
        SELECT
          season,
          count(*)::text AS observed_slices,
          min(fetched_at)::text AS oldest_slice_at,
          max(fetched_at)::text AS newest_slice_at
        FROM latest_side
        WHERE season = (SELECT max(season) FROM latest_side)
        GROUP BY season
      `,
      sql`
        SELECT DISTINCT ON (job_key)
          job_key,
          status,
          season,
          started_at::text AS started_at,
          finished_at::text AS finished_at,
          trigger_kind
        FROM ops.refresh_run
        ORDER BY job_key, started_at DESC, id DESC
      `,
    ])
    const [health] = healthResult as unknown as HealthRow[]
    const [directory] = directoryResult as unknown as DirectoryRow[]
    const [prospectCoverage] = prospectCoverageResult as unknown as SliceCoverageRow[]
    const [baseballReferenceCoverage] =
      baseballReferenceCoverageResult as unknown as SliceCoverageRow[]

    response.statusCode = 200
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        status: 'ok',
        databaseTime: health.database_time,
        migrations: Number(health.migration_count),
        directory: {
          rows: Number(directory.rows),
          season: directory.season,
          oldestSourceAt: directory.oldest_source_at,
          newestSourceAt: directory.newest_source_at,
        },
        sources: (sourceResult as unknown as SourceRow[]).map((source) => ({
          source: source.source,
          dataset: source.dataset,
          lastAttemptStatus: source.last_attempt_status,
          lastAttemptStartedAt: source.last_attempt_started_at,
          lastAttemptFinishedAt: source.last_attempt_finished_at,
          lastSuccessFinishedAt: source.last_success_finished_at,
          lastChangedAt: source.last_changed_at,
          parserVersion: source.parser_version,
          requestedSeason: source.requested_season === null
            ? null
            : Number(source.requested_season),
          counts: source.counts,
        })),
        currentCoverage: {
          prospectSavant: prospectCoverage
            ? {
                season: prospectCoverage.season,
                observedSlices: Number(prospectCoverage.observed_slices),
                expectedSlices: 10,
                oldestSliceAt: prospectCoverage.oldest_slice_at,
                newestSliceAt: prospectCoverage.newest_slice_at,
              }
            : null,
          baseballReference: baseballReferenceCoverage
            ? {
                season: baseballReferenceCoverage.season,
                observedSides: Number(baseballReferenceCoverage.observed_slices),
                expectedSides: 2,
                oldestSideAt: baseballReferenceCoverage.oldest_slice_at,
                newestSideAt: baseballReferenceCoverage.newest_slice_at,
              }
            : null,
        },
        scheduledRefresh: {
          configured: Boolean(process.env.CRON_SECRET?.trim()),
          scheduleUtc: '17 10 * * *',
          jobs: (refreshResult as unknown as RefreshRow[]).map((job) => ({
            job_key: job.job_key,
            status: job.status,
            season: job.season,
            started_at: job.started_at,
            finished_at: job.finished_at,
            trigger_kind: job.trigger_kind,
          })),
        },
        modelArtifacts: artifactStatus.artifacts,
      }),
    )
  } catch (error) {
    console.error('Health query failed', error)
    response.statusCode = 503
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ status: 'unavailable' }))
  }
}
