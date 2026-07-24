// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import {
  buildBinderScore,
  type BinderScoreFeedItem,
  type BinderScoresResponse,
} from '../domain/binderScore'
import { BinderBoard } from './BinderBoard'
import { BinderScorePanel } from './BinderScorePanel'

afterEach(cleanup)

const assessment = buildBinderScore({
  player: {
    id: 'player-1',
    name: 'Example Star',
    age: 23,
    route: 'early_mlb',
  },
  baseball: {
    careerIndex: 96,
    routeOutcomePercentile: 94,
    freshness: {
      status: 'current',
      dataAsOf: '2026-07-23',
    },
  },
  market: {
    sourcePlayerName: 'Example Star',
    identityStatus: 'unique_normalized_name',
    trailingTwelveMonthDemandPercentile: 92,
    monthlySalesUsd: [
      100_000,
      110_000,
      105_000,
      115_000,
      120_000,
      125_000,
      130_000,
      135_000,
      140_000,
      145_000,
      150_000,
      155_000,
    ],
    freshness: {
      status: 'current',
      dataAsOf: '2026-06-30',
    },
    cohortId: 'gemrate-baseball-2026-06',
  },
})

const item: BinderScoreFeedItem = {
  recordVersion: 'binder-score-item/v1',
  player: {
    id: 'player-1',
    name: 'Example Star',
    mlbamId: '123',
    age: 23,
    stage: 'early_mlb',
    playerType: 'Hitter',
    organization: 'Example Club',
    organizationCode: 'EX',
    position: 'OF',
    level: 'MLB',
  },
  assessment,
}

const response: Pick<BinderScoresResponse, 'snapshot' | 'meta'> = {
  snapshot: {
    id: 'binder-2026-06',
    baseballDataAsOf: '2026-07-23',
    baseballFreshness: {
      status: 'current',
      reasonCodes: [],
      cadence: 'completed_season',
    },
    marketDataThrough: '2026-06-30',
    marketPublishedAt: '2026-07-12',
    marketAcquiredAt: '2026-07-24',
    marketFreshness: {
      status: 'current',
      reasonCodes: [],
      nextExpectedBy: '2026-08-15',
      cadence: 'monthly',
    },
  },
  meta: {
    researchOnly: true,
    investmentAdvice: false,
    marketSource: 'GemRate Athlete Sales Trends',
    marketMeasure: 'completed_ebay_singles_sales_volume_usd',
    marketMeaning:
      'collector_demand_is_an_ebay_singles_sales_volume_proxy_not_price_appreciation',
    careerMeaning:
      'career_evidence_is_statistical_hall_caliber_trajectory_not_hof_election_odds',
    identityPolicy:
      'exact_oracle_identity_plus_unique_normalized_gemrate_name_no_fuzzy_matching',
    nullPolicy: 'missing_evidence_shrinks_to_prior_and_withholds_action',
    rankingScope: 'cross_stage_research_heuristic',
    sourceRows: 2_060,
    ambiguousSourceKeys: 1,
    matchedUniversePlayers: 1,
    actionableUniversePlayers: 1,
    permissionAttestation: 'docs/permissions/GEMRATE_ATTESTATION.md',
  },
}

describe('Build a Binder UI', () => {
  it('renders the research ranking, freshness, and accessible controls', () => {
    const onSelect = vi.fn()
    const onQueryChange = vi.fn()

    render(
      <BinderBoard
        items={[item]}
        response={response}
        page={{ page: 1, limit: 50, total: 1, totalPages: 1 }}
        loading={false}
        error={null}
        query=""
        stage="All"
        selectedId={null}
        onQueryChange={onQueryChange}
        onStageChange={vi.fn()}
        onPageChange={vi.fn()}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Build a Binder' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Binder Score' })).toBeInTheDocument()
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    expect(screen.getByText(/not card appreciation or card-level scarcity\/value/u)).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search players' }), {
      target: { value: 'star' },
    })
    expect(onQueryChange).toHaveBeenCalledWith('star')

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open Build a Binder research for Example Star',
      }),
    )
    expect(onSelect).toHaveBeenCalledWith('player-1')
  })

  it('explains score weights, identity confidence, and model limits', () => {
    render(<BinderScorePanel result={assessment} />)

    expect(screen.getByRole('heading', { name: 'Score components' })).toBeInTheDocument()
    expect(screen.getByText('75% overall weight')).toBeInTheDocument()
    expect(screen.getByText('Unique normalized name · provisional')).toBeInTheDocument()
    expect(
      screen.getByText(/Statistical Hall-caliber trajectory, not Hall of Fame election odds/u),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/card-level scarcity and value are not modeled/u),
    ).toBeInTheDocument()
  })
})
