import { createHash } from 'node:crypto'
import gemRateSnapshotJson from './_data/gemrate-baseball-sales.json' with { type: 'json' }
import {
  buildBinderScore,
  normalizePlayerName,
  percentileFromRank,
  type BinderCandidateInput,
  type BinderFreshness,
  type BinderMarketInput,
  type BinderScoreResult,
} from '../src/domain/binderScore.js'

const GEMRATE_SNAPSHOT_SCHEMA_VERSION = 'gemrate-athlete-sales-snapshot.v1' as const
const GEMRATE_STALE_GRACE_DAY = 20
const GEMRATE_MINIMUM_SOURCE_ROWS = 4_000
const GEMRATE_MINIMUM_BASEBALL_ROWS = 1_500

interface GemRateSnapshotRow {
  athleteName: string
  normalizedName: string
  sourceKey: string
  trailing12SalesUsd: number[]
  currentYtdSalesUsd: number
  firstGradedYear: number | null
  mostGradedYear: number | null
}

interface GemRateSnapshot {
  schemaVersion: typeof GEMRATE_SNAPSHOT_SCHEMA_VERSION
  source: {
    url: 'https://www.gemrate.com/sales-trends'
    permissionBasis: 'licensed_user_provided_permission'
    csvSha256: string
  }
  dataThrough: string
  publishedAt: string
  acquiredAt: string
  rowsSha256: string
  metadata: {
    sourceRowCount: number
    baseballRowCount: number
    ambiguousNormalizedNames: Array<{
      normalizedName: string
      athleteNames: string[]
    }>
  }
  rows: GemRateSnapshotRow[]
}

interface GemRateMarketRow extends GemRateSnapshotRow {
  trailingTwelveMonthSalesUsd: number
  trailingTwelveMonthDemandPercentile: number
}

interface ManualGemRateIdentity {
  mlbamId: string
  sourcePlayerName: string
  firstGradedYear: number
  mostGradedYear: number
}

/**
 * Small, fail-closed identity roster reviewed against the exact Oracle MLBAM
 * identity, GemRate source spelling, and grading-year chronology on 2026-07-24.
 * Every other normalized-name join remains provisional and cannot emit action.
 */
const manualGemRateIdentities = new Map<string, ManualGemRateIdentity>([
  ['aaron judge', {
    mlbamId: '592450',
    sourcePlayerName: 'Aaron Judge',
    firstGradedYear: 2013,
    mostGradedYear: 2017,
  }],
  ['bobby witt jr', {
    mlbamId: '677951',
    sourcePlayerName: 'Bobby Witt Jr.',
    firstGradedYear: 2017,
    mostGradedYear: 2022,
  }],
  ['juan soto', {
    mlbamId: '665742',
    sourcePlayerName: 'Juan Soto',
    firstGradedYear: 2016,
    mostGradedYear: 2018,
  }],
  ['mike trout', {
    mlbamId: '545361',
    sourcePlayerName: 'Mike Trout',
    firstGradedYear: 2009,
    mostGradedYear: 2011,
  }],
  ['mookie betts', {
    mlbamId: '605141',
    sourcePlayerName: 'Mookie Betts',
    firstGradedYear: 2013,
    mostGradedYear: 2014,
  }],
  ['shohei ohtani', {
    mlbamId: '660271',
    sourcePlayerName: 'Shohei Ohtani',
    firstGradedYear: 2010,
    mostGradedYear: 2018,
  }],
])

const manuallyQuarantinedSourceNames = new Map<string, readonly string[]>([
  ['will smith', ['Will Smith']],
])

export interface BinderMarketCatalog {
  snapshot: GemRateSnapshot
  cohortId: string
  rowsByNormalizedName: ReadonlyMap<string, GemRateMarketRow>
  ambiguousNormalizedNames: ReadonlyMap<string, readonly string[]>
}

