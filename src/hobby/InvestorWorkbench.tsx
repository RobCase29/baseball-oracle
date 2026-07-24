import { Fragment, useState } from 'react'
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
import {
  researchPostureForAssessment,
  type MagnificentXDomain,
  type MagnificentXFeedItem,
  type MagnificentXFeedResponse,
  type MagnificentXResearchPosture,
  type MagnificentXSortDirection,
  type MagnificentXSortKey,
} from '../domain/magnificentX'
import './investor-workbench.css'

export interface InvestorWorkbenchProps {
  response: MagnificentXFeedResponse | null
  loading: boolean
  error: string | null
  search: string
  domain: MagnificentXDomain | 'all'
  posture: MagnificentXResearchPosture | 'all'
  sort: MagnificentXSortKey
  direction: MagnificentXSortDirection
  page: number
  onSearchChange: (value: string) => void
  onDomainChange: (value: MagnificentXDomain | 'all') => void
  onPostureChange: (value: MagnificentXResearchPosture | 'all') => void
  onSortChange: (value: MagnificentXSortKey) => void
  onDirectionChange: (value: MagnificentXSortDirection) => void
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

const postureOptions: ReadonlyArray<{
  value: MagnificentXResearchPosture | 'all'
  shortLabel: string
  label: string
}> = [
  { value: 'build_candidate', shortLabel: 'Build', label: 'Build candidates' },
  { value: 'hold_candidate', shortLabel: 'Hold', label: 'Hold candidates' },
  { value: 'watch', shortLabel: 'Watch', label: 'Watch' },
  { value: 'risk_review', shortLabel: 'Risk', label: 'Risk review' },
  { value: 'pass', shortLabel: 'Pass', label: 'Pass' },
  { value: 'unrated', shortLabel: 'Unrated', label: 'Unrated' },
  { value: 'needs_refresh', shortLabel: 'Refresh', label: 'Needs refresh' },
  { value: 'all', shortLabel: 'All', label: 'All evidence' },
]

const postureMeta: Record<MagnificentXResearchPosture, {
  label: string
  description: string
}> = {
  build_candidate: {
    label: 'Build candidate',
    description: 'Highest-priority subject for exact-card underwriting or a core hold review.',
  },
  hold_candidate: {
    label: 'Hold candidate',
    description: 'Durable demand supports a hold or selective-add research review.',
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
    'Strongest subject-level demand candidates. Underwrite the exact card before committing capital.',
  hold_candidate:
    'Durable demand candidates for existing-position review or selective-add research.',
  watch: 'Credible demand that still needs a stronger durability profile.',
  risk_review:
    'Concentrated or weakening demand to examine before considering additions.',
  pass: 'Low-priority subject demand. Pass is not an instruction to sell a scarce card.',
  unrated: 'Rows withheld because cohort or identity evidence is insufficient.',
  needs_refresh: 'Rows suspended because the monthly market snapshot is overdue.',
  all: 'All evidence lanes. Cohort rank—not cross-hobby order—is the validated comparison.',
}

const sortOptions: ReadonlyArray<{
  value: MagnificentXSortKey
  label: string
}> = [
  { value: 'cohort_rank', label: 'Cohort rank' },
  { value: 'signal', label: 'Demand durability' },
  { value: 'ttm_sales', label: 'TTM demand' },
  { value: 'trend', label: '6M demand change' },
  { value: 'persistence', label: 'Persistence' },
  { value: 'shock_resistance', label: 'Shock resistance' },
  { value: 'cohort_percentile', label: 'Cohort percentile' },
  { value: 'name', label: 'Subject name' },
]

const reasonLabels: Readonly<Record<string, string>> = {
  market_strength_gate_not_met: 'Market-strength threshold has not cleared.',
  cohort_quality_gate_not_met: 'Provider cohort is not eligible.',
  history_below_36_complete_months: 'Only 18 of 36 required months are available.',
  canonical_subject_identity_missing: 'Canonical subject identity is missing.',
  domain_fundamentals_missing: 'Validated domain fundamentals are missing.',
  global_scale_overlap_not_verified: 'Cross-cohort global scale is not verified.',
  supply_dilution_evidence_missing: 'Supply and dilution evidence is missing.',
  exact_card_evidence_missing: 'Exact-card, grade, scarcity, and price evidence is missing.',
  outcome_validation_missing: 'Durable-return outcome validation is missing.',
  market_snapshot_not_current: 'The monthly snapshot is not current.',
  pokemon_character_bucket_not_exact_card: 'Pokémon evidence is character-level.',
  national_dex_identity_missing: 'Reviewed National Pokédex identity is missing.',
  athlete_sport_era_identity_unverified: 'Athlete sport and era identity is unverified.',
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

function formatPercent(value: number): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}%`
}

function growthPercent(logGrowth: number): number {
  return 100 * Math.expm1(logGrowth)
}

function growthClass(value: number): string {
  if (value >= 5) return 'is-positive'
  if (value <= -5) return 'is-negative'
  return 'is-neutral'
}

function formatReason(value: string): string {
  const known = reasonLabels[value]
  if (known) return known
  const words = value.replaceAll('_', ' ')
  return `${words.charAt(0).toLocaleUpperCase()}${words.slice(1)}.`
}

function sortAriaValue(
  active: boolean,
  direction: MagnificentXSortDirection,
): 'ascending' | 'descending' | undefined {
  if (!active) return undefined
  return direction === 'asc' ? 'ascending' : 'descending'
}

function unresolvedGateCount(item: MagnificentXFeedItem): number {
  return item.assessment.magnificentX.requiredGateCount -
    item.assessment.magnificentX.passedGateCount
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
  onSearchChange,
  onDomainChange,
  onPostureChange,
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
    sort !== 'cohort_rank' ||
    direction !== 'asc'
  const showRefreshPosture =
    posture === 'needs_refresh' ||
    (
      response !== null &&
      response.snapshot.freshness.status !== 'current'
    )

  function changeSort(nextSort: MagnificentXSortKey): void {
    if (nextSort === sort) {
      onDirectionChange(direction === 'asc' ? 'desc' : 'asc')
      return
    }
    onSortChange(nextSort)
    onDirectionChange(
      nextSort === 'cohort_rank' || nextSort === 'name' ? 'asc' : 'desc',
    )
  }

  return (
    <section
      className="iw-shell"
      aria-label="Investor research workbench"
      aria-busy={loading}
    >
      <div className="iw-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {loading
          ? 'Updating investor board results.'
          : error
            ? ''
            : `${pagination.total.toLocaleString()} matches. Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}.`}
      </div>
      <div
        className="iw-posture-tabs"
        role="group"
        aria-label="Research posture"
      >
        {postureOptions
          .filter((option) => (
            option.value !== 'needs_refresh' || showRefreshPosture
          ))
          .map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={posture === option.value}
            title={option.label}
            onClick={() => onPostureChange(option.value)}
          >
            {option.shortLabel}
          </button>
          ))}
      </div>

      <div className="iw-controls" role="group" aria-label="Investor board filters">
        <label className="iw-search">
          <span className="iw-control-label">Subject</span>
          <span className="iw-input-shell">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={search}
              placeholder="Search player or Pokémon"
              onChange={(event) => onSearchChange(event.currentTarget.value)}
            />
          </span>
        </label>

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
              const nextSort = event.currentTarget.value as MagnificentXSortKey
              if (nextSort !== sort) {
                onSortChange(nextSort)
                onDirectionChange(
                  nextSort === 'cohort_rank' || nextSort === 'name'
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
                event.currentTarget.value as MagnificentXSortDirection,
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
          {domain === 'all' && sort !== 'name' ? (
            <strong className="iw-comparability">
              Cross-hobby order is a screen only; compare numeric signals within cohort.
            </strong>
          ) : (
            selectedPostureDescriptions[posture]
          )}
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
          Loading current investor screen…
        </div>
      ) : null}

      {items.length > 0 ? (
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
                <th scope="col">Cohort</th>
                <th scope="col">Research posture</th>
                <th
                  scope="col"
                  aria-sort={sortAriaValue(sort === 'signal', direction)}
                >
                  <button type="button" onClick={() => changeSort('signal')}>
                    Demand score
                    <span aria-hidden="true">
                      {sort === 'signal' ? (direction === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={sortAriaValue(sort === 'cohort_rank', direction)}
                >
                  <button type="button" onClick={() => changeSort('cohort_rank')}>
                    Cohort rank
                    <span aria-hidden="true">
                      {sort === 'cohort_rank'
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
                  aria-sort={sortAriaValue(sort === 'trend', direction)}
                >
                  <button type="button" onClick={() => changeSort('trend')}>
                    6M YoY
                    <span aria-hidden="true">
                      {sort === 'trend' ? (direction === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={sortAriaValue(sort === 'persistence', direction)}
                >
                  <button type="button" onClick={() => changeSort('persistence')}>
                    Persistence
                    <span aria-hidden="true">
                      {sort === 'persistence'
                        ? (direction === 'asc' ? '↑' : '↓')
                        : '↕'}
                    </span>
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={sortAriaValue(
                    sort === 'shock_resistance',
                    direction,
                  )}
                >
                  <button
                    type="button"
                    onClick={() => changeSort('shock_resistance')}
                  >
                    Stability
                    <span aria-hidden="true">
                      {sort === 'shock_resistance'
                        ? (direction === 'asc' ? '↑' : '↓')
                        : '↕'}
                    </span>
                  </button>
                </th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const { subject, assessment } = item
                const signal = assessment.marketSignal
                const rowPosture = researchPostureForAssessment(assessment)
                const meta = postureMeta[rowPosture]
                const sixMonthGrowth = growthPercent(
                  signal.diagnostics.yearOverYearSixMonthLogGrowth,
                )
                const expanded = expandedId === subject.id
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
                        <span>{subject.type === 'pokemon_character' ? 'Character' : 'Athlete'}</span>
                      </th>
                      <td>
                        <span className="iw-domain">{domainLabels[subject.domain]}</span>
                      </td>
                      <td>
                        <span className={`iw-posture iw-posture--${rowPosture}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="iw-number iw-score">
                        <strong>{signal.score.toFixed(1)}</strong>
                        <span>/100</span>
                      </td>
                      <td className="iw-number iw-rank">
                        <strong>#{item.withinCohortRank}</strong>
                        <span>{signal.withinCohortPercentile.toFixed(1)} pct</span>
                      </td>
                      <td className="iw-number">
                        <strong>{formatMoney(signal.latestTwelveMonthSalesUsd)}</strong>
                      </td>
                      <td className={`iw-number ${growthClass(sixMonthGrowth)}`}>
                        <strong>{formatPercent(sixMonthGrowth)}</strong>
                      </td>
                      <td className="iw-number">
                        <strong>{signal.components.persistence.toFixed(0)}</strong>
                      </td>
                      <td className="iw-number">
                        <strong>{signal.components.shockResistance.toFixed(0)}</strong>
                      </td>
                      <td className="iw-evidence">
                        <strong>{assessment.confidence.score.toFixed(0)}/100</strong>
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
                            </section>

