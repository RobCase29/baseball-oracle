import type { PlayerRecord } from '../domain/forecast'
import {
  buildPlayerMap,
  FROZEN_PROSPECT_FORECAST_UNIVERSE,
  PLAYER_MAP_VERSION,
  type PlayerMapCareerIndex,
  type PlayerMapOracleScore,
  type PlayerMapProfile,
  type PlayerMapStageStanding,
  type PlayerMapState,
} from '../domain/playerMap'

export interface CareerIndexView {
  value: number | null
  display: string
  label: 'Career Index' | 'Frozen prospect Career Index'
  rank: number | null
  universe: number | null
  rankLabel: string
  topLabel: string | null
  tailBand: PlayerMapStageStanding['tailBand']
  cohortLabel: string
  outcomeLabel: string
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

function indexDisplay(value: number | null): string {
  if (value === null) return '--'
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)
}

function roundedOracleValue(value: number | null): number | null {
  if (value === null) return null
  return value >= 99 ? Math.round(value * 10) / 10 : Math.round(value)
}

function indexTone(value: number | null): CareerIndexView['tone'] {
  if (value === null) return 'unavailable'
  if (value >= 80) return 'elite'
  if (value >= 55) return 'high'
  return 'standard'
}

function topPercentLabel(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  const digits = value < 1 ? 2 : value < 10 ? 1 : 0
  const factor = 10 ** digits
  const conservativeValue = Math.ceil(value * factor) / factor
  return `Top ${conservativeValue.toFixed(digits)}%`
}

function cohortLabel(standing: PlayerMapStageStanding): string {
  if (standing.cohort === 'current_mlb') return 'active MLB projections'
  return standing.cohort === 'frozen_prospect_prior'
    ? 'frozen prospect priors'
    : 'frozen prospect forecasts'
}

interface LegacyPlayerMapProfile extends Omit<
  PlayerMapProfile,
  'version' | 'oracleScore' | 'careerIndex' | 'stageStanding'
> {
  version?: string
  oracleScore?: PlayerMapOracleScore
  careerIndex?: PlayerMapCareerIndex
  stageStanding?: PlayerMapStageStanding
}

export function playerMapFor(player: PlayerRecord): PlayerMapProfile {
  const existing = player.playerMap as LegacyPlayerMapProfile | null | undefined
  if (!existing) return buildPlayerMap(player)
  if (
    existing.version === PLAYER_MAP_VERSION &&
    existing.oracleScore &&
    existing.careerIndex &&
    existing.stageStanding
  ) {
    return existing as PlayerMapProfile
  }

  const outcome = existing.scores.outcome
  const oracleScore = existing.oracleScore ?? {
    deprecated: true as const,
    replacement: 'careerIndex' as const,
    value: roundedOracleValue(outcome.value),
    scale: 'stage_rank_percentile' as const,
    route: existing.route,
    rank: outcome.rank,
    universe: outcome.universe,
    target: outcome.target,
    asOf: outcome.asOf,
    definition: 'Rounded stage-specific modeled outcome rank percentile; not a probability or composite score' as const,
  }
  const rawArtifactRank = (
    player.careerForecast?.lineage as { artifactRank?: unknown } | undefined
  )?.artifactRank
  const artifactRank = typeof rawArtifactRank === 'number' &&
    Number.isInteger(rawArtifactRank) &&
    rawArtifactRank >= 1 &&
    rawArtifactRank <= FROZEN_PROSPECT_FORECAST_UNIVERSE
    ? rawArtifactRank
    : null
  const hydrationPlayer = player.stage === 'pre_debut' && player.careerForecast && artifactRank !== null
    ? {
        ...player,
        careerForecast: { ...player.careerForecast, rank: artifactRank },
      }
    : player
  const rebuilt = buildPlayerMap(hydrationPlayer)
  const {
    comparableWithinStageOnly: legacyComparability,
    ...existingFields
  } = existing as LegacyPlayerMapProfile & { comparableWithinStageOnly?: true }
  void legacyComparability

  return {
    ...rebuilt,
    ...existingFields,
    version: PLAYER_MAP_VERSION,
    mappingStatus: rebuilt.mappingStatus,
    claimStatus: rebuilt.claimStatus,
    oracleScore,
    careerIndex: existing.careerIndex ?? rebuilt.careerIndex,
    stageStanding: existing.stageStanding ?? rebuilt.stageStanding,
    careerIndexComparableAcrossRoutes: true,
    stageStandingComparableWithinStageOnly: true,
  }
}

export function plainPlayerState(state: PlayerMapState): string {
  return plainStateLabels[state]
}

export function careerIndexFor(
  player: PlayerRecord,
  map: PlayerMapProfile = playerMapFor(player),
): CareerIndexView {
  const value = map.careerIndex.value
  const standing = map.stageStanding
  const isRookieTrack = map.route === 'rookie'
  const comparisonLabel = cohortLabel(standing)
  const topLabel = topPercentLabel(standing.topPercent)
  const rankLabel = standing.rank === null
    ? 'Stage standing unavailable'
    : standing.universe === null
      ? `#${standing.rank.toLocaleString()} at this stage`
      : `#${standing.rank.toLocaleString()} of ${standing.universe.toLocaleString()}`
  const outcomeLabel = isRookieTrack
    ? 'Prospect outlook carried into MLB'
    : map.route === 'milb'
      ? 'Projected career outlook'
      : 'Projected career magnitude'
  const explanation = value === null
    ? 'There is not enough matched model data to calculate a Career Index yet.'
    : isRookieTrack
      ? `A frozen Career Index of ${indexDisplay(value)} preserves ${player.name}'s pre-debut career outlook while MLB evidence accumulates separately.`
      : `A Career Index of ${indexDisplay(value)} summarizes ${player.name}'s modeled career magnitude from the middle, strong, and high career-WAR cases on one fixed historical scale.`

  return {
    value,
    display: indexDisplay(value),
    label: isRookieTrack ? 'Frozen prospect Career Index' : 'Career Index',
    rank: standing.rank,
    universe: standing.universe,
    rankLabel,
    topLabel,
    tailBand: standing.tailBand,
    cohortLabel: comparisonLabel,
    outcomeLabel,
    explanation,
    tone: indexTone(value),
  }
}
