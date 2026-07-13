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
  Target,
  TrendingUp,
} from 'lucide-react'
import type { CareerForecast, PlayerRecord } from '../domain/forecast'
import {
  developmentChapterLabel,
  eligibleMilbCeilingAlpha,
  formatOrdinal,
  formatPercentagePointDelta,
  formatPercentileRank,
  formatProbability,
  formatSigned,
  formatTopRankPercent,
  formatWar,
  isMlbStage,
  stageLabel,
} from '../lib/forecast'
import { PlayerMapScorecard } from './PlayerMapScorecard'
import {
  bestCurrentScoutingGrade,
  currentMinorSlashLine,
} from './currentMinorView'
import { careerIndexFor, plainPlayerState, playerMapFor } from './playerMapView'
import {
  formatRookieWar,
  formatRookieWarPercentile,
  rookieMlbReadLabel,
  rookieEvidenceLabel,
  rookieEvidenceProgress,
} from './rookieTrackView'

const CareerArcChart = lazy(() =>
  import('./CareerArcChart').then((module) => ({ default: module.CareerArcChart })),
)

const MilbEvidenceProfile = lazy(() =>
  import('./MilbEvidenceProfile').then((module) => ({ default: module.MilbEvidenceProfile })),
)

interface PlayerDossierProps {
  player: PlayerRecord
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
      'The prospect forecast uses MLB arrival odds, role, and projected debut age; it is not yet trained directly from minor-league stats to Hall-level outcomes.',
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
    broad_role_switch_target_not_supported_forecast_withheld:
      'The forecast is withheld because a career spanning meaningful hitting and pitching roles cannot use a single-role Hall benchmark.',
    synthetic_hall_standard_forecast_withheld:
      'The forecast is withheld because no exact supported Hall benchmark maps to this player role.',
    bridge_debut_age_outside_supported_range_forecast_withheld:
      'The career forecast is withheld because projected MLB arrival falls outside the debut-age range learned by the bridge.',
    bridge_debut_age_cell_missing_forecast_withheld:
      'The career forecast is withheld because this role and projected debut age do not have a supported bridge estimate.',
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
            <div><span>Arrival model input</span><strong>Withheld</strong></div>
            <div><span>P(HOF caliber | MLB)</span><strong>{formatProbability(decomposition.hofCaliberGivenMlbProbability)}</strong></div>
            <div><span>Composition state</span><strong>Research</strong></div>
          </>
        )}
      </div>
      <p className="decomposition-note">
        {isMlb
          ? 'Recorded MLB value is fixed. The terminal distribution starts from the last completed-season model state.'
          : 'The career bridge uses a frozen arrival component internally. Exact arrival probabilities are withheld because the external calibration gate failed.'}
      </p>
    </section>
  )
}

function chapterWarningLabel(warning: string): string {
  const labels: Record<string, string> = {
    research_only: 'The career chapter and near-term impact probability are research outputs.',
    completed_seasons_only: 'The chapter uses completed-season evidence only.',
    exceptional_trajectory_not_hall_probability:
      'The three-year impact probability is a near-term event estimate, not Hall-caliber probability.',
    partial_season_excluded: 'The current partial season does not change the chapter evidence state.',
  }
  if (labels[warning]) return labels[warning]
  const normalized = warning.trim().replaceAll('_', ' ').replace(/^./u, (letter) => letter.toUpperCase())
  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`
}

function alphaWarningLabel(warning: string): string {
  const labels: Record<string, string> = {
    research_only: 'Alpha Signal is a research output.',
    alpha_edge_is_not_expected_investment_return:
      'Model edge is not expected investment return; market price is not part of this signal.',
    current_scoring_refit_not_prospectively_validated:
      'The current-player scoring refit has not been prospectively validated.',
    p90_ceiling_is_tail_scenario_not_most_likely_outcome:
      'The P90 ceiling is a high-end scenario, not the most likely outcome.',
    historical_baseline_is_descriptive_not_causal:
      'The historical baseline is descriptive, not causal.',
    market_price_not_modeled:
      'Market price, liquidity, transaction costs, and external consensus are not modeled.',
    partial_season_feature_not_eligible_for_alpha:
      'Partial-season evidence is not eligible for Alpha Signal.',
    historical_hall_baseline_insufficient_support:
      'The historical Hall-caliber baseline lacks sufficient support.',
  }
  if (labels[warning]) return labels[warning]
  const normalized = warning.trim().replaceAll('_', ' ').replace(/^./u, (letter) => letter.toUpperCase())
  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`
}

