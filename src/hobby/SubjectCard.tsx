import { AlertTriangle, CircleDashed, LockKeyhole } from 'lucide-react'
import type {
  MagnificentXDomain,
  MagnificentXFeedItem,
  MagnificentXResearchTier,
} from '../domain/magnificentX'

interface SubjectCardProps {
  item: MagnificentXFeedItem
}

const domainLabels: Record<MagnificentXDomain, string> = {
  baseball: 'Baseball',
  basketball: 'Basketball',
  football: 'Football',
  soccer: 'Soccer',
  hockey: 'Hockey',
  golf: 'Golf',
  combat: 'Combat & wrestling',
  other_sport: 'Other sport',
  mixed_sport: 'Mixed sport',
  culture: 'Culture · outside scope',
  pokemon: 'Pokémon',
}

const tierLabels: Record<MagnificentXResearchTier, string> = {
  market_leader: 'Market leader',
  durable_demand: 'Durable demand',
  watch: 'Watch',
  noise_risk: 'Noise risk',
  long_tail: 'Long tail',
  evidence_needed: 'Evidence needed',
}

const reasonLabels: Readonly<Record<string, string>> = {
  market_strength_gate_not_met:
    'The provisional market signal has not cleared the strength gate.',
  cohort_quality_gate_not_met:
    'The provider cohort is too small, mixed, or outside the eligible taxonomy.',
  history_below_36_complete_months:
    'Only 18 of the required 36 complete market-history months are available.',
  canonical_subject_identity_missing:
    'A durable canonical subject identity has not been established.',
  domain_fundamentals_missing:
    'A validated sport or character fundamentals model is not available.',
  global_scale_overlap_not_verified:
    'Cross-cohort overlap and global scale have not been independently verified.',
  supply_dilution_evidence_missing:
    'Card supply, population growth, and dilution evidence are missing.',
  exact_card_evidence_missing:
    'Exact-card set, year, variation, grade, scarcity, and price evidence are missing.',
  outcome_validation_missing:
    'The model has not passed retrospective durable-outcome validation.',
  market_snapshot_not_current:
    'The monthly market snapshot is not current.',
  pokemon_character_bucket_not_exact_card:
    'Pokémon evidence describes a character bucket, not an exact card.',
  national_dex_identity_missing:
    'The Pokémon row is not yet anchored to a reviewed National Pokédex identity.',
  athlete_sport_era_identity_unverified:
    'The athlete’s sport and era identity has not completed canonical review.',
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatReason(value: string): string {
  const known = reasonLabels[value]
  if (known) return known
  const words = value.replaceAll('_', ' ')
  return `${words.charAt(0).toLocaleUpperCase()}${words.slice(1)}.`
}

export function SubjectCard({ item }: SubjectCardProps) {
  const { subject, assessment, withinCohortRank } = item
  const signal = assessment.marketSignal
  const gates = Object.entries(assessment.magnificentX.gates)
  const unresolvedGateCount =
    assessment.magnificentX.requiredGateCount -
    assessment.magnificentX.passedGateCount
  const componentRows = [
    { key: 'scale', label: 'Cohort scale', value: signal.components.scale },
    {
      key: 'persistence',
      label: 'Persistence',
      value: signal.components.persistence,
    },
    {
      key: 'shock-resistance',
      label: 'Shock resistance',
      value: signal.components.shockResistance,
    },
    {
      key: 'trend-context',
      label: 'Trend context',
      value: signal.components.trendContext,
    },
  ] as const

  return (
    <article className={`mx-subject-card mx-tier--${assessment.researchTier}`}>
      <header className="mx-subject-header">
        <div>
          <span className="mx-domain-pill">{domainLabels[subject.domain]}</span>
          <span className={`mx-tier-pill mx-tier-pill--${assessment.researchTier}`}>
            {tierLabels[assessment.researchTier]}
          </span>
        </div>
        <span className="mx-withheld-pill">
          <LockKeyhole size={12} aria-hidden="true" />
          X withheld
        </span>
      </header>

      <div className="mx-subject-title">
        <div>
          <h3>{subject.name}</h3>
          <p>
            Rank <strong>#{withinCohortRank}</strong> of{' '}
            {assessment.flags.cohortSize.toLocaleString()} ·{' '}
            {signal.withinCohortPercentile.toFixed(1)} cohort percentile
          </p>
        </div>
        <div className="mx-signal-score">
          <strong>{signal.score.toFixed(1)}</strong>
          <span>market signal</span>
          <small>provisional</small>
        </div>
      </div>

      <div className="mx-primary-metrics">
        <div>
          <span>TRAILING 12-MONTH SPEND</span>
          <strong>{formatMoney(signal.latestTwelveMonthSalesUsd)}</strong>
          <small>completed eBay singles volume</small>
        </div>
        <div>
          <span>EVIDENCE CONFIDENCE</span>
          <strong>{assessment.confidence.score.toFixed(0)}/100</strong>
          <small>{assessment.confidence.band} · not a confidence interval</small>
        </div>
      </div>

      <section className="mx-components" aria-label={`Durability components for ${subject.name}`}>
        <h4>Provisional demand durability</h4>
        {componentRows.map((component) => (
          <div className="mx-component-row" key={component.key}>
            <span>{component.label}</span>
            <meter min="0" max="100" value={component.value}>
              {component.value}
            </meter>
            <strong>{component.value.toFixed(0)}</strong>
          </div>
        ))}
      </section>

      {subject.type === 'pokemon_character' ? (
        <div className="mx-subject-warning">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>
            Character-level demand only. This does not identify a card, set,
            language, grade, population, or entry price.
          </span>
        </div>
      ) : (
        <div className="mx-subject-warning mx-subject-warning--muted">
          <CircleDashed size={15} aria-hidden="true" />
          <span>
            Athlete-level demand only. No specific card or expected return is implied.
          </span>
        </div>
      )}

      <div className="mx-gate-summary">
        <div>
          <span>DESIGNATION GATES</span>
          <strong>
            {assessment.magnificentX.passedGateCount}/
            {assessment.magnificentX.requiredGateCount} passed
          </strong>
        </div>
        <div className="mx-gate-dots" aria-hidden="true">
          {gates.map(([name, passed]) => (
            <span
              className={passed ? 'is-passed' : ''}
              key={name}
            />
          ))}
        </div>
      </div>

      <details className="mx-withhold-reasons">
        <summary>
          Why designation is withheld · {unresolvedGateCount} unresolved gate
          {unresolvedGateCount === 1 ? '' : 's'}
        </summary>
        <ul>
          {assessment.magnificentX.reasonCodes.map((reason) => (
            <li key={reason}>
              <span aria-hidden="true">
                {reason.includes('not_met') ? (
                  <CircleDashed size={13} />
                ) : (
                  <AlertTriangle size={13} />
                )}
              </span>
              {formatReason(reason)}
            </li>
          ))}
        </ul>
      </details>
    </article>
  )
}
