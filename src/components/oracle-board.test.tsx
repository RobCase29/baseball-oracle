// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { CareerForecast, PlayerRecord } from '../domain/forecast'
import { buildPlayerMap, PLAYER_MAP_VERSION } from '../domain/playerMap'
import { PlayerDossier } from './PlayerDossier'
import { ProspectBoard } from './ProspectBoard'
import { playerMapFor } from './playerMapView'

afterEach(cleanup)

const chapter: NonNullable<CareerForecast['careerChapter']> = {
  version: 'career-chapter-v1',
  status: 'research',
  chapter: 'launch',
  label: 'Launch / breakout',
  trajectoryState: 'breakout',
  roleTrack: 'hitter',
  basis: 'completed_seasons_only',
  featureSeason: 2025,
  evidence: {
    age: 22,
    mlbSeasonNumber: 1,
    seasonWar: 5.04,
    recentWarPerSeason: 5.04,
    priorWarPerSeason: null,
    warTrend: null,
    historicalPacePercentile: 99.1,
  },
  exceptionalTrajectory: {
    probability: 0.43,
    target: 'next_three_war_ge_global_training_q90',
    thresholdWar: 10.5,
    horizonSeasons: 3,
    referenceBaseRate: 0.1,
    rankScope: 'current_mlb_absolute_trajectory',
  },
  support: {
    referencePlayers: 1240,
    referenceLandmarks: 3800,
    expectedNextWarChange: 0.8,
    continuationRate: 0.67,
  },
  warnings: ['exceptional_trajectory_not_hall_probability'],
}

const alphaSignal: NonNullable<CareerForecast['alphaSignal']> = {
  version: 'alpha-signal-v1',
  status: 'research',
  tier: 'priority',
  basis: 'completed_seasons_only',
  featureSeason: 2025,
  eligible: true,
  rank: 3,
  rankScope: 'current_mlb_eligible_absolute_alpha',
  modeledProbability: 0.16,
  baseline: {
    probability: 0.012,
    minimumSeason: 1961,
    players: 812,
    landmarks: 2400,
    roleTrack: 'hitter',
    experienceBand: 'first',
    seasonNumberMin: 1,
    seasonNumberMax: 1,
    ageMin: 20,
    ageMax: 24,
    ageWindow: 2,
    resolvedOnly: true,
    referenceSeasonsBeforeFeature: true,
    playerEqualWeighted: true,
  },
  edge: { probabilityDelta: 0.148, liftMultiple: 13.333 },
  ceiling: {
    p90JawsMargin: 8.4,
    gatePassed: true,
    target: 'final_jaws_minus_career_to_date_standard',
  },
  runway: {
    age: 23,
    learnedTrackPrimeStartAge: 28,
    yearsToPrime: 5,
    minimumRequiredYears: 2,
    gatePassed: true,
  },
  nearTermImpact: {
    probability: 0.43,
    referenceBaseRate: 0.1,
    liftMultiple: 4.3,
    target: 'next_three_war_ge_global_training_q90',
  },
  historicalPace: {
    percentile: 99.1,
    referencePlayers: 804,
    metric: 'career_war_to_date',
  },
  gates: {
    supportedBaseline: true,
    completedEvidence: true,
    earlyCareer: true,
    prePrimeRunway: true,
    absoluteCeiling: true,
  },
  warnings: [
    'alpha_edge_is_not_expected_investment_return',
    'p90_ceiling_is_tail_scenario_not_most_likely_outcome',
  ],
}

const milbAlphaSignal: NonNullable<PlayerRecord['milbAlphaSignal']> = {
  version: 'milb-alpha-signal-v1',
  status: 'research',
  releaseEligible: false,
  target: 'first_mlb_arrival_within_36_months',
  eligible: true,
  tier: 'priority',
  rank: 5,
  rankScope: 'frozen_2025_milb_arrival_alpha',
  asOf: '2025-12-31T00:00:00.000Z',
  primaryEdge: {
    horizonMonths: 36,
    probability: 0.91,
    baselineProbability: 0.18,
    probabilityDelta: 0.73,
    liftMultiple: 5.06,
  },
  longHorizonEdge: {
    horizonMonths: 60,
    probability: 0.97,
    baselineProbability: 0.31,
    probabilityDelta: 0.66,
    liftMultiple: 3.13,
    externallyValidated: false,
  },
  ageContext: {
    age: 20.4,
    percentileWithinRoleLevel: 12,
    youngerThanPercent: 88,
    referencePlayers: 1200,
    referenceRows: 2500,
    role: 'hitter',
    priorLevel: 'AA',
    playerEqualWeighted: true,
  },
  workload: { kind: 'PA', value: 310, minimum: 75 },
  baselineSupport: {
    minimumRows: 240,
    minimumEvents: 12,
    horizons: [
      { horizonMonths: 36, scope: 'role_level_age_band', rows: 260, events: 12 },
      { horizonMonths: 60, scope: 'role_level_age_band', rows: 240, events: 19 },
    ],
    referenceSeasons: [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019],
  },
  descriptiveDrivers: [],
  gates: {
    supportedHistoricalContext: true,
    youngForRoleAndLevel: true,
    minimumRawWorkload: true,
    minimumPrimaryProbability: true,
    positivePrimaryModelEdge: true,
    positiveLongHorizonModelEdge: true,
  },
  releaseGates: {
    externalValidationPassed: false,
    probabilityCalibrationPassed: false,
    currentFeatureAlignmentPassed: false,
  },
  validation: {
    status: 'external_validation_failed',
    releaseEligible: false,
    validatedHorizons: [],
    retrospectiveRankingDiagnosticOnly: [36],
  },
  inputPolicy: 'raw_stats_age_level_role_no_composite_score_or_external_rank',
  warnings: [
    'research_only',
    'external_validation_failed_no_horizon_validated',
    'arrival_target_not_hall_ceiling',
  ],
}