function milbAlphaWarningLabel(warning: string): string {
  const labels: Record<string, string> = {
    research_only: 'MiLB Alpha Radar is a research-only ranking.',
    external_validation_failed_no_horizon_validated:
      'No arrival horizon passed every external release gate; probability calibration failed.',
    frozen_2025_features_not_current_2026:
      'The arrival signal is frozen at Dec. 31, 2025 and does not use the displayed 2026 statistics.',
    arrival_target_not_hall_ceiling:
      'This signal targets MLB arrival within 36 months, not Hall-caliber career value.',
    market_price_not_modeled:
      'Market price, liquidity, and external consensus are not modeled.',
    probability_interval_not_available:
      'A player-level probability interval is not yet available.',
    descriptive_drivers_not_model_attribution:
      'Historical driver percentiles describe context; they are not model attribution.',
    arrival_cold_start: 'The frozen arrival estimate is a cold-start prediction.',
  }
  if (labels[warning]) return labels[warning]
  const normalized = warning.trim().replaceAll('_', ' ').replace(/^./u, (letter) => letter.toUpperCase())
  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`
}

function MilbAlphaRadarPanel({ player }: { player: PlayerRecord }) {
  if (player.stage !== 'pre_debut') return null
  const signal = player.milbAlphaSignal
  const impact = player.milbImpactRanking
  const ceilingAlpha = eligibleMilbCeilingAlpha(player)
  const traits = player.minorTraitEvidence
  const impactWorkloadSupported = signal?.gates?.minimumRawWorkload !== false
  const strongestTraits = traits?.strongestMetrics.filter(
    (metric) => metric.percentile >= (traits.corroboration.strongPercentileThreshold ?? 80),
  ) ?? []
  const tierLabel = !impactWorkloadSupported
    ? 'Five-year rank withheld: thin sample'
    : ceilingAlpha
    ? `${ceilingAlpha.tier === 'priority' ? 'Priority' : ceilingAlpha.tier === 'strong' ? 'Strong' : 'Watch'} research signal`
    : impact
      ? 'Two-model gate not cleared'
      : 'Impact rank unavailable'
  const statusTier = ceilingAlpha?.tier ?? 'withheld'

  return (
    <section
      className={`alpha-radar alpha-radar--${statusTier}`}
      aria-labelledby="milb-alpha-radar-title"
    >
      <div className="section-heading-row alpha-radar-heading">
        <div>
          <span className="eyebrow">ARRIVAL CONFIRMATION + FIVE-YEAR IMPACT RANK</span>
          <h2 id="milb-alpha-radar-title">Five-Year Impact Radar</h2>
        </div>
        <div className="alpha-radar-status">
          <span className={`alpha-tier alpha-tier--${statusTier}`}>{tierLabel}</span>
          {impact ? <strong>{impactWorkloadSupported ? `#${impact.rank}` : `Raw #${impact.rank}, not admitted`} of {impact.universeRows.toLocaleString()}</strong> : null}
        </div>
      </div>

      {impact ? (
        <>
          <div className="alpha-thesis milb-alpha-thesis">
            <div className="alpha-thesis-edge">
              <span>{impactWorkloadSupported ? 'FIVE-YEAR IMPACT RANK' : 'RAW FIVE-YEAR RANK'}</span>
              <strong>{impactWorkloadSupported ? `#${impact.rank}` : 'Not admitted'}</strong>
              <small>{impactWorkloadSupported
                ? `${formatTopRankPercent(impact.rank, impact.universeRows)} of ${impact.universeRows.toLocaleString()} scoreable completed-2025 MiLB snapshots`
                : `Raw rank #${impact.rank}; the completed-2025 workload gate failed`}</small>
            </div>
            <div>
              <span>ARRIVAL CONFIRMATION</span>
              <strong>{signal?.rank ? `#${signal.rank}` : '—'}</strong>
              <small>{signal?.eligible ? 'Separate young-for-level model gate cleared' : 'Separate arrival gate not cleared'}</small>
            </div>
            <div>
              <span>AGE ADVANTAGE</span>
              <strong>{signal?.ageContext?.youngerThanPercent.toFixed(0) ?? '—'}%</strong>
              <small>Younger than historical {signal?.ageContext?.role ?? player.playerType.toLowerCase()}s at {signal?.ageContext?.priorLevel ?? player.level ?? 'this level'}</small>
            </div>
            <div>
              <span>2026 RAW-TRAIT CHECK</span>
              <strong>{traits ? `${traits.corroboration.strongPillarCount}/${traits.corroboration.requiredStrongPillars}` : '—'}</strong>
              <small>{traits?.corroboration.passesAllDescriptiveGates ? 'Multi-pillar corroboration' : 'Descriptive gate not cleared'}</small>
            </div>
          </div>

          <div className="alpha-explanation">
            <strong>Why it surfaced</strong>
            <span>
              {ceilingAlpha
                ? `The direct impact challenger ranks this player #${impact.rank} on the path to at least 5 MLB WAR from 2026–2030, and the separate young-for-level arrival signal also cleared. No probabilities were blended.`
                : !impactWorkloadSupported
                  ? `The raw direct-impact rank is #${impact.rank}, but it is withheld because the completed-season input did not meet the minimum workload. Tiny samples cannot qualify as model evidence.`
                  : `The direct impact challenger ranks this player #${impact.rank}, but the research signal is withheld until both the impact top-decile and young-for-level arrival gates clear.`}
            </span>
          </div>

          <div className="alpha-reference">
            <span>
              Target: at least 5 total MLB WAR in 2026–2030 · unconditional on MLB arrival
            </span>
            <small>{impact.oofRankEvidence.topDecileLift.toFixed(2)}x model-wide top-decile lift · {impact.oofRankEvidence.rows.toLocaleString()} player-purged OOF rows · raw probability withheld</small>
          </div>

          <div className="alpha-gates" aria-label="MiLB ceiling research and release gates">
            {([
              ['Impact top decile', impact.rankPercentile >= 90],
              ['Stable model sample', impactWorkloadSupported],
              ['Arrival signal cleared', signal?.eligible === true],
              ['Young for level', signal?.gates.youngForRoleAndLevel === true],
              ['Historical support', signal?.gates.supportedHistoricalContext === true],
              ['Tail calibrated', impact.gates.tailCalibrationPassed],
              ['Prospective validation', impact.gates.prospectiveValidationPassed],
            ] as const).map(([label, passed]) => (
              <span key={label} className={passed ? 'is-pass' : 'is-fail'}>
                {passed ? <Check size={11} aria-hidden="true" /> : <AlertTriangle size={11} aria-hidden="true" />}
                {label}
              </span>
            ))}
          </div>

          <Suspense fallback={<div className="evidence-profile evidence-profile-loading">Loading evidence profile</div>}>
            <MilbEvidenceProfile player={player} />
          </Suspense>
        </>
      ) : (
        <div className="alpha-withheld-state">
          <strong>Five-year impact rank unavailable</strong>
          <span>
            No exact MLBAM-and-role match exists in the locked completed-2025 impact universe. Source evidence remains visible without substituting an external composite score.
          </span>
        </div>
      )}

      {traits && strongestTraits.length > 0 ? (
        <div className="milb-trait-chips" aria-label="Strongest current raw-trait evidence">
          {strongestTraits.map((metric) => (
            <span key={metric.key}>
              <strong>{metric.label}</strong>
              {formatOrdinal(metric.percentile)} · {metric.value ?? 'value unavailable'}
            </span>
          ))}
        </div>
      ) : null}

      <p className="alpha-market-disclosure">
        <strong>Ordinal research rank only.</strong> The raw impact probability is intentionally withheld because the extreme tail overpredicted. This is not calibrated confidence, Hall probability, or market return; current raw traits remain descriptive corroboration only.
      </p>

      {(impact?.warnings ?? signal?.warnings)?.length ? (
        <ul className="alpha-radar-warnings">
          {(impact?.warnings ?? signal?.warnings ?? []).map((warning) => (
            <li key={warning}>{milbAlphaWarningLabel(warning)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function AlphaRadarPanel({ player, forecast }: { player: PlayerRecord; forecast: CareerForecast }) {
  const mlbStage = isMlbStage(player.stage)
  const signal = forecast.alphaSignal
  const researchSignal = signal?.status === 'research' ? signal : null
  const baseline = researchSignal?.baseline ?? null
  const edge = researchSignal?.edge ?? null
  const ceiling = researchSignal?.ceiling ?? null
  const runway = researchSignal?.runway ?? null
  const impact = researchSignal?.nearTermImpact ?? null
  const tierLabel = researchSignal?.eligible
    ? researchSignal.tier === 'priority' ? 'Priority model alpha' : 'Watch model alpha'
    : researchSignal ? 'No alpha trigger' : 'Alpha withheld'
  const experienceLabel = baseline?.experienceBand
    .replace('seasons_', 'MLB seasons ')
    .replace('season_', 'MLB season ')
    .replace('_plus', '+')
    .replace('_', '–')
    .replace('first', 'first MLB season') ?? 'supported experience'

  if (!mlbStage) {
    return null
  }

  return (
    <section className={`alpha-radar alpha-radar--${researchSignal?.tier ?? 'withheld'}`} aria-labelledby="alpha-radar-title">
      <div className="section-heading-row alpha-radar-heading">
        <div>
          <span className="eyebrow">EARLY-CAREER CEILING ANOMALY</span>
          <h2 id="alpha-radar-title">Alpha Radar</h2>
        </div>
        <div className="alpha-radar-status">
          <span className={`alpha-tier alpha-tier--${researchSignal?.tier ?? 'withheld'}`}>{tierLabel}</span>
          {researchSignal?.rank ? <strong>#{researchSignal.rank} eligible MLB</strong> : null}
        </div>
      </div>

      {researchSignal && baseline && edge && ceiling && runway ? (
        <>
          <div className="alpha-thesis">
            <div className="alpha-thesis-edge">
              <span>MODEL EDGE</span>
              <strong>{formatPercentagePointDelta(edge.probabilityDelta)}</strong>
              <small>
                {formatProbability(researchSignal.modeledProbability)} modeled vs {formatProbability(baseline.probability)} historical
                {edge.liftMultiple === null ? '' : ` · ${edge.liftMultiple.toFixed(1)}× lift`}
              </small>
            </div>
            <div>
              <span>ABSOLUTE CEILING</span>
              <strong>{formatSigned(ceiling.p90JawsMargin, ' JAWS')}</strong>
              <small>P90 margin to the career-to-date Hall standard · {ceiling.gatePassed ? 'gate cleared' : 'gate missed'}</small>
            </div>
            <div>
              <span>RUNWAY TO PRIME</span>
              <strong>{runway.yearsToPrime.toFixed(1)} years</strong>
              <small>Age {runway.age.toFixed(1)} vs learned {baseline.roleTrack} prime at {runway.learnedTrackPrimeStartAge.toFixed(1)}</small>
            </div>
            <div>
              <span>3Y IMPACT CONFIRMATION</span>
              <strong>{formatProbability(impact?.probability ?? null)}</strong>
              <small>{impact ? `${impact.liftMultiple?.toFixed(1) ?? '—'}× the ${formatProbability(impact.referenceBaseRate)} reference rate` : 'Near-term confirmation unavailable'}</small>
            </div>
          </div>

          <div className="alpha-explanation">
            <strong>{researchSignal.eligible ? 'Why it surfaced' : 'Why it did not trigger'}</strong>
            <span>
              {researchSignal.eligible
                ? `The model is ${formatPercentagePointDelta(edge.probabilityDelta)} above a broad, prior-only historical Hall-caliber baseline while its P90 JAWS ceiling clears the absolute standard with ${runway.yearsToPrime.toFixed(1)} pre-prime years remaining.`
                : `This completed-season forecast did not clear every Alpha gate. Positive relative edge alone is insufficient without early-career status, pre-prime runway, and an absolute P90 ceiling above the Hall-caliber standard.`}
            </span>
          </div>

          <div className="alpha-reference">
            <span>
              Baseline: post-{baseline.minimumSeason} {baseline.roleTrack} · {experienceLabel} · ages {baseline.ageMin}–{baseline.ageMax}
            </span>
            <small>{baseline.players.toLocaleString()} resolved players · {baseline.landmarks.toLocaleString()} prior-season landmarks · player-equal weighted</small>
          </div>
          <div className="alpha-gates" aria-label="Alpha eligibility gates">
            {([
              ['Completed evidence', researchSignal.gates.completedEvidence],
              ['Supported baseline', researchSignal.gates.supportedBaseline],
              ['Early career', researchSignal.gates.earlyCareer],
              ['Pre-prime runway', researchSignal.gates.prePrimeRunway],
              ['Absolute ceiling', researchSignal.gates.absoluteCeiling],
            ] as const).map(([label, passed]) => (
              <span key={label} className={passed ? 'is-pass' : 'is-fail'}>
                {passed ? <Check size={11} aria-hidden="true" /> : <AlertTriangle size={11} aria-hidden="true" />}
                {label}
              </span>
            ))}
          </div>
          <p className="alpha-market-disclosure">
            <strong>Market price not modeled.</strong> This is model alpha against a historical baseball baseline, not evidence of market mispricing or expected return.
          </p>
        </>
      ) : (
        <div className="alpha-withheld-state">
          <strong>Alpha Signal is withheld</strong>
          <span>The required completed-season forecast, broad historical baseline, ceiling tail, or learned runway boundary is unavailable.</span>
        </div>
      )}

      {signal && signal.warnings.length > 0 ? (
        <ul className="alpha-radar-warnings">
          {signal.warnings.map((warning) => <li key={warning}>{alphaWarningLabel(warning)}</li>)}
        </ul>
      ) : null}
    </section>
  )
}

function CareerChapterPanel({ player, forecast }: { player: PlayerRecord; forecast: CareerForecast }) {
  const mlbStage = isMlbStage(player.stage)
  const chapter = forecast.careerChapter
  const researchChapter = chapter?.status === 'research' ? chapter : null
  const pace = forecast.relativeSignal?.historicalPace ?? null
  const exceptional = researchChapter?.exceptionalTrajectory ?? null
  const chapterLabel = mlbStage
    ? researchChapter?.label ?? (chapter ? 'Chapter withheld' : 'Chapter unavailable')
    : developmentChapterLabel(player.level)
  const nearTermProbability = mlbStage
    ? exceptional?.probability ?? null
    : null
  const minorArrivalRank = player.milbAlphaSignal?.rank ?? null

  return (
    <section className="career-chapter" aria-labelledby="career-chapter-title">
      <div className="section-heading-row">
        <div>
          <span className="eyebrow">COMPLETED-SEASON LIFECYCLE</span>
          <h2 id="career-chapter-title">Career chapter</h2>
        </div>
        <TrendingUp size={18} aria-hidden="true" />
      </div>

      <div className="career-chapter-grid">
        <div className="career-chapter-lead">
          <span>LIFECYCLE</span>
          <strong>{chapterLabel}</strong>
          <small>
            {researchChapter
              ? `${researchChapter.trajectoryState} · ${researchChapter.roleTrack} track`
              : mlbStage ? 'Completed-season chapter not published' : `${player.level ?? 'Minor leagues'} · development context`}
          </small>
        </div>
        <div>
          <span>{mlbStage ? 'P(3Y IMPACT)' : 'ARRIVAL RANK'}</span>
          <strong>{mlbStage ? formatProbability(nearTermProbability) : minorArrivalRank ? `#${minorArrivalRank}` : '—'}</strong>
          <small>
            {mlbStage && exceptional
              ? `At least ${formatWar(exceptional.thresholdWar)} WAR · ${formatProbability(exceptional.referenceBaseRate)} reference rate`
              : mlbStage ? 'Near-term estimate unavailable' : 'Research arrival rank · exact probability unavailable'}
          </small>
        </div>
        <div>
          <span>HISTORICAL WAR PACE</span>
          <strong>{pace ? formatPercentileRank(pace.percentile) : '—'}</strong>
          <small>
            {pace
              ? `${formatWar(pace.playerValue)} WAR through age ${pace.featureAge} · ${pace.cohortSize.toLocaleString()} landmarks`
              : 'Completed-season comparison unavailable'}
          </small>
        </div>
        <div>
          <span>LEARNED NEXT-WAR PATH</span>
          <strong>{researchChapter ? formatSigned(researchChapter.support.expectedNextWarChange, ' WAR') : '—'}</strong>
          <small>
            {researchChapter
              ? `${formatProbability(researchChapter.support.continuationRate)} continuation · ${researchChapter.support.referencePlayers.toLocaleString()} players`
              : 'Available after a supported MLB chapter'}
          </small>
        </div>
      </div>

      <div className="chapter-evidence">
        <strong>Evidence state</strong>
        <span>
          {researchChapter
            ? `Through ${researchChapter.featureSeason} · age ${researchChapter.evidence.age} · MLB season ${researchChapter.evidence.mlbSeasonNumber} · ${formatWar(researchChapter.evidence.seasonWar)} season WAR`
            : mlbStage ? 'Completed-season chapter evidence withheld' : `${player.level ?? 'Current minor-league level'} · arrival model context`}
        </span>
        {researchChapter ? <small>{researchChapter.support.referenceLandmarks.toLocaleString()} reference landmarks</small> : null}
      </div>

      <p className="career-chapter-note">
        {mlbStage
          ? 'Career chapter and three-year impact are learned research outputs from completed seasons. P(3Y impact) is not a Hall-caliber probability and does not change the absolute career outcome above.'
          : 'Minor-league development context uses the separate 36-month MLB arrival estimate. An MLB career chapter begins only after supported completed-season major-league evidence.'}
      </p>
      {chapter && chapter.warnings.length > 0 ? (
        <ul className="career-chapter-warnings">
          {chapter.warnings.map((warning) => <li key={warning}>{chapterWarningLabel(warning)}</li>)}
        </ul>
      ) : null}
    </section>
  )
}

function ProspectCareerOutlookPanel({
  player,
  forecast,
}: {
  player: PlayerRecord
  forecast: CareerForecast
}) {
  const debutAge = forecast.decomposition.estimatedDebutAge
  const conditionalCareer = forecast.finalCareerWarConditionalOnArrival ?? null

  return (
    <section className="dossier-section prospect-career-outlook" aria-labelledby="prospect-career-title">
      <div className="section-heading-row">
        <div>
          <span className="eyebrow">ARRIVAL AGE + CAREER WINDOW</span>
          <h2 id="prospect-career-title">Prospect career projection</h2>
        </div>
      </div>
      <p className="career-chapter-note">
        Arrival and career ceiling are separate. The career outlook below describes {player.name}&apos;s modeled career if he reaches MLB; a later arrival leaves fewer prime seasons to build value.
      </p>
      <div className="forecast-metrics career-forecast-metrics" aria-label="Prospect career outlook summary">
        <div className="metric-tile">
          <span className="metric-label">PROJECTED MLB ARRIVAL</span>
          <strong className="metric-number">{debutAge === null ? '—' : `Age ${debutAge}`}</strong>
          <small>Age at arrival is an explicit career-ceiling input</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">IF MLB: MIDDLE CAREER WAR</span>
          <strong className="metric-number">{formatWar(conditionalCareer?.p50 ?? null)}</strong>
          <small>Conditional on reaching the major leagues</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">HIGH CAREER CASE</span>
          <strong className="metric-number">{formatWar(conditionalCareer?.p90 ?? null)}</strong>
          <small>90th-percentile career WAR if MLB is reached</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">MLB WITHIN 3 YEARS</span>
          <strong className="metric-number">{formatProbability(forecast.arrivalProbability36)}</strong>
          <small>Separate from the conditional career ceiling</small>
        </div>
      </div>
      <div className="research-warning" role="note">
        <AlertTriangle size={18} aria-hidden="true" />
        <div>
          <strong>Research bridge, not a finished career simulation</strong>
          <span>The model connects projected debut age to historical MLB career outcomes. Current minor-league evidence and scouting are shown separately until an in-season update model clears out-of-time testing.</span>
        </div>
      </div>
    </section>
  )
}

function CurrentMinorEvidencePanel({ player }: { player: PlayerRecord }) {
  const stats = player.currentMinorStats ?? null
  const scouting = player.currentProspectScouting ?? null
  if (!stats && !scouting) return null

  const bestGrade = bestCurrentScoutingGrade(player)
  const slashLine = currentMinorSlashLine(player)
  const scoutingRank = scouting?.organizationRank !== null && scouting?.organizationRank !== undefined
    ? `#${scouting.organizationRank}`
    : scouting?.overallRank !== null && scouting?.overallRank !== undefined
      ? `#${scouting.overallRank} overall`
      : '--'
  const pitchingLine = stats?.pitching
    ? `${stats.pitching.era?.toFixed(2) ?? '--'} ERA · ${stats.pitching.whip?.toFixed(2) ?? '--'} WHIP`
    : null

  return (
    <section className="dossier-section current-minor-evidence" aria-labelledby="current-minor-evidence-title">
      <div className="section-heading-row">
        <div>
          <span className="eyebrow">LIVE PROSPECT EVIDENCE</span>
          <h2 id="current-minor-evidence-title">Current season and scouting</h2>
        </div>
        <TrendingUp size={18} aria-hidden="true" />
      </div>
      <div className="forecast-metrics current-minor-evidence-grid">
        {scouting ? (
          <div className="metric-tile">
            <span className="metric-label">FANGRAPHS ORGANIZATION RANK</span>
            <strong className="metric-number">{scoutingRank}</strong>
            <small>{scouting.futureValue ? `${scouting.futureValue} future-value grade` : 'Current scouting report'}{scouting.eta ? ` · ETA ${scouting.eta}` : ''}</small>
          </div>
        ) : null}
        {bestGrade ? (
          <div className="metric-tile">
            <span className="metric-label">BEST SCOUTING GRADE</span>
            <strong className="metric-number">{bestGrade.value}</strong>
            <small>{bestGrade.label}</small>
          </div>
        ) : null}
        {stats ? (
          <div className="metric-tile">
            <span className="metric-label">OFFICIAL {stats.season} WORKLOAD</span>
            <strong className="metric-number">{stats.opportunity.value} {stats.opportunity.label}</strong>
            <small>{stats.levelsObserved.join(', ') || stats.currentLevel || stats.highestObservedLevel || 'Minor leagues'}</small>
          </div>
        ) : null}
        {stats && (slashLine || pitchingLine) ? (
          <div className="metric-tile">
            <span className="metric-label">OFFICIAL PERFORMANCE</span>
            <strong className="metric-text">{slashLine ?? pitchingLine}</strong>
            <small>
              {stats.hitting
                ? `${stats.hitting.walks ?? '--'} BB · ${stats.hitting.strikeouts ?? '--'} K · ${stats.hitting.stolenBases ?? '--'} SB`
                : `${stats.pitching?.strikeouts ?? '--'} K · ${stats.pitching?.walksAllowed ?? '--'} BB`}
            </small>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function RookieTrackPanel({ player }: { player: PlayerRecord }) {
  const transition = player.recentCallup
  if (!transition) return null
  const prior = transition.prospectPrior?.forecast.publicationState === 'withheld'
    ? null
    : transition.prospectPrior
  const priorForecast = prior?.forecast ?? null
  const opportunity = transition.currentMlbEvidence.opportunity
  const progress = rookieEvidenceProgress(player)

  return (
    <section className="dossier-section rookie-track-panel" aria-labelledby="rookie-track-title">
      <div className="section-heading-row">
        <div>
          <span className="eyebrow">PROSPECT TRAJECTORY + MLB EVIDENCE</span>
          <h2 id="rookie-track-title">Rookie Track</h2>
        </div>
        <span className="rookie-track-status">{rookieMlbReadLabel(player)}</span>
      </div>
      <p className="career-chapter-note">
        {prior
          ? `${player.name}'s frozen prospect Career Index stays in place while major-league evidence accumulates. The MLB read is shown separately, so a small debut sample cannot erase or silently rewrite the prior.`
          : `${player.name} remains visible in Rookie Track while the exact pre-debut forecast match is completed. Current MLB evidence is still tracked without manufacturing a replacement index.`}
      </p>
      <div className="forecast-metrics rookie-track-metrics" aria-label="Rookie Track summary">
        <div className="metric-tile metric-tile--reach">
          <span className="metric-label">PROSPECT PRIOR</span>
          <strong className="metric-number">{prior ? `#${prior.rank.toLocaleString()}` : '—'}</strong>
          <small>{prior ? `of ${prior.universe.toLocaleString()} frozen prospect forecasts` : 'Exact frozen forecast not matched'}</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">PROSPECT HIGH CASE</span>
          <strong className="metric-number">{formatWar(priorForecast?.finalCareerWarConditionalOnArrival?.p90 ?? null)}</strong>
          <small>{prior ? '90th-percentile career WAR, conditional on the now-confirmed MLB arrival' : 'Available after the prospect identity match is resolved'}</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">EARLY MLB READ</span>
          <strong className="metric-text">{rookieMlbReadLabel(player)}</strong>
          <small>{formatRookieWar(player)} · {formatRookieWarPercentile(player)} current-role WAR</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">EVIDENCE DEPTH</span>
          <strong className="metric-text">{rookieEvidenceLabel(player)}</strong>
          <small>{opportunity ? `${opportunity.value} ${opportunity.label}` : 'Opportunity data pending'}</small>
        </div>
      </div>
      <div className="rookie-evidence-meter" aria-label="MLB evidence progress">
        <span>
          <strong>{rookieEvidenceLabel(player)}</strong>
          <small>{progress === null ? 'Sample progress unavailable' : `${progress}% of the substantial-sample marker`}</small>
        </span>
        <div role="img" aria-label={progress === null ? 'MLB sample progress unavailable' : `MLB sample progress ${progress}%`}>
          {progress === null ? null : <i style={{ width: `${progress}%` }} />}
        </div>
      </div>
      <div className="research-warning" role="note">
        <AlertTriangle size={18} aria-hidden="true" />
        <div>
          <strong>{prior ? 'Evidence update, not a re-score' : 'Prospect prior not matched'}</strong>
          <span>{prior
            ? 'The Career Index and stage standing remain frozen from the prospect forecast. Current MLB production is a neutral evidence read until an exposure- and prior-aware transition model beats that prior in out-of-time testing.'
            : 'Rookie Track keeps the player discoverable, but the Career Index stays unavailable until an exact frozen prospect identity match is established.'}</span>
        </div>
      </div>
    </section>
  )
}

function SpecialHandlingPanel({ player, forecast }: { player: PlayerRecord; forecast: CareerForecast }) {
  const handling = playerMapFor(player).handling
  const primary = handling?.primary
  if (!primary) return null
  const mlbStage = isMlbStage(player.stage)
  const currentWar = player.metrics.find((metric) => metric.key === 'current-season-war')?.value ?? 'Not available'

  return (
    <section className="special-handling-panel" aria-labelledby="special-handling-title">
      <div className="special-handling-heading">
        <AlertTriangle size={19} aria-hidden="true" />
        <div>
          <span className="eyebrow">SPECIAL HANDLING</span>
          <h2 id="special-handling-title">{primary.label}</h2>
          <p>{primary.summary} {primary.handling}</p>
        </div>
      </div>
      <div className="special-handling-evidence" aria-label="Observed evidence retained while forecast is withheld">
        <div>
          <span>{mlbStage ? 'RECORDED CAREER WAR' : '36-MONTH MLB ARRIVAL'}</span>
          <strong>{mlbStage
            ? formatWar(forecast.cumulativeWar)
            : formatProbability(forecast.arrivalProbability36)}</strong>
          <small>{mlbStage ? 'Observed value, not a projection' : 'Arrival model only; career ceiling withheld'}</small>
        </div>
        <div>
          <span>{mlbStage ? 'CURRENT-SEASON WAR' : 'PROJECTED ARRIVAL AGE'}</span>
          <strong>{mlbStage ? currentWar : forecast.decomposition.estimatedDebutAge ?? 'Not available'}</strong>
          <small>{player.opportunity
            ? `${player.opportunity.value} ${player.opportunity.label}`
            : mlbStage ? 'Current workload unavailable' : 'Current minor-league workload unavailable'}</small>
        </div>
        <div>
          <span>CAREER INDEX</span>
          <strong>Withheld</strong>
          <small>Excluded from score-based ranking</small>
        </div>
      </div>
      {handling.notes.length > 1 ? (
        <ul className="special-handling-notes">
          {handling.notes.slice(1).map((note) => <li key={note.code}><strong>{note.label}:</strong> {note.handling}</li>)}
        </ul>
      ) : null}
    </section>
  )
}

function CareerForecastPanel({ player, forecast }: { player: PlayerRecord; forecast: CareerForecast }) {
  const stageValue = isMlbStage(player.stage)
    ? formatWar(forecast.finalJaws?.p50 ?? null)
    : player.milbImpactRanking?.rank ? `#${player.milbImpactRanking.rank}` : '—'
  const stageMetric = isMlbStage(player.stage)
    ? 'HALL BENCHMARK PROGRESS'
    : 'FIVE-YEAR IMPACT RANK'

  return (
    <>
      <div className="research-warning" role="note">
        <AlertTriangle size={18} aria-hidden="true" />
        <div>
          <strong>
            {forecast.releaseEligible ? 'Tested career forecast' : 'Research career estimate'}
          </strong>
          <span>
            Career Index is the primary career-magnitude reading. Stage standing and evidence remain separate, and the forecast is not a Hall of Fame election prediction.
          </span>
        </div>
      </div>

      <section className="forecast-metrics career-forecast-metrics" aria-label="Career forecast summary">
        <div className="metric-tile">
          <span className="metric-label">CAREER WAR RECORDED</span>
          <strong className="metric-number">{formatWar(forecast.cumulativeWar)}</strong>
          <small>Observed major-league value through the latest completed season</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">FINAL CAREER WAR</span>
          <strong className="metric-number">{formatWar(forecast.finalCareerWar?.p50 ?? null)}</strong>
          <small>Model range {formatWar(forecast.finalCareerWar?.p10 ?? null)} to {formatWar(forecast.finalCareerWar?.p90 ?? null)}</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">BEST 7 SEASONS</span>
          <strong className="metric-number">{formatWar(forecast.peakSevenWar?.p50 ?? null)}</strong>
          <small>Model range {formatWar(forecast.peakSevenWar?.p10 ?? null)} to {formatWar(forecast.peakSevenWar?.p90 ?? null)}</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">{stageMetric}</span>
          <strong className="metric-number">{stageValue}</strong>
          <small>
            {isMlbStage(player.stage)
              ? `High case ${formatWar(forecast.finalJaws?.p90 ?? null)} · Hall benchmark ${formatWar(forecast.hofStandard?.jaws ?? null)} on the combined career measure`
              : 'Ranks projected MLB impact through 2030; no Hall probability is shown'}
          </small>
        </div>
      </section>

      <section className="confidence-strip" aria-label="Forecast confidence">
        <Gauge size={17} aria-hidden="true" />
        <div>
          <strong>{forecast.confidenceState} evidence quality</strong>
          <span>
            {forecast.intervalWidth === null
              ? 'Based on available completed-season history'
              : `${forecast.intervalWidth.toFixed(1)} WAR between low and high cases`}
          </span>
        </div>
        <p>This describes how much evidence supports the estimate. It does not change the player’s rank.</p>
      </section>

      <section className="dossier-section career-section" aria-labelledby="career-title">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">CAREER HISTORY + PROJECTION</span>
            <h2 id="career-title">Projected career arc</h2>
          </div>
          <div className="chart-key" aria-hidden="true">
            <span><i className="key-terminal-range" />Wide range</span>
            <span><i className="key-terminal-mid" />Middle range</span>
            <span><i className="key-terminal-median" />Midpoint</span>
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
            <span>An age-by-age career path is not available for this player yet.</span>
          </div>
        )}
      </section>

      <details className="advanced-model-details">
        <summary>Advanced forecast details</summary>
        <AlphaRadarPanel player={player} forecast={forecast} />
        <CareerChapterPanel player={player} forecast={forecast} />
        <ForecastDecomposition player={player} forecast={forecast} />
        <div className="dossier-columns forecast-detail-columns">
        <section className="dossier-section" aria-labelledby="standard-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">CAREER BENCHMARK</span>
              <h2 id="standard-title">Hall of Fame benchmark</h2>
            </div>
            <ShieldCheck size={18} aria-hidden="true" />
          </div>
          {forecast.hofStandard ? (
            <dl className="provenance-list standard-list">
              <div><dt>Standard</dt><dd>{forecast.hofStandard.label}</dd></div>
              <div><dt>Role / position</dt><dd>{forecast.hofStandard.roleOrPosition ?? 'Role fallback'}</dd></div>
              <div><dt>Career WAR</dt><dd>{formatWar(forecast.hofStandard.careerWar)}</dd></div>
              <div><dt>Best 7 seasons</dt><dd>{formatWar(forecast.hofStandard.peakSevenWar)}</dd></div>
              <div><dt>Combined benchmark (JAWS)</dt><dd>{formatWar(forecast.hofStandard.jaws)}</dd></div>
            </dl>
          ) : (
            <p className="section-empty">The benchmark details are not available for this player.</p>
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
            <p className="section-empty">No additional player-specific warning was included.</p>
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
      </details>
    </>
  )
}

function ResearchArrivalPanel({ player }: { player: PlayerRecord }) {
  const estimate = player.researchEstimate
  if (!estimate) return null
  const signal = player.milbAlphaSignal
  const releaseGates = signal?.releaseGates

  return (
    <section className="research-forecast" aria-labelledby="research-arrival-title">
      <div className="research-warning" role="note">
        <AlertTriangle size={18} aria-hidden="true" />
        <div>
          <strong>Research arrival rank · exact probability unavailable</strong>
          <span>The model has not passed every release test. Its arrival rank remains visible, while current 2026 evidence stays separate.</span>
        </div>
      </div>

      <div className="research-arrival-grid">
        <div className="research-arrival-summary">
          <span className="eyebrow">MLB ARRIVAL RESEARCH</span>
          <h2 id="research-arrival-title">Arrival model audit</h2>
          <div className="arrival-rank-hero">
            <strong>{signal?.rank ? `#${signal.rank}` : '—'}</strong>
            <span>research arrival rank</span>
          </div>
          <dl>
            <div><dt>Signal</dt><dd>{signal?.eligible ? 'Gate cleared' : 'Not cleared'}</dd></div>
            <div><dt>Model cohort</dt><dd>{estimate.priorLevel}</dd></div>
            <div><dt>Feature age</dt><dd>{estimate.modelAge.toFixed(1)}</dd></div>
            <div><dt>Support</dt><dd>{estimate.coldStart ? 'Cold start' : 'Prior history'}</dd></div>
          </dl>
        </div>
        <div className="arrival-audit-detail">
          <span className="eyebrow">RELEASE GATES</span>
          <div className="arrival-release-gates">
            {([
              ['External validation', releaseGates?.externalValidationPassed ?? false],
              ['Probability calibration', releaseGates?.probabilityCalibrationPassed ?? false],
              ['Current feature alignment', releaseGates?.currentFeatureAlignmentPassed ?? false],
            ] as const).map(([label, passed]) => (
              <div key={label} className={passed ? 'is-pass' : 'is-fail'}>
                {passed ? <Check size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
                <span>{label}</span>
                <strong>{passed ? 'Passed' : 'Not passed'}</strong>
              </div>
            ))}
          </div>
          <p className="research-chart-note">Raw 12–60 month scores remain in the locked research artifact, but the product does not render them as confidence until calibration and external validation both pass.</p>
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
  onReturnToBoard,
}: PlayerDossierProps) {
  const forecast = player.careerForecast
  const playerMap = playerMapFor(player)
  const careerIndex = careerIndexFor(player, playerMap)
  const organization = player.organization ?? player.organizationCode ?? 'Organization unavailable'
  const externalIds = Object.entries(player.provenance.externalIds).filter(([, value]) => value !== null)
  const cohort = player.provenance.cohort

  return (
    <article id="player-dossier" className="player-dossier" aria-labelledby="player-name">
      <header className="dossier-header">
        <div className="dossier-identity">
          <div>
            <div className="identity-line">
              <span className="eyebrow">
                {careerIndex.value === null
                  ? 'CAREER INDEX PENDING'
                  : careerIndex.rank === null
                    ? `CAREER INDEX ${careerIndex.display} · STAGE STANDING PENDING`
                    : `${careerIndex.rankLabel.toLocaleUpperCase()}${careerIndex.topLabel ? ` · ${careerIndex.topLabel.toLocaleUpperCase()}` : ''}`}
              </span>
              <span className="source-badge">
                {playerMap.handling?.primary?.label ?? plainPlayerState(playerMap.state)}
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
        </div>
      </header>

      <PlayerMapScorecard player={player} />

      {player.stage === 'recent_callup' ? (
        <RookieTrackPanel player={player} />
      ) : forecast?.publicationState === 'withheld' ? (
        <SpecialHandlingPanel player={player} forecast={forecast} />
      ) : forecast && isMlbStage(player.stage) ? (
        <CareerForecastPanel player={player} forecast={forecast} />
      ) : forecast && player.stage === 'pre_debut' ? (
        <ProspectCareerOutlookPanel player={player} forecast={forecast} />
      ) : player.stage === 'pre_debut' ? (
        <section className="model-pending" aria-labelledby="prospect-career-model-title">
          <CircleDashed size={20} aria-hidden="true" />
          <div>
            <span className="eyebrow">LONG-TERM OUTLOOK</span>
            <h2 id="prospect-career-model-title">Career outlook not matched yet</h2>
            <p>This player does not yet have the matched arrival and projected debut-age forecast required for a prospect career outlook.</p>
          </div>
        </section>
      ) : (
        <section className="model-pending" aria-labelledby="model-pending-title">
          <CircleDashed size={20} aria-hidden="true" />
          <div>
            <span className="eyebrow">CAREER OUTLOOK</span>
            <h2 id="model-pending-title">Career estimate not available yet</h2>
            <p>This player does not have enough matched completed-season data for a career projection.</p>
          </div>
        </section>
      )}

      {player.stage === 'pre_debut' ? <CurrentMinorEvidencePanel player={player} /> : null}

      {player.stage === 'pre_debut' ? (
        <details className="advanced-model-details">
          <summary>Advanced prospect model details</summary>
          <MilbAlphaRadarPanel player={player} />
          {player.researchEstimate ? <ResearchArrivalPanel player={player} /> : null}
        </details>
      ) : null}

      <section className="observed-metrics" aria-label="Current player information">
        <div className="metric-tile">
          <span className="metric-label">CAREER STAGE</span>
          <strong className="metric-text">{stageLabel(player.stage)}</strong>
          <small>{player.level ?? 'level unavailable'}</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">AGE / PLAYER TYPE</span>
          <strong className="metric-number">{player.age ?? '—'}</strong>
          <small>{player.playerType} · {player.position ?? 'position unavailable'}</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">{player.opportunity?.label.toUpperCase() ?? 'OPPORTUNITY'}</span>
          <strong className="metric-number">{player.opportunity?.value ?? '—'}</strong>
          <small>{player.provenance.season ?? 'Current'} season</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">AVAILABLE DATA</span>
          <strong className="metric-text">{player.coverage.label}</strong>
          <small>{player.coverage.levelsObserved.join(', ') || player.level || 'context unavailable'}</small>
        </div>
      </section>

      <section className="dossier-section traits-section" aria-labelledby="traits-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">CURRENT STATS</span>
              <h2 id="traits-title">Performance profile</h2>
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
            <p className="section-empty">Current performance stats are not available for this player yet.</p>
          )}
          <div className="tag-list" aria-label="Data coverage">
            {player.coverage.hasStatcast ? <span>Statcast metrics</span> : null}
            {player.coverage.hasTraditional ? <span>Season stats</span> : null}
            {player.coverage.hasComplementaryRows ? <span>Multiple sources matched</span> : null}
            {player.coverage.levelsObserved.map((level) => <span key={level}>{level}</span>)}
          </div>
      </section>

      <details className="advanced-model-details data-source-details">
        <summary>Data sources and record details</summary>
        <section className="dossier-section provenance-section" aria-labelledby="provenance-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">SOURCE DETAILS</span>
              <h2 id="provenance-title">Where this data came from</h2>
            </div>
            <Database size={18} aria-hidden="true" />
          </div>
          <dl className="provenance-list">
            <div><dt>Source</dt><dd>{player.provenance.source}</dd></div>
            <div><dt>Dataset</dt><dd>{player.provenance.dataset}</dd></div>
            <div><dt>Season</dt><dd>{player.provenance.season ?? 'Unavailable'}</dd></div>
            <div><dt>Retrieved</dt><dd>{formatRetrievedAt(player.provenance.retrievedAt)}</dd></div>
            {cohort ? <div><dt>Comparison group</dt><dd>Ages {cohort.minAge}–{cohort.maxAge} · standard playing-time filter</dd></div> : null}
            <div><dt>Player match</dt><dd>{externalIds.length > 0 ? `${externalIds.length} verified source ID${externalIds.length === 1 ? '' : 's'}` : 'Internal player record'}</dd></div>
          </dl>
          {player.coverage.organizationConflict ? (
            <p className="provenance-note"><Info size={14} aria-hidden="true" /> Organization differs across merged source variants.</p>
          ) : null}
        </section>
      </details>

      <footer className="dossier-footer">
        <span><CalendarClock size={14} aria-hidden="true" /> As of {formatRetrievedAt(forecast?.asOf ?? player.provenance.retrievedAt)}</span>
        <span><Layers3 size={14} aria-hidden="true" /> {stageLabel(player.stage)}</span>
        <span><Info size={14} aria-hidden="true" /> Research use only</span>
        <span className="footer-score">
          Career Index: {careerIndex.display} · {careerIndex.rankLabel}{careerIndex.topLabel ? ` · ${careerIndex.topLabel}` : ''}
        </span>
      </footer>
    </article>
  )
}
