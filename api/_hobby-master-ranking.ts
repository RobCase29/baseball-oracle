import { createHash } from 'node:crypto'
import hobbySnapshotJson from './_data/gemrate-hobby-sales.json' with { type: 'json' }
import {
  buildMagnificentXCatalog,
  magnificentXFreshness,
  parseHobbySnapshot,
} from './_magnificent-x.js'
import {
  HOBBY_MASTER_CONTRACT_VERSION,
  HOBBY_MASTER_ESTABLISHED_RUN_RATE_FLOOR_USD,
  HOBBY_MASTER_ESTABLISHED_TTM_FLOOR_USD,
  HOBBY_MASTER_ESCAPE_RUN_RATE_FLOOR_USD,
  HOBBY_MASTER_ESCAPE_TTM_FLOOR_USD,
  HOBBY_MASTER_MODEL_VERSION,
  HOBBY_MASTER_RECORD_VERSION,
  HOBBY_MASTER_SCHEMA_VERSION,
  buildHobbyMasterAssessment,
  midrankPercentiles,
  type HobbyMasterFeedItem,
  type HobbyMasterFeedResponse,
  type HobbyMasterSortDirection,
  type HobbyMasterSortKey,
  type MagnificentXDomain,
  type MagnificentXIdentityStatus,
  type MagnificentXResearchPosture,
  type MagnificentXSourceRow,
} from '../src/domain/hobbyMasterRanking.js'

type HobbySnapshot = ReturnType<typeof parseHobbySnapshot>

export interface HobbyMasterQuery {
  q?: string
  domain?: MagnificentXDomain | 'all'
  posture?: MagnificentXResearchPosture | 'all'
  sort?: HobbyMasterSortKey
  direction?: HobbyMasterSortDirection
  page?: number
  limit?: number
}

export interface HobbyMasterCatalog {
  snapshot: HobbySnapshot
  items: HobbyMasterFeedItem[]
  cohorts: HobbyMasterFeedResponse['cohorts']
  freshness: HobbyMasterFeedResponse['snapshot']['freshness']
  snapshotId: string
  rankingUniverseCount: number
}

function trailingTwelveSales(row: MagnificentXSourceRow): number {
  return row.monthlySalesUsd
    .slice(-12)
    .reduce((total, value) => total + value, 0)
}

function identityStatusFor(
  row: MagnificentXSourceRow,
  ambiguousKeys: ReadonlySet<string>,
): MagnificentXIdentityStatus {
  return ambiguousKeys.has(`${row.domain}|${row.normalizedName}`)
    ? 'ambiguous_normalized_name'
    : 'source_name_only'
}

function comparisonEligible(
  row: MagnificentXSourceRow,
  identityStatus: MagnificentXIdentityStatus,
  cohortSize: number,
): boolean {
  return (
    row.taxonomyStatus === 'coherent_provider_cohort' &&
    cohortSize >= 100 &&
    identityStatus !== 'ambiguous_normalized_name'
  )
}

function sortMasterItems(
  left: HobbyMasterFeedItem,
  right: HobbyMasterFeedItem,
): number {
  return (
    right.assessment.marketSignal.score -
      left.assessment.marketSignal.score ||
    right.assessment.marketSignal.latestTwelveMonthSalesUsd -
      left.assessment.marketSignal.latestTwelveMonthSalesUsd ||
    left.subject.domain.localeCompare(right.subject.domain, 'en-US') ||
    left.subject.name.localeCompare(right.subject.name, 'en-US')
  )
}

