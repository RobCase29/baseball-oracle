import { createHash } from 'node:crypto'
import hobbySnapshotJson from './_data/gemrate-hobby-sales.json' with { type: 'json' }
import {
  MAGNIFICENT_X_CONTRACT_VERSION,
  MAGNIFICENT_X_FEED_SCHEMA_VERSION,
  MAGNIFICENT_X_MODEL_VERSION,
  buildMagnificentXAssessment,
  midrankPercentiles,
  type MagnificentXDomain,
  type MagnificentXFeedItem,
  type MagnificentXFeedResponse,
  type MagnificentXIdentityStatus,
  type MagnificentXResearchTier,
  type MagnificentXSourceRow,
  type MagnificentXTaxonomyStatus,
} from '../src/domain/magnificentX.js'

const HOBBY_SNAPSHOT_SCHEMA_VERSION = 'gemrate-hobby-sales-snapshot.v1' as const
const HOBBY_STALE_GRACE_DAY = 20
const HOBBY_MINIMUM_ATHLETE_ROWS = 4_000
const HOBBY_MINIMUM_POKEMON_ROWS = 750
const HOBBY_EXPECTED_MONTHS = 18

interface HobbySnapshotSource {
  subjectType: 'athlete' | 'pokemon_character'
  editionYear: 2025 | 2026
  url:
    | 'https://www.gemrate.com/sales-trends'
    | 'https://www.gemrate.com/sales-trends-pokemon'
  permissionBasis: 'licensed_user_provided_permission'
  acquiredAt: string
  csvSha256: string
  sourceRowCount: number
}

interface HobbySnapshot {
  schemaVersion: typeof HOBBY_SNAPSHOT_SCHEMA_VERSION
  sources: HobbySnapshotSource[]
  historyMonths: string[]
  dataThrough: string
  publishedAt: string
  acquiredAt: string
  rowsSha256: string
  metadata: {
    athleteRowCount: number
    pokemonRowCount: number
    subjectRowCount: number
    overlapChecks: number
    cohortCounts: Array<{
      domain: MagnificentXDomain
      sourceCategory: string
      taxonomyStatus: MagnificentXTaxonomyStatus
      rowCount: number
    }>
    ambiguousWithinCohortNames: Array<{
      domain: MagnificentXDomain
      normalizedName: string
      subjectNames: string[]
    }>
  }
  rows: MagnificentXSourceRow[]
}

export interface MagnificentXQuery {
  q?: string
  domain?: MagnificentXDomain | 'all'
  tier?: MagnificentXResearchTier | 'all'
  page?: number
  limit?: number
}

export interface MagnificentXCatalog {
  snapshot: HobbySnapshot
  items: MagnificentXFeedItem[]
  cohortSummaries: MagnificentXFeedResponse['cohorts']
  freshness: MagnificentXFeedResponse['snapshot']['freshness']
  snapshotId: string
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function validIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value
}

function validMonthSequence(months: unknown): months is string[] {
  if (!Array.isArray(months) || months.length !== HOBBY_EXPECTED_MONTHS) return false
  return months.every((month, index) => {
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/u.test(month)) return false
    const expected = new Date(Date.UTC(2025, index, 1)).toISOString().slice(0, 7)
    return month === expected
  })
}

function validSourceRow(row: MagnificentXSourceRow): boolean {
  return (
    (row.subjectType === 'athlete' || row.subjectType === 'pokemon_character') &&
    typeof row.domain === 'string' &&
    typeof row.taxonomyStatus === 'string' &&
    typeof row.sourceCategory === 'string' &&
    typeof row.subjectName === 'string' &&
    row.subjectName.length > 0 &&
    typeof row.normalizedName === 'string' &&
    row.normalizedName.length > 0 &&
    typeof row.sourceKey === 'string' &&
    row.sourceKey.length > 0 &&
    Array.isArray(row.monthlySalesUsd) &&
    row.monthlySalesUsd.length === HOBBY_EXPECTED_MONTHS &&
    row.monthlySalesUsd.every((amount) => Number.isSafeInteger(amount) && amount >= 0) &&
    (row.firstGradedYear === null || Number.isSafeInteger(row.firstGradedYear)) &&
    (row.mostGradedYear === null || Number.isSafeInteger(row.mostGradedYear))
  )
}

