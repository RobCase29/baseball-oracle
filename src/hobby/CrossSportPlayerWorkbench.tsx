import { Fragment, useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LockKeyhole,
  RotateCcw,
  Search,
} from 'lucide-react'
import type {
  HobbyPlayerRankingItem,
  HobbyPlayerRankingPosture,
  HobbyPlayerRankingsResponse,
  HobbyPlayerRankingSortKey,
  HobbyPlayerRankingSport,
} from '../domain/hobbyPlayerRanking'
import './cross-sport-player-workbench.css'

export type PlayerRankingAgeCeiling = 'all' | 23 | 26 | 30
export type PlayerRankingPosture = HobbyPlayerRankingPosture | 'all'
export type PlayerRankingPosition = string | 'all'

interface CrossSportPlayerWorkbenchProps {
  response: HobbyPlayerRankingsResponse | null
  loading: boolean
  error: string | null
  sport: HobbyPlayerRankingSport
  search: string
  maxAge: PlayerRankingAgeCeiling
  position: PlayerRankingPosition
  posture: PlayerRankingPosture
  sort: HobbyPlayerRankingSortKey
  page: number
  onSearchChange: (value: string) => void
  onMaxAgeChange: (value: PlayerRankingAgeCeiling) => void
  onPositionChange: (value: PlayerRankingPosition) => void
  onPostureChange: (value: PlayerRankingPosture) => void
  onSortChange: (value: HobbyPlayerRankingSortKey) => void
  onPageChange: (value: number) => void
  onReset: () => void
}

const ageOptions: ReadonlyArray<{
  value: PlayerRankingAgeCeiling
  label: string
}> = [
  { value: 'all', label: 'Open' },
  { value: 23, label: 'Age ≤23' },
  { value: 26, label: 'Age ≤26' },
  { value: 30, label: 'Age ≤30' },
]

const postureOptions: ReadonlyArray<{
  value: PlayerRankingPosture
  label: string
}> = [
  { value: 'all', label: 'All actions' },
  { value: 'Build', label: 'Build candidates' },
  { value: 'Hold', label: 'Hold' },
  { value: 'Watch', label: 'Watch' },
  { value: 'Deprioritize', label: 'Deprioritize' },
]

const sortOptions: ReadonlyArray<{
  value: HobbyPlayerRankingSortKey
  label: string
}> = [
  { value: 'score', label: 'Build Score' },
  { value: 'outlook', label: 'Long-horizon outlook' },
  { value: 'market_durability', label: 'Demand durability' },
  { value: 'attention_gap', label: 'Attention gap' },
  { value: 'age', label: 'Age' },
  { value: 'name', label: 'Player name' },
]

const defaultPositions: Record<HobbyPlayerRankingSport, readonly string[]> = {
  football: ['QB', 'RB', 'WR', 'TE'],
  basketball: ['PG', 'SG', 'SF', 'PF', 'C'],
}

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

function scoreLabel(value: number): string {
  return value.toFixed(1)
}

function ageLabel(value: number | null): string {
  if (value === null) return '—'
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

function moneyLabel(value: number): string {
  return compactCurrencyFormatter.format(value)
}

function percentageChange(current: number, prior: number): number | null {
  if (prior <= 0) return null
  return ((current / prior) - 1) * 100
}

function percentLabel(value: number | null): string {
  if (value === null) return '—'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}%`
}

function attentionGapLabel(value: number): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}`
}

function attentionTone(value: number): 'opportunity' | 'risk' | 'neutral' {
  if (value >= 15) return 'risk'
  if (value <= -15) return 'opportunity'
  return 'neutral'
}

function sentenceLabel(value: string): string {
  const words = value.replaceAll('_', ' ')
  return `${words.charAt(0).toLocaleUpperCase()}${words.slice(1)}.`
}

function postureClass(posture: HobbyPlayerRankingPosture): string {
  if (posture === 'Build') return 'build_candidate'
  if (posture === 'Hold') return 'hold_candidate'
  if (posture === 'Deprioritize') return 'pass'
  return 'watch'
}

function postureLabel(item: HobbyPlayerRankingItem): string {
  if (
    item.identity.manualReviewStatus === 'unreviewed' &&
    item.gates.reasonCodes.length === 1 &&
    item.gates.reasonCodes[0] === 'manual_identity_review_not_completed'
  ) {
    return 'Review pending'
  }
  return item.posture === 'Build' ? 'Build candidate' : item.posture
}

function sourceDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

function SalesHistory({
  item,
  historyStart,
}: {
  item: HobbyPlayerRankingItem
  historyStart: string
}) {
  const values = item.diagnostics.monthlySalesUsd
  const observedValues = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  )
  const maximum = Math.max(...observedValues, 1)
  const start = new Date(`${historyStart}T00:00:00.000Z`)

  return (
    <div
      className="csw-sales-history"
      role="img"
      aria-label={`Eighteen-month sales-volume history for ${item.name}; ${observedValues.length} months observed.`}
    >
      {values.map((value, index) => {
        const observed = value !== null && Number.isFinite(value)
        const month = new Date(start)
        month.setUTCMonth(month.getUTCMonth() + index)
        const label = new Intl.DateTimeFormat('en-US', {
          month: 'short',
          year: '2-digit',
          timeZone: 'UTC',
        }).format(month)
        return (
          <span
            key={`${label}-${index}`}
            className={observed ? undefined : 'is-missing'}
            title={`${label}: ${observed ? moneyLabel(value) : 'not observed'}`}
            style={{
              '--csw-bar-height': !observed
                ? '4%'
                : `${Math.max(4, (value / maximum) * 100)}%`,
            } as CSSProperties}
          />
        )
      })}
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
  posture,
  sort,
  page,
  onSearchChange,
  onMaxAgeChange,
  onPositionChange,
  onPostureChange,
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
  const positions = response?.meta.availableFilters.positionsBySport[sport] ??
    defaultPositions[sport]
  const cohort = response?.cohorts.find((item) => item.sport === sport)
  const publicationSuspended =
    response?.snapshot.freshness.status !== undefined &&
    response.snapshot.freshness.status !== 'current'
  const scopedRankActive =
    maxAge !== 'all' ||
    position !== 'all' ||
    posture !== 'all'
  const filtersActive =
    search.trim().length > 0 ||
    scopedRankActive ||
    sort !== 'score'

  return (
    <div className="csw-body" aria-busy={loading}>
      <div
        className="iw-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {loading
          ? `Updating ${sport} player rankings.`
          : error
            ? ''
            : `${pagination.total.toLocaleString()} ${sport} player matches. Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}.`}
      </div>

      <div
        className="iw-controls csw-controls"
        role="group"
        aria-label={`${sport} player ranking filters`}
      >
        <label className="iw-search">
          <span className="iw-control-label">Player</span>
          <span className="iw-input-shell">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={search}
              placeholder={`Search ${sport} players`}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
            />
          </span>
        </label>

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
          <span className="iw-control-label">Action</span>
          <select
            value={posture}
            onChange={(event) => {
              onPostureChange(
                event.currentTarget.value as PlayerRankingPosture,
              )
            }}
          >
            {postureOptions.map((option) => (
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
                event.currentTarget.value as HobbyPlayerRankingSortKey,
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

      <div className="iw-result-bar csw-result-bar">
        <div>
          <strong>{pagination.total.toLocaleString()}</strong>
          <span>
            ranked · {sport} · {maxAge === 'all' ? 'all ages' : `age ≤${maxAge}`}
            {cohort ? ` · Build candidates ${cohort.buildCount}` : ''}
          </span>
        </div>
        <p>
          Build Score is a consensus-and-demand research screen calculated
          within {sport}; age filters the view and never adds points.
        </p>
        <span className="iw-withheld-status">
          <LockKeyhole size={13} aria-hidden="true" />
          Expected return withheld
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
          Loading current {sport} investor signals…
        </div>
      ) : null}

      {items.length > 0 ? (
        <div
          className={`iw-table-frame csw-table-frame${loading ? ' is-loading' : ''}`}
          aria-busy={loading}
        >
          <table aria-label={`${sport} long-horizon player rankings`}>
            <caption className="iw-sr-only">
              {sport} players ordered within their sport by Build Score, a
              research signal that is not an expected-return forecast.
            </caption>
            <thead>
              <tr>
                <th className="iw-expand-column" aria-label="Row details" />
                <th scope="col">
                  {scopedRankActive ? 'Screen rank' : 'Sport rank'}
                </th>
                <th className="iw-subject-column" scope="col">Player</th>
                <th scope="col">Age</th>
                <th scope="col">Build Score</th>
                <th scope="col">Long-horizon outlook</th>
                <th scope="col">Demand durability</th>
                <th scope="col">Attention gap</th>
                <th scope="col">Confidence / research</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const expanded = expandedId === item.id
                const postureTone = postureClass(item.posture)
                const sixMonthChange = percentageChange(
                  item.diagnostics.currentSixMonthSalesUsd,
                  item.diagnostics.priorSixMonthSalesUsd,
                )
                const threeMonthChange = percentageChange(
                  item.diagnostics.recentThreeMonthSalesUsd,
                  item.diagnostics.priorThreeMonthSalesUsd,
                )
                const gapTone = attentionTone(
                  item.diagnostics.attentionGap,
                )
                const primaryRank = scopedRankActive
                  ? item.screenRank
                  : item.sportRank
                return (
                  <Fragment key={item.id}>
                    <tr className={`iw-data-row iw-posture--${postureTone}`}>
                      <td className="iw-expand-column">
                        <button
                          type="button"
                          aria-label={`${expanded ? 'Hide' : 'Show'} investor evidence for ${item.name}`}
                          aria-expanded={expanded}
                          onClick={() => setExpandedId(expanded ? null : item.id)}
                        >
                          {expanded ? (
                            <ChevronUp size={15} aria-hidden="true" />
                          ) : (
                            <ChevronDown size={15} aria-hidden="true" />
                          )}
                        </button>
                      </td>
                      <td className="iw-number iw-rank csw-rank">
                        <strong>#{primaryRank}</strong>
                        <span>
                          {scopedRankActive
                            ? `Sport #${item.sportRank}`
                            : `${item.sportPercentile.toFixed(1)} pct`}
                        </span>
                      </td>
                      <th className="iw-subject-column" scope="row">
                        <strong>{item.name}</strong>
                        <span>
                          {[
                            item.primaryPosition,
                            item.team,
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </th>
                      <td className="iw-number csw-age">
                        <strong>{ageLabel(item.age)}</strong>
                        <span>filter only</span>
                      </td>
                      <td className="iw-number iw-score csw-build-score">
                        <strong>{scoreLabel(item.score)}</strong>
                        <span>Consensus + Demand</span>
                      </td>
                      <td className="iw-number">
                        <strong>{scoreLabel(item.components.outlook)}</strong>
                        <span>/100</span>
                      </td>
                      <td className="iw-number">
                        <strong>
                          {scoreLabel(item.components.marketDurability)}
                        </strong>
                        <span>{moneyLabel(item.diagnostics.trailingTwelveSalesUsd)} TTM</span>
                      </td>
                      <td className={`iw-number csw-gap is-${gapTone}`}>
                        <strong>
                          {attentionGapLabel(item.diagnostics.attentionGap)}
                        </strong>
                        <span>volume − outlook</span>
                      </td>
                      <td className="csw-decision">
                        <span className={`iw-posture iw-posture--${postureTone}`}>
                          {postureLabel(item)}
                        </span>
                        <span>
                          {item.confidence.band} ·{' '}
                          {item.confidence.score.toFixed(0)}/100 evidence
                        </span>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="iw-detail-row">
                        <td colSpan={9}>
                          <div className="iw-detail csw-detail">
                            <section>
                              <span className="iw-detail-label">
                                Build Score anatomy
                              </span>
                              <h3>
                                {postureLabel(item)} ·{' '}
                                {scoreLabel(item.score)}
                              </h3>
                              <dl className="iw-signal-grid">
                                <div>
                                  <dt>Outlook</dt>
                                  <dd>{scoreLabel(item.components.outlook)}</dd>
                                </div>
                                <div>
                                  <dt>Durability</dt>
                                  <dd>
                                    {scoreLabel(item.components.marketDurability)}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Volume pct</dt>
                                  <dd>
                                    {scoreLabel(item.components.volumePercentile)}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Resilience</dt>
                                  <dd>{scoreLabel(item.components.resilience)}</dd>
                                </div>
                                <div>
                                  <dt>Trend context</dt>
                                  <dd>{scoreLabel(item.components.trendContext)}</dd>
                                </div>
                                <div>
                                  <dt>Hype penalty</dt>
                                  <dd>{item.components.hypePenalty.toFixed(1)}</dd>
                                </div>
                              </dl>
                              <p className="csw-formula">
                                Build formula:{' '}
                                {response?.meta.methodology.formulas.durableScore}
                              </p>
                              <p className="csw-formula">
                                Outlook formula:{' '}
                                {sport === 'football'
                                  ? response?.meta.methodology.formulas.outlookFootball
                                  : response?.meta.methodology.formulas.outlookBasketball}
                                {' '}Age is display and filter context only; it is
                                not a score input.
                              </p>
                              <div className="iw-detail-scope">
                                This prioritizes player-level consensus and
                                demand evidence for card-level research. It is
                                not expected return, ROI, a price target, or an
                                exact-card recommendation.
                              </div>
                            </section>

                            <section>
                              <span className="iw-detail-label">
                                18-month sales diagnostics
                              </span>
                              <SalesHistory
                                item={item}
                                historyStart={response?.snapshot.historyStart ?? ''}
                              />
                              <dl className="csw-diagnostic-grid">
                                <div>
                                  <dt>TTM volume</dt>
                                  <dd>
                                    {moneyLabel(
                                      item.diagnostics.trailingTwelveSalesUsd,
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt>6M change</dt>
                                  <dd>{percentLabel(sixMonthChange)}</dd>
                                </div>
                                <div>
                                  <dt>3M change</dt>
                                  <dd>{percentLabel(threeMonthChange)}</dd>
                                </div>
                                <div>
                                  <dt>Positive months</dt>
                                  <dd>
                                    {(item.diagnostics.positiveMonthRatio * 100)
                                      .toFixed(0)}%
                                  </dd>
                                </div>
                                <div>
                                  <dt>Floor / median</dt>
                                  <dd>
                                    {(item.diagnostics.lowerQuartileToMedianRatio *
                                      100).toFixed(0)}%
                                  </dd>
                                </div>
                                <div>
                                  <dt>History observed</dt>
                                  <dd>
                                    {(item.diagnostics.observedHistoryRatio * 100)
                                      .toFixed(0)}%
                                  </dd>
                                </div>
                              </dl>
                            </section>

                            <section>
                              <span className="iw-detail-label">
                                Evidence gates
                              </span>
                              <p className="iw-gate-count">
                                {item.gates.passed} of {item.gates.required} gates
                                passed
                              </p>
                              <p className="csw-gate-rule">
                                {response?.meta.methodology.buildGate}
                              </p>
                              <ul>
                                {item.gates.reasonCodes.length > 0 ? (
                                  item.gates.reasonCodes.slice(0, 6).map((reason) => (
                                    <li key={reason}>{sentenceLabel(reason)}</li>
                                  ))
                                ) : (
                                  <li>All published evidence gates passed.</li>
                                )}
                              </ul>
                              <p className="csw-sensitivity">
                                Sensitivity: {item.sensitivity.stableTopDecile
                                  ? 'stable in the top decile'
                                  : 'ranking changes under alternate weights'}
                                {' '}· spread {item.sensitivity.scoreSpread.toFixed(1)}
                              </p>
                            </section>

                            <section>
                              <span className="iw-detail-label">
                                Source attribution
                              </span>
                              <ul className="csw-source-list">
                                {item.sources.map((source) => (
                                  <li key={source.id}>
                                    {source.url ? (
                                      <a
                                        href={source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {source.label}
                                      </a>
                                    ) : (
                                      <strong>{source.label}</strong>
                                    )}
                                    <span>
                                      As of {sourceDate(source.asOf)} ·{' '}
                                      {source.measure} ·{' '}
                                      {sentenceLabel(source.permissionBasis)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                              <p className="csw-identity">
                                Identity: unique exact join · manual review{' '}
                                {item.identity.manualReviewStatus}.
                              </p>
                            </section>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="iw-empty" role="status">
          {publicationSuspended ? (
            <>
              <strong>Rank publication is suspended.</strong>
              <span>
                A required source is past its freshness deadline. The API
                withheld every rank instead of serving an aging signal.
              </span>
            </>
          ) : (
            <>
              <strong>No players match this screen.</strong>
              <span>
                Broaden the age, position, action, or search filters.
              </span>
              <button type="button" onClick={onReset}>
                Reset player filters
              </button>
            </>
          )}
        </div>
      ) : null}

      {!error && pagination.totalPages > 1 ? (
        <nav className="iw-pagination" aria-label="Player ranking result pages">
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
    </div>
  )
}
