import { lazy, Suspense } from 'react'
import {
  Activity,
  CalendarClock,
  Check,
  CircleDashed,
  Database,
  Info,
  Layers3,
  List,
  ShieldCheck,
  Star,
} from 'lucide-react'
import type { PlayerRecord, PublishedForecast } from '../domain/forecast'
import { formatOrdinal, formatScore, formatSigned, oracleScore } from '../lib/forecast'
import { ProbabilityRing } from './ProbabilityRing'

const CareerArcChart = lazy(() =>
  import('./CareerArcChart').then((module) => ({ default: module.CareerArcChart })),
)

interface PlayerDossierProps {
  player: PlayerRecord
  saved: boolean
  onToggleWatchlist: (playerId: string) => void
  onReturnToBoard: () => void
}

function OutcomeDistribution({ forecast }: { forecast: PublishedForecast }) {
  const regular = Math.max(0, forecast.arrivalProbability - forecast.starProbability)
  const noArrival = Math.max(0, 100 - forecast.arrivalProbability)

  return (
    <div className="outcome-distribution">
      <div className="distribution-bar" aria-label="Projected outcome distribution">
        <span className="bar-star" style={{ width: `${forecast.starProbability}%` }} />
        <span className="bar-regular" style={{ width: `${regular}%` }} />
        <span className="bar-no-arrival" style={{ width: `${noArrival}%` }} />
      </div>
      <div className="distribution-legend">
        <span><i className="legend-star" />Star path <strong>{forecast.starProbability}%</strong></span>
        <span><i className="legend-regular" />MLB role <strong>{regular}%</strong></span>
        <span><i className="legend-no-arrival" />No MLB <strong>{noArrival}%</strong></span>
      </div>
    </div>
  )
}

