import { describe, expect, it } from 'vitest'
import type { CareerForecast } from './_career-oracle-types.js'
import type { CareerOraclePreview, CareerPreviewPlayer } from './_career-oracle-preview.js'
import { researchMilbImpactRanking } from './_milb-impact.js'
import { researchMilbAlphaSignal, type ResearchMilbAlphaSignal } from './_research-arrival.js'
import {
  assignStageRanks,
  buildPlayerFacets,
  canonicalExternalId,
  currentMlbComparisonRole,
  currentMlbMetrics,
  currentOnlyMlbCandidates,
  dedupeMinorCandidates,
  frozenProspectRankUniverse,
  matchesQuery,
  mergeCurrentUniverse,
  matchesIfNoneMatch,
  mlbCandidates,
  minorCandidates,
  normalizeQueryText,
  normalizeSearchText,
  parseQuery,
  playerMapFeedItem,
  playerMapResponseMeta,
  playerHandlingAudit,
  playerPositionTokens,
  responseOrdering,
  searchRecovery,
  scoredMlbUniverse,
  sendJson,
  sortBoardCandidates,
  sortUnifiedCandidates,
  snapshotId,
  stageRelevantDataAsOf,
  shouldSuppressSlashLine,
  type PlayerQuery,
  type UnifiedBoardCandidate,
} from './players.js'
import { requireMlbIdentityCrosswalk } from './_mlb-identity-crosswalk.js'

const war = { p10: 1, p25: 5, p50: 12, p75: 24, p90: 40 }
const currentMlbRow = {
  bbref_id: 'example01',
  player_name: 'Example Player',
  season: 2026,
  observed_role: 'Hitter' as const,
  team: 'EX',
  position: 'CF',
  age: 24,
  b_pa: 300,
  b_war: 2.5,
  p_ip: null,
  p_ip_outs: 0,
  p_games: 0,
  p_games_started: 0,
  p_war: null,
  total_war: 2.5,
  current_war_percentile: 80,
  known_at: '2026-07-13T12:00:00.000Z',
}

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
      estimatedDebutAge: null,
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
    recentCallupPrior: null,
    ...patch,
  }
}

function query(patch: Partial<PlayerQuery> = {}): PlayerQuery {
  return {
    q: '',
    ids: [],
    stage: 'All',
    playerType: 'All',
    level: 'All',
    team: null,
    position: null,
    sort: 'alphaOpportunity',
    page: 1,
    limit: 50,
    view: 'full',
    ...patch,
  }
}

function joeMackPreview(): CareerOraclePreview {
  const mlbForecast = forecast(0.1, 10, 1, 0.5, 0.2)
  mlbForecast.publicationState = 'withheld'
  mlbForecast.rank = null
  mlbForecast.hofCaliberProbability = null
  mlbForecast.finalCareerWar = null
  mlbForecast.peakSevenWar = null
  mlbForecast.confidenceScore = null
  mlbForecast.confidenceState = 'Withheld'
  mlbForecast.warnings = [
    'partial_only_unvalidated_forecast_withheld',
    'partial_season_feature_fallback',
  ]
  if (mlbForecast.careerChapter) {
    mlbForecast.careerChapter = {
      ...mlbForecast.careerChapter,
      status: 'withheld',
      evidence: {
        ...mlbForecast.careerChapter.evidence,
        mlbSeasonNumber: 1,
      },
      exceptionalTrajectory: null,
    }
  }

  const prospectForecast = forecast(0.0023681, 0, 167, 0.25)
  prospectForecast.asOf = '2025-12-31T00:00:00.000Z'
  prospectForecast.finalCareerWar = {
    p10: -1.034,
    p25: -0.355,
    p50: 0,
    p75: 2.494,
    p90: 12.988,
  }
  prospectForecast.lineage.targetVersion = 'mlb-debut-age-mixed-final-standard-bridge-v1'

  const player: CareerPreviewPlayer = {
    id: 'bbref:mackjo02',
    name: 'Joe Mack',
    playerType: 'Hitter',
    stage: 'early_mlb',
    age: 23,
    organization: 'Miami Marlins',
    organizationCode: 'MIA',
    position: 'C',
    level: 'MLB',
    batsThrows: 'L/R',
    externalIds: { bbref: 'mackjo02', mlbam: 691788 },
    careerForecast: mlbForecast,
  }
  const prospectForecasts = Object.fromEntries(Array.from(
    { length: 6_455 },
    (_, index) => {
      const rank = index + 1
      const isJoe = rank === 167
      const key = isJoe ? '691788:hitter' : `${900_000 + index}:hitter`
      return [key, {
        key,
        mlbamId: isJoe ? '691788' : String(900_000 + index),
        playerType: 'Hitter' as const,
        canonicalPlayerId: isJoe ? 'mlbam:691788:hitter' : null,
        careerForecast: isJoe
          ? prospectForecast
          : { ...prospectForecast, rank },
      }]
    },
  ))

  return {
    schemaVersion: 'career-oracle-preview/v1',
    asOf: '2026-07-12T18:36:27.386Z',
    modelVersion: 'career-oracle-jaws-tournament-v2',
    targetVersion: 'hof-caliber-point-in-time-jaws-v1',
    dataVersion: null,
    providerVersion: null,
    releaseEligible: false,
    items: [player],
    prospectForecasts,
  }
}

