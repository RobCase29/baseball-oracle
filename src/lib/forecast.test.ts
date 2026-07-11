import { describe, expect, it } from 'vitest'
import { demoPlayers } from '../data/demoPlayers'
import type { BoardFilters } from '../domain/forecast'
import { formatOrdinal, formatSigned, oracleScore, rankPlayers } from './forecast'

const baseFilters: BoardFilters = {
  query: '',
  playerType: 'All',
  level: 'All',
  sort: 'oracle',
  watchlistOnly: false,
}

describe('forecast ranking', () => {
  it('produces a bounded decision score', () => {
    for (const player of demoPlayers) {
      expect(oracleScore(player)).toBeGreaterThanOrEqual(0)
      expect(oracleScore(player)).toBeLessThanOrEqual(100)
    }
  })

  it('filters by player type and search query', () => {
    const results = rankPlayers(
      demoPlayers,
      { ...baseFilters, query: 'marin', playerType: 'Hitter' },
      new Set(),
    )

    expect(results.map((player) => player.id)).toEqual(['eli-marin'])
  })

  it('returns only saved players when watchlist mode is active', () => {
    const results = rankPlayers(
      demoPlayers,
      { ...baseFilters, watchlistOnly: true },
      new Set(['eli-marin', 'marcus-hall']),
    )

    expect(results).toHaveLength(2)
    expect(results.map((player) => player.id)).toEqual(
      expect.arrayContaining(['eli-marin', 'marcus-hall']),
    )
  })

  it('formats positive, negative, and neutral movement', () => {
    expect(formatSigned(3.2, ' pts')).toBe('+3.2 pts')
    expect(formatSigned(-1.5, ' pts')).toBe('-1.5 pts')
    expect(formatSigned(0, ' pts')).toBe('0.0 pts')
  })

  it('formats percentile ordinals', () => {
    expect(formatOrdinal(1)).toBe('1st')
    expect(formatOrdinal(12)).toBe('12th')
    expect(formatOrdinal(23)).toBe('23rd')
    expect(formatOrdinal(91)).toBe('91st')
  })
})
