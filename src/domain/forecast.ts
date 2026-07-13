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

export type RelativeSignalReliability = 'high' | 'moderate' | 'low'

export interface CurrentPeerSignal {
  percentile: number
  rank: number
  cohortSize: number
  value: number
  median: number
  difference: number
  basis: 'hof_caliber_probability' | 'arrival_probability_36'
  reliability: RelativeSignalReliability
  cohort: {
    scope: 'current_census'
    label: string
    playerType: PlayerType
    stage: PlayerStage
    ageMin: number
    ageMax: number
    ageWindow: number
    level: string | null
  }
}

export interface HistoricalPaceSignal {
  percentile: number
  cohortSize: number
  playerValue: number
  metric: 'career_war_to_date'
  reliability: RelativeSignalReliability
  featureSeason: number
  featureAge: number
  cohort: {
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
}

export interface RelativeStandingSignal {
  version: 'relative-standing-v1'
  kind: 'hall_track' | 'arrival_track'
  status: 'research' | 'withheld'
  currentPeer: CurrentPeerSignal | null
  historicalPace: HistoricalPaceSignal | null
  warnings: string[]
}

export interface CareerChapter {
  version: 'career-chapter-v1'
  status: 'research' | 'withheld'
  chapter: 'launch' | 'development' | 'prime_plateau' | 'decline' | 'late_career' | 'uncertain'
  label: string
  trajectoryState: 'breakout' | 'rising' | 'maintaining' | 'plateau' | 'declining' | 'uncertain'
  roleTrack: 'hitter' | 'starter' | 'reliever'
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
  exceptionalTrajectory: {
    probability: number
    target: 'next_three_war_ge_global_training_q90'
    thresholdWar: number
    horizonSeasons: 3
    referenceBaseRate: number
    rankScope: 'current_mlb_absolute_trajectory'
  } | null
  support: {
    referencePlayers: number
    referenceLandmarks: number
    expectedNextWarChange: number
    continuationRate: number
  }
  warnings: string[]
}

export interface AlphaSignal {
  version: 'alpha-signal-v1'
  status: 'research' | 'withheld'
  tier: 'priority' | 'watch' | 'none' | 'withheld'
  basis: 'completed_seasons_only'
  featureSeason: number
  eligible: boolean
  rank: number | null
  rankScope: 'current_mlb_eligible_absolute_alpha' | null
  modeledProbability: number | null
  baseline: {
    probability: number
    minimumSeason: 1961
    players: number
    landmarks: number
    roleTrack: 'hitter' | 'starter' | 'reliever'
    experienceBand: string
    seasonNumberMin: number
    seasonNumberMax: number
    ageMin: number
    ageMax: number
    ageWindow: number
    resolvedOnly: true
    referenceSeasonsBeforeFeature: true
    playerEqualWeighted: true
  } | null
  edge: {
    probabilityDelta: number
    liftMultiple: number | null
  } | null
  ceiling: {
    p90JawsMargin: number
    gatePassed: boolean
    target: 'final_jaws_minus_career_to_date_standard'
  } | null
  runway: {
    age: number
    learnedTrackPrimeStartAge: number
    yearsToPrime: number
    minimumRequiredYears: number
    gatePassed: boolean
  } | null
  nearTermImpact: {
    probability: number
    referenceBaseRate: number
    liftMultiple: number | null
    target: 'next_three_war_ge_global_training_q90'
  } | null
  historicalPace: {
    percentile: number | null
    referencePlayers: number | null
    metric: 'career_war_to_date'
  } | null
  gates: {
    supportedBaseline: boolean
    completedEvidence: boolean
    earlyCareer: boolean
    prePrimeRunway: boolean
    absoluteCeiling: boolean
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
  relativeSignal?: RelativeStandingSignal | null
  careerChapter?: CareerChapter | null
  alphaSignal?: AlphaSignal | null
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

export type SortKey = 'alphaOpportunity' | 'hofProbability' | 'nearTermImpact' | 'finalWar' | 'arrival36' | 'age' | 'name'

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
  careerChapterCoverage?: number | null
  careerChapterVersion?: 'career-chapter-v1' | null
  alphaSignalCoverage?: number | null
  alphaSignalEligible?: number | null
  alphaSignalVersion?: 'alpha-signal-v1' | null
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
