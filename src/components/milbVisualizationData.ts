import type { PlayerRecord, PlayerType } from '../domain/forecast'
import {
  CAREER_INDEX_WAR_ANCHORS,
  type PlayerMapStageTailBand,
} from '../domain/playerMap'
import { playerMapFor } from './playerMapView'

export type OpportunityTier = 'priority' | 'strong' | 'watch' | 'context'

export interface MilbOpportunityPoint {
  playerId: string
  name: string
  organization: string
  position: string
  level: string
  age: number | null
  ageAdvantage: number | null
  evidenceCoverage: number
  coveredPillars: number
  totalPillars: number
  missingPillars: string[]
  sampleState: 'unavailable' | 'insufficient' | 'provisional' | 'sufficient'
  sampleSummary: string
  careerIndex: number
  stageRank: number
  stageUniverse: number
  stageTopPercent: number
  stageTailBand: PlayerMapStageTailBand
  arrivalGateCleared: boolean
  playerType: PlayerType
  traitCorroborated: boolean
  tier: OpportunityTier
}

export type EvidenceKind = 'model_rank' | 'age_context' | 'descriptive_trait'

export interface MilbEvidenceRow {
  id: string
  label: string
  value: number
  kind: EvidenceKind
  detail: string
}

export interface CareerIndexChartDomain {
  minimum: number
  maximum: number
  ticks: number[]
}

function resolveTier(player: PlayerRecord): OpportunityTier {
  const topPercent = playerMapFor(player).stageStanding.topPercent
  const arrival = player.milbAlphaSignal

  if (!arrival?.eligible || topPercent === null || topPercent > 10) return 'context'
  if (arrival.tier === 'priority' && topPercent <= 1) return 'priority'
  if (topPercent <= 5) return 'strong'
  return 'watch'
}

