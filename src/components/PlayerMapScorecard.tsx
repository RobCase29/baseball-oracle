import { AlertCircle, Layers3, Radar, Route } from 'lucide-react'
import type { PlayerRecord } from '../domain/forecast'
import type { PlayerMapProfile, PlayerMapSignal } from '../domain/playerMap'
import {
  backstopRankFor,
  careerOutlookFor,
  currentResultsFor,
  playerMapFor,
} from './playerMapView'

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

interface OutlookFact {
  label: string
  value: string
  detail: string
}

function outlookFacts(player: PlayerRecord, map: PlayerMapProfile): OutlookFact[] {
  const careerOutlook = careerOutlookFor(player, map)
  const currentResults = currentResultsFor(player, map)
  return [
    {
      label: 'Career Outlook',
      value: careerOutlook.band,
      detail: `${careerOutlook.display} · ${careerOutlook.basis}`,
    },
    {
      label: 'Current Results',
      value: currentResults.headline,
      detail: currentResults.detail,
    },
  ]
}

function plainSignal(signal: PlayerMapSignal): { label: string; detail: string } {
  const copy: Record<PlayerMapSignal['code'], { label: string; detail: string }> = {
    dual_confirmed: {
      label: 'Rank and MLB readiness agree',
      detail: 'The five-year impact rank and the separate MLB arrival check both rate this player highly.',
    },
    ceiling_readiness_split: {
      label: 'Strong outlook, longer path',
      detail: 'The Backstop Rank is strong, but a near-term MLB arrival is not confirmed yet.',
    },
    thin_data_upside: {
      label: 'Early signal',
      detail: 'The Backstop Rank is already strong even though the current-season sample is still developing.',
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
    prospect_prior_preserved: {
      label: 'Pre-debut outlook preserved',
      detail: 'The pre-debut rank stays visible while the first MLB sample develops.',
    },
    mlb_confirmation: {
      label: 'MLB evidence is arriving',
      detail: 'Current major-league performance is tracked beside the prior without being blended into it.',
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
  if (step === 'Next daily MLB value refresh') return 'Refresh current MLB evidence each day'
  if (step === 'First supported completed-season Career Oracle snapshot') return 'Hand off to the MLB career model after a supported complete season'
  if (step === 'Current MLB performance and tracking ingestion') return 'Add current MLB performance and tracking stats'
  if (step === 'Add current performance and tracking evidence') return 'Add current performance and tracking stats'
  if (step === 'Prospective Rookie-level calibration') return 'Re-check the score after promotion or stronger Rookie-level validation'
  return step
}

export function PlayerMapScorecard({ player }: { player: PlayerRecord }) {
  const map = playerMapFor(player)
  const backstopRank = backstopRankFor(player, map)
  const facts = outlookFacts(player, map)
  const hasTraitProfile = map.strengths.length > 0 || map.risks.length > 0
  const outcomeTitle = map.route === 'milb'
    ? 'Prospect ranking'
    : map.route === 'rookie'
      ? 'Pre-debut rank, current MLB check'
      : 'MLB career ranking'

  return (
    <section className={`player-map player-map--${map.state}`} aria-labelledby="player-map-title">
      <div className="player-map-heading">
        <div
          className={`career-index-hero career-index-hero--${backstopRank.tone}`}
          role="group"
          aria-label={backstopRank.rank === null ? 'Backstop Rank unavailable' : `Backstop Rank ${backstopRank.rankLabel}`}
        >
          <span>BACKSTOP RANK</span>
          <strong>{backstopRank.display}</strong>
          <small>{backstopRank.routeLabel.toLocaleUpperCase()}</small>
        </div>
        <div className="player-map-heading-copy">
          <span className="eyebrow">RANKING SUMMARY</span>
          <h2 id="player-map-title">{outcomeTitle}</h2>
          <p>{backstopRank.explanation}</p>
          <div className="player-map-context">
            <strong>{backstopRank.topLabel ?? 'Rank pending'}</strong>
            <span><Radar size={14} aria-hidden="true" /> {backstopRank.cohortLabel} · {backstopRank.evidenceLabel}</span>
          </div>
        </div>
      </div>

      <div className="player-map-scores player-map-facts" aria-label="Career Outlook and Current Results">
        {facts.map((fact) => (
          <div className="player-map-score" key={fact.label}>
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
            <small>{fact.detail}</small>
          </div>
        ))}
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

    </section>
  )
}
