import { lazy, Suspense } from 'react'
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Check,
  CircleDashed,
  Database,
  Gauge,
  Info,
  Layers3,
  List,
  ShieldCheck,
  Star,
  Target,
} from 'lucide-react'
import type { CareerForecast, PlayerRecord } from '../domain/forecast'
import {
  formatOrdinal,
  formatProbability,
  formatWar,
  isMlbStage,
  stageLabel,
} from '../lib/forecast'
import { ProbabilityRing } from './ProbabilityRing'

const CareerArcChart = lazy(() =>
  import('./CareerArcChart').then((module) => ({ default: module.CareerArcChart })),
)

const ArrivalHorizonChart = lazy(() =>
  import('./ArrivalHorizonChart').then((module) => ({ default: module.ArrivalHorizonChart })),
)

interface PlayerDossierProps {
  player: PlayerRecord
  saved: boolean
  onToggleWatchlist: (playerId: string) => void
  onReturnToBoard: () => void
}

function warningLabel(warning: string, forecast: CareerForecast): string {
  const labels: Record<string, string> = {
    research_only: 'Research output; release gates are incomplete.',
    retrospective_validation_only: 'Validation is retrospective, not a prospective track record.',
    partial_season_input: 'The 2026 statistics are an in-season snapshot.',
    forecast_features_exclude_current_partial_season:
      'The forecast uses completed-season features; 2026 value is shown as recorded context only.',
    partial_season_feature_fallback:
      'Partial-season statistics are context only. Without a validated completed-season feature state, the career forecast is withheld.',
    career_arc_terminal_timing_baseline:
      'The projected arc is a terminal timing baseline, not a simulated annual aging path.',
    arrival_external_validation_failed:
      'The arrival model did not clear its external release gates.',
    bridge_baseline_not_direct_milb_to_hof_training:
      'The prospect career tail uses an MLB debut-age bridge; no direct MiLB-to-Hall outcome cohort exists yet.',
    unconditional_probability_uses_60_month_arrival_horizon:
      'The prospect HOF estimate uses the frozen 60-month arrival endpoint.',
    arrival_cold_start: 'The arrival estimate is a cold-start prediction.',
    roster_no_2026_appearance:
      'The player is on a current 40-man roster but has no recorded 2026 MLB appearance.',
    rostered_without_2026_mlb_appearance:
      'The player is on a current 40-man roster but has no recorded 2026 MLB appearance.',
    roster_status_injured_list: 'The current roster snapshot lists the player on the injured list.',
    roster_status_other_40_man:
      'The player is on the 40-man roster but not on the active or injured list at snapshot time.',
    two_way_target_not_preregistered_forecast_withheld:
      'The forecast is withheld because a two-way Hall-caliber standard has not been preregistered.',
    mixed_position_target_bridge_no_single_standard:
      'The prospect bridge mixes historical positions, so no single positional JAWS reference applies.',
    not_eventual_arrival_probability_lower_bound_proxy:
      'The 60-month arrival endpoint is a lower-bound proxy, not an eventual-arrival probability.',
    future_position_hof_standard_uncertain:
      'The comparison uses the player\'s career-to-date role/position standard and rebaselines if that classification changes.',
    confidence_is_heuristic_not_coverage_probability:
      'Confidence is a heuristic evidence and uncertainty summary, not a calibrated coverage probability.',
    current_scoring_refit_not_cross_fitted_or_evaluated:
      'The exact current-player refit has not been cross-fitted or independently evaluated, so it does not inherit the tournament metrics.',
    early_hall_tail_not_learned_research_only:
      'For MLB seasons one through three, the rare Hall-caliber tail is not yet learned well enough for a release claim; P95/P99 and elite-tail validation remain pending.',
    hof_target_rebaselines_if_career_to_date_standard_changes:
      'The Hall-caliber target uses the career-to-date role/position standard and rebaselines the forecast if that classification changes.',
    partial_only_unvalidated_forecast_withheld:
      'Only partial-season MLB evidence is available. Because partial-only scoring is unvalidated, the career forecast is withheld.',
    stale_return_feature_state_forecast_withheld:
      'The player returned after a gap, but the latest completed-season feature state is stale, so the career forecast is withheld.',
    current_opportunity_unobserved_forecast_withheld:
      'No current MLB opportunity is observed in the scoring snapshot, so the career forecast is withheld.',
    young_elite_distribution_gate_failed_forecast_withheld:
      'The player falls in a young, high-performance distribution slice that did not clear its release gate, so the career forecast is withheld.',
    early_peak_interval_release_gate_failed:
      'The early-career peak-seven interval did not clear its release gate; this output remains research-only.',
    current_universe_rank_unavailable:
      'The live minor-league directory was unavailable, so a current-universe rank was not assigned.',
  }
  if (labels[warning]) return labels[warning]
  if (warning === 'single_scenario_jaws_tail_support_extension') {
    const extension = forecast.scenarioSupportExtensionJaws
    const absoluteExtension = Math.abs(extension ?? 0)
    const digits = absoluteExtension < 0.1 ? 3 : absoluteExtension < 1 ? 2 : 1
    const magnitude = extension === null
      ? 'an unquantified JAWS support extension'
      : `a ${extension > 0 ? '+' : ''}${extension.toFixed(digits)} JAWS support extension`
    return `One sparse simulated career tail required ${magnitude}. This is a modeling support adjustment, not observed player value.`
  }
  if (warning.startsWith('standard_fallback:')) {
    return `The HOF target uses a named fallback because no exact ${warning.split(':')[1] ?? 'role'} standard is available.`
  }
  const scoringEra = /^scoring_era_extrapolation_from_(\d{4})$/u.exec(warning)
  if (scoringEra) {
    return `The scoring fit was trained on completed careers ending by ${scoringEra[1]}; applying it to later feature states is an era extrapolation.`
  }
  if (warning.includes('development_holdout')) {
    return 'Evaluation uses a retrospective development holdout, not a prospective test or release claim.'
  }
  if (warning.includes('prospective_validation')) {
    return 'Prospective validation is not complete; release and superiority claims remain unavailable.'
  }
  const normalized = warning
    .trim()
    .replaceAll('_', ' ')
    .replace(/^./u, (letter) => letter.toLocaleUpperCase())
  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`
}

function ForecastDecomposition({ player, forecast }: { player: PlayerRecord; forecast: CareerForecast }) {
  const isMlb = isMlbStage(player.stage)
  const decomposition = forecast.decomposition
  const arrivalValue = decomposition.arrivalProbability ?? forecast.arrivalProbability36
  const arrivalLabel = decomposition.arrivalProbability !== null
    ? 'MLB within 60 months'
    : 'MLB within 36 months'

  return (
    <section className="forecast-decomposition" aria-labelledby="decomposition-title">
      <div className="section-heading-row">
        <div>
          <span className="eyebrow">PROBABILITY COMPONENTS</span>
          <h2 id="decomposition-title">How the probability is assembled</h2>
        </div>
        <Target size={18} aria-hidden="true" />
      </div>
      <div className="decomposition-grid">
        {isMlb ? (
          <>
            <div><span>Recorded career WAR</span><strong>{formatWar(forecast.cumulativeWar)}</strong></div>
            <div><span>Final WAR P50</span><strong>{formatWar(forecast.finalCareerWar?.p50 ?? null)}</strong></div>
            <div><span>Final WAR P90</span><strong>{formatWar(forecast.finalCareerWar?.p90 ?? null)}</strong></div>
          </>
        ) : (
          <>
            <div><span>{arrivalLabel}</span><strong>{formatProbability(arrivalValue)}</strong></div>
            <div><span>P(HOF caliber | MLB)</span><strong>{formatProbability(decomposition.hofCaliberGivenMlbProbability)}</strong></div>
            <div><span>No MLB within 60m</span><strong>{formatProbability(decomposition.noMlbProbability)}</strong></div>
          </>
        )}
      </div>
      <p className="decomposition-note">
        {isMlb
          ? 'Recorded MLB value is fixed. The terminal distribution starts from the last completed-season model state.'
          : 'The board uses a 60-month lower-bound proxy. Its complement is not an estimate of never reaching MLB.'}
      </p>
    </section>
  )
}

function CareerForecastPanel({ player, forecast }: { player: PlayerRecord; forecast: CareerForecast }) {
  const hofProbability = forecast.hofCaliberProbability
  const stageValue = isMlbStage(player.stage)
    ? formatWar(forecast.finalJaws?.p50 ?? null)
    : formatProbability(forecast.arrivalProbability36)
  const stageMetric = isMlbStage(player.stage) ? 'FINAL JAWS' : 'P(MLB WITHIN 36M)'
  const rankLabel = forecast.rank
    ? isMlbStage(player.stage)
      ? `#${forecast.rank} among current MLB`
      : `#${forecast.rank} among live minors`
    : forecast.hofCaliberProbability === null
      ? 'Rank withheld'
      : 'Rank unavailable'

  return (
    <>
      <div className="research-warning" role="note">
        <AlertTriangle size={18} aria-hidden="true" />
        <div>
          <strong>
            {forecast.releaseEligible ? 'Locked Career Oracle forecast' : 'Career Oracle research preview · not release eligible'}
          </strong>
          <span>
            Hall caliber is a statistical career standard, not a prediction of election. MLB and minor ranks use separate universes; confidence never changes rank.
          </span>
        </div>
      </div>

      <section className="forecast-metrics career-forecast-metrics" aria-label="Career forecast summary">
        <div className="metric-tile metric-tile--reach">
          {hofProbability === null ? (
            <div className="probability-withheld"><CircleDashed size={22} aria-hidden="true" /><span>Withheld</span></div>
          ) : (
            <ProbabilityRing value={hofProbability * 100} label="HOF CALIBER" />
          )}
          <div className="metric-detail">
            <span>{isMlbStage(player.stage) ? 'UNCONDITIONAL OUTCOME' : '60M LOWER-BOUND OUTCOME'}</span>
            <strong>{rankLabel}</strong>
            <small>{forecast.publicationState} · {forecast.lineage.targetVersion}</small>
          </div>
        </div>
        <div className="metric-tile">
          <span className="metric-label">FINAL CAREER WAR</span>
          <strong className="metric-number">{formatWar(forecast.finalCareerWar?.p50 ?? null)}</strong>
          <small>P10 {formatWar(forecast.finalCareerWar?.p10 ?? null)} · P90 {formatWar(forecast.finalCareerWar?.p90 ?? null)}</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">PEAK-SEVEN WAR</span>
          <strong className="metric-number">{formatWar(forecast.peakSevenWar?.p50 ?? null)}</strong>
          <small>P10 {formatWar(forecast.peakSevenWar?.p10 ?? null)} · P90 {formatWar(forecast.peakSevenWar?.p90 ?? null)}</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">{stageMetric}</span>
          <strong className="metric-number">{stageValue}</strong>
          <small>
            {isMlbStage(player.stage)
              ? `P90 ${formatWar(forecast.finalJaws?.p90 ?? null)} · standard ${formatWar(forecast.hofStandard?.jaws ?? null)}`
              : 'arrival component, not rank'}
          </small>
        </div>
      </section>

      <section className="confidence-strip" aria-label="Forecast confidence">
        <Gauge size={17} aria-hidden="true" />
        <div>
          <strong>{forecast.confidenceState} confidence</strong>
          <span>
            {forecast.confidenceScore === null ? 'Score withheld' : `${formatProbability(forecast.confidenceScore)} evidence confidence`}
            {forecast.intervalWidth === null ? '' : ` · ${forecast.intervalWidth.toFixed(1)} WAR P10–P90 width`}
          </span>
        </div>
        <p>Confidence describes evidence coverage and uncertainty. It is never multiplied into the ranking probability.</p>
      </section>

      <ForecastDecomposition player={player} forecast={forecast} />

      <section className="dossier-section career-section" aria-labelledby="career-title">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">RECORDED + TERMINAL DISTRIBUTION</span>
            <h2 id="career-title">Career value trajectory</h2>
          </div>
          <div className="chart-key" aria-hidden="true">
            <span><i className="key-range" />P10–P90</span>
            <span><i className="key-median" />P50</span>
            <span><i className="key-actual" />Recorded</span>
          </div>
        </div>
        {forecast.arc.length > 0 ? (
          <Suspense fallback={<div className="career-chart chart-loading">Loading forecast...</div>}>
            <CareerArcChart data={forecast.arc} currentAge={player.age} />
          </Suspense>
        ) : (
          <div className="chart-empty">
            <CircleDashed size={20} aria-hidden="true" />
            <span>Age-by-age career paths are not present in this research artifact.</span>
          </div>
        )}
      </section>

      <div className="dossier-columns forecast-detail-columns">
        <section className="dossier-section" aria-labelledby="standard-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">FROZEN TARGET</span>
              <h2 id="standard-title">Hall-caliber reference</h2>
            </div>
            <ShieldCheck size={18} aria-hidden="true" />
          </div>
          {forecast.hofStandard ? (
            <dl className="provenance-list standard-list">
              <div><dt>Standard</dt><dd>{forecast.hofStandard.label}</dd></div>
              <div><dt>Role / position</dt><dd>{forecast.hofStandard.roleOrPosition ?? 'Role fallback'}</dd></div>
              <div><dt>Career WAR</dt><dd>{formatWar(forecast.hofStandard.careerWar)}</dd></div>
              <div><dt>Peak-seven WAR</dt><dd>{formatWar(forecast.hofStandard.peakSevenWar)}</dd></div>
              <div><dt>JAWS</dt><dd>{formatWar(forecast.hofStandard.jaws)}</dd></div>
            </dl>
          ) : (
            <p className="section-empty">The target version is pinned, but its component reference values are not included in this preview.</p>
          )}
        </section>

        <section className="dossier-section warnings-section" aria-labelledby="warnings-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">LIMITS</span>
              <h2 id="warnings-title">Forecast warnings</h2>
            </div>
            <AlertTriangle size={18} aria-hidden="true" />
          </div>
          {forecast.warnings.length > 0 ? (
            <ul className="warning-list">
              {forecast.warnings.map((warning) => <li key={warning}>{warningLabel(warning, forecast)}</li>)}
            </ul>
          ) : (
            <p className="section-empty">No player-specific warning was included. The research-only publication state still applies.</p>
          )}
        </section>
      </div>

      {forecast.drivers.length > 0 ? (
        <section className="dossier-section evidence-section" aria-labelledby="evidence-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">MODEL EVIDENCE</span>
              <h2 id="evidence-title">What moves the forecast</h2>
            </div>
            <Activity size={18} aria-hidden="true" />
          </div>
          <div className="driver-list">
            {forecast.drivers.map((driver) => {
              const normalizedImpact = Math.min(100, Math.abs(driver.impact) <= 1
                ? Math.abs(driver.impact) * 100
                : Math.abs(driver.impact))
              return (
                <div className="driver-row" key={`${driver.label}:${driver.source ?? ''}`}>
                  <div className="driver-copy">
                    <strong>{driver.label}</strong>
                    <span>{driver.detail}{driver.source ? ` · ${driver.source}` : ''}</span>
                  </div>
                  <div className="driver-impact">
                    <strong className={driver.impact >= 0 ? 'positive' : 'negative'}>{driver.value}</strong>
                    <span className="impact-track">
                      <i
                        className={driver.impact >= 0 ? 'impact-positive' : 'impact-negative'}
                        style={{ width: `${normalizedImpact}%` }}
                      />
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}
    </>
  )
}

function ResearchArrivalPanel({ player }: { player: PlayerRecord }) {
  const estimate = player.researchEstimate
  if (!estimate) return null
  const horizon36 = estimate.horizons.find((horizon) => horizon.months === 36)

  return (
    <section className="research-forecast" aria-labelledby="research-arrival-title">
      <div className="research-warning" role="note">
        <AlertTriangle size={18} aria-hidden="true" />
        <div>
          <strong>Supporting arrival estimate · not a career rank</strong>
          <span>Model state frozen Dec. 31, 2025. The current 2026 source profile is displayed separately.</span>
        </div>
      </div>

      <div className="research-arrival-grid">
        <div className="research-arrival-summary">
          <span className="eyebrow">FROZEN ARRIVAL ESTIMATE</span>
          <h2 id="research-arrival-title">MLB arrival by horizon</h2>
          <ProbabilityRing value={(horizon36?.probability ?? 0) * 100} label="BY 36 MONTHS" />
          <dl>
            <div><dt>Candidate</dt><dd>{formatProbability(horizon36?.probability ?? null)}</dd></div>
            <div><dt>Age-level baseline</dt><dd>{formatProbability(horizon36?.baselineProbability ?? null)}</dd></div>
            <div><dt>Model cohort</dt><dd>{estimate.priorLevel}</dd></div>
            <div><dt>Support</dt><dd>{estimate.coldStart ? 'Cold start' : 'Prior history'}</dd></div>
          </dl>
        </div>
        <div>
          <div className="chart-key" aria-hidden="true">
            <span><i className="key-candidate" />Candidate</span>
            <span><i className="key-baseline" />Age-level baseline</span>
          </div>
          <Suspense fallback={<div className="arrival-chart chart-loading">Loading research curve...</div>}>
            <ArrivalHorizonChart horizons={estimate.horizons} />
          </Suspense>
          <p className="research-chart-note">The 60-month point is descriptive only; that external horizon is not mature.</p>
        </div>
      </div>
    </section>
  )
}

function formatRetrievedAt(value: string | null): string {
  if (!value) return 'Unavailable'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

export function PlayerDossier({
  player,
  saved,
  onToggleWatchlist,
  onReturnToBoard,
}: PlayerDossierProps) {
  const forecast = player.careerForecast
  const organization = player.organization ?? player.organizationCode ?? 'Organization unavailable'
  const externalIds = Object.entries(player.provenance.externalIds).filter(([, value]) => value !== null)
  const cohort = player.provenance.cohort

  return (
    <article id="player-dossier" className="player-dossier" aria-labelledby="player-name">
      <header className="dossier-header">
        <div className="dossier-identity">
          <span className={`player-avatar player-avatar--large player-avatar--${player.playerType.toLowerCase()}`}>
            {player.initials}
          </span>
          <div>
            <div className="identity-line">
              <span className="eyebrow">
                {forecast?.rank
                  ? isMlbStage(player.stage)
                    ? `#${forecast.rank} MLB ORACLE BOARD`
                    : `#${forecast.rank} MINORS RESEARCH RANK`
                  : forecast?.hofCaliberProbability != null
                    ? 'CURRENT RANK UNAVAILABLE'
                    : 'CAREER FORECAST WITHHELD'}
              </span>
              <span className="source-badge">
                {forecast?.publicationState ?? 'Observed only'}
              </span>
            </div>
            <h2 id="player-name">{player.name}</h2>
            <p>
              {organization} · {player.position ?? player.playerType} · Age {player.age ?? 'unknown'} · {player.level ?? stageLabel(player.stage)}
              {player.batsThrows ? ` · ${player.batsThrows}` : ''}
            </p>
          </div>
        </div>
        <div className="dossier-actions">
          <button
            className="icon-button dossier-back-button"
            type="button"
            onClick={onReturnToBoard}
            aria-label="Return to Oracle Board"
            title="Return to Oracle Board"
          >
            <List size={16} aria-hidden="true" />
          </button>
          <button
            className={`watch-button${saved ? ' is-saved' : ''}`}
            type="button"
            onClick={() => onToggleWatchlist(player.id)}
          >
            {saved ? <Check size={16} aria-hidden="true" /> : <Star size={16} aria-hidden="true" />}
            {saved ? 'Saved' : 'Watch'}
          </button>
        </div>
      </header>

      <p className="player-summary">
        {forecast?.summary ?? (forecast
          ? (isMlbStage(player.stage)
              ? `${player.name}'s research distribution combines recorded career evidence with an unconditional Hall-caliber outcome. It remains outside the release gate until prospective validation is complete.`
              : `${player.name}'s research distribution combines the frozen 60-month arrival endpoint with an MLB debut-age career bridge. It is a lower-bound proxy and remains outside the release gate.`)
          : `No validated Career Oracle outcome is available for this ${stageLabel(player.stage).toLocaleLowerCase()} record. Source evidence remains visible without substituting a composite provider score.`)}
      </p>

      {forecast ? (
        <CareerForecastPanel player={player} forecast={forecast} />
      ) : (
        <section className="model-pending" aria-labelledby="model-pending-title">
          <CircleDashed size={20} aria-hidden="true" />
          <div>
            <span className="eyebrow">UNCONDITIONAL CAREER OUTCOME</span>
            <h2 id="model-pending-title">Career forecast withheld</h2>
            <p>Hall-caliber probability, final WAR, peak value, and rank remain blank until a locked career artifact contains this player.</p>
          </div>
        </section>
      )}

      {player.stage === 'pre_debut' && player.researchEstimate ? (
        <ResearchArrivalPanel player={player} />
      ) : null}

      <section className="observed-metrics" aria-label="Observed player context">
        <div className="metric-tile">
          <span className="metric-label">CAREER STAGE</span>
          <strong className="metric-text">{stageLabel(player.stage)}</strong>
          <small>{player.level ?? 'level unavailable'}</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">AGE / ROLE</span>
          <strong className="metric-number">{player.age ?? '—'}</strong>
          <small>{player.playerType} · {player.position ?? 'position unavailable'}</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">{player.opportunity?.label.toUpperCase() ?? 'OPPORTUNITY'}</span>
          <strong className="metric-number">{player.opportunity?.value ?? '—'}</strong>
          <small>{player.provenance.season ?? 'Current'} observed season</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">EVIDENCE COVERAGE</span>
          <strong className="metric-text">{player.coverage.label}</strong>
          <small>{player.coverage.levelsObserved.join(', ') || player.level || 'context unavailable'}</small>
        </div>
      </section>

      <div className="dossier-columns dossier-columns--observed">
        <section className="dossier-section traits-section" aria-labelledby="traits-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">SUPPORTING EVIDENCE</span>
              <h2 id="traits-title">Observed player shape</h2>
            </div>
            <ShieldCheck size={18} aria-hidden="true" />
          </div>
          {player.metrics.length > 0 ? (
            <div className="metric-list">
              {player.metrics.map((metric) => (
                <div className="metric-row" key={metric.key}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <span
                    className={`percentile-track${metric.percentile === null ? ' is-unavailable' : ''}`}
                    aria-label={metric.percentile === null ? 'Percentile unavailable' : `${formatOrdinal(metric.percentile)} percentile`}
                  >
                    <i style={{ width: `${metric.percentile ?? 0}%` }} />
                  </span>
                  <small>{metric.percentile === null ? 'n/a' : formatOrdinal(metric.percentile)}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="section-empty">No source measurements were bundled with this player record.</p>
          )}
          <div className="tag-list" aria-label="Data coverage">
            {player.coverage.hasStatcast ? <span>Statcast metrics</span> : null}
            {player.coverage.hasTraditional ? <span>Traditional metrics</span> : null}
            {player.coverage.hasComplementaryRows ? <span>Merged source variants</span> : null}
            {player.coverage.levelsObserved.map((level) => <span key={level}>{level}</span>)}
          </div>
        </section>

        <section className="dossier-section provenance-section" aria-labelledby="provenance-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">LINEAGE</span>
              <h2 id="provenance-title">Profile provenance</h2>
            </div>
            <Database size={18} aria-hidden="true" />
          </div>
          <dl className="provenance-list">
            <div><dt>Source</dt><dd>{player.provenance.source}</dd></div>
            <div><dt>Dataset</dt><dd>{player.provenance.dataset}</dd></div>
            <div><dt>Season</dt><dd>{player.provenance.season ?? 'Unavailable'}</dd></div>
            <div><dt>Retrieved</dt><dd>{formatRetrievedAt(player.provenance.retrievedAt)}</dd></div>
            {cohort ? <div><dt>Cohort</dt><dd>Ages {cohort.minAge}–{cohort.maxAge} · Q{cohort.pitchQualifier}</dd></div> : null}
            <div><dt>Identity</dt><dd>{externalIds.length > 0 ? `${externalIds.length} source ID${externalIds.length === 1 ? '' : 's'}` : 'Canonical preview ID'}</dd></div>
          </dl>
          {player.coverage.organizationConflict ? (
            <p className="provenance-note"><Info size={14} aria-hidden="true" /> Organization differs across merged source variants.</p>
          ) : null}
        </section>
      </div>

      <footer className="dossier-footer">
        <span><CalendarClock size={14} aria-hidden="true" /> As of {formatRetrievedAt(forecast?.asOf ?? player.provenance.retrievedAt)}</span>
        <span><Layers3 size={14} aria-hidden="true" /> {stageLabel(player.stage)}</span>
        <span><Info size={14} aria-hidden="true" /> Research use only</span>
        <span className="footer-score">
          Rank basis: {isMlbStage(player.stage) ? 'current MLB P(HOF caliber)' : 'live-minors 60m lower-bound proxy'}
        </span>
      </footer>
    </article>
  )
}
