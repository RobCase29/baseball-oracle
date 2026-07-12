// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { CareerForecast, PlayerRecord } from '../domain/forecast'
import { PlayerDossier } from './PlayerDossier'
import { ProspectBoard } from './ProspectBoard'

afterEach(cleanup)

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
    expect(screen.getByText('8.1%')).toBeInTheDocument()
    expect(screen.queryByText('PS Score')).not.toBeInTheDocument()
    expect(screen.queryByText('99th')).not.toBeInTheDocument()

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