export interface GemRateSnapshotValidationOptions {
  minimumSourceRows?: number
  minimumBaseballRows?: number
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function ytdMonthCountFromDataThrough(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (
    !Number.isFinite(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return null
  }
  const nextDay = new Date(parsed.valueOf() + 24 * 60 * 60 * 1_000)
  if (nextDay.getUTCDate() !== 1) return null
  return parsed.getUTCMonth() + 1
}

function validIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value
}

function validSnapshotRow(
  value: unknown,
  ytdMonthCount: number,
): value is GemRateSnapshotRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<GemRateSnapshotRow>
  return (
    typeof row.athleteName === 'string' &&
    typeof row.normalizedName === 'string' &&
    row.normalizedName === normalizePlayerName(row.athleteName) &&
    typeof row.sourceKey === 'string' &&
    Array.isArray(row.trailing12SalesUsd) &&
    row.trailing12SalesUsd.length === 12 &&
    row.trailing12SalesUsd.every(
      (amount) => Number.isSafeInteger(amount) && amount >= 0,
    ) &&
    Number.isSafeInteger(row.currentYtdSalesUsd) &&
    (row.currentYtdSalesUsd ?? -1) >= 0 &&
    row.trailing12SalesUsd
      .slice(-ytdMonthCount)
      .reduce((sum, amount) => sum + amount, 0) ===
      row.currentYtdSalesUsd &&
    (row.firstGradedYear === null || Number.isSafeInteger(row.firstGradedYear)) &&
    (row.mostGradedYear === null || Number.isSafeInteger(row.mostGradedYear))
  )
}

export function parseGemRateSnapshot(
  value: unknown,
  options: GemRateSnapshotValidationOptions = {},
): GemRateSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('GemRate athlete-sales snapshot must be an object')
  }
  const snapshot = value as Partial<GemRateSnapshot>
  const ytdMonthCount = ytdMonthCountFromDataThrough(snapshot.dataThrough)
  const minimumSourceRows =
    options.minimumSourceRows ?? GEMRATE_MINIMUM_SOURCE_ROWS
  const minimumBaseballRows =
    options.minimumBaseballRows ?? GEMRATE_MINIMUM_BASEBALL_ROWS
  if (
    snapshot.schemaVersion !== GEMRATE_SNAPSHOT_SCHEMA_VERSION ||
    snapshot.source?.url !== 'https://www.gemrate.com/sales-trends' ||
    snapshot.source.permissionBasis !== 'licensed_user_provided_permission' ||
    !isSha256(snapshot.source.csvSha256) ||
    ytdMonthCount === null ||
    !validIso(snapshot.publishedAt) ||
    !validIso(snapshot.acquiredAt) ||
    !isSha256(snapshot.rowsSha256) ||
    !snapshot.metadata ||
    !Number.isSafeInteger(snapshot.metadata.sourceRowCount) ||
    snapshot.metadata.sourceRowCount < minimumSourceRows ||
    !Number.isSafeInteger(snapshot.metadata.baseballRowCount) ||
    snapshot.metadata.baseballRowCount < minimumBaseballRows ||
    snapshot.metadata.baseballRowCount > snapshot.metadata.sourceRowCount ||
    !Array.isArray(snapshot.metadata.ambiguousNormalizedNames) ||
    !Array.isArray(snapshot.rows) ||
    snapshot.rows.length !== snapshot.metadata.baseballRowCount ||
    !snapshot.rows.every((row) => validSnapshotRow(row, ytdMonthCount))
  ) {
    throw new Error('GemRate athlete-sales snapshot failed contract validation')
  }
  const dataThroughEnd = Date.parse(`${snapshot.dataThrough}T23:59:59.999Z`)
  if (
    dataThroughEnd > Date.parse(snapshot.publishedAt) ||
    Date.parse(snapshot.publishedAt) > Date.parse(snapshot.acquiredAt)
  ) {
    throw new Error('GemRate athlete-sales snapshot timeline is invalid')
  }

  const rowsHash = createHash('sha256')
    .update(JSON.stringify(snapshot.rows))
    .digest('hex')
  if (rowsHash !== snapshot.rowsSha256) {
    throw new Error('GemRate athlete-sales rows hash does not match the snapshot')
  }

  const sourceKeys = new Set<string>()
  for (const row of snapshot.rows) {
    if (sourceKeys.has(row.sourceKey)) {
      throw new Error(`GemRate athlete-sales source key is duplicated: ${row.sourceKey}`)
    }
    sourceKeys.add(row.sourceKey)
  }

  return snapshot as GemRateSnapshot
}

