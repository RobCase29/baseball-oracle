import { createHash } from 'node:crypto'
import checklistSignalsJson from './_data/checklist-hobby-player-signals.json' with { type: 'json' }
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

const EXCHANGE_SCHEMA_VERSION = 'backstop-hobby-player-signals.v1' as const
const IDENTITY_REVIEW_SCHEMA_VERSION =
  'hobby-player-identity-review.v1' as const
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

interface QuarantineSummary {
  total: number
  ambiguousProviderIdentity: number
  ambiguousMarketIdentity: number
  missingMarketMatch: number
  incompleteProviderRanks: number
  invalidAge: number
}

interface SportFreshness {
  status: HobbyPlayerRankingFreshnessStatus
  marketStatus: HobbyPlayerRankingFreshnessStatus
  fundamentalsStatus: HobbyPlayerRankingFreshnessStatus
  nextExpectedBy: string
  reasonCodes: string[]
}

export interface HobbyPlayerRankingCatalog {
  exchange: ExchangeArtifact
  items: HobbyPlayerRankingItem[]
  freshnessBySport: Record<HobbyPlayerRankingSport, SportFreshness>
  snapshotIdBySport: Record<HobbyPlayerRankingSport, string>
  cohorts: HobbyPlayerRankingsResponse['cohorts']
  quarantine: QuarantineSummary
  positionsBySport: Record<HobbyPlayerRankingSport, string[]>
  ageRange: {
    minimum: number
    maximum: number
  }
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
    typeof exchange.contractVersion !== 'string' ||
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

function addDays(value: string, days: number): string {
  const parsed = new Date(value)
  return new Date(
    parsed.valueOf() + days * 24 * 60 * 60 * 1_000,
  ).toISOString()
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
): SportFreshness {
  const market = magnificentXFreshness(
    magnificentXCatalog.snapshot.dataThrough,
    now,
  )
  const fundamentals = fundamentalsFreshness(source, now)
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
  const gemRateSource = magnificentXCatalog.snapshot.sources.find(
    (entry) =>
      entry.subjectType === 'athlete' && entry.editionYear === 2026,
  )
  if (!gemRateSource) throw new Error('GemRate athlete source is missing')
  return [
    {
      id: 'gemrate',
      label: 'GemRate',
      url: 'https://www.gemrate.com/sales-trends',
      asOf: magnificentXCatalog.snapshot.dataThrough,
      fetchedAt: gemRateSource.acquiredAt,
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
    recordVersion: 'hobby-player-ranking-item/v1',
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
      status: 'unique_exact',
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
    },
    sources: confidenceSources(candidate.input.sport, source, freshness),
    formulaVersion: HOBBY_PLAYER_RANKINGS_MODEL_VERSION,
  }
}

export function buildHobbyPlayerRankingCatalog(
  exchangeValue: unknown = checklistSignalsJson,
  identityReviewValue: unknown = identityReviewJson,
  now = new Date(),
): HobbyPlayerRankingCatalog {
  const exchange = parseHobbyPlayerSignalExchange(exchangeValue)
  const review = parseHobbyPlayerIdentityReview(identityReviewValue)
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
  const volumePercentiles = new Map<string, number>()
  for (const sport of ['football', 'basketball'] as const) {
    const cohort = marketRows.filter(
      (row) =>
        row.domain === sport &&
        !declaredAmbiguousMarket.has(`${sport}|${row.normalizedName}`) &&
        marketGroups.get(`${sport}|${row.normalizedName}`)?.length === 1,
    )
    for (const [sourceKey, percentile] of midrankPercentiles(
      cohort,
      trailingTwelveSales,
      (row) => row.sourceKey,
    )) {
      volumePercentiles.set(sourceKey, percentile)
    }
  }

  const freshnessBySport = Object.fromEntries(
    (['football', 'basketball'] as const).map((sport) => {
      const source = sourceForSport(exchange, sport)
      return [sport, combinedFreshness(sport, source, now)]
    }),
  ) as Record<HobbyPlayerRankingSport, SportFreshness>
  const percentileMapsBySport = providerPercentileMaps(exchange)
  const candidates: HobbyPlayerRankingCandidateInput[] = []
  const quarantine: QuarantineSummary = {
    total: 0,
    ambiguousProviderIdentity: 0,
    ambiguousMarketIdentity: 0,
    missingMarketMatch: 0,
    incompleteProviderRanks: 0,
    invalidAge: 0,
  }

  for (const provider of exchange.rows) {
    const freshness = freshnessBySport[provider.sport]
    const joinKey = `${provider.sport}|${provider.normalizedName}`
    if (providerGroups.get(joinKey)?.length !== 1) {
      quarantine.ambiguousProviderIdentity += 1
      continue
    }
    if (
      provider.age === null ||
      !Number.isFinite(provider.age) ||
      provider.age < 15 ||
      provider.age > 60
    ) {
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
    const marketMatches = marketGroups.get(joinKey) ?? []
    if (
      declaredAmbiguousMarket.has(joinKey) ||
      marketMatches.length > 1
    ) {
      quarantine.ambiguousMarketIdentity += 1
      continue
    }
    const market = marketMatches[0]
    if (!market) {
      quarantine.missingMarketMatch += 1
      continue
    }
    const volumePercentile = volumePercentiles.get(market.sourceKey)
    if (volumePercentile === undefined) {
      quarantine.ambiguousMarketIdentity += 1
      continue
    }
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
      providerPercentiles: percentiles,
      monthlySalesUsd: [...market.monthlySalesUsd],
      volumePercentile,
      marketFreshness: freshness.marketStatus,
      fundamentalsFreshness: freshness.fundamentalsStatus,
      manualReviewStatus: approvedIdentity(
        reviewByKey,
        provider,
        market,
      )
        ? 'approved'
        : 'unreviewed',
    })
  }
  quarantine.total =
    quarantine.ambiguousProviderIdentity +
    quarantine.ambiguousMarketIdentity +
    quarantine.missingMarketMatch +
    quarantine.incompleteProviderRanks +
    quarantine.invalidAge

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
      holdCount: cohort.filter((item) => item.posture === 'Hold').length,
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
  const ages = items.map((item) => item.age)
  const snapshotIdBySport = Object.fromEntries(
    (['football', 'basketball'] as const).map((sport) => [
      sport,
      `hobby-player-rankings/v1:${createHash('sha256')
        .update(JSON.stringify({
          sport,
          exchange: exchange.contentSha256,
          market: magnificentXCatalog.snapshot.rowsSha256,
          model: HOBBY_PLAYER_RANKINGS_MODEL_VERSION,
          review: review.reviewedAt,
          freshness: freshnessBySport[sport],
          ranked: items
            .filter((item) => item.sport === sport)
            .map((item) => [
              item.id,
              item.sportRank,
              item.score,
              item.posture,
              item.identity.manualReviewStatus,
            ]),
        }))
        .digest('hex')}`,
    ]),
  ) as Record<HobbyPlayerRankingSport, string>
  return {
    exchange,
    items,
    freshnessBySport,
    snapshotIdBySport,
    cohorts,
    quarantine,
    positionsBySport,
    ageRange: {
      minimum: Math.min(...ages),
      maximum: Math.max(...ages),
    },
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
      case 'hype_penalty':
        comparison =
          left.components.hypePenalty - right.components.hypePenalty
        break
      case 'attention_gap':
        comparison =
          left.diagnostics.attentionGap - right.diagnostics.attentionGap
        break
      case 'age':
        comparison = left.age - right.age
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
      (maxAge === undefined || item.age <= maxAge) &&
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
  return {
    schemaVersion: HOBBY_PLAYER_RANKINGS_FEED_SCHEMA_VERSION,
    contractVersion: HOBBY_PLAYER_RANKINGS_CONTRACT_VERSION,
    modelVersion: HOBBY_PLAYER_RANKINGS_MODEL_VERSION,
    snapshot: {
      id: catalog.snapshotIdBySport[sport],
      generatedAt: catalog.exchange.generatedAt,
      historyStart: `${magnificentXCatalog.snapshot.historyMonths[0]}-01`,
      historyMonths: HOBBY_PLAYER_RANKING_HISTORY_MONTHS,
      dataThrough: magnificentXCatalog.snapshot.dataThrough,
      publishedAt: magnificentXCatalog.snapshot.publishedAt,
      acquiredAt: [
        magnificentXCatalog.snapshot.acquiredAt,
        source.fetchedAt,
      ].toSorted().at(-1)!,
      freshness,
    },
    items: filtered.slice(offset, offset + limit),
    cohorts: catalog.cohorts,
    page: { page, limit, total, totalPages },
    meta: {
      researchOnly: true,
      investmentAdvice: false,
      expectedReturnClaim: false,
      rankingPolicy: 'within_sport_only',
      agePolicy: 'display_and_filter_only_not_scored',
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
            '0.70 × TTM sport-volume percentile + 0.25 × resilience + 0.05 × downside-only trend context',
          attentionGap: 'TTM sport-volume percentile − player outlook',
          hypePenalty:
            'min(12, 0.25 × max(0, attention gap − 15) + 0.10 × max(0, acceleration context − 80))',
          durableScore:
            '0.60 × weak link + 0.40 × geometric mean − hype penalty',
          sensitivity:
            'balanced plus outlook-heavy and market-heavy weak-link variants; Build must remain top decile in all three',
          age:
            'required display/filter field; excluded from score to avoid double-counting dynasty runway',
        },
        buildGate:
          'Build requires Score ≥82, Outlook ≥80, Durability ≥75, Volume pct ≥65, Resilience ≥70, Hype <4, sport top 5%, current sources, all 18 months, unique reviewed identity, and sensitivity-stable top decile.',
      },
      quarantine: catalog.quarantine,
      availableFilters: {
        sports: ['football', 'basketball'],
        postures: [...HOBBY_PLAYER_RANKING_POSTURES],
        sortKeys: [...HOBBY_PLAYER_RANKING_SORT_KEYS],
        positionsBySport: catalog.positionsBySport,
        ageRange: catalog.ageRange,
      },
      provenance: [
        {
          id: 'gemrate',
          label: 'GemRate',
          url: 'https://www.gemrate.com/sales-trends',
          permissionBasis: 'licensed_user_provided_permission',
          asOf: magnificentXCatalog.snapshot.dataThrough,
          fetchedAt: magnificentXCatalog.snapshot.acquiredAt,
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
