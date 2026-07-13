import { neon } from '@neondatabase/serverless'
import type { IncomingMessage, ServerResponse } from 'node:http'
import artifactStatus from './_data/artifact-status.json' with { type: 'json' }
import {
  assessCurrentDataFreshness,
  CURRENT_REFRESH_DAILY_MINUTES_UTC,
  CURRENT_REFRESH_SCHEDULE_UTC,
  type FreshnessRun,
  type RefreshRunStatus,
  type RefreshSourceStatus,
} from './_freshness.js'
import {
  assessMlbIdentityCrosswalkFreshness,
  requireMlbIdentityCrosswalk,
} from './_mlb-identity-crosswalk.js'
import { requireChadwickKeyMlbamLookup } from './_chadwick-key-mlbam.js'
import {
  composeMlbIdentityCrosswalk,
  type MlbIdentityOverlayRow,
} from './_mlb-identity-overlay.js'

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
  minimum_season: number
  observed_slices: string
  oldest_slice_at: string
  newest_slice_at: string
}

interface CurrentMlbIdentityRow {
  bbref_id: string
  mlbam_id: bigint | number | string | null
}

interface RefreshRow {
  job_key: string
  status: string
  season: number | null
  started_at: string
  finished_at: string | null
  trigger_kind: string
  result: Record<string, unknown> | null
}

const currentRefreshJobKey = 'current-baseball-source-refresh-v1'
const refreshSourceKeys = [
  'prospectSavant',
  'baseballReference',
  'mlbStatsApi',
  'fangraphs',
] as const

function refreshSourceStatuses(
  result: Record<string, unknown> | null,
): Record<string, RefreshSourceStatus> | undefined {
  if (!result) return undefined
  const statuses: Record<string, RefreshSourceStatus> = {}
  for (const key of refreshSourceKeys) {
    const sourceResult = result[key]
    if (!sourceResult || typeof sourceResult !== 'object') continue
    const status = (sourceResult as { status?: unknown }).status
    if (status === 'succeeded' || status === 'failed' || status === 'not_configured') {
      statuses[key] = status
    }
  }
  return Object.keys(statuses).length > 0 ? statuses : undefined
}

function refreshSourceErrors(
  result: Record<string, unknown> | null,
): Record<string, string> | undefined {
  if (!result) return undefined
  const errors: Record<string, string> = {}
  for (const key of refreshSourceKeys) {
    const sourceResult = result[key]
    if (!sourceResult || typeof sourceResult !== 'object') continue
    const message = (sourceResult as { error?: { message?: unknown } }).error?.message
    if (typeof message !== 'string' || !message.trim()) continue
    errors[key] = message.trim().slice(0, 500)
  }
  return Object.keys(errors).length > 0 ? errors : undefined
}

function freshnessRun(row: RefreshRow): FreshnessRun {
  return {
    jobKey: row.job_key,
    triggerKind: row.trigger_kind,
    status: row.status as RefreshRunStatus,
    season: row.season,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    sourceStatuses: refreshSourceStatuses(row.result),
    sourceErrors: refreshSourceErrors(row.result),
  }
}

