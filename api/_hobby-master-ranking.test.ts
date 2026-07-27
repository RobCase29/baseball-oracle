import { describe, expect, it } from 'vitest'
import {
  buildHobbyMasterCatalog,
  buildHobbyMasterFeed,
  hobbyMasterCatalog,
} from './_hobby-master-ranking.js'
import {
  buildHobbyExitWindowSignal,
} from '../src/domain/hobbyLiquidationSignal.js'

const currentAt = new Date('2026-07-25T12:00:00.000Z')

describe('Hobby Oracle master-ranking catalog', () => {
  it('builds one contiguous observed-universe rank before filtering', () => {
    const catalog = buildHobbyMasterCatalog(
      hobbyMasterCatalog.snapshot,
      currentAt,
    )
    const ranks = catalog.items
      .map((item) => item.masterRank)
      .filter((rank): rank is number => rank !== null)
      .toSorted((left, right) => left - right)

    expect(catalog.items).toHaveLength(6_022)
    expect(catalog.rankingUniverseCount).toBe(5_866)
    expect(ranks).toHaveLength(5_866)
    expect(new Set(ranks).size).toBe(ranks.length)
    expect(ranks[0]).toBe(1)
    expect(ranks.at(-1)).toBe(ranks.length)
  })

  it('produces an absolute master order instead of interleaving cohort leaders', () => {
    const response = buildHobbyMasterFeed(hobbyMasterCatalog, {
      posture: 'build_candidate',
      sort: 'master_rank',
      limit: 100,
    })

    expect(response.page.total).toBe(23)
    expect(response.items.slice(0, 5).map((item) => item.subject.name))
      .toEqual([
        'Charizard',
        'Pikachu',
        'Shohei Ohtani',
        'Michael Jordan',
        'Victor Wembanyama',
      ])
    expect(response.cohorts.filter((cohort) => cohort.buildCount > 0))
      .toMatchObject([
        { domain: 'baseball', buildCount: 4 },
        { domain: 'basketball', buildCount: 6 },
        { domain: 'football', buildCount: 3 },
        { domain: 'pokemon', buildCount: 9 },
        { domain: 'soccer', buildCount: 1 },
      ])
    expect(response.cohorts.find((cohort) => cohort.domain === 'combat'))
      .toMatchObject({ buildCount: 0 })
    expect(response.cohorts.find((cohort) => cohort.domain === 'hockey'))
      .toMatchObject({ buildCount: 0 })
  })

  it('preserves master and cohort ranks under cohort and search filters', () => {
    const all = buildHobbyMasterFeed(hobbyMasterCatalog, {
      q: 'Tom Brady',
      limit: 10,
    })
    const football = buildHobbyMasterFeed(hobbyMasterCatalog, {
      domain: 'football',
      q: 'Tom Brady',
      limit: 10,
    })

    expect(all.items).toHaveLength(1)
    expect(football.items).toHaveLength(1)
    expect(football.items[0]?.masterRank).toBe(all.items[0]?.masterRank)
    expect(football.items[0]?.withinCohortRank)
      .toBe(all.items[0]?.withinCohortRank)
  })

  it('searches names naturally across punctuation and prioritizes relevance', () => {
    const initials = buildHobbyMasterFeed(hobbyMasterCatalog, {
      q: 'C.J. Stroud',
      posture: 'all',
      limit: 10,
    })
    const jordan = buildHobbyMasterFeed(hobbyMasterCatalog, {
      q: 'Michael Jordan',
      posture: 'all',
      limit: 10,
    })

    expect(initials.items[0]?.subject.name).toBe('CJ Stroud')
    expect(jordan.items[0]?.subject.name).toBe('Michael Jordan')
  })

  it('adds evidence-gated player age, Pokémon origin, and category-aware trend', () => {
    const ohtani = buildHobbyMasterFeed(hobbyMasterCatalog, {
      q: 'Shohei Ohtani',
      posture: 'all',
      limit: 1,
    }).items[0]
    const pikachu = buildHobbyMasterFeed(hobbyMasterCatalog, {
      q: 'Pikachu',
      posture: 'all',
      limit: 1,
    }).items[0]
    const calRaleigh = buildHobbyMasterFeed(hobbyMasterCatalog, {
      q: 'Cal Raleigh',
      posture: 'all',
      limit: 1,
    }).items[0]

    expect(ohtani?.subject.context).toMatchObject({
      age: 31,
      sourceId: 'backstop_player_rankings',
      evidence: 'verified_player_bridge',
    })
    expect(pikachu?.subject.context).toMatchObject({
      introducedYear: 1996,
      approximateYearsSinceIntroduction: 30,
      introducedGeneration: 1,
      nationalDexNumber: 25,
      evidence: 'canonical_species_match',
    })
    expect(calRaleigh?.assessment.salesTrend).toMatchObject({
      state: 'cooling',
      sixMonthChangePct: 50.3,
      recentThreeMonthChangePct: -45,
      relativeToDomain: 'ahead',
      evidence: 'mixed_window',
    })
  })

  it('attaches neutral Team Runway context without changing board order', () => {
    const baseline = buildHobbyMasterFeed(hobbyMasterCatalog, {
      domain: 'baseball',
      posture: 'all',
      sort: 'master_rank',
      limit: 100,
    })
    const changedContextCatalog = structuredClone(hobbyMasterCatalog)
    const changedMookie = changedContextCatalog.items.find(
      (item) => item.subject.name === 'Mookie Betts',
    )
    if (changedMookie?.subject.mobility) {
      changedMookie.subject.mobility.reasonCodes.push(
        'display_only_test_change',
      )
    }
    const withDisplayOnlyChange = buildHobbyMasterFeed(
      changedContextCatalog,
      {
        domain: 'baseball',
        posture: 'all',
        sort: 'master_rank',
        limit: 100,
      },
    )
    const mookie = buildHobbyMasterFeed(hobbyMasterCatalog, {
      q: 'Mookie Betts',
      posture: 'all',
      limit: 1,
    }).items[0]
    const ohtani = buildHobbyMasterFeed(hobbyMasterCatalog, {
      q: 'Shohei Ohtani',
      posture: 'all',
      limit: 1,
    }).items[0]
    const pikachu = buildHobbyMasterFeed(hobbyMasterCatalog, {
      q: 'Pikachu',
      posture: 'all',
      limit: 1,
    }).items[0]

    expect(mookie?.subject.mobility).toMatchObject({
      availability: 'observed',
      currentTeam: { code: 'LAD' },
      mobilityWindow: 'three_plus_seasons',
      term: {
        remainingSeasonsIncludingCurrent: 7,
        reportedThrough: { seasonEndYear: 2032 },
      },
    })
    expect(ohtani?.subject.mobility).toMatchObject({
      availability: 'observed',
      currentTeam: { code: 'LAD' },
      mobilityWindow: 'three_plus_seasons',
      term: {
        remainingSeasonsIncludingCurrent: 8,
        reportedThrough: { seasonEndYear: 2033 },
      },
    })
    expect(pikachu?.subject.mobility?.availability).toBe('not_applicable')
    expect(withDisplayOnlyChange.items.map((item) => [
      item.subject.id,
      item.masterRank,
    ])).toEqual(baseline.items.map((item) => [
      item.subject.id,
      item.masterRank,
    ]))
  })

  it('removes low-dollar cohort leaders from Build', () => {
    const conor = buildHobbyMasterFeed(hobbyMasterCatalog, {
      domain: 'combat',
      q: 'Conor McGregor',
      limit: 10,
    }).items[0]

    expect(conor).toBeDefined()
    expect(conor?.assessment.marketSignal.latestTwelveMonthSalesUsd)
      .toBe(989_161)
    expect(conor?.assessment.buildQualification.eligible).toBe(false)
    expect(conor?.assessment.posture).not.toBe('build_candidate')
  })

  it('suspends Build qualification when the monthly snapshot is stale', () => {
    const staleCatalog = buildHobbyMasterCatalog(
      hobbyMasterCatalog.snapshot,
      new Date('2026-08-21T00:00:00.000Z'),
    )
    const response = buildHobbyMasterFeed(staleCatalog, {
      posture: 'needs_refresh',
      limit: 100,
    })

    expect(staleCatalog.freshness.status).toBe('stale')
    expect(staleCatalog.items.every(
      (item) => !item.assessment.buildQualification.eligible,
    )).toBe(true)
    expect(response.page.total).toBe(6_022)
    expect(staleCatalog.items.every(
      (item) => !item.assessment.salesTrend.available,
    )).toBe(true)
    expect(staleCatalog.items.every(
      (item) => !item.assessment.breakoutSignal?.surfaced,
    )).toBe(true)
  })

  it('orders a complete Exit 100 by active demand and decline pressure', () => {
    const response = buildHobbyMasterFeed(hobbyMasterCatalog, {
      posture: 'all',
      sort: 'exit_window',
      direction: 'desc',
      limit: 100,
    })
    const signals = response.items.map(buildHobbyExitWindowSignal)

    expect(response.items).toHaveLength(100)
    expect(signals.every((signal) => signal.eligible)).toBe(true)
    expect(signals.every(
      (signal, index) =>
        index === 0 || signals[index - 1]!.score >= signal.score,
    )).toBe(true)
    expect(response.items.every(
      (item) =>
        item.assessment.posture !== 'build_candidate' &&
        item.assessment.posture !== 'hold_candidate',
    )).toBe(true)
    expect(response.items[0]?.subject.name).toBe('Jayden Daniels')
  })

  it('surfaces a fixed global Breakout Radar without changing Binder ranks', () => {
    const global = buildHobbyMasterFeed(hobbyMasterCatalog, {
      screen: 'breakout',
      posture: 'all',
      sort: 'breakout',
      direction: 'desc',
      limit: 100,
    })
    const baseball = buildHobbyMasterFeed(hobbyMasterCatalog, {
      screen: 'breakout',
      domain: 'baseball',
      posture: 'all',
      sort: 'breakout',
      direction: 'desc',
      limit: 100,
    })
    const cam = global.items.find(
      (item) => item.subject.name === 'Cam Schlittler',
    )
    const filteredCam = baseball.items.find(
      (item) => item.subject.name === 'Cam Schlittler',
    )

    expect(global.page.total).toBe(25)
    expect(global.items[0]?.subject.name).toBe('Cam Ward')
    expect(cam?.assessment.breakoutSignal).toMatchObject({
      rank: 2,
      score: 80,
      surfaced: true,
      evidence: 'volume_confirmed_cold_start',
      sixMonthDemandAddedUsd: 1_831_650,
      confirmingMonths: 6,
    })
    expect(cam?.assessment.salesTrend.sixMonthChangePct)
      .toBeGreaterThan(300_000)
    expect(filteredCam?.assessment.breakoutSignal?.rank).toBe(2)
    expect(filteredCam?.masterRank).toBe(cam?.masterRank)
    expect(filteredCam?.assessment.marketSignal.score)
      .toBe(cam?.assessment.marketSignal.score)
  })
})