describe('unified player ordering', () => {
  it('normalizes browser form-encoded spaces in player search text', () => {
    expect(normalizeQueryText('Nick+Kurtz')).toBe('Nick Kurtz')
    expect(normalizeQueryText('Peña')).toBe('Peña')
    expect(normalizeSearchText('Jesús Made')).toBe('jesus made')
  })

  it('defaults to the full response and accepts the compact player-map view', () => {
    const request = (url: string) => ({ url }) as Parameters<typeof parseQuery>[0]

    expect(parseQuery(request('/api/players'))?.view).toBe('full')
    expect(parseQuery(request('/api/players'))?.sort).toBe('name')
    expect(parseQuery(request('/api/players?stage=Minors'))?.sort).toBe('careerIndex')
    expect(parseQuery(request('/api/players?stage=All&sort=careerIndex'))?.sort).toBe('careerIndex')
    expect(parseQuery(request('/api/players?stage=All&sort=stageStanding'))).toBeNull()
    expect(parseQuery(request('/api/players?view=map'))?.view).toBe('map')
    expect(parseQuery(request('/api/players?view=prices'))).toBeNull()
    expect(parseQuery(request('/api/players?stage=RC'))?.stage).toBe('RC')

    const crossStage = parseQuery(request('/api/players?view=map&stage=All&sort=careerIndex'))
    expect(crossStage && responseOrdering(crossStage)).toEqual({
      requestedSort: 'careerIndex',
      appliedSort: 'careerIndex',
      legacyAliasUsed: false,
      metric: 'career_index',
      field: 'assessment.careerIndex.value',
      fieldExposed: true,
      direction: 'descending',
      scope: 'cross_stage',
      nulls: 'last',
      tieBreakers: [
        {
          metric: 'display_name',
          field: 'identity.name',
          fieldExposed: true,
          direction: 'ascending',
        },
        {
          metric: 'player_id',
          field: 'playerId',
          fieldExposed: true,
          direction: 'ascending',
        },
        {
          metric: 'player_map_route',
          field: 'assessment.route',
          fieldExposed: true,
          direction: 'ascending',
        },
      ],
    })

    const legacyAlias = parseQuery(request('/api/players?view=map&stage=MLB&sort=alphaOpportunity'))
    expect(legacyAlias && responseOrdering(legacyAlias)).toMatchObject({
      requestedSort: 'alphaOpportunity',
      appliedSort: 'stageStanding',
      legacyAliasUsed: true,
      metric: 'stage_standing',
      field: 'assessment.stageStanding.rank',
      fieldExposed: true,
      scope: 'stage',
      tieBreakers: [
        expect.objectContaining({ metric: 'player_id', field: 'playerId' }),
        expect.objectContaining({ metric: 'player_map_route', field: 'assessment.route' }),
      ],
    })

    const minorArrival = parseQuery(request('/api/players?stage=Minors&sort=arrival36'))
    expect(minorArrival && responseOrdering(minorArrival)).toMatchObject({
      metric: 'milb_alpha_signal_rank',
      field: 'milbAlphaSignal.rank',
      fieldExposed: true,
      direction: 'ascending',
    })

    const compactMlbWar = parseQuery(request('/api/players?view=map&stage=MLB&sort=finalWar'))
    expect(compactMlbWar && responseOrdering(compactMlbWar)).toMatchObject({
      metric: 'final_career_war_p50',
      field: null,
      fieldExposed: false,
      direction: 'descending',
    })
  })

  it('publishes a deterministic ETag and honors conditional GET requests', () => {
    function responseRecorder() {
      const headers = new Map<string, string>()
      let body: string | undefined
      const response = {
        statusCode: 0,
        setHeader(name: string, value: string) {
          headers.set(name.toLocaleLowerCase('en-US'), value)
        },
        removeHeader(name: string) {
          headers.delete(name.toLocaleLowerCase('en-US'))
        },
        end(value?: string) {
          body = value
        },
      } as unknown as Parameters<typeof sendJson>[1]
      return { response, headers, get body() { return body } }
    }

    const first = responseRecorder()
    sendJson(
      { method: 'GET', headers: {} } as Parameters<typeof sendJson>[0],
      first.response,
      200,
      { ok: true },
      'public, max-age=60',
    )
    const etag = first.headers.get('etag')
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/u)
    expect(first.response.statusCode).toBe(200)
    expect(first.body).toBe('{"ok":true}')

    const conditional = responseRecorder()
    sendJson(
      { method: 'GET', headers: { 'if-none-match': etag } } as Parameters<typeof sendJson>[0],
      conditional.response,
      200,
      { ok: true },
      'public, max-age=60',
    )
    expect(conditional.response.statusCode).toBe(304)
    expect(conditional.body).toBeUndefined()
    expect(conditional.headers.has('content-type')).toBe(false)

    const conditionalHead = responseRecorder()
    sendJson(
      { method: 'HEAD', headers: { 'if-none-match': '*' } } as Parameters<typeof sendJson>[0],
      conditionalHead.response,
      200,
      { ok: true },
      'public, max-age=60',
    )
    expect(conditionalHead.response.statusCode).toBe(304)
    expect(conditionalHead.body).toBeUndefined()

    expect(matchesIfNoneMatch(`W/${etag}`, etag!)).toBe(true)
    expect(matchesIfNoneMatch(`"old", W/${etag}`, etag!)).toBe(true)
    expect(matchesIfNoneMatch('*', etag!)).toBe(true)
    expect(matchesIfNoneMatch(['"old"', `W/${etag}`], etag!)).toBe(true)
    expect(matchesIfNoneMatch('"old"', etag!)).toBe(false)

    const changed = responseRecorder()
    sendJson(
      { method: 'HEAD', headers: { 'if-none-match': etag } } as Parameters<typeof sendJson>[0],
      changed.response,
      200,
      { ok: false },
      'public, max-age=60',
    )
    expect(changed.response.statusCode).toBe(200)
    expect(changed.body).toBeUndefined()
  })

  it('describes every accepted stage, sort, and view without hiding comparator direction', () => {
    const stageSorts = [
      'careerIndex',
      'stageStanding',
      'alphaOpportunity',
      'hofProbability',
      'nearTermImpact',
      'finalWar',
      'arrival36',
      'age',
      'name',
    ] as const
    const expected = (stage: 'Minors' | 'RC' | 'MLB', sort: typeof stageSorts[number]) => {
      if (sort === 'careerIndex') return ['career_index', 'descending'] as const
      if (sort === 'stageStanding' || sort === 'alphaOpportunity') {
        return ['stage_standing', 'ascending'] as const
      }
      if (sort === 'hofProbability') return ['hof_caliber_probability', 'descending'] as const
      if (sort === 'nearTermImpact') {
        return [
          stage === 'Minors' ? 'derived_arrival_probability_36' : 'exceptional_trajectory_probability',
          'descending',
        ] as const
      }
      if (sort === 'finalWar') return ['final_career_war_p50', 'descending'] as const
      if (sort === 'arrival36') {
        return [stage === 'Minors' ? 'milb_alpha_signal_rank' : 'arrival_probability_36', stage === 'Minors' ? 'ascending' : 'descending'] as const
      }
      return [sort === 'age' ? 'age' : 'display_name', 'ascending'] as const
    }

    for (const stage of ['Minors', 'RC', 'MLB'] as const) {
      for (const sort of stageSorts) {
        for (const view of ['full', 'map'] as const) {
          const parsed = parseQuery({
            url: `/api/players?stage=${stage}&sort=${sort}&view=${view}`,
          } as Parameters<typeof parseQuery>[0])
          expect(parsed).not.toBeNull()
          const ordering = responseOrdering(parsed!)
          const [metric, direction] = expected(stage, sort)
          expect([ordering.metric, ordering.direction], `${stage}/${sort}/${view}`).toEqual([
            metric,
            direction,
          ])
          expect(ordering.appliedSort).toBe(sort === 'alphaOpportunity' ? 'stageStanding' : sort)
          expect(ordering.legacyAliasUsed).toBe(sort === 'alphaOpportunity')
          expect(ordering.fieldExposed).toBe(ordering.field !== null)
          expect(ordering.tieBreakers.map((entry) => entry.metric).slice(-2)).toEqual([
            'player_id',
            'player_map_route',
          ])
        }
      }
    }

    for (const sort of ['name', 'age', 'careerIndex'] as const) {
      const parsed = parseQuery({
        url: `/api/players?stage=All&sort=${sort}&view=map`,
      } as Parameters<typeof parseQuery>[0])
      expect(parsed).not.toBeNull()
      expect(responseOrdering(parsed!).scope).toBe(sort === 'careerIndex' ? 'cross_stage' : 'directory')
    }
    for (const sort of stageSorts.filter((value) => !['name', 'age', 'careerIndex'].includes(value))) {
      expect(parseQuery({
        url: `/api/players?stage=All&sort=${sort}`,
      } as Parameters<typeof parseQuery>[0])).toBeNull()
    }
  })

  it('accepts a bounded exact player-ID batch and rejects malformed batches', () => {
    const request = (url: string) => ({ url }) as Parameters<typeof parseQuery>[0]
    const ids = ['bbref:judgeaa01', 'prospect-savant:mlbam:804109:hitters']

    expect(parseQuery(request(`/api/players?ids=${ids.join(',')}`))?.ids).toEqual(ids)
    expect(parseQuery(request('/api/players?ids=bbref:judgeaa01,bbref:judgeaa01'))).toBeNull()
    expect(parseQuery(request('/api/players?ids=bbref%3Ajudgeaa01%2C'))).toBeNull()
    expect(parseQuery(request('/api/players?ids=bbref%3Ajudgeaa01%2C%3Cscript%3E'))).toBeNull()
    expect(parseQuery(request(`/api/players?ids=${Array.from(
      { length: 51 },
      (_, index) => `bbref:player${index.toString().padStart(4, '0')}`,
    ).join(',')}`))).toBeNull()
  })

  it('matches an exact ID before applying the regular board filters', () => {
    const player = candidate('bbref:judgeaa01', { name: 'Aaron Judge' })

    expect(matchesQuery(player, query({ ids: ['bbref:judgeaa01'] }))).toBe(true)
    expect(matchesQuery(player, query({ ids: ['bbref:troutmi01'] }))).toBe(false)
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

  it('orders the legacy MiLB arrival view by alpha rank ascending', () => {
    const sorted = sortUnifiedCandidates([
      candidate('second', { milbAlphaSignal: { rank: 2 } as ResearchMilbAlphaSignal }),
      candidate('unranked', { milbAlphaSignal: null }),
      candidate('first', { milbAlphaSignal: { rank: 1 } as ResearchMilbAlphaSignal }),
    ], 'arrival36')

    expect(sorted.map((item) => item.id)).toEqual(['first', 'second', 'unranked'])
    expect(responseOrdering(query({ stage: 'Minors', sort: 'arrival36' }))).toMatchObject({
      metric: 'milb_alpha_signal_rank',
      direction: 'ascending',
    })
  })

  it('orders Career Index by fixed career-value magnitude before stage standing', () => {
    const sorted = sortUnifiedCandidates([
      candidate('best-rank-lower-value', { careerForecast: forecast(0.4, 5, 1) }),
      candidate('second-rank-higher-value', { careerForecast: forecast(0.2, 35, 2) }),
      candidate('withheld', { careerForecast: null }),
    ], 'careerIndex')

    expect(sorted.map((item) => item.id)).toEqual([
      'second-rank-higher-value',
      'best-rank-lower-value',
      'withheld',
    ])
  })

  it('recomputes MLB ranks while preserving frozen prospect ranks', () => {
    const withheldWithDiagnostics = forecast(0.99, 90, 1)
    withheldWithDiagnostics.publicationState = 'withheld'
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
      candidate('mlb-withheld', {
        source: 'mlb',
        stage: 'established_mlb',
        minorProfileId: null,
        careerForecast: withheldWithDiagnostics,
      }),
    ])
    const byId = new Map(ranked.map((item) => [item.id, item]))

    expect(byId.get('minor-first')?.careerForecast?.rank).toBe(800)
    expect(byId.get('minor-second')?.careerForecast?.rank).toBe(400)
    expect(byId.get('mlb-first')?.careerForecast?.rank).toBe(1)
    expect(byId.get('mlb-withheld')?.careerForecast?.rank).toBeNull()
    expect(byId.get('minor-second')?.careerForecast?.lineage.artifactRank).toBe(400)
    expect(byId.get('minor-second')?.careerForecast?.lineage.rankUniverse).toBe('frozen_prospect_forecast')
    expect(byId.get('mlb-first')?.careerForecast?.lineage.rankUniverse).toBe('current_mlb')
    expect(byId.get('withheld')?.careerForecast).toBeNull()
  })

  it('uses only scored MLB players as the Oracle Score rank universe', () => {
    const scored = candidate('scored', {
      source: 'mlb',
      stage: 'established_mlb',
      minorProfileId: null,
    })
    const unscored = candidate('unscored', {
      source: 'mlb',
      stage: 'established_mlb',
      minorProfileId: null,
      careerForecast: { ...forecast(0.1, 10, 50), rank: null },
    })

    expect(scoredMlbUniverse([scored, unscored, candidate('minor')])).toBe(1)
  })

  it('accepts only a complete frozen prospect rank universe', () => {
    const complete = joeMackPreview()
    expect(frozenProspectRankUniverse(complete)).toBe(6_455)

    const duplicate = joeMackPreview()
    duplicate.prospectForecasts['900000:hitter']!.careerForecast.rank = 167
    expect(frozenProspectRankUniverse(duplicate)).toBeNull()

    const gap = joeMackPreview()
    gap.prospectForecasts['900000:hitter']!.careerForecast.rank = null
    expect(frozenProspectRankUniverse(gap)).toBeNull()

    const truncatedTail = joeMackPreview()
    const lastRank = Object.values(truncatedTail.prospectForecasts)
      .find((entry) => entry.careerForecast.rank === 6_455)
    expect(lastRank).toBeDefined()
    lastRank!.careerForecast.rank = null
    expect(frozenProspectRankUniverse(truncatedTail)).toBeNull()

    const missingTail = joeMackPreview()
    const missingTailKey = Object.entries(missingTail.prospectForecasts)
      .find(([, entry]) => entry.careerForecast.rank === 6_455)?.[0]
    expect(missingTailKey).toBeDefined()
    delete missingTail.prospectForecasts[missingTailKey!]
    expect(frozenProspectRankUniverse(missingTail)).toBeNull()
    expect(frozenProspectRankUniverse(null)).toBeNull()
  })

  it('reports a source-relevant stats clock and is conservative for All players', () => {
    const minors = '2026-07-13T12:00:00.000Z'
    const mlb = '2026-07-12T12:00:00.000Z'

    expect(stageRelevantDataAsOf('Minors', minors, mlb)).toBe(minors)
    expect(stageRelevantDataAsOf('RC', minors, mlb)).toBe(mlb)
    expect(stageRelevantDataAsOf('MLB', minors, mlb)).toBe(mlb)
    expect(stageRelevantDataAsOf('All', minors, mlb)).toBe(mlb)
    expect(stageRelevantDataAsOf('All', minors, null)).toBeNull()
  })

  it('uses All as a directory by default while honoring an explicit cross-stage Career Index sort', () => {
    const items = [
      candidate('rank-first', { name: 'Zulu Prospect', age: 18, careerForecast: forecast(0.9, 90, 1) }),
      candidate('rank-last', { name: 'Alpha Veteran', age: 30, careerForecast: forecast(0.05, 5, 3) }),
      candidate('rank-middle', { name: 'Mike Rookie', age: 22, careerForecast: forecast(0.2, 20, 2) }),
    ]

    expect(sortBoardCandidates(items, { stage: 'All', sort: 'alphaOpportunity' }).map((item) => item.id))
      .toEqual(['rank-last', 'rank-middle', 'rank-first'])
    expect(sortBoardCandidates(items, { stage: 'All', sort: 'name' }).map((item) => item.id))
      .toEqual(['rank-last', 'rank-middle', 'rank-first'])
    expect(sortBoardCandidates(items, { stage: 'All', sort: 'age' }).map((item) => item.id))
      .toEqual(['rank-first', 'rank-middle', 'rank-last'])
    expect(sortBoardCandidates(items, { stage: 'All', sort: 'careerIndex' }).map((item) => item.id))
      .toEqual(['rank-middle', 'rank-last', 'rank-first'])
    expect(sortBoardCandidates(items, { stage: 'Minors', sort: 'alphaOpportunity' }).map((item) => item.id))
      .toEqual(['rank-first', 'rank-middle', 'rank-last'])
  })

  it('surfaces Rookie Track as its own cohort using the frozen prospect-prior rank', () => {
    const priorForecast = forecast(0.02, 15, 8)
    const items = [
      candidate('minor', { careerForecast: forecast(0.3, 30, 1) }),
      candidate('mlb', {
        source: 'mlb',
        stage: 'early_mlb',
        minorProfileId: null,
        careerForecast: forecast(0.4, 40, 1),
      }),
      candidate('rookie', {
        source: 'mlb',
        stage: 'recent_callup',
        minorProfileId: null,
        careerForecast: { ...forecast(0.1, 10, 2), rank: null },
        recentCallupPrior: {
          rank: 8,
          universe: 6_455,
          target: 'mlb-debut-age-mixed-final-standard-bridge-v1',
          asOf: '2025-12-31T00:00:00.000Z',
          forecast: priorForecast,
        },
      }),
      candidate('rookie-coverage-gap', {
        source: 'mlb',
        stage: 'recent_callup',
        minorProfileId: null,
        careerForecast: forecast(0.99, 99, 1),
        recentCallupPrior: null,
      }),
    ]

    expect(sortBoardCandidates(items, { stage: 'All', sort: 'alphaOpportunity' })
      .map((item) => item.id)).toEqual(['minor', 'mlb', 'rookie', 'rookie-coverage-gap'])
    expect(sortBoardCandidates(
      items.filter((item) => matchesQuery(item, query({ stage: 'RC' }))),
      { stage: 'RC', sort: 'alphaOpportunity' },
    ).map((item) => item.id)).toEqual(['rookie', 'rookie-coverage-gap'])
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
        'minor-high-arrival',
        'minor-low-arrival',
        'mlb-high-impact',
        'mlb-low-impact-high-hof',
        'mlb-withheld-impact',
      ])
    expect(sortBoardCandidates(
      items.filter((item) => item.source === 'mlb'),
      { stage: 'MLB', sort: 'nearTermImpact' },
    ).map((item) => item.id))
      .toEqual(['mlb-high-impact', 'mlb-low-impact-high-hof', 'mlb-withheld-impact'])
  })

  it('orders each stage by the career outcome rank behind Oracle Score', () => {
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
        careerForecast: forecast(0.2, 20, 2),
        milbAlphaSignal: jesusArrival,
        milbImpactRanking: jesusImpact,
      }),
      candidate('minor-first-alpha', {
        careerForecast: forecast(0.3, 30, 1),
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

    expect(sortBoardCandidates(
      items.filter((item) => item.source === 'mlb'),
      { stage: 'MLB', sort: 'alphaOpportunity' },
    )
      .map((item) => item.id))
      .toEqual([
        'mlb-first-alpha',
        'mlb-second-alpha',
        'mlb-ineligible',
      ])
    expect(sortBoardCandidates(
      items.filter((item) => item.source === 'minor'),
      { stage: 'Minors', sort: 'alphaOpportunity' },
    )
      .map((item) => item.id))
      .toEqual(['minor-first-alpha', 'minor-second-alpha', 'minor-discovery'])
  })

  it('uses the minor career forecast rank instead of direct MiLB impact rank', () => {
    const aivaArrival = researchMilbAlphaSignal('804109', 'Hitter')
    const aivaImpact = researchMilbImpactRanking('804109', 'Hitter')
    expect(aivaArrival?.eligible).toBe(false)
    expect(aivaImpact?.rank).toBe(258)

    const sorted = sortUnifiedCandidates([
      candidate('unmapped-profile', {
        milbAlphaSignal: null,
        milbImpactRanking: null,
        careerForecast: null,
      }),
      candidate('aiva-like', {
        milbAlphaSignal: aivaArrival,
        milbImpactRanking: aivaImpact,
        careerForecast: null,
      }),
      candidate('career-ranked', {
        milbAlphaSignal: null,
        milbImpactRanking: null,
        careerForecast: forecast(0.01, 2, 10),
      }),
    ], 'alphaOpportunity')

    expect(sorted.map((item) => item.id)).toEqual(['career-ranked', 'aiva-like', 'unmapped-profile'])
  })
})