export function parseHobbySnapshot(value: unknown): HobbySnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('GemRate hobby snapshot must be an object')
  }
  const snapshot = value as Partial<HobbySnapshot>
  if (
    snapshot.schemaVersion !== HOBBY_SNAPSHOT_SCHEMA_VERSION ||
    !Array.isArray(snapshot.sources) ||
    snapshot.sources.length !== 4 ||
    !snapshot.sources.every((source) => (
      (source.subjectType === 'athlete' || source.subjectType === 'pokemon_character') &&
      (source.editionYear === 2025 || source.editionYear === 2026) &&
      (
        source.url === 'https://www.gemrate.com/sales-trends' ||
        source.url === 'https://www.gemrate.com/sales-trends-pokemon'
      ) &&
      source.permissionBasis === 'licensed_user_provided_permission' &&
      validIso(source.acquiredAt) &&
      isSha256(source.csvSha256) &&
      Number.isSafeInteger(source.sourceRowCount)
    )) ||
    !validMonthSequence(snapshot.historyMonths) ||
    snapshot.dataThrough !== '2026-06-30' ||
    !validIso(snapshot.publishedAt) ||
    !validIso(snapshot.acquiredAt) ||
    !isSha256(snapshot.rowsSha256) ||
    !snapshot.metadata ||
    !Number.isSafeInteger(snapshot.metadata.athleteRowCount) ||
    snapshot.metadata.athleteRowCount < HOBBY_MINIMUM_ATHLETE_ROWS ||
    !Number.isSafeInteger(snapshot.metadata.pokemonRowCount) ||
    snapshot.metadata.pokemonRowCount < HOBBY_MINIMUM_POKEMON_ROWS ||
    snapshot.metadata.subjectRowCount !==
      snapshot.metadata.athleteRowCount + snapshot.metadata.pokemonRowCount ||
    !Number.isSafeInteger(snapshot.metadata.overlapChecks) ||
    snapshot.metadata.overlapChecks !== snapshot.metadata.subjectRowCount * 6 ||
    !Array.isArray(snapshot.metadata.cohortCounts) ||
    !Array.isArray(snapshot.metadata.ambiguousWithinCohortNames) ||
    !Array.isArray(snapshot.rows) ||
    snapshot.rows.length !== snapshot.metadata.subjectRowCount ||
    !snapshot.rows.every(validSourceRow)
  ) {
    throw new Error('GemRate hobby snapshot failed contract validation')
  }
  if (
    Date.parse(`${snapshot.dataThrough}T23:59:59.999Z`) >
      Date.parse(snapshot.publishedAt) ||
    Date.parse(snapshot.publishedAt) > Date.parse(snapshot.acquiredAt)
  ) {
    throw new Error('GemRate hobby snapshot timeline is invalid')
  }
  const rowsHash = createHash('sha256')
    .update(JSON.stringify(snapshot.rows))
    .digest('hex')
  if (rowsHash !== snapshot.rowsSha256) {
    throw new Error('GemRate hobby snapshot rows hash mismatch')
  }
  const sourceKeys = new Set<string>()
  for (const row of snapshot.rows) {
    if (sourceKeys.has(row.sourceKey)) {
      throw new Error(`GemRate hobby source key is duplicated: ${row.sourceKey}`)
    }
    sourceKeys.add(row.sourceKey)
  }
  const cohortTotal = snapshot.metadata.cohortCounts.reduce(
    (total, cohort) => total + cohort.rowCount,
    0,
  )
  if (cohortTotal !== snapshot.metadata.subjectRowCount) {
    throw new Error('GemRate hobby cohort counts do not reconcile')
  }
  return snapshot as HobbySnapshot
}

