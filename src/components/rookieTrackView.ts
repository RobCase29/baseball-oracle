import type { PlayerRecord } from '../domain/forecast'

function numericOpportunity(player: PlayerRecord): number | null {
  const value = player.recentCallup?.currentMlbEvidence.opportunity?.value
  if (!value) return null
  const parsed = Number.parseFloat(value.replaceAll(',', ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function rookieEvidenceLabel(player: PlayerRecord): string {
  const opportunity = player.recentCallup?.currentMlbEvidence.opportunity
  const value = numericOpportunity(player)
  if (!opportunity || value === null) return 'Just arrived'
  if (opportunity.label === 'PA') {
    if (value < 50) return 'Just arrived'
    if (value < 150) return 'Early read'
    if (value < 300) return 'Building evidence'
    return 'Substantial sample'
  }
  if (opportunity.label === 'IP') {
    if (value < 10) return 'Just arrived'
    if (value < 30) return 'Early read'
    if (value < 60) return 'Building evidence'
    return 'Substantial sample'
  }
  return 'Early read'
}

export function rookieEvidenceProgress(player: PlayerRecord): number | null {
  const opportunity = player.recentCallup?.currentMlbEvidence.opportunity
  const value = numericOpportunity(player)
  if (!opportunity || value === null) return null
  const substantialSample = opportunity.label === 'PA'
    ? 300
    : opportunity.label === 'IP'
      ? 60
      : null
  if (substantialSample === null) return null
  return Math.min(100, Math.round(100 * value / substantialSample))
}

export function rookieMlbReadLabel(player: PlayerRecord): string {
  const percentile = player.recentCallup?.currentMlbEvidence.warPercentile ?? null
  const opportunity = numericOpportunity(player)
  if (percentile === null || opportunity === null || rookieEvidenceLabel(player) === 'Just arrived') {
    return 'Too soon'
  }
  if (percentile >= 75) return 'Strong MLB start'
  if (percentile >= 55) return 'Solid MLB start'
  if (percentile >= 35) return 'Mixed MLB start'
  return 'Slow MLB start'
}

export function formatRookieWar(player: PlayerRecord): string {
  const war = player.recentCallup?.currentMlbEvidence.war ?? null
  return war === null ? 'WAR unavailable' : `${war.toFixed(1)} WAR`
}

export function formatRookieWarPercentile(player: PlayerRecord): string {
  const percentile = player.recentCallup?.currentMlbEvidence.warPercentile ?? null
  return percentile === null ? 'Percentile unavailable' : `P${Math.round(percentile)}`
}