const milbImpactRanking: NonNullable<PlayerRecord['milbImpactRanking']> = {
  rank: 3,
  rankPercentile: 99.969012,
  role: 'hitter',
  status: 'research_only',
  releaseEligible: false,
  frozenAsOf: '2025-12-31T00:00:00.000Z',
  modelVersion: 'milb-impact-five-calendar-year-war-v1',
  selectedModel: 'regularized_logistic',
  universeRows: 6455,
  target: {
    id: 'mlb_war_next_5_ge_5',
    label: 'At least 5 total MLB WAR in the next five calendar seasons',
    scope: 'unconditional',
    windowStartSeason: 2026,
    windowEndSeason: 2030,
    hallOfFameProbability: false,
  },
  oofRankEvidence: {
    method: 'player-purged expanding prediction-origin out-of-fold evaluation',
    rows: 35747,
    players: 15326,
    eventPlayers: 197,
    topDecileLift: 8.0984,
    brierSkillVsTransparentBaseline: 0.0425,
    foldTopDecileLiftRange: {
      minimum: 7.2377,
      maximum: 8.2759,
      folds: 5,
      validationSeasons: [2015, 2016, 2017, 2018, 2019],
    },
  },
  gates: {
    tailCalibrationPassed: false,
    prospectiveValidationPassed: false,
    knowledgeTimeVerified: false,
  },
  lineage: {
    runContentSha256: 'a'.repeat(64),
    currentScoresSha256: 'b'.repeat(64),
  },
  warnings: [
    'Research-only retrospective ranking; it is not a released forecast.',
    'Raw impact probabilities are intentionally withheld because extreme-tail calibration failed.',
  ],
}

const aivaTraits: NonNullable<PlayerRecord['minorTraitEvidence']> = {
  version: 'minor-trait-evidence-v1',
  status: 'descriptive_source_evidence_only',
  predictiveValidation: false,
  playerType: 'Hitter',
  opportunity: {
    state: 'provisional',
    sufficient: false,
    observed: { plateAppearances: 122, inningsPitched: null, pitches: null },
    thresholds: [{ unit: 'PA', provisional: 75, sufficient: 150 }],
  },
  coverage: {
    availableMetricCount: 5,
    coveredPillarCount: 2,
    totalPillarCount: 4,
    requiredCoveredPillars: 3,
    sufficient: false,
    missingPillars: ['Damage', 'Expected output'],
  },
  corroboration: {
    strongPercentileThreshold: 80,
    strongPillarCount: 1,
    requiredStrongPillars: 2,
    multiPillar: false,
    passesAllDescriptiveGates: false,
  },
  pillars: [
    {
      key: 'contact',
      label: 'Contact',
      covered: true,
      strong: true,
      availableMetricCount: 3,
      strongestMetric: {
        key: 'whiff', label: 'Whiff rate', value: '18.2%', percentile: 90.8,
        pillar: 'contact', source: 'Prospect Savant',
      },
    },
    {
      key: 'swing-decisions',
      label: 'Swing decisions',
      covered: true,
      strong: false,
      availableMetricCount: 2,
      strongestMetric: {
        key: 'chase', label: 'Chase rate', value: '31.4%', percentile: 16.1,
        pillar: 'swing-decisions', source: 'Prospect Savant',
      },
    },
    { key: 'damage', label: 'Damage', covered: false, strong: false, availableMetricCount: 0, strongestMetric: null },
    { key: 'expected-output', label: 'Expected output', covered: false, strong: false, availableMetricCount: 0, strongestMetric: null },
  ],
  strongestMetrics: [
    { key: 'whiff', label: 'Whiff rate', value: '18.2%', percentile: 90.8, pillar: 'contact', source: 'Prospect Savant' },
    { key: 'strikeout', label: 'Strikeout rate', value: '19.7%', percentile: 82.1, pillar: 'contact', source: 'Prospect Savant' },
    { key: 'zone-contact', label: 'Zone contact', value: '86.5%', percentile: 78.1, pillar: 'contact', source: 'Prospect Savant' },
    { key: 'chase', label: 'Chase rate', value: '31.4%', percentile: 16.1, pillar: 'swing-decisions', source: 'Prospect Savant' },
    { key: 'walk', label: 'Walk rate', value: '6.1%', percentile: 14.3, pillar: 'swing-decisions', source: 'Prospect Savant' },
  ],
  exclusions: {
    providerCompositeMetricCount: 1,
    kMinusBbPercentileCount: 0,
    unsupportedSourceMetricCount: 0,
    invalidPercentileCount: 0,
    duplicateMetricKeyCount: 0,
  },
  warnings: [],
}