export function buildHobbyMasterCatalog(
  value: unknown = hobbySnapshotJson,
  now = new Date(),
): HobbyMasterCatalog {
  const snapshot = parseHobbySnapshot(value)
  const freshness = magnificentXFreshness(snapshot.dataThrough, now)
  const legacyCatalog = buildMagnificentXCatalog(snapshot, now)
  const legacyCohortRankBySourceKey = new Map(
    legacyCatalog.items.map((item) => [item.subject.id, item.withinCohortRank]),
  )
  const ambiguousKeys = new Set(
    snapshot.metadata.ambiguousWithinCohortNames.map(
      (entry) => `${entry.domain}|${entry.normalizedName}`,
    ),
  )
  const cohortSizeByDomain = new Map(
    snapshot.metadata.cohortCounts.map((cohort) => [
      cohort.domain,
      cohort.rowCount,
    ]),
  )
  const rowsByDomain = new Map<MagnificentXDomain, MagnificentXSourceRow[]>()
  for (const row of snapshot.rows) {
    const cohort = rowsByDomain.get(row.domain) ?? []
    cohort.push(row)
    rowsByDomain.set(row.domain, cohort)
  }
  const withinCohortPercentileBySourceKey = new Map<string, number>()
  for (const [domain, rows] of rowsByDomain) {
    const eligibleRows = rows.filter((row) => (
      identityStatusFor(row, ambiguousKeys) !== 'ambiguous_normalized_name'
    ))
    const percentiles = midrankPercentiles(
      eligibleRows,
      trailingTwelveSales,
      (row) => row.sourceKey,
    )
    for (const [sourceKey, percentile] of percentiles) {
      withinCohortPercentileBySourceKey.set(sourceKey, percentile)
    }
    if (eligibleRows.length > (cohortSizeByDomain.get(domain) ?? 0)) {
      throw new Error('Hobby master cohort percentile universe is invalid')
    }
  }
  const globalEligibleRows = snapshot.rows.filter((row) => {
    const identityStatus = identityStatusFor(row, ambiguousKeys)
    return comparisonEligible(
      row,
      identityStatus,
      cohortSizeByDomain.get(row.domain) ?? 0,
    )
  })
  const globalPercentileBySourceKey = midrankPercentiles(
    globalEligibleRows,
    trailingTwelveSales,
    (row) => row.sourceKey,
  )
  const unrankedItems = snapshot.rows.map((row): HobbyMasterFeedItem => {
    const identityStatus = identityStatusFor(row, ambiguousKeys)
    const cohortSize = cohortSizeByDomain.get(row.domain) ?? 0
    const assessment = buildHobbyMasterAssessment({
      row,
      cohortSize,
      withinCohortPercentile:
        identityStatus === 'ambiguous_normalized_name'
          ? 50
          : withinCohortPercentileBySourceKey.get(row.sourceKey) ?? 50,
      globalObservedPercentile:
        globalPercentileBySourceKey.get(row.sourceKey) ?? 0,
      identityStatus,
      freshnessStatus: freshness.status,
    })
    return {
      recordVersion: HOBBY_MASTER_RECORD_VERSION,
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
      masterRank: null,
      withinCohortRank:
        legacyCohortRankBySourceKey.get(row.sourceKey) ?? cohortSize,
      assessment,
    }
  })
  const rankedItems = unrankedItems
    .filter((item) => (
      item.assessment.buildQualification.checks.comparisonEligible
    ))
    .toSorted(sortMasterItems)
  const masterRankBySourceKey = new Map(
    rankedItems.map((item, index) => [item.subject.id, index + 1]),
  )
  const items = unrankedItems.map((item) => ({
    ...item,
    masterRank: masterRankBySourceKey.get(item.subject.id) ?? null,
  }))
  const cohorts = snapshot.metadata.cohortCounts.map((cohort) => {
    const cohortItems = items.filter(
      (item) => item.subject.domain === cohort.domain,
    )
    return {
      domain: cohort.domain,
      taxonomyStatus: cohort.taxonomyStatus,
      subjectCount: cohort.rowCount,
      rankedCount: cohortItems.filter((item) => item.masterRank !== null).length,
      buildCount: cohortItems.filter(
        (item) => item.assessment.buildQualification.eligible,
      ).length,
    }
  })
  const snapshotId = `hobby-oracle-master-ranking/v2:${
    createHash('sha256').update(JSON.stringify({
      rowsSha256: snapshot.rowsSha256,
      modelVersion: HOBBY_MASTER_MODEL_VERSION,
      freshness: freshness.status,
      rankings: items.map((item) => [
        item.subject.id,
        item.masterRank,
        item.assessment.marketSignal.score,
        item.assessment.buildQualification.route,
      ]),
    })).digest('hex')
  }`
  return {
    snapshot,
    items,
    cohorts,
    freshness,
    snapshotId,
    rankingUniverseCount: rankedItems.length,
  }
}

function compareNullableRank(
  left: number | null,
  right: number | null,
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left - right
}

