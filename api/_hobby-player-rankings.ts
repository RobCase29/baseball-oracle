import { createHash } from 'node:crypto'
import checklistSignalsJson from './_data/checklist-hobby-player-signals.json' with { type: 'json' }
import identityControlsJson from './_data/hobby-player-identity-controls.json' with { type: 'json' }
import identityReviewJson from './_data/hobby-player-identity-review.json' with { type: 'json' }
import {
  magnificentXCatalog,
  magnificentXFreshness,
} from './_magnificent-x.js'
import {
  midrankPercentiles,
  type MagnificentXSourceRow,
} from '../src/domain/magnificentX.js'
import {
  HOBBY_PLAYER_RANKING_HISTORY_MONTHS,
  HOBBY_PLAYER_RANKING_POSTURES,
  HOBBY_PLAYER_RANKING_SORT_KEYS,
  HOBBY_PLAYER_RANKINGS_CONTRACT_VERSION,
  HOBBY_PLAYER_RANKINGS_FEED_SCHEMA_VERSION,
  HOBBY_PLAYER_RANKINGS_MODEL_VERSION,
  normalizeHobbyPlayerName,
  rankHobbyPlayerCandidates,
  type HobbyPlayerRankingCandidateInput,
  type HobbyPlayerRankingFreshnessStatus,
  type HobbyPlayerRankingItem,
  type HobbyPlayerRankingPosture,
  type HobbyPlayerRankingsResponse,
  type HobbyPlayerRankingSortKey,
  type HobbyPlayerRankingSourceEvidence,
  type HobbyPlayerRankingSport,
} from '../src/domain/hobbyPlayerRanking.js'

const EXCHANGE_SCHEMA_VERSION = 'backstop-hobby-player-signals.v2' as const
const EXCHANGE_CONTRACT_VERSION = '2.0.0' as const
const IDENTITY_REVIEW_SCHEMA_VERSION =
  'hobby-player-identity-review.v1' as const
const IDENTITY_CONTROLS_SCHEMA_VERSION =
  'hobby-player-identity-controls.v1' as const
const FUNDAMENTALS_MAX_AGE_DAYS = {
  football: 14,
  basketball: 45,
} as const

interface ExchangeSource {
  sourceId:
    | 'keeptradecut-dynasty-football'
    | 'hashtag-basketball-dynasty'
  provider: 'KeepTradeCut' | 'Hashtag Basketball'
  sport: HobbyPlayerRankingSport
  sourceSchemaVersion: string
  snapshotSha256: string
  sourceUrl: string
  fetchedAt: string
  sourceUpdatedAt: string | null
  semantics: string
  format: string
  scoring: string
  forecast: string | null
  universe: number
  sourceRows: number
  publishedRows: number
  quarantinedRows: number
  rights: {
    usageClass: string
    productionUse: string
    publicationStatus: string
    trainingAllowed: false
    rawSourceRedistributionAllowed: false
    providerAttributionRequired: true
    providerPermissionClaimed: boolean | string
  }
}

interface FootballFacts {
  superflex: {
    value: number
    rank: number | null
    positionalRank: number
    tier: number
    movement30d: number
    movement7d: number
    tradeCount: number
  }
  oneQb: {
    value: number
    rank: number | null
    positionalRank: number
    tier: number
    movement30d: number
    movement7d: number
    tradeCount: number
  } | null
}

interface BasketballFacts {
  overall: {
    rank: number | null
    movement: number
  }
  keeper: {
    rank: number | null
    value: number
  }
}

interface ExchangeRow {
  sourceId: ExchangeSource['sourceId']
  provider: ExchangeSource['provider']
  sport: HobbyPlayerRankingSport
  providerPlayerId: string
  sourceDisplayName: string
  normalizedName: string
  team: string | null
  positions: string[]
  age: number | null
  careerStartYear: number | null
  facts: FootballFacts | BasketballFacts
}

interface ExchangeArtifact {
  schemaVersion: typeof EXCHANGE_SCHEMA_VERSION
  contractVersion: string
  generatedAt: string
  semantics: string
  counts: {
    sourceRows: number
    publishedRows: number
    quarantinedRows: number
    quarantineGroups: number
    bySport: Record<HobbyPlayerRankingSport, number>
  }
  sources: ExchangeSource[]
  rows: ExchangeRow[]
  quarantine: unknown[]
  contentSha256: string
}

interface IdentityReviewEntry {
  sport: HobbyPlayerRankingSport
  providerPlayerId: string
  providerDisplayName: string
  normalizedName: string
  gemRateSourceKey: string
  gemRateDisplayName: string
  status: 'approved'
  reviewedAt: string
  note: string
}

interface IdentityReview {
  schemaVersion: typeof IDENTITY_REVIEW_SCHEMA_VERSION
  reviewedAt: string
  reviewerScope: string
  entries: IdentityReviewEntry[]
}

interface IdentityControlAlias {
  sport: HobbyPlayerRankingSport
  providerPlayerId: string
  providerDisplayName: string
  providerNormalizedName: string
  gemRateSourceKey: string
  gemRateDisplayName: string
  gemRateNormalizedName: string
  status: 'approved'
  reviewedAt: string
  note: string
}

interface IdentityControlBlock {
  sport: HobbyPlayerRankingSport
  providerPlayerId: string
  providerDisplayName: string
  providerNormalizedName: string
  gemRateSourceKey: string
  gemRateDisplayName: string
  gemRateNormalizedName: string
  status: 'blocked'
  reasonCode: string
  reviewedAt: string
  note: string
}

interface IdentityControls {
  schemaVersion: typeof IDENTITY_CONTROLS_SCHEMA_VERSION
  reviewedAt: string
  reviewerScope: string
  aliases: IdentityControlAlias[]
  blocks: IdentityControlBlock[]
}

interface QuarantineSummary {
  total: number
  ambiguousProviderIdentity: number
  ambiguousMarketIdentity: number
  missingMarketMatch: number
  incompleteProviderRanks: number
  invalidAge: number
  identityControlBlocked: number
  impossibleGradedChronology: number
}

interface CoverageSummary {
  sourceRows: number
  rankedRows: number
  coveragePercent: number
}

interface SportFreshness {
  status: HobbyPlayerRankingFreshnessStatus
  marketStatus: HobbyPlayerRankingFreshnessStatus
  fundamentalsStatus: HobbyPlayerRankingFreshnessStatus
  nextExpectedBy: string
  reasonCodes: string[]
}

interface FreshnessIntegrityTimestamps {
  exchangeGeneratedAt: string
  identityReviewReviewedAt: string
  identityControlsReviewedAt: string
}

export interface HobbyPlayerRankingCatalog {
  exchange: ExchangeArtifact
  items: HobbyPlayerRankingItem[]
  freshnessBySport: Record<HobbyPlayerRankingSport, SportFreshness>
  snapshotIdBySport: Record<HobbyPlayerRankingSport, string>
  cohorts: HobbyPlayerRankingsResponse['cohorts']
  quarantine: QuarantineSummary
  quarantineBySport: Record<HobbyPlayerRankingSport, QuarantineSummary>
  coverageBySport: Record<HobbyPlayerRankingSport, CoverageSummary>
  positionsBySport: Record<HobbyPlayerRankingSport, string[]>
  ageRangeBySport: Record<HobbyPlayerRankingSport, {
    minimum: number
    maximum: number
  }>
  snapshotGeneratedAt: string
  snapshotAcquiredAt: string
}