describe('player-map feed contract', () => {
  it('contains only identity, external IDs, and the market-independent assessment', () => {
    const record = {
      id: 'prospect-savant:804109',
      name: 'Aiva Arquette',
      playerType: 'Hitter',
      stage: 'pre_debut',
      age: 22,
      level: 'AA',
      organization: 'Miami Marlins',
      organizationCode: 'MIA',
      position: 'SS',
      provenance: {
        externalIds: { mlbam: 804109, prospectSavant: 'aiva-arquette' },
      },
      researchEstimate: { horizons: [{ probability: 0.73 }] },
      careerForecast: { hofCaliberProbability: 0.04 },
      playerMap: {
        version: 'oracle-player-map/v2',
        state: 'discovery',
        careerIndex: {
          version: 'career-index-war-v1',
          value: 42.5,
          scale: 'fixed_career_value_index',
          route: 'milb',
          status: 'research',
          asOf: '2025-12-31T00:00:00.000Z',
          definition: 'Fixed career-value index from final-career WAR P50, P75, and P90 mapped to versioned WAR anchors; not a probability, percentile, confidence score, or expected WAR',
          forecastLineage: {
            modelVersion: 'career-v1',
            targetVersion: 'mlb-debut-age-mixed-final-standard-bridge-v1',
            dataVersion: 'data-v1',
            providerVersion: null,
          },
        },
        stageStanding: {
          version: 'stage-standing-v1',
          metric: 'prospect_career_outcome_rank',
          method: 'frozen_model_artifact_rank',
          direction: 'lower_is_better',
          scope: 'declared_model_cohort',
          isFilteredResultOrdinal: false,
          target: 'mlb-debut-age-mixed-final-standard-bridge-v1',
          rank: 258,
          universe: 6_455,
          topPercent: 4,
          tailBand: 'Top 5%',
          cohort: 'prospect_forecast',
          asOf: '2025-12-31T00:00:00.000Z',
        },
        oracleScore: {
          value: 96,
          scale: 'stage_rank_percentile',
          route: 'milb',
          rank: 258,
          universe: 6_455,
          target: 'mlb-debut-age-mixed-final-standard-bridge-v1',
          asOf: '2025-12-31T00:00:00.000Z',
          definition: 'Rounded stage-specific modeled outcome rank percentile; not a probability or composite score',
        },
        marketIndependent: true,
        marketInputsIncluded: false,
        careerIndexComparableAcrossRoutes: true,
        stageStandingComparableWithinStageOnly: true,
      },
    } as unknown as Parameters<typeof playerMapFeedItem>[0]

    const item = playerMapFeedItem(record)
    expect(Object.keys(item)).toEqual(['playerId', 'identity', 'externalIds', 'context', 'assessment'])
    expect(item.externalIds.mlbam).toBe('804109')
    expect(item.context).toMatchObject({ stage: 'pre_debut', organizationCode: 'MIA' })
    expect(item.assessment.careerIndex).toMatchObject({
      version: 'career-index-war-v1',
      value: 42.5,
      scale: 'fixed_career_value_index',
    })
    expect(item.assessment.careerIndex.forecastLineage).toMatchObject({
      modelVersion: 'career-v1',
      targetVersion: 'mlb-debut-age-mixed-final-standard-bridge-v1',
      dataVersion: 'data-v1',
    })
    expect(item.assessment.stageStanding).toMatchObject({
      version: 'stage-standing-v1',
      metric: 'prospect_career_outcome_rank',
      method: 'frozen_model_artifact_rank',
      direction: 'lower_is_better',
      scope: 'declared_model_cohort',
      isFilteredResultOrdinal: false,
      target: 'mlb-debut-age-mixed-final-standard-bridge-v1',
      rank: 258,
      universe: 6_455,
      tailBand: 'Top 5%',
      cohort: 'prospect_forecast',
    })
    expect(item.assessment.oracleScore).toMatchObject({
      deprecated: true,
      replacement: 'careerIndex',
      value: 96,
      rank: 258,
      universe: 6_455,
    })
    expect(item.assessment.marketIndependent).toBe(true)
    expect(item.assessment.careerIndexComparableAcrossRoutes).toBe(true)
    expect(item.assessment.stageStandingComparableWithinStageOnly).toBe(true)
    expect(canonicalExternalId(8_041_090)).toBe('8041090')
    expect(canonicalExternalId('000804109')).toBe('000804109')
    expect(canonicalExternalId(Number.MAX_SAFE_INTEGER + 1)).toBeNull()
    expect(canonicalExternalId(12.5)).toBeNull()
    expect(JSON.stringify(item)).not.toContain('researchEstimate')
    expect(JSON.stringify(item)).not.toContain('careerForecast')
    expect(JSON.stringify(item)).not.toContain('0.73')

    expect(playerMapResponseMeta([])).toMatchObject({
      playerMapVersion: 'oracle-player-map/v2',
      primaryScoreSemantics: 'fixed_career_value_index',
      scoreSemantics: 'stage_specific_ordinal_not_market_value',
      rankingContract: {
        version: 'player-ranking-contract/v1',
        primaryMetric: 'careerIndex',
        primarySort: 'careerIndex',
        primaryComparableAcrossRoutes: true,
        stageStandingMetric: 'stageStanding',
        stageStandingComparableWithinStageOnly: true,
        stageStandingIsFilteredResultOrdinal: false,
        legacyMetric: 'oracleScore',
        legacyDeprecated: true,
      },
    })

    const snapshotCandidates = [candidate('snapshot-player')]
    const censusSnapshot = snapshotId({
      minorDataAsOf: '2026-07-13T00:00:00.000Z',
      currentMlbDataAsOf: '2026-07-13T00:00:00.000Z',
      forecastDataVersion: 'data-v1',
      candidates: snapshotCandidates,
    })
    expect(censusSnapshot).toMatch(/^oracle-ranking-snapshot\/v1:[a-f0-9]{64}$/u)
    expect(snapshotId({
      minorDataAsOf: '2026-07-13T00:00:00.000Z',
      currentMlbDataAsOf: '2026-07-13T00:00:00.000Z',
      forecastDataVersion: 'data-v1',
      candidates: snapshotCandidates,
    })).toBe(censusSnapshot)
    expect(snapshotId({
      minorDataAsOf: '2026-07-14T00:00:00.000Z',
      currentMlbDataAsOf: '2026-07-13T00:00:00.000Z',
      forecastDataVersion: 'data-v1',
      candidates: snapshotCandidates,
    })).not.toBe(censusSnapshot)
    expect(snapshotId({
      minorDataAsOf: '2026-07-13T00:00:00.000Z',
      currentMlbDataAsOf: '2026-07-13T00:00:00.000Z',
      forecastDataVersion: 'data-v1',
      candidates: [candidate('snapshot-player', { name: 'Corrected identity' })],
    })).not.toBe(censusSnapshot)
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

  it('preserves an exact prospect prior on a first-season partial-only MLB call-up', () => {
    const preview = joeMackPreview()
    const [joe] = mlbCandidates(preview)

    expect(joe).toMatchObject({
      id: 'bbref:mackjo02',
      stage: 'recent_callup',
      mlbamId: '691788',
      recentCallupPrior: {
        rank: 167,
        universe: 6_455,
        target: 'mlb-debut-age-mixed-final-standard-bridge-v1',
        asOf: '2025-12-31T00:00:00.000Z',
      },
    })
    expect(joe?.careerForecast?.rank).toBeNull()
    expect(matchesQuery(joe!, query({ stage: 'RC' }))).toBe(true)
    expect(matchesQuery(joe!, query({ stage: 'MLB' }))).toBe(false)
    expect(matchesQuery(joe!, query({ stage: 'Minors' }))).toBe(false)

    const merged = mergeCurrentUniverse(
      [joe!],
      [candidate('joe-minor', { mlbamId: '691788' })],
    )
    expect(merged.items).toHaveLength(1)
    expect(merged.items[0]).toMatchObject({
      id: 'bbref:mackjo02',
      stage: 'recent_callup',
      recentCallupPrior: { rank: 167, universe: 6_455 },
    })
    expect(merged.crossStageDuplicatesRemoved).toBe(1)
  })

  it('keeps the same frozen prospect coordinate across a call-up', () => {
    const preview = joeMackPreview()
    const frozenForecast = preview.prospectForecasts['691788:hitter']!.careerForecast
    const [rookie] = mlbCandidates(preview)
    const [minor] = assignStageRanks([
      candidate('joe-minor', {
        mlbamId: '691788',
        careerForecast: frozenForecast,
      }),
    ])

    expect(frozenProspectRankUniverse(preview)).toBe(6_455)
    expect(minor?.careerForecast?.rank).toBe(167)
    expect(minor?.careerForecast?.lineage.rankUniverse).toBe('frozen_prospect_forecast')
    expect(rookie?.recentCallupPrior).toMatchObject({ rank: 167, universe: 6_455 })
  })

  it('excludes fail-closed prospect forecasts from the supported rank universe', () => {
    const preview = joeMackPreview()
    const entries = Object.values(preview.prospectForecasts)
    entries.at(-1)!.careerForecast.publicationState = 'withheld'
    entries.at(-1)!.careerForecast.rank = null

    expect(frozenProspectRankUniverse(preview)).toBe(6_454)
  })

  it('requires first-season partial-only state but keeps unmatched players in Rookie Track', () => {
    const laterCareer = joeMackPreview()
    const player = laterCareer.items[0]!
    player.careerForecast.careerChapter!.evidence.mlbSeasonNumber = 2
    expect(mlbCandidates(laterCareer)[0]).toMatchObject({
      stage: 'early_mlb',
      recentCallupPrior: null,
    })

    const roleMismatch = joeMackPreview()
    roleMismatch.prospectForecasts['691788:hitter']!.playerType = 'Pitcher'
    expect(mlbCandidates(roleMismatch)[0]).toMatchObject({
      stage: 'recent_callup',
      recentCallupPrior: null,
    })

    const withheldPrior = joeMackPreview()
    withheldPrior.prospectForecasts['691788:hitter']!.careerForecast.publicationState = 'withheld'
    expect(mlbCandidates(withheldPrior)[0]).toMatchObject({
      stage: 'recent_callup',
      recentCallupPrior: null,
    })

    const missingPrior = joeMackPreview()
    const unmatchedPlayer = missingPrior.items[0]!
    unmatchedPlayer.id = 'bbref:coverage01'
    unmatchedPlayer.name = 'Coverage Gap Rookie'
    unmatchedPlayer.externalIds = { bbref: 'covera01', mlbam: 700_001 }
    const [unmatched] = mlbCandidates(missingPrior)
    expect(unmatched).toMatchObject({
      id: 'bbref:coverage01',
      stage: 'recent_callup',
      mlbamId: '700001',
      recentCallupPrior: null,
    })
    expect(matchesQuery(unmatched!, query({ stage: 'RC' }))).toBe(true)
    expect(matchesQuery(unmatched!, query({ stage: 'MLB' }))).toBe(false)

    const [matched] = mlbCandidates(joeMackPreview())
    const rookieCohort = [unmatched!, matched!]
    expect(rookieCohort.filter((candidate) => candidate.stage === 'recent_callup')).toHaveLength(2)
    expect(sortBoardCandidates(rookieCohort, { stage: 'RC', sort: 'alphaOpportunity' })
      .map((candidate) => candidate.id)).toEqual(['bbref:mackjo02', 'bbref:coverage01'])
  })

  it('requires meaningful opportunity before assigning a current two-way comparison role', () => {
    expect(currentMlbComparisonRole({ plateAppearances: 0, pitchingOuts: 120 })).toBe('Pitcher')
    expect(currentMlbComparisonRole({ plateAppearances: 300, pitchingOuts: 3 })).toBe('Hitter')
    expect(currentMlbComparisonRole({ plateAppearances: 400, pitchingOuts: 255 })).toBe('Two-way')
  })

  it('suppresses nominal cross-page components from current MLB evidence', () => {
    const pitcher = {
      ...currentMlbRow,
      observed_role: 'Pitcher' as const,
      b_pa: 0,
      b_war: 0,
      p_ip: '40.0',
      p_ip_outs: 120,
      p_games: 30,
      p_games_started: 0,
      p_war: 1.2,
      total_war: 1.2,
    }
    const pitcherKeys = currentMlbMetrics(pitcher, 'Pitcher').map((metric) => metric.key)
    expect(pitcherKeys).toContain('current-season-pitching-war')
    expect(pitcherKeys).not.toContain('current-season-batting-war')
    expect(pitcherKeys).not.toContain('current-season-pa')

    const mopUpHitter = {
      ...currentMlbRow,
      p_ip: '1.0',
      p_ip_outs: 3,
      p_games: 1,
      p_games_started: 0,
      p_war: 0,
    }
    const hitterKeys = currentMlbMetrics(mopUpHitter, 'Hitter').map((metric) => metric.key)
    expect(hitterKeys).toContain('current-season-batting-war')
    expect(hitterKeys).not.toContain('current-season-pitching-war')
    expect(hitterKeys).not.toContain('current-season-ip')

    const ohtani = {
      ...currentMlbRow,
      observed_role: 'Two-way' as const,
      p_ip: '85.2',
      p_ip_outs: 257,
      p_games: 14,
      p_games_started: 14,
      p_war: 2.9,
      total_war: 6.1,
      current_war_percentile: null,
    }
    const twoWayKeys = currentMlbMetrics(ohtani, 'Two-way').map((metric) => metric.key)
    expect(twoWayKeys).toContain('current-season-batting-war')
    expect(twoWayKeys).toContain('current-season-pitching-war')
  })

  it('surfaces current MLB players outside the completed-season census without inventing a score', () => {
    const [candidate] = currentOnlyMlbCandidates([currentMlbRow], null)
    expect(candidate).toMatchObject({
      id: 'bbref:example01',
      name: 'Example Player',
      stage: 'recent_callup',
      careerForecast: null,
      recentCallupPrior: null,
      mlbamId: null,
    })
    expect(playerHandlingAudit([candidate!])).toMatchObject({
      activePlayers: 1,
      specialHandlingPlayers: 1,
      byCode: {
        rookie_prior_unmatched: 1,
        identity_link_missing: 1,
        forecast_not_available: 1,
      },
    })
  })

  it('bridges a new MLB appearance back to its exact frozen prospect prior', () => {
    const preview = joeMackPreview()
    preview.items = []
    const [candidate] = currentOnlyMlbCandidates([
      { ...currentMlbRow, bbref_id: 'mackjo02', player_name: 'Joe Mack' },
    ], preview)

    expect(candidate).toMatchObject({
      id: 'bbref:mackjo02',
      mlbamId: '691788',
      stage: 'recent_callup',
      recentCallupPrior: { rank: 167, universe: 6_455 },
    })
  })

  it('uses exact debut history to remove current debuts from the prospect cohort', () => {
    const baseRow = {
      profile_id: 'prospect-savant:682445',
      source_player_id: '682445',
      player_type: 'Hitter' as const,
      display_name: 'Domingo Gonzalez',
      organization_code: 'ATL',
      organization_name: 'Atlanta Braves',
      position: 'OF',
      age: 26,
      level: 'AAA',
      season: 2026,
      mlbam_id: null,
      known_at: '2026-07-13T12:00:00.000Z',
      pa: 200,
      ip: null,
      pitches: null,
    }
    const result = minorCandidates([
      baseRow,
      {
        ...baseRow,
        profile_id: 'prospect-savant:660271',
        source_player_id: '660271',
        display_name: 'Verified Veteran',
      },
    ], null, requireMlbIdentityCrosswalk())

    expect(result).toMatchObject({
      experiencedRowsExcludedFromProspectRankings: 2,
      currentSeasonDebutRowsSuppressed: 1,
      idsRecoveredFromExactCrosswalk: 2,
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      mlbamId: '660271',
      stage: 'post_debut_minors',
      careerForecast: null,
      milbAlphaSignal: null,
      milbImpactRanking: null,
    })
  })

  it('recovers punctuation-insensitive matches outside active board filters', () => {
    const ohtani = candidate('ohtani', {
      source: 'mlb',
      name: 'Shohei Ohtani',
      playerType: 'Two-way',
      stage: 'established_mlb',
      minorProfileId: null,
    })
    const recovery = searchRecovery(
      [ohtani],
      [],
      query({ q: 'two way', stage: 'RC' }),
    )
    expect(recovery?.outsideFilterMatches).toEqual([
      expect.objectContaining({ id: 'ohtani', name: 'Shohei Ohtani' }),
    ])
    expect(normalizeSearchText("O'Neill")).toBe(normalizeSearchText('oneill'))
    expect(normalizeSearchText('Crow-Armstrong')).toBe(normalizeSearchText('crow armstrong'))
  })
})
