import { describe, expect, it } from 'vitest'
import type { BoardFilters, CareerForecast, PlayerRecord } from '../domain/forecast'
import {
  filterAndSortPlayers,
  formatOrdinal,
  formatProbability,
  formatScore,
  formatSigned,
  formatWar,
  stageCoverageForPlayers,
  stageLabel,
} from './forecast'

const baseFilters: BoardFilters = {
  query: '',
  stage: 'All',
  playerType: 'All',
  level: 'All',
  sort: 'hofProbability',
}

function makeForecast(overrides: Partial<CareerForecast> = {}): CareerForecast {
  return {
    publicationState: 'research',
    releaseEligible: false,
    asOf: '2026-07-12T00:00:00.000Z',
    rank: 1,
    hofCaliberProbability: 0.08,
    finalCareerWar: { p10: 2, p25: 8, p50: 20, p75: 38, p90: 62 },
    peakSevenWar: { p10: 1, p25: 6, p50: 15, p75: 27, p90: 40 },
    finalJaws: null,
    scenarioSupportExtensionJaws: null,
    cumulativeWar: null,
    arrivalProbability36: 0.61,
    confidenceScore: 0.7,
    confidenceState: 'Moderate',
    intervalWidth: 60,
    arc: [],
    decomposition: {
      arrivalProbability: 0.8,
      hofCaliberGivenMlbProbability: 0.1,
      noMlbProbability: 0.2,
      observedCumulativeWar: null,
    },
    hofStandard: null,
    summary: null,
    drivers: [],
    warnings: [],
    lineage: {
      modelVersion: 'career-v1',
      targetVersion: 'hof-caliber-jaws-v1',
      dataVersion: null,
      providerVersion: null,
    },
    ...overrides,
  }
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
    stage: 'pre_debut',
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
    careerForecast: null,
    ...overrides,
  }
}

describe('Oracle Board utilities', () => {
  it('filters canonical records by stage, role, and source identity', () => {
    const players = [
      makePlayer({ id: 'one', name: 'Jackson Miller' }),
      makePlayer({
        id: 'two',
        name: 'Andre Lewis',
        playerType: 'Pitcher',
        position: 'RHP',
        stage: 'early_mlb',
        level: null,
      }),
    ]

    expect(filterAndSortPlayers(players, {
      ...baseFilters,
      query: 'lewis',
      stage: 'MLB',
      playerType: 'Pitcher',
    }).map((player) => player.id)).toEqual(['two'])
  })

  it('ranks only by unconditional HOF probability and never by confidence', () => {
    const players = [
      makePlayer({
        id: 'lower-probability',
        careerForecast: makeForecast({
          hofCaliberProbability: 0.09,
          confidenceScore: 0.99,
          confidenceState: 'High',
        }),
      }),
      makePlayer({
        id: 'higher-probability',
        careerForecast: makeForecast({
          hofCaliberProbability: 0.1,
          confidenceScore: 0.1,
          confidenceState: 'Low',
        }),
      }),
      makePlayer({ id: 'withheld', careerForecast: null }),
    ]

    expect(filterAndSortPlayers(players, baseFilters).map((player) => player.id)).toEqual([
      'higher-probability',
      'lower-probability',
      'withheld',
    ])
  })

  it('groups incomparable MLB outcomes and prospect proxies in the All view', () => {
    const players = [
      makePlayer({
        id: 'minor-high',
        careerForecast: makeForecast({ hofCaliberProbability: 0.9 }),
      }),
      makePlayer({
        id: 'mlb-low',
        stage: 'early_mlb',
        level: null,
        careerForecast: makeForecast({ hofCaliberProbability: 0.01 }),
      }),
    ]

    expect(filterAndSortPlayers(players, baseFilters).map((player) => player.id)).toEqual([
      'mlb-low',
      'minor-high',
    ])
    expect(filterAndSortPlayers(players, { ...baseFilters, stage: 'Minors' }).map((player) => player.id))
      .toEqual(['minor-high'])
  })

  it('uses final WAR P50 only when that secondary sort is selected', () => {
    const players = [
      makePlayer({ id: 'low', careerForecast: makeForecast() }),
      makePlayer({
        id: 'high',
        careerForecast: makeForecast({
          finalCareerWar: { p10: 4, p25: 15, p50: 42, p75: 60, p90: 75 },
        }),
      }),
      makePlayer({ id: 'missing' }),
    ]

    expect(filterAndSortPlayers(players, { ...baseFilters, sort: 'finalWar' }).map((player) => player.id)).toEqual([
      'high',
      'low',
      'missing',
    ])
  })

  it('sorts frozen arrival estimates while keeping unmatched profiles last', () => {
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

  it('formats model values without converting invalid probabilities', () => {
    expect(formatSigned(3.2, ' pts')).toBe('+3.2 pts')
    expect(formatSigned(-1.5, ' pts')).toBe('-1.5 pts')
    expect(formatOrdinal(91.4)).toBe('91st')
    expect(formatScore(72.25)).toBe('72.3')
    expect(formatScore(null)).toBe('—')
    expect(formatProbability(0.123)).toBe('12.3%')
    expect(formatProbability(84)).toBe('—')
    expect(formatWar(24.23)).toBe('24.2')
    expect(stageLabel('established_mlb')).toBe('Established MLB')
  })

  it('summarizes the stage mix for filtered and saved player sets', () => {
    expect(stageCoverageForPlayers([
      makePlayer({ id: 'minor' }),
      makePlayer({ id: 'rookie', stage: 'early_mlb' }),
      makePlayer({ id: 'veteran', stage: 'established_mlb' }),
      makePlayer({ id: 'inactive', stage: 'inactive' }),
    ])).toEqual({ minors: 1, mlb: 2 })
  })
})