export interface HobbyPlayerRankingsQuery {
  sport?: HobbyPlayerRankingSport
  q?: string
  maxAge?: number
  position?: string
  posture?: HobbyPlayerRankingPosture | 'all'
  sort?: HobbyPlayerRankingSortKey
  page?: number
  limit?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value
}

function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  )
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function exchangeContentHash(exchange: ExchangeArtifact): string {
  const { contentSha256: _contentSha256, ...body } = exchange
  return createHash('sha256').update(stableJson(body)).digest('hex')
}

function validRank(value: unknown, universe: number): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= universe
  )
}

function validNullableRank(
  value: unknown,
  universe: number,
): value is number | null {
  return value === null || validRank(value, universe)
}

function validPositiveNullableRank(value: unknown): value is number | null {
  return value === null || (
    Number.isSafeInteger(value) && (value as number) >= 1
  )
}

function validExchangeRow(
  value: unknown,
  universeBySource: ReadonlyMap<string, number>,
): value is ExchangeRow {
  if (!isRecord(value)) return false
  const sport = value.sport
  const sourceId = value.sourceId
  const universe =
    typeof sourceId === 'string' ? universeBySource.get(sourceId) : undefined
  if (
    (sport !== 'football' && sport !== 'basketball') ||
    !universe ||
    typeof value.providerPlayerId !== 'string' ||
    value.providerPlayerId.length === 0 ||
    typeof value.sourceDisplayName !== 'string' ||
    value.normalizedName !==
      normalizeHobbyPlayerName(value.sourceDisplayName) ||
    (value.team !== null && typeof value.team !== 'string') ||
    !Array.isArray(value.positions) ||
    !value.positions.every(
      (position) => typeof position === 'string' && position.length > 0,
    ) ||
    (value.age !== null && !Number.isFinite(value.age)) ||
    !Object.hasOwn(value, 'careerStartYear') ||
    (
      value.careerStartYear !== null &&
      (
        !Number.isSafeInteger(value.careerStartYear) ||
        (value.careerStartYear as number) < 1900 ||
        (value.careerStartYear as number) > 2200
      )
    ) ||
    (sport === 'basketball' && value.careerStartYear !== null) ||
    !isRecord(value.facts)
  ) {
    return false
  }
  if (sport === 'football') {
    return (
      sourceId === 'keeptradecut-dynasty-football' &&
      value.provider === 'KeepTradeCut' &&
      isRecord(value.facts.superflex) &&
      validNullableRank(value.facts.superflex.rank, universe) &&
      (
        value.facts.oneQb === null ||
        (
          isRecord(value.facts.oneQb) &&
          validPositiveNullableRank(value.facts.oneQb.rank)
        )
      )
    )
  }
  return (
    sourceId === 'hashtag-basketball-dynasty' &&
    value.provider === 'Hashtag Basketball' &&
    isRecord(value.facts.overall) &&
    isRecord(value.facts.keeper) &&
    validNullableRank(value.facts.overall.rank, universe) &&
    validPositiveNullableRank(value.facts.keeper.rank)
  )
}

export function parseHobbyPlayerSignalExchange(
  value: unknown,
): ExchangeArtifact {
  if (!isRecord(value)) {
    throw new Error('Checklist player-signal exchange must be an object')
  }
  const exchange = value as unknown as ExchangeArtifact
  if (
    exchange.schemaVersion !== EXCHANGE_SCHEMA_VERSION ||
    exchange.contractVersion !== EXCHANGE_CONTRACT_VERSION ||
    !validIso(exchange.generatedAt) ||
    typeof exchange.semantics !== 'string' ||
    exchange.semantics.length < 40 ||
    !isRecord(exchange.counts) ||
    !isRecord(exchange.counts.bySport) ||
    !Array.isArray(exchange.sources) ||
    exchange.sources.length !== 2 ||
    !Array.isArray(exchange.rows) ||
    exchange.rows.length < 800 ||
    !Array.isArray(exchange.quarantine) ||
    !isSha256(exchange.contentSha256)
  ) {
    throw new Error('Checklist player-signal exchange failed its contract')
  }
  const sourceIds = new Set<string>()
  for (const source of exchange.sources) {
    if (
      sourceIds.has(source.sourceId) ||
      !['football', 'basketball'].includes(source.sport) ||
      !isSha256(source.snapshotSha256) ||
      !validIso(source.fetchedAt) ||
      (source.sourceUpdatedAt !== null &&
        !validDate(source.sourceUpdatedAt)) ||
      !Number.isSafeInteger(source.universe) ||
      source.universe < 100 ||
      source.rights?.trainingAllowed !== false ||
      source.rights?.rawSourceRedistributionAllowed !== false ||
      source.rights?.providerAttributionRequired !== true
    ) {
      throw new Error('Checklist player-signal source failed validation')
    }
    sourceIds.add(source.sourceId)
  }
  const universeBySource = new Map(
    exchange.sources.map((source) => [source.sourceId, source.universe]),
  )
  const identities = new Set<string>()
  for (const row of exchange.rows) {
    const identity = `${row.sourceId}|${row.providerPlayerId}`
    if (
      !validExchangeRow(row, universeBySource) ||
      identities.has(identity)
    ) {
      throw new Error(
        `Checklist player-signal row failed validation: ${identity}`,
      )
    }
    identities.add(identity)
  }
  if (
    exchange.counts.publishedRows !== exchange.rows.length ||
    exchange.counts.sourceRows !==
      exchange.counts.publishedRows + exchange.counts.quarantinedRows ||
    exchange.counts.bySport.football !==
      exchange.rows.filter((row) => row.sport === 'football').length ||
    exchange.counts.bySport.basketball !==
      exchange.rows.filter((row) => row.sport === 'basketball').length ||
    exchangeContentHash(exchange) !== exchange.contentSha256
  ) {
    throw new Error('Checklist player-signal exchange failed reconciliation')
  }
  return exchange
}