export function magnificentXNextExpectedBy(dataThrough: string): string {
  const parsed = new Date(`${dataThrough}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.valueOf())) throw new Error('Invalid hobby data-through date')
  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 2,
    HOBBY_STALE_GRACE_DAY,
  )).toISOString()
}

export function magnificentXFreshness(
  dataThrough: string,
  now = new Date(),
): MagnificentXFeedResponse['snapshot']['freshness'] {
  const nextExpectedBy = magnificentXNextExpectedBy(dataThrough)
  const nowTime = now.valueOf()
  if (!Number.isFinite(nowTime)) {
    return {
      status: 'unknown',
      cadence: 'monthly',
      nextExpectedBy,
      reasonCodes: ['current_time_invalid'],
    }
  }
  const stale = nowTime > Date.parse(nextExpectedBy)
  return {
    status: stale ? 'stale' : 'current',
    cadence: 'monthly',
    nextExpectedBy,
    reasonCodes: stale ? ['gemrate_monthly_snapshot_overdue'] : [],
  }
}

function trailingTwelveSales(row: MagnificentXSourceRow): number {
  return row.monthlySalesUsd
    .slice(-12)
    .reduce((total, amount) => total + amount, 0)
}

function identityStatusFor(
  row: MagnificentXSourceRow,
  ambiguousKeys: ReadonlySet<string>,
): MagnificentXIdentityStatus {
  if (ambiguousKeys.has(`${row.domain}|${row.normalizedName}`)) {
    return 'ambiguous_normalized_name'
  }
  return 'source_name_only'
}

function withinCohortRankedItems(
  items: MagnificentXFeedItem[],
): MagnificentXFeedItem[] {
  const byDomain = new Map<MagnificentXDomain, MagnificentXFeedItem[]>()
  for (const item of items) {
    const cohort = byDomain.get(item.subject.domain) ?? []
    cohort.push(item)
    byDomain.set(item.subject.domain, cohort)
  }
  const ranked: MagnificentXFeedItem[] = []
  for (const cohort of byDomain.values()) {
    const sorted = cohort.toSorted((left, right) => (
      right.assessment.marketSignal.score - left.assessment.marketSignal.score ||
      right.assessment.marketSignal.withinCohortPercentile -
        left.assessment.marketSignal.withinCohortPercentile ||
      left.subject.name.localeCompare(right.subject.name, 'en-US')
    ))
    sorted.forEach((item, index) => {
      ranked.push({ ...item, withinCohortRank: index + 1 })
    })
  }
  return ranked
}

export function buildMagnificentXCatalog(
  value: unknown,
  now = new Date(),
): MagnificentXCatalog {
  const snapshot = parseHobbySnapshot(value)
  const freshness = magnificentXFreshness(snapshot.dataThrough, now)
  const ambiguousKeys = new Set(
    snapshot.metadata.ambiguousWithinCohortNames.map(
      (entry) => `${entry.domain}|${entry.normalizedName}`,
    ),
  )
  const rowsByDomain = new Map<MagnificentXDomain, MagnificentXSourceRow[]>()
  for (const row of snapshot.rows) {
    const rows = rowsByDomain.get(row.domain) ?? []
    rows.push(row)
    rowsByDomain.set(row.domain, rows)
  }
  const percentileBySourceKey = new Map<string, number>()
  for (const [domain, rows] of rowsByDomain) {
    const unambiguousRows = rows.filter(
      (row) => !ambiguousKeys.has(`${domain}|${row.normalizedName}`),
    )
    const percentiles = midrankPercentiles(
      unambiguousRows,
      trailingTwelveSales,
      (row) => row.sourceKey,
    )
    for (const [sourceKey, percentile] of percentiles) {
      percentileBySourceKey.set(sourceKey, percentile)
    }
  }
  const unrankedItems = snapshot.rows.map((row): MagnificentXFeedItem => {
    const identityStatus = identityStatusFor(row, ambiguousKeys)
    const cohortSize =
      snapshot.metadata.cohortCounts.find((cohort) => cohort.domain === row.domain)
        ?.rowCount ?? rowsByDomain.get(row.domain)?.length ?? 0
    const assessment = buildMagnificentXAssessment({
      row,
      cohortSize,
      withinCohortPercentile:
        identityStatus === 'ambiguous_normalized_name'
          ? 50
          : percentileBySourceKey.get(row.sourceKey) ?? 50,
      globalScalePercentile: null,
      identityStatus,
      freshnessStatus: freshness.status,
    })
    return {
      recordVersion: 'magnificent-x-feed-item/v1',
      subject: {
        id: row.sourceKey,
        type: row.subjectType,
        domain: row.domain,
        sourceCategory: row.sourceCategory,
        name: row.subjectName,
        identityStatus,
        firstGradedYear: row.firstGradedYear,
        mostGradedYear: row.mostGradedYear,
      },
      withinCohortRank: 0,
      assessment,
    }
  })
  const items = withinCohortRankedItems(unrankedItems)
  const cohortSummaries = snapshot.metadata.cohortCounts.map((cohort) => {
    const cohortItems = items.filter((item) => item.subject.domain === cohort.domain)
    return {
      domain: cohort.domain,
      taxonomyStatus: cohort.taxonomyStatus,
      subjectCount: cohort.rowCount,
      marketLeaderCount: cohortItems.filter(
        (item) => item.assessment.researchTier === 'market_leader',
      ).length,
      magnificentEligibleCount: 0 as const,
    }
  })
  const snapshotId = `magnificent-x-snapshot/v1:${
    createHash('sha256').update(JSON.stringify({
      rowsSha256: snapshot.rowsSha256,
      modelVersion: MAGNIFICENT_X_MODEL_VERSION,
      freshness: freshness.status,
      assessments: items.map((item) => [
        item.subject.id,
        item.assessment.marketSignal.score,
        item.assessment.researchTier,
      ]),
    })).digest('hex')
  }`
  return { snapshot, items, cohortSummaries, freshness, snapshotId }
}

export function buildMagnificentXFeed(
  catalog: MagnificentXCatalog,
  query: MagnificentXQuery = {},
): MagnificentXFeedResponse {
  const normalizedQuery = query.q?.trim().toLocaleLowerCase('en-US') ?? ''
  const domain = query.domain ?? 'all'
  const tier = query.tier ?? 'all'
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const limit = Math.max(1, Math.min(100, Math.floor(query.limit ?? 50)))
  const filtered = catalog.items.filter((item) => (
    (domain === 'all' || item.subject.domain === domain) &&
    (tier === 'all' || item.assessment.researchTier === tier) &&
    (
      normalizedQuery.length === 0 ||
      item.subject.name.toLocaleLowerCase('en-US').includes(normalizedQuery)
    )
  )).toSorted((left, right) => (
    domain === 'all'
      ? (
          left.withinCohortRank - right.withinCohortRank ||
          left.subject.domain.localeCompare(right.subject.domain, 'en-US') ||
          left.subject.name.localeCompare(right.subject.name, 'en-US')
        )
      : (
          right.assessment.marketSignal.score - left.assessment.marketSignal.score ||
          right.assessment.marketSignal.withinCohortPercentile -
            left.assessment.marketSignal.withinCohortPercentile ||
          left.subject.name.localeCompare(right.subject.name, 'en-US')
        )
  ))
  const total = filtered.length
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit)
  const offset = (page - 1) * limit
  return {
    schemaVersion: MAGNIFICENT_X_FEED_SCHEMA_VERSION,
    contractVersion: MAGNIFICENT_X_CONTRACT_VERSION,
    snapshot: {
      id: catalog.snapshotId,
      historyStart: `${catalog.snapshot.historyMonths[0]}-01`,
      historyMonths: catalog.snapshot.historyMonths.length,
      dataThrough: catalog.snapshot.dataThrough,
      publishedAt: catalog.snapshot.publishedAt,
      acquiredAt: catalog.snapshot.acquiredAt,
      freshness: catalog.freshness,
    },
    items: filtered.slice(offset, offset + limit),
    cohorts: catalog.cohortSummaries,
    page: { page, limit, total, totalPages },
    meta: {
      researchOnly: true,
      investmentAdvice: false,
      magnificentEligibleCount: 0,
      marketSource: 'GemRate Athlete + Pokémon Sales Trends',
      marketMeasure: 'completed_ebay_singles_sales_volume_usd',
      rawExportsPublished: false,
      globalRankingAvailable: false,
      globalRankingReason:
        'provider_export_cap_and_cross_subject_overlap_not_independently_verified',
      exactCardRecommendationsAvailable: false,
      ageIncluded: false,
      agePolicy:
        'age_requires_canonical_sport_identity_and_validated_domain_adapter_not_inferred_from_name',
      permissionAttestation: 'docs/permissions/GEMRATE_ATTESTATION.md',
    },
  }
}

export const magnificentXCatalog = buildMagnificentXCatalog(hobbySnapshotJson)

export const magnificentXDomains: readonly MagnificentXDomain[] = [
  'baseball',
  'basketball',
  'football',
  'soccer',
  'hockey',
  'golf',
  'combat',
  'other_sport',
  'mixed_sport',
  'culture',
  'pokemon',
]

export const magnificentXResearchTiers: readonly MagnificentXResearchTier[] = [
  'market_leader',
  'durable_demand',
  'watch',
  'noise_risk',
  'long_tail',
  'evidence_needed',
]
