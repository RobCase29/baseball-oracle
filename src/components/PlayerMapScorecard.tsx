import { AlertCircle, Layers3, Radar, Route } from 'lucide-react'
import type { PlayerRecord } from '../domain/forecast'
import type { PlayerMapScore } from '../domain/playerMap'
import { playerMapFor } from './playerMapView'

function scoreWidth(score: PlayerMapScore): number | null {
  if (score.value === null || score.scale === 'ordinal_rank') return null
  return Math.max(0, Math.min(100, score.value))
}

function percentileLabel(value: number): string {
  return `P${value >= 99 ? value.toFixed(1) : value.toFixed(0)}`
}

export function PlayerMapScorecard({ player }: { player: PlayerRecord }) {
  const map = playerMapFor(player)
  const scores = [
    map.scores.outcome,
    map.scores.readiness,
    map.scores.trajectory,
    map.scores.bestTrait,
    map.scores.evidence,
  ]
  const hasTraitProfile = map.strengths.length > 0 || map.risks.length > 0

  return (
    <section className={`player-map player-map--${map.state}`} aria-labelledby="player-map-title">
      <div className="player-map-heading">
        <div className="player-map-heading-copy">
          <span className="eyebrow">UNIVERSAL STAGE-SPECIFIC ASSESSMENT</span>
          <h2 id="player-map-title">Oracle Player Map</h2>
          <p>{map.summary}</p>
        </div>
        <div className="player-map-state">
          <Radar size={17} aria-hidden="true" />
          <span>{map.stateLabel}</span>
          <small>{map.archetype}</small>
        </div>
      </div>

      <div className="player-map-scores" aria-label="Player map coordinates">
        {scores.map((score) => {
          const width = scoreWidth(score)
          return (
            <div className={`player-map-score player-map-score--${score.status}`} key={score.key}>
              <span>{score.label}</span>
              <strong>{score.display}</strong>
              <div
                className="player-map-score-track"
                role="img"
                aria-label={`${score.label}: ${score.display}`}
              >
                {width === null ? null : <i style={{ width: `${width}%` }} />}
              </div>
              <small>{score.basis}</small>
            </div>
          )
        })}
      </div>

      {map.signals.length > 0 ? (
        <div className="player-map-signals" aria-label="Player map signals">
          <div className="player-map-subheading">
            <Route size={15} aria-hidden="true" />
            <span>Path signals</span>
          </div>
          <div>
            {map.signals.map((signal) => (
              <div className="player-map-signal" key={signal.code}>
                <strong>{signal.label}</strong>
                <span>{signal.detail}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {hasTraitProfile || map.nextEvidence.length > 0 ? (
        <div className="player-map-evidence">
          {hasTraitProfile ? (
            <div className="player-map-traits">
              <div className="player-map-subheading">
                <Layers3 size={15} aria-hidden="true" />
                <span>Live profile</span>
              </div>
              <div className="player-map-trait-columns">
                <div>
                  <span>STRENGTHS</span>
                  {map.strengths.length > 0 ? map.strengths.map((trait) => (
                    <p key={trait.key}>
                      <strong>{trait.label}</strong>
                      <span>{percentileLabel(trait.percentile)}{trait.value ? ` · ${trait.value}` : ''}</span>
                    </p>
                  )) : <p><span>None above the P80 descriptive line</span></p>}
                </div>
                <div>
                  <span>RISKS</span>
                  {map.risks.length > 0 ? map.risks.map((trait) => (
                    <p key={trait.key}>
                      <strong>{trait.label}</strong>
                      <span>{percentileLabel(trait.percentile)}{trait.value ? ` · ${trait.value}` : ''}</span>
                    </p>
                  )) : <p><span>None below the P20 descriptive line</span></p>}
                </div>
              </div>
            </div>
          ) : null}

          <div className="player-map-next">
            <div className="player-map-subheading">
              <AlertCircle size={15} aria-hidden="true" />
              <span>What changes the read</span>
            </div>
            <ul>
              {map.nextEvidence.map((step) => <li key={step}>{step}</li>)}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="player-map-disclosure">
        <strong>No composite score.</strong>
        <span>Evidence changes trust, not outcome rank. Stage-specific baseball signals only; market price and liquidity are excluded.</span>
      </div>
    </section>
  )
}
