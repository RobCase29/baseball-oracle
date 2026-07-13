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

export type RelativeSignalKind = 'hall_track' | 'arrival_track'
export type RelativeSignalStatus = 'research' | 'withheld'
export type RelativeSignalReliability = 'high' | 'moderate' | 'low'

export interface RelativeCurrentPeerCohort {
  scope: 'current_census'
  label: string
  playerType: PlayerType
  stage: PlayerStage
  ageMin: number
  ageMax: number
  ageWindow: number
  level: string | null
}

export interface RelativeCurrentPeer {
  percentile: number
  rank: number
  cohortSize: number
  value: number
  median: number
  difference: number
  basis: 'hof_caliber_probability' | 'arrival_probability_36'
  reliability: RelativeSignalReliability
  cohort: RelativeCurrentPeerCohort
}

export interface HistoricalPaceCohort {
  scope: 'historical_point_in_time'
  label: string
  role: string
  stageBand: string
  seasonNumberMin: number
  seasonNumberMax: number
  ageMin: number
  ageMax: number
  ageWindow: number
  resolvedOnly: true
}

export interface HistoricalPaceStanding {
  percentile: number
  cohortSize: number
  playerValue: number
  metric: 'career_war_to_date'
  reliability: RelativeSignalReliability
  featureSeason: number
  featureAge: number
  cohort: HistoricalPaceCohort
}

export interface RelativeSignal {
  version: 'relative-standing-v1'
  kind: RelativeSignalKind
  status: RelativeSignalStatus
  currentPeer: RelativeCurrentPeer | null
  historicalPace: HistoricalPaceStanding | null
  warnings: string[]
}

export type CareerChapterKey =
  | 'launch'
  | 'development'
  | 'prime_plateau'
  | 'decline'
  | 'late_career'
  | 'uncertain'

export type CareerTrajectoryState =
  | 'breakout'
  | 'rising'
  | 'maintaining'
  | 'plateau'
  | 'declining'
  | 'uncertain'

export type CareerRoleTrack = 'hitter' | 'starter' | 'reliever'

export interface ExceptionalTrajectoryForecast {
  probability: number
  target: 'next_three_war_ge_global_training_q90'
  thresholdWar: number
  horizonSeasons: 3
  referenceBaseRate: number
  rankScope: 'current_mlb_absolute_trajectory'
}

export interface CareerChapter {
  version: 'career-chapter-v1'
  status: 'research' | 'withheld'
  chapter: CareerChapterKey
  label: string
  trajectoryState: CareerTrajectoryState
  roleTrack: CareerRoleTrack
  basis: 'completed_seasons_only'
  featureSeason: number
  evidence: {
    age: number
    mlbSeasonNumber: number
    seasonWar: number
    recentWarPerSeason: number
    priorWarPerSeason: number | null
    warTrend: number | null
    historicalPacePercentile: number | null
  }
  exceptionalTrajectory: ExceptionalTrajectoryForecast | null
  support: {
    referencePlayers: number
    referenceLandmarks: number
    expectedNextWarChange: number
    continuationRate: number
  }
  warnings: string[]
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
  relativeSignal?: RelativeSignal | null
  careerChapter?: CareerChapter | null
}
