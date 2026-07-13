import type {
  PlayerRecord,
  PlayerStage,
  PlayerType,
} from '../domain/forecast'

export const WATCHLIST_STORAGE_KEY = 'baseball-oracle.real-watchlist.v4'
export const LEGACY_WATCHLIST_STORAGE_KEY = 'baseball-oracle.real-watchlist.v3'
export const WATCHLIST_FETCH_BATCH_SIZE = 50

interface SavedPlayerIdentity {
  id: string
  name: string
  playerType: PlayerType
  stage: PlayerStage
  organization: string | null
  organizationCode: string | null
  position: string | null
  age: number | null
  level: string | null
  externalIds: Record<string, string | number | null>
}

interface StoredWatchlist {
  version: 4
  items: SavedPlayerIdentity[]
}

const playerTypes = new Set<PlayerType>(['Hitter', 'Pitcher', 'Two-way'])
const playerStages = new Set<PlayerStage>([
  'pre_debut',
  'early_mlb',
  'established_mlb',
  'inactive',
])

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function savedExternalIds(value: unknown): Record<string, string | number | null> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string | number | null] =>
        entry[1] === null || typeof entry[1] === 'string' || typeof entry[1] === 'number',
    ),
  )
}

function savedIdentity(value: unknown): SavedPlayerIdentity | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const id = nullableString(input.id)
  const name = nullableString(input.name)
  if (!id || !name || !playerTypes.has(input.playerType as PlayerType)) return null

  return {
    id,
    name,
    playerType: input.playerType as PlayerType,
    stage: playerStages.has(input.stage as PlayerStage)
      ? input.stage as PlayerStage
      : 'pre_debut',
    organization: nullableString(input.organization),
    organizationCode: nullableString(input.organizationCode),
    position: nullableString(input.position),
    age: nullableNumber(input.age),
    level: nullableString(input.level),
    externalIds: savedExternalIds(input.externalIds),
  }
}

function identityFromPlayer(player: PlayerRecord): SavedPlayerIdentity {
  return {
    id: player.id,
    name: player.name,
    playerType: player.playerType,
    stage: player.stage,
    organization: player.organization,
    organizationCode: player.organizationCode,
    position: player.position,
    age: player.age,
    level: player.level,
    externalIds: player.provenance.externalIds,
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean)
  const selected = parts.length > 1 ? [parts[0], parts.at(-1)] : parts
  return selected
    .map((part) => Array.from(part ?? '')[0] ?? '')
    .join('')
    .toLocaleUpperCase('en-US')
}

function placeholder(identity: SavedPlayerIdentity): PlayerRecord {
  const { externalIds, ...context } = identity
  return {
    ...context,
    initials: initials(identity.name),
    batsThrows: null,
    psScore: null,
    psPercentile: null,
    agePercentile: null,
    opportunity: null,
    metrics: [],
    coverage: {
      label: 'Saved player; current data is temporarily unavailable',
      hasStatcast: false,
      hasTraditional: false,
      hasComplementaryRows: false,
      levelsObserved: identity.level ? [identity.level] : [],
      sourceVariants: [],
      organizationConflict: false,
      cohortMismatch: false,
    },
    provenance: {
      source: 'Baseball Oracle watchlist',
      dataset: 'Saved player identity',
      datasetKey: 'watchlist-v4',
      season: null,
      retrievedAt: null,
      cohort: null,
      externalIds,
    },
    researchEstimate: null,
    milbAlphaSignal: null,
    milbImpactRanking: null,
    minorTraitEvidence: null,
    careerForecast: null,
    playerMap: null,
  }
}

function storedWatchlist(raw: string | null): Map<string, PlayerRecord> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const input = parsed as Record<string, unknown>
    if (input.version !== 4 || !Array.isArray(input.items)) return null
    const identities = input.items
      .map(savedIdentity)
      .filter((entry): entry is SavedPlayerIdentity => entry !== null)
    return new Map(identities.map((identity) => [identity.id, placeholder(identity)]))
  } catch {
    return null
  }
}

function legacyPlayer(value: unknown): PlayerRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const identity = savedIdentity({
    ...input,
    externalIds: typeof input.provenance === 'object' && input.provenance !== null
      ? (input.provenance as Record<string, unknown>).externalIds
      : {},
  })
  const coverage = input.coverage
  const provenance = input.provenance
  if (
    !identity ||
    !('careerForecast' in input) ||
    !Array.isArray(input.metrics) ||
    typeof coverage !== 'object' || coverage === null ||
    !Array.isArray((coverage as Record<string, unknown>).levelsObserved) ||
    typeof provenance !== 'object' || provenance === null
  ) {
    return null
  }

  return {
    ...(input as unknown as PlayerRecord),
    stage: identity.stage,
    careerForecast: (input as unknown as PlayerRecord).careerForecast ?? null,
  }
}

function legacyWatchlist(raw: string | null): Map<string, PlayerRecord> {
  if (!raw) return new Map()
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Map()
    const players = parsed
      .map(legacyPlayer)
      .filter((entry): entry is PlayerRecord => entry !== null)
    return new Map(players.map((player) => [player.id, player]))
  } catch {
    return new Map()
  }
}

export function loadStoredWatchlist(
  currentRaw: string | null,
  legacyRaw: string | null,
): Map<string, PlayerRecord> {
  return storedWatchlist(currentRaw) ?? legacyWatchlist(legacyRaw)
}

export function serializeWatchlist(players: Iterable<PlayerRecord>): string {
  const stored: StoredWatchlist = {
    version: 4,
    items: Array.from(players, identityFromPlayer),
  }
  return JSON.stringify(stored)
}

export function watchlistIdBatches(
  ids: Iterable<string>,
  batchSize = WATCHLIST_FETCH_BATCH_SIZE,
): string[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Watchlist batch size must be a positive integer')
  }
  const uniqueIds = [...new Set(ids)]
  const batches: string[][] = []
  for (let offset = 0; offset < uniqueIds.length; offset += batchSize) {
    batches.push(uniqueIds.slice(offset, offset + batchSize))
  }
  return batches
}

export function mergeRefreshedWatchlist(
  current: Map<string, PlayerRecord>,
  refreshed: Iterable<PlayerRecord>,
): Map<string, PlayerRecord> {
  const next = new Map(current)
  for (const player of refreshed) {
    if (next.has(player.id)) next.set(player.id, player)
  }
  return next
}