function sourceKey(source: SourceRow): string | null {
  if (source.source === 'prospect-savant' && source.dataset === 'minor-league-leaders') {
    return 'prospectSavant'
  }
  if (source.source === 'sports-reference' && source.dataset === 'baseball-player-records') {
    return 'baseballReference'
  }
  if (source.source === 'mlb-statsapi' && source.dataset === 'current-milb-season-stats') {
    return 'mlbStatsApi'
  }
  if (source.source === 'fangraphs' && source.dataset === 'prospect-board') {
    return 'fangraphs'
  }
  return null
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
    const staticIdentityCrosswalk = requireMlbIdentityCrosswalk()
    const chadwickKeyMlbamLookup = requireChadwickKeyMlbamLookup()
    const [healthResult, directoryResult, sourceResult, prospectCoverageResult,
      mlbStatsApiCoverageResult, baseballReferenceCoverageResult,
      fangraphsCoverageResult, currentMlbIdentityResult, refreshResult,
      identityOverlayResult] = await Promise.all([
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
        WITH successful_slice AS (
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
            AND run.parameters #>> '{slice,role}' IN ('hitters', 'pitchers')
            AND run.parameters #>> '{slice,level}' IN ('Rk', 'A', 'A+', 'AA', 'AAA')
          ORDER BY
            (run.parameters #>> '{slice,season}')::integer,
            run.parameters #>> '{slice,role}',
            run.parameters #>> '{slice,level}',
            source_fetch.fetched_at DESC,
            source_fetch.id DESC
        ),
        complete_level_season AS (
          SELECT season, level
          FROM successful_slice
          GROUP BY season, level
          HAVING count(*) = 2
        ),
        selected_level_season AS (
          SELECT DISTINCT ON (level) season, level
          FROM complete_level_season
          ORDER BY level, season DESC
        ),
        latest_slice AS (
          SELECT successful_slice.*
          FROM successful_slice
          JOIN selected_level_season USING (season, level)
        )
        SELECT
          max(season)::integer AS season,
          min(season)::integer AS minimum_season,
          count(*)::text AS observed_slices,
          min(fetched_at)::text AS oldest_slice_at,
          max(fetched_at)::text AS newest_slice_at
        FROM latest_slice
        HAVING count(*) > 0
      `,
      sql`
        WITH successful_slice AS (
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
          WHERE source.slug = 'mlb-statsapi'
            AND dataset.dataset_key = 'current-milb-season-stats'
            AND run.status = 'succeeded'
            AND run.parser_version = 'mlb-statsapi-milb-season-v1'
            AND run.parameters #>> '{slice,role}' IN ('hitter', 'pitcher')
            AND run.parameters #>> '{slice,level}' IN ('Rk', 'A', 'A+', 'AA', 'AAA')
            AND run.parameters #>> '{slice,season}' ~ '^[0-9]{4}$'
          ORDER BY
            (run.parameters #>> '{slice,season}')::integer,
            run.parameters #>> '{slice,role}',
            run.parameters #>> '{slice,level}',
            source_fetch.fetched_at DESC,
            source_fetch.id DESC
        ),
        complete_level_season AS (
          SELECT season, level
          FROM successful_slice
          GROUP BY season, level
          HAVING count(*) = 2
        ),
        selected_level_season AS (
          SELECT DISTINCT ON (level) season, level
          FROM complete_level_season
          ORDER BY level, season DESC
        ),
        latest_level AS (
          SELECT successful_slice.*
          FROM successful_slice
          JOIN selected_level_season USING (season, level)
        )
        SELECT
          max(season)::integer AS season,
          min(season)::integer AS minimum_season,
          count(*)::text AS observed_slices,
          min(fetched_at)::text AS oldest_slice_at,
          max(fetched_at)::text AS newest_slice_at
        FROM latest_level
        HAVING count(*) > 0
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
        WITH successful_side AS (
          SELECT DISTINCT ON (
            (run.parameters ->> 'season')::integer,
            run.parameters ->> 'statsRole'
          )
            (run.parameters ->> 'season')::integer AS season,
            run.parameters ->> 'statsRole' AS side,
            source_fetch.fetched_at
          FROM raw.ingestion_run AS run
          JOIN raw.fetch AS source_fetch ON source_fetch.run_id = run.id
          JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
          JOIN catalog.source AS source ON source.id = dataset.source_id
          WHERE source.slug = 'fangraphs'
            AND dataset.dataset_key = 'prospect-board'
            AND run.status = 'succeeded'
            AND run.parser_version = 'fangraphs-prospect-board-v2'
            AND run.parameters ->> 'refreshScope' = 'current_prospect_board'
            AND run.parameters ->> 'statsRole' IN ('bat', 'pit')
            AND run.parameters ->> 'season' ~ '^[0-9]{4}$'
          ORDER BY
            (run.parameters ->> 'season')::integer,
            run.parameters ->> 'statsRole',
            source_fetch.fetched_at DESC,
            source_fetch.id DESC
        ),
        selected_season AS (
          SELECT season
          FROM successful_side
          GROUP BY season
          HAVING count(*) = 2
          ORDER BY season DESC
          LIMIT 1
        ),
        latest_side AS (
          SELECT successful_side.*
          FROM successful_side
          JOIN selected_season USING (season)
        )
        SELECT
          max(season)::integer AS season,
          min(season)::integer AS minimum_season,
          count(*)::text AS observed_slices,
          min(fetched_at)::text AS oldest_slice_at,
          max(fetched_at)::text AS newest_slice_at
        FROM latest_side
        HAVING count(*) > 0
      `,
      sql`
        SELECT bbref_id, mlbam_id
        FROM app.current_mlb_value_snapshot
        ORDER BY bbref_id
      `,
      sql`
        SELECT
          job_key,
          status,
          season,
          started_at::text AS started_at,
          finished_at::text AS finished_at,
          trigger_kind,
          result
        FROM ops.refresh_run
        WHERE job_key = ${currentRefreshJobKey}
        ORDER BY started_at DESC, id DESC
        LIMIT 200
      `,
      sql`
        SELECT
          bbref_id,
          chadwick_key,
          mlbam_id,
          first_mlb_season,
          created_at::text AS first_observed_at,
          updated_at::text AS last_observed_at
        FROM core.mlb_exact_identity_overlay
        ORDER BY bbref_id
      `,
    ])
    const [health] = healthResult as unknown as HealthRow[]
    const [directory] = directoryResult as unknown as DirectoryRow[]
    const [prospectCoverage] = prospectCoverageResult as unknown as SliceCoverageRow[]
    const [mlbStatsApiCoverage] =
      mlbStatsApiCoverageResult as unknown as SliceCoverageRow[]
    const [baseballReferenceCoverage] =
      baseballReferenceCoverageResult as unknown as SliceCoverageRow[]
    const [fangraphsCoverage] =
      fangraphsCoverageResult as unknown as SliceCoverageRow[]
    const currentMlbIdentityRows =
      currentMlbIdentityResult as unknown as CurrentMlbIdentityRow[]
    const identityOverlayRows = identityOverlayResult as unknown as MlbIdentityOverlayRow[]
    const sourceRows = sourceResult as unknown as SourceRow[]
    const refreshRows = refreshResult as unknown as RefreshRow[]
    const refreshRuns = refreshRows.map(freshnessRun)
    const sourceByRefreshKey = new Map(
      sourceRows
        .map((source) => [sourceKey(source), source] as const)
        .filter((entry): entry is [string, SourceRow] => entry[0] !== null),
    )
    const freshness = assessCurrentDataFreshness({
      now: new Date(health.database_time),
      cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
      runs: refreshRuns,
      scheduleMinutesUtc: CURRENT_REFRESH_DAILY_MINUTES_UTC,
      stuckAfterMinutes: 6,
      sources: [
        {
          key: 'prospectSavant',
          required: true,
          statsChangedAt:
            prospectCoverage?.newest_slice_at ??
            sourceByRefreshKey.get('prospectSavant')?.last_changed_at ??
            null,
          coverageComplete: prospectCoverage
            ? Number(prospectCoverage.observed_slices) === 10
            : false,
        },
        {
          key: 'mlbStatsApi',
          required: true,
          statsChangedAt:
            mlbStatsApiCoverage?.newest_slice_at ??
            sourceByRefreshKey.get('mlbStatsApi')?.last_changed_at ??
            null,
          coverageComplete: mlbStatsApiCoverage
            ? Number(mlbStatsApiCoverage.observed_slices) === 10
            : false,
        },
        {
          key: 'baseballReference',
          required: true,
          statsChangedAt:
            baseballReferenceCoverage?.newest_slice_at ??
            sourceByRefreshKey.get('baseballReference')?.last_changed_at ??
            null,
          coverageComplete: baseballReferenceCoverage
            ? Number(baseballReferenceCoverage.observed_slices) === 2
            : false,
        },
        {
          key: 'fangraphs',
          required: true,
          statsChangedAt:
            fangraphsCoverage?.newest_slice_at ??
            sourceByRefreshKey.get('fangraphs')?.last_changed_at ??
            null,
          coverageComplete: fangraphsCoverage
            ? Number(fangraphsCoverage.observed_slices) === 2
            : false,
        },
      ],
    })
    const identityFreshness = assessMlbIdentityCrosswalkFreshness(
      staticIdentityCrosswalk.summary.asOf,
      new Date(health.database_time),
    )
    const composedIdentity = composeMlbIdentityCrosswalk(
      staticIdentityCrosswalk,
      identityOverlayRows,
      chadwickKeyMlbamLookup,
    )
    const identityCrosswalk = composedIdentity.crosswalk
    const currentMlbIdentityConflicts = currentMlbIdentityRows.filter((row) => {
      const rowMlbamId = row.mlbam_id === null ? null : String(row.mlbam_id)
      const resolved = identityCrosswalk.byBbref(row.bbref_id)
      return rowMlbamId !== null && (
        resolved === null || rowMlbamId !== String(resolved.mlbam)
      )
    })
    const unmatchedCurrentBbrefIds = currentMlbIdentityRows
      .map((row) => row.bbref_id)
      .filter((bbrefId) => identityCrosswalk.byBbref(bbrefId) === null)
    const identityReasonCodes = [
      identityFreshness.status === 'invalid' ? 'identity_crosswalk_invalid' : null,
      composedIdentity.overlay.conflicts.length > 0 ? 'identity_overlay_conflict' : null,
      currentMlbIdentityConflicts.length > 0 ? 'identity_current_mlb_conflict' : null,
      unmatchedCurrentBbrefIds.length > 0 ? 'identity_current_mlb_unmatched' : null,
    ].filter((reason): reason is string => reason !== null)
    const status = identityReasonCodes.length === 0
      ? freshness.status
      : freshness.status === 'stale'
        ? 'stale'
        : 'degraded'
    const reasonCodes = [...new Set([
      ...freshness.reasonCodes,
      ...identityReasonCodes,
    ])]

    response.statusCode = 200
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        status,
        reasonCodes,
        databaseTime: health.database_time,
        migrations: Number(health.migration_count),
        freshness,
        directory: {
          rows: Number(directory.rows),
          season: directory.season,
          oldestSourceAt: directory.oldest_source_at,
          newestSourceAt: directory.newest_source_at,
        },
        sources: sourceRows.map((source) => {
          const key = sourceKey(source)
          const refreshStatus = key ? freshness.sources[key] : null
          const statsChangedAt = refreshStatus?.statsChangedAt ?? source.last_changed_at
          return {
            source: source.source,
            dataset: source.dataset,
            lastAttemptStatus: source.last_attempt_status,
            lastAttemptStartedAt: source.last_attempt_started_at,
            lastAttemptFinishedAt: source.last_attempt_finished_at,
            lastSuccessFinishedAt: source.last_success_finished_at,
            statsChangedAt,
            // Backward-compatible alias. Consumers should use statsChangedAt.
            lastChangedAt: statsChangedAt,
            lastCheckedAt: refreshStatus?.lastCheckedAt ?? null,
            lastSuccessfulCheckAt: refreshStatus?.lastSuccessfulCheckAt ?? null,
            lastCheckStatus: refreshStatus?.lastCheckStatus ?? null,
            parserVersion: source.parser_version,
            requestedSeason: source.requested_season === null
              ? null
              : Number(source.requested_season),
            counts: source.counts,
          }
        }),
        currentCoverage: {
          prospectSavant: prospectCoverage
            ? {
                // Keep season as the maximum for existing consumers; a lower
                // minimumSeason identifies the pre-June mixed-season window.
                season: prospectCoverage.season,
                minimumSeason: prospectCoverage.minimum_season,
                observedSlices: Number(prospectCoverage.observed_slices),
                expectedSlices: 10,
                oldestSliceAt: prospectCoverage.oldest_slice_at,
                newestSliceAt: prospectCoverage.newest_slice_at,
              }
            : null,
          mlbStatsApi: mlbStatsApiCoverage
            ? {
                season: mlbStatsApiCoverage.season,
                minimumSeason: mlbStatsApiCoverage.minimum_season,
                observedSlices: Number(mlbStatsApiCoverage.observed_slices),
                expectedSlices: 10,
                oldestSliceAt: mlbStatsApiCoverage.oldest_slice_at,
                newestSliceAt: mlbStatsApiCoverage.newest_slice_at,
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
          fangraphs: fangraphsCoverage
            ? {
                season: fangraphsCoverage.season,
                observedSides: Number(fangraphsCoverage.observed_slices),
                expectedSides: 2,
                oldestSideAt: fangraphsCoverage.oldest_slice_at,
                newestSideAt: fangraphsCoverage.newest_slice_at,
              }
            : null,
        },
        identityCrosswalk: {
          ...identityFreshness,
          identityPolicy:
            'exact_mlbam_bbref_plus_durable_chadwick_overlay_no_name_matching',
          records: identityCrosswalk.summary.recordCount,
          chadwickLookupAsOf: chadwickKeyMlbamLookup.summary.asOf,
          chadwickLookupRecords: chadwickKeyMlbamLookup.summary.recordCount,
          chadwickLookupPolicy: chadwickKeyMlbamLookup.summary.identityPolicy,
          overlayRecords: composedIdentity.overlay.acceptedRecords,
          overlayConflicts: composedIdentity.overlay.conflicts.length,
          overlayConflictSample: composedIdentity.overlay.conflicts.slice(0, 20),
          overlayNewestObservedAt: composedIdentity.overlay.newestObservedAt,
          currentMlbRows: currentMlbIdentityRows.length,
          conflictingCurrentMlbIds: currentMlbIdentityConflicts.length,
          conflictingCurrentMlbIdSample: currentMlbIdentityConflicts
            .map((row) => row.bbref_id)
            .slice(0, 20),
          unmatchedCurrentBbrefIds: unmatchedCurrentBbrefIds.length,
          unmatchedCurrentBbrefIdSample: unmatchedCurrentBbrefIds.slice(0, 20),
        },
        scheduledRefresh: {
          configured: Boolean(process.env.CRON_SECRET?.trim()),
          scheduleUtc: '17 10,22 * * *',
          schedulesUtc: CURRENT_REFRESH_SCHEDULE_UTC,
          nextDueAt: freshness.nextDueAt,
          cronProof: freshness.cronProof,
          latestScheduledRun: freshness.runs.latestScheduled,
          latestScheduledSuccess: freshness.runs.latestScheduledSuccess,
          latestManualRun: freshness.runs.latestManual,
          latestManualSuccess: freshness.runs.latestManualSuccess,
          jobs: refreshRows.map((job) => ({
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
