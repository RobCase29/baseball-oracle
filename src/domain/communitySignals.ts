export const COMMUNITY_SIGNALS_SCHEMA_VERSION = 'community-signals.v1' as const
export const COMMUNITY_SIGNALS_CONTRACT_VERSION = 'community-signals-contract/v1' as const

export type DynastySignalStatus = 'ranked' | 'default_floor'

export interface CommunitySignalItem {
  recordVersion: string
  player: {
    oracleId: string | null
    mlbamId: string
    hkbId: string
    name: string
  }
  dynastyScore: {
    label: 'Dynasty Score'
    value: number | null
    signalStatus: DynastySignalStatus
    overallRank: number | null
    overallUniverse: number | null
    prospectRank: number | null
    prospectUniverse: number | null
    movement: {
      rank7d: number | null
      rank30d: number | null
      value7d: number | null
      value30d: number | null
    }
    attention: {
      views30d: number | null
      rank30d: number | null
      prospectViews30d: number | null
      prospectRank30d: number | null
    }
    history: {
      rank30d: Array<number | null> | null
      value30d: Array<number | null> | null
    }
  }
  source: {
    name: 'HarryKnowsBall'
    url: string
    capturedAt: string
    updatedAt: string | null
  }
}

export interface CommunitySignalsResponse {
  schemaVersion: typeof COMMUNITY_SIGNALS_SCHEMA_VERSION
  contractVersion: typeof COMMUNITY_SIGNALS_CONTRACT_VERSION
  snapshot: {
    id: string
    observedAt: string
    sourceUpdatedAt: string | null
  } | null
  items: CommunitySignalItem[]
  meta: {
    excludedFromOracleModel: true
    nullMeans: 'unavailable_not_zero'
    nullMeansUnavailableNotZero: true
    identityPolicy: 'exact_mlbam_join_no_name_matching'
    signalType: 'crowdsourced_dynasty_sentiment'
    dynastyScoreScale: {
      minimum: 10
      maximum: 10_000
      unit: 'HarryKnowsBall dynasty value'
      isProbability: false
    }
    requestedIds: string[]
    unmatchedIds: string[]
  }
}

export function mlbamIdForCommunity(player: {
  provenance: { externalIds: Record<string, string | number | null> }
}): string | null {
  const value = player.provenance.externalIds.mlbam
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(Math.trunc(value))
  if (typeof value === 'string' && /^\d+$/u.test(value.trim())) return value.trim()
  return null
}

export function isCommunitySignalsResponse(value: unknown): value is CommunitySignalsResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CommunitySignalsResponse>
  return candidate.schemaVersion === COMMUNITY_SIGNALS_SCHEMA_VERSION &&
    candidate.contractVersion === COMMUNITY_SIGNALS_CONTRACT_VERSION &&
    Array.isArray(candidate.items) && candidate.items.every((item) => (
    Boolean(item) &&
    typeof item === 'object' &&
    Boolean(item.player) &&
    typeof item.player.mlbamId === 'string' &&
    Boolean(item.dynastyScore) &&
    typeof item.dynastyScore === 'object' &&
    (item.dynastyScore.signalStatus === 'ranked' || item.dynastyScore.signalStatus === 'default_floor')
  ))
}
