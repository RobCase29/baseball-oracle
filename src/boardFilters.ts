import type { BoardFilters } from './domain/forecast'

export const defaultBoardFilters: BoardFilters = {
  query: '',
  stage: 'Minors',
  playerType: 'All',
  level: 'All',
  team: 'All',
  position: 'All',
  sort: 'prospectScore',
}

export function filtersFromUrl(): BoardFilters {
  const parameters = new URLSearchParams(window.location.search)
  const stage = parameters.get('stage')
  const playerType = parameters.get('playerType')
  const level = parameters.get('level')
  const sort = parameters.get('sort')
  const resolvedStage: BoardFilters['stage'] = stage === 'All' || stage === 'Minors' || stage === 'RC' || stage === 'MLB'
    ? stage
    : defaultBoardFilters.stage
  const resolvedLevel: BoardFilters['level'] = level === 'AAA' || level === 'AA' || level === 'A+' || level === 'A' || level === 'Rk'
    ? level
    : defaultBoardFilters.level
  const validSorts = new Set<BoardFilters['sort']>([
    'prospectScore',
    'careerIndex',
    'stageStanding',
    'alphaOpportunity',
    'nearTermImpact',
    'finalWar',
    'arrival36',
    'age',
    'name',
  ])
  const defaultSortForStage: BoardFilters['sort'] = resolvedStage === 'All'
    ? 'name'
    : resolvedStage === 'Minors'
      ? 'prospectScore'
      : 'careerIndex'
  const resolvedSort = sort && validSorts.has(sort as BoardFilters['sort'])
    ? sort as BoardFilters['sort']
    : defaultSortForStage
  const stageSort = resolvedStage === 'All'
    ? 'name'
    : resolvedStage !== 'Minors' && resolvedSort === 'prospectScore'
      ? 'careerIndex'
      : (resolvedStage === 'Minors' && (
          resolvedSort === 'nearTermImpact' || resolvedSort === 'finalWar'
        )) || (resolvedStage === 'MLB' && resolvedSort === 'arrival36') || (
          resolvedStage === 'RC' && (
            resolvedSort === 'nearTermImpact' ||
            resolvedSort === 'finalWar' ||
            resolvedSort === 'arrival36'
          )
        )
        ? defaultSortForStage
        : resolvedSort

  return {
    query: parameters.get('q') ?? defaultBoardFilters.query,
    stage: resolvedStage,
    playerType: playerType === 'Hitter' || playerType === 'Pitcher' || playerType === 'Two-way'
      ? playerType
      : defaultBoardFilters.playerType,
    level: resolvedStage === 'MLB' || resolvedStage === 'RC' ? 'All' : resolvedLevel,
    team: parameters.get('team') ?? defaultBoardFilters.team,
    position: parameters.get('position') ?? defaultBoardFilters.position,
    sort: stageSort,
  }
}
