// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { CareerForecast, PlayerRecord } from '../domain/forecast'
import { PlayerDossier } from './PlayerDossier'
import { ProspectBoard } from './ProspectBoard'

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
  it('shows the career ranking columns and excludes provider composites', () => {
    const onChangeFilters = vi.fn()
    render(
      <ProspectBoard
        players={[player]}
        selectedId={player.id}
        filters={{ query: '', stage: 'All', playerType: 'All', level: 'All', sort: 'hofProbability' }}
        pagination={{ page: 1, limit: 50, total: 1, totalPages: 1 }}
        loading={false}
        error={null}
        watchlist={new Set()}
        onSelect={vi.fn()}
        onToggleWatchlist={vi.fn()}
        onChangeFilters={onChangeFilters}
        onChangePage={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Oracle Board' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Minors' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'P(HOF caliber)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Career chapter' })).toBeInTheDocument()
    expect(screen.getByText('8.1%')).toBeInTheDocument()
    expect(screen.getByText('Upper-minors development')).toBeInTheDocument()
    expect(screen.getByText('P(MLB · 36m) 61.0%')).toBeInTheDocument()
    expect(screen.queryByText('PS Score')).not.toBeInTheDocument()
    expect(screen.queryByText('Peer signal')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Rank by' }), {
      target: { value: 'nearTermImpact' },
    })
    expect(onChangeFilters).toHaveBeenCalledWith({ sort: 'nearTermImpact' })

    fireEvent.click(screen.getByRole('button', { name: 'MLB' }))
    expect(onChangeFilters).toHaveBeenCalledWith({ stage: 'MLB', level: 'All' })
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
        watchlist={new Set()}
        onSelect={vi.fn()}
        onToggleWatchlist={vi.fn()}
        onChangeFilters={vi.fn()}
        onChangePage={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Level' })).toBeDisabled()
    expect(screen.getByText('No matching MLB players')).toBeInTheDocument()
  })

  it('shows MLB chapter and absolute three-year impact without a current-census rank', () => {
    render(
      <ProspectBoard
        players={[{
          ...player,
          stage: 'early_mlb',
          level: 'MLB',
          careerForecast: { ...forecast, careerChapter: chapter },
        }]}
        selectedId={player.id}
        filters={{ query: '', stage: 'MLB', playerType: 'All', level: 'All', sort: 'nearTermImpact' }}
        pagination={{ page: 1, limit: 50, total: 1, totalPages: 1 }}
        loading={false}
        error={null}
        watchlist={new Set()}
        onSelect={vi.fn()}
        onToggleWatchlist={vi.fn()}
        onChangeFilters={vi.fn()}
        onChangePage={vi.fn()}
      />,
    )

    expect(screen.getByText('Launch / breakout')).toBeInTheDocument()
    expect(screen.getByText('P(3Y impact) 43.0%')).toBeInTheDocument()
    expect(screen.queryByText(/#4 of 512/u)).not.toBeInTheDocument()
  })

  it('leads the dossier with unconditional career output and rank-independent confidence', () => {
    render(
      <PlayerDossier
        player={player}
        saved={false}
        onToggleWatchlist={vi.fn()}
        onReturnToBoard={vi.fn()}
      />,
    )

    expect(screen.getByText('60M LOWER-BOUND OUTCOME')).toBeInTheDocument()
    expect(screen.getByText('#7 among live minors')).toBeInTheDocument()
    expect(screen.getByText('#7 MINORS RESEARCH RANK')).toBeInTheDocument()
    expect(screen.getByText('Moderate confidence')).toBeInTheDocument()
    expect(screen.getByText(/never multiplied into the ranking probability/u)).toBeInTheDocument()
    expect(screen.getByText('P(HOF caliber | MLB)')).toBeInTheDocument()
    expect(screen.getByText('Research only.')).toBeInTheDocument()
    expect(screen.getByText(/\+2\.4 JAWS support extension/u)).toBeInTheDocument()
    expect(screen.getByText(/not observed player value/u)).toBeInTheDocument()
    expect(screen.getByText(
      "The comparison uses the player's career-to-date role/position standard and rebaselines if that classification changes.",
    )).toBeInTheDocument()
    expect(screen.getByText(/heuristic evidence and uncertainty summary/u)).toBeInTheDocument()
    expect(screen.getByText(/does not inherit the tournament metrics/u)).toBeInTheDocument()
    expect(screen.getByText(/P95\/P99 and elite-tail validation remain pending/u)).toBeInTheDocument()
    expect(screen.getByText(/rebaselines the forecast if that classification changes/u)).toBeInTheDocument()
    expect(screen.getByText(/partial-only scoring is unvalidated/u)).toBeInTheDocument()
    expect(screen.getByText(/Partial-season statistics are context only/u)).toBeInTheDocument()
    expect(screen.getByText(/latest completed-season feature state is stale/u)).toBeInTheDocument()
    expect(screen.getByText(/No current MLB opportunity is observed/u)).toBeInTheDocument()
    expect(screen.getByText(/young, high-performance distribution slice/u)).toBeInTheDocument()
    expect(screen.getByText(/completed careers ending by 2007/u)).toBeInTheDocument()
    expect(screen.getByText(/early-career peak-seven interval/u)).toBeInTheDocument()
    expect(screen.getByText(/retrospective development holdout/u)).toBeInTheDocument()
    expect(screen.getByText(/Prospective validation is not complete/u)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Career chapter' })).toBeInTheDocument()
    expect(screen.getByText('Upper-minors development')).toBeInTheDocument()
    expect(screen.getByText('P(MLB · 36M)')).toBeInTheDocument()
    expect(screen.getByText(/MLB career chapter begins only after supported completed-season/u)).toBeInTheDocument()
    expect(screen.queryByText('Ahead of the curve')).not.toBeInTheDocument()
    expect(screen.queryByText('#4 of 512 · moderate reliability')).not.toBeInTheDocument()
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
        saved={false}
        onToggleWatchlist={vi.fn()}
        onReturnToBoard={vi.fn()}
      />,
    )

    expect(screen.getByRole('img', { name: 'HOF CALIBER: 16%' })).toBeInTheDocument()
    expect(screen.getByText('Launch / breakout')).toBeInTheDocument()
    expect(screen.getByText('breakout · hitter track')).toBeInTheDocument()
    expect(screen.getByText('P(3Y IMPACT)')).toBeInTheDocument()
    expect(screen.getByText('43.0%')).toBeInTheDocument()
    expect(screen.getByText('HISTORICAL WAR PACE')).toBeInTheDocument()
    expect(screen.getByText('P99.1')).toBeInTheDocument()
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
        saved={false}
        onToggleWatchlist={vi.fn()}
        onReturnToBoard={vi.fn()}
      />,
    )

    expect(screen.getByText('CURRENT RANK UNAVAILABLE')).toBeInTheDocument()
    expect(screen.getByText('Rank unavailable')).toBeInTheDocument()
    expect(screen.queryByText('CAREER FORECAST WITHHELD')).not.toBeInTheDocument()
  })
})
