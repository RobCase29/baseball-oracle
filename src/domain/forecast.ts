export type PlayerType = 'Hitter' | 'Pitcher' | 'Two-way'

export type PlayerStage = 'pre_debut' | 'early_mlb' | 'established_mlb' | 'inactive'

export type StageFilter = 'All' | 'Minors' | 'MLB'

export type PublicationState = 'observed' | 'research' | 'released' | 'withheld'

export type ConfidenceState = 'Low' | 'Moderate' | 'High' | 'Withheld'

export interface WarQuantiles {
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

export interface CareerForecastArcPoint extends WarQuantiles {
  age: number
  actual: number | null
}

export interface ModelDriver {
  label: string
  value: string
  impact: number
  detail: string
  source?: string
}

export interface HofStandardReference {
  label: string
  roleOrPosition: string | null
  careerWar: number | null
  peakSevenWar: number | null
  jaws: number | null
  fallbackUsed: boolean
}

export interface CareerForecastDecomposition {
  arrivalProbability: number | null
  hofCaliberGivenMlbProbability: number | null
  noMlbProbability: number | null
  observedCumulativeWar: number | null
}

export interface CareerForecastLineage {
  modelVersion: string
  targetVersion: string
  dataVersion: string | null
  providerVersion: string | null
}

export interface CareerForecast {
  publicationState: PublicationState
  releaseEligible: boolean
  asOf: string
  rank: number | null
  hofCaliberProbability: number | null
  finalCareerWar: WarQuantiles | null
  peakSevenWar: WarQuantiles | null
  finalJaws: WarQuantiles | null
  scenarioSupportExtensionJaws: number | null
  cumulativeWar: number | null
  arrivalProbability36: number | null
  confidenceScore: number | null
  confidenceState: ConfidenceState
  intervalWidth: number | null
  arc: CareerForecastArcPoint[]
  decomposition: CareerForecastDecomposition
  hofStandard: HofStandardReference | null
  summary: string | null
  drivers: ModelDriver[]
  warnings: string[]
  lineage: CareerForecastLineage
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
  } | null
  externalIds: Record<string, string | number | null>
}

export interface ResearchArrivalHorizon {
  months: number
  probability: number
  baselineProbability: number
  externallyValidated: boolean
}

export interface ResearchArrivalEstimate {
  status: 'research_only'
  releaseEligible: false
  asOf: string
  modelVersion: string
  snapshotId: string
  coldStart: boolean
  priorLevel: string
  modelAge: number
  currentStatusVerified: false
  horizons: ResearchArrivalHorizon[]
  lineage: {
    predictionManifestSha256: string
    evaluationReportSha256: string
  }
}

export interface PlayerRecord {
  id: string
  name: string
  initials: string
  organization: string | null
  organizationCode: string | null
  position: string | null
  playerType: PlayerType
  stage: PlayerStage
  age: number | null
  level: string | null
  batsThrows: string | null
  psScore: number | null
  psPercentile: number | null
  agePercentile?: number | null
  opportunity: PlayerOpportunity | null
  metrics: ObservedMetric[]
  coverage: PlayerCoverage
  provenance: PlayerProvenance
  researchEstimate: ResearchArrivalEstimate | null
  careerForecast: CareerForecast | null
}

export type SortKey = 'hofProbability' | 'finalWar' | 'arrival36' | 'age' | 'name'

export interface BoardFilters {
  query: string
  stage: StageFilter
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
  forecastStatus: 'not_published' | 'research_only' | 'published'
  source: string
  researchCoverage?: number | null
  researchAsOf?: string | null
  releaseEligible?: boolean
  targetVersion?: string | null
  stageCoverage?: {
    minors: number
    mlb: number
  } | null
  degraded?: boolean
  degradedReason?: string
  rankScope?: 'stage_specific'
  stageRankAvailability?: {
    mlb: boolean
    minors: boolean
  }
}

export interface PlayersResponse {
  schemaVersion: 'players.v1'
  items: PlayerRecord[]
  page: PlayersPage
  meta: PlayersResponseMeta
}
