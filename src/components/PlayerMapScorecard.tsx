import { AlertCircle, Layers3, Radar, Route } from 'lucide-react'
import type { PlayerRecord } from '../domain/forecast'
import type { PlayerMapScore, PlayerMapSignal } from '../domain/playerMap'
import { oracleScoreFor, plainPlayerState, playerMapFor } from './playerMapView'

function scoreWidth(score: PlayerMapScore): number | null {
  if (score.value === null || score.scale === 'ordinal_rank') return null
  return Math.max(0, Math.min(100, score.value))
}

function ordinalLabel(value: number): string {
  const rounded = Math.round(value)
  const lastTwo = rounded % 100
  const suffix = lastTwo >= 11 && lastTwo <= 13
    ? 'th'
    : rounded % 10 === 1
      ? 'st'
      : rounded % 10 === 2
        ? 'nd'
        : rounded % 10 === 3
          ? 'rd'
          : 'th'
  return `${rounded}${suffix} percentile`
}

function supportingLabel(score: PlayerMapScore, route: 'milb' | 'mlb'): string {
  if (score.key === 'outcome') return route === 'milb' ? 'Five-year MLB impact' : score.label
  if (score.key === 'readiness') return route === 'milb' ? 'MLB readiness' : 'Next 3-year upside'
  if (score.key === 'trajectory') return route === 'milb' ? 'Projected MLB arrival' : 'Career pace'
  if (score.key === 'best_trait') return route === 'milb' ? 'Best current skill' : 'Current season performance'
  return route === 'milb' ? 'Current data coverage' : 'Model evidence'
}

function supportingDisplay(
  score: PlayerMapScore,
  route: 'milb' | 'mlb',
  player: PlayerRecord,
): string {
  if (score.key === 'readiness' && route === 'milb') {
    return score.rank === null ? 'Not yet confirmed' : `Arrival rank #${score.rank.toLocaleString()}`
  }
  if (score.key === 'trajectory' && route === 'milb') return score.display
  if ((score.key === 'trajectory' || score.key === 'best_trait') && score.value !== null) {
    return ordinalLabel(score.value)
  }
  if (score.key === 'evidence' && route === 'milb') {
    return score.display.replace('pillars', 'data areas')
  }
  if (score.key === 'evidence' && route === 'mlb') {
    return player.careerForecast?.confidenceState ?? 'Not available'
  }
  if (score.key === 'best_trait' && score.value === null) return 'Stats not loaded'
  return score.display
}

function supportingBasis(score: PlayerMapScore, route: 'milb' | 'mlb'): string {
  if (score.key === 'readiness') {
    return route === 'milb'
      ? 'A separate model checks whether an MLB arrival is close enough to confirm.'
      : 'Chance of reaching the model’s elite production line over the next three seasons.'
  }
  if (score.key === 'outcome') return score.basis
  if (score.key === 'trajectory') {
    return route === 'milb'
      ? 'Projected MLB arrival age is carried into the career outlook; later arrivals have less runway.'
      : 'Career value to date compared with similar players at the same age and experience.'
  }
  if (score.key === 'best_trait') {
    return score.value === null ? 'Current tracking stats are not available in this profile.' : score.basis
  }
  return route === 'milb'
    ? 'How many key areas of the current player profile are represented.'
    : 'How much completed-career evidence supports the projection.'
}

function plainSignal(signal: PlayerMapSignal): { label: string; detail: string } {
  const copy: Record<PlayerMapSignal['code'], { label: string; detail: string }> = {
    dual_confirmed: {
      label: 'Career upside and MLB readiness agree',
      detail: 'Both the runway-adjusted career model and the separate MLB arrival check rate this player highly.',
    },
    ceiling_readiness_split: {
      label: 'High upside, longer path',
      detail: 'The career ceiling rank is high, but a near-term MLB arrival is not confirmed yet.',
    },
    thin_data_upside: {
      label: 'Early signal',
      detail: 'The score is already high even though the current-season sample is still developing.',
    },
    trait_corroborated: {
      label: 'Current stats support the projection',
      detail: 'The available performance and tracking stats reinforce the modeled upside.',
    },
    live_evidence_split: {
      label: 'Clear strengths and risks',
      detail: 'The current profile has at least one standout skill and one area that needs improvement.',
    },
    model_alpha: {
      label: 'Unusually strong career upside',
      detail: 'Age, career pace, projected ceiling, and historical comparisons all clear the standout line.',
    },
    rising_trajectory: {
      label: 'Career trending up',
      detail: 'The latest completed season improved the player’s long-term career path.',
    },
  }
  return copy[signal.code]
}

function plainNextStep(step: string): string {
  const plateAppearances = /^(\d+) PA to the sufficient current-sample threshold$/u.exec(step)
  if (plateAppearances) return `${plateAppearances[1]} more plate appearances for a fuller current-season sample`
  const innings = /^(\d+(?:\.\d+)?) IP to the sufficient current-sample threshold$/u.exec(step)
  if (innings) return `${innings[1]} more innings for a fuller current-season sample`
  const pitches = /^(\d+) Pitches to the sufficient current-sample threshold$/u.exec(step)
  if (pitches) return `${pitches[1]} more pitches for a fuller current-season sample`
  if (step.startsWith('Add ') && step.endsWith(' evidence')) {
    return `Add more ${step.slice(4, -9).toLocaleLowerCase()} data`
  }
  if (step === 'Create an exact frozen model snapshot match') return 'Match this player in the next complete model update'
  if (step === 'Refresh at the next completed-season model snapshot') return 'Re-score after the next completed season'
  if (step === 'Next completed-season Career Oracle snapshot') return 'Re-score after the next completed season'
  if (step === 'Current MLB performance and tracking ingestion') return 'Add current MLB performance and tracking stats'
  if (step === 'Add current performance and tracking evidence') return 'Add current performance and tracking stats'
  return step
}

