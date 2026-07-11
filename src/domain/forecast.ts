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

export interface PlayerMetric {
  label: string
  value: string
  percentile: number
}

export interface PlayerForecast {
  id: string
  name: string
  initials: string
  organization: string
  organizationCode: string
  position: string
  playerType: PlayerType
  age: number
  level: string
  batsThrows: string
  rank: number
  arrivalProbability: number
  arrivalDelta: number
  eta: string
  expectedCareerWar: number
  starProbability: number
  hofProbability: number
  floorWar: number
  ceilingWar: number
  risk: RiskBand
  confidence: number
  dataCompleteness: number
  trend: TrendDirection
  tags: string[]
  summary: string
  metrics: PlayerMetric[]
  drivers: ModelDriver[]
  careerArc: CareerArcPoint[]
  updatedAt: string
}

export type SortKey = 'oracle' | 'arrival' | 'ceiling' | 'momentum'

export interface BoardFilters {
  query: string
  playerType: 'All' | PlayerType
  level: string
  sort: SortKey
  watchlistOnly: boolean
}
