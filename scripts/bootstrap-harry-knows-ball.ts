import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { directDatabaseUrl } from '../db/client.js'
import {
  backfillHarryKnowsBallIdentities,
  HKB_IDENTITY_MAXIMUM_LIMIT,
  HKB_MINIMUM_PLAYER_ROWS,
  ingestHarryKnowsBallSnapshot,
  type BackfillHarryKnowsBallIdentitiesResult,
  type IngestHarryKnowsBallSnapshotResult,
} from './ingest/harry-knows-ball.js'
import {
  abortableDelay,
  currentRefreshDatabaseOptions,
} from './ingest/shared.js'

const bootstrapAdvisoryLockId = 2_026_071_604
const advisoryLockWaitMs = 5_000
const advisoryLockMaximumAttempts = 240

export const HKB_BOOTSTRAP_MINIMUM_CURRENT_ROWS = HKB_MINIMUM_PLAYER_ROWS
export const HKB_BOOTSTRAP_MINIMUM_EXACT_COVERAGE_PERCENT = 90
export const HKB_BOOTSTRAP_IDENTITY_BATCH_SIZE = HKB_IDENTITY_MAXIMUM_LIMIT
export const HKB_BOOTSTRAP_IDENTITY_DELAY_MS = 500
export const HKB_BOOTSTRAP_MAXIMUM_ROUNDS = 20

type SqlClient = ReturnType<typeof postgres>

export interface HarryKnowsBallBootstrapCoverage {
  currentRows: number
  mappedRows: number
  queueRows: number
}

export type HarryKnowsBallBootstrapReason =
  | 'not_production'
  | 'snapshot_missing'
  | 'identity_coverage_incomplete'
  | 'adequate'

export interface HarryKnowsBallBootstrapDecision {
  action: 'backfill' | 'ingest' | 'skip'
  reason: HarryKnowsBallBootstrapReason
}

export type HarryKnowsBallBootstrapLoopDecision =
  | 'adequate'
  | 'continue'
  | 'max_rounds'
  | 'no_progress'
  | 'queue_empty'

export interface HarryKnowsBallBootstrapResult {
  coverage: HarryKnowsBallBootstrapCoverage | null
  decision: HarryKnowsBallBootstrapDecision
  failures: number
  identitiesAttempted: number
  identitiesStored: number
  ingestion: IngestHarryKnowsBallSnapshotResult | null
  rounds: number
  stopReason: 'adequate' | 'not_production'
}

function finiteCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('HarryKnowsBall bootstrap coverage query returned an invalid count')
  }
  return parsed
}

function assertCoverage(coverage: HarryKnowsBallBootstrapCoverage): void {
  finiteCount(coverage.currentRows)
  finiteCount(coverage.mappedRows)
  finiteCount(coverage.queueRows)
  if (coverage.mappedRows > coverage.currentRows) {
    throw new Error('HarryKnowsBall mapped rows cannot exceed current rows')
  }
}

export function harryKnowsBallExactCoveragePercent(
  coverage: HarryKnowsBallBootstrapCoverage,
): number {
  assertCoverage(coverage)
  return coverage.currentRows === 0
    ? 0
    : (coverage.mappedRows / coverage.currentRows) * 100
}

export function hasAdequateHarryKnowsBallBootstrapCoverage(
  coverage: HarryKnowsBallBootstrapCoverage | null,
): boolean {
  if (!coverage) return false
  assertCoverage(coverage)
  return (
    coverage.currentRows >= HKB_BOOTSTRAP_MINIMUM_CURRENT_ROWS &&
    coverage.mappedRows * 100 >=
      coverage.currentRows * HKB_BOOTSTRAP_MINIMUM_EXACT_COVERAGE_PERCENT
  )
}

export function decideHarryKnowsBallBootstrap(input: {
  coverage: HarryKnowsBallBootstrapCoverage | null
  environment?: string
}): HarryKnowsBallBootstrapDecision {
  if (input.environment !== 'production') {
    return { action: 'skip', reason: 'not_production' }
  }
  if (hasAdequateHarryKnowsBallBootstrapCoverage(input.coverage)) {
    return { action: 'skip', reason: 'adequate' }
  }
  if (
    !input.coverage ||
    input.coverage.currentRows < HKB_BOOTSTRAP_MINIMUM_CURRENT_ROWS
  ) {
    return { action: 'ingest', reason: 'snapshot_missing' }
  }
  return { action: 'backfill', reason: 'identity_coverage_incomplete' }
}

