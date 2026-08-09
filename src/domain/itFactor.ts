export const IT_FACTOR_SCHEMA_VERSION = 'backstop-it-factor-board.v1' as const
export const IT_FACTOR_METHOD_VERSION = 'it-factor/editorial-v1.0.0' as const
export const IT_FACTOR_BADGE_SCHEMA_VERSION =
  'backstop-it-factor-badges.v1' as const

export const IT_FACTOR_SPORTS = [
  'baseball',
  'football',
  'basketball',
  'hockey',
] as const

export const IT_FACTOR_TIERS = [
  'icon',
  'high',
  'emerging',
  'watch',
] as const

export const IT_FACTOR_STATUSES = [
  'prospect',
  'rookie',
  'young_star',
  'established_star',
] as const

export const IT_FACTOR_TRAJECTORIES = [
  'rising',
  'holding',
  'fragile',
] as const

export const IT_FACTOR_MARKET_EVIDENCE = [
  'confirmed',
  'forming',
  'thin',
  'not_observed',
] as const

export const IT_FACTOR_MARKET_IDENTITY_STATUSES = [
  'exact',
  'normalized',
  'ambiguous',
  'not_found',
] as const

export const IT_FACTOR_SOURCE_KINDS = [
  'official',
  'consensus',
  'scouting',
  'hobby_market',
  'news',
] as const

export type ItFactorSport = (typeof IT_FACTOR_SPORTS)[number]
export type ItFactorTier = (typeof IT_FACTOR_TIERS)[number]

export const IT_FACTOR_TIER_SCORE_RANGES: Record<
  ItFactorTier,
  { minimum: number; maximum: number }
> = {
  icon: { minimum: 92, maximum: 100 },
  high: { minimum: 84, maximum: 91 },
  emerging: { minimum: 74, maximum: 83 },
  watch: { minimum: 60, maximum: 73 },
}
export type ItFactorStatus = (typeof IT_FACTOR_STATUSES)[number]
export type ItFactorTrajectory = (typeof IT_FACTOR_TRAJECTORIES)[number]
export type ItFactorMarketEvidence =
  (typeof IT_FACTOR_MARKET_EVIDENCE)[number]

export interface ItFactorSource {
  id: string
  label: string
  publisher: string
  url: string
  publishedAt: string | null
  accessedAt: string
  kind:
    | 'official'
    | 'consensus'
    | 'scouting'
    | 'hobby_market'
    | 'news'
}

export interface ItFactorEntry {
  id: string
  player: {
    name: string
    normalizedName: string
    position: string
    status: ItFactorStatus
  }
  sport: ItFactorSport
  league: 'MLB' | 'NFL' | 'NBA' | 'NHL'
  team: {
    code: string
    name: string
  }
  score: number
  tier: ItFactorTier
  confidence: number
  trajectory: ItFactorTrajectory
  rationale: string
  signals: string[]
  recheckTriggers: string[]
  sourceIds: string[]
  market: {
    evidence: ItFactorMarketEvidence
    sourceKey: string | null
    sourceName: string | null
    identityStatus: 'exact' | 'normalized' | 'ambiguous' | 'not_found'
    trailingTwelveMonthSalesUsd: number | null
    recentSixMonthSalesUsd: number | null
    priorSixMonthSalesUsd: number | null
    sportRank: number | null
    sportPercentile: number | null
  }
  lastReviewedAt: string
}

export interface ItFactorBadgeEntry {
  id: string
  sport: ItFactorSport
  player: {
    name: string
    normalizedName: string
  }
  score: number
  tier: ItFactorTier
  confidence: number
}

export interface ItFactorBadgeIndex {
  schemaVersion: typeof IT_FACTOR_BADGE_SCHEMA_VERSION
  snapshotAsOf: string
  entries: ItFactorBadgeEntry[]
}

export interface ItFactorBoardResponse {
  schemaVersion: typeof IT_FACTOR_SCHEMA_VERSION
  methodVersion: typeof IT_FACTOR_METHOD_VERSION
  snapshot: {
    asOf: string
    generatedAt: string
    marketDataThrough: string
    marketRowsSha256: string
    nextReviewBy: string
    status: 'current' | 'review_due'
  }
  rubric: {
    definition: string
    scoreInterpretation: string
    confidenceInterpretation: string
    tierThresholds: Record<ItFactorTier, string>
    scoreInputs: string[]
  }
  sources: ItFactorSource[]
  entries: ItFactorEntry[]
  coverage: {
    teamCount: number
    entryCount: number
    bySport: Record<ItFactorSport, {
      teamCount: number
      entryCount: number
    }>
  }
}