                            <section>
                              <span className="iw-detail-label">Signal anatomy</span>
                              <dl className="iw-signal-grid">
                                <div>
                                  <dt>Scale</dt>
                                  <dd>{signal.components.scale.toFixed(0)}</dd>
                                </div>
                                <div>
                                  <dt>Persistence</dt>
                                  <dd>{signal.components.persistence.toFixed(0)}</dd>
                                </div>
                                <div>
                                  <dt>Stability</dt>
                                  <dd>{signal.components.shockResistance.toFixed(0)}</dd>
                                </div>
                                <div>
                                  <dt>Trend</dt>
                                  <dd>{signal.components.trendContext.toFixed(0)}</dd>
                                </div>
                                <div>
                                  <dt>Recent 3M YoY</dt>
                                  <dd>
                                    {formatPercent(growthPercent(
                                      signal.diagnostics
                                        .recentThreeMonthYearOverYearLogGrowth,
                                    ))}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Evidence</dt>
                                  <dd>{assessment.confidence.score.toFixed(0)}/100</dd>
                                </div>
                              </dl>
                            </section>

                            <section>
                              <span className="iw-detail-label">
                                Why card action is withheld
                              </span>
                              <p className="iw-gate-count">
                                {assessment.magnificentX.passedGateCount} of{' '}
                                {assessment.magnificentX.requiredGateCount} gates passed
                              </p>
                              <ul>
                                {assessment.magnificentX.reasonCodes
                                  .slice(0, 6)
                                  .map((reason) => (
                                    <li key={reason}>{formatReason(reason)}</li>
                                  ))}
                              </ul>
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
          <strong>No subjects match this screen.</strong>
          <span>Broaden the posture, cohort, or search.</span>
          <button type="button" onClick={onReset}>Reset investor board</button>
        </div>
      ) : null}

      {!error && pagination.totalPages > 1 ? (
        <nav className="iw-pagination" aria-label="Investor board result pages">
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
    </section>
  )
}
