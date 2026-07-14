import type { PlayerMapFeedItem, PlayerRecord, PlayerType } from '../domain/forecast'
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
  ageCohort: string | null
  ageReferencePlayers: number | null
  evidenceCoverage: number
  coveredPillars: number
  totalPillars: number
  missingPillars: string[]
  sampleState: 'unavailable' | 'insufficient' | 'provisional' | 'sufficient'
  sampleSummary: string
  prospectScore: number
  prospectRank: number
  prospectUniverse: number
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

export type CareerIndexChartScale = 'focus' | 'full'

function resolveTier(prospectScore: number): OpportunityTier {
  if (prospectScore >= 99) return 'priority'
  if (prospectScore >= 95) return 'strong'
  if (prospectScore >= 90) return 'watch'
  return 'context'
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
  scale: CareerIndexChartScale = 'focus',
): CareerIndexChartDomain {
  if (scale === 'full' || points.length === 0) {
    return { minimum: 0, maximum: 100, ticks: careerIndexAxisAnchors }
  }

  const values = points.map((point) => point.careerIndex)
  const dataMinimum = Math.min(...values)
  const dataMaximum = Math.max(...values)
  const spread = dataMaximum - dataMinimum
  const padding = spread < 1 ? 4 : Math.max(1, spread * 0.14)
  const rawMinimum = Math.max(0, dataMinimum - padding)
  const rawMaximum = Math.min(100, dataMaximum + padding)
  const targetStep = Math.max(1, (rawMaximum - rawMinimum) / 4)
  const step = [1, 2, 5, 10, 20, 25].find((candidate) => candidate >= targetStep) ?? 25
  let minimum = Math.max(0, Math.floor(rawMinimum / step) * step)
  let maximum = Math.min(100, Math.ceil(rawMaximum / step) * step)

  if (maximum === minimum) {
    minimum = Math.max(0, minimum - step)
    maximum = Math.min(100, maximum + step)
  }

  const ticks = Array.from(
    { length: Math.floor((maximum - minimum) / step) + 1 },
    (_, index) => minimum + index * step,
  )
  return { minimum, maximum, ticks }
}

export function buildMilbOpportunityPoints(players: PlayerRecord[]): MilbOpportunityPoint[] {
  return players.flatMap((player) => {
    if (player.stage !== 'pre_debut') return []

    const map = playerMapFor(player)
    const careerIndex = map.careerIndex.value
    const prospectScore = map.scores.outcome
    const standing = map.stageStanding
    const ageContext = player.milbAlphaSignal?.ageContext
    if (
      !validPercentile(careerIndex) ||
      !validPercentile(prospectScore.value) ||
      prospectScore.rank === null ||
      prospectScore.universe === null ||
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
      level: player.level ?? 'Level unavailable',
      age: player.age,
      ageAdvantage: validPercentile(map.scores.trajectory.value)
        ? map.scores.trajectory.value
        : null,
      ageCohort: validPercentile(player.agePercentile)
        ? player.level
        : ageContext?.priorLevel ?? player.level ?? null,
      ageReferencePlayers: validPercentile(player.agePercentile)
        ? null
        : validNonNegative(ageContext?.referencePlayers)
        ? ageContext.referencePlayers
        : null,
      evidenceCoverage,
      coveredPillars,
      totalPillars,
      missingPillars: traitEvidence?.coverage.missingPillars ?? [],
      sampleState: traitEvidence?.opportunity.state ?? 'unavailable',
      sampleSummary: sampleSummary(player),
      prospectScore: prospectScore.value,
      prospectRank: prospectScore.rank,
      prospectUniverse: prospectScore.universe,
      careerIndex,
      stageRank: standing.rank,
      stageUniverse: standing.universe,
      stageTopPercent: standing.topPercent,
      stageTailBand: standing.tailBand,
      arrivalGateCleared: player.milbAlphaSignal?.eligible === true,
      playerType: player.playerType,
      traitCorroborated: traitEvidence?.corroboration?.passesAllDescriptiveGates === true,
      tier: resolveTier(prospectScore.value),
    }]
  }).sort((left, right) => {
    const scoreDifference = left.prospectRank - right.prospectRank
    if (scoreDifference !== 0) return scoreDifference
    return left.name.localeCompare(right.name)
  })
}

function feedSampleState(basis: string): MilbOpportunityPoint['sampleState'] {
  const normalized = basis.toLocaleLowerCase('en-US')
  if (normalized.includes('sufficient opportunity')) return 'sufficient'
  if (normalized.includes('provisional opportunity')) return 'provisional'
  if (normalized.includes('insufficient opportunity')) return 'insufficient'
  return 'unavailable'
}