function finiteScore(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  )
}

function nonNegativeNumberOrNull(value: unknown): boolean {
  return value === null || (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
  )
}

function nonBlankStrings(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every((item) => (
      typeof item === 'string' && item.trim().length > 0
    ))
  )
}

export function normalizeItFactorName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/\b(jr|sr)\b\.?/gu, ' $1 ')
    .replace(/[^a-z0-9]+/gu, ' ')
    .replace(/\b([a-z])\s+([a-z])\b/gu, '$1$2')
    .trim()
    .replace(/\s+/gu, ' ')
}

export function isItFactorScoreInTier(
  score: number,
  tier: ItFactorTier,
): boolean {
  const range = IT_FACTOR_TIER_SCORE_RANGES[tier]
  return score >= range.minimum && score <= range.maximum
}

export function isItFactorBoardResponse(
  value: unknown,
): value is ItFactorBoardResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ItFactorBoardResponse>
  if (
    candidate.schemaVersion !== IT_FACTOR_SCHEMA_VERSION ||
    candidate.methodVersion !== IT_FACTOR_METHOD_VERSION ||
    !candidate.snapshot ||
    !candidate.rubric ||
    !candidate.coverage ||
    !Array.isArray(candidate.sources) ||
    !Array.isArray(candidate.entries)
  ) {
    return false
  }
  const snapshot = candidate.snapshot
  const rubric = candidate.rubric
  const coverage = candidate.coverage
  const sources = candidate.sources
  const entries = candidate.entries
  if (
    typeof snapshot.asOf !== 'string' ||
    typeof snapshot.generatedAt !== 'string' ||
    typeof snapshot.marketDataThrough !== 'string' ||
    typeof snapshot.marketRowsSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(snapshot.marketRowsSha256) ||
    typeof snapshot.nextReviewBy !== 'string' ||
    (
      snapshot.status !== 'current' &&
      snapshot.status !== 'review_due'
    ) ||
    typeof rubric.definition !== 'string' ||
    typeof rubric.scoreInterpretation !== 'string' ||
    typeof rubric.confidenceInterpretation !== 'string' ||
    !nonBlankStrings(rubric.scoreInputs, 1, 10)
  ) {
    return false
  }
  const sourceIds = new Set<string>()
  const sourceUrls = new Set<string>()
  for (const source of sources) {
    if (
      !source ||
      typeof source.id !== 'string' ||
      !source.id ||
      typeof source.label !== 'string' ||
      !source.label.trim() ||
      typeof source.publisher !== 'string' ||
      !source.publisher.trim() ||
      typeof source.url !== 'string' ||
      !source.url.startsWith('https://') ||
      typeof source.accessedAt !== 'string' ||
      !IT_FACTOR_SOURCE_KINDS.includes(source.kind) ||
      (
        source.publishedAt !== null &&
        typeof source.publishedAt !== 'string'
      ) ||
      sourceIds.has(source.id) ||
      sourceUrls.has(source.url)
    ) {
      return false
    }
    sourceIds.add(source.id)
    sourceUrls.add(source.url)
  }
  const entryIds = new Set<string>()
  const playerKeys = new Set<string>()
  const leagueBySport: Record<ItFactorSport, ItFactorEntry['league']> = {
    baseball: 'MLB',
    football: 'NFL',
    basketball: 'NBA',
    hockey: 'NHL',
  }
  for (const entry of entries) {
    if (!entry?.player || !entry.team || !entry.market) return false
    const playerKey = `${entry.sport}:${entry.player.normalizedName}`
    if (
      typeof entry.id !== 'string' ||
      !entry.id ||
      entryIds.has(entry.id) ||
      typeof entry.player.name !== 'string' ||
      !entry.player.name ||
      entry.player.normalizedName !==
        normalizeItFactorName(entry.player.name) ||
      playerKeys.has(playerKey) ||
      !IT_FACTOR_SPORTS.includes(entry.sport) ||
      entry.league !== leagueBySport[entry.sport] ||
      !entry.team.code ||
      !entry.team.name ||
      !IT_FACTOR_STATUSES.includes(entry.player.status) ||
      !IT_FACTOR_TIERS.includes(entry.tier) ||
      !IT_FACTOR_TRAJECTORIES.includes(entry.trajectory) ||
      !finiteScore(entry.score) ||
      !isItFactorScoreInTier(entry.score, entry.tier) ||
      !finiteScore(entry.confidence) ||
      entry.confidence < 50 ||
      typeof entry.rationale !== 'string' ||
      entry.rationale.length < 45 ||
      !nonBlankStrings(entry.signals, 2, 6) ||
      !nonBlankStrings(entry.recheckTriggers, 1, 4) ||
      !nonBlankStrings(entry.sourceIds, 2, Number.MAX_SAFE_INTEGER) ||
      !entry.sourceIds.every((sourceId) => sourceIds.has(sourceId)) ||
      !IT_FACTOR_MARKET_EVIDENCE.includes(entry.market.evidence) ||
      (
        entry.market.sourceKey !== null &&
        (
          typeof entry.market.sourceKey !== 'string' ||
          !entry.market.sourceKey.trim()
        )
      ) ||
      !IT_FACTOR_MARKET_IDENTITY_STATUSES.includes(
        entry.market.identityStatus,
      ) ||
      (
        (
          entry.market.identityStatus === 'exact' ||
          entry.market.identityStatus === 'normalized'
        ) !== (entry.market.sourceKey !== null)
      ) ||
      !nonNegativeNumberOrNull(
        entry.market.trailingTwelveMonthSalesUsd,
      ) ||
      !nonNegativeNumberOrNull(entry.market.recentSixMonthSalesUsd) ||
      !nonNegativeNumberOrNull(entry.market.priorSixMonthSalesUsd) ||
      !nonNegativeNumberOrNull(entry.market.sportRank) ||
      !nonNegativeNumberOrNull(entry.market.sportPercentile) ||
      (
        entry.market.sportRank !== null &&
        (
          !Number.isInteger(entry.market.sportRank) ||
          entry.market.sportRank < 1
        )
      ) ||
      (
        entry.market.sportPercentile !== null &&
        entry.market.sportPercentile > 100
      ) ||
      typeof entry.lastReviewedAt !== 'string'
    ) {
      return false
    }
    entryIds.add(entry.id)
    playerKeys.add(playerKey)
  }
  const coverageTeamCount = new Set(
    entries.map((entry) => `${entry.sport}:${entry.team.code}`),
  ).size
  if (
    coverage.teamCount !== coverageTeamCount ||
    coverage.entryCount !== entries.length
  ) {
    return false
  }
  return IT_FACTOR_SPORTS.every((sport) => {
    const sportEntries = entries.filter((entry) => (
      entry.sport === sport
    ))
    const sportCoverage = coverage.bySport?.[sport]
    const teamCounts = new Map<string, number>()
    for (const entry of sportEntries) {
      teamCounts.set(
        entry.team.code,
        (teamCounts.get(entry.team.code) ?? 0) + 1,
      )
    }
    return (
      sportCoverage?.entryCount === sportEntries.length &&
      sportCoverage.teamCount ===
        teamCounts.size &&
      [...teamCounts.values()].every((count) => count >= 1 && count <= 3)
    )
  })
}

