export const CARD_MARKET_SCHEMA_VERSION = 'card-market.v1' as const

export type CardMarketEvidenceQuality = 'strong' | 'moderate' | 'thin' | 'unpriced'

export interface CardMarketVariation {
  key: string
  label: string
  multiplier: number
  amount: number | null
  low: number | null
  high: number | null
  confidence: number | null
  evidenceTier: string | null
  actionable: boolean
}

export interface CardMarketModel {
  modelId: string
  matchKey: string
  player: {
    name: string
    normalizedName: string
    currentTeamCode: string | null
    currentTeamName: string | null
    checklistTeam: string | null
  }
  card: {
    release: string
    releaseYear: number
    productFamily: string
    cardType: 'Base Auto'
    grade: 'Raw'
  }
  valuation: {
    amount: number | null
    currency: 'USD'
    low: number | null
    high: number | null
    confidenceScore: number
    evidenceTier: string
    evidenceQuality: CardMarketEvidenceQuality
    actionable: boolean
  }
  evidence: {
    sales: number
    effectiveSales: number
    sales30: number
    sales90: number
    auctionSales: number
    binSales: number
    volatility: number
    latestSaleAt: string | null
  }
  freshness: {
    modelGeneratedAt: string | null
    modelAgeDays: number | null
    latestSaleAgeDays: number | null
    stale: boolean
  }
  variations: CardMarketVariation[]
}

export interface CardMarketResponse {
  schemaVersion: typeof CARD_MARKET_SCHEMA_VERSION
  player: string
  generatedAt: string
  snapshotGeneratedAt: string | null
  modelVersion: string
  count: number
  items: CardMarketModel[]
  warnings: string[]
}

export function isCardMarketResponse(value: unknown): value is CardMarketResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CardMarketResponse>
  return candidate.schemaVersion === CARD_MARKET_SCHEMA_VERSION &&
    typeof candidate.player === 'string' &&
    Array.isArray(candidate.items) &&
    candidate.items.every((item) => (
      Boolean(item) &&
      typeof item.modelId === 'string' &&
      typeof item.card?.release === 'string' &&
      typeof item.valuation?.actionable === 'boolean'
    ))
}