function PublishedForecastPanel({ player, forecast }: { player: PlayerRecord; forecast: PublishedForecast }) {
  return (
    <>
      <section className="forecast-metrics" aria-label="Published forecast summary">
        <div className="metric-tile metric-tile--reach">
          <ProbabilityRing value={forecast.arrivalProbability} label="REACH MLB" />
          <div className="metric-detail">
            <span>Arrival forecast</span>
            <strong>{forecast.eta ?? 'Horizon pending'}</strong>
            {forecast.arrivalDelta === null ? (
              <small>No prior published comparison</small>
            ) : (
              <small className={forecast.arrivalDelta >= 0 ? 'positive' : 'negative'}>
                {formatSigned(forecast.arrivalDelta, ' pts')} this update
              </small>
            )}
          </div>
        </div>
        <div className="metric-tile">
          <span className="metric-label">P50 CAREER WAR</span>
          <strong className="metric-number">{forecast.expectedCareerWar.toFixed(1)}</strong>
          <small>{forecast.floorWar.toFixed(1)}–{forecast.ceilingWar.toFixed(0)} modeled range</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">STAR OUTCOME</span>
          <strong className="metric-number">{forecast.starProbability}%</strong>
          <small>24+ career WAR threshold</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">HOF-CALIBER TAIL</span>
          <strong className="metric-number">{forecast.hofProbability}%</strong>
          <small>Performance profile, not induction</small>
        </div>
      </section>

      <OutcomeDistribution forecast={forecast} />

      <section className="dossier-section career-section" aria-labelledby="career-title">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">PUBLISHED FORECAST</span>
            <h2 id="career-title">Career arc</h2>
          </div>
          <div className="chart-key" aria-hidden="true">
            <span><i className="key-range" />80% range</span>
            <span><i className="key-median" />Median</span>
          </div>
        </div>
        <Suspense fallback={<div className="career-chart chart-loading">Loading forecast...</div>}>
          <CareerArcChart data={forecast.careerArc} currentAge={player.age ?? 0} />
        </Suspense>
      </section>

      <section className="dossier-section evidence-section" aria-labelledby="evidence-title">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">MODEL EVIDENCE</span>
            <h2 id="evidence-title">What moves the forecast</h2>
          </div>
          <Activity size={18} aria-hidden="true" />
        </div>
        <div className="driver-list">
          {forecast.drivers.map((driver) => (
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
    </>
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
  const forecast = player.forecast
  const organization = player.organization ?? player.organizationCode ?? 'Organization unavailable'
  const externalIds = Object.entries(player.provenance.externalIds).filter(([, value]) => value !== null)

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
                {forecast?.rank ? `#${forecast.rank} ORACLE BOARD` : 'SOURCE OBSERVATION'}
              </span>
              <span className={forecast ? `risk-badge risk-badge--${forecast.risk.toLowerCase()}` : 'source-badge'}>
                {forecast ? `${forecast.risk} risk` : 'Model pending'}
              </span>
            </div>
            <h1 id="player-name">{player.name}</h1>
            <p>
              {organization} · {player.position ?? player.playerType} · Age {player.age ?? 'unknown'} · {player.level}
              {player.batsThrows ? ` · ${player.batsThrows}` : ''}
            </p>
          </div>
        </div>
        <div className="dossier-actions">
          <button
            className="icon-button dossier-back-button"
            type="button"
            onClick={onReturnToBoard}
            aria-label="Return to prospect board"
            title="Return to prospect board"
          >
            <List size={16} aria-hidden="true" />
          </button>
          <button
            className={`watch-button${saved ? ' is-saved' : ''}`}
            type="button"
            onClick={() => onToggleWatchlist(player.id)}
          >
            {saved ? <Check size={16} aria-hidden="true" /> : <Star size={16} aria-hidden="true" />}
            {saved ? 'Watching' : 'Watch'}
          </button>
        </div>
      </header>

      <p className="player-summary">
        {forecast?.summary ??
          `${player.metrics.length} observed ${player.playerType.toLowerCase()} signals from ${player.provenance.source}. Provider scores are source evidence, not Baseball Oracle predictions.`}
      </p>

      <section className="observed-metrics" aria-label="Observed source summary">
        <div className="metric-tile">
          <span className="metric-label">PROSPECT SAVANT SCORE</span>
          <strong className="metric-number">{formatScore(player.psScore)}</strong>
          <small>Provider metric</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">SOURCE PERCENTILE</span>
          <strong className="metric-number">
            {player.psPercentile === null ? '—' : formatOrdinal(player.psPercentile)}
          </strong>
          <small>Prospect Savant cohort</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">{player.opportunity?.label.toUpperCase() ?? 'OPPORTUNITY'}</span>
          <strong className="metric-number">{player.opportunity?.value ?? '—'}</strong>
          <small>{player.provenance.season ?? 'Current'} observed season</small>
        </div>
        <div className="metric-tile">
          <span className="metric-label">METRIC COVERAGE</span>
          <strong className="metric-text">{player.coverage.label}</strong>
          <small>{player.coverage.levelsObserved.join(', ') || player.level} observed</small>
        </div>
      </section>

      {forecast ? (
        <PublishedForecastPanel player={player} forecast={forecast} />
      ) : (
        <section className="model-pending" aria-labelledby="model-pending-title">
          <CircleDashed size={20} aria-hidden="true" />
          <div>
            <span className="eyebrow">BASEBALL ORACLE FORECAST</span>
            <h2 id="model-pending-title">Model not published</h2>
            <p>MLB-arrival, career-value, and Hall of Fame-caliber probabilities stay hidden until temporal backtests and calibration pass the release gates.</p>
          </div>
        </section>
      )}

      <div className="dossier-columns dossier-columns--observed">
        <section className="dossier-section traits-section" aria-labelledby="traits-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">CURRENT SIGNALS</span>
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
            <p className="section-empty">No whitelisted metrics were reported for this profile.</p>
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
            <div><dt>Cohort</dt><dd>Ages {player.provenance.cohort.minAge}–{player.provenance.cohort.maxAge} · Q{player.provenance.cohort.pitchQualifier}</dd></div>
            <div><dt>Identity</dt><dd>{externalIds.length > 0 ? `${externalIds.length} source ID${externalIds.length === 1 ? '' : 's'}` : 'Prospect Savant ID'}</dd></div>
          </dl>
          {player.coverage.organizationConflict ? (
            <p className="provenance-note"><Info size={14} aria-hidden="true" /> Organization differs across merged source variants.</p>
          ) : null}
        </section>
      </div>

      <footer className="dossier-footer">
        <span><CalendarClock size={14} aria-hidden="true" /> Retrieved {formatRetrievedAt(player.provenance.retrievedAt)}</span>
        <span><Layers3 size={14} aria-hidden="true" /> {player.coverage.levelsObserved.length || 1} level{player.coverage.levelsObserved.length === 1 ? '' : 's'} observed</span>
        <span><Info size={14} aria-hidden="true" /> {player.provenance.source}</span>
        <span className="footer-score">
          {forecast ? `Oracle score ${oracleScore(forecast)}` : 'Oracle model pending'}
        </span>
      </footer>
    </article>
  )
}
