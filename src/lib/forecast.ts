import type { BoardFilters, PlayerForecast } from '../domain/forecast'

export function oracleScore(player: PlayerForecast): number {
  const ceilingSignal = Math.min(player.expectedCareerWar / 35, 1)
  const starSignal = player.starProbability / 100
  const confidenceSignal = player.confidence / 100

  return Math.round(
    (player.arrivalProbability / 100) * 42 +
      ceilingSignal * 28 +
      starSignal * 20 +
      confidenceSignal * 10,
  )
}

export function rankPlayers(
  players: PlayerForecast[],
  filters: BoardFilters,
  watchlist: Set<string>,
): PlayerForecast[] {
  const query = filters.query.trim().toLocaleLowerCase()

  const filtered = players.filter((player) => {
    const matchesQuery =
      query.length === 0 ||
      [
        player.name,
        player.organization,
        player.organizationCode,
        player.position,
      ].some((value) => value.toLocaleLowerCase().includes(query))
    const matchesType =
      filters.playerType === 'All' || player.playerType === filters.playerType
    const matchesLevel = filters.level === 'All' || player.level === filters.level
    const matchesWatchlist = !filters.watchlistOnly || watchlist.has(player.id)

    return matchesQuery && matchesType && matchesLevel && matchesWatchlist
  })

  return filtered.toSorted((a, b) => {
    if (filters.sort === 'arrival') {
      return b.arrivalProbability - a.arrivalProbability
    }
    if (filters.sort === 'ceiling') {
      return b.ceilingWar - a.ceilingWar
    }
    if (filters.sort === 'momentum') {
      return b.arrivalDelta - a.arrivalDelta
    }
    return oracleScore(b) - oracleScore(a)
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
  const lastTwoDigits = value % 100
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return `${value}th`

  const suffix = value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th'
  return `${value}${suffix}`
}
