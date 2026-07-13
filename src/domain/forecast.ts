import type { PlayerMapProfile } from './playerMap.js'
import type { PlayerHandlingCode } from './playerHandling.js'

export type PlayerType = 'Hitter' | 'Pitcher' | 'Two-way'

export type PlayerStage =
  | 'pre_debut'
  | 'post_debut_minors'
  | 'recent_callup'
  | 'early_mlb'
  | 'established_mlb'
  | 'inactive'

export type StageFilter = 'All' | 'Minors' | 'RC' | 'MLB'

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
  estimatedDebutAge: number | null
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

export interface RecentCallupContext {
  version: 'rookie-track-v1'
  status: 'monitoring'
  reason: 'first_mlb_season_partial_only' | 'current_mlb_record_not_in_model_census'
  prospectPrior: {
    rank: number
    universe: number
    target: string
    asOf: string
    forecast: CareerForecast
  } | null
  currentMlbEvidence: {
    asOf: string | null
    opportunity: PlayerOpportunity | null
    war: number | null
    warPercentile: number | null
  }
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
  externalEvaluationStatus?: 'failed_release_gate' | 'immature'
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

export interface MilbAlphaEdge {
  horizonMonths: 36 | 60
  probability: number
  baselineProbability: number
  probabilityDelta: number
  liftMultiple: number | null
  externallyValidated?: false
}

export interface MilbAlphaSignal {
  version: 'milb-alpha-signal-v1'
  status: 'research'
  releaseEligible: false
  target: 'first_mlb_arrival_within_36_months'
  eligible: boolean
  tier: 'priority' | 'watch' | 'none'
  rank: number | null
  rankScope: 'frozen_2025_milb_arrival_alpha' | null
  asOf: string | null
  primaryEdge: MilbAlphaEdge
  longHorizonEdge: MilbAlphaEdge & { horizonMonths: 60; externallyValidated: false }
  ageContext: {
    age: number
    percentileWithinRoleLevel: number
    youngerThanPercent: number
    referencePlayers: number
    referenceRows: number
    role: 'hitter' | 'pitcher'
    priorLevel: string
    playerEqualWeighted: true
  } | null
  workload: {
    kind: 'PA' | 'IP'
    value: number | null
    minimum: number
  }
  baselineSupport: {
    minimumRows: number
    minimumEvents: number
    horizons: Array<{
      horizonMonths: 36 | 60
      scope: 'role_level_age_band' | 'role_level' | 'role'
      rows: number
      events: number
    }>
    referenceSeasons: number[]
  }
  descriptiveDrivers: Array<{
    metric: string
    label: string
    value: number
    favorablePercentile: number
    favorableDirection: 'higher' | 'lower'
    referenceScope: 'role_level_age_band' | 'role_level'
    referencePlayers: number
  }>
  gates: {
    supportedHistoricalContext: boolean
    youngForRoleAndLevel: boolean
    minimumRawWorkload: boolean
    minimumPrimaryProbability: boolean
    positivePrimaryModelEdge: boolean
    positiveLongHorizonModelEdge: boolean
  }
  releaseGates: {
    externalValidationPassed: false
    probabilityCalibrationPassed: false
    currentFeatureAlignmentPassed: false
  }
  validation: {
    status: 'external_validation_failed'
    releaseEligible: false
    validatedHorizons: []
    retrospectiveRankingDiagnosticOnly: [36]
  }
  inputPolicy: 'raw_stats_age_level_role_no_composite_score_or_external_rank'
  warnings: string[]
}

export interface MilbImpactRanking {
  rank: number
  rankPercentile: number
  role: 'hitter' | 'pitcher'
  status: 'research_only'
  releaseEligible: false
  frozenAsOf: string
  modelVersion: 'milb-impact-five-calendar-year-war-v1'
  selectedModel: 'regularized_logistic'
  universeRows: number
  target: {
    id: 'mlb_war_next_5_ge_5'
    label: 'At least 5 total MLB WAR in the next five calendar seasons'
    scope: 'unconditional'
    windowStartSeason: 2026
    windowEndSeason: 2030
    hallOfFameProbability: false
  }
  oofRankEvidence: {
    method: 'player-purged expanding prediction-origin out-of-fold evaluation'
    rows: number
    players: number
    eventPlayers: number
    topDecileLift: number
    brierSkillVsTransparentBaseline: number
    foldTopDecileLiftRange: {
      minimum: number
      maximum: number
      folds: number
      validationSeasons: number[]
    }
  }
  gates: {
    tailCalibrationPassed: false
    prospectiveValidationPassed: false
    knowledgeTimeVerified: false
  }
  lineage: {
    runContentSha256: string
    currentScoresSha256: string
  }
  warnings: string[]
}

export interface MinorTraitEvidence {
  version: 'minor-trait-evidence-v1'
  status: 'descriptive_source_evidence_only'
  predictiveValidation: false
  playerType: 'Hitter' | 'Pitcher'
  opportunity: {
    state: 'unavailable' | 'insufficient' | 'provisional' | 'sufficient'
    sufficient: boolean
    observed: {
      plateAppearances: number | null
      inningsPitched: number | null
      pitches: number | null
    }
    thresholds: Array<{
      unit: 'PA' | 'IP' | 'Pitches'
      provisional: number
      sufficient: number
    }>
  }
  coverage: {
    availableMetricCount: number
    coveredPillarCount: number
    totalPillarCount: number
    requiredCoveredPillars: number
    sufficient: boolean
    missingPillars: string[]
  }
  corroboration: {
    strongPercentileThreshold: number
    strongPillarCount: number
    requiredStrongPillars: number
    multiPillar: boolean
    passesAllDescriptiveGates: boolean
  }
  pillars: Array<{
    key: string
    label: string
    covered: boolean
    strong: boolean
    availableMetricCount: number
    strongestMetric: {
      key: string
      label: string
      value: string | null
      percentile: number
      pillar: string
      source: 'Prospect Savant'
    } | null
  }>
  strongestMetrics: Array<{
    key: string
    label: string
    value: string | null
    percentile: number
    pillar: string
    source: 'Prospect Savant'
  }>
  exclusions: {
    providerCompositeMetricCount: number
    kMinusBbPercentileCount: number
    unsupportedSourceMetricCount: number
    invalidPercentileCount: number
    duplicateMetricKeyCount: number
  }
  warnings: string[]
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
  milbAlphaSignal?: MilbAlphaSignal | null
  milbImpactRanking?: MilbImpactRanking | null
  minorTraitEvidence?: MinorTraitEvidence | null
  careerForecast: CareerForecast | null
  recentCallup?: RecentCallupContext | null
  playerMap?: PlayerMapProfile | null
}

export type SortKey = 'careerIndex' | 'stageStanding' | 'alphaOpportunity' | 'hofProbability' | 'nearTermImpact' | 'finalWar' | 'arrival36' | 'age' | 'name'

export interface BoardFilters {
  query: string
  stage: StageFilter
  playerType: 'All' | PlayerType
  level: string
  team?: string
  position?: string
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
  currentDataFreshness?: {
    status: 'ok' | 'degraded' | 'stale'
    reasonCodes: string[]
    statsChangedAt: string | null
    lastCheckedAt: string | null
    nextDueAt: string
    cronObserved: boolean
  }
  researchCoverage?: number | null
  careerChapterCoverage?: number | null
  careerChapterVersion?: 'career-chapter-v1' | null
  alphaSignalCoverage?: number | null
  alphaSignalEligible?: number | null
  alphaSignalVersion?: 'alpha-signal-v1' | null
  milbAlphaSignalCoverage?: number | null
  milbAlphaSignalEligible?: number | null
  milbAlphaSignalVersion?: 'milb-alpha-signal-v1' | null
  milbImpactRankingCoverage?: number | null
  milbImpactAlphaEligible?: number | null
  milbImpactRankingVersion?: 'milb-impact-five-calendar-year-war-v1' | null
  milbImpactRankingUniverse?: number | null
  minorTraitEvidenceVersion?: 'minor-trait-evidence-v1' | null
  researchAsOf?: string | null
  releaseEligible?: boolean
  targetVersion?: string | null
  stageCoverage?: {
    minors: number
    experiencedMinors?: number
    recentCallups?: number
    mlb: number
  } | null
  degraded?: boolean
  degradedReason?: string
  rankScope?: 'stage_specific'
  stageRankScope?: 'declared_model_cohort_not_filtered_result'
  stageRankAvailability?: {
    mlb: boolean
    minors: boolean
    recentCallups?: boolean
  }
  playerMapVersion?: 'oracle-player-map/v1' | 'oracle-player-map/v2'
  playerMapCoverage?: number
  matchingPlayerCount?: number
  matchingMappedCount?: number
  snapshotId?: string
  snapshotScope?: 'ranking_and_census'
  marketIndependent?: true
  marketInputsIncluded?: false
  primaryScoreSemantics?: 'fixed_career_value_index'
  scoreSemantics?: 'stage_specific_ordinal_not_market_value'
  legacyScoreSemantics?: 'stage_specific_ordinal_not_market_value'
  scoreSemanticsDeprecated?: true
  rankingContract?: {
    version: 'player-ranking-contract/v1'
    primaryMetric: 'careerIndex'
    primarySort: 'careerIndex'
    primaryComparableAcrossRoutes: true
    stageStandingMetric: 'stageStanding'
    stageStandingComparableWithinStageOnly: true
    stageStandingIsFilteredResultOrdinal: false
    legacyMetric: 'oracleScore'
    legacyDeprecated: true
  }
  ordering?: {
    requestedSort: SortKey
    appliedSort: Exclude<SortKey, 'alphaOpportunity'>
    legacyAliasUsed: boolean
    metric: string
    field: string | null
    fieldExposed: boolean
    direction: 'ascending' | 'descending'
    scope: 'directory' | 'cross_stage' | 'stage'
    nulls: 'last'
    tieBreakers: Array<{
      metric: string
      field: string | null
      fieldExposed: boolean
      direction: 'ascending' | 'descending'
    }>
  }
  facets?: {
    teams: PlayerFacetOption[]
    positions: PlayerFacetOption[]
  }
  identity?: {
    minorRoleRows: number
    canonicalMinorPlayers: number
    duplicateMinorRoleRowsRemoved: number
    minorTwoWayPlayers?: number
    crossStageDuplicatesRemoved: number
    minorPlayersMissingMlbam: number
    mlbPlayersMissingMlbam: number
    currentMlbProfilesOutsideModelCensus?: number
    experiencedMinorRowsExcludedFromRankings?: number
    currentSeasonDebutMinorRowsIdentified?: number
    minorIdsRecoveredFromExactCrosswalk?: number
    identityPolicy?: 'exact_mlbam_bbref_plus_durable_chadwick_overlay_no_name_matching'
    identityCrosswalkAsOf?: string
    identityCrosswalkRecords?: number
    identityCrosswalkStatus?: 'current' | 'stale' | 'invalid'
    identityCrosswalkAgeHours?: number | null
    identityCrosswalkMaxAgeHours?: number
    identityOverlayRecords?: number
    identityOverlayConflicts?: number
    identityOverlayNewestObservedAt?: string | null
    currentMlbRows?: number
    unmatchedCurrentBbrefIds?: number
    conflictingCurrentMlbIds?: number
  }
  searchRecovery?: {
    query: string
    outsideFilterMatches: Array<{
      id: string
      name: string
      stage: PlayerStage
      playerType: PlayerType
      organization: string | null
      organizationCode: string | null
      position: string | null
    }>
  }
  handlingAudit?: {
    version: 'player-handling/v1'
    activePlayers: number
    specialHandlingPlayers: number
    withheldForecasts: number
    unclassifiedWithheld: number
    byCode: Partial<Record<PlayerHandlingCode, number>>
  }
}

export interface PlayerFacetOption {
  value: string
  label: string
  count: number
}

export interface PlayerMapFeedResponseMeta extends PlayersResponseMeta {
  playerMapVersion: 'oracle-player-map/v2'
  playerMapCoverage: number
  matchingPlayerCount: number
  matchingMappedCount: number
  snapshotId: string
  snapshotScope: 'ranking_and_census'
  marketIndependent: true
  marketInputsIncluded: false
  primaryScoreSemantics: 'fixed_career_value_index'
  scoreSemantics: 'stage_specific_ordinal_not_market_value'
  legacyScoreSemantics: 'stage_specific_ordinal_not_market_value'
  scoreSemanticsDeprecated: true
  rankingContract: NonNullable<PlayersResponseMeta['rankingContract']>
  ordering: NonNullable<PlayersResponseMeta['ordering']>
}

export interface PlayersResponse {
  schemaVersion: 'players.v1'
  items: PlayerRecord[]
  page: PlayersPage
  meta: PlayersResponseMeta
}

export interface PlayerMapFeedItem {
  playerId: string
  identity: {
    name: string
  }
  externalIds: Record<string, string | null>
  context: {
    playerType: PlayerType
    stage: PlayerStage
    age: number | null
    level: string | null
    organization: string | null
    organizationCode: string | null
    position: string | null
  }
  assessment: PlayerMapProfile
}

export interface PlayerMapFeedResponse {
  schemaVersion: 'player-map-feed.v3'
  items: PlayerMapFeedItem[]
  page: PlayersPage
  meta: PlayerMapFeedResponseMeta
}
