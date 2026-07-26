import { Fragment, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LockKeyhole,
  RotateCcw,
} from 'lucide-react'
import {
  type HobbyMasterFeedItem,
  type HobbyMasterFeedResponse,
  type HobbyMasterSortDirection,
  type HobbyMasterSortKey,
  type MagnificentXDomain,
  type MagnificentXResearchPosture,
} from '../domain/hobbyMasterRanking'
import {
  salesTrendDisplay,
  subjectContextDisplay,
} from './hobbySubjectDisplay'
import './investor-workbench.css'

export interface InvestorWorkbenchProps {
  response: HobbyMasterFeedResponse | null
  loading: boolean
  error: string | null
  search: string
  domain: MagnificentXDomain | 'all'
  posture: MagnificentXResearchPosture | 'all'
  sort: HobbyMasterSortKey
  direction: HobbyMasterSortDirection
  page: number
  onDomainChange: (value: MagnificentXDomain | 'all') => void
  onSortChange: (value: HobbyMasterSortKey) => void
  onDirectionChange: (value: HobbyMasterSortDirection) => void
  onPageChange: (value: number) => void
  onReset: () => void
}

const domainLabels: Record<MagnificentXDomain, string> = {
  baseball: 'Baseball',
  basketball: 'Basketball',
  football: 'Football',
  soccer: 'Soccer',
  hockey: 'Hockey',
  golf: 'Golf',
  combat: 'Combat',
  other_sport: 'Other sport',
  mixed_sport: 'Mixed sport',
  culture: 'Culture',
  pokemon: 'Pokémon',
}

const domainOptions: ReadonlyArray<{
  value: MagnificentXDomain | 'all'
  label: string
}> = [
  { value: 'all', label: 'All cohorts' },
  { value: 'baseball', label: 'Baseball' },
  { value: 'basketball', label: 'Basketball' },
  { value: 'football', label: 'Football' },
  { value: 'soccer', label: 'Soccer' },
  { value: 'hockey', label: 'Hockey' },
  { value: 'combat', label: 'Combat & wrestling' },
  { value: 'golf', label: 'Golf' },
  { value: 'pokemon', label: 'Pokémon' },
  { value: 'other_sport', label: 'Other sports' },
  { value: 'mixed_sport', label: 'Mixed sports' },
  { value: 'culture', label: 'Culture · outside scope' },
]

const postureMeta: Record<MagnificentXResearchPosture, {
  label: string
  description: string
}> = {
  build_candidate: {
    label: 'Build',
    description:
      'Cleared an absolute cross-hobby durability or escape-velocity route. Underwrite the exact card before committing capital.',
  },
  hold_candidate: {
    label: 'Near Build',
    description:
      'Meaningful absolute demand, but at least one strict Build threshold remains open.',
  },
  watch: {
    label: 'Watch',
    description: 'Demand is credible but has not cleared the durable-leader thresholds.',
  },
  risk_review: {
    label: 'Risk review',
    description: 'Review concentration, trend, and acceleration risk before considering additions.',
  },
  pass: {
    label: 'Pass',
    description: 'Deprioritize at the subject-demand layer; this is not a sell instruction.',
  },
  unrated: {
    label: 'Unrated',
    description: 'Cohort or identity evidence is not strong enough for a research posture.',
  },
  needs_refresh: {
    label: 'Needs refresh',
    description: 'The monthly snapshot is overdue, so the prior posture is suspended.',
  },
}

const selectedPostureDescriptions: Record<
  MagnificentXResearchPosture | 'all',
  string
> = {
  build_candidate:
    'Absolute cross-hobby qualifiers. No sport receives a reserved place.',
  hold_candidate:
    'Near-Build subjects with meaningful scale but an open qualification gate.',
  watch: 'Credible demand that still needs a stronger durability profile.',
  risk_review:
    'Concentrated or weakening demand to examine before considering additions.',
  pass: 'Low-priority subject demand. Pass is not an instruction to sell a scarce card.',
  unrated: 'Rows withheld because cohort or identity evidence is insufficient.',
  needs_refresh: 'Rows suspended because the monthly market snapshot is overdue.',
  all: 'Every eligible row retains the same observed-universe master rank.',
}