export function buildHobbyMasterFeed(
  catalog: HobbyMasterCatalog,
  query: HobbyMasterQuery = {},
): HobbyMasterFeedResponse {
  const normalizedQuery = query.q?.trim().toLocaleLowerCase('en-US') ?? ''
  const domain = query.domain ?? 'all'
  const posture = query.posture ?? 'all'
  const sort = query.sort ?? 'master_rank'
  const direction = query.direction ??
    (
      sort === 'master_rank' ||
      sort === 'cohort_rank' ||
      sort === 'name'
        ? 'asc'
        : 'desc'
    )
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const limit = Math.max(1, Math.min(100, Math.floor(query.limit ?? 50)))
  const filtered = catalog.items.filter((item) => (
    (domain === 'all' || item.subject.domain === domain) &&
    (posture === 'all' || item.assessment.posture === posture) &&
    (
      normalizedQuery.length === 0 ||
      item.subject.name.toLocaleLowerCase('en-US').includes(normalizedQuery)
    )
  )).toSorted((left, right) => {
    const leftSignal = left.assessment.marketSignal
    const rightSignal = right.assessment.marketSignal
    const missingRankComparison =
      left.masterRank === null && right.masterRank !== null
        ? 1
        : left.masterRank !== null && right.masterRank === null
          ? -1
          : 0
    if (sort === 'master_rank' && missingRankComparison !== 0) {
      return missingRankComparison
    }
    let comparison = 0
    switch (sort) {
      case 'master_rank':
        comparison = compareNullableRank(left.masterRank, right.masterRank)
        break
      case 'master_score':
        comparison = leftSignal.score - rightSignal.score
        break
      case 'ttm_sales':
        comparison =
          leftSignal.latestTwelveMonthSalesUsd -
          rightSignal.latestTwelveMonthSalesUsd
        break
      case 'current_run_rate':
        comparison =
          leftSignal.annualizedCurrentSixMonthSalesUsd -
          rightSignal.annualizedCurrentSixMonthSalesUsd
        break
      case 'trend':
        comparison =
          leftSignal.diagnostics.yearOverYearSixMonthLogGrowth -
          rightSignal.diagnostics.yearOverYearSixMonthLogGrowth
        break
      case 'durability':
        comparison = leftSignal.durabilityScore - rightSignal.durabilityScore
        break
      case 'persistence':
        comparison =
          leftSignal.components.persistence - rightSignal.components.persistence
        break
      case 'shock_resistance':
        comparison =
          leftSignal.components.shockResistance -
          rightSignal.components.shockResistance
        break
      case 'cohort_rank':
        comparison = left.withinCohortRank - right.withinCohortRank
        break
      case 'cohort_percentile':
        comparison =
          leftSignal.withinCohortPercentile -
          rightSignal.withinCohortPercentile
        break
      case 'name':
        comparison = left.subject.name.localeCompare(right.subject.name, 'en-US')
        break
    }
    const directed = direction === 'asc' ? comparison : -comparison
    return (
      directed ||
      missingRankComparison ||
      compareNullableRank(left.masterRank, right.masterRank) ||
      left.subject.domain.localeCompare(right.subject.domain, 'en-US') ||
      left.subject.name.localeCompare(right.subject.name, 'en-US')
    )
  })
  const total = filtered.length
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit)
  const offset = (page - 1) * limit
  const buildCount = catalog.items.filter(
    (item) => item.assessment.buildQualification.eligible,
  ).length

  return {
    schemaVersion: HOBBY_MASTER_SCHEMA_VERSION,
    contractVersion: HOBBY_MASTER_CONTRACT_VERSION,
    snapshot: {
      id: catalog.snapshotId,
      historyStart: `${catalog.snapshot.historyMonths[0]}-01`,
      historyMonths: 18,
      dataThrough: catalog.snapshot.dataThrough,
      publishedAt: catalog.snapshot.publishedAt,
      acquiredAt: catalog.snapshot.acquiredAt,
      freshness: catalog.freshness,
    },
    items: filtered.slice(offset, offset + limit),
    cohorts: catalog.cohorts,
    page: { page, limit, total, totalPages },
    meta: {
      researchOnly: true,
      investmentAdvice: false,
      rankingPolicy:
        'single_observed_universe_absolute_demand_and_durability_order',
      rankingUniverse: 'coherent_unambiguous_gemrate_subject_rows',
      rankingUniverseCount: catalog.rankingUniverseCount,
      buildCount,
      marketSource: 'GemRate Athlete + Pokémon Sales Trends',
      marketMeasure: 'completed_ebay_singles_sales_volume_usd',
      exactCardRecommendationsAvailable: false,
      globalComparisonStatus:
        'observed_snapshot_comparable_not_canonical_hobby_census',
      globalComparisonLimitations: [
        'provider_export_may_be_capped',
        'source_name_identity_is_not_canonical_subject_identity',
        'subject_level_demand_is_not_exact_card_return',
        'supply_population_and_dilution_are_unavailable',
      ],
      buildPolicy: {
        fixedDollarAnchors: true,
        establishedTtmFloorUsd:
          HOBBY_MASTER_ESTABLISHED_TTM_FLOOR_USD,
        establishedRunRateFloorUsd:
          HOBBY_MASTER_ESTABLISHED_RUN_RATE_FLOOR_USD,
        escapeTtmFloorUsd: HOBBY_MASTER_ESCAPE_TTM_FLOOR_USD,
        escapeRunRateFloorUsd: HOBBY_MASTER_ESCAPE_RUN_RATE_FLOOR_USD,
        positiveMomentumAddsScore: false,
      },
      permissionAttestation: 'docs/permissions/GEMRATE_ATTESTATION.md',
    },
  }
}

export const hobbyMasterCatalog = buildHobbyMasterCatalog()

export const hobbyMasterDomains: readonly MagnificentXDomain[] = [
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

export const hobbyMasterPostures: readonly MagnificentXResearchPosture[] = [
  'build_candidate',
  'hold_candidate',
  'watch',
  'risk_review',
  'pass',
  'unrated',
  'needs_refresh',
]

export const hobbyMasterSortDirections: readonly HobbyMasterSortDirection[] = [
  'asc',
  'desc',
]
