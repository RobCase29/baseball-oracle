import { Fragment, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LockKeyhole,
  RotateCcw,
} from 'lucide-react'
import type {
  BinderAction,
  BinderRoute,
  BinderScoreFeedItem,
  BinderScoresResponse,
} from '../domain/binderScore'
import './young-investor-workbench.css'

export type YoungPlayerStage = 'All' | 'Minors' | 'RC' | 'MLB'
export type YoungPlayerAgeCeiling = 21 | 23 | 25 | 27

interface YoungInvestorWorkbenchProps {
  response: BinderScoresResponse | null
  loading: boolean
  error: string | null
  ageMax: YoungPlayerAgeCeiling
  stage: YoungPlayerStage
  page: number
  onAgeMaxChange: (value: YoungPlayerAgeCeiling) => void
  onStageChange: (value: YoungPlayerStage) => void
  onPageChange: (value: number) => void
  onReset: () => void
}

const ageOptions: readonly YoungPlayerAgeCeiling[] = [21, 23, 25, 27]

const stageOptions: ReadonlyArray<{
  value: YoungPlayerStage
  label: string
}> = [
  { value: 'All', label: 'All young players' },
  { value: 'Minors', label: 'Prospects' },
  { value: 'RC', label: 'Recent callups' },
  { value: 'MLB', label: 'MLB track' },
]

const routeLabels: Record<BinderRoute, string> = {
  pre_debut: 'Pre-debut prospect',
  post_debut_minors: 'Post-debut minors',
  recent_callup: 'Recent callup',
  early_mlb: 'Early MLB',
  established_mlb: 'Established MLB',
  inactive: 'Inactive',
}

const actionLabels: Record<BinderAction, string> = {
  build: 'Build',
  core_hold: 'Core hold',
  watch: 'Watch',
  trim_hype: 'Hype review',
  pass: 'Pass',
  insufficient_evidence: 'Action withheld',
}

const actionPostures: Record<
  BinderAction,
  | 'build_candidate'
  | 'hold_candidate'
  | 'watch'
  | 'risk_review'
  | 'pass'
  | 'unrated'
> = {
  build: 'build_candidate',
  core_hold: 'hold_candidate',
  watch: 'watch',
  trim_hype: 'risk_review',
  pass: 'pass',
  insufficient_evidence: 'unrated',
}

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