const sortOptions: ReadonlyArray<{
  value: HobbyMasterSortKey
  label: string
}> = [
  { value: 'master_rank', label: 'Build Board rank' },
  { value: 'master_score', label: 'Binder Index' },
  { value: 'ttm_sales', label: 'TTM demand' },
  { value: 'current_run_rate', label: 'Current run rate' },
  { value: 'exit_window', label: 'Exit-window priority' },
  { value: 'durability', label: 'Durability' },
  { value: 'cohort_rank', label: 'Cohort rank' },
  { value: 'trend', label: '6M demand change' },
  { value: 'persistence', label: 'Persistence' },
  { value: 'shock_resistance', label: 'Shock resistance' },
  { value: 'cohort_percentile', label: 'Cohort percentile' },
  { value: 'name', label: 'Subject name' },
]

const reasonLabels: Readonly<Record<string, string>> = {
  observed_universe_comparison_not_eligible:
    'The provider cohort or source-name identity is not comparison eligible.',
  market_snapshot_not_current: 'The monthly snapshot is not current.',
  complete_18_month_history_missing: 'The complete 18-month history is missing.',
  below_observed_global_top_one_percent:
    'Absolute demand is below the observed global top one percent.',
  persistence_below_90: 'Monthly persistence is below 90.',
  shock_resistance_below_90: 'Sales concentration is too high.',
  material_six_month_demand_decline:
    'Like-for-like six-month demand has materially declined.',
  neither_absolute_build_route_cleared:
    'Neither the established durability nor escape-velocity route cleared.',
}

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

function formatMoney(value: number): string {
  return compactCurrencyFormatter.format(value)
}

function formatReason(value: string): string {
  const known = reasonLabels[value]
  if (known) return known
  const words = value.replaceAll('_', ' ')
  return `${words.charAt(0).toLocaleUpperCase()}${words.slice(1)}.`
}

function sortAriaValue(
  active: boolean,
  direction: HobbyMasterSortDirection,
): 'ascending' | 'descending' | undefined {
  if (!active) return undefined
  return direction === 'asc' ? 'ascending' : 'descending'
}

function unresolvedGateCount(item: HobbyMasterFeedItem): number {
  return item.assessment.buildQualification.required -
    item.assessment.buildQualification.passed
}

