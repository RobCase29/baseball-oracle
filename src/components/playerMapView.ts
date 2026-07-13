import type { PlayerRecord } from '../domain/forecast'
import {
  buildPlayerMap,
  type PlayerMapOracleScore,
  type PlayerMapProfile,
  type PlayerMapState,
} from '../domain/playerMap'

export interface OracleScoreView {
  value: number | null
  display: string
  rank: number | null
  universe: number | null
  rankLabel: string
  outcomeLabel: string
  comparisonLabel: string
  explanation: string
  tone: 'elite' | 'high' | 'standard' | 'unavailable'
}

const plainStateLabels: Record<PlayerMapState, string> = {
  conviction: 'Strong model signal',
  discovery: 'High career upside, more proof needed',
  rising: 'Career trending up',
  monitor: 'Worth monitoring',
  mapped: 'Outlook available',
  evidence_building: 'More data needed',
  profile_only: 'Stats only',
}

function scoreDisplay(value: number | null): string {
  if (value === null) return '--'
  const rounded = value >= 99 ? Math.round(value * 10) / 10 : Math.round(value)
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)
}

function roundedOracleValue(value: number | null): number | null {
  if (value === null) return null
  return value >= 99 ? Math.round(value * 10) / 10 : Math.round(value)
}

function scoreTone(value: number | null): OracleScoreView['tone'] {
  if (value === null) return 'unavailable'
  if (value >= 90) return 'elite'
  if (value >= 75) return 'high'
  return 'standard'
}

export function playerMapFor(player: PlayerRecord): PlayerMapProfile {
  const existing = player.playerMap as (Omit<PlayerMapProfile, 'oracleScore'> & {
    oracleScore?: PlayerMapOracleScore
  }) | null | undefined
  if (!existing) return buildPlayerMap(player)
  if (existing.oracleScore) return existing as PlayerMapProfile

  const outcome = existing.scores.outcome
  return {
    ...existing,
    oracleScore: {
      value: roundedOracleValue(outcome.value),
      scale: 'stage_rank_percentile',
      route: existing.route,
      rank: outcome.rank,
      universe: outcome.universe,
      target: outcome.target,
      asOf: outcome.asOf,
      definition: 'Rounded stage-specific modeled outcome rank percentile; not a probability or composite score',
    },
  }
}

export function plainPlayerState(state: PlayerMapState): string {
  return plainStateLabels[state]
}

export function oracleScoreFor(player: PlayerRecord): OracleScoreView {
  const map = playerMapFor(player)
  const value = map.oracleScore.value
  const isMinor = map.route === 'milb'
  const isRookieTrack = map.route === 'rookie'
  const comparisonLabel = isMinor
    ? 'scored minor-league players'
    : isRookieTrack
      ? 'frozen prospect forecasts'
      : 'scored major-league players'
  const outcomeLabel = isMinor
    ? 'Runway-adjusted career ceiling'
    : isRookieTrack
      ? 'Prospect trajectory carried into MLB'
      : 'Hall of Fame career outlook'
  const rankLabel = map.oracleScore.rank === null
    ? 'Stage rank unavailable'
    : map.oracleScore.universe === null
      ? `#${map.oracleScore.rank.toLocaleString()} at this stage`
      : `#${map.oracleScore.rank.toLocaleString()} of ${map.oracleScore.universe.toLocaleString()}`
  const standing = value === null
    ? null
    : value >= 100
      ? `in the top 1% of ${comparisonLabel}`
      : `above about ${value}% of ${comparisonLabel}`
  const explanation = value === null
    ? `There is not enough matched model data to assign an Oracle Score yet.`
    : isRookieTrack
      ? `A score of ${scoreDisplay(value)} preserves where ${player.name} ranked before the call-up while MLB evidence accumulates separately.`
      : `A score of ${scoreDisplay(value)} puts ${player.name} ${standing} for ${outcomeLabel.replace(/^./u, (letter) => letter.toLocaleLowerCase())}.`

  return {
    value,
    display: scoreDisplay(value),
    rank: map.oracleScore.rank,
    universe: map.oracleScore.universe,
    rankLabel,
    outcomeLabel,
    comparisonLabel,
    explanation,
    tone: scoreTone(value),
  }
}
