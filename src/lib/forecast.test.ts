import { describe, expect, it } from 'vitest'
import type { BoardFilters, CareerForecast, PlayerRecord } from '../domain/forecast'
import {
  filterAndSortPlayers,
  developmentChapterLabel,
  formatOrdinal,
  formatPosition,
  formatPercentileRank,
  formatPercentagePointDelta,
  formatProbability,
  formatScore,
  formatSigned,
  formatTopRankPercent,
  formatWar,
  normalizeSearchText,
  stageCoverageForPlayers,
  stageLabel,
} from './forecast'

const baseFilters: BoardFilters = {
  query: '',
  stage: 'All',
  playerType: 'All',
  level: 'All',
  team: 'All',
  position: 'All',
  sort: 'hofProbability',
}

function makeForecast(overrides: Partial<CareerForecast> = {}): CareerForecast {
  const defaultCareerWar = { p10: 2, p25: 8, p50: 20, p75: 38, p90: 62 }
  return {
    publicationState: 'research',
    releaseEligible: false,
    asOf: '2026-07-12T00:00:00.000Z',
    rank: 1,
    hofCaliberProbability: 0.08,
    finalCareerWar: defaultCareerWar,
    finalCareerWarConditionalOnArrival:
      overrides.finalCareerWarConditionalOnArrival ??
      overrides.finalCareerWar ??
      defaultCareerWar,
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
      estimatedDebutAge: null,
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
  it('normalizes diacritics for player discovery', () => {
    expect(normalizeSearchText('Jesús Made')).toBe('jesus made')
    expect(filterAndSortPlayers([
      makePlayer({ id: 'made', name: 'Jesús Made' }),
    ], { ...baseFilters, query: 'Jesus Made' }).map((player) => player.id)).toEqual(['made'])
  })

  it('filters canonical records by stage, role, and source identity', () => {
    const players = [
      makePlayer({ id: 'one', name: 'Jackson Miller' }),
      makePlayer({
        id: 'callup',
        name: 'Rookie Transition',
        stage: 'recent_callup',
        level: 'MLB',
      }),
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
    expect(filterAndSortPlayers(players, {
      ...baseFilters,
      stage: 'RC',
    }).map((player) => player.id)).toEqual(['callup'])
  })

  it('filters exact teams and token-aware composite positions', () => {
    const players = [
      makePlayer({
        id: 'ath-catcher',
        organization: 'Athletics',
        organizationCode: 'ATH',
        position: 'C/1B',
      }),
      makePlayer({
        id: 'ath-shortstop',
        organization: 'Athletics',
        organizationCode: 'ATH',
        position: 'SS',
      }),
      makePlayer({
        id: 'bos-catcher',
        organization: 'Boston Red Sox',
        organizationCode: 'BOS',
        position: 'C',
      }),
    ]

    expect(filterAndSortPlayers(players, {
      ...baseFilters,
      team: 'ath',
      position: 'C',
    }).map((player) => player.id)).toEqual(['ath-catcher'])
    expect(filterAndSortPlayers(players, {
      ...baseFilters,
      position: '1B',
    }).map((player) => player.id)).toEqual(['ath-catcher'])
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

    expect(filterAndSortPlayers(players, { ...baseFilters, stage: 'Minors' }).map((player) => player.id)).toEqual([
      'higher-probability',
      'lower-probability',
      'withheld',
    ])
  })

  it('treats the All view as an alphabetical cross-stage directory', () => {
    const players = [
      makePlayer({
        id: 'minor-high',
        name: 'Zulu Prospect',
        careerForecast: makeForecast({ hofCaliberProbability: 0.9 }),
      }),
      makePlayer({
        id: 'mlb-low',
        name: 'Alpha Veteran',
        stage: 'early_mlb',
        level: null,
        careerForecast: makeForecast({ hofCaliberProbability: 0.01 }),
      }),
      makePlayer({
        id: 'rookie-transition',
        name: 'Mike Rookie',
        stage: 'recent_callup',
        level: 'MLB',
        careerForecast: null,
        recentCallup: {
          version: 'rookie-track-v1',
          status: 'monitoring',
          reason: 'first_mlb_season_partial_only',
          prospectPrior: {
            rank: 167,
            universe: 6455,
            target: 'runway_adjusted_career_ceiling',
            asOf: '2025-12-31T00:00:00.000Z',
            forecast: makeForecast({ rank: 167 }),
          },
          currentMlbEvidence: {
            asOf: '2026-07-12T00:00:00.000Z',
            opportunity: { label: 'PA', value: '172' },
            war: 1,
            warPercentile: 72.7,
          },
        },
      }),
    ]

    expect(filterAndSortPlayers(players, baseFilters).map((player) => player.id)).toEqual([
      'mlb-low',
      'rookie-transition',
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

    expect(filterAndSortPlayers(players, { ...baseFilters, stage: 'Minors', sort: 'finalWar' }).map((player) => player.id)).toEqual([
      'high',
      'low',
      'missing',
    ])
  })

  it('sorts Career Index by fixed career-value magnitude rather than stage rank', () => {
    const players = [
      makePlayer({
        id: 'best-rank-lower-value',
        careerForecast: makeForecast({
          rank: 1,
          finalCareerWar: { p10: 0, p25: 1, p50: 5, p75: 10, p90: 20 },
        }),
      }),
      makePlayer({
        id: 'second-rank-higher-value',
        careerForecast: makeForecast({
          rank: 2,
          finalCareerWar: { p10: 5, p25: 15, p50: 35, p75: 50, p90: 70 },
        }),
      }),
      makePlayer({ id: 'withheld' }),
    ]

    expect(filterAndSortPlayers(players, {
      ...baseFilters,
      stage: 'Minors',
      sort: 'careerIndex',
    }).map((player) => player.id)).toEqual([
      'second-rank-higher-value',
      'best-rank-lower-value',
      'withheld',
    ])
  })

  it('never sorts withheld diagnostic values as a published index or standing', () => {
    const players = [
      makePlayer({
        id: 'withheld-diagnostics',
        stage: 'early_mlb',
        careerForecast: makeForecast({
          publicationState: 'withheld',
          rank: 1,
          finalCareerWar: { p10: 20, p25: 40, p50: 60, p75: 80, p90: 100 },
        }),
      }),
      makePlayer({
        id: 'supported',
        stage: 'early_mlb',
        careerForecast: makeForecast({ rank: 2 }),
      }),
    ]

    expect(filterAndSortPlayers(players, {
      ...baseFilters,
      stage: 'MLB',
      sort: 'careerIndex',
    }).map((player) => player.id)).toEqual(['supported', 'withheld-diagnostics'])
    expect(filterAndSortPlayers(players, {
      ...baseFilters,
      stage: 'MLB',
      sort: 'alphaOpportunity',
    }).map((player) => player.id)).toEqual(['supported', 'withheld-diagnostics'])
  })

  it('sorts the separate near-term endpoint without changing the Hall outcome rank', () => {
    const careerChapter = (probability: number | null) => ({
      version: 'career-chapter-v1' as const,
      status: probability === null ? 'withheld' as const : 'research' as const,
      chapter: 'launch' as const,
      label: 'Launch / breakout',
      trajectoryState: 'breakout' as const,
      roleTrack: 'hitter' as const,
      basis: 'completed_seasons_only' as const,
      featureSeason: 2025,
      evidence: {
        age: 22,
        mlbSeasonNumber: 1,
        seasonWar: 5,
        recentWarPerSeason: 5,
        priorWarPerSeason: null,
        warTrend: null,
        historicalPacePercentile: 99,
      },
      exceptionalTrajectory: probability === null ? null : {
        probability,
        target: 'next_three_war_ge_global_training_q90' as const,
        thresholdWar: 10,
        horizonSeasons: 3 as const,
        referenceBaseRate: 0.1,
        rankScope: 'current_mlb_absolute_trajectory' as const,
      },
      support: {
        referencePlayers: 500,
        referenceLandmarks: 900,
        expectedNextWarChange: 0.5,
        continuationRate: 0.7,
      },
      warnings: [],
    })
    const players = [
      makePlayer({
        id: 'higher-outcome-lower-impact',
        stage: 'early_mlb',
        careerForecast: makeForecast({
          hofCaliberProbability: 0.4,
          careerChapter: careerChapter(0.2),
        }),
      }),
      makePlayer({
        id: 'lower-outcome-higher-impact',
        stage: 'early_mlb',
        careerForecast: makeForecast({
          hofCaliberProbability: 0.09,
          careerChapter: careerChapter(0.8),
        }),
      }),
      makePlayer({
        id: 'impact-withheld',
        stage: 'early_mlb',
        careerForecast: makeForecast({ careerChapter: careerChapter(null) }),
      }),
    ]

    expect(filterAndSortPlayers(players, { ...baseFilters, stage: 'MLB', sort: 'nearTermImpact' }).map((player) => player.id))
      .toEqual(['lower-outcome-higher-impact', 'higher-outcome-lower-impact', 'impact-withheld'])
    expect(filterAndSortPlayers(players, { ...baseFilters, stage: 'MLB' }).map((player) => player.id))
      .toEqual(['higher-outcome-lower-impact', 'lower-outcome-higher-impact', 'impact-withheld'])
  })

  it('uses the arrival endpoint as the minor-league near-term impact sort', () => {
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
      makePlayer({ id: 'lower-arrival', researchEstimate: estimate(0.2) }),
      makePlayer({ id: 'higher-arrival', researchEstimate: estimate(0.8) }),
    ]

    expect(filterAndSortPlayers(players, { ...baseFilters, sort: 'nearTermImpact' }).map((player) => player.id))
      .toEqual(['higher-arrival', 'lower-arrival'])
  })

  it('sorts MLB players by the career outcome rank behind Oracle Score', () => {
    const alphaSignal = (delta: number, eligible = true): NonNullable<CareerForecast['alphaSignal']> => ({
      version: 'alpha-signal-v1',
      status: 'research',
      tier: eligible ? 'watch' : 'none',
      basis: 'completed_seasons_only',
      featureSeason: 2025,
      eligible,
      rank: eligible ? 1 : null,
      rankScope: eligible ? 'current_mlb_eligible_absolute_alpha' : null,
      modeledProbability: 0.12,
      baseline: {
        probability: 0.02,
        minimumSeason: 1961,
        players: 800,
        landmarks: 2000,
        roleTrack: 'hitter',
        experienceBand: 'first',
        seasonNumberMin: 1,
        seasonNumberMax: 1,
        ageMin: 20,
        ageMax: 24,
        ageWindow: 2,
        resolvedOnly: true,
        referenceSeasonsBeforeFeature: true,
        playerEqualWeighted: true,
      },
      edge: { probabilityDelta: delta, liftMultiple: 6 },
      ceiling: {
        p90JawsMargin: 5,
        gatePassed: eligible,
        target: 'final_jaws_minus_career_to_date_standard',
      },
      runway: {
        age: 22,
        learnedTrackPrimeStartAge: 28,
        yearsToPrime: 6,
        minimumRequiredYears: 2,
        gatePassed: true,
      },
      nearTermImpact: {
        probability: 0.5,
        referenceBaseRate: 0.1,
        liftMultiple: 5,
        target: 'next_three_war_ge_global_training_q90',
      },
      historicalPace: null,
      gates: {
        supportedBaseline: true,
        completedEvidence: true,
        earlyCareer: true,
        prePrimeRunway: true,
        absoluteCeiling: eligible,
      },
      warnings: [],
    })
    const players = [
      makePlayer({
        id: 'lower-alpha',
        stage: 'early_mlb',
        careerForecast: makeForecast({ rank: 2, alphaSignal: alphaSignal(0.08) }),
      }),
      makePlayer({
        id: 'higher-alpha',
        stage: 'early_mlb',
        careerForecast: makeForecast({ rank: 1, alphaSignal: alphaSignal(0.2) }),
      }),
      makePlayer({
        id: 'failed-ceiling-gate',
        stage: 'early_mlb',
        careerForecast: makeForecast({ rank: 3, alphaSignal: alphaSignal(0.9, false) }),
      }),
      makePlayer({ id: 'minor-discovery', stage: 'early_mlb' }),
    ]

    expect(filterAndSortPlayers(players, { ...baseFilters, stage: 'MLB', sort: 'alphaOpportunity' }).map((player) => player.id))
      .toEqual(['higher-alpha', 'lower-alpha', 'failed-ceiling-gate', 'minor-discovery'])
  })

  it('sorts MiLB players by the career-ceiling rank behind Oracle Score', () => {
    const impactRanking = (rank: number, rankPercentile: number) => ({
      rank,
      rankPercentile,
    }) as NonNullable<PlayerRecord['milbImpactRanking']>
    const players = [
      makePlayer({
        id: 'minor-without-career-rank',
        milbImpactRanking: impactRanking(2, 99.9),
      }),
      makePlayer({
        id: 'minor-career-second',
        careerForecast: makeForecast({ rank: 2 }),
        milbImpactRanking: impactRanking(1, 100),
      }),
      makePlayer({
        id: 'minor-career-first',
        careerForecast: makeForecast({ rank: 1 }),
        milbImpactRanking: impactRanking(900, 86),
      }),
      makePlayer({
        id: 'minor-career-third',
        careerForecast: makeForecast({ rank: 3 }),
        milbImpactRanking: impactRanking(3, 99.9),
      }),
    ]

    expect(filterAndSortPlayers(players, {
      ...baseFilters,
      stage: 'Minors',
      sort: 'alphaOpportunity',
    }).map((player) => player.id)).toEqual([
      'minor-career-first',
      'minor-career-second',
      'minor-career-third',
      'minor-without-career-rank',
    ])
  })

  it('uses career-ceiling rank for a mapped MiLB player without an arrival trigger', () => {
    const players = [
      makePlayer({ id: 'unmapped' }),
      makePlayer({
        id: 'aiva-like',
        careerForecast: makeForecast({ rank: 258 }),
        milbAlphaSignal: {
          status: 'research',
          eligible: false,
          rank: null,
        } as NonNullable<PlayerRecord['milbAlphaSignal']>,
        milbImpactRanking: {
          rank: 258,
          rankPercentile: 96.017973,
        } as NonNullable<PlayerRecord['milbImpactRanking']>,
      }),
    ]

    expect(filterAndSortPlayers(players, {
      ...baseFilters,
      stage: 'Minors',
      sort: 'alphaOpportunity',
    }).map((player) => player.id)).toEqual(['aiva-like', 'unmapped'])
  })

  it('sorts the frozen arrival-anomaly rank without presenting raw probability order', () => {
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
      makePlayer({
        id: 'lower',
        researchEstimate: estimate(0.4),
        milbAlphaSignal: { status: 'research', eligible: true, rank: 1 } as NonNullable<PlayerRecord['milbAlphaSignal']>,
      }),
      makePlayer({
        id: 'higher',
        researchEstimate: estimate(0.7),
        milbAlphaSignal: { status: 'research', eligible: true, rank: 2 } as NonNullable<PlayerRecord['milbAlphaSignal']>,
      }),
    ]

    expect(
      filterAndSortPlayers(players, { ...baseFilters, stage: 'Minors', sort: 'arrival36' }).map((player) => player.id),
    ).toEqual(['lower', 'higher', 'unmatched'])
  })

  it('formats model values without converting invalid probabilities', () => {
    expect(formatSigned(3.2, ' pts')).toBe('+3.2 pts')
    expect(formatSigned(-1.5, ' pts')).toBe('-1.5 pts')
    expect(formatPercentagePointDelta(0.148)).toBe('+14.8 pp')
    expect(formatPercentagePointDelta(-0.02)).toBe('-2.0 pp')
    expect(formatOrdinal(91.4)).toBe('91st')
    expect(formatPercentileRank(99.8)).toBe('P99.8')
    expect(formatTopRankPercent(3, 6455)).toBe('Top <0.1%')
    expect(formatTopRankPercent(323, 6455)).toBe('Top 5.1%')
    expect(formatScore(72.25)).toBe('72.3')
    expect(formatScore(null)).toBe('—')
    expect(formatProbability(0.123)).toBe('12.3%')
    expect(formatProbability(84)).toBe('—')
    expect(formatWar(24.23)).toBe('24.2')
    expect(formatPosition('2/H')).toBe('C/DH')
    expect(formatPosition('SS/2B')).toBe('SS/2B')
    expect(formatPosition(null, 'Hitter')).toBe('Hitter')
    expect(developmentChapterLabel('AA')).toBe('Upper-minors development')
    expect(developmentChapterLabel('Rk')).toBe('Rookie-ball development')
    expect(stageLabel('recent_callup')).toBe('Rookie Track')
    expect(stageLabel('post_debut_minors')).toBe('MLB experience · current minor data')
    expect(stageLabel('established_mlb')).toBe('Established MLB')
  })

  it('summarizes prospects, rookie transitions, and established MLB cohorts separately', () => {
    expect(stageCoverageForPlayers([
      makePlayer({ id: 'minor' }),
      makePlayer({ id: 'callup', stage: 'recent_callup' }),
      makePlayer({ id: 'rookie', stage: 'early_mlb' }),
      makePlayer({ id: 'veteran', stage: 'established_mlb' }),
      makePlayer({ id: 'inactive', stage: 'inactive' }),
    ])).toEqual({ minors: 1, recentCallups: 1, mlb: 2 })
  })
})