export function parseHobbyPlayerIdentityReview(value: unknown): IdentityReview {
  if (!isRecord(value)) {
    throw new Error('Hobby player identity review must be an object')
  }
  const review = value as unknown as IdentityReview
  if (
    review.schemaVersion !== IDENTITY_REVIEW_SCHEMA_VERSION ||
    !validIso(review.reviewedAt) ||
    typeof review.reviewerScope !== 'string' ||
    !Array.isArray(review.entries)
  ) {
    throw new Error('Hobby player identity review failed its contract')
  }
  const identities = new Set<string>()
  for (const entry of review.entries) {
    const identity = `${entry.sport}|${entry.providerPlayerId}`
    if (
      (entry.sport !== 'football' && entry.sport !== 'basketball') ||
      typeof entry.providerPlayerId !== 'string' ||
      entry.providerPlayerId.length === 0 ||
      typeof entry.providerDisplayName !== 'string' ||
      typeof entry.gemRateDisplayName !== 'string' ||
      entry.normalizedName !==
        normalizeHobbyPlayerName(entry.providerDisplayName) ||
      entry.normalizedName !==
        normalizeHobbyPlayerName(entry.gemRateDisplayName) ||
      typeof entry.gemRateSourceKey !== 'string' ||
      entry.gemRateSourceKey.length === 0 ||
      entry.status !== 'approved' ||
      !validIso(entry.reviewedAt) ||
      typeof entry.note !== 'string' ||
      entry.note.length < 8 ||
      identities.has(identity)
    ) {
      throw new Error(`Hobby player identity review is invalid: ${identity}`)
    }
    identities.add(identity)
  }
  return review
}

export function parseHobbyPlayerIdentityControls(
  value: unknown,
): IdentityControls {
  if (!isRecord(value)) {
    throw new Error('Hobby player identity controls must be an object')
  }
  const controls = value as unknown as IdentityControls
  if (
    controls.schemaVersion !== IDENTITY_CONTROLS_SCHEMA_VERSION ||
    !validIso(controls.reviewedAt) ||
    typeof controls.reviewerScope !== 'string' ||
    controls.reviewerScope.length < 40 ||
    !Array.isArray(controls.aliases) ||
    !Array.isArray(controls.blocks)
  ) {
    throw new Error('Hobby player identity controls failed their contract')
  }
  const identities = new Set<string>()
  for (const entry of [...controls.aliases, ...controls.blocks]) {
    const identity = `${entry.sport}|${entry.providerPlayerId}`
    const commonValid =
      (entry.sport === 'football' || entry.sport === 'basketball') &&
      typeof entry.providerPlayerId === 'string' &&
      entry.providerPlayerId.length > 0 &&
      typeof entry.providerDisplayName === 'string' &&
      entry.providerNormalizedName ===
        normalizeHobbyPlayerName(entry.providerDisplayName) &&
      typeof entry.gemRateSourceKey === 'string' &&
      entry.gemRateSourceKey.length > 0 &&
      typeof entry.gemRateDisplayName === 'string' &&
      entry.gemRateNormalizedName ===
        normalizeHobbyPlayerName(entry.gemRateDisplayName) &&
      validIso(entry.reviewedAt) &&
      typeof entry.note === 'string' &&
      entry.note.length >= 8 &&
      !identities.has(identity)
    if (!commonValid) {
      throw new Error(
        `Hobby player identity control is invalid: ${identity}`,
      )
    }
    identities.add(identity)
  }
  for (const alias of controls.aliases) {
    if (alias.status !== 'approved') {
      throw new Error(
        `Hobby player identity alias is invalid: ` +
          `${alias.sport}|${alias.providerPlayerId}`,
      )
    }
  }
  for (const block of controls.blocks) {
    if (
      block.status !== 'blocked' ||
      typeof block.reasonCode !== 'string' ||
      block.reasonCode.length < 8
    ) {
      throw new Error(
        `Hobby player identity block is invalid: ` +
          `${block.sport}|${block.providerPlayerId}`,
      )
    }
  }
  return controls
}

function addDays(value: string, days: number): string {
  const parsed = new Date(value)
  return new Date(
    parsed.valueOf() + days * 24 * 60 * 60 * 1_000,
  ).toISOString()
}

function gemRateAthleteAcquiredAt(): string {
  const acquiredAt = magnificentXCatalog.snapshot.sources
    .filter((source) => source.subjectType === 'athlete')
    .map((source) => source.acquiredAt)
    .toSorted()
    .at(-1)
  if (!acquiredAt) {
    throw new Error('GemRate athlete acquisition evidence is missing')
  }
  return acquiredAt
}

function fundamentalsFreshness(
  source: ExchangeSource,
  now: Date,
): {
  status: HobbyPlayerRankingFreshnessStatus
  nextExpectedBy: string
  reasonCodes: string[]
} {
  const anchor = source.sourceUpdatedAt
    ? `${source.sourceUpdatedAt}T23:59:59.999Z`
    : source.fetchedAt
  const nextExpectedBy = addDays(
    anchor,
    FUNDAMENTALS_MAX_AGE_DAYS[source.sport],
  )
  const nowTime = now.valueOf()
  if (!Number.isFinite(nowTime)) {
    return {
      status: 'unknown',
      nextExpectedBy,
      reasonCodes: ['current_time_invalid'],
    }
  }
  const stale = nowTime > Date.parse(nextExpectedBy)
  return {
    status: stale ? 'stale' : 'current',
    nextExpectedBy,
    reasonCodes: stale
      ? [`${source.sourceId}_snapshot_overdue`]
      : [],
  }
}

function combinedFreshness(
  sport: HobbyPlayerRankingSport,
  source: ExchangeSource,
  now: Date,
  integrityTimestamps: FreshnessIntegrityTimestamps,
): SportFreshness {
  const nowTime = now.valueOf()
  const futureTimestampReasons = (
    entries: ReadonlyArray<{ id: string; value: string }>,
  ): string[] => (
    Number.isFinite(nowTime)
      ? entries
          .filter((entry) => Date.parse(entry.value) > nowTime)
          .map((entry) => `${entry.id}_timestamp_in_future`)
      : []
  )
  const marketBase = magnificentXFreshness(
    magnificentXCatalog.snapshot.dataThrough,
    now,
  )
  const marketFutureReasons = futureTimestampReasons([
    {
      id: 'gemrate_snapshot_published',
      value: magnificentXCatalog.snapshot.publishedAt,
    },
    {
      id: 'gemrate_snapshot_acquired',
      value: gemRateAthleteAcquiredAt(),
    },
  ])
  const market = marketFutureReasons.length === 0
    ? marketBase
    : {
        ...marketBase,
        status: 'unknown' as const,
        reasonCodes: [
          ...marketBase.reasonCodes,
          ...marketFutureReasons,
        ],
      }
  const fundamentalsBase = fundamentalsFreshness(source, now)
  const fundamentalsFutureReasons = futureTimestampReasons([
    {
      id: 'checklist_exchange_generated',
      value: integrityTimestamps.exchangeGeneratedAt,
    },
    {
      id: `${source.sourceId}_fetched`,
      value: source.fetchedAt,
    },
    {
      id: 'identity_review_reviewed',
      value: integrityTimestamps.identityReviewReviewedAt,
    },
    {
      id: 'identity_controls_reviewed',
      value: integrityTimestamps.identityControlsReviewedAt,
    },
  ])
  const fundamentals = fundamentalsFutureReasons.length === 0
    ? fundamentalsBase
    : {
        ...fundamentalsBase,
        status: 'unknown' as const,
        reasonCodes: [
          ...fundamentalsBase.reasonCodes,
          ...fundamentalsFutureReasons,
        ],
      }
  const statuses = [market.status, fundamentals.status]
  const status: HobbyPlayerRankingFreshnessStatus =
    statuses.includes('unknown')
      ? 'unknown'
      : statuses.every((entry) => entry === 'current')
        ? 'current'
        : 'stale'
  const reasonCodes = [
    ...market.reasonCodes,
    ...fundamentals.reasonCodes,
  ]
  return {
    status,
    marketStatus: market.status,
    fundamentalsStatus: fundamentals.status,
    nextExpectedBy: [
      market.nextExpectedBy,
      fundamentals.nextExpectedBy,
    ].toSorted()[0]!,
    reasonCodes: [
      ...reasonCodes,
      ...(status === 'current'
        ? []
        : [`${sport}_ranking_publication_suspended`]),
    ],
  }
}