const forecast: CareerForecast = {
  publicationState: 'research',
  releaseEligible: false,
  asOf: '2026-07-12T00:00:00.000Z',
  rank: 7,
  hofCaliberProbability: 0.081,
  finalCareerWar: { p10: 3, p25: 10, p50: 24, p75: 42, p90: 65 },
  peakSevenWar: { p10: 2, p25: 7, p50: 16, p75: 28, p90: 41 },
  finalJaws: null,
  scenarioSupportExtensionJaws: 2.4,
  cumulativeWar: null,
  arrivalProbability36: 0.61,
  confidenceScore: 0.72,
  confidenceState: 'Moderate',
  intervalWidth: 62,
  arc: [],
  decomposition: {
    arrivalProbability: 0.76,
    hofCaliberGivenMlbProbability: 0.106,
    noMlbProbability: 0.24,
    observedCumulativeWar: null,
    estimatedDebutAge: null,
  },
  hofStandard: null,
  summary: 'Research fixture.',
  drivers: [],
  warnings: [
    'Research only.',
    'single_scenario_jaws_tail_support_extension',
    'future_position_hof_standard_uncertain',
    'confidence_is_heuristic_not_coverage_probability',
    'current_scoring_refit_not_cross_fitted_or_evaluated',
    'early_hall_tail_not_learned_research_only',
    'hof_target_rebaselines_if_career_to_date_standard_changes',
    'partial_only_unvalidated_forecast_withheld',
    'partial_season_feature_fallback',
    'stale_return_feature_state_forecast_withheld',
    'current_opportunity_unobserved_forecast_withheld',
    'young_elite_distribution_gate_failed_forecast_withheld',
    'scoring_era_extrapolation_from_2007',
    'early_peak_interval_release_gate_failed',
    'development_holdout_not_prospective_validation',
    'prospective_validation_required',
  ],
  lineage: {
    modelVersion: 'career-v1',
    targetVersion: 'hof-caliber-jaws-v1',
    dataVersion: null,
    providerVersion: null,
  },
  relativeSignal: {
    version: 'relative-standing-v1',
    kind: 'arrival_track',
    status: 'research',
    currentPeer: {
      percentile: 98.4,
      rank: 4,
      cohortSize: 512,
      value: 0.61,
      median: 0.22,
      difference: 0.39,
      basis: 'arrival_probability_36',
      reliability: 'moderate',
      cohort: {
        scope: 'current_census',
        label: 'Age 20–22 AA hitters',
        playerType: 'Hitter',
        stage: 'pre_debut',
        ageMin: 20,
        ageMax: 22,
        ageWindow: 1,
        level: 'AA',
      },
    },
    historicalPace: null,
    warnings: ['current_census_descriptive_only'],
  },
}

const player: PlayerRecord = {
  id: 'canonical-1',
  name: 'Actual Player',
  initials: 'AP',
  organization: 'Example Club',
  organizationCode: 'EX',
  position: 'SS',
  playerType: 'Hitter',
  stage: 'pre_debut',
  age: 21,
  level: 'AA',
  batsThrows: 'R/R',
  psScore: 98,
  psPercentile: 99,
  opportunity: { label: 'PA', value: '240' },
  metrics: [],
  coverage: {
    hasStatcast: true,
    hasTraditional: true,
    hasComplementaryRows: false,
    levelsObserved: ['AA'],
    organizationConflict: false,
    label: 'Tracking + traditional',
  },
  provenance: {
    source: 'Prospect Savant',
    dataset: 'Minor League Leaders',
    season: 2026,
    retrievedAt: '2026-07-11T00:00:00.000Z',
    cohort: { pitchQualifier: 1, minAge: 16, maxAge: 40 },
    externalIds: { mlbam: '123' },
  },
  researchEstimate: null,
  careerForecast: forecast,
}