export function decideHarryKnowsBallBootstrapLoop(input: {
  coverage: HarryKnowsBallBootstrapCoverage
  maximumRounds?: number
  previousMappedRows: number | null
  rounds: number
}): HarryKnowsBallBootstrapLoopDecision {
  assertCoverage(input.coverage)
  const maximumRounds = input.maximumRounds ?? HKB_BOOTSTRAP_MAXIMUM_ROUNDS
  if (!Number.isInteger(maximumRounds) || maximumRounds < 1) {
    throw new Error('HarryKnowsBall bootstrap maximum rounds must be a positive integer')
  }
  if (!Number.isInteger(input.rounds) || input.rounds < 0) {
    throw new Error('HarryKnowsBall bootstrap rounds must be a nonnegative integer')
  }
  if (
    input.previousMappedRows !== null &&
    (!Number.isInteger(input.previousMappedRows) || input.previousMappedRows < 0)
  ) {
    throw new Error('HarryKnowsBall previous mapped rows must be a nonnegative integer')
  }

  if (hasAdequateHarryKnowsBallBootstrapCoverage(input.coverage)) return 'adequate'
  if (input.coverage.queueRows === 0) return 'queue_empty'
  if (
    input.previousMappedRows !== null &&
    input.coverage.mappedRows <= input.previousMappedRows
  ) {
    return 'no_progress'
  }
  if (input.rounds >= maximumRounds) return 'max_rounds'
  return 'continue'
}

export function harryKnowsBallBootstrapDatabaseOptions() {
  return {
    ...currentRefreshDatabaseOptions(1_800_000),
    // The session advisory lock spans source capture and the bounded identity crawl.
    idle_timeout: 0,
  } as const
}