function validPercentile(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

function validNonNegative(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function sampleSummary(player: PlayerRecord): string {
  const observed = player.minorTraitEvidence?.opportunity.observed
  if (!observed) return 'Current sample unavailable'

  if (validNonNegative(observed.plateAppearances)) {
    return `${observed.plateAppearances.toLocaleString()} PA`
  }

  const parts: string[] = []
  if (validNonNegative(observed.inningsPitched)) {
    parts.push(`${observed.inningsPitched.toLocaleString(undefined, { maximumFractionDigits: 1 })} IP`)
  }
  if (validNonNegative(observed.pitches)) {
    parts.push(`${observed.pitches.toLocaleString()} pitches`)
  }
  return parts.join(' · ') || 'Current sample unavailable'
}

const careerIndexAxisAnchors = [...new Set(
  CAREER_INDEX_WAR_ANCHORS.map((anchor) => anchor.value),
)].toSorted((left, right) => left - right)

export function careerIndexChartDomain(
  points: Pick<MilbOpportunityPoint, 'careerIndex'>[],
): CareerIndexChartDomain {
  if (points.length === 0) return { minimum: 0, maximum: 100, ticks: careerIndexAxisAnchors }

  const values = points.map((point) => point.careerIndex)
  const dataMinimum = Math.min(...values)
  const dataMaximum = Math.max(...values)
  let minimum = careerIndexAxisAnchors.findLast((anchor) => anchor < dataMinimum) ?? 0
  let maximum = careerIndexAxisAnchors.find((anchor) => anchor > dataMaximum) ?? 100

  if (maximum - minimum < 20) {
    const lower = careerIndexAxisAnchors.findLast((anchor) => anchor < minimum)
    const upper = careerIndexAxisAnchors.find((anchor) => anchor > maximum)
    if (lower !== undefined) minimum = lower
    if (maximum - minimum < 20 && upper !== undefined) maximum = upper
  }

  const ticks = careerIndexAxisAnchors.filter((anchor) => anchor >= minimum && anchor <= maximum)
  return { minimum, maximum, ticks }
}

export function buildMilbOpportunityPoints(players: PlayerRecord[]): MilbOpportunityPoint[] {
  return players.flatMap((player) => {
    if (player.stage !== 'pre_debut') return []

    const map = playerMapFor(player)
    const careerIndex = map.careerIndex.value
    const standing = map.stageStanding
    const ageContext = player.milbAlphaSignal?.ageContext
    if (
      !validPercentile(careerIndex) ||
      standing.rank === null ||
      standing.universe === null ||
      standing.topPercent === null ||
      standing.tailBand === null
    ) return []

    const traitEvidence = player.minorTraitEvidence
    const totalPillars = validNonNegative(traitEvidence?.coverage.totalPillarCount)
      ? traitEvidence.coverage.totalPillarCount
      : 0
    const coveredPillars = totalPillars > 0 && validNonNegative(traitEvidence?.coverage.coveredPillarCount)
      ? Math.min(totalPillars, traitEvidence.coverage.coveredPillarCount)
      : 0
    const evidenceCoverage = totalPillars > 0
      ? coveredPillars / totalPillars * 100
      : 0

    return [{
      playerId: player.id,
      name: player.name,
      organization: player.organizationCode ?? player.organization ?? 'Organization unavailable',
      position: player.position ?? player.playerType,
      level: ageContext?.priorLevel ?? player.level ?? 'Level unavailable',
      age: player.age,
      ageAdvantage: validPercentile(ageContext?.youngerThanPercent)
        ? ageContext.youngerThanPercent
        : null,
      evidenceCoverage,
      coveredPillars,
      totalPillars,
      missingPillars: traitEvidence?.coverage.missingPillars ?? [],
      sampleState: traitEvidence?.opportunity.state ?? 'unavailable',
      sampleSummary: sampleSummary(player),
      careerIndex,
      stageRank: standing.rank,
      stageUniverse: standing.universe,
      stageTopPercent: standing.topPercent,
      stageTailBand: standing.tailBand,
      arrivalGateCleared: player.milbAlphaSignal?.eligible === true,
      playerType: player.playerType,
      traitCorroborated: traitEvidence?.corroboration?.passesAllDescriptiveGates === true,
      tier: resolveTier(player),
    }]
  }).sort((left, right) => {
    const standingDifference = left.stageRank - right.stageRank
    if (standingDifference !== 0) return standingDifference
    return left.name.localeCompare(right.name)
  })
}

function stageStandingPercentile(rank: number, universe: number): number | null {
  if (!Number.isInteger(rank) || !Number.isInteger(universe) || rank < 1 || universe < rank) return null
  if (universe === 1) return 100
  const percentile = 100 * (universe - rank) / (universe - 1)
  return percentile >= 99 ? Math.round(percentile * 10) / 10 : Math.round(percentile)
}

export function buildMilbEvidenceRows(player: PlayerRecord): MilbEvidenceRow[] {
  if (player.stage !== 'pre_debut') return []

  const rows: MilbEvidenceRow[] = []
  const standing = playerMapFor(player).stageStanding
  const standingPercentile = standing.rank === null || standing.universe === null
    ? null
    : stageStandingPercentile(standing.rank, standing.universe)
  if (
    standing.rank !== null &&
    standing.universe !== null &&
    validPercentile(standingPercentile)
  ) {
    rows.push({
      id: 'stage-standing',
      label: 'Stage standing',
      value: standingPercentile,
      kind: 'model_rank',
      detail: `#${standing.rank.toLocaleString()} of ${standing.universe.toLocaleString()} · ${standing.tailBand ?? 'stage band unavailable'} in frozen prospect forecasts`,
    })
  }
  const impact = player.milbImpactRanking
  const impactWorkloadSupported = player.milbAlphaSignal?.gates?.minimumRawWorkload !== false
  if (impact && impactWorkloadSupported && validPercentile(impact.rankPercentile)) {
    rows.push({
      id: 'impact-rank',
      label: '5Y impact rank',
      value: impact.rankPercentile,
      kind: 'model_rank',
      detail: `#${impact.rank.toLocaleString()} of ${impact.universeRows.toLocaleString()} in the direct, unconditional five-year MLB impact ranking`,
    })
  }

  const ageContext = player.milbAlphaSignal?.ageContext
  if (ageContext && validPercentile(ageContext.youngerThanPercent)) {
    rows.push({
      id: 'age-context',
      label: 'Age advantage',
      value: ageContext.youngerThanPercent,
      kind: 'age_context',
      detail: `Younger than ${ageContext.youngerThanPercent.toFixed(0)}% of ${ageContext.referencePlayers.toLocaleString()} historical ${ageContext.role}s at ${ageContext.priorLevel}`,
    })
  }

  const usedMetrics = new Set<string>()
  for (const pillar of player.minorTraitEvidence?.pillars ?? []) {
    const metric = pillar.strongestMetric
    if (!metric || usedMetrics.has(metric.key) || !validPercentile(metric.percentile)) continue
    usedMetrics.add(metric.key)
    rows.push({
      id: `trait-${pillar.key}`,
      label: metric.label,
      value: metric.percentile,
      kind: 'descriptive_trait',
      detail: `${metric.value ?? 'Value unavailable'} · ${pillar.label} pillar · Prospect Savant raw-trait percentile`,
    })
  }

  return rows
}
