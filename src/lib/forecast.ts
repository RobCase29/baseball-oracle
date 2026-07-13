import type {
  AlphaSignal,
  BoardFilters,
  PlayerRecord,
  PlayerStage,
  StageFilter,
} from '../domain/forecast'

function compareNullableNumber(
  left: number | null,
  right: number | null,
  direction: 'ascending' | 'descending',
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return direction === 'ascending' ? left - right : right - left
}

export function isMlbStage(stage: PlayerStage): boolean {
  return stage === 'early_mlb' || stage === 'established_mlb'
}

export function matchesStageFilter(stage: PlayerStage, filter: StageFilter): boolean {
  if (filter === 'All') return stage !== 'inactive'
  if (filter === 'Minors') return stage === 'pre_debut'
  return isMlbStage(stage)
}

export function stageCoverageForPlayers(players: PlayerRecord[]): { minors: number; mlb: number } {
  return {
    minors: players.filter((player) => player.stage === 'pre_debut').length,
    mlb: players.filter((player) => isMlbStage(player.stage)).length,
  }
}

export function stageLabel(stage: PlayerStage): string {
  if (stage === 'pre_debut') return 'Minor leagues'
  if (stage === 'early_mlb') return 'Early MLB'
  if (stage === 'established_mlb') return 'Established MLB'
  return 'Inactive'
}

export function arrivalProbability36(player: PlayerRecord): number | null {
  if (player.careerForecast && player.careerForecast.arrivalProbability36 !== null) {
    return player.careerForecast.arrivalProbability36
  }

  return player.researchEstimate?.horizons.find((horizon) => horizon.months === 36)
    ?.probability ?? null
}

export function developmentChapterLabel(level: string | null): string {
  if (level === 'AAA' || level === 'AA') return 'Upper-minors development'
  if (level === 'A+' || level === 'A') return 'Full-season development'
  if (level === 'Rk') return 'Rookie-ball development'
  return 'Minor-league development'
}

export function nearTermImpactProbability(player: PlayerRecord): number | null {
  if (!isMlbStage(player.stage)) return arrivalProbability36(player)
  const chapter = player.careerForecast?.careerChapter
  if (!chapter || chapter.status === 'withheld') return null
  const probability = chapter.exceptionalTrajectory?.probability ?? null
  return probability !== null && Number.isFinite(probability) ? probability : null
}

export function eligibleAlphaSignal(player: PlayerRecord): AlphaSignal | null {
  if (!isMlbStage(player.stage)) return null
  const signal = player.careerForecast?.alphaSignal
  if (!signal || signal.status !== 'research' || !signal.eligible || !signal.edge) return null
  return signal
}

export function alphaOpportunityEdge(player: PlayerRecord): number | null {
  return eligibleAlphaSignal(player)?.edge?.probabilityDelta ?? null
}

export function filterAndSortPlayers(
  players: PlayerRecord[],
  filters: BoardFilters,
): PlayerRecord[] {
  const query = filters.query.trim().toLocaleLowerCase()

  const filtered = players.filter((player) => {
      const matchesQuery =
        query.length === 0 ||
        [
          player.name,
          player.organization,
          player.organizationCode,
          player.position,
        ].some((value) => value?.toLocaleLowerCase().includes(query))
      const matchesStage = matchesStageFilter(player.stage, filters.stage)
      const matchesType =
        filters.playerType === 'All' || player.playerType === filters.playerType
      const matchesLevel = filters.level === 'All' || player.level === filters.level

      return matchesQuery && matchesStage && matchesType && matchesLevel
    })
  const sortPlayers = (items: PlayerRecord[]) => items.toSorted((left, right) => {
      if (filters.sort === 'name') return left.name.localeCompare(right.name)
      if (filters.sort === 'age') {
        return compareNullableNumber(left.age, right.age, 'ascending') || left.id.localeCompare(right.id)
      }
      if (filters.sort === 'arrival36') {
        return (
          compareNullableNumber(arrivalProbability36(left), arrivalProbability36(right), 'descending') ||
          left.id.localeCompare(right.id)
        )
      }
      if (filters.sort === 'nearTermImpact') {
        return (
          compareNullableNumber(
            nearTermImpactProbability(left),
            nearTermImpactProbability(right),
            'descending',
          ) ||
          compareNullableNumber(
            left.careerForecast?.hofCaliberProbability ?? null,
            right.careerForecast?.hofCaliberProbability ?? null,
            'descending',
          ) ||
          left.id.localeCompare(right.id)
        )
      }
      if (filters.sort === 'alphaOpportunity') {
        return (
          compareNullableNumber(
            alphaOpportunityEdge(left),
            alphaOpportunityEdge(right),
            'descending',
          ) ||
          compareNullableNumber(
            nearTermImpactProbability(left),
            nearTermImpactProbability(right),
            'descending',
          ) ||
          compareNullableNumber(left.age, right.age, 'ascending') ||
          left.id.localeCompare(right.id)
        )
      }
      if (filters.sort === 'finalWar') {
        return (
          compareNullableNumber(
            left.careerForecast?.finalCareerWar?.p50 ?? null,
            right.careerForecast?.finalCareerWar?.p50 ?? null,
            'descending',
          ) || left.id.localeCompare(right.id)
        )
      }

      return (
        compareNullableNumber(
          left.careerForecast?.hofCaliberProbability ?? null,
          right.careerForecast?.hofCaliberProbability ?? null,
          'descending',
        ) ||
        compareNullableNumber(
          left.careerForecast?.finalCareerWar?.p50 ?? null,
          right.careerForecast?.finalCareerWar?.p50 ?? null,
          'descending',
        ) ||
        left.id.localeCompare(right.id)
      )
    })

  if (filters.stage !== 'All' || filters.sort === 'age' || filters.sort === 'name') {
    return sortPlayers(filtered)
  }
  const sourceOrder = filters.sort === 'arrival36'
    ? (['minor', 'mlb'] as const)
    : (['mlb', 'minor'] as const)
  return sourceOrder.flatMap((source) => sortPlayers(filtered.filter((player) =>
    source === 'mlb' ? isMlbStage(player.stage) : player.stage === 'pre_debut',
  )))
}

export function formatProbability(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 1) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export function formatWar(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

export function formatSigned(value: number, suffix = ''): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}${suffix}`
}

export function formatPercentagePointDelta(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const percentagePoints = value * 100
  const sign = percentagePoints > 0 ? '+' : ''
  return `${sign}${percentagePoints.toFixed(1)} pp`
}

export function probabilityTone(value: number): 'strong' | 'medium' | 'soft' {
  if (value >= 20) return 'strong'
  if (value >= 5) return 'medium'
  return 'soft'
}

export function formatOrdinal(value: number): string {
  const rounded = Math.round(value)
  const lastTwoDigits = rounded % 100
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return `${rounded}th`

  const suffix = rounded % 10 === 1 ? 'st' : rounded % 10 === 2 ? 'nd' : rounded % 10 === 3 ? 'rd' : 'th'
  return `${rounded}${suffix}`
}

export function formatPercentileRank(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 100) return '—'
  return `P${value.toFixed(1)}`
}

export function formatScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}