function trailingTwelveSales(row: MagnificentXSourceRow): number {
  return row.monthlySalesUsd
    .slice(-12)
    .reduce((total, amount) => total + amount, 0)
}

function recentSixMonthSales(row: MagnificentXSourceRow): number {
  return row.monthlySalesUsd
    .slice(-6)
    .reduce((total, amount) => total + amount, 0)
}

function fullHistorySales(row: MagnificentXSourceRow): number {
  return row.monthlySalesUsd.reduce(
    (total, amount) => total + amount,
    0,
  )
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function fractionalUtcYear(value: string): number {
  const date = new Date(value)
  const year = date.getUTCFullYear()
  const start = Date.UTC(year, 0, 1)
  const next = Date.UTC(year + 1, 0, 1)
  return year + (date.valueOf() - start) / (next - start)
}

function impossibleGradedChronology(
  provider: ExchangeRow,
  market: MagnificentXSourceRow,
  source: ExchangeSource,
): boolean {
  const first = market.firstGradedYear
  const most = market.mostGradedYear
  const dataThroughYear = Number(
    magnificentXCatalog.snapshot.dataThrough.slice(0, 4),
  )
  if (
    (first !== null && (first < 1800 || first > dataThroughYear)) ||
    (most !== null && (most < 1800 || most > dataThroughYear)) ||
    (first !== null && most !== null && first > most)
  ) {
    return true
  }
  if (provider.age === null) return false
  const estimatedBirthYear =
    fractionalUtcYear(source.fetchedAt) - provider.age
  return [first, most].some(
    (year) =>
      year !== null &&
      year < estimatedBirthYear,
  )
}

function evidenceFor(
  provider: ExchangeRow,
): Pick<
  HobbyPlayerRankingCandidateInput,
  'evidenceYears' | 'evidenceStage' | 'evidenceBasis'
> {
  const dataThroughYear = Number(
    magnificentXCatalog.snapshot.dataThrough.slice(0, 4),
  )
  const evidenceYears = provider.sport === 'football'
    ? (
        provider.careerStartYear === null
          ? 0
          : Math.max(0, dataThroughYear - provider.careerStartYear)
      )
    : Math.max(0, Math.floor((provider.age ?? 19) - 19))
  const evidenceStage =
    evidenceYears === 0
      ? 'new'
      : evidenceYears === 1
        ? 'developing'
        : evidenceYears <= 3
          ? 'emerging'
          : 'established'
  return {
    evidenceYears,
    evidenceStage,
    evidenceBasis:
      provider.sport === 'football'
        ? 'nfl_draft_year'
        : 'basketball_age_proxy',
  }
}

function sourceForSport(
  exchange: ExchangeArtifact,
  sport: HobbyPlayerRankingSport,
): ExchangeSource {
  const source = exchange.sources.find((entry) => entry.sport === sport)
  if (!source) throw new Error(`Missing ${sport} fundamentals source`)
  return source
}

function sourceEvidence(
  sport: HobbyPlayerRankingSport,
  source: ExchangeSource,
  freshness: SportFreshness,
): HobbyPlayerRankingSourceEvidence[] {
  return [
    {
      id: 'gemrate',
      label: 'GemRate',
      url: 'https://www.gemrate.com/sales-trends',
      asOf: magnificentXCatalog.snapshot.dataThrough,
      fetchedAt: gemRateAthleteAcquiredAt(),
      freshness: freshness.marketStatus,
      permissionBasis: 'licensed_user_provided_permission',
      measure: 'completed eBay singles sales volume in USD',
    },
    sport === 'football'
      ? {
          id: 'keeptradecut',
          label: 'KeepTradeCut',
          url: source.sourceUrl,
          asOf: source.sourceUpdatedAt ?? source.fetchedAt,
          fetchedAt: source.fetchedAt,
          freshness: freshness.fundamentalsStatus,
          permissionBasis: source.rights.productionUse,
          measure: 'crowdsourced one-QB and Superflex dynasty rank',
        }
      : {
          id: 'hashtag_basketball',
          label: 'Hashtag Basketball',
          url: source.sourceUrl,
          asOf: source.sourceUpdatedAt ?? source.fetchedAt,
          fetchedAt: source.fetchedAt,
          freshness: freshness.fundamentalsStatus,
          permissionBasis:
            'owner_directed_existing_production_use_provisional',
          measure: 'five-season and keeper fantasy basketball rank',
        },
  ]
}

function providerPercentiles(
  row: ExchangeRow,
  maps: {
    primary: ReadonlyMap<string, number>
    secondary: ReadonlyMap<string, number>
  },
): HobbyPlayerRankingCandidateInput['providerPercentiles'] | null {
  const primary = maps.primary.get(row.providerPlayerId) ?? null
  const secondary = maps.secondary.get(row.providerPlayerId) ?? null
  if (primary === null || secondary === null) return null
  if (row.sport === 'football') {
    return {
      oneQb: secondary,
      superflex: primary,
      fiveSeason: null,
      keeper: null,
    }
  }
  return {
    oneQb: null,
    superflex: null,
    fiveSeason: primary,
    keeper: secondary,
  }
}

function providerRank(
  row: ExchangeRow,
  format: 'primary' | 'secondary',
): number | null {
  if (row.sport === 'football') {
    const facts = row.facts as FootballFacts
    return format === 'primary'
      ? facts.superflex.rank
      : facts.oneQb?.rank ?? null
  }
  const facts = row.facts as BasketballFacts
  return format === 'primary'
    ? facts.overall.rank
    : facts.keeper.rank
}

function providerPercentileMaps(
  exchange: ExchangeArtifact,
): Record<
  HobbyPlayerRankingSport,
  {
    primary: Map<string, number>
    secondary: Map<string, number>
  }
> {
  return Object.fromEntries(
    (['football', 'basketball'] as const).map((sport) => {
      const rows = exchange.rows.filter((row) => row.sport === sport)
      const mapFor = (format: 'primary' | 'secondary') => {
        const ranked = rows.filter(
          (row) => providerRank(row, format) !== null,
        )
        return midrankPercentiles(
          ranked,
          (row) => -providerRank(row, format)!,
          (row) => row.providerPlayerId,
        )
      }
      return [
        sport,
        {
          primary: mapFor('primary'),
          secondary: mapFor('secondary'),
        },
      ]
    }),
  ) as Record<
    HobbyPlayerRankingSport,
    {
      primary: Map<string, number>
      secondary: Map<string, number>
    }
  >
}

function identityReviewKey(
  sport: HobbyPlayerRankingSport,
  providerPlayerId: string,
): string {
  return `${sport}|${providerPlayerId}`
}

function approvedIdentity(
  reviewByKey: ReadonlyMap<string, IdentityReviewEntry>,
  provider: ExchangeRow,
  market: MagnificentXSourceRow,
): boolean {
  const entry = reviewByKey.get(
    identityReviewKey(provider.sport, provider.providerPlayerId),
  )
  return Boolean(
    entry &&
    entry.providerDisplayName === provider.sourceDisplayName &&
    entry.normalizedName === provider.normalizedName &&
    entry.gemRateSourceKey === market.sourceKey &&
    entry.gemRateDisplayName === market.subjectName,
  )
}

function uniqueGroups<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const value of values) {
    const key = keyFor(value)
    const group = result.get(key) ?? []
    group.push(value)
    result.set(key, group)
  }
  return result
}

