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
import { currentMinorEvidence, currentMinorSignal } from './currentMinorView'
import {
  formatRookieWar,
  rookieEvidenceLabel,
  rookieMlbReadLabel,
} from './rookieTrackView'

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

export type RouteRankLabel = 'Prospect Rank' | 'Pre-Debut Rank' | 'MLB Career Rank'

export interface RouteRankView {
  rank: number | null
  universe: number | null
  display: string
  label: RouteRankLabel
  routeLabel: 'Prospect' | 'Pre-debut' | 'MLB career'
  rankLabel: string
  tableDetail: string
  topLabel: string | null
  cohortLabel: string
  evidenceLabel: 'Full model' | 'Early estimate' | 'Career model' | 'Data gap'
  explanation: string
  tone: CareerIndexView['tone']
}

export interface CareerOutlookView {
  value: number | null
  display: string
  band: string
  basis: string
  explanation: string
  tone: CareerIndexView['tone']
}

export interface CurrentResultsView {
  headline: string
  detail: string
  tone: 'positive' | 'standard' | 'unavailable'
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

function rankTone(rank: number | null, universe: number | null): CareerIndexView['tone'] {
  if (rank === null || universe === null || universe < 1) return 'unavailable'
  const topPercent = 100 * rank / universe
  if (topPercent <= 1) return 'elite'
  if (topPercent <= 10) return 'high'
  return 'standard'
}

function careerOutlookBand(value: number | null): string {
  if (value === null) return 'Not available'
  if (value >= 92) return 'Historic ceiling'
  if (value >= 80) return 'Hall-level upside'
  if (value >= 65) return 'Star upside'
  if (value >= 45) return 'MLB regular'
  if (value >= 20) return 'MLB contributor'
  if (value > 0) return 'Limited MLB value'
  return 'No positive projection'
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

export function routeRankFor(
  player: PlayerRecord,
  map: PlayerMapProfile = playerMapFor(player),
): RouteRankView {
  const prospectScore = map.route === 'milb' ? prospectScoreFor(player, map) : null
  const rank = map.route === 'milb' ? prospectScore?.rank ?? null : map.stageStanding.rank
  const universe = map.route === 'milb' ? prospectScore?.universe ?? null : map.stageStanding.universe
  const topPercent = rank !== null && universe !== null && universe > 0
    ? 100 * rank / universe
    : null
  const routeLabel = map.route === 'milb'
    ? 'Prospect'
    : map.route === 'rookie'
      ? 'Pre-debut'
      : 'MLB career'
  const label: RouteRankLabel = map.route === 'milb'
    ? 'Prospect Rank'
    : map.route === 'rookie'
      ? 'Pre-Debut Rank'
      : 'MLB Career Rank'
  const cohortLabel = map.route === 'milb'
    ? 'prospects by projected five-year MLB impact'
    : map.route === 'rookie'
      ? 'frozen pre-debut prospect outlooks'
      : 'active MLB career outlooks'
  const rankLabel = rank === null
    ? 'Unavailable'
    : universe === null
      ? `#${rank.toLocaleString()}`
      : `#${rank.toLocaleString()} of ${universe.toLocaleString()}`
  const evidenceLabel = map.route === 'milb'
    ? map.mappingStatus === 'insufficient_sample' ? 'Early estimate' : rank === null ? 'Data gap' : 'Full model'
    : map.route === 'rookie'
      ? player.recentCallup?.prospectPrior?.impactRank?.evidenceTier === 'early_estimate'
        ? 'Early estimate'
        : rank === null ? 'Data gap' : 'Full model'
      : rank === null ? 'Data gap' : 'Career model'
  const tableDetail = rank === null
    ? 'Not enough matched data'
    : map.route === 'milb'
      ? `${universe === null ? 'Prospect comparison' : `of ${universe.toLocaleString()} prospects`}${evidenceLabel === 'Early estimate' ? ' · Early estimate' : ''}`
      : map.route === 'rookie'
        ? `${universe === null ? 'Prospect comparison' : `of ${universe.toLocaleString()} prospects`} · Frozen before MLB debut${evidenceLabel === 'Early estimate' ? ' · Early estimate' : ''}`
        : universe === null
          ? 'Active MLB career comparison'
          : `of ${universe.toLocaleString()} active MLB players`
  const explanation = rank === null
    ? `There is not enough matched model data to calculate ${player.name}'s ${label} yet.`
    : map.route === 'milb'
      ? `${player.name} ranks ${rankLabel} for projected MLB impact over the next five seasons.`
      : map.route === 'rookie'
        ? `${player.name}'s ${rankLabel} pre-debut outlook stays fixed while early MLB results build.`
        : `${player.name} ranks ${rankLabel} among active MLB career outlooks.`

  return {
    rank,
    universe,
    display: rank === null ? '--' : `#${rank.toLocaleString()}`,
    label,
    routeLabel,
    rankLabel,
    tableDetail,
    topLabel: topPercentLabel(topPercent),
    cohortLabel,
    evidenceLabel,
    explanation,
    tone: rankTone(rank, universe),
  }
}

export function careerOutlookFor(
  player: PlayerRecord,
  map: PlayerMapProfile = playerMapFor(player),
): CareerOutlookView {
  const value = map.careerIndex.value
  const basis = map.route === 'milb'
    ? 'If MLB is reached'
    : map.route === 'rookie'
      ? 'Frozen pre-debut outlook'
      : 'Projected full career'
  const display = value === null ? '--' : `${Math.round(value)}/100`
  const band = careerOutlookBand(value)
  return {
    value,
    display,
    band,
    basis,
    explanation: value === null
      ? `There is not enough matched model data to calculate ${player.name}'s Career Outlook yet.`
      : `${player.name}'s ${display} Career Outlook maps the modeled career-WAR range to fixed baseball milestones. It is not a probability or percentile.`,
    tone: indexTone(value),
  }
}

export function currentResultsFor(
  player: PlayerRecord,
  map: PlayerMapProfile = playerMapFor(player),
): CurrentResultsView {
  if (map.route === 'rookie') {
    const opportunity = player.recentCallup?.currentMlbEvidence.opportunity
    const evidence = rookieEvidenceLabel(player)
    const war = formatRookieWar(player)
    return {
      headline: rookieMlbReadLabel(player),
      detail: `${war}${opportunity ? ` · ${opportunity.value} ${opportunity.label}` : ''} · ${evidence}`,
      tone: player.recentCallup?.currentMlbEvidence.war === null ? 'unavailable' : 'standard',
    }
  }

  if (map.route === 'milb') {
    const results = currentMinorSignal(player)
    const evidence = currentMinorEvidence(player)
    return {
      headline: results?.label ?? 'Results pending',
      detail: results
        ? player.currentMinorStats
          ? results.detail
          : `${results.detail}${evidence ? ` · ${evidence.label}` : ''}`
        : 'Current minor-league statistics are not available yet.',
      tone: results ? 'standard' : 'unavailable',
    }
  }

  const currentWar = player.metrics.find((metric) => metric.key === 'current-season-war')
  const opportunity = player.opportunity
  return {
    headline: currentWar?.value ?? 'Results pending',
    detail: currentWar
      ? `${player.provenance.season ?? 'Current season'}${opportunity ? ` · ${opportunity.value} ${opportunity.label}` : ''}`
      : 'Current MLB results are not available yet.',
    tone: currentWar ? 'standard' : 'unavailable',
  }
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