export function PlayerMapScorecard({ player }: { player: PlayerRecord }) {
  const map = playerMapFor(player)
  const oracleScore = oracleScoreFor(player)
  const supportingScores = map.route === 'milb'
    ? [map.scores.outcome, map.scores.readiness, map.scores.trajectory, map.scores.evidence]
    : [map.scores.readiness, map.scores.trajectory, map.scores.bestTrait, map.scores.evidence]
  const hasTraitProfile = map.strengths.length > 0 || map.risks.length > 0

  return (
    <section className={`player-map player-map--${map.state}`} aria-labelledby="player-map-title">
      <div className="player-map-heading">
        <div className={`oracle-score-hero oracle-score-hero--${oracleScore.tone}`}>
          <span>ORACLE SCORE</span>
          <strong>{oracleScore.display}</strong>
          <small>{oracleScore.value === null ? 'NOT SCORED' : '/ 100'}</small>
        </div>
        <div className="player-map-heading-copy">
          <span className="eyebrow">PRIMARY PLAYER RANKING</span>
          <h2 id="player-map-title">{oracleScore.outcomeLabel}</h2>
          <p>{oracleScore.explanation}</p>
          <div className="player-map-context">
            <strong>{oracleScore.rankLabel}</strong>
            <span><Radar size={14} aria-hidden="true" /> {plainPlayerState(map.state)}</span>
          </div>
        </div>
      </div>

      <div className="oracle-score-definition">
        <strong>Start here.</strong>
        <span>
          {map.route === 'milb'
            ? 'Higher is better. The minor-league score carries projected MLB arrival age into the career ceiling rank, so remaining career runway matters.'
            : 'Higher is better. Oracle Score converts this player’s exact rank among all scored major-league players to a 0–100 scale.'}
        </span>
      </div>

      <div className="player-map-scores" aria-label="Context behind the Oracle Score">
        {supportingScores.map((score) => {
          const width = scoreWidth(score)
          return (
            <div className={`player-map-score player-map-score--${score.status}`} key={score.key}>
              <span>{supportingLabel(score, map.route)}</span>
              <strong>{supportingDisplay(score, map.route, player)}</strong>
              <div
                className="player-map-score-track"
                role="img"
                aria-label={`${supportingLabel(score, map.route)}: ${supportingDisplay(score, map.route, player)}`}
              >
                {width === null ? null : <i style={{ width: `${width}%` }} />}
              </div>
              <small>{supportingBasis(score, map.route)}</small>
            </div>
          )
        })}
      </div>

      {map.signals.length > 0 ? (
        <div className="player-map-signals" aria-label="Why this player stands out">
          <div className="player-map-subheading">
            <Route size={15} aria-hidden="true" />
            <span>Why this player stands out</span>
          </div>
          <div>
            {map.signals.map((signal) => {
              const copy = plainSignal(signal)
              return (
                <div className="player-map-signal" key={signal.code}>
                  <strong>{copy.label}</strong>
                  <span>{copy.detail}</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {hasTraitProfile || map.nextEvidence.length > 0 ? (
        <div className="player-map-evidence">
          {hasTraitProfile ? (
            <div className="player-map-traits">
              <div className="player-map-subheading">
                <Layers3 size={15} aria-hidden="true" />
                <span>Current strengths and risks</span>
              </div>
              <div className="player-map-trait-columns">
                <div>
                  <span>STRENGTHS</span>
                  {map.strengths.length > 0 ? map.strengths.map((trait) => (
                    <p key={trait.key}>
                      <strong>{trait.label}</strong>
                      <span>{ordinalLabel(trait.percentile)}{trait.value ? ` · ${trait.value}` : ''}</span>
                    </p>
                  )) : <p><span>No skill is currently in the top 20%</span></p>}
                </div>
                <div>
                  <span>RISKS</span>
                  {map.risks.length > 0 ? map.risks.map((trait) => (
                    <p key={trait.key}>
                      <strong>{trait.label}</strong>
                      <span>{ordinalLabel(trait.percentile)}{trait.value ? ` · ${trait.value}` : ''}</span>
                    </p>
                  )) : <p><span>No tracked skill is currently in the bottom 20%</span></p>}
                </div>
              </div>
            </div>
          ) : null}

          <div className="player-map-next">
            <div className="player-map-subheading">
              <AlertCircle size={15} aria-hidden="true" />
              <span>What to watch next</span>
            </div>
            <ul>
              {map.nextEvidence.map((step) => <li key={step}>{plainNextStep(step)}</li>)}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="player-map-disclosure">
        <strong>Rank, not a guarantee.</strong>
        <span>{map.route === 'milb'
          ? 'This is a research rank from an MLB-arrival and debut-age career bridge, not a Hall of Fame probability, blended composite, or card-value estimate. Current stats refresh daily; model ranks change with a tested release.'
          : 'Oracle Score is a stage-specific percentile, not a probability, blended composite, or card-value estimate. Current stats refresh daily; the score changes with a tested model release.'}</span>
      </div>
    </section>
  )
}