function assertIdentityControlsResolve(
  controls: IdentityControls,
  exchange: ExchangeArtifact,
  marketRows: readonly MagnificentXSourceRow[],
  marketGroups: ReadonlyMap<string, MagnificentXSourceRow[]>,
  declaredAmbiguousMarket: ReadonlySet<string>,
): void {
  const providerByKey = new Map(
    exchange.rows.map((row) => [
      identityReviewKey(row.sport, row.providerPlayerId),
      row,
    ]),
  )
  const marketBySourceKey = new Map(
    marketRows.map((row) => [row.sourceKey, row]),
  )
  for (const control of [...controls.aliases, ...controls.blocks]) {
    const key = identityReviewKey(
      control.sport,
      control.providerPlayerId,
    )
    const provider = providerByKey.get(key)
    const market = marketBySourceKey.get(control.gemRateSourceKey)
    if (
      !provider ||
      provider.sourceDisplayName !== control.providerDisplayName ||
      provider.normalizedName !== control.providerNormalizedName ||
      !market ||
      market.domain !== control.sport ||
      market.subjectName !== control.gemRateDisplayName ||
      market.normalizedName !== control.gemRateNormalizedName
    ) {
      throw new Error(
        `Hobby player identity control does not resolve exactly: ${key}`,
      )
    }
    if (control.status === 'approved') {
      const marketKey = `${control.sport}|${control.gemRateNormalizedName}`
      if (
        declaredAmbiguousMarket.has(marketKey) ||
        marketGroups.get(marketKey)?.length !== 1
      ) {
        throw new Error(
          `Hobby player identity alias targets ambiguous market data: ${key}`,
        )
      }
    }
  }
}

function emptyQuarantine(): QuarantineSummary {
  return {
    total: 0,
    ambiguousProviderIdentity: 0,
    ambiguousMarketIdentity: 0,
    missingMarketMatch: 0,
    incompleteProviderRanks: 0,
    invalidAge: 0,
    identityControlBlocked: 0,
    impossibleGradedChronology: 0,
  }
}

function confidenceSources(
  sport: HobbyPlayerRankingSport,
  source: ExchangeSource,
  freshness: SportFreshness,
): HobbyPlayerRankingSourceEvidence[] {
  return sourceEvidence(sport, source, freshness).map((entry) => ({ ...entry }))
}

function candidateToItem(
  candidate: ReturnType<typeof rankHobbyPlayerCandidates>[number],
  source: ExchangeSource,
  freshness: SportFreshness,
): HobbyPlayerRankingItem {
  return {
    recordVersion: 'hobby-player-ranking-item/v2',
    id: candidate.input.id,
    name: candidate.input.name,
    normalizedName: candidate.input.normalizedName,
    sport: candidate.input.sport,
    age: candidate.input.age,
    positions: [...candidate.input.positions],
    primaryPosition: candidate.input.primaryPosition,
    team: candidate.input.team,
    sportRank: candidate.sportRank,
    screenRank: candidate.sportRank,
    sportPercentile: candidate.sportPercentile,
    score: candidate.score,
    posture: candidate.posture,
    confidence: candidate.confidence,
    components: candidate.components,
    diagnostics: candidate.diagnostics,
    identity: {
      status: candidate.input.identityStatus,
      manualReviewStatus: candidate.input.manualReviewStatus,
      provider: candidate.input.provider,
      providerPlayerId: candidate.input.providerPlayerId,
      gemRateSourceKey: candidate.input.gemRateSourceKey,
    },
    gates: candidate.gates,
    sensitivity: candidate.sensitivity,
    evidence: {
      marketHistoryMonths:
        candidate.diagnostics.monthlySalesUsd.filter(
          (amount) => amount !== null,
        ).length,
      requiredMarketHistoryMonths: HOBBY_PLAYER_RANKING_HISTORY_MONTHS,
      rankWithinSportOnly: true,
      ageIncludedInScore: false,
      momentumCanOnlyPenalize: true,
      exactCardPricingAvailable: false,
      populationDataAvailable: false,
      expectedReturnValidated: false,
      evidenceYears: candidate.input.evidenceYears,
      evidenceStage: candidate.input.evidenceStage,
      evidenceBasis: candidate.input.evidenceBasis,
      careerStartYear: candidate.input.careerStartYear,
      firstGradedYear: candidate.input.firstGradedYear,
      mostGradedYear: candidate.input.mostGradedYear,
      jointHeat:
        candidate.components.outlook >= 80 &&
        candidate.components.volumePercentile >= 80,
      concentrationReview:
        candidate.diagnostics.concentrationPercentile > 90,
    },
    sources: confidenceSources(candidate.input.sport, source, freshness),
    formulaVersion: HOBBY_PLAYER_RANKINGS_MODEL_VERSION,
  }
}