export function isItFactorBadgeIndex(
  value: unknown,
): value is ItFactorBadgeIndex {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ItFactorBadgeIndex>
  return (
    candidate.schemaVersion === IT_FACTOR_BADGE_SCHEMA_VERSION &&
    typeof candidate.snapshotAsOf === 'string' &&
    Array.isArray(candidate.entries) &&
    candidate.entries.every((entry) => (
      typeof entry?.id === 'string' &&
      IT_FACTOR_SPORTS.includes(entry.sport) &&
      typeof entry.player?.name === 'string' &&
      entry.player.normalizedName ===
        normalizeItFactorName(entry.player.name) &&
      finiteScore(entry.score) &&
      IT_FACTOR_TIERS.includes(entry.tier) &&
      isItFactorScoreInTier(entry.score, entry.tier) &&
      finiteScore(entry.confidence)
    ))
  )
}

export function findItFactorEntry<T extends ItFactorBadgeEntry>(
  entries: readonly T[],
  sport: ItFactorSport,
  playerName: string,
): T | null {
  const normalizedName = normalizeItFactorName(playerName)
  return entries.find((entry) => (
    entry.sport === sport &&
    entry.player.normalizedName === normalizedName
  )) ?? null
}

export function filterItFactorEntries(
  entries: readonly ItFactorEntry[],
  search: string,
): ItFactorEntry[] {
  const normalizedSearch = normalizeItFactorName(search)
  if (!normalizedSearch) return [...entries]
  return entries.filter((entry) => (
    entry.player.normalizedName.includes(normalizedSearch) ||
    normalizeItFactorName(entry.team.name).includes(normalizedSearch) ||
    entry.team.code.toLocaleLowerCase('en-US').includes(normalizedSearch) ||
    entry.league.toLocaleLowerCase('en-US').includes(normalizedSearch)
  ))
}
