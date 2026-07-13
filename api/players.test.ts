import { describe, expect, it } from 'vitest'
import type { CareerForecast } from './_career-oracle-types.js'
import { researchMilbImpactRanking } from './_milb-impact.js'
import { researchMilbAlphaSignal } from './_research-arrival.js'
import {
  assignStageRanks,
  buildPlayerFacets,
  dedupeMinorCandidates,
  matchesQuery,
  mergeCurrentUniverse,
  normalizeQueryText,
  normalizeSearchText,
  parseQuery,
  playerPositionTokens,
  sortBoardCandidates,
  sortUnifiedCandidates,
  shouldSuppressSlashLine,
  type PlayerQuery,
  type UnifiedBoardCandidate,
} from './players.js'

const war = { p10: 1, p25: 5, p50: 12, p75: 24, p90: 40 }

function forecast(
  probability: number,
  finalWarP50: number,
  artifactRank: number,
  confidenceScore = 0.5,
  nearTermProbability: number | null = null,
  alphaDelta: number | null = null,
): CareerForecast {
  const alphaBaseline = alphaDelta === null ? null : probability - alphaDelta
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
    careerChapter: nearTermProbability === null ? null : {
      version: 'career-chapter-v1',
      status: 'research',
      chapter: 'development',
      label: 'Development',
      trajectoryState: 'rising',
      roleTrack: 'hitter',
      basis: 'completed_seasons_only',
      featureSeason: 2025,
      evidence: {
        age: 23,
        mlbSeasonNumber: 2,
        seasonWar: 2,
        recentWarPerSeason: 1.5,
        priorWarPerSeason: 1,
        warTrend: 1,
        historicalPacePercentile: 80,
      },
      exceptionalTrajectory: {
        probability: nearTermProbability,
        target: 'next_three_war_ge_global_training_q90',
        thresholdWar: 7.5,
        horizonSeasons: 3,
        referenceBaseRate: 0.1,
        rankScope: 'current_mlb_absolute_trajectory',
      },
      support: {
        referencePlayers: 5000,
        referenceLandmarks: 12000,
        expectedNextWarChange: 0.2,
        continuationRate: 0.8,
      },
      warnings: ['research_only'],
    },
    alphaSignal: alphaDelta === null ? null : {
      version: 'alpha-signal-v1',
      status: 'research',
      tier: alphaDelta >= 0.1 ? 'priority' : 'watch',
      basis: 'completed_seasons_only',
      featureSeason: 2025,
      eligible: true,
      rank: artifactRank,
      rankScope: 'current_mlb_eligible_absolute_alpha',
      modeledProbability: probability,
      baseline: {
        probability: alphaBaseline!,
        minimumSeason: 1961,
        players: 1000,
        landmarks: 1500,
        roleTrack: 'hitter',
        experienceBand: 'seasons_2_3',
        seasonNumberMin: 2,
        seasonNumberMax: 3,
        ageMin: 21,
        ageMax: 25,
        ageWindow: 2,
        resolvedOnly: true,
        referenceSeasonsBeforeFeature: true,
        playerEqualWeighted: true,
      },
      edge: {
        probabilityDelta: alphaDelta,
        liftMultiple: alphaBaseline! <= 0 ? null : probability / alphaBaseline!,
      },
      ceiling: {
        p90JawsMargin: 4,
        gatePassed: true,
        target: 'final_jaws_minus_career_to_date_standard',
      },
      runway: {
        age: 23,
        learnedTrackPrimeStartAge: 28,
        yearsToPrime: 5,
        minimumRequiredYears: 2,
        gatePassed: true,
      },
      nearTermImpact: nearTermProbability === null ? null : {
        probability: nearTermProbability,
        referenceBaseRate: 0.1,
        liftMultiple: nearTermProbability / 0.1,
        target: 'next_three_war_ge_global_training_q90',
      },
      historicalPace: null,
      gates: {
        supportedBaseline: true,
        completedEvidence: true,
        earlyCareer: true,
        prePrimeRunway: true,
        absoluteCeiling: true,
      },
      warnings: ['research_only'],
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
    milbAlphaSignal: null,
    milbImpactRanking: null,
    arrivalProbability36: 0.5,
    minorProfileId: id,
    previewPlayer: null,
    ...patch,
  }
}

function query(patch: Partial<PlayerQuery> = {}): PlayerQuery {
  return {
    q: '',
    stage: 'All',
    playerType: 'All',
    level: 'All',
    team: null,
    position: null,
    sort: 'alphaOpportunity',
    page: 1,
    limit: 50,
    ...patch,
  }
}