export function buildHobbyPlayerRankingCatalog(
  exchangeValue: unknown = checklistSignalsJson,
  identityReviewValue: unknown = identityReviewJson,
  now = new Date(),
  identityControlsValue: unknown = identityControlsJson,
): HobbyPlayerRankingCatalog {
  const exchange = parseHobbyPlayerSignalExchange(exchangeValue)
  const review = parseHobbyPlayerIdentityReview(identityReviewValue)
  const controls = parseHobbyPlayerIdentityControls(identityControlsValue)
  const reviewByKey = new Map(
    review.entries.map((entry) => [
      identityReviewKey(entry.sport, entry.providerPlayerId),
      entry,
    ]),
  )
  const marketRows = magnificentXCatalog.snapshot.rows.filter(
    (row): row is MagnificentXSourceRow =>
      row.subjectType === 'athlete' &&
      (row.domain === 'football' || row.domain === 'basketball'),
  )
  const marketRowsSha256 = createHash('sha256')
    .update(stableJson(marketRows))
    .digest('hex')
  const providerGroups = uniqueGroups(
    exchange.rows,
    (row) => `${row.sport}|${row.normalizedName}`,
  )
  const marketGroups = uniqueGroups(
    marketRows,
    (row) => `${row.domain}|${row.normalizedName}`,
  )
  const declaredAmbiguousMarket = new Set(
    magnificentXCatalog.snapshot.metadata.ambiguousWithinCohortNames.map(
      (entry) => `${entry.domain}|${entry.normalizedName}`,
    ),
  )
  assertIdentityControlsResolve(
    controls,
    exchange,
    marketRows,
    marketGroups,
    declaredAmbiguousMarket,
  )
  const marketBySourceKey = new Map(
    marketRows.map((row) => [row.sourceKey, row]),
  )
  const aliasesByKey = new Map(
    controls.aliases.map((entry) => [
      identityReviewKey(entry.sport, entry.providerPlayerId),
      entry,
    ]),
  )
  const blocksByKey = new Map(
    controls.blocks.map((entry) => [
      identityReviewKey(entry.sport, entry.providerPlayerId),
      entry,
    ]),
  )
  const volumePercentiles = {
    trailingTwelve: new Map<string, number>(),
    recentSix: new Map<string, number>(),
    fullHistory: new Map<string, number>(),
  }
  for (const sport of ['football', 'basketball'] as const) {
    const cohort = marketRows.filter(
      (row) =>
        row.domain === sport &&
        !declaredAmbiguousMarket.has(`${sport}|${row.normalizedName}`) &&
        marketGroups.get(`${sport}|${row.normalizedName}`)?.length === 1,
    )
    for (const [map, metric] of [
      [volumePercentiles.trailingTwelve, trailingTwelveSales],
      [volumePercentiles.recentSix, recentSixMonthSales],
      [volumePercentiles.fullHistory, fullHistorySales],
    ] as const) {
      for (const [sourceKey, percentile] of midrankPercentiles(
        cohort,
        metric,
        (row) => row.sourceKey,
      )) {
        map.set(sourceKey, percentile)
      }
    }
  }

  const freshnessBySport = Object.fromEntries(
    (['football', 'basketball'] as const).map((sport) => {
      const source = sourceForSport(exchange, sport)
      return [
        sport,
        combinedFreshness(sport, source, now, {
          exchangeGeneratedAt: exchange.generatedAt,
          identityReviewReviewedAt: review.reviewedAt,
          identityControlsReviewedAt: controls.reviewedAt,
        }),
      ]
    }),
  ) as Record<HobbyPlayerRankingSport, SportFreshness>
  const percentileMapsBySport = providerPercentileMaps(exchange)
  const candidates: HobbyPlayerRankingCandidateInput[] = []
  const quarantineBySport: Record<
    HobbyPlayerRankingSport,
    QuarantineSummary
  > = {
    football: emptyQuarantine(),
    basketball: emptyQuarantine(),
  }

  for (const provider of exchange.rows) {
    const freshness = freshnessBySport[provider.sport]
    const joinKey = `${provider.sport}|${provider.normalizedName}`
    const controlKey = identityReviewKey(
      provider.sport,
      provider.providerPlayerId,
    )
    const quarantine = quarantineBySport[provider.sport]
    const alias = aliasesByKey.get(controlKey)
    if (blocksByKey.has(controlKey)) {
      quarantine.identityControlBlocked += 1
      continue
    }
    if (!alias && providerGroups.get(joinKey)?.length !== 1) {
      quarantine.ambiguousProviderIdentity += 1
      continue
    }
    const ageIsPlausible =
      provider.age !== null &&
      Number.isFinite(provider.age) &&
      provider.age >= 15 &&
      provider.age <= 60
    const invalidAge =
      provider.sport === 'basketball'
        ? !ageIsPlausible
        : (
            provider.age === null
              ? provider.careerStartYear === null
              : !ageIsPlausible
          )
    if (invalidAge) {
      quarantine.invalidAge += 1
      continue
    }
    const percentiles = providerPercentiles(
      provider,
      percentileMapsBySport[provider.sport],
    )
    if (!percentiles) {
      quarantine.incompleteProviderRanks += 1
      continue
    }
    let market: MagnificentXSourceRow | undefined
    if (alias) {
      market = marketBySourceKey.get(alias.gemRateSourceKey)
    } else {
      const marketMatches = marketGroups.get(joinKey) ?? []
      if (
        declaredAmbiguousMarket.has(joinKey) ||
        marketMatches.length > 1
      ) {
        quarantine.ambiguousMarketIdentity += 1
        continue
      }
      market = marketMatches[0]
    }
    if (!market) {
      quarantine.missingMarketMatch += 1
      continue
    }
    if (impossibleGradedChronology(
      provider,
      market,
      sourceForSport(exchange, provider.sport),
    )) {
      quarantine.impossibleGradedChronology += 1
      continue
    }
    const volumePercentile =
      volumePercentiles.trailingTwelve.get(market.sourceKey)
    const recentSixMonthVolumePercentile =
      volumePercentiles.recentSix.get(market.sourceKey)
    const fullHistoryVolumePercentile =
      volumePercentiles.fullHistory.get(market.sourceKey)
    if (
      volumePercentile === undefined ||
      recentSixMonthVolumePercentile === undefined ||
      fullHistoryVolumePercentile === undefined
    ) {
      quarantine.ambiguousMarketIdentity += 1
      continue
    }
    const manuallyReviewed =
      Boolean(alias) ||
      approvedIdentity(reviewByKey, provider, market)
    candidates.push({
      id: `${provider.sport}:${provider.providerPlayerId}`,
      name: provider.sourceDisplayName,
      normalizedName: provider.normalizedName,
      sport: provider.sport,
      age: provider.age,
      positions: [...provider.positions],
      primaryPosition: provider.positions[0] ?? '—',
      team: provider.team,
      provider:
        provider.sport === 'football'
          ? 'keeptradecut'
          : 'hashtag_basketball',
      providerPlayerId: provider.providerPlayerId,
      gemRateSourceKey: market.sourceKey,
      identityStatus: alias
        ? 'reviewed_alias'
        : manuallyReviewed
          ? 'reviewed_exact'
          : 'unique_normalized_name',
      providerPercentiles: percentiles,
      monthlySalesUsd: [...market.monthlySalesUsd],
      volumePercentile,
      recentSixMonthVolumePercentile,
      fullHistoryVolumePercentile,
      ...evidenceFor(provider),
      careerStartYear: provider.careerStartYear,
      firstGradedYear: market.firstGradedYear,
      mostGradedYear: market.mostGradedYear,
      marketFreshness: freshness.marketStatus,
      fundamentalsFreshness: freshness.fundamentalsStatus,
      manualReviewStatus: manuallyReviewed ? 'approved' : 'unreviewed',
    })
  }
  for (const quarantine of Object.values(quarantineBySport)) {
    quarantine.total =
      quarantine.ambiguousProviderIdentity +
      quarantine.ambiguousMarketIdentity +
      quarantine.missingMarketMatch +
      quarantine.incompleteProviderRanks +
      quarantine.invalidAge +
      quarantine.identityControlBlocked +
      quarantine.impossibleGradedChronology
  }
  const quarantine = emptyQuarantine()
  for (const key of [
    'ambiguousProviderIdentity',
    'ambiguousMarketIdentity',
    'missingMarketMatch',
    'incompleteProviderRanks',
    'invalidAge',
    'identityControlBlocked',
    'impossibleGradedChronology',
  ] as const) {
    quarantine[key] =
      quarantineBySport.football[key] +
      quarantineBySport.basketball[key]
  }
  quarantine.total =
    quarantineBySport.football.total +
    quarantineBySport.basketball.total

  const ranked = rankHobbyPlayerCandidates(candidates)
  const items = ranked.map((candidate) => candidateToItem(
    candidate,
    sourceForSport(exchange, candidate.input.sport),
    freshnessBySport[candidate.input.sport],
  ))
  const cohorts = (['football', 'basketball'] as const).map((sport) => {
    const cohort = freshnessBySport[sport].status === 'current'
      ? items.filter((item) => item.sport === sport)
      : []
    return {
      sport,
      rankedCount: cohort.length,
      buildCount: cohort.filter((item) => item.posture === 'Build').length,
      researchCount:
        cohort.filter((item) => item.posture === 'Research').length,
      watchCount: cohort.filter((item) => item.posture === 'Watch').length,
      deprioritizeCount: cohort.filter(
        (item) => item.posture === 'Deprioritize',
      ).length,
    }
  })
  const positionsBySport = Object.fromEntries(
    (['football', 'basketball'] as const).map((sport) => [
      sport,
      [...new Set(
        items
          .filter((item) => item.sport === sport)
          .flatMap((item) => item.positions),
      )].toSorted((left, right) => left.localeCompare(right, 'en-US')),
    ]),
  ) as Record<HobbyPlayerRankingSport, string[]>
  const ageRangeBySport = Object.fromEntries(
    (['football', 'basketball'] as const).map((sport) => {
      const ages = items
        .filter(
          (item) => item.sport === sport && item.age !== null,
        )
        .map((item) => item.age as number)
      return [
        sport,
        {
          minimum: Math.min(...ages),
          maximum: Math.max(...ages),
        },
      ]
    }),
  ) as HobbyPlayerRankingCatalog['ageRangeBySport']
  const coverageBySport = Object.fromEntries(
    (['football', 'basketball'] as const).map((sport) => {
      const sourceRows = exchange.rows.filter(
        (row) => row.sport === sport,
      ).length
      const rankedRows = items.filter((item) => item.sport === sport).length
      return [
        sport,
        {
          sourceRows,
          rankedRows,
          coveragePercent: round((rankedRows / sourceRows) * 100),
        },
      ]
    }),
  ) as Record<HobbyPlayerRankingSport, CoverageSummary>
  const controlsHash = createHash('sha256')
    .update(stableJson(controls))
    .digest('hex')
  const snapshotIdBySport = Object.fromEntries(
    (['football', 'basketball'] as const).map((sport) => [
      sport,
      `hobby-player-rankings/v2:${createHash('sha256')
        .update(JSON.stringify({
          sport,
          exchange: exchange.contentSha256,
          market: marketRowsSha256,
          model: HOBBY_PLAYER_RANKINGS_MODEL_VERSION,
          review: review.reviewedAt,
          identityControls: controlsHash,
          freshness: freshnessBySport[sport],
          quarantine: quarantineBySport[sport],
          coverage: coverageBySport[sport],
          ranked: items
            .filter((item) => item.sport === sport)
            .map((item) => [
              item.id,
              item.sportRank,
              item.score,
              item.posture,
              item.identity.status,
              item.identity.manualReviewStatus,
              item.evidence.evidenceYears,
            ]),
        }))
        .digest('hex')}`,
    ]),
  ) as Record<HobbyPlayerRankingSport, string>
  const snapshotGeneratedAt = [
    exchange.generatedAt,
    review.reviewedAt,
    controls.reviewedAt,
  ].toSorted().at(-1)!
  const snapshotAcquiredAt = [
    gemRateAthleteAcquiredAt(),
    ...exchange.sources.map((source) => source.fetchedAt),
  ].toSorted().at(-1)!
  return {
    exchange,
    items,
    freshnessBySport,
    snapshotIdBySport,
    cohorts,
    quarantine,
    quarantineBySport,
    coverageBySport,
    positionsBySport,
    ageRangeBySport,
    snapshotGeneratedAt,
    snapshotAcquiredAt,
  }
}