function averageRankPercentiles(
  rows: Array<GemRateSnapshotRow & { trailingTwelveMonthSalesUsd: number }>,
): Map<string, number> {
  const sorted = rows.toSorted((left, right) => (
    right.trailingTwelveMonthSalesUsd - left.trailingTwelveMonthSalesUsd ||
    left.sourceKey.localeCompare(right.sourceKey, 'en-US')
  ))
  const percentiles = new Map<string, number>()

  for (let start = 0; start < sorted.length;) {
    let end = start + 1
    while (
      end < sorted.length &&
      sorted[end].trailingTwelveMonthSalesUsd ===
        sorted[start].trailingTwelveMonthSalesUsd
    ) {
      end += 1
    }
    const averageRank = (start + 1 + end) / 2
    const percentile = percentileFromRank(
      Math.max(1, Math.min(sorted.length, Math.round(averageRank))),
      sorted.length,
    ) ?? 50
    for (let index = start; index < end; index += 1) {
      percentiles.set(sorted[index].sourceKey, percentile)
    }
    start = end
  }

  return percentiles
}

export function buildBinderMarketCatalog(
  value: unknown,
  options: GemRateSnapshotValidationOptions = {},
): BinderMarketCatalog {
  const snapshot = parseGemRateSnapshot(value, options)
  const ambiguousNormalizedNames = new Map(
    snapshot.metadata.ambiguousNormalizedNames.map((entry) => [
      entry.normalizedName,
      entry.athleteNames,
    ] as const),
  )
  for (const [normalizedName, athleteNames] of manuallyQuarantinedSourceNames) {
    ambiguousNormalizedNames.set(normalizedName, [...athleteNames])
  }
  const uniqueRows = snapshot.rows
    .filter((row) => !ambiguousNormalizedNames.has(row.normalizedName))
    .map((row) => ({
      ...row,
      trailingTwelveMonthSalesUsd: row.trailing12SalesUsd.reduce(
        (sum, amount) => sum + amount,
        0,
      ),
    }))
  const percentileBySourceKey = averageRankPercentiles(uniqueRows)
  const rowsByNormalizedName = new Map<string, GemRateMarketRow>()
  for (const row of uniqueRows) {
    if (rowsByNormalizedName.has(row.normalizedName)) {
      throw new Error(`GemRate normalized athlete key is not unique: ${row.normalizedName}`)
    }
    rowsByNormalizedName.set(row.normalizedName, {
      ...row,
      trailingTwelveMonthDemandPercentile:
        percentileBySourceKey.get(row.sourceKey) ?? 50,
    })
  }

  return {
    snapshot,
    cohortId: `gemrate-baseball-trailing-12m-${snapshot.dataThrough.slice(0, 7)}`,
    rowsByNormalizedName,
    ambiguousNormalizedNames,
  }
}

export const binderMarketCatalog = buildBinderMarketCatalog(gemRateSnapshotJson)

