export type PlayerType = 'Hitter' | 'Pitcher' | 'Two-way'
export type PlayerStage = 'pre_debut' | 'early_mlb' | 'established_mlb' | 'inactive'
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
  [key: string]: string | number | boolean | null
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