function rankComparator(
  left: HobbyPlayerRankingItem,
  right: HobbyPlayerRankingItem,
): number {
  return (
    right.score - left.score ||
    right.components.outlook - left.components.outlook ||
    right.components.marketDurability - left.components.marketDurability ||
    left.name.localeCompare(right.name, 'en-US')
  )
}

function displayComparator(
  sort: HobbyPlayerRankingSortKey,
): (left: HobbyPlayerRankingItem, right: HobbyPlayerRankingItem) => number {
  return (left, right) => {
    let comparison = 0
    switch (sort) {
      case 'rank':
      case 'score':
        comparison = rankComparator(left, right)
        break
      case 'outlook':
        comparison = right.components.outlook - left.components.outlook
        break
      case 'market_durability':
        comparison =
          right.components.marketDurability -
          left.components.marketDurability
        break
      case 'ttm_sales':
        comparison =
          right.diagnostics.trailingTwelveSalesUsd -
          left.diagnostics.trailingTwelveSalesUsd
        break
      case 'resilience':
        comparison =
          right.components.resilience - left.components.resilience
        break
      case 'divergence_penalty':
        comparison =
          left.components.divergencePenalty -
          right.components.divergencePenalty
        break
      case 'concentration':
        comparison =
          left.diagnostics.concentrationPercentile -
          right.diagnostics.concentrationPercentile
        break
      case 'attention_gap':
        comparison =
          left.diagnostics.adjustedAttentionGap -
          right.diagnostics.adjustedAttentionGap
        break
      case 'age':
        comparison =
          left.age === null
            ? right.age === null ? 0 : 1
            : right.age === null
              ? -1
              : left.age - right.age
        break
      case 'name':
        comparison = left.name.localeCompare(right.name, 'en-US')
        break
    }
    return comparison ||
      left.sportRank - right.sportRank ||
      left.name.localeCompare(right.name, 'en-US')
  }
}

