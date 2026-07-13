import type { PlayerRecord } from '../domain/forecast'
import {
  buildPlayerMap,
  CAREER_INDEX_VERSION,
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
  label: 'Career Index' | 'Ceiling if MLB' | 'Frozen ceiling if MLB'
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

export interface ProspectScoreView {
  value: number | null
  display: string
  label: 'Prospect Score'
  rank: number | null
  universe: number | null
  rankLabel: string
  targetLabel: string
  explanation: string
  tone: CareerIndexView['tone']
  status: 'research' | 'withheld'
}

const plainStateLabels: Record<PlayerMapState, string> = {
  conviction: 'Strong model signal',
  discovery: 'Strong five-year impact, more proof needed',
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

function prospectScoreDisplay(value: number | null): string {
  if (value === null) return '--'
  if (value === 100) return '100'
  return value >= 99 ? value.toFixed(2) : value.toFixed(1)
}

function prospectScoreTone(value: number | null): CareerIndexView['tone'] {
  if (value === null) return 'unavailable'
  if (value >= 99) return 'elite'
  if (value >= 90) return 'high'
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
    careerIndex: existing.careerIndex?.version === CAREER_INDEX_VERSION
      ? existing.careerIndex
      : rebuilt.careerIndex,
    stageStanding: existing.stageStanding ?? rebuilt.stageStanding,
    careerIndexComparableAcrossRoutes: true,
    stageStandingComparableWithinStageOnly: true,
  }
}

export function plainPlayerState(state: PlayerMapState): string {
  return plainStateLabels[state]
}

export function prospectScoreFor(
  player: PlayerRecord,
  map: PlayerMapProfile = playerMapFor(player),
): ProspectScoreView {
  const score = map.route === 'milb' ? map.scores.outcome : null
  const value = score?.scale === 'ordinal_percentile' ? score.value : null
  const rank = score?.rank ?? null
  const universe = score?.universe ?? null
  const priorLed = map.route === 'milb' && map.mappingStatus === 'insufficient_sample' && value !== null
  const rankLabel = rank === null
    ? 'Prospect rank unavailable'
    : universe === null
      ? `#${rank.toLocaleString()} prospect`
      : `#${rank.toLocaleString()} of ${universe.toLocaleString()} prospects`

  return {
    value,
    display: prospectScoreDisplay(value),
    label: 'Prospect Score',
    rank,
    universe,
    rankLabel,
    targetLabel: 'At least 5 MLB WAR during 2026-2030',
    explanation: value === null
      ? 'There is not enough supported model data to calculate a Prospect Score yet.'
      : priorLed
        ? `${player.name}'s Prospect Score is prior-led because the frozen full-model sample was thin. It uses the transparent age, level, role, and performance prior; Career Index separately reflects age-adjusted career runway.`
        : `${player.name}'s Prospect Score is an individualized rank built from age, level, role, and performance for reaching at least 5 MLB WAR during 2026-2030. It is a research ranking, not a probability.${player.level === 'Rk' ? ' Rookie-level calibration is thin, so treat this score as an early signal.' : ''}`,
    tone: prospectScoreTone(value),
    status: score?.status === 'research' ? 'research' : 'withheld',
  }
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
      ? 'Career ceiling if MLB is reached'
      : 'Projected career magnitude'
  const explanation = value === null
    ? 'There is not enough matched model data to calculate a Career Index yet.'
    : isRookieTrack
      ? `A frozen Career Index of ${indexDisplay(value)} preserves ${player.name}'s pre-debut, conditional-on-arrival career outlook while MLB evidence accumulates separately.`
      : map.route === 'milb'
        ? `A Career Index of ${indexDisplay(value)} summarizes ${player.name}'s modeled career magnitude if he reaches MLB. Arrival confidence is shown separately.`
        : `A Career Index of ${indexDisplay(value)} summarizes ${player.name}'s modeled career magnitude from the middle, strong, and high career-WAR cases on one fixed historical scale.`

  return {
    value,
    display: indexDisplay(value),
    label: isRookieTrack
      ? 'Frozen ceiling if MLB'
      : map.route === 'milb'
        ? 'Ceiling if MLB'
        : 'Career Index',
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
