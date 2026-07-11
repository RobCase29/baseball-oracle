import { lazy, Suspense } from 'react'
import { Activity, CalendarClock, Check, Info, ShieldCheck, Star } from 'lucide-react'
import type { PlayerForecast } from '../domain/forecast'
import { formatOrdinal, formatSigned, oracleScore } from '../lib/forecast'
import { ProbabilityRing } from './ProbabilityRing'

const CareerArcChart = lazy(() =>
  import('./CareerArcChart').then((module) => ({ default: module.CareerArcChart })),
)

interface PlayerDossierProps {
  player: PlayerForecast
  saved: boolean
  onToggleWatchlist: (playerId: string) => void
}

function OutcomeDistribution({ player }: { player: PlayerForecast }) {
  const regular = Math.max(0, player.arrivalProbability - player.starProbability)
  const noArrival = 100 - player.arrivalProbability

  return (
    <div className="outcome-distribution">
      <div className="distribution-bar" aria-label="Projected outcome distribution">
        <span className="bar-star" style={{ width: `${player.starProbability}%` }} />
        <span className="bar-regular" style={{ width: `${regular}%` }} />
        <span className="bar-no-arrival" style={{ width: `${noArrival}%` }} />
      </div>
      <div className="distribution-legend">
        <span><i className="legend-star" />Star path <strong>{player.starProbability}%</strong></span>
        <span><i className="legend-regular" />MLB role <strong>{regular}%</strong></span>
        <span><i className="legend-no-arrival" />No MLB <strong>{noArrival}%</strong></span>
      </div>
    </div>
  )
}

export function PlayerDossier({ player, saved, onToggleWatchlist }: PlayerDossierProps) {
  return (
    <article className="player-dossier" aria-labelledby="player-name">
      <header className="dossier-header">
        <div className="dossier-identity">
          <span className={`player-avatar player-avatar--large player-avatar--${player.playerType.toLowerCase()}`}>
            {player.initials}
          </span>
          <div>
            <div className="identity-line">
              <span className="eyebrow">#{player.rank} ORACLE BOARD</span>
              <span className={`risk-badge risk-badge--${player.risk.toLowerCase()}`}>{player.risk} risk</span>
            </div>
            <h1 id="player-name">{player.name}</h1>
            <p>
              {player.organization} · {player.position} · Age {player.age} · {player.level} · {player.batsThrows}
            </p>
          </div>
        </div>
        <button
          className={`watch-button${saved ? ' is-saved' : ''}`}
          type="button"
          onClick={() => onToggleWatchlist(player.id)}
        >
          {saved ? <Check size={16} aria-hidden="true" /> : <Star size={16} aria-hidden="true" />}
          {saved ? 'Watching' : 'Watch'}
        </button>
      </header>

      <p className="player-summary">{player.summary}</p>

      <section className="forecast-metrics" aria-label="Forecast summary">
        <div className="metric-tile metric-tile--reach">
          <ProbabilityRing value={player.arrivalProbability} label="REACH MLB" />
          <div className="metric-detail">
            <span>Arrival forecast</span>
            <strong>{player.eta}</strong>
            <small className={player.arrivalDelta >= 0 ? 'positive' : 'negative'}>
              {formatSigned(player.arrivalDelta, ' pts')} this update
            </small>
          </div>
        </div>
        <div className="metric-tile">
          <span className="metric-label">P50 CAREER WAR</span>
          <strong className="metric-number">{player.expectedCareerWar.toFixed(1)}</strong>
          <small>{player.floorWar.toFixed(1)}–{player.ceilingWar.toFixed(0)} modeled range</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">STAR OUTCOME</span>
          <strong className="metric-number">{player.starProbability}%</strong>
          <small>24+ career WAR threshold</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">HOF-CALIBER TAIL</span>
          <strong className="metric-number">{player.hofProbability}%</strong>
          <small>Performance profile, not induction</small>
        </div>
      </section>

      <OutcomeDistribution player={player} />

      <section className="dossier-section career-section" aria-labelledby="career-title">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">PROBABILISTIC FORECAST</span>
            <h2 id="career-title">Career arc</h2>
          </div>
          <div className="chart-key" aria-hidden="true">
            <span><i className="key-range" />80% range</span>
            <span><i className="key-median" />Median</span>
            {player.level === 'MLB' ? <span><i className="key-actual" />Recorded</span> : null}
          </div>
        </div>
        <Suspense fallback={<div className="career-chart chart-loading">Loading forecast…</div>}>
          <CareerArcChart data={player.careerArc} currentAge={player.age} />
        </Suspense>
      </section>

      <div className="dossier-columns">
        <section className="dossier-section evidence-section" aria-labelledby="evidence-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">MODEL EVIDENCE</span>
              <h2 id="evidence-title">What moves the forecast</h2>
            </div>
            <Activity size={18} aria-hidden="true" />
          </div>
          <div className="driver-list">
            {player.drivers.map((driver) => (
              <div className="driver-row" key={driver.label}>
                <div className="driver-copy">
                  <strong>{driver.label}</strong>
                  <span>{driver.detail}</span>
                </div>
                <div className="driver-impact">
                  <strong className={driver.impact >= 0 ? 'positive' : 'negative'}>{driver.value}</strong>
                  <span className="impact-track">
                    <i
                      className={driver.impact >= 0 ? 'impact-positive' : 'impact-negative'}
                      style={{ width: `${Math.abs(driver.impact)}%` }}
                    />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="dossier-section traits-section" aria-labelledby="traits-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">CURRENT SIGNALS</span>
              <h2 id="traits-title">Player shape</h2>
            </div>
            <ShieldCheck size={18} aria-hidden="true" />
          </div>
          <div className="metric-list">
            {player.metrics.map((metric) => (
              <div className="metric-row" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <span className="percentile-track" aria-label={`${formatOrdinal(metric.percentile)} percentile`}>
                  <i style={{ width: `${metric.percentile}%` }} />
                </span>
                <small>{formatOrdinal(metric.percentile)}</small>
              </div>
            ))}
          </div>
          <div className="tag-list">
            {player.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </section>
      </div>

      <footer className="dossier-footer">
        <span><CalendarClock size={14} aria-hidden="true" /> Snapshot {player.updatedAt}</span>
        <span><ShieldCheck size={14} aria-hidden="true" /> {player.confidence}% model confidence</span>
        <span><Info size={14} aria-hidden="true" /> {player.dataCompleteness}% data completeness</span>
        <span className="footer-score">Oracle score {oracleScore(player)}</span>
      </footer>
    </article>
  )
}
