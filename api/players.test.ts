import { describe, expect, it } from 'vitest'
import type { CareerForecast } from './_career-oracle-types.js'
import {
  assignStageRanks,
  dedupeMinorCandidates,
  mergeCurrentUniverse,
  sortBoardCandidates,
  sortUnifiedCandidates,
  type UnifiedBoardCandidate,
} from './players.js'

const war = { p10: 1, p25: 5, p50: 12, p75: 24, p90: 40 }

function forecast(
  probability: number,
  finalWarP50: number,
  artifactRank: number,
  confidenceScore = 0.5,
): CareerForecast {
  return {
    publicationState: 'research',
    releaseEligible: false,
    asOf: '2026-07-12T00:00:00.000Z',
    rank: artifactRank,
    hofCaliberProbability: probability,
    finalCareerWar: { ...war, p50: finalWarP50, p75: Math.max(24, finalWarP50) },
    peakSevenWar: war,
    finalJaws: null,
    scenarioSupportExtensionJaws: null,
    cumulativeWar: null,
    arrivalProbability36: 0.5,
    confidenceScore,
    confidenceState: 'Moderate',
    intervalWidth: null,
    arc: [],
    decomposition: {
      arrivalProbability: 0.5,
      hofCaliberGivenMlbProbability: 0.1,
      noMlbProbability: 0.5,
      observedCumulativeWar: null,
    },
    hofStandard: null,
    summary: null,
    drivers: [],
    warnings: [],
    lineage: {
      modelVersion: 'career-v1',
      targetVersion: 'hof-v1',
      dataVersion: null,
      providerVersion: null,
    },
  }
}

function candidate(
  id: string,
  patch: Partial<UnifiedBoardCandidate> = {},
): UnifiedBoardCandidate {
  return {
    id,
    source: 'minor',
    name: id,
    playerType: 'Hitter',
    stage: 'pre_debut',
    age: 21,
    level: 'AA',
    organization: 'Example',
    organizationCode: 'EX',
    position: 'CF',
    mlbamId: id.replace(/\D/gu, '') || null,
    opportunityScore: 100,
    careerForecast: forecast(0.1, 20, 900),
    arrivalProbability36: 0.5,
    minorProfileId: id,
    previewPlayer: null,
    ...patch,
  }
}

describe('unified player ordering', () => {
  it('orders HOF probability, then final WAR P50, then ID without confidence', () => {
    const sorted = sortUnifiedCandidates([
      candidate('z', { careerForecast: forecast(0.2, 30, 4, 0.99) }),
      candidate('b', { careerForecast: forecast(0.2, 31, 3, 0.01) }),
      candidate('a', { careerForecast: forecast(0.2, 31, 2, 0.99) }),
      candidate('top', { careerForecast: forecast(0.3, 1, 1, 0.01) }),
    ], 'hofProbability')

    expect(sorted.map((item) => item.id)).toEqual(['top', 'a', 'b', 'z'])
  })

  it('recomputes separate contiguous MLB and live-minor ranks', () => {
    const ranked = assignStageRanks([
      candidate('minor-second', { careerForecast: forecast(0.2, 30, 400) }),
      candidate('withheld', { careerForecast: null }),
      candidate('minor-first', { careerForecast: forecast(0.3, 10, 800) }),
      candidate('mlb-first', {
        source: 'mlb',
        stage: 'established_mlb',
        minorProfileId: null,
        careerForecast: forecast(0.25, 40, 12),
      }),
    ])
    const byId = new Map(ranked.map((item) => [item.id, item]))

    expect(byId.get('minor-first')?.careerForecast?.rank).toBe(1)
    expect(byId.get('minor-second')?.careerForecast?.rank).toBe(2)
    expect(byId.get('mlb-first')?.careerForecast?.rank).toBe(1)
    expect(byId.get('minor-second')?.careerForecast?.lineage.artifactRank).toBe(400)
    expect(byId.get('minor-second')?.careerForecast?.lineage.rankUniverse).toBe('live_milb_research_proxy')
    expect(byId.get('mlb-first')?.careerForecast?.lineage.rankUniverse).toBe('current_mlb')
    expect(byId.get('withheld')?.careerForecast).toBeNull()
  })

  it('groups incomparable outcome sorts by stage in the All view', () => {
    const items = [
      candidate('minor-high', { careerForecast: forecast(0.9, 90, 1) }),
      candidate('mlb-low', {
        source: 'mlb',
        stage: 'established_mlb',
        minorProfileId: null,
        careerForecast: forecast(0.1, 10, 1),
      }),
      candidate('minor-low', { careerForecast: forecast(0.05, 5, 2) }),
      candidate('mlb-high', {
        source: 'mlb',
        stage: 'early_mlb',
        minorProfileId: null,
        careerForecast: forecast(0.2, 20, 2),
      }),
    ]

    expect(sortBoardCandidates(items, { stage: 'All', sort: 'hofProbability' }).map((item) => item.id))
      .toEqual(['mlb-high', 'mlb-low', 'minor-high', 'minor-low'])
    expect(sortBoardCandidates(items, { stage: 'Minors', sort: 'hofProbability' }).map((item) => item.id))
      .toEqual(['minor-high', 'mlb-high', 'mlb-low', 'minor-low'])
  })
})

describe('minor identity dedupe', () => {
  it('prefers a forecast-backed role, then opportunity, and preserves missing IDs', () => {
    const deduped = dedupeMinorCandidates([
      candidate('hitter-1', {
        mlbamId: '700001',
        opportunityScore: 500,
        careerForecast: null,
      }),
      candidate('pitcher-1', {
        mlbamId: '700001',
        playerType: 'Pitcher',
        opportunityScore: 10,
      }),
      candidate('hitter-2', { mlbamId: '700002', opportunityScore: 30 }),
      candidate('pitcher-2', {
        mlbamId: '700002',
        playerType: 'Pitcher',
        opportunityScore: 80,
      }),
      candidate('missing-a', { mlbamId: null }),
      candidate('missing-b', { mlbamId: null }),
    ])

    expect(deduped.items.map((item) => item.id)).toEqual([
      'pitcher-1',
      'pitcher-2',
      'missing-a',
      'missing-b',
    ])
    expect(deduped.duplicateRoleRowsRemoved).toBe(2)
    expect(deduped.missingMlbam).toBe(2)
  })

  it('keeps the MLB record when an exact MLBAM ID also appears in the minor directory', () => {
    const mlb = candidate('mlb-player', {
      source: 'mlb',
      stage: 'established_mlb',
      mlbamId: '700100',
      minorProfileId: null,
    })
    const result = mergeCurrentUniverse(
      [mlb],
      [
        candidate('duplicate-minor', { mlbamId: '700100' }),
        candidate('unmapped-minor', { mlbamId: null }),
      ],
    )

    expect(result.items.map((item) => item.id)).toEqual(['mlb-player', 'unmapped-minor'])
    expect(result.crossStageDuplicatesRemoved).toBe(1)
  })
})
