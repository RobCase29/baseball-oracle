import type { BoardFilters, PlayerRecord, PublishedForecast } from '../domain/forecast'

export function oracleScore(forecast: PublishedForecast): number {
  const ceilingSignal = Math.min(Math.max(forecast.expectedCareerWar, 0) / 35, 1)
  const starSignal = Math.min(Math.max(forecast.starProbability, 0) / 100, 1)
  const confidenceSignal = Math.min(Math.max(forecast.confidence, 0) / 100, 1)
  const arrivalSignal = Math.min(Math.max(forecast.arrivalProbability, 0) / 100, 1)

  return Math.round(
    arrivalSignal * 42 +
      ceilingSignal * 28 +
      starSignal * 20 +
      confidenceSignal * 10,
  )
}

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

export function filterAndSortPlayers(
  players: PlayerRecord[],
  filters: BoardFilters,
): PlayerRecord[] {
  const query = filters.query.trim().toLocaleLowerCase()

  return players
    .filter((player) => {
      const matchesQuery =
        query.length === 0 ||
        [
          player.name,
          player.organization,
          player.organizationCode,
          player.position,
        ].some((value) => value?.toLocaleLowerCase().includes(query))
      const matchesType =
        filters.playerType === 'All' || player.playerType === filters.playerType
      const matchesLevel = filters.level === 'All' || player.level === filters.level

      return matchesQuery && matchesType && matchesLevel
    })
    .toSorted((left, right) => {
      if (filters.sort === 'name') return left.name.localeCompare(right.name)
      if (filters.sort === 'age') {
        return compareNullableNumber(left.age, right.age, 'ascending')
      }
      if (filters.sort === 'psPercentile') {
        return compareNullableNumber(left.psPercentile, right.psPercentile, 'descending')
      }
      if (filters.sort === 'arrival36') {
        const leftProbability = left.researchEstimate?.horizons.find(
          (horizon) => horizon.months === 36,
        )?.probability ?? null
        const rightProbability = right.researchEstimate?.horizons.find(
          (horizon) => horizon.months === 36,
        )?.probability ?? null
        return compareNullableNumber(leftProbability, rightProbability, 'descending')
      }
      return compareNullableNumber(left.psScore, right.psScore, 'descending')
    })
}

export function formatSigned(value: number, suffix = ''): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}${suffix}`
}

export function probabilityTone(value: number): 'strong' | 'medium' | 'soft' {
  if (value >= 70) return 'strong'
  if (value >= 45) return 'medium'
  return 'soft'
}

export function formatOrdinal(value: number): string {
  const rounded = Math.round(value)
  const lastTwoDigits = rounded % 100
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return `${rounded}th`

  const suffix = rounded % 10 === 1 ? 'st' : rounded % 10 === 2 ? 'nd' : rounded % 10 === 3 ? 'rd' : 'th'
  return `${rounded}${suffix}`
}

export function formatScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}