describe('unified player ordering', () => {
  it('normalizes browser form-encoded spaces in player search text', () => {
    expect(normalizeQueryText('Nick+Kurtz')).toBe('Nick Kurtz')
    expect(normalizeQueryText('Peña')).toBe('Peña')
    expect(normalizeSearchText('Jesús Made')).toBe('jesus made')
  })

  it('matches player search without requiring diacritics', () => {
    expect(matchesQuery(candidate('made', { name: 'Jesús Made' }), query({ q: 'Jesus Made' })))
      .toBe(true)
  })

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

  it('orders near-term MLB impact by an absolute three-year event and minors by arrival', () => {
    const withheldForecast = forecast(0.9, 70, 3, 0.5, 0.99)
    if (withheldForecast.careerChapter) withheldForecast.careerChapter.status = 'withheld'
    const items = [
      candidate('minor-high-arrival', { arrivalProbability36: 0.9 }),
      candidate('minor-low-arrival', { arrivalProbability36: 0.2 }),
      candidate('mlb-high-impact', {
        source: 'mlb',
        stage: 'early_mlb',
        minorProfileId: null,
        careerForecast: forecast(0.1, 20, 1, 0.5, 0.7),
      }),
      candidate('mlb-low-impact-high-hof', {
        source: 'mlb',
        stage: 'established_mlb',
        minorProfileId: null,
        careerForecast: forecast(0.8, 60, 2, 0.5, 0.1),
      }),
      candidate('mlb-withheld-impact', {
        source: 'mlb',
        stage: 'established_mlb',
        minorProfileId: null,
        careerForecast: withheldForecast,
      }),
    ]

    expect(sortBoardCandidates(items, { stage: 'All', sort: 'nearTermImpact' }).map((item) => item.id))
      .toEqual([
        'mlb-high-impact',
        'mlb-low-impact-high-hof',
        'mlb-withheld-impact',
        'minor-high-arrival',
        'minor-low-arrival',
      ])
    expect(sortBoardCandidates(
      items.filter((item) => item.source === 'mlb'),
      { stage: 'MLB', sort: 'nearTermImpact' },
    ).map((item) => item.id))
      .toEqual(['mlb-high-impact', 'mlb-low-impact-high-hof', 'mlb-withheld-impact'])
  })

  it('orders MLB Alpha by edge and dual-gated MiLB Alpha by direct impact rank', () => {
    const ineligible = forecast(0.9, 60, 3, 0.5, 0.95, 0.8)
    if (ineligible.alphaSignal) {
      ineligible.alphaSignal.eligible = false
      ineligible.alphaSignal.tier = 'none'
      ineligible.alphaSignal.rank = null
      ineligible.alphaSignal.rankScope = null
      ineligible.alphaSignal.gates.absoluteCeiling = false
      if (ineligible.alphaSignal.ceiling) {
        ineligible.alphaSignal.ceiling.p90JawsMargin = -1
        ineligible.alphaSignal.ceiling.gatePassed = false
      }
    }
    const jesusArrival = researchMilbAlphaSignal('815908', 'Hitter')
    const konnorArrival = researchMilbAlphaSignal('804606', 'Hitter')
    const jesusImpact = researchMilbImpactRanking('815908', 'Hitter')
    const konnorImpact = researchMilbImpactRanking('804606', 'Hitter')
    expect(jesusArrival?.rank).toBe(1)
    expect(konnorArrival?.rank).toBe(10)
    expect(jesusImpact?.rank).toBe(3)
    expect(konnorImpact?.rank).toBe(1)
    const items = [
      candidate('minor-discovery', { arrivalProbability36: 0.99 }),
      candidate('minor-second-alpha', {
        milbAlphaSignal: jesusArrival,
        milbImpactRanking: jesusImpact,
      }),
      candidate('minor-first-alpha', {
        milbAlphaSignal: konnorArrival,
        milbImpactRanking: konnorImpact,
      }),
      candidate('mlb-second-alpha', {
        source: 'mlb',
        stage: 'early_mlb',
        minorProfileId: null,
        careerForecast: forecast(0.3, 30, 2, 0.5, 0.8, 0.2),
      }),
      candidate('mlb-first-alpha', {
        source: 'mlb',
        stage: 'early_mlb',
        minorProfileId: null,
        careerForecast: forecast(0.5, 40, 1, 0.5, 0.7, 0.4),
      }),
      candidate('mlb-ineligible', {
        source: 'mlb',
        stage: 'early_mlb',
        minorProfileId: null,
        careerForecast: ineligible,
      }),
    ]

    expect(sortBoardCandidates(items, { stage: 'All', sort: 'alphaOpportunity' })
      .map((item) => item.id))
      .toEqual([
        'mlb-first-alpha',
        'mlb-second-alpha',
        'mlb-ineligible',
        'minor-first-alpha',
        'minor-second-alpha',
        'minor-discovery',
      ])
    expect(sortBoardCandidates(
      items.filter((item) => item.source === 'minor'),
      { stage: 'Minors', sort: 'alphaOpportunity' },
    )
      .map((item) => item.id))
      .toEqual(['minor-first-alpha', 'minor-second-alpha', 'minor-discovery'])
  })
})