describe('unified Oracle Board shell', () => {
  it('hydrates cached v1 maps from the fixed forecast universe instead of the legacy active universe', () => {
    const rankedPlayer = {
      ...player,
      milbImpactRanking,
      careerForecast: {
        ...forecast,
        rank: 2,
        lineage: { ...forecast.lineage, artifactRank: 7 },
      } as CareerForecast,
    }
    const legacyV1Map = buildPlayerMap(rankedPlayer, { minorUniverse: 4319 })
    const {
      careerIndex: _careerIndex,
      stageStanding: _stageStanding,
      ...legacyFields
    } = legacyV1Map
    const hydrated = playerMapFor({
      ...rankedPlayer,
      playerMap: {
        ...legacyFields,
        version: 'oracle-player-map/v1',
        claimStatus: 'research_rank_only',
        comparableWithinStageOnly: true,
      } as unknown as PlayerRecord['playerMap'],
    })

    expect(hydrated.version).toBe(PLAYER_MAP_VERSION)
    expect(hydrated.careerIndex.value).toBe(61.1)
    expect(hydrated.claimStatus).toBe('research_only')
    expect(JSON.stringify(hydrated)).not.toContain('comparableWithinStageOnly')
    expect(hydrated.stageStanding).toMatchObject({
      rank: 7,
      universe: 6455,
      cohort: 'prospect_forecast',
    })
    expect(hydrated.stageStanding.topPercent).toBeCloseTo(0.1084, 4)
  })

  it('opens Directory as a noncompetitive five-column player table', () => {
    const onChangeFilters = vi.fn()
    render(
      <ProspectBoard
        players={[player]}
        selectedId={player.id}
        filters={{ query: '', stage: 'All', playerType: 'All', level: 'All', sort: 'name' }}
        pagination={{ page: 1, limit: 50, total: 1, totalPages: 1 }}
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onChangeFilters={onChangeFilters}
        onChangePage={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'All Players' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Directory' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Prospects' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rookie Track' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Player / Career Index',
      'Stage standing',
      'Career projection',
      'Current signal',
      'Evidence',
    ])
    expect(screen.getByLabelText('Career Index 61.1')).toBeInTheDocument()
    expect(screen.getByText('24.0')).toBeInTheDocument()
    expect(screen.getByText('Middle career WAR · high case 65.0 · arrival age —')).toBeInTheDocument()
    expect(screen.getByText('Not confirmed')).toBeInTheDocument()
    expect(screen.getByText('Identity only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Landscape' })).not.toBeInTheDocument()
    expect(screen.queryByText('61.0%')).not.toBeInTheDocument()
    expect(screen.queryByText('PS Score')).not.toBeInTheDocument()
    expect(screen.queryByText('Peer signal')).not.toBeInTheDocument()

    expect(screen.getByRole('option', { name: 'Player name' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Youngest first' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Career Index' })).not.toBeInTheDocument()
    expect(screen.getByText(/Directory, not a combined leaderboard/u)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'MLB' }))
    expect(onChangeFilters).toHaveBeenCalledWith({ stage: 'MLB', level: 'All', sort: 'careerIndex' })

    fireEvent.click(screen.getByRole('button', { name: 'Rookie Track' }))
    expect(onChangeFilters).toHaveBeenCalledWith({
      stage: 'RC',
      level: 'All',
      sort: 'careerIndex',
    })
  })

  it('disables the minor-league level filter in the MLB view', () => {
    render(
      <ProspectBoard
        players={[]}
        selectedId={null}
        filters={{ query: '', stage: 'MLB', playerType: 'All', level: 'All', sort: 'hofProbability' }}
        pagination={{ page: 1, limit: 50, total: 0, totalPages: 0 }}
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onChangeFilters={vi.fn()}
        onChangePage={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Level' })).toBeDisabled()
    expect(screen.getByText('No matching MLB players')).toBeInTheDocument()
  })

  it('keeps a frozen prospect Career Index while Rookie Track shows MLB evidence separately', () => {
    const rookieTrackPlayer: PlayerRecord = {
      ...player,
      id: 'joe-mack',
      name: 'Joe Mack',
      initials: 'JM',
      organization: 'Miami Marlins',
      organizationCode: 'MIA',
      position: 'C',
      stage: 'recent_callup',
      age: 23,
      level: 'MLB',
      opportunity: { label: 'PA', value: '172' },
      careerForecast: null,
      recentCallup: {
        version: 'rookie-track-v1',
        status: 'monitoring',
        reason: 'first_mlb_season_partial_only',
        prospectPrior: {
          rank: 167,
          universe: 6455,
          target: 'runway_adjusted_career_ceiling',
          asOf: '2025-12-31T00:00:00.000Z',
          forecast: {
            ...forecast,
            rank: 167,
            finalCareerWar: { p10: 0.2, p25: 1.5, p50: 4.8, p75: 8.4, p90: 13 },
          },
        },
        currentMlbEvidence: {
          asOf: '2026-07-12T00:00:00.000Z',
          opportunity: { label: 'PA', value: '172' },
          war: 1,
          warPercentile: 72.7,
        },
      },
    }

    const { unmount } = render(
      <ProspectBoard
        players={[rookieTrackPlayer]}
        selectedId={null}
        filters={{ query: 'Joe Mack', stage: 'RC', playerType: 'All', level: 'All', sort: 'alphaOpportunity' }}
        pagination={{ page: 1, limit: 50, total: 1, totalPages: 1 }}
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onChangeFilters={vi.fn()}
        onChangePage={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Rookie Track' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Level' })).toBeDisabled()
    expect(screen.getByLabelText('Career Index 24')).toBeInTheDocument()
    expect(screen.getByText('#167')).toBeInTheDocument()
    expect(screen.getByText('Top 2.6% of 6,455 frozen prospect priors')).toBeInTheDocument()
    expect(screen.getByText('4.8')).toBeInTheDocument()
    expect(screen.getByText('Middle career WAR · high case 13.0')).toBeInTheDocument()
    expect(screen.getByText('Solid MLB start')).toBeInTheDocument()
    expect(screen.getByText('1.0 WAR · P73 · 172 PA')).toBeInTheDocument()
    expect(screen.getByText('Building evidence')).toBeInTheDocument()
    expect(screen.getByText('172 PA of MLB evidence')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Next 3-year upside' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Projected career WAR' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'MLB arrival research rank' })).not.toBeInTheDocument()

    unmount()
    render(
      <PlayerDossier
        player={rookieTrackPlayer}
        onReturnToBoard={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Rookie Track' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Frozen prospect Career Index 24' })).toBeInTheDocument()
    expect(screen.getByText(/frozen prospect Career Index stays in place while major-league evidence accumulates/u)).toBeInTheDocument()
    expect(screen.getAllByText('Evidence update, not a re-score').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: 'MLB sample progress 57%' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /watch/u })).not.toBeInTheDocument()
  })

  it('keeps an unmatched call-up visible without inventing a prospect score', () => {
    const unmatchedRookie: PlayerRecord = {
      ...player,
      id: 'coverage-gap-rookie',
      name: 'Coverage Gap Rookie',
      stage: 'recent_callup',
      level: 'MLB',
      opportunity: { label: 'PA', value: '90' },
      careerForecast: null,
      recentCallup: {
        version: 'rookie-track-v1',
        status: 'monitoring',
        reason: 'first_mlb_season_partial_only',
        prospectPrior: null,
        currentMlbEvidence: {
          asOf: '2026-07-12T00:00:00.000Z',
          opportunity: { label: 'PA', value: '90' },
          war: 0.4,
          warPercentile: 58,
        },
      },
    }

    const { unmount } = render(
      <ProspectBoard
        players={[unmatchedRookie]}
        selectedId={null}
        filters={{ query: '', stage: 'RC', playerType: 'All', level: 'All', sort: 'alphaOpportunity' }}
        pagination={{ page: 1, limit: 50, total: 1, totalPages: 1 }}
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onChangeFilters={vi.fn()}
        onChangePage={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Career Index --')).toBeInTheDocument()
    expect(screen.getByText('Prospect prior not matched')).toBeInTheDocument()
    expect(screen.getByText('Career projection available after the prospect prior is matched')).toBeInTheDocument()
    expect(screen.getByText('Solid MLB start')).toBeInTheDocument()

    unmount()
    render(<PlayerDossier player={unmatchedRookie} onReturnToBoard={vi.fn()} />)

    expect(screen.getByText(/remains visible in Rookie Track/u)).toBeInTheDocument()
    expect(screen.getAllByText('Prospect prior not matched').length).toBeGreaterThan(0)
    expect(screen.getByText(/Career Index stays unavailable until an exact frozen prospect identity match/u)).toBeInTheDocument()
  })

  it('filters by complete team and tokenized position facets and clears the cohort', () => {
    const onChangeFilters = vi.fn()
    render(
      <ProspectBoard
        players={[]}
        selectedId={null}
        filters={{
          query: '',
          stage: 'Minors',
          playerType: 'All',
          level: 'All',
          team: 'ATH',
          position: 'C',
          sort: 'alphaOpportunity',
        }}
        pagination={{ page: 1, limit: 50, total: 0, totalPages: 0 }}
        loading={false}
        error={null}
        facets={{
          teams: [
            { value: 'ATH', label: 'Athletics (ATH)', count: 12 },
            { value: 'BOS', label: 'Boston Red Sox (BOS)', count: 8 },
          ],
          positions: [
            { value: 'C', label: 'C', count: 7 },
            { value: 'SS', label: 'SS', count: 14 },
          ],
        }}
        onSelect={vi.fn()}
        onChangeFilters={onChangeFilters}
        onChangePage={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Team' })).toHaveValue('ATH')
    expect(screen.getByRole('option', { name: 'Boston Red Sox (BOS) · 8' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Position' }), {
      target: { value: 'SS' },
    })
    expect(onChangeFilters).toHaveBeenCalledWith({ position: 'SS' })

    fireEvent.click(screen.getByRole('button', { name: 'Clear 2' }))
    expect(onChangeFilters).toHaveBeenCalledWith({
      query: '',
      playerType: 'All',
      level: 'All',
      team: 'All',
      position: 'All',
    })
  })

  it('keeps an MLB model signal separate when the active stage universe is unavailable', () => {
    render(
      <ProspectBoard
        players={[{
          ...player,
          stage: 'early_mlb',
          level: 'MLB',
          careerForecast: { ...forecast, careerChapter: chapter, alphaSignal },
        }]}
        selectedId={player.id}
        filters={{ query: '', stage: 'MLB', playerType: 'All', level: 'All', sort: 'alphaOpportunity' }}
        pagination={{ page: 1, limit: 50, total: 1, totalPages: 1 }}
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onChangeFilters={vi.fn()}
        onChangePage={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Launch / breakout')).toHaveLength(2)
    expect(screen.queryByText('#7')).not.toBeInTheDocument()
    expect(screen.getByText('24.0')).toBeInTheDocument()
    expect(screen.getByText('Middle career WAR · high case 65.0')).toBeInTheDocument()
    expect(screen.getByText('— career WAR to date')).toBeInTheDocument()
    expect(screen.getByText('Moderate')).toBeInTheDocument()
    expect(screen.queryByText(/#4 of 512/u)).not.toBeInTheDocument()
  })

  it('shows probability-free, dual-gated MiLB ceiling rank on the board', async () => {
    render(
      <ProspectBoard
        players={[{ ...player, milbAlphaSignal, milbImpactRanking }]}
        selectedId={player.id}
        filters={{ query: '', stage: 'Minors', playerType: 'All', level: 'All', sort: 'alphaOpportunity' }}
        pagination={{ page: 1, limit: 50, total: 1, totalPages: 1 }}
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onChangeFilters={vi.fn()}
        onChangePage={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Prospect Rankings' })).toBeInTheDocument()
    expect(screen.getByLabelText('Career Index 61.1')).toBeInTheDocument()
    expect(screen.getByText('#7')).toBeInTheDocument()
    expect(screen.getByText('Top 0.11% of 6,455 frozen prospect forecasts')).toBeInTheDocument()
    expect(screen.getByText('24.0')).toBeInTheDocument()
    expect(screen.getByText('Middle career WAR · high case 65.0 · arrival age —')).toBeInTheDocument()
    expect(screen.getByText('Arrival rank #5')).toBeInTheDocument()
    expect(screen.getByText('Identity only')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ceiling & age advantage' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }))
    expect(await screen.findByRole('heading', { name: 'Ceiling & age advantage' })).toBeInTheDocument()
    expect(screen.getByText('1 on this table page')).toBeInTheDocument()
    expect(screen.getByText('Upper-right standouts')).toBeInTheDocument()
    expect(screen.queryByText('+73.0 pp')).not.toBeInTheDocument()
  })

  it('maps a high-impact MiLB player even when arrival confirmation is not cleared', () => {
    const aivaSignal: NonNullable<PlayerRecord['milbAlphaSignal']> = {
      ...milbAlphaSignal,
      eligible: false,
      tier: 'none',
      rank: null,
      rankScope: null,
      ageContext: {
        ...milbAlphaSignal.ageContext!,
        age: 22.21,
        percentileWithinRoleLevel: 16.46,
        youngerThanPercent: 83.54,
        referencePlayers: 1985,
        priorLevel: 'Adv A',
      },
      gates: {
        ...milbAlphaSignal.gates,
        minimumPrimaryProbability: false,
        positivePrimaryModelEdge: false,
        positiveLongHorizonModelEdge: false,
      },
    }
    const aivaImpact: NonNullable<PlayerRecord['milbImpactRanking']> = {
      ...milbImpactRanking,
      rank: 258,
      rankPercentile: 96.017973,
    }
    const aiva: PlayerRecord = {
      ...player,
      name: 'Aiva Arquette',
      initials: 'AA',
      organization: 'Miami Marlins',
      organizationCode: 'MIA',
      age: 22,
      level: 'AA',
      opportunity: { label: 'PA', value: '122' },
      milbAlphaSignal: aivaSignal,
      milbImpactRanking: aivaImpact,
      careerForecast: {
        ...forecast,
        rank: 258,
        decomposition: { ...forecast.decomposition, estimatedDebutAge: 23 },
      },
      minorTraitEvidence: aivaTraits,
    }

    const { unmount } = render(
      <ProspectBoard
        players={[aiva]}
        selectedId={aiva.id}
        filters={{ query: 'Aiva', stage: 'Minors', playerType: 'All', level: 'All', sort: 'alphaOpportunity' }}
        pagination={{ page: 1, limit: 50, total: 1, totalPages: 1 }}
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onChangeFilters={vi.fn()}
        onChangePage={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Aiva Arquette').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Career Index 61.1')).toBeInTheDocument()
    expect(screen.getByText('#258')).toBeInTheDocument()
    expect(screen.getByText('Top 4.0% of 6,455 frozen prospect forecasts')).toBeInTheDocument()
    expect(screen.getByText('24.0')).toBeInTheDocument()
    expect(screen.getByText('Middle career WAR · high case 65.0 · arrival age 23')).toBeInTheDocument()
    expect(screen.getByText('Not confirmed')).toBeInTheDocument()
    expect(screen.getByText('2 / 4 data areas')).toBeInTheDocument()
    expect(screen.queryByText('Not ranked')).not.toBeInTheDocument()
    expect(screen.queryByText('Not triggered')).not.toBeInTheDocument()

    unmount()
    render(
      <PlayerDossier
        player={aiva}
        onReturnToBoard={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Projected career outlook' })).toBeInTheDocument()
    expect(screen.getByText(/A Career Index of 61\.1 summarizes Aiva Arquette's modeled career magnitude/u)).toBeInTheDocument()
    expect(screen.getByText('Not yet confirmed')).toBeInTheDocument()
    expect(screen.getAllByText('Age 23').length).toBeGreaterThan(0)
    expect(screen.getByText('2 / 4 data areas')).toBeInTheDocument()
    expect(screen.getByText('High upside, longer path')).toBeInTheDocument()
    expect(screen.getByText('Early signal')).toBeInTheDocument()
    expect(screen.getAllByText('Whiff rate').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Walk rate').length).toBeGreaterThan(0)
    expect(screen.getByText('28 more plate appearances for a fuller current-season sample')).toBeInTheDocument()
    expect(screen.getByText('Three separate readings.')).toBeInTheDocument()
  })

  it('explains the MiLB impact rank, dual gates, and withheld tail probability in the dossier', () => {
    render(
      <PlayerDossier
        player={{ ...player, milbAlphaSignal, milbImpactRanking }}
        onReturnToBoard={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Five-Year Impact Radar' })).toBeInTheDocument()
    expect(screen.getByText('#3 of 6,455')).toBeInTheDocument()
    expect(screen.getByText(/8\.10x model-wide top-decile lift/u)).toBeInTheDocument()
    expect(screen.getByText('88%')).toBeInTheDocument()
    expect(screen.getByText('Impact top decile')).toBeInTheDocument()
    expect(screen.getByText('Tail calibrated')).toBeInTheDocument()
    expect(screen.getByText(/raw impact probability is intentionally withheld/u)).toBeInTheDocument()
    expect(screen.queryByText('+73.0 pp')).not.toBeInTheDocument()
  })

  it('keeps failed-calibration arrival scores out of the primary dossier', () => {
    render(
      <PlayerDossier
        player={{
          ...player,
          milbAlphaSignal,
          milbImpactRanking,
          researchEstimate: {
            status: 'research_only',
            releaseEligible: false,
            asOf: '2025-12-31T00:00:00.000Z',
            modelVersion: 'arrival-test',
            snapshotId: 'snapshot-test',
            coldStart: false,
            priorLevel: 'AA',
            modelAge: 20.4,
            currentStatusVerified: false,
            horizons: [
              {
                months: 36,
                probability: 0.9999,
                baselineProbability: 0.18,
                externallyValidated: false,
                externalEvaluationStatus: 'failed_release_gate',
              },
            ],
            lineage: {
              predictionManifestSha256: 'a'.repeat(64),
              evaluationReportSha256: 'b'.repeat(64),
            },
          },
        }}
        onReturnToBoard={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Arrival model audit' })).toBeInTheDocument()
    expect(screen.getByText('Research arrival rank · exact probability unavailable')).toBeInTheDocument()
    expect(screen.queryByText('100.0%')).not.toBeInTheDocument()
    expect(screen.getAllByText('Not passed')).toHaveLength(3)
  })

  it('shows the runway-adjusted prospect bridge without presenting a full simulated arc', () => {
    render(
      <PlayerDossier
        player={player}
        onReturnToBoard={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Prospect career projection' })).toBeInTheDocument()
    expect(screen.getByText(/expected MLB arrival age into the career outlook/u)).toBeInTheDocument()
    expect(screen.getByText('HIGH CAREER CASE')).toBeInTheDocument()
    expect(screen.getByText('Research bridge, not a finished career simulation')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /HOF CALIBER/u })).not.toBeInTheDocument()
    expect(screen.queryByText('FINAL CAREER WAR')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Projected career arc' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Five-Year Impact Radar' })).toBeInTheDocument()
    expect(screen.getByText('Impact rank unavailable')).toBeInTheDocument()
  })

  it('separates a learned career chapter and near-term event from the Hall outcome', () => {
    render(
      <PlayerDossier
        player={{
          ...player,
          stage: 'early_mlb',
          age: 23,
          level: 'MLB',
          careerForecast: {
            ...forecast,
            hofCaliberProbability: 0.16,
            cumulativeWar: 8.67,
            careerChapter: chapter,
            alphaSignal,
            relativeSignal: {
              version: 'relative-standing-v1',
              kind: 'hall_track',
              status: 'research',
              currentPeer: {
                percentile: 98.4,
                rank: 2,
                cohortSize: 63,
                value: 0.16,
                median: 0.012,
                difference: 0.148,
                basis: 'hof_caliber_probability',
                reliability: 'moderate',
                cohort: {
                  scope: 'current_census',
                  label: 'Ages 22–24 early MLB hitters',
                  playerType: 'Hitter',
                  stage: 'early_mlb',
                  ageMin: 22,
                  ageMax: 24,
                  ageWindow: 1,
                  level: 'MLB',
                },
              },
              historicalPace: {
                percentile: 99.1,
                cohortSize: 804,
                playerValue: 5.04,
                metric: 'career_war_to_date',
                reliability: 'high',
                featureSeason: 2025,
                featureAge: 22,
                cohort: {
                  scope: 'historical_point_in_time',
                  label: 'Age 21–23 first-season hitters',
                  role: 'Hitter',
                  stageBand: 'first',
                  seasonNumberMin: 1,
                  seasonNumberMax: 1,
                  ageMin: 21,
                  ageMax: 23,
                  ageWindow: 1,
                  resolvedOnly: true,
                },
              },
              warnings: ['historical_pace_resolved_careers_only'],
            },
          },
        }}
        onReturnToBoard={vi.fn()}
      />,
    )

    expect(screen.queryByRole('img', { name: /HOF CALIBER/u })).not.toBeInTheDocument()
    expect(screen.getByText('CAREER WAR RECORDED')).toBeInTheDocument()
    expect(screen.getByText('Priority model alpha')).toBeInTheDocument()
    expect(screen.getByText('+14.8 pp')).toBeInTheDocument()
    expect(screen.getByText(/16\.0% modeled vs 1\.2% historical/u)).toBeInTheDocument()
    expect(screen.getByText(/13\.3× lift/u)).toBeInTheDocument()
    expect(screen.getByText('+8.4 JAWS')).toBeInTheDocument()
    expect(screen.getByText('5.0 years')).toBeInTheDocument()
    expect(screen.getByText('Market price not modeled.')).toBeInTheDocument()
    expect(screen.getByText('Launch / breakout')).toBeInTheDocument()
    expect(screen.getByText('breakout · hitter track')).toBeInTheDocument()
    expect(screen.getByText('P(3Y IMPACT)')).toBeInTheDocument()
    expect(screen.getAllByText('43.0%')).toHaveLength(3)
    expect(screen.getByText('HISTORICAL WAR PACE')).toBeInTheDocument()
    expect(screen.getAllByText('P99.1')).toHaveLength(1)
    expect(screen.getByText('99th percentile')).toBeInTheDocument()
    expect(screen.getByText('+0.8 WAR')).toBeInTheDocument()
    expect(screen.getByText(/67\.0% continuation/u)).toBeInTheDocument()
    expect(screen.getByText(/Through 2025 · age 22 · MLB season 1 · 5\.0 season WAR/u)).toBeInTheDocument()
    expect(screen.getByText(/P\(3Y impact\) is not a Hall-caliber probability/u)).toBeInTheDocument()
    expect(screen.queryByText('#2 of 63 · moderate reliability')).not.toBeInTheDocument()
  })

  it('distinguishes an unavailable live rank from a withheld forecast', () => {
    render(
      <PlayerDossier
        player={{
          ...player,
          careerForecast: {
            ...forecast,
            rank: null,
            warnings: ['current_universe_rank_unavailable'],
          },
        }}
        onReturnToBoard={vi.fn()}
      />,
    )

    expect(screen.getByText('CAREER INDEX 61.1 · STAGE STANDING PENDING')).toBeInTheDocument()
    expect(screen.getAllByText('Stage standing unavailable').length).toBeGreaterThan(0)
    expect(screen.queryByText('CAREER FORECAST WITHHELD')).not.toBeInTheDocument()
  })
})