function feedSampleSummary(state: MilbOpportunityPoint['sampleState']): string {
  if (state === 'sufficient') return 'Playing-time sample established'
  if (state === 'provisional') return 'Playing-time sample building'
  if (state === 'insufficient') return 'Limited playing-time sample'
  return 'Current sample unavailable'
}

export function buildMilbOpportunityPointsFromFeed(
  items: PlayerMapFeedItem[],
): MilbOpportunityPoint[] {
  return items.flatMap((item) => {
    const { assessment, context } = item
    if (context.stage !== 'pre_debut' || assessment.route !== 'milb') return []

    const careerIndex = assessment.careerIndex.value
    const prospectScore = assessment.scores.outcome
    const standing = assessment.stageStanding
    if (
      !validPercentile(careerIndex) ||
      !validPercentile(prospectScore.value) ||
      prospectScore.rank === null ||
      prospectScore.universe === null ||
      standing.rank === null ||
      standing.universe === null ||
      standing.topPercent === null ||
      standing.tailBand === null
    ) return []

    const trajectory = assessment.scores.trajectory
    const evidence = assessment.scores.evidence
    const ageAdvantage = validPercentile(trajectory.value) ? trajectory.value : null
    const totalPillars = validNonNegative(evidence.universe) ? evidence.universe : 0
    const evidenceCoverage = validPercentile(evidence.value) ? evidence.value : 0
    const coveredPillars = totalPillars > 0
      ? Math.min(totalPillars, Math.round(totalPillars * evidenceCoverage / 100))
      : 0
    const sampleState = feedSampleState(evidence.basis)
    const arrivalGateCleared = assessment.signals.some((signal) => signal.code === 'dual_confirmed')

    return [{
      playerId: item.playerId,
      name: item.identity.name,
      organization: context.organizationCode ?? context.organization ?? 'Organization unavailable',
      position: context.position ?? context.playerType,
      level: context.level ?? 'Level unavailable',
      age: context.age,
      ageAdvantage,
      ageCohort: context.level,
      ageReferencePlayers: validNonNegative(trajectory.universe) ? trajectory.universe : null,
      evidenceCoverage,
      coveredPillars,
      totalPillars,
      missingPillars: assessment.missingEvidence,
      sampleState,
      sampleSummary: feedSampleSummary(sampleState),
      prospectScore: prospectScore.value,
      prospectRank: prospectScore.rank,
      prospectUniverse: prospectScore.universe,
      careerIndex,
      stageRank: standing.rank,
      stageUniverse: standing.universe,
      stageTopPercent: standing.topPercent,
      stageTailBand: standing.tailBand,
      arrivalGateCleared,
      playerType: context.playerType,
      traitCorroborated: assessment.signals.some((signal) => signal.code === 'trait_corroborated'),
      tier: resolveTier(prospectScore.value),
    }]
  }).sort((left, right) => {
    const scoreDifference = left.prospectRank - right.prospectRank
    if (scoreDifference !== 0) return scoreDifference
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
  const map = playerMapFor(player)
  const impactScore = map.scores.outcome
  if (
    impactScore.rank !== null &&
    impactScore.universe !== null &&
    validPercentile(impactScore.value)
  ) {
    rows.push({
      id: 'impact-rank',
      label: 'Prospect Rank',
      value: impactScore.value,
      kind: 'model_rank',
      detail: `#${impactScore.rank.toLocaleString()} of ${impactScore.universe.toLocaleString()} for reaching at least 5 MLB WAR during 2026-2030`,
    })
  }
  const standing = map.stageStanding
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
      label: 'Career forecast standing',
      value: standingPercentile,
      kind: 'model_rank',
      detail: `#${standing.rank.toLocaleString()} of ${standing.universe.toLocaleString()} · ${standing.tailBand ?? 'stage band unavailable'} in frozen prospect forecasts`,
    })
  }
  const ageContext = player.milbAlphaSignal?.ageContext
  const liveAgePercentile = validPercentile(player.agePercentile) ? player.agePercentile : null
  if (liveAgePercentile !== null || (ageContext && validPercentile(ageContext.youngerThanPercent))) {
    const value = liveAgePercentile ?? ageContext!.youngerThanPercent
    rows.push({
      id: 'age-context',
      label: 'Age advantage',
      value,
      kind: 'age_context',
      detail: liveAgePercentile !== null
        ? `Current live age advantage at ${player.level ?? 'the observed level'}`
        : `Younger than ${ageContext!.youngerThanPercent.toFixed(0)}% of ${ageContext!.referencePlayers.toLocaleString()} historical ${ageContext!.role}s at ${ageContext!.priorLevel}`,
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