describe('player board facets', () => {
  it('validates and normalizes team and position query parameters', () => {
    const request = (url: string) => ({ url }) as Parameters<typeof parseQuery>[0]

    expect(parseQuery(request('/api/players?team=ath&position=c'))).toMatchObject({
      team: 'ath',
      position: 'C',
    })
    expect(parseQuery(request('/api/players?team=ATH&team=BOS'))).toBeNull()
    expect(parseQuery(request('/api/players?team=ATH%2FBOS'))).toBeNull()
    expect(parseQuery(request('/api/players?position=C%2F1B'))).toBeNull()
    expect(parseQuery(request('/api/players?position=All'))).toBeNull()
    expect(parseQuery(request('/api/players?unexpected=value'))).toBeNull()
  })

  it('matches exact teams and individual tokens from composite positions', () => {
    const catcher = candidate('catcher', {
      organization: 'Athletics',
      organizationCode: 'ATH',
      position: 'C/1B',
    })

    expect(playerPositionTokens(' C / 1b / C ')).toEqual(['C', '1B'])
    expect(matchesQuery(catcher, query({ team: 'ath', position: 'C' }))).toBe(true)
    expect(matchesQuery(catcher, query({ team: 'Athletics', position: '1B' }))).toBe(true)
    expect(matchesQuery(catcher, query({ team: 'AT' }))).toBe(false)
    expect(matchesQuery(catcher, query({ position: 'B' }))).toBe(false)
  })

  it('returns full-universe facet options and excludes each facet from its own counts', () => {
    const candidates = [
      candidate('ath-catcher', {
        organization: 'Athletics',
        organizationCode: 'ATH',
        position: 'C/1B',
      }),
      candidate('ath-first', {
        organization: 'Athletics',
        organizationCode: 'ATH',
        position: '1B',
      }),
      candidate('bos-catcher', {
        organization: 'Boston Red Sox',
        organizationCode: 'BOS',
        position: 'C',
      }),
      candidate('bos-pitcher', {
        organization: 'Boston Red Sox',
        organizationCode: 'BOS',
        position: 'RP',
        playerType: 'Pitcher',
      }),
    ]

    const facets = buildPlayerFacets(candidates, query({ team: 'ATH', position: 'C' }))

    expect(facets.teams).toEqual([
      { value: 'ATH', label: 'Athletics (ATH)', count: 1 },
      { value: 'BOS', label: 'Boston Red Sox (BOS)', count: 1 },
    ])
    expect(facets.positions).toEqual([
      { value: '1B', label: '1B', count: 2 },
      { value: 'C', label: 'C', count: 1 },
    ])
  })

  it('prefers a full organization name over an earlier code-only facet label', () => {
    const facets = buildPlayerFacets([
      candidate('mil-code-only', {
        organization: 'MIL',
        organizationCode: 'MIL',
      }),
      candidate('mil-named', {
        organization: 'Milwaukee Brewers',
        organizationCode: 'MIL',
      }),
    ], query())

    expect(facets.teams).toEqual([
      { value: 'MIL', label: 'Milwaukee Brewers (MIL)', count: 2 },
    ])
  })
})

describe('source display quality', () => {
  it('suppresses impossible all-zero hitter slash lines when other offense is present', () => {
    expect(shouldSuppressSlashLine('Hitter', 346, 0, 0, 0, 0.35)).toBe(true)
    expect(shouldSuppressSlashLine('Hitter', 346, 0.25, 0.33, 0.41, 0.35)).toBe(false)
    expect(shouldSuppressSlashLine('Hitter', 8, 0, 0, 0, 0.2)).toBe(false)
    expect(shouldSuppressSlashLine('Pitcher', 346, 0, 0, 0, 0.35)).toBe(false)
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