export async function readHarryKnowsBallBootstrapCoverage(
  sql: SqlClient,
): Promise<HarryKnowsBallBootstrapCoverage> {
  const [relations] = await sql<{
    current_exists: boolean
    queue_exists: boolean
  }[]>`
    SELECT
      to_regclass('app.hkb_current_comparison_signal') IS NOT NULL AS current_exists,
      to_regclass('app.hkb_identity_backfill_queue') IS NOT NULL AS queue_exists
  `
  if (!relations?.current_exists) {
    return { currentRows: 0, mappedRows: 0, queueRows: 0 }
  }
  if (!relations.queue_exists) {
    throw new Error('HarryKnowsBall identity queue is missing after migration')
  }

  const [coverage] = await sql<Record<string, unknown>[]>`
    SELECT
      (SELECT count(*)::integer
       FROM app.hkb_current_comparison_signal) AS current_rows,
      (SELECT count(*)::integer
       FROM app.hkb_current_comparison_signal
       WHERE mlbam_id IS NOT NULL) AS mapped_rows,
      (SELECT count(*)::integer
       FROM app.hkb_identity_backfill_queue) AS queue_rows
  `
  if (!coverage) return { currentRows: 0, mappedRows: 0, queueRows: 0 }
  return {
    currentRows: finiteCount(coverage.current_rows),
    mappedRows: finiteCount(coverage.mapped_rows),
    queueRows: finiteCount(coverage.queue_rows),
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
  throw new Error('Timed out waiting for the HarryKnowsBall bootstrap advisory lock')
}

function addBatchSummary(
  total: Pick<HarryKnowsBallBootstrapResult,
    'failures' | 'identitiesAttempted' | 'identitiesStored'>,
  batch: BackfillHarryKnowsBallIdentitiesResult,
): void {
  total.identitiesAttempted += batch.attempted
  total.identitiesStored += batch.stored
  total.failures += batch.failures.length
}

export async function bootstrapHarryKnowsBall(options: {
  environment?: string
  identityDelayMs?: number
  maximumRounds?: number
  signal?: AbortSignal
} = {}): Promise<HarryKnowsBallBootstrapResult> {
  const environment = options.environment ?? process.env.VERCEL_ENV
  const nonProductionDecision = decideHarryKnowsBallBootstrap({
    coverage: null,
    environment,
  })
  if (nonProductionDecision.reason === 'not_production') {
    return {
      coverage: null,
      decision: nonProductionDecision,
      failures: 0,
      identitiesAttempted: 0,
      identitiesStored: 0,
      ingestion: null,
      rounds: 0,
      stopReason: 'not_production',
    }
  }

  const identityDelayMs = options.identityDelayMs ?? HKB_BOOTSTRAP_IDENTITY_DELAY_MS
  const maximumRounds = options.maximumRounds ?? HKB_BOOTSTRAP_MAXIMUM_ROUNDS
  const sql = postgres(directDatabaseUrl(), harryKnowsBallBootstrapDatabaseOptions())
  let locked = false
  try {
    options.signal?.throwIfAborted()
    await acquireBootstrapAdvisoryLock(sql, options.signal)
    locked = true

    let coverage = await readHarryKnowsBallBootstrapCoverage(sql)
    const decision = decideHarryKnowsBallBootstrap({ coverage, environment })
    if (decision.action === 'skip') {
      return {
        coverage,
        decision,
        failures: 0,
        identitiesAttempted: 0,
        identitiesStored: 0,
        ingestion: null,
        rounds: 0,
        stopReason: 'adequate',
      }
    }

    let ingestion: IngestHarryKnowsBallSnapshotResult | null = null
    if (decision.action === 'ingest') {
      ingestion = await ingestHarryKnowsBallSnapshot({ signal: options.signal })
      coverage = await readHarryKnowsBallBootstrapCoverage(sql)
      if (coverage.currentRows < HKB_BOOTSTRAP_MINIMUM_CURRENT_ROWS) {
        throw new Error(
          `HarryKnowsBall bootstrap snapshot remains incomplete after ${ingestion.status}: ` +
            `${coverage.currentRows} current rows`,
        )
      }
    }

    const totals = {
      failures: 0,
      identitiesAttempted: 0,
      identitiesStored: 0,
    }
    let rounds = 0
    let previousMappedRows: number | null = null
    let stop = decideHarryKnowsBallBootstrapLoop({
      coverage,
      maximumRounds,
      previousMappedRows,
      rounds,
    })

    while (stop === 'continue') {
      previousMappedRows = coverage.mappedRows
      const batch = await backfillHarryKnowsBallIdentities({
        delayMs: identityDelayMs,
        limit: HKB_BOOTSTRAP_IDENTITY_BATCH_SIZE,
        signal: options.signal,
      })
      addBatchSummary(totals, batch)
      rounds += 1
      coverage = await readHarryKnowsBallBootstrapCoverage(sql)
      stop = decideHarryKnowsBallBootstrapLoop({
        coverage,
        maximumRounds,
        previousMappedRows,
        rounds,
      })
    }

    if (stop !== 'adequate') {
      throw new Error(
        `HarryKnowsBall bootstrap stopped at ${stop} with ` +
          `${coverage.mappedRows}/${coverage.currentRows} exact identities ` +
          `(${harryKnowsBallExactCoveragePercent(coverage).toFixed(1)}%)`,
      )
    }

    return {
      coverage,
      decision,
      ...totals,
      ingestion,
      rounds,
      stopReason: 'adequate',
    }
  } finally {
    if (locked) {
      await sql`SELECT pg_advisory_unlock(${bootstrapAdvisoryLockId})`.catch(() => undefined)
    }
    await sql.end({ timeout: 5 })
  }
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  bootstrapHarryKnowsBall()
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        action: result.decision.action,
        reason: result.decision.reason,
        currentRows: result.coverage?.currentRows ?? null,
        mappedRows: result.coverage?.mappedRows ?? null,
        exactCoveragePercent: result.coverage
          ? Number(harryKnowsBallExactCoveragePercent(result.coverage).toFixed(1))
          : null,
        rounds: result.rounds,
        identitiesAttempted: result.identitiesAttempted,
        identitiesStored: result.identitiesStored,
        failures: result.failures,
        ingestionStatus: result.ingestion?.status ?? null,
        stopReason: result.stopReason,
      })}\n`)
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown HKB bootstrap error'
      process.stderr.write(`${message}\n`)
      process.exitCode = 1
    })
}
