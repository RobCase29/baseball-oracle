import type { PlayerRecord } from '../domain/forecast'

export interface CurrentMinorDisplay {
  label: string
  detail: string
}

function decimal(value: number | null, digits = 3): string {
  if (value === null) return '--'
  return value.toFixed(digits).replace(/^0(?=\.)/u, '')
}

export function currentMinorSlashLine(player: PlayerRecord): string | null {
  const hitting = player.currentMinorStats?.hitting
  if (!hitting) return null
  return `${decimal(hitting.ba)}/${decimal(hitting.obp)}/${decimal(hitting.slg)}`
}

export function bestCurrentScoutingGrade(player: PlayerRecord): {
  label: string
  value: number
} | null {
  const grades = player.currentProspectScouting?.grades ?? []
  return grades
    .map((grade) => ({ label: grade.label, value: grade.future ?? grade.present }))
    .filter((grade): grade is { label: string; value: number } => grade.value !== null)
    .toSorted((left, right) => right.value - left.value || left.label.localeCompare(right.label))[0] ?? null
}

export function currentMinorSignal(player: PlayerRecord): CurrentMinorDisplay | null {
  const scouting = player.currentProspectScouting
  if (scouting) {
    const label = scouting.organizationRank !== null
      ? `Org #${scouting.organizationRank}${scouting.futureValue ? ` · ${scouting.futureValue} grade` : ''}`
      : scouting.overallRank !== null
        ? `Overall #${scouting.overallRank}${scouting.futureValue ? ` · ${scouting.futureValue} grade` : ''}`
        : scouting.futureValue
          ? `${scouting.futureValue} scouting grade`
          : 'Current scouting available'
    return { label, detail: `FanGraphs ${scouting.reportSeason} scouting` }
  }

  const stats = player.currentMinorStats
  const slash = currentMinorSlashLine(player)
  if (stats?.hitting && slash) {
    return { label: slash, detail: `Official ${stats.season} performance` }
  }
  if (stats?.pitching) {
    return {
      label: `${decimal(stats.pitching.era, 2)} ERA · ${decimal(stats.pitching.whip, 2)} WHIP`,
      detail: `Official ${stats.season} performance`,
    }
  }
  return null
}

export function currentMinorEvidence(player: PlayerRecord): CurrentMinorDisplay | null {
  const stats = player.currentMinorStats
  if (!stats) return null
  const levels = stats.levelsObserved.join(' / ')
  return {
    label: `${stats.opportunity.value} ${stats.opportunity.label}${levels ? ` · ${levels}` : ''}`,
    detail: `Official ${stats.season} season totals`,
  }
}
