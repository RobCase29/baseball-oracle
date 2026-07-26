import { Fragment, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import {
  type BinderGraduationBand,
  type BinderGraduationBlocker,
  type BinderGraduationSortKey,
} from '../domain/binderGraduationIndex'
import type {
  BinderGraduationSport,
  BinderGraduationV2Item,
  BinderGraduationV2Response,
} from '../domain/binderGraduationIndexV2'
import './cross-sport-player-workbench.css'

export type PlayerRankingAgeCeiling = 'all' | 23 | 26 | 30
export type PlayerRankingBand = BinderGraduationBand | 'all'
export type PlayerRankingPosition = string | 'all'

interface CrossSportPlayerWorkbenchProps {
  response: BinderGraduationV2Response | null
  loading: boolean
  error: string | null
  sport: BinderGraduationSport | 'all'
  search: string
  maxAge: PlayerRankingAgeCeiling
  position: PlayerRankingPosition
  band: PlayerRankingBand
  sort: BinderGraduationSortKey
  page: number
  onMaxAgeChange: (value: PlayerRankingAgeCeiling) => void
  onPositionChange: (value: PlayerRankingPosition) => void
  onBandChange: (value: PlayerRankingBand) => void
  onSortChange: (value: BinderGraduationSortKey) => void
  onPageChange: (value: number) => void
  onReset: () => void
}

const ageOptions: ReadonlyArray<{
  value: PlayerRankingAgeCeiling
  label: string
}> = [
  { value: 'all', label: 'All ages' },
  { value: 23, label: 'Age ≤23' },
  { value: 26, label: 'Age ≤26' },
  { value: 30, label: 'Age ≤30' },
]

const bandOptions: ReadonlyArray<{
  value: PlayerRankingBand
  label: string
}> = [
  { value: 'all', label: 'All paths' },
  { value: 'on_deck', label: 'On Deck' },
  { value: 'approaching', label: 'Approaching' },
  { value: 'developing', label: 'Developing' },
  { value: 'long_range', label: 'Long Range' },
  { value: 'graduated', label: 'Already on board' },
  { value: 'withheld', label: 'Withheld' },
]

const sortOptions: ReadonlyArray<{
  value: BinderGraduationSortKey
  label: string
}> = [
  { value: 'graduation_rank', label: 'Graduation rank' },
  { value: 'graduation_index', label: 'Graduation Index' },
  { value: 'market_readiness', label: 'Market readiness' },
  { value: 'player_outlook', label: 'Player outlook' },
  { value: 'ttm_sales', label: 'TTM demand' },
  { value: 'current_run_rate', label: 'Current run rate' },
  { value: 'age', label: 'Age' },
  { value: 'name', label: 'Player name' },
]

const defaultPositions: Record<
  BinderGraduationSport | 'all',
  readonly string[]
> = {
  all: [
    'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH',
    'QB', 'RB', 'WR', 'TE', 'PG', 'SG', 'SF', 'PF',
  ],
  baseball: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'],
  football: ['QB', 'RB', 'WR', 'TE'],
  basketball: ['PG', 'SG', 'SF', 'PF', 'C'],
}

const bandLabels: Record<BinderGraduationBand, string> = {
  graduated: 'On Build Board',
  on_deck: 'On Deck',
  approaching: 'Approaching',
  developing: 'Developing',
  long_range: 'Long Range',
  withheld: 'Withheld',
}

const blockerLabels: Record<BinderGraduationBlocker, string> = {
  already_on_build_board: 'Already cleared the Build standard',
  ttm_scale: 'Trailing demand is the binding gate',
  current_run_rate: 'Current demand run rate is the binding gate',
  master_score: 'Binder Index is the binding gate',
  global_top_one_percent: 'Observed top-1% demand is not yet cleared',
  persistence: 'Monthly persistence is the binding gate',
  shock_resistance: 'Demand concentration is the binding gate',
  downside_protection: 'Recent demand downside is the binding gate',
  six_month_growth: 'Six-month escape velocity is not yet cleared',
  three_month_growth: 'Three-month escape velocity is not yet cleared',
  evidence_not_publishable: 'Source or identity evidence is withheld',
}

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

function moneyLabel(value: number): string {
  return compactCurrencyFormatter.format(value)
}

function scoreLabel(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

function ageLabel(value: number | null): string {
  if (value === null) return '—'
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

function titleLabel(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/gu, (character) => character.toLocaleUpperCase('en-US'))
}

function nextGateLabel(item: BinderGraduationV2Item): string {
  const { graduation } = item
  if (graduation.status === 'graduated') {
    return `Build Board #${item.market.masterRank ?? '—'}`
  }
  if (graduation.status === 'withheld') return 'Evidence refresh required'
  const distance = graduation.distance
  switch (graduation.primaryBlocker) {
    case 'ttm_scale':
      return `Needs ${moneyLabel(distance.ttmSalesUsd)} more TTM demand`
    case 'current_run_rate':
      return `Needs ${moneyLabel(distance.currentRunRateUsd)} more run rate`
    case 'master_score':
      return `${distance.masterScorePoints.toFixed(1)} Binder Index points short`
    case 'global_top_one_percent':
      return `Needs ${moneyLabel(distance.globalTopOneTtmUsd)} to observed P99`
    case 'persistence':
      return `${distance.persistencePoints.toFixed(1)} persistence points short`
    case 'shock_resistance':
      return `${distance.shockResistancePoints.toFixed(1)} stability points short`
    case 'downside_protection':
      return `${distance.downsideProtectionPoints.toFixed(1)} downside points short`
    case 'six_month_growth':
      return `${distance.sixMonthGrowthMultiple.toFixed(2)}× short of 6M escape pace`
    case 'three_month_growth':
      return `${distance.threeMonthGrowthMultiple.toFixed(2)}× short of 3M escape pace`
    case 'already_on_build_board':
      return 'Build standard cleared'
    case 'evidence_not_publishable':
      return 'Evidence refresh required'
  }
}

function pathRank(item: BinderGraduationV2Item): string {
  if (item.graduation.status === 'graduated') return 'BOARD'
  if (item.graduation.globalRank === null) return '—'
  return `#${item.graduation.globalRank}`
}

function GraduationDetail({ item }: { item: BinderGraduationV2Item }) {
  const { graduation } = item
  return (
    <div className="bbi-graduation-detail">
      <section>
        <span className="iw-detail-label">Why this rank</span>
        <h3>
          {graduation.status === 'graduated'
            ? `Master Build #${item.market.masterRank ?? '—'}`
            : `${scoreLabel(graduation.index)} Graduation Index`}
        </h3>
        <p>
          {item.playerSignal.modelLabel} produces a player outlook of{' '}
          {item.playerSignal.outlook.toFixed(1)}. It meets market-path readiness{' '}
          {scoreLabel(graduation.marketPathReadiness)} through a weak-link
          formula, so a strong career signal cannot carry a small or fragile
          collector market.
        </p>
        <dl className="bbi-detail-metrics">
          <div>
            <dt>Player outlook</dt>
            <dd>{item.playerSignal.outlook.toFixed(1)}</dd>
          </div>
          <div>
            <dt>Market readiness</dt>
            <dd>{scoreLabel(graduation.marketPathReadiness)}</dd>
          </div>
          <div>
            <dt>Current Binder Index</dt>
            <dd>{item.market.masterScore.toFixed(1)}</dd>
          </div>
          <div>
            <dt>Durability</dt>
            <dd>{item.market.durability.toFixed(1)}</dd>
          </div>
        </dl>
      </section>

      <section>
        <span className="iw-detail-label">Path to Build</span>
        <h3>{nextGateLabel(item)}</h3>
        <p>
          Projected route:{' '}
          <strong>{titleLabel(graduation.projectedRoute)}</strong>. The target
          is the same absolute Master Build standard used by the Build Board.
        </p>
        <dl className="bbi-detail-metrics">
          <div>
            <dt>Durable route</dt>
            <dd>{graduation.routeReadiness.established.toFixed(1)}</dd>
          </div>
          <div>
            <dt>Escape route</dt>
            <dd>{graduation.routeReadiness.escapeVelocity.toFixed(1)}</dd>
          </div>
          <div>
            <dt>Common gates</dt>
            <dd>{graduation.routeReadiness.commonGates.toFixed(1)}</dd>
          </div>
          <div>
            <dt>Gate progress</dt>
            <dd>
              {graduation.buildGateProgress.passed}/
              {graduation.buildGateProgress.required}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <span className="iw-detail-label">What could break</span>
        <h3>{blockerLabels[graduation.primaryBlocker]}</h3>
        <p>
          Trajectory is <strong>{graduation.trajectory}</strong>. Evidence grade{' '}
          <strong>{graduation.evidence.grade}</strong> reflects freshness,
          identity, and history—not investment confidence.
        </p>
        <ul>
          {graduation.buildGateProgress.reasonCodes.length > 0 ? (
            graduation.buildGateProgress.reasonCodes.slice(0, 4).map((reason) => (
              <li key={reason}>{titleLabel(reason)}</li>
            ))
          ) : (
            <li>All current Master Build gates are cleared.</li>
          )}
        </ul>
        <div className="iw-detail-scope">
          A calibrated probability is withheld: there are no observed historical
          Build graduations yet. The Index is a 24-month readiness rank, never a
          percentage or expected return.
        </div>
      </section>
    </div>
  )
}

export function CrossSportPlayerWorkbench({
  response,
  loading,
  error,
  sport,
  search,
  maxAge,
  position,
  band,
  sort,
  page,
  onMaxAgeChange,
  onPositionChange,
  onBandChange,
  onSortChange,
  onPageChange,
  onReset,
}: CrossSportPlayerWorkbenchProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const items = response?.items ?? []
  const pagination = response?.page ?? {
    page,
    limit: 50,
    total: 0,
    totalPages: 0,
  }
  const positions = defaultPositions[sport]
  const sportLabel = sport === 'all'
    ? 'baseball, football, and basketball'
    : sport
  const summary = response?.summary
  const publicationSuspended =
    response?.snapshot.freshness.status !== undefined &&
    response.snapshot.freshness.status !== 'current'
  const filtersActive =
    search.trim().length > 0 ||
    maxAge !== 26 ||
    position !== 'all' ||
    band !== 'all' ||
    sort !== 'graduation_rank'

  useEffect(() => {
    if (!search.trim()) {
      setExpandedId(null)
      return
    }
    if (response?.items.length === 1) {
      setExpandedId(response.items[0]!.player.id)
    }
  }, [response, search])

  return (
    <div className="csw-body" aria-busy={loading}>
      <div
        className="iw-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {loading
          ? `Updating ${sportLabel} Graduation Board.`
          : error
            ? ''
            : `${pagination.total.toLocaleString()} ${sportLabel} graduation candidates. Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}.`}
      </div>

      <div
        className="iw-controls csw-controls"
        role="group"
        aria-label={`${sportLabel} graduation filters`}
      >
        <label>
          <span className="iw-control-label">Age</span>
          <select
            aria-label="Age screen"
            value={maxAge}
            onChange={(event) => {
              const value = event.currentTarget.value
              onMaxAgeChange(
                value === 'all'
                  ? 'all'
                  : Number(value) as Exclude<PlayerRankingAgeCeiling, 'all'>,
              )
            }}
          >
            {ageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="iw-control-label">Position</span>
          <select
            value={position}
            onChange={(event) => onPositionChange(event.currentTarget.value)}
          >
            <option value="all">All positions</option>
            {positions.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="iw-control-label">Path</span>
          <select
            value={band}
            onChange={(event) => {
              onBandChange(event.currentTarget.value as PlayerRankingBand)
            }}
          >
            {bandOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="iw-control-label">Sort</span>
          <select
            value={sort}
            onChange={(event) => {
              onSortChange(
                event.currentTarget.value as BinderGraduationSortKey,
              )
            }}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="iw-reset"
          disabled={!filtersActive}
          onClick={onReset}
        >
          <RotateCcw size={14} aria-hidden="true" />
          Reset
        </button>
      </div>

      <div className="bbi-pipeline-summary">
        <div>
          <span>Pipeline</span>
          <strong>{(summary?.rankedCount ?? pagination.total).toLocaleString()}</strong>
        </div>
        <div className="is-on-deck">
          <span>On Deck</span>
          <strong>{summary?.onDeckCount ?? '—'}</strong>
        </div>
        <div>
          <span>Approaching</span>
          <strong>{summary?.approachingCount ?? '—'}</strong>
        </div>
        <p>
          One global graduation rank across baseball, football, and basketball.
          Sport and age filters never manufacture a new #1.
        </p>
        <span className="iw-withheld-status">
          <LockKeyhole size={13} aria-hidden="true" />
          Probability withheld
        </span>
      </div>

      {error ? (
        <div className="iw-message iw-message--error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="iw-message" role="status">
          Loading the current Graduation Board…
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <div
            className={`iw-table-frame csw-table-frame${loading ? ' is-loading' : ''}`}
            aria-busy={loading}
          >
            <table aria-label={`${sportLabel} Binder Graduation rankings`}>
              <caption className="iw-sr-only">
                Players ranked globally by readiness to clear the Master Build
                standard. The Graduation Index is not a probability.
              </caption>
              <thead>
                <tr>
                  <th className="iw-expand-column" aria-label="Row details" />
                  <th scope="col">Grad rank</th>
                  <th className="iw-subject-column" scope="col">Player</th>
                  <th scope="col">Age</th>
                  <th scope="col">Graduation Index</th>
                  <th scope="col">Market readiness</th>
                  <th scope="col">TTM demand</th>
                  <th scope="col">Path</th>
                  <th scope="col">Next gate</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const expanded = expandedId === item.player.id
                  return (
                    <Fragment key={item.player.id}>
                      <tr className={`iw-data-row bbi-band--${item.graduation.band}`}>
                        <td className="iw-expand-column">
                          <button
                            type="button"
                            aria-label={`${expanded ? 'Hide' : 'Show'} graduation evidence for ${item.player.name}`}
                            aria-expanded={expanded}
                            onClick={() => setExpandedId(
                              expanded ? null : item.player.id,
                            )}
                          >
                            {expanded ? (
                              <ChevronUp size={15} aria-hidden="true" />
                            ) : (
                              <ChevronDown size={15} aria-hidden="true" />
                            )}
                          </button>
                        </td>
                        <td className="iw-number iw-rank bbi-grad-rank">
                          <strong>{pathRank(item)}</strong>
                          <span>global path</span>
                        </td>
                        <th className="iw-subject-column" scope="row">
                          <strong>{item.player.name}</strong>
                          <span>
                            {[
                              titleLabel(item.player.sport),
                              item.player.primaryPosition,
                              item.player.team,
                            ].filter(Boolean).join(' · ')}
                          </span>
                        </th>
                        <td className="iw-number csw-age">
                          <strong>{ageLabel(item.player.age)}</strong>
                          <span>
                            {item.playerSignal.ageTreatment ===
                            'development_runway_embedded_in_outlook'
                              ? 'runway modeled'
                              : 'filter only'}
                          </span>
                        </td>
                        <td className="bbi-index-cell">
                          <div>
                            <strong>{scoreLabel(item.graduation.index)}</strong>
                            <span>/100</span>
                          </div>
                          <span className="bbi-index-track" aria-hidden="true">
                            <span
                              style={{
                                width: `${item.graduation.index ?? 0}%`,
                              }}
                            />
                          </span>
                        </td>
                        <td className="iw-number">
                          <strong>
                            {scoreLabel(item.graduation.marketPathReadiness)}
                          </strong>
                          <span>{item.playerSignal.outlook.toFixed(1)} outlook</span>
                        </td>
                        <td className="iw-number">
                          <strong>{moneyLabel(item.market.ttmSalesUsd)}</strong>
                          <span>{moneyLabel(item.market.currentRunRateUsd)} run rate</span>
                        </td>
                        <td className="bbi-path-cell">
                          <span className={`bbi-path bbi-path--${item.graduation.band}`}>
                            {bandLabels[item.graduation.band]}
                          </span>
                          <small>{titleLabel(item.graduation.trajectory)}</small>
                        </td>
                        <td className="bbi-next-gate">
                          <strong>{nextGateLabel(item)}</strong>
                          <span>{titleLabel(item.graduation.projectedRoute)}</span>
                        </td>
                        <td className="bbi-evidence-grade">
                          <strong>{item.graduation.evidence.grade}</strong>
                          <span>input grade</span>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="iw-detail-row">
                          <td colSpan={10}>
                            <GraduationDetail item={item} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="bbi-mobile-list" aria-label="Mobile Graduation Board">
            {items.map((item) => {
              const expanded = expandedId === item.player.id
              return (
                <article
                  className={`bbi-mobile-card bbi-band--${item.graduation.band}`}
                  key={item.player.id}
                >
                  <button
                    type="button"
                    className="bbi-mobile-card__toggle"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(
                      expanded ? null : item.player.id,
                    )}
                  >
                    <span className="bbi-mobile-rank">{pathRank(item)}</span>
                    <span className="bbi-mobile-player">
                      <strong>{item.player.name}</strong>
                      <small>
                        {item.player.sport} · {item.player.primaryPosition}
                        {' '}· age {ageLabel(item.player.age)}
                      </small>
                    </span>
                    <span className="bbi-mobile-index">
                      <strong>{scoreLabel(item.graduation.index)}</strong>
                      <small>INDEX</small>
                    </span>
                    {expanded ? (
                      <ChevronUp size={17} aria-hidden="true" />
                    ) : (
                      <ChevronDown size={17} aria-hidden="true" />
                    )}
                  </button>
                  <div className="bbi-mobile-card__signal">
                    <span className={`bbi-path bbi-path--${item.graduation.band}`}>
                      {bandLabels[item.graduation.band]}
                    </span>
                    <span>{moneyLabel(item.market.ttmSalesUsd)} TTM</span>
                    <span>{nextGateLabel(item)}</span>
                  </div>
                  {expanded ? <GraduationDetail item={item} /> : null}
                </article>
              )
            })}
          </div>
        </>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="iw-empty" role="status">
          {publicationSuspended ? (
            <>
              <strong>Graduation publication is suspended.</strong>
              <span>
                A required source is past its freshness deadline, so every
                readiness rank is withheld.
              </span>
            </>
          ) : (
            <>
              <strong>
                {search.trim()
                  ? `No graduation candidate matches “${search.trim()}”.`
                  : 'No players match this Graduation Board.'}
              </strong>
              <span>
                {search.trim()
                  ? 'Try another spelling. Every sport, age, position, and path was searched.'
                  : 'Broaden the path, age, or position filters.'}
              </span>
              <button type="button" onClick={onReset}>
                Reset graduation filters
              </button>
            </>
          )}
        </div>
      ) : null}

      {!error && pagination.totalPages > 1 ? (
        <nav className="iw-pagination" aria-label="Graduation result pages">
          <button
            type="button"
            disabled={loading || pagination.page <= 1}
            onClick={() => onPageChange(pagination.page - 1)}
          >
            <ChevronLeft size={15} aria-hidden="true" />
            Previous
          </button>
          <span>
            Page <strong>{pagination.page}</strong> of{' '}
            {pagination.totalPages.toLocaleString()}
          </span>
          <button
            type="button"
            disabled={loading || pagination.page >= pagination.totalPages}
            onClick={() => onPageChange(pagination.page + 1)}
          >
            Next
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </nav>
      ) : null}

      <div className="bbi-calibration-note">
        <ShieldCheck size={16} aria-hidden="true" />
        <p>
          <strong>Why no percentage yet?</strong> A real probability needs
          observed player transitions into a durable Build state. This contract
          freezes the target and defines the required monthly archive;
          percentages remain withheld until prospective calibration earns them.
        </p>
        <a href="#methodology">
          Methodology <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </div>
    </div>
  )
}
