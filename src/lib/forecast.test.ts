import { describe, expect, it } from 'vitest'
import type { BoardFilters, PlayerRecord, PublishedForecast } from '../domain/forecast'
import {
  filterAndSortPlayers,
  formatOrdinal,
  formatScore,
  formatSigned,
  oracleScore,
} from './forecast'

const baseFilters: BoardFilters = {
  query: '',
  playerType: 'All',
  level: 'All',
  sort: 'psScore',
}

function makePlayer(overrides: Partial<PlayerRecord>): PlayerRecord {
  return {
    id: 'ps-1-hitter',
    name: 'Real Player',
    initials: 'RP',
    organization: 'Test Organization',
    organizationCode: 'TST',
    position: 'SS',
    playerType: 'Hitter',
    age: 21,
    level: 'AA',
    batsThrows: 'R/R',
    psScore: 70,
    psPercentile: 85,
    opportunity: { label: 'PA', value: '240' },
    metrics: [],
    coverage: {
      hasStatcast: true,
      hasTraditional: true,
      hasComplementaryRows: false,
      levelsObserved: ['AA'],
      organizationConflict: false,
      label: 'Tracking + traditional',
    },
    provenance: {
      source: 'Prospect Savant',
      dataset: 'leaders',
      season: 2026,
      retrievedAt: '2026-07-11T00:00:00.000Z',
      cohort: { pitchQualifier: 1, minAge: 16, maxAge: 40 },
      externalIds: { prospectSavant: '1' },
    },
    researchEstimate: null,
    forecast: null,
    ...overrides,
  }
}

describe('real-player board utilities', () => {
  it('filters observed records by player type and source identity', () => {
    const players = [
      makePlayer({ id: 'one', name: 'Jackson Miller' }),
      makePlayer({ id: 'two', name: 'Andre Lewis', playerType: 'Pitcher', position: 'RHP' }),
    ]

    const results = filterAndSortPlayers(
      players,
      { ...baseFilters, query: 'miller', playerType: 'Hitter' },
    )

    expect(results.map((player) => player.id)).toEqual(['one'])
    expect(results[0]?.forecast).toBeNull()
  })

  it('sorts real source scores while keeping missing values last', () => {
    const players = [
      makePlayer({ id: 'missing', psScore: null }),
      makePlayer({ id: 'low', psScore: 42 }),
      makePlayer({ id: 'high', psScore: 91 }),
    ]

    expect(filterAndSortPlayers(players, baseFilters).map((player) => player.id)).toEqual([
      'high',
      'low',
      'missing',
    ])
  })

  it('sorts frozen research estimates while keeping unmatched profiles last', () => {
    const estimate = (probability: number) => ({
      status: 'research_only' as const,
      releaseEligible: false as const,
      asOf: '2025-12-31T00:00:00.000Z',
      modelVersion: 'locked-model',
      snapshotId: `snapshot-${probability}`,
      coldStart: false,
      priorLevel: 'AA',
      modelAge: 21,
      currentStatusVerified: false as const,
      horizons: [{ months: 36, probability, baselineProbability: 0.2, externallyValidated: true }],
      lineage: { predictionManifestSha256: 'a', evaluationReportSha256: 'b' },
    })
    const players = [
      makePlayer({ id: 'unmatched' }),
      makePlayer({ id: 'lower', researchEstimate: estimate(0.4) }),
      makePlayer({ id: 'higher', researchEstimate: estimate(0.7) }),
    ]

    expect(
      filterAndSortPlayers(players, { ...baseFilters, sort: 'arrival36' }).map((player) => player.id),
    ).toEqual(['higher', 'lower', 'unmatched'])
  })

  it('bounds the decision score for a future published forecast', () => {
    const forecast: PublishedForecast = {
      modelVersion: 'arrival-v1',
      publishedAt: '2027-01-01T00:00:00.000Z',
      rank: 1,
      arrivalProbability: 84,
      arrivalDelta: null,
      eta: '2028',
      expectedCareerWar: 28,
      starProbability: 35,
      hofProbability: 5,
      floorWar: 0,
      ceilingWar: 55,
      risk: 'Moderate',
      confidence: 79,
      summary: 'Validated forecast fixture.',
      drivers: [],
      careerArc: [],
    }

    expect(oracleScore(forecast)).toBeGreaterThanOrEqual(0)
    expect(oracleScore(forecast)).toBeLessThanOrEqual(100)
  })

  it('formats source values without inventing missing values', () => {
    expect(formatSigned(3.2, ' pts')).toBe('+3.2 pts')
    expect(formatSigned(-1.5, ' pts')).toBe('-1.5 pts')
    expect(formatOrdinal(91.4)).toBe('91st')
    expect(formatScore(72.25)).toBe('72.3')
    expect(formatScore(null)).toBe('—')
  })
})
