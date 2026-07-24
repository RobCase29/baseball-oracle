import { describe, expect, it } from 'vitest'
import {
  buildHobbyPlayerRankingCatalog,
  buildHobbyPlayerRankingsFeed,
  hobbyPlayerRankingCatalog,
  parseHobbyPlayerSignalExchange,
} from './_hobby-player-rankings.js'

const currentAt = new Date('2026-07-24T20:00:00.000Z')

describe('Hobby player ranking catalog', () => {
  it('reconciles the strict Checklist exchange into unique exact market joins', () => {
    const exchange = parseHobbyPlayerSignalExchange(
      hobbyPlayerRankingCatalog.exchange,
    )
    const catalog = buildHobbyPlayerRankingCatalog(
      exchange,
      undefined,
      currentAt,
    )

    expect(exchange.rows).toHaveLength(864)
    expect(catalog.items).toHaveLength(574)
    expect(catalog.items.filter(
      (item) => item.sport === 'football',
    )).toHaveLength(287)
    expect(catalog.items.filter(
      (item) => item.sport === 'basketball',
    )).toHaveLength(287)
    expect(catalog.quarantine).toEqual({
      total: 290,
      ambiguousProviderIdentity: 0,
      ambiguousMarketIdentity: 2,
      missingMarketMatch: 253,
      incompleteProviderRanks: 7,
      invalidAge: 28,
    })
    expect(catalog.items.every(
      (item) =>
        item.identity.status === 'unique_exact' &&
        item.evidence.marketHistoryMonths === 18,
    )).toBe(true)
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
      (item) => item.age <= 26 && item.positions.includes('WR'),
    )).toBe(true)
    expect(response.items.every(
      (item, index, items) =>
        index === 0 || items[index - 1]!.age <= item.age,
    )).toBe(true)
    expect(response.items.some(
      (item) => item.screenRank !== item.sportRank,
    )).toBe(true)
    expect(new Set(
      response.items.map((item) => item.screenRank),
    ).size).toBe(response.items.length)
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

  it('rejects a changed exchange payload instead of silently trusting it', () => {
    const changed = structuredClone(hobbyPlayerRankingCatalog.exchange)
    changed.rows[0]!.sourceDisplayName = 'Changed Player'

    expect(() => parseHobbyPlayerSignalExchange(changed)).toThrow(
      /failed validation|failed reconciliation/u,
    )
  })
})
