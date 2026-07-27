import type {
  BinderAction,
  BinderComponent,
  BinderMarketIdentityStatus,
  BinderScoreResult,
} from '../domain/binderScore'

export interface BinderScorePanelProps {
  result: BinderScoreResult | null
}

interface ComponentRow {
  key: string
  group: string
  label: string
  component: BinderComponent
}

const actionLabels: Record<BinderAction, string> = {
  build: 'Build',
  core_hold: 'Core hold',
  watch: 'Watch',
  trim_hype: 'Trim hype',
  pass: 'Pass',
  insufficient_evidence: 'Evidence needed',
}

const identityLabels: Record<BinderMarketIdentityStatus, string> = {
  verified_external_id: 'Verified external ID',
  manual_verified: 'Manually verified',
  unique_normalized_name: 'Unique normalized name · provisional',
  ambiguous: 'Ambiguous market identity',
  unmatched: 'No market match',
}

function scoreLabel(value: number | null): string {
  return value === null ? '—' : Math.round(value).toString()
}

function decimalLabel(value: number | null): string {
  return value === null ? 'Missing' : value.toFixed(1)
}

function percentLabel(value: number): string {
  return `${Math.round(value)}%`
}

function reasonLabel(value: string): string {
  const normalized = value
    .replaceAll('_', ' ')
    .replace(/^./u, (character) => character.toLocaleUpperCase())
  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`
}

function freshnessLabel(value: BinderScoreResult['flags']['baseballFreshness']): string {
  return value.replace(/^./u, (character) => character.toLocaleUpperCase())
}

function identityEvidenceLabel(result: BinderScoreResult): string {
  if (result.flags.marketIdentityStatus === 'unique_normalized_name') {
    return 'provisional exact-name match'
  }
  return result.flags.marketIdentityConfirmed ? 'confirmed' : 'not confirmed'
}

function componentRows(result: BinderScoreResult): ComponentRow[] {
  return [
    {
      key: 'career-index',
      group: 'Baseball Thesis',
      label: 'Career index',
      component: result.components.baseballThesis.components.careerIndex,
    },
    {
      key: 'route-outcome',
      group: 'Baseball Thesis',
      label: 'Route outcome percentile',
      component: result.components.baseballThesis.components.routeOutcomePercentile,
    },
    {
      key: 'age-runway',
      group: 'Baseball Thesis',
      label: 'Age-adjusted runway',
      component: result.components.baseballThesis.components.ageRunway,
    },
    {
      key: 'market-demand',
      group: 'Collector Demand',
      label: 'Trailing 12-month demand percentile',
      component:
        result.components.collectorDemand.components
          .trailingTwelveMonthDemandPercentile,
    },
    {
      key: 'demand-durability',
      group: 'Collector Demand',
      label: 'Demand durability',
      component: result.components.collectorDemand.components.durabilityResilience,
    },
    {
      key: 'market-momentum',
      group: 'Collector Demand',
      label: 'Recent demand momentum',
      component: result.components.collectorDemand.components.recentMomentum,
    },
  ]
}

export function BinderScorePanel({ result }: BinderScorePanelProps) {
  if (!result) return null

  const rows = componentRows(result)
  const hasImputedEvidence = rows.some((row) => row.component.imputedToPrior)
  const missingData =
    hasImputedEvidence ||
    result.flags.overallWithheld ||
    !result.flags.marketEvidenceComplete ||
    !result.flags.coreBaseballEvidenceComplete
  const marketSignal = result.components.collectorDemand.marketSignal

  return (
    <section
      className="dossier-section binder-score-panel"
      aria-labelledby="binder-detail-title"
    >
      <div className="section-heading-row binder-score-heading">
        <div>
          <span className="eyebrow">BUILD A BINDER · RESEARCH ONLY</span>
          <h2 id="binder-detail-title">Long-term collection thesis</h2>
          <p>
            {result.player.name} · Age {result.player.age ?? 'unknown'} ·{' '}
            {result.player.route.replaceAll('_', ' ')}
          </p>
        </div>
        <span className="build-badge">
          {scoreLabel(result.score)} · {actionLabels[result.action]}
        </span>
      </div>

      <div className="binder-score-body">
        <section className="dossier-section dynasty-score-panel" aria-labelledby="binder-summary-title">
          <div className="section-heading-row dynasty-score-heading">
            <div>
              <span className="eyebrow">TRANSPARENT COLLECTION THESIS</span>
              <h3 id="binder-summary-title">Score summary</h3>
            </div>
            <span className="dynasty-independent-badge">
              {result.version.modelVersion}
            </span>
          </div>
          <div className="dynasty-score-grid">
            <div>
              <span>Thesis Score</span>
              <strong>{scoreLabel(result.score)}</strong>
              <small>0–100 research scale</small>
            </div>
            <div>
              <span>Guidance</span>
              <strong>{actionLabels[result.action]}</strong>
              <small>collection signal</small>
            </div>
            <div>
              <span>Baseball Thesis</span>
              <strong>{scoreLabel(result.components.baseballThesis.score)}</strong>
              <small>75% overall weight</small>
            </div>
            <div>
              <span>Collector Demand</span>
              <strong>{scoreLabel(result.components.collectorDemand.score)}</strong>
              <small>25% overall weight</small>
            </div>
            <div>
              <span>Hype Penalty</span>
              <strong>−{result.components.hypePenalty.value.toFixed(1)}</strong>
              <small>max {result.components.hypePenalty.maximum}</small>
            </div>
            <div>
              <span>Confidence</span>
              <strong>{percentLabel(result.confidence.score)}</strong>
              <small>{result.confidence.band}</small>
            </div>
          </div>
        </section>

        {missingData ? (
          <div className="research-warning" role="note">
            <div>
              <strong>Missing evidence is not treated as neutral certainty.</strong>
              <span>
                Missing components shrink to the cohort prior of 50, and guidance may be
                withheld. Review every imputed row before acting on this research signal.
              </span>
            </div>
          </div>
        ) : null}

        <section className="dossier-section" aria-labelledby="binder-components-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">INPUTS AND WEIGHTS</span>
              <h3 id="binder-components-title">Score components</h3>
            </div>
          </div>
          <div className="source-table-wrap">
            <table className="source-table source-table--plain">
              <caption className="sr-only">
                Baseball thesis component values, weights, and weighted contributions
              </caption>
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Component</th>
                  <th scope="col">Observed</th>
                  <th scope="col">Effective</th>
                  <th scope="col">Within-group weight</th>
                  <th scope="col">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.group}</td>
                    <td>
                      <strong>{row.label}</strong>
                      {row.component.imputedToPrior ? (
                        <small>Missing · imputed to prior</small>
                      ) : null}
                    </td>
                    <td>{decimalLabel(row.component.rawValue)}</td>
                    <td>{row.component.effectiveValue.toFixed(1)}</td>
                    <td>{percentLabel(row.component.weight * 100)}</td>
                    <td>{row.component.weightedContribution.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="dossier-section" aria-labelledby="binder-evidence-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">IDENTITY, FRESHNESS, AND COVERAGE</span>
              <h3 id="binder-evidence-title">Evidence quality</h3>
            </div>
          </div>
          <div className="dynasty-score-grid">
            <div>
              <span>Market identity</span>
              <strong>{identityLabels[result.flags.marketIdentityStatus]}</strong>
              <small>{identityEvidenceLabel(result)}</small>
            </div>
            <div>
              <span>Baseball freshness</span>
              <strong>{freshnessLabel(result.flags.baseballFreshness)}</strong>
              <small>{result.flags.coreBaseballEvidenceComplete ? 'complete' : 'incomplete'}</small>
            </div>
            <div>
              <span>Market freshness</span>
              <strong>{freshnessLabel(result.flags.marketFreshness)}</strong>
              <small>{result.flags.marketEvidenceComplete ? 'complete' : 'incomplete'}</small>
            </div>
            <div>
              <span>Market cohort</span>
              <strong>{result.components.collectorDemand.cohortId ?? 'Unavailable'}</strong>
              <small>compare within cohort</small>
            </div>
            <div>
              <span>Observed months</span>
              <strong>{marketSignal.observedMonths}/12</strong>
              <small>{percentLabel(marketSignal.coverageRatio * 100)} coverage</small>
            </div>
            <div>
              <span>Trailing sales</span>
              <strong>
                {marketSignal.trailingTwelveMonthSalesUsd === null
                  ? 'Unavailable'
                  : new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: 'USD',
                      maximumFractionDigits: 0,
                      notation: 'compact',
                    }).format(marketSignal.trailingTwelveMonthSalesUsd)}
              </strong>
              <small>completed eBay singles volume</small>
            </div>
          </div>
        </section>

        <section className="dossier-section" aria-labelledby="binder-reasons-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">WHY THIS GUIDANCE</span>
              <h3 id="binder-reasons-title">Decision notes</h3>
            </div>
          </div>
          {result.actionReasonCodes.length > 0 ? (
            <ul>
              {result.actionReasonCodes.map((reason) => (
                <li key={reason}>{reasonLabel(reason)}</li>
              ))}
            </ul>
          ) : (
            <p>No additional action reason codes were emitted.</p>
          )}
          {result.confidence.reasonCodes.length > 0 ? (
            <>
              <strong>Confidence notes</strong>
              <ul>
                {result.confidence.reasonCodes.map((reason) => (
                  <li key={reason}>{reasonLabel(reason)}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <footer className="dossier-footer binder-disclosures">
          <span>
            Statistical Hall-caliber trajectory, not Hall of Fame election odds.
          </span>
          <span>
            Athlete-level demand volume is not card appreciation; card-level scarcity and
            value are not modeled.
          </span>
          <span>
            Unique normalized-name matches are provisional until identity is verified.
          </span>
          <span className="footer-score">
            Research only · not financial advice
          </span>
        </footer>
      </div>
    </section>
  )
}
