import { describe, expect, it } from 'vitest'
import type { PlayerRecord } from '../domain/forecast'
import {
  bestCurrentScoutingGrade,
  currentMinorEvidence,
  currentMinorSignal,
  currentMinorSlashLine,
} from './currentMinorView'

const arana = {
  name: 'Luis Arana',
  currentMinorStats: {
    source: 'MLB StatsAPI',
    season: 2026,
    asOf: '2026-07-13T20:00:00.000Z',
    currentLevel: 'A',
    highestObservedLevel: 'A',
    levelsObserved: ['A', 'Rk'],
    opportunity: { label: 'PA', value: '208' },
    hitting: {
      pa: 208,
      ba: 0.294,
      obp: 0.413,
      slg: 0.359,
      ops: 0.772,
      homeRuns: 1,
      walks: 34,
      strikeouts: 36,
      stolenBases: 25,
    },
    pitching: null,
  },
  currentProspectScouting: {
    source: 'FanGraphs',
    reportSeason: 2026,
    asOf: '2026-07-13T20:00:00.000Z',
    organizationRank: 6,
    overallRank: null,
    futureValue: '45+',
    futureValueRaw: '47',
    eta: 2028,
    grades: [
      { key: 'hit', label: 'Hit', present: 30, future: 55 },
      { key: 'bat-control', label: 'Bat control', present: null, future: 70 },
    ],
  },
} as PlayerRecord

describe('current minor-league evidence display', () => {
  it('keeps live scouting and official all-level workload explicit', () => {
    expect(currentMinorSignal(arana)).toEqual({
      label: '.294/.413/.359',
      detail: '2026 · 208 PA at A',
    })
    expect(currentMinorEvidence(arana)).toEqual({
      label: '208 PA · A / Rk',
      detail: 'Official 2026 season totals',
    })
    expect(currentMinorSlashLine(arana)).toBe('.294/.413/.359')
    expect(bestCurrentScoutingGrade(arana)).toEqual({ label: 'Bat control', value: 70 })
  })

  it('does not present scouting or placeholder stat lines as current results', () => {
    const scoutingOnly = {
      ...arana,
      currentMinorStats: null,
    } as PlayerRecord
    expect(currentMinorSignal(scoutingOnly)).toBeNull()

    const workloadOnly = {
      ...arana,
      currentMinorStats: {
        ...arana.currentMinorStats,
        hitting: {
          ...arana.currentMinorStats!.hitting!,
          ba: null,
          obp: null,
          slg: null,
        },
      },
    } as PlayerRecord
    expect(currentMinorSlashLine(workloadOnly)).toBeNull()
    expect(currentMinorSignal(workloadOnly)).toBeNull()
  })
})
