import type { PlayerRecord, PlayerType } from '../domain/forecast'
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
  oraclePercentile: number
  oracleRank: number
  oracleUniverse: number
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

function resolveTier(player: PlayerRecord): OpportunityTier {
  const oraclePercentile = playerMapFor(player).oracleScore.value ?? 0
  const arrival = player.milbAlphaSignal

  if (!arrival?.eligible || oraclePercentile < 90) return 'context'
  if (arrival.tier === 'priority' && oraclePercentile >= 99) return 'priority'
  if (oraclePercentile >= 95) return 'strong'
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

export function buildMilbOpportunityPoints(players: PlayerRecord[]): MilbOpportunityPoint[] {
  return players.flatMap((player) => {
    if (player.stage !== 'pre_debut') return []

    const oracle = playerMapFor(player).oracleScore
    const ageContext = player.milbAlphaSignal?.ageContext
    if (
      oracle.rank === null ||
      oracle.universe === null ||
      !validPercentile(oracle.value)
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
      oraclePercentile: oracle.value,
      oracleRank: oracle.rank,
      oracleUniverse: oracle.universe,
      arrivalGateCleared: player.milbAlphaSignal?.eligible === true,
      playerType: player.playerType,
      traitCorroborated: traitEvidence?.corroboration?.passesAllDescriptiveGates === true,
      tier: resolveTier(player),
    }]
  }).sort((left, right) => {
    const oracleDifference = left.oracleRank - right.oracleRank
    if (oracleDifference !== 0) return oracleDifference
    return left.name.localeCompare(right.name)
  })
}

export function buildMilbEvidenceRows(player: PlayerRecord): MilbEvidenceRow[] {
  if (player.stage !== 'pre_debut') return []

  const rows: MilbEvidenceRow[] = []
  const oracle = playerMapFor(player).oracleScore
  if (
    oracle.rank !== null &&
    oracle.universe !== null &&
    validPercentile(oracle.value)
  ) {
    rows.push({
      id: 'career-ceiling-rank',
      label: 'Career ceiling',
      value: oracle.value,
      kind: 'model_rank',
      detail: `#${oracle.rank.toLocaleString()} of ${oracle.universe.toLocaleString()} in the runway-adjusted prospect career ranking`,
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
