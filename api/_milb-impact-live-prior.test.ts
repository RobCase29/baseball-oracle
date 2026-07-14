import { describe, expect, it } from 'vitest'
import {
  liveMilbImpactPriorComponents,
  researchLiveMilbImpactPriorRanking,
  researchLiveMilbImpactPriorRankings,
  researchLiveMilbImpactPriorSummary,
  type LiveMilbImpactPriorInput,
} from './_milb-impact-live-prior.js'

const knownAt = '2026-07-14T12:00:00.000Z'

const acceptancePlayers: LiveMilbImpactPriorInput[] = [
  {
    mlbamId: 834597,
    playerType: 'Hitter',
    officialStatsObserved: true,
    season: 2026,
    knownAt,
    age: 18,
    level: 'Rk',
    teamName: 'FCL Mets',
    pa: 143,
    ba: 0.220,
    slg: 0.415,
    walkRate: 18 / 143,
    strikeoutRate: 52 / 143,
  },
  {
    mlbamId: 828557,
    playerType: 'Hitter',
    officialStatsObserved: true,
    season: 2026,
    knownAt,
    age: 19,
    level: 'A',
    teamName: 'Dunedin Blue Jays',
    pa: 330,
    ba: 0.268,
    slg: 0.423,
    walkRate: 27 / 330,
    strikeoutRate: 89 / 330,
  },
  {
    mlbamId: 815983,
    playerType: 'Hitter',
    officialStatsObserved: true,
    season: 2026,
    knownAt,
    age: 19,
    level: 'A',
    teamName: 'Fredericksburg Nationals',
    pa: 342,
    ba: 0.220,
    slg: 0.387,
    walkRate: 46 / 342,
    strikeoutRate: 89 / 342,
  },
  {
    mlbamId: 823658,
    playerType: 'Hitter',
    officialStatsObserved: true,
    season: 2026,
    knownAt,
    age: 22,
    level: 'A+',
    teamName: 'Wisconsin Timber Rattlers',
    pa: 298,
    ba: 0.249,
    slg: 0.369,
    walkRate: 60 / 298,
    strikeoutRate: 72 / 298,
  },
  {
    mlbamId: 828084,
    playerType: 'Hitter',
    officialStatsObserved: true,
    season: 2026,
    knownAt,
    age: 19,
    level: 'A',
    teamName: 'Charleston RiverDogs',
    pa: 140,
    ba: 0.252,
    slg: 0.390,
    walkRate: 11 / 140,
    strikeoutRate: 40 / 140,
  },
  {
    mlbamId: 828087,
    playerType: 'Hitter',
    officialStatsObserved: true,
    season: 2026,
    knownAt,
    age: 20,
    level: 'Rk',
    teamName: 'ACL Rangers',
    pa: 156,
    ba: 0.308,
    slg: 0.538,
    walkRate: 11 / 156,
    strikeoutRate: 45 / 156,
  },
  {
    mlbamId: 834234,
    playerType: 'Hitter',
    officialStatsObserved: true,
    season: 2026,
    knownAt,
    age: 19,
    level: 'Rk',
    teamName: 'FCL Astros',
    pa: 147,
    ba: 0.163,
    slg: 0.261,
    walkRate: 50 / 147,
    strikeoutRate: 44 / 147,
  },
  {
    mlbamId: 836688,
    playerType: 'Pitcher',
    officialStatsObserved: true,
    season: 2026,
    knownAt,
    age: 19,
    level: 'Rk',
    teamName: 'FCL Blue Jays',
    ip: 70 / 3,
    kMinusBbRate: (26 - 16) / 106,
  },
  {
    mlbamId: 703610,
    playerType: 'Pitcher',
    officialStatsObserved: true,
    season: 2026,
    knownAt,
    age: 22,
    level: 'AA',
    teamName: 'Northwest Arkansas Naturals',
    ip: 119 / 3,
    kMinusBbRate: (53 - 14) / 152,
  },
]

describe('live MiLB impact hierarchical prior', () => {
  it('scores every official-stat acceptance player with exact identity and unique batch ranks', () => {
    const rankings = researchLiveMilbImpactPriorRankings(acceptancePlayers)
    expect(rankings.size).toBe(acceptancePlayers.length)
    const values = [...rankings.values()]
    expect(new Set(values.map((ranking) => ranking.rank)).size).toBe(values.length)
    for (const ranking of values) {
      expect(ranking.reason).toBe('live_in_season_prior')
      expect(ranking.mappingStatus).toBe('insufficient_sample')
      expect(ranking.rankBasis).toBe('in_season_early_estimate')
      expect(ranking.featureSeason).toBe(2026)
      expect(ranking.featureAsOf).toBe(knownAt)
      expect(ranking.rank).toBeGreaterThan(0)
      expect(ranking.rank).toBeLessThanOrEqual(ranking.universeRows)
      expect(ranking.rankPercentile).toBeGreaterThanOrEqual(0)
      expect(ranking.rankPercentile).toBeLessThanOrEqual(100)
    }
  })

  it('places current performance into the fitted role-specific bands', () => {
    const jase = liveMilbImpactPriorComponents(acceptancePlayers[6]!)
    const seojun = liveMilbImpactPriorComponents(acceptancePlayers[7]!)
    const lamkin = liveMilbImpactPriorComponents(acceptancePlayers[8]!)
    expect(jase).toMatchObject({
      level: 'Rookie',
      ageBand: '19_or_younger',
      performanceBand: 'q4',
      hierarchyDepth: 4,
    })
    expect(seojun).toMatchObject({
      level: 'Rookie',
      performanceBand: 'q2',
      hierarchyDepth: 4,
    })
    expect(lamkin).toMatchObject({
      level: 'AA',
      ageBand: '22_23',
      performanceBand: 'q4',
      hierarchyDepth: 4,
    })
    expect(jase?.internalOrderingProbability).toBeCloseTo(0.03440882281956919, 14)
    expect(seojun?.internalOrderingProbability).toBeCloseTo(0.0045861221844233045, 14)
    expect(lamkin?.internalOrderingProbability).toBeCloseTo(0.22965566107980473, 14)
  })

  it('keeps the completed-season artifact authoritative and requires an official stat row', () => {
    expect(researchLiveMilbImpactPriorRanking({
      ...acceptancePlayers[0]!,
      officialStatsObserved: false,
    })).toBeNull()
    expect(researchLiveMilbImpactPriorRanking({
      ...acceptancePlayers[0]!,
      mlbamId: 804606,
    })).toBeNull()
  })

  it('maps DSL rookie evidence to the fitted foreign-rookie cohort', () => {
    expect(liveMilbImpactPriorComponents({
      ...acceptancePlayers[0]!,
      mlbamId: 999999,
      teamName: 'DSL Mets Orange',
    })).toMatchObject({ level: 'Foreign Rookie' })
  })

  it('publishes an explicit research-only reference contract', () => {
    expect(researchLiveMilbImpactPriorSummary).toMatchObject({
      status: 'research_only',
      releaseEligible: false,
      modelVersion: 'milb-impact-five-calendar-year-war-v1',
      priorModel: 'age_level_role_performance_prior',
      universeRows: 6455,
    })
  })
})