export function binderMarketNextExpectedBy(dataThrough: string): string {
  const parsed = new Date(`${dataThrough}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.valueOf())) {
    throw new Error(`Invalid GemRate data-through date: ${dataThrough}`)
  }
  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 2,
    GEMRATE_STALE_GRACE_DAY,
  )).toISOString()
}

export function binderMarketFreshness(
  now = new Date(),
  catalog = binderMarketCatalog,
): BinderFreshness & { nextExpectedBy: string } {
  const nextExpectedBy = binderMarketNextExpectedBy(catalog.snapshot.dataThrough)
  const status = now.valueOf() <= Date.parse(nextExpectedBy) ? 'current' : 'stale'
  return {
    status,
    dataAsOf: `${catalog.snapshot.dataThrough}T23:59:59.999Z`,
    reasonCodes: status === 'current'
      ? []
      : ['gemrate_monthly_snapshot_overdue'],
    nextExpectedBy,
  }
}

/**
 * Completed-season career evidence remains current while the next season is in
 * progress. If a replacement model has not arrived by April 1 after that next
 * season, fail closed instead of treating an old career model as current.
 */
export function binderBaseballModelFreshness(
  dataAsOf: string | null,
  now = new Date(),
): BinderFreshness {
  if (!dataAsOf || !validIso(dataAsOf)) {
    return {
      status: 'unknown',
      dataAsOf,
      reasonCodes: ['career_model_timestamp_unavailable'],
    }
  }

  const parsed = new Date(dataAsOf)
  const staleAt = Date.UTC(parsed.getUTCFullYear() + 2, 3, 1)
  const status = now.valueOf() < staleAt ? 'current' : 'stale'
  return {
    status,
    dataAsOf,
    reasonCodes: status === 'current'
      ? []
      : ['completed_season_career_model_overdue'],
  }
}

export function binderMarketInputForPlayer(input: {
  playerName: string
  mlbamId: string | null
  age: number | null
  normalizedOracleNameCount: number
  now?: Date
  catalog?: BinderMarketCatalog
}): BinderMarketInput | null {
  const catalog = input.catalog ?? binderMarketCatalog
  const normalizedName = normalizePlayerName(input.playerName)
  const freshness = binderMarketFreshness(input.now, catalog)
  const ambiguousSourceNames = catalog.ambiguousNormalizedNames.get(normalizedName)
  const oracleIdentityAmbiguous = input.normalizedOracleNameCount !== 1

  if (ambiguousSourceNames || oracleIdentityAmbiguous) {
    return {
      sourcePlayerName: ambiguousSourceNames?.join(' / ') ?? input.playerName,
      identityStatus: 'ambiguous',
      trailingTwelveMonthDemandPercentile: null,
      monthlySalesUsd: [],
      freshness,
      cohortId: catalog.cohortId,
    }
  }

  const row = catalog.rowsByNormalizedName.get(normalizedName)
  if (!row || input.mlbamId === null) return null
  const earliestPossibleBirthYear = input.age === null
    ? null
    : (input.now ?? new Date()).getUTCFullYear() - input.age - 1
  if (
    row.firstGradedYear !== null &&
    earliestPossibleBirthYear !== null &&
    row.firstGradedYear - earliestPossibleBirthYear < 10
  ) {
    return {
      sourcePlayerName: row.athleteName,
      identityStatus: 'ambiguous',
      trailingTwelveMonthDemandPercentile: null,
      monthlySalesUsd: [],
      freshness,
      cohortId: catalog.cohortId,
    }
  }
  const manualIdentity = manualGemRateIdentities.get(normalizedName)
  const manuallyVerified = manualIdentity !== undefined &&
    manualIdentity.mlbamId === input.mlbamId &&
    manualIdentity.sourcePlayerName === row.athleteName &&
    manualIdentity.firstGradedYear === row.firstGradedYear &&
    manualIdentity.mostGradedYear === row.mostGradedYear
  return {
    sourcePlayerName: row.athleteName,
    identityStatus: manuallyVerified
      ? 'manual_verified'
      : 'unique_normalized_name',
    trailingTwelveMonthDemandPercentile:
      row.trailingTwelveMonthDemandPercentile,
    monthlySalesUsd: row.trailing12SalesUsd,
    freshness,
    cohortId: catalog.cohortId,
  }
}

export function buildCandidateBinderScore(input: {
  candidate: Omit<BinderCandidateInput, 'market'>
  mlbamId: string | null
  normalizedOracleNameCount: number
  now?: Date
  catalog?: BinderMarketCatalog
}): BinderScoreResult {
  return buildBinderScore({
    ...input.candidate,
    market: binderMarketInputForPlayer({
      playerName: input.candidate.player.name,
      mlbamId: input.mlbamId,
      age: input.candidate.player.age,
      normalizedOracleNameCount: input.normalizedOracleNameCount,
      now: input.now,
      catalog: input.catalog,
    }),
  })
}

export function binderScoreSnapshotId(input: {
  rankingSnapshotId: string
  scoreDigests: readonly string[]
  catalog?: BinderMarketCatalog
}): string {
  const catalog = input.catalog ?? binderMarketCatalog
  const digest = createHash('sha256')
    .update(JSON.stringify({
      rankingSnapshotId: input.rankingSnapshotId,
      marketRowsSha256: catalog.snapshot.rowsSha256,
      model: 'binder-score-heuristic/v1.0.0',
      scores: input.scoreDigests,
    }))
    .digest('hex')
  return `binder-score-snapshot/v1:${digest}`
}