export function InvestorWorkbench({
  response,
  loading,
  error,
  search,
  domain,
  posture,
  sort,
  direction,
  page,
  onDomainChange,
  onSortChange,
  onDirectionChange,
  onPageChange,
  onReset,
}: InvestorWorkbenchProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const items = response?.items ?? []
  const pagination = response?.page ?? {
    page,
    limit: 50,
    total: 0,
    totalPages: 0,
  }
  const universeCount = response?.cohorts.reduce(
    (total, cohort) => total + cohort.subjectCount,
    0,
  ) ?? 0
  const filtersActive =
    search.length > 0 ||
    domain !== 'all' ||
    posture !== 'build_candidate' ||
    sort !== 'master_rank' ||
    direction !== 'asc'

  useEffect(() => {
    if (!search.trim()) {
      setExpandedId(null)
      return
    }
    if (response?.items.length === 1) {
      setExpandedId(response.items[0]!.subject.id)
    }
  }, [response, search])

  function changeSort(nextSort: HobbyMasterSortKey): void {
    if (nextSort === sort) {
      onDirectionChange(direction === 'asc' ? 'desc' : 'asc')
      return
    }
    onSortChange(nextSort)
    onDirectionChange(
      nextSort === 'master_rank' ||
      nextSort === 'cohort_rank' ||
      nextSort === 'name'
        ? 'asc'
        : 'desc',
    )
  }

  return (
    <div
      className="iw-workbench-body"
      aria-busy={loading}
    >
      <div className="iw-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {loading
          ? 'Updating the Build Board.'
          : error
            ? ''
            : `${pagination.total.toLocaleString()} matches. Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}.`}
      </div>
      <div className="iw-controls" role="group" aria-label="Build Board filters">
        <label>
          <span className="iw-control-label">Cohort</span>
          <select
            value={domain}
            onChange={(event) => {
              onDomainChange(
                event.currentTarget.value as MagnificentXDomain | 'all',
              )
            }}
          >
            {domainOptions.map((option) => (
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
              const nextSort = event.currentTarget.value as HobbyMasterSortKey
              if (nextSort !== sort) {
                onSortChange(nextSort)
                onDirectionChange(
                  nextSort === 'master_rank' ||
                    nextSort === 'cohort_rank' ||
                    nextSort === 'name'
                    ? 'asc'
                    : 'desc',
                )
              }
            }}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="iw-control-label">Direction</span>
          <select
            value={direction}
            onChange={(event) => {
              onDirectionChange(
                event.currentTarget.value as HobbyMasterSortDirection,
              )
            }}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
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

      <div className="iw-result-bar">
        <div>
          <strong>{pagination.total.toLocaleString()}</strong>
          <span>
            matches{universeCount > 0 ? ` · ${universeCount.toLocaleString()} subjects` : ''}
          </span>
        </div>
        <p>
          <strong className="iw-comparability">
            {search.trim()
              ? 'Global name search · every board status and cohort.'
              : domain === 'all'
                ? 'One master order · absolute demand first · no cohort quotas.'
                : selectedPostureDescriptions[posture]}
          </strong>
        </p>
        <span className="iw-withheld-status">
          <LockKeyhole size={13} aria-hidden="true" />
          Exact-card action withheld
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
          Loading the current Build Board…
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <div
            className={`iw-table-frame${loading ? ' is-loading' : ''}`}
            aria-busy={loading}
          >
            <table aria-label="Long-term collection research table">
            <thead>
              <tr>
                <th className="iw-expand-column" aria-label="Row details" />
                <th
                  className="iw-subject-column"
                  scope="col"
                  aria-sort={sortAriaValue(sort === 'name', direction)}
                >
                  <button type="button" onClick={() => changeSort('name')}>
                    Subject
                    <span aria-hidden="true">
                      {sort === 'name' ? (direction === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                </th>
                <th scope="col">Age / origin</th>
                <th scope="col">Board status</th>
                <th
                  scope="col"
                  aria-sort={sortAriaValue(sort === 'master_rank', direction)}
                >
                  <button type="button" onClick={() => changeSort('master_rank')}>
                    Board rank
                    <span aria-hidden="true">
                      {sort === 'master_rank'
                        ? (direction === 'asc' ? '↑' : '↓')
                        : '↕'}
                    </span>
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={sortAriaValue(sort === 'master_score', direction)}
                >
                  <button type="button" onClick={() => changeSort('master_score')}>
                    Binder Index
                    <span aria-hidden="true">
                      {sort === 'master_score'
                        ? (direction === 'asc' ? '↑' : '↓')
                        : '↕'}
                    </span>
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={sortAriaValue(sort === 'trend', direction)}
                >
                  <button type="button" onClick={() => changeSort('trend')}>
                    Demand trend
                    <span aria-hidden="true">
                      {sort === 'trend'
                        ? (direction === 'asc' ? '↑' : '↓')
                        : '↕'}
                    </span>
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={sortAriaValue(sort === 'ttm_sales', direction)}
                >
                  <button type="button" onClick={() => changeSort('ttm_sales')}>
                    TTM demand
                    <span aria-hidden="true">
                      {sort === 'ttm_sales' ? (direction === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={sortAriaValue(
                    sort === 'current_run_rate',
                    direction,
                  )}
                >
                  <button
                    type="button"
                    onClick={() => changeSort('current_run_rate')}
                  >
                    Current run rate
                    <span aria-hidden="true">
                      {sort === 'current_run_rate'
                        ? (direction === 'asc' ? '↑' : '↓')
                        : '↕'}
                    </span>
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={sortAriaValue(sort === 'durability', direction)}
                >
                  <button type="button" onClick={() => changeSort('durability')}>
                    Durability
                    <span aria-hidden="true">
                      {sort === 'durability'
                        ? (direction === 'asc' ? '↑' : '↓')
                        : '↕'}
                    </span>
                  </button>
                </th>
                <th scope="col">Qualification</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const { subject, assessment } = item
                const signal = assessment.marketSignal
                const rowPosture = assessment.posture
                const meta = postureMeta[rowPosture]
                const expanded = expandedId === subject.id
                const context = subjectContextDisplay(subject)
                const trend = salesTrendDisplay(assessment)
                return (
                  <Fragment key={subject.id}>
                    <tr className={`iw-data-row iw-posture--${rowPosture}`}>
                      <td className="iw-expand-column">
                        <button
                          type="button"
                          aria-label={`${expanded ? 'Hide' : 'Show'} research detail for ${subject.name}`}
                          aria-expanded={expanded}
                          onClick={() => setExpandedId(expanded ? null : subject.id)}
                        >
                          {expanded ? (
                            <ChevronUp size={15} aria-hidden="true" />
                          ) : (
                            <ChevronDown size={15} aria-hidden="true" />
                          )}
                        </button>
                      </td>
                      <th className="iw-subject-column" scope="row">
                        <strong>{subject.name}</strong>
                        <span>
                          {domainLabels[subject.domain]} ·{' '}
                          {subject.type === 'pokemon_character'
                            ? 'Character'
                            : 'Athlete'}
                        </span>
                      </th>
                      <td className="iw-context">
                        <strong>{context.primary}</strong>
                        <span>{context.secondary}</span>
                      </td>
                      <td>
                        <span className={`iw-posture iw-posture--${rowPosture}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="iw-number iw-rank">
                        <strong>
                          {item.masterRank === null ? '—' : `#${item.masterRank}`}
                        </strong>
                        <span>
                          Cohort #{item.withinCohortRank}
                        </span>
                      </td>
                      <td className="iw-number iw-score">
                        <strong>{signal.score.toFixed(1)}</strong>
                        <span>/100</span>
                      </td>
                      <td
                        className={`iw-trend iw-trend--${trend.direction}`}
                      >
                        <strong>{trend.primary}</strong>
                        <span>
                          6M {trend.sixMonth} · 3M {trend.recentThreeMonth}
                        </span>
                      </td>
                      <td className="iw-number">
                        <strong>{formatMoney(signal.latestTwelveMonthSalesUsd)}</strong>
                      </td>
                      <td className="iw-number">
                        <strong>
                          {formatMoney(signal.annualizedCurrentSixMonthSalesUsd)}
                        </strong>
                      </td>
                      <td className="iw-number">
                        <strong>{signal.durabilityScore.toFixed(0)}</strong>
                      </td>
                      <td className="iw-evidence">
                        <strong>
                          {assessment.buildQualification.route ===
                            'established_durability'
                            ? 'Durable'
                            : assessment.buildQualification.route ===
                                'escape_velocity'
                              ? 'Escape'
                              : 'Withheld'}
                        </strong>
                        <span>{unresolvedGateCount(item)} gates open</span>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="iw-detail-row">
                        <td colSpan={11}>
                          <div className="iw-detail">
                            <section>
                              <span className="iw-detail-label">Research read</span>
                              <h3>{meta.label}</h3>
                              <p>{meta.description}</p>
                              <div className="iw-detail-scope">
                                {subject.type === 'pokemon_character'
                                  ? 'Character demand only. No set, card, language, grade, population, or entry price is selected.'
                                  : 'Athlete demand only. No exact card, expected return, or sell decision is implied.'}
                              </div>
                              <div className="iw-detail-context">
                                <strong>{context.primary}</strong>
                                <span>{context.detail}</span>
                              </div>
                            </section>

                            <section>
                              <span className="iw-detail-label">Signal anatomy</span>
                              <dl className="iw-signal-grid">
                                <div>
                                  <dt>Absolute demand</dt>
                                  <dd>{signal.demandMagnitudeScore.toFixed(0)}</dd>
                                </div>
                                <div>
                                  <dt>Global demand pct</dt>
                                  <dd>{signal.globalObservedPercentile.toFixed(1)}</dd>
                                </div>
                                <div>
                                  <dt>Durability</dt>
                                  <dd>{signal.durabilityScore.toFixed(0)}</dd>
                                </div>
                                <div>
                                  <dt>Persistence</dt>
                                  <dd>{signal.components.persistence.toFixed(0)}</dd>
                                </div>
                                <div>
                                  <dt>Shock resistance</dt>
                                  <dd>{signal.components.shockResistance.toFixed(0)}</dd>
                                </div>
                                <div>
                                  <dt>Downside protection</dt>
                                  <dd>{signal.downsideProtectionScore.toFixed(0)}</dd>
                                </div>
                                <div>
                                  <dt>6M demand trend</dt>
                                  <dd>{trend.sixMonth}</dd>
                                </div>
                                <div>
                                  <dt>Recent 3M YoY</dt>
                                  <dd>{trend.recentThreeMonth}</dd>
                                </div>
                                <div>
                                  <dt>Worst scenario</dt>
                                  <dd>
                                    {signal.sensitivity.worstScenarioScore.toFixed(1)}
                                  </dd>
                                </div>
                              </dl>
                              <div
                                className={`iw-detail-trend iw-detail-trend--${trend.direction}`}
                              >
                                <strong>{trend.primary}</strong>
                                <span>{trend.detail}</span>
                              </div>
                              <p className="iw-detail-scope">
                                Positive momentum never adds score. It can only
                                clear the separate escape-velocity gate after
                                absolute demand and durability thresholds pass.
                              </p>
                            </section>

                            <section>
                              <span className="iw-detail-label">
                                Build qualification
                              </span>
                              <p className="iw-gate-count">
                                {assessment.buildQualification.passed} of{' '}
                                {assessment.buildQualification.required} common
                                gates passed
                              </p>
                              {assessment.buildQualification.route ? (
                                <p>
                                  Route:{' '}
                                  <strong>
                                    {assessment.buildQualification.route ===
                                      'established_durability'
                                      ? 'Durable scale'
                                      : 'Escape velocity'}
                                  </strong>
                                </p>
                              ) : null}
                              <ul>
                                {assessment.buildQualification.reasonCodes
                                  .slice(0, 6)
                                  .map((reason) => (
                                    <li key={reason}>{formatReason(reason)}</li>
                                  ))}
                              </ul>
                              <div className="iw-detail-scope">
                                Subject-level demand only. Exact card, grade,
                                scarcity, population growth, price paid, and
                                expected return remain outside this label.
                              </div>
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

          <div
            className="bbi-build-mobile-list"
            aria-label="Mobile Build Board"
          >
            {items.map((item) => {
              const { subject, assessment } = item
              const signal = assessment.marketSignal
              const meta = postureMeta[assessment.posture]
              const expanded = expandedId === subject.id
              const context = subjectContextDisplay(subject)
              const trend = salesTrendDisplay(assessment)
              return (
                <article
                  className={`bbi-build-card iw-posture--${assessment.posture}`}
                  key={subject.id}
                >
                  <button
                    type="button"
                    className="bbi-build-card__toggle"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(
                      expanded ? null : subject.id,
                    )}
                  >
                    <span className="bbi-build-card__rank">
                      {item.masterRank === null ? '—' : `#${item.masterRank}`}
                    </span>
                    <span className="bbi-build-card__subject">
                      <strong>{subject.name}</strong>
                      <small>
                        {domainLabels[subject.domain]} · {meta.label}
                      </small>
                    </span>
                    <span className="bbi-build-card__index">
                      <strong>{signal.score.toFixed(1)}</strong>
                      <small>INDEX</small>
                    </span>
                    {expanded ? (
                      <ChevronUp size={17} aria-hidden="true" />
                    ) : (
                      <ChevronDown size={17} aria-hidden="true" />
                    )}
                  </button>
                  <div className="bbi-build-card__signal">
                    <span>{formatMoney(signal.latestTwelveMonthSalesUsd)} TTM</span>
                    <span>
                      {formatMoney(
                        signal.annualizedCurrentSixMonthSalesUsd,
                      )}{' '}
                      run rate
                    </span>
                    <span>{signal.durabilityScore.toFixed(0)} durability</span>
                    <span>{context.compact}</span>
                    <span
                      className={`bbi-build-card__trend iw-trend--${trend.direction}`}
                    >
                      {trend.compact} · 6M demand
                    </span>
                  </div>
                  {expanded ? (
                    <div className="bbi-build-card__detail">
                      <p>{meta.description}</p>
                      <dl className="iw-signal-grid">
                        <div>
                          <dt>Absolute demand</dt>
                          <dd>{signal.demandMagnitudeScore.toFixed(0)}</dd>
                        </div>
                        <div>
                          <dt>Persistence</dt>
                          <dd>{signal.components.persistence.toFixed(0)}</dd>
                        </div>
                        <div>
                          <dt>Shock resistance</dt>
                          <dd>{signal.components.shockResistance.toFixed(0)}</dd>
                        </div>
                        <div>
                          <dt>Age / origin</dt>
                          <dd>{context.compact}</dd>
                        </div>
                        <div>
                          <dt>6M demand trend</dt>
                          <dd>{trend.sixMonth}</dd>
                        </div>
                      </dl>
                      <div
                        className={`iw-detail-trend iw-detail-trend--${trend.direction}`}
                      >
                        <strong>{trend.primary}</strong>
                        <span>{trend.detail}</span>
                      </div>
                      <p className="iw-detail-scope">
                        {assessment.buildQualification.reasonCodes.length === 0
                          ? 'All current Build gates are cleared.'
                          : assessment.buildQualification.reasonCodes
                            .slice(0, 2)
                            .map(formatReason)
                            .join(' ')}
                      </p>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        </>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="iw-empty" role="status">
          <strong>
            {search.trim()
              ? `No tracked subject matches “${search.trim()}”.`
              : 'No subjects match this screen.'}
          </strong>
          <span>
            {search.trim()
              ? 'Try another spelling. Every board status and sport was searched.'
              : 'Broaden the posture or cohort.'}
          </span>
          <button type="button" onClick={onReset}>Reset Build Board filters</button>
        </div>
      ) : null}

      {!error && pagination.totalPages > 1 ? (
        <nav className="iw-pagination" aria-label="Build Board result pages">
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
