export type PlayerType = 'Hitter' | 'Pitcher'

export type RiskBand = 'Low' | 'Moderate' | 'High'

export type TrendDirection = 'up' | 'down' | 'flat'

export interface CareerArcPoint {
  age: number
  low: number
  median: number
  high: number
  actual?: number
}

export interface ModelDriver {
  label: string
  value: string
  impact: number
  detail: string
}

export interface PublishedForecast {
  modelVersion: string
  publishedAt: string
  rank: number | null
  arrivalProbability: number
  arrivalDelta: number | null
  eta: string | null
  expectedCareerWar: number
  starProbability: number
  hofProbability: number
  floorWar: number
  ceilingWar: number
  risk: RiskBand
  confidence: number
  summary: string
  drivers: ModelDriver[]
  careerArc: CareerArcPoint[]
}

export interface ObservedMetric {
  key: string
  label: string
  value: string
  percentile: number | null
  source: string
}

export interface PlayerOpportunity {
  label: string
  value: string
}

export interface PlayerCoverage {
  hasStatcast: boolean
  hasTraditional: boolean
  hasComplementaryRows: boolean
  levelsObserved: string[]
  organizationConflict: boolean
  label: string
  sourceVariants?: string[]
  cohortMismatch?: boolean
}

export interface PlayerProvenance {
  source: string
  dataset: string
  datasetKey?: string
  season: number | null
  retrievedAt: string | null
  cohort: {
    pitchQualifier: number
    minAge: number
    maxAge: number
  }
  externalIds: Record<string, string | number | null>
}

export interface PlayerRecord {
  id: string
  name: string
  initials: string
  organization: string | null
  organizationCode: string | null
  position: string | null
  playerType: PlayerType
  age: number | null
  level: string
  batsThrows: string | null
  psScore: number | null
  psPercentile: number | null
  agePercentile?: number | null
  opportunity: PlayerOpportunity | null
  metrics: ObservedMetric[]
  coverage: PlayerCoverage
  provenance: PlayerProvenance
  forecast: PublishedForecast | null
}

export type SortKey = 'psScore' | 'psPercentile' | 'age' | 'name'

export interface BoardFilters {
  query: string
  playerType: 'All' | PlayerType
  level: string
  sort: SortKey
}

export interface PlayersPage {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface PlayersResponseMeta {
  dataAsOf: string | null
  season: number | null
  coverage: string
  forecastStatus: 'not_published' | 'published'
  source: string
}

export interface PlayersResponse {
  schemaVersion: 'players.v1'
  items: PlayerRecord[]
  page: PlayersPage
  meta: PlayersResponseMeta
}
