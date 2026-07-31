import { describe, expect, it } from 'vitest'
import { isHobbyPlayerRankingsResponse } from '../src/domain/hobbyPlayerRanking.js'
import {
  buildHobbyPlayerRankingCatalog,
  buildHobbyPlayerRankingsFeed,
  hobbyPlayerRankingCatalog,
  parseHobbyPlayerSignalExchange,
} from './_hobby-player-rankings.js'

const currentAt = new Date('2026-07-31T19:00:00.000Z')

describe('Hobby player ranking catalog', () => {
  it('reconciles Checklist v2 through reviewed identity controls and chronology quarantine', () => {
    const exchange = parseHobbyPlayerSignalExchange(
      hobbyPlayerRankingCatalog.exchange,
    )
    const catalog = buildHobbyPlayerRankingCatalog(
      exchange,
      undefined,
      currentAt,
    )

    expect(exchange.rows).toHaveLength(864)
    expect(catalog.items).toHaveLength(585)
    expect(catalog.items.filter(
      (item) => item.sport === 'football',
    )).toHaveLength(298)
    expect(catalog.items.filter(
      (item) => item.sport === 'basketball',
    )).toHaveLength(287)
    expect(catalog.quarantine).toEqual({
      total: 279,
      ambiguousProviderIdentity: 0,
      ambiguousMarketIdentity: 2,
      missingMarketMatch: 263,
      incompleteProviderRanks: 7,
      invalidAge: 1,
      identityControlBlocked: 2,
      impossibleGradedChronology: 4,
    })
    expect(catalog.items.every(
      (item) =>
        [
          'reviewed_exact',
          'reviewed_alias',
          'unique_normalized_name',
        ].includes(item.identity.status) &&
        item.recordVersion === 'hobby-player-ranking-item/v2' &&
        item.evidence.marketHistoryMonths === 18,
    )).toBe(true)
    expect(catalog.items.filter(
      (item) => item.identity.status === 'reviewed_alias',
    )).toHaveLength(7)
    expect(catalog.items.some(
      (item) =>
        ['Josh Allen', 'Kyle Williams'].includes(item.name) &&
        item.sport === 'football',
    )).toBe(false)
    expect(catalog.items.some(
      (item) =>
        item.name === 'A.J. Brown' &&
        item.sport === 'football',
    )).toBe(false)
    expect(catalog.items.some(
      (item) =>
        item.name === 'Christian McCaffrey' &&
        item.sport === 'football',
    )).toBe(true)
    expect(catalog.items.some(
      (item) =>
        item.name === 'Tyler Warren' &&
        item.sport === 'football',
    )).toBe(true)
    expect(catalog.items.find(
      (item) =>
        item.name === 'Jayson Tatum' &&
        item.sport === 'basketball',
    )).toMatchObject({
      posture: 'Build',
      identity: {
        status: 'reviewed_exact',
        manualReviewStatus: 'approved',
      },
    })
    expect(catalog.items.filter(
      (item) => item.sport === 'football' && item.age === null,
    )).toHaveLength(7)
    expect(catalog.coverageBySport.football).toEqual({
      sourceRows: 464,
      rankedRows: 298,
      coveragePercent: 64.22,
    })
  })

  it('ranks within sport and requires every evidence gate for Build', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      currentAt,
    )
    const football = buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'football',
      limit: 100,
    })
    const basketball = buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'basketball',
      limit: 100,
    })

    expect(football.items[0]?.sportRank).toBe(1)
    expect(basketball.items[0]?.sportRank).toBe(1)
    expect(football.items.every(
      (item) => item.sport === 'football',
    )).toBe(true)
    expect(basketball.items.every(
      (item) => item.sport === 'basketball',
    )).toBe(true)
    for (const item of [...football.items, ...basketball.items]) {
      if (item.posture !== 'Build') continue
      expect(item.gates.buildEligible).toBe(true)
      expect(Object.values(item.gates.checks).every(Boolean)).toBe(true)
      expect(item.identity.manualReviewStatus).toBe('approved')
    }
    expect(football.cohorts.find(
      (cohort) => cohort.sport === 'football',
    )?.buildCount).toBeGreaterThan(0)
    expect(basketball.cohorts.find(
      (cohort) => cohort.sport === 'basketball',
    )?.buildCount).toBeGreaterThan(0)
  })

  it('re-ranks an age and position screen without rewriting sport rank', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      currentAt,
    )
    const response = buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'football',
      maxAge: 26,
      position: 'WR',
      sort: 'age',
      limit: 100,
    })

    expect(response.page.total).toBeGreaterThan(20)
    expect(response.items.every(
      (item) =>
        item.age !== null &&
        item.age <= 26 &&
        item.positions.includes('WR'),
    )).toBe(true)
    expect(response.items.every((item, index, items) => {
      if (index === 0) return true
      const priorAge = items[index - 1]!.age
      return (
        priorAge !== null &&
        item.age !== null &&
        priorAge <= item.age
      )
    })).toBe(true)
    expect(response.items.some(
      (item) => item.screenRank !== item.sportRank,
    )).toBe(true)
    expect(new Set(
      response.items.map((item) => item.screenRank),
    ).size).toBe(response.items.length)
    expect(response.scope).toEqual({
      sport: 'football',
      screen: {
        maxAge: 26,
        position: 'WR',
        posture: 'all',
      },
    })
    expect(response.screenSummary.rankedCount).toBe(response.page.total)
    expect(
      response.screenSummary.buildCount +
      response.screenSummary.researchCount +
      response.screenSummary.watchCount +
      response.screenSummary.deprioritizeCount,
    ).toBe(response.screenSummary.rankedCount)
    expect(response.meta.quarantine).toEqual(
      catalog.quarantineBySport.football,
    )
    expect(response.meta.globalQuarantine).toEqual(catalog.quarantine)
    expect(response.meta.coverage).toEqual(
      catalog.coverageBySport.football,
    )
  })

  it('fails closed when required source freshness expires', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      new Date('2026-08-21T00:00:00.000Z'),
    )
    const response = buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'basketball',
    })

    expect(response.snapshot.freshness.status).toBe('stale')
    expect(response.snapshot.freshness.reasonCodes).toContain(
      'basketball_ranking_publication_suspended',
    )
    expect(response.items).toEqual([])
    expect(response.page.total).toBe(0)
    expect(response.cohorts.find(
      (cohort) => cohort.sport === 'basketball',
    )?.rankedCount).toBe(0)
  })

  it('fails closed when a ranking artifact claims a future timestamp', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      new Date('2026-07-24T20:00:00.000Z'),
    )
    const response = buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'football',
    })

    expect(response.snapshot.freshness.status).toBe('unknown')
    expect(response.snapshot.freshness.reasonCodes).toContain(
      'identity_review_reviewed_timestamp_in_future',
    )
    expect(response.items).toEqual([])
    expect(response.page.total).toBe(0)
    expect(response.screenSummary.rankedCount).toBe(0)
  })

  it('rejects non-current publication and internally inconsistent counts', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      currentAt,
    )
    const response = buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'football',
      limit: 100,
    })

    expect(isHobbyPlayerRankingsResponse(response)).toBe(true)

    const unknownWithItems = structuredClone(response)
    unknownWithItems.snapshot.freshness.status = 'unknown'
    expect(isHobbyPlayerRankingsResponse(unknownWithItems)).toBe(false)

    const badScreenCounts = structuredClone(response)
    badScreenCounts.screenSummary.buildCount += 1
    expect(isHobbyPlayerRankingsResponse(badScreenCounts)).toBe(false)

    const badCohortCounts = structuredClone(response)
    badCohortCounts.cohorts[0]!.watchCount += 1
    expect(isHobbyPlayerRankingsResponse(badCohortCounts)).toBe(false)
  })

  it('rejects a changed exchange payload instead of silently trusting it', () => {
    const changed = structuredClone(hobbyPlayerRankingCatalog.exchange)
    changed.rows[0]!.sourceDisplayName = 'Changed Player'

    expect(() => parseHobbyPlayerSignalExchange(changed)).toThrow(
      /failed validation|failed reconciliation/u,
    )
  })
})