function scoreLabel(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

function ageLabel(value: number | null): string {
  if (value === null) return '—'
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

function moneyLabel(value: number | null): string {
  return value === null ? '—' : compactCurrencyFormatter.format(value)
}

function formatReason(value: string): string {
  const words = value.replaceAll('_', ' ')
  return `${words.charAt(0).toLocaleUpperCase()}${words.slice(1)}.`
}

function rankStatus(input: {
  total: number
  current: boolean
}): 'ranked' | 'small_screen' | 'refresh_required' {
  if (!input.current) return 'refresh_required'
  return input.total >= 20 ? 'ranked' : 'small_screen'
}

function evidenceLabel(item: BinderScoreFeedItem): string {
  if (item.assessment.flags.marketIdentityConfirmed) return 'Reviewed'
  if (item.assessment.flags.marketIdentityStatus === 'unique_normalized_name') {
    return 'Provisional'
  }
  return 'Withheld'
}

export function YoungInvestorWorkbench({
  response,
  loading,
  error,
  ageMax,
  stage,
  page,
  onAgeMaxChange,
  onStageChange,
  onPageChange,
  onReset,
}: YoungInvestorWorkbenchProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const items = response?.items ?? []
  const pagination = response?.page ?? {
    page,
    limit: 50,
    total: 0,
    totalPages: 0,
  }
  const current = response !== null &&
    response.snapshot.baseballFreshness.status === 'current' &&
    response.snapshot.marketFreshness.status === 'current'
  const orderingStatus = rankStatus({
    total: pagination.total,
    current,
  })
  const scopeLabel = stageOptions.find((option) => option.value === stage)?.label ??
    'All young players'
  const filtersActive = ageMax !== 25 || stage !== 'All'

  return (
    <div className="yw-body" aria-busy={loading}>
      <div className="iw-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {loading
          ? 'Updating young-player results.'
          : error
            ? ''
            : `${pagination.total.toLocaleString()} young-player matches. Page ${pagination.page} of ${Math.max(1, pagination.totalPages)}.`}
      </div>

      <div
        className="iw-controls yw-controls"
        role="group"
        aria-label="Young player filters"
      >
        <div className="yw-control-context">
          <span className="iw-control-label">Young player lens</span>
          <strong>Re-rank the full scored slice</strong>
          <small>Age and stage change the universe—not the underlying score.</small>
        </div>

        <label>
          <span className="iw-control-label">Age ceiling</span>
          <select
            value={ageMax}
            onChange={(event) => {
              onAgeMaxChange(
                Number(event.currentTarget.value) as YoungPlayerAgeCeiling,
              )
            }}
          >
            {ageOptions.map((value) => (
              <option key={value} value={value}>
                Age {value} or younger
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="iw-control-label">Career stage</span>
          <select
            value={stage}
            onChange={(event) => {
              onStageChange(event.currentTarget.value as YoungPlayerStage)
            }}
          >
            {stageOptions.map((option) => (
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

      <div className="iw-result-bar yw-result-bar">
        <div>
          <strong>{pagination.total.toLocaleString()}</strong>
          <span>scored · Baseball · age ≤{ageMax}</span>
        </div>
        <p>
          {orderingStatus === 'ranked'
            ? `${scopeLabel} are ordered by the existing Binder Score, regardless of their Binder call.`
            : orderingStatus === 'small_screen'
              ? `Sorted by Binder Score; ordinal hidden for this small screen (n=${pagination.total}).`
              : 'Scores remain visible, but the ordinal is suspended until both inputs are current.'}
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
          Loading the current young-player screen…
        </div>
      ) : null}

      {items.length > 0 ? (
        <div
          className={`iw-table-frame yw-table-frame${loading ? ' is-loading' : ''}`}
          aria-busy={loading}
        >
          <table aria-label="Young baseball collection research table">
            <caption className="iw-sr-only">
              Young baseball players ordered within the selected age and career-stage
              scope by the existing Binder Score.
            </caption>
            <thead>
              <tr>
                <th className="iw-expand-column" aria-label="Row details" />
                <th className="iw-subject-column" scope="col">Player</th>
                <th scope="col">Young player rank</th>
                <th scope="col">Age</th>
                <th scope="col">Stage</th>
                <th scope="col">Binder Score</th>
                <th scope="col">Baseball thesis</th>
                <th scope="col">Collector demand</th>
                <th scope="col">TTM demand</th>
                <th scope="col">Binder call</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const { player, assessment } = item
                const expanded = expandedId === player.id
                const ordinal =
                  (pagination.page - 1) * pagination.limit + index + 1
                const posture = actionPostures[assessment.action]
                const ageRunway =
                  assessment.components.baseballThesis.components.ageRunway
                const demand = assessment.components.collectorDemand
                return (
                  <Fragment key={player.id}>
                    <tr className={`iw-data-row iw-posture--${posture}`}>
                      <td className="iw-expand-column">
                        <button
                          type="button"
                          aria-label={`${expanded ? 'Hide' : 'Show'} young-player detail for ${player.name}`}
                          aria-expanded={expanded}
                          onClick={() => setExpandedId(expanded ? null : player.id)}
                        >
                          {expanded ? (
                            <ChevronUp size={15} aria-hidden="true" />
                          ) : (
                            <ChevronDown size={15} aria-hidden="true" />
                          )}
                        </button>
                      </td>
                      <th className="iw-subject-column" scope="row">
                        <strong>{player.name}</strong>
                        <span>
                          {[
                            player.position,
                            player.organizationCode ?? player.organization,
                            player.playerType,
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </th>
                      <td className="iw-number iw-rank yw-rank">
                        {orderingStatus === 'ranked' ? (
                          <>
                            <strong>#{ordinal}</strong>
                            <span>of {pagination.total.toLocaleString()}</span>
                          </>
                        ) : (
                          <>
                            <strong>—</strong>
                            <span>
                              {orderingStatus === 'small_screen'
                                ? 'small screen'
                                : 'refresh needed'}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="iw-number yw-age">
                        <strong>{ageLabel(player.age)}</strong>
                        <span>Oracle age</span>
                      </td>
                      <td className="yw-stage">
                        <strong>{routeLabels[player.stage]}</strong>
                        <span>{player.level ?? 'Baseball track'}</span>
                      </td>
                      <td className="iw-number iw-score">
                        <strong>{scoreLabel(assessment.score)}</strong>
                        <span>/100</span>
                      </td>
                      <td className="iw-number">
                        <strong>
                          {scoreLabel(assessment.components.baseballThesis.score)}
                        </strong>
                        <span>75% of score</span>
                      </td>
                      <td className="iw-number">
                        <strong>{scoreLabel(demand.score)}</strong>
                        <span>25% of score</span>
                      </td>
                      <td className="iw-number">
                        <strong>
                          {moneyLabel(
                            demand.marketSignal.trailingTwelveMonthSalesUsd,
                          )}
                        </strong>
                        <span>sales volume</span>
                      </td>
                      <td>
                        <span className={`iw-posture iw-posture--${posture}`}>
                          {actionLabels[assessment.action]}
                        </span>
                      </td>
                      <td className="iw-evidence">
                        <strong>{evidenceLabel(item)}</strong>
                        <span>{assessment.confidence.score.toFixed(0)}/100 evidence</span>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="iw-detail-row">
                        <td colSpan={11}>
                          <div className="iw-detail yw-detail">
                            <section>
                              <span className="iw-detail-label">Why this order</span>
                              <h3>
                                {orderingStatus === 'ranked'
                                  ? `#${ordinal} of ${pagination.total.toLocaleString()}`
                                  : 'Sorted without an ordinal'}
                              </h3>
                              <p>
                                This is the player&apos;s unchanged Binder Score
                                ordered only against {scopeLabel.toLocaleLowerCase()}
                                {' '}age {ageMax} or younger. The lens does not promote
                                the Binder call.
                              </p>
                              <div className="iw-detail-scope">
                                Cross-stage research heuristic. It does not predict
                                appreciation or identify an exact card.
                              </div>
                            </section>

                            <section>
                              <span className="iw-detail-label">Score anatomy</span>
                              <dl className="iw-signal-grid">
                                <div>
                                  <dt>Career Index</dt>
                                  <dd>
                                    {scoreLabel(
                                      assessment.components.baseballThesis
                                        .components.careerIndex.rawValue,
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Route outcome</dt>
                                  <dd>
                                    {scoreLabel(
                                      assessment.components.baseballThesis
                                        .components.routeOutcomePercentile.rawValue,
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Age runway</dt>
                                  <dd>{scoreLabel(ageRunway.rawValue)}</dd>
                                </div>
                                <div>
                                  <dt>Demand</dt>
                                  <dd>{scoreLabel(demand.score)}</dd>
                                </div>
                                <div>
                                  <dt>Hype penalty</dt>
                                  <dd>{assessment.components.hypePenalty.value.toFixed(1)}</dd>
                                </div>
                                <div>
                                  <dt>Evidence</dt>
                                  <dd>{assessment.confidence.score.toFixed(0)}/100</dd>
                                </div>
                              </dl>
                              <p className="yw-age-note">
                                Age runway is deliberately modest: 15% of Baseball
                                Thesis, or 11.25% of the pre-penalty total.
                              </p>
                            </section>

                            <section>
                              <span className="iw-detail-label">Evidence boundary</span>
                              <h3>{evidenceLabel(item)} market identity</h3>
                              <p>
                                Baseball: {assessment.flags.baseballFreshness}.
                                {' '}Market: {assessment.flags.marketFreshness}.
                                {' '}Identity: {
                                  assessment.flags.marketIdentityStatus.replaceAll('_', ' ')
                                }.
                              </p>
                              <ul>
                                {[
                                  ...assessment.actionReasonCodes,
                                  ...assessment.confidence.reasonCodes,
                                ]
                                  .filter((reason, reasonIndex, reasons) => (
                                    reasons.indexOf(reason) === reasonIndex
                                  ))
                                  .slice(0, 5)
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
          <strong>No scored players match this young-player screen.</strong>
          <span>Broaden the age ceiling or career-stage filter.</span>
          <button type="button" onClick={onReset}>Reset young-player lens</button>
        </div>
      ) : null}

      {!error && pagination.totalPages > 1 ? (
        <nav className="iw-pagination" aria-label="Young player result pages">
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