export function buildHobbyPlayerRankingsFeed(
  catalog: HobbyPlayerRankingCatalog,
  query: HobbyPlayerRankingsQuery = {},
): HobbyPlayerRankingsResponse {
  const sport = query.sport ?? 'football'
  const freshness = catalog.freshnessBySport[sport]
  const maxAge = query.maxAge
  const position = query.position?.trim().toLocaleUpperCase('en-US')
  const posture = query.posture ?? 'all'
  const normalizedQuery = query.q?.trim().toLocaleLowerCase('en-US') ?? ''
  const sort = query.sort ?? 'score'
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const limit = Math.max(1, Math.min(100, Math.floor(query.limit ?? 50)))
  const publishable = freshness.status === 'current'
    ? catalog.items.filter((item) => item.sport === sport)
    : []
  const screened = publishable
    .filter((item) => (
      (
        maxAge === undefined ||
        (item.age !== null && item.age <= maxAge)
      ) &&
      (!position || item.positions.includes(position)) &&
      (posture === 'all' || item.posture === posture)
    ))
    .toSorted(rankComparator)
    .map((item, index) => ({ ...item, screenRank: index + 1 }))
  const filtered = screened
    .filter((item) => (
      normalizedQuery.length === 0 ||
      item.name.toLocaleLowerCase('en-US').includes(normalizedQuery)
    ))
    .toSorted(displayComparator(sort))
  const total = filtered.length
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit)
  const offset = (page - 1) * limit
  const source = sourceForSport(catalog.exchange, sport)
  const screenSummary = {
    rankedCount: filtered.length,
    buildCount:
      filtered.filter((item) => item.posture === 'Build').length,
    researchCount:
      filtered.filter((item) => item.posture === 'Research').length,
    watchCount:
      filtered.filter((item) => item.posture === 'Watch').length,
    deprioritizeCount:
      filtered.filter((item) => item.posture === 'Deprioritize').length,
  }
  return {
    schemaVersion: HOBBY_PLAYER_RANKINGS_FEED_SCHEMA_VERSION,
    contractVersion: HOBBY_PLAYER_RANKINGS_CONTRACT_VERSION,
    modelVersion: HOBBY_PLAYER_RANKINGS_MODEL_VERSION,
    snapshot: {
      id: catalog.snapshotIdBySport[sport],
      generatedAt: catalog.snapshotGeneratedAt,
      historyStart: `${magnificentXCatalog.snapshot.historyMonths[0]}-01`,
      historyMonths: HOBBY_PLAYER_RANKING_HISTORY_MONTHS,
      dataThrough: magnificentXCatalog.snapshot.dataThrough,
      publishedAt: magnificentXCatalog.snapshot.publishedAt,
      acquiredAt: catalog.snapshotAcquiredAt,
      freshness,
    },
    items: filtered.slice(offset, offset + limit),
    scope: {
      sport,
      screen: {
        maxAge: maxAge ?? null,
        position: position ?? null,
        posture,
      },
    },
    screenSummary,
    cohorts: catalog.cohorts,
    page: { page, limit, total, totalPages },
    meta: {
      researchOnly: true,
      investmentAdvice: false,
      expectedReturnClaim: false,
      rankingPolicy: 'within_sport_only',
      agePolicy:
        'not_a_positive_score_input_basketball_age_supplies_evidence_depth_gate',
      momentumPolicy: 'penalty_or_flag_only_never_positive_score_driver',
      marketMeasure: 'subject_level_completed_ebay_singles_sales_volume_usd',
      exactCardRecommendationsAvailable: false,
      populationDataAvailable: false,
      outcomeValidationStatus: 'not_yet_outcome_validated',
      methodology: {
        formulas: {
          outlookFootball:
            '0.60 × min(empirical 1QB percentile, empirical Superflex percentile) + 0.40 × geometric mean',
          outlookBasketball:
            '0.75 × empirical five-season percentile + 0.25 × empirical keeper percentile',
          resilience:
            '100 × (0.50 positive-month ratio + 0.30 observed-history ratio + 0.20 lower-quartile / median)',
          marketDurability:
            '0.70 × TTM sport-volume percentile + 0.15 × resilience + 0.10 × shock resistance + 0.05 × downside-only trend context',
          attentionGap:
            'TTM sport-volume percentile − player outlook, adjusted against the position median when that cohort is sufficiently populated',
          divergencePenalty:
            'min(12, 0.25 × max(0, adjusted attention gap − 15) + 0.10 × max(0, acceleration context − 80))',
          durableScore:
            '0.60 × weak link + 0.40 × geometric mean − divergence penalty',
          sensitivity:
            'seven within-sport variants: balanced, outlook-heavy, market-heavy, recent-six-month market, full-18-month market, primary format, and secondary format; Build must remain top 5% in all seven',
          age:
            'never a positive score input; football may publish null age when a valid draft year exists, while basketball age supplies only a conservative evidence-depth proxy',
          evidenceDepth:
            'football completed evidence years = max(0, data-through year − NFL draft year); basketball proxy = max(0, floor(age − 19)); Build requires at least two',
          concentration:
            'TTM monthly sales HHI is converted to a within-sport concentration percentile; Build requires percentile ≤90',
        },
        buildGate:
          'Build requires Score ≥82, Outlook ≥80, Durability ≥75, TTM volume percentile ≥65, divergence penalty <4, sport top 5%, current sources, all 18 months, a valid and manually reviewed identity bridge, top-5% placement in all seven sensitivity scenarios, at least two evidence years, and concentration at or below sport P90.',
      },
      quarantine: catalog.quarantineBySport[sport],
      globalQuarantine: catalog.quarantine,
      coverage: catalog.coverageBySport[sport],
      availableFilters: {
        sports: ['football', 'basketball'],
        postures: [...HOBBY_PLAYER_RANKING_POSTURES],
        sortKeys: [...HOBBY_PLAYER_RANKING_SORT_KEYS],
        positionsBySport: catalog.positionsBySport,
        ageRange: catalog.ageRangeBySport[sport],
      },
      provenance: [
        {
          id: 'gemrate',
          label: 'GemRate',
          url: 'https://www.gemrate.com/sales-trends',
          permissionBasis: 'licensed_user_provided_permission',
          asOf: magnificentXCatalog.snapshot.dataThrough,
          fetchedAt: gemRateAthleteAcquiredAt(),
          semantics: 'completed eBay singles sales dollars by subject',
        },
        sport === 'football'
          ? {
              id: 'keeptradecut',
              label: source.provider,
              url: source.sourceUrl,
              permissionBasis: source.rights.productionUse,
              asOf: source.sourceUpdatedAt ?? source.fetchedAt,
              fetchedAt: source.fetchedAt,
              semantics: source.semantics,
            }
          : {
              id: 'hashtag_basketball',
              label: source.provider,
              url: source.sourceUrl,
              permissionBasis:
                'owner_directed_existing_production_use_provisional',
              asOf: source.sourceUpdatedAt ?? source.fetchedAt,
              fetchedAt: source.fetchedAt,
              semantics: source.semantics,
            },
      ],
      permissionAttestation: 'docs/permissions/GEMRATE_ATTESTATION.md',
    },
  }
}

export const hobbyPlayerRankingSports:
  readonly HobbyPlayerRankingSport[] = ['football', 'basketball']
export const hobbyPlayerRankingPostures:
  readonly HobbyPlayerRankingPosture[] = HOBBY_PLAYER_RANKING_POSTURES
export const hobbyPlayerRankingSortKeys:
  readonly HobbyPlayerRankingSortKey[] = HOBBY_PLAYER_RANKING_SORT_KEYS

export const hobbyPlayerRankingCatalog =
  buildHobbyPlayerRankingCatalog()
