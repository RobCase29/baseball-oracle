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
  if (!hitting || [hitting.ba, hitting.obp, hitting.slg].every((value) => value === null)) {
    return null
  }
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
  const stats = player.currentMinorStats
  const slash = currentMinorSlashLine(player)
  if (stats?.hitting && slash) {
    return {
      label: slash,
      detail: `${stats.season} · ${stats.opportunity.value} ${stats.opportunity.label}${stats.currentLevel ? ` at ${stats.currentLevel}` : ''}`,
    }
  }
  if (stats?.pitching && (stats.pitching.era !== null || stats.pitching.whip !== null)) {
    return {
      label: `${decimal(stats.pitching.era, 2)} ERA · ${decimal(stats.pitching.whip, 2)} WHIP`,
      detail: `${stats.season} · ${stats.opportunity.value} ${stats.opportunity.label}${stats.currentLevel ? ` at ${stats.currentLevel}` : ''}`,
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
