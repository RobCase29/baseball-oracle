import { describe, expect, it } from 'vitest'
import {
  buildBaseballGraduationUniverseFromRows,
} from './_baseball-graduation-universe.js'
import {
  buildBinderGraduationV2Catalog,
  buildBinderGraduationV2Feed,
} from './_binder-graduation-index-v2.js'

const currentAt = new Date('2026-07-25T01:00:00.000Z')

function catalog() {
  return buildBinderGraduationV2Catalog(
    buildBaseballGraduationUniverseFromRows([], currentAt),
    currentAt,
  )
}

describe('Backstop Binder Index v2 unified feed', () => {
  it('earns baseball places in the same global order', () => {
    const feed = buildBinderGraduationV2Feed(catalog(), {
      maxAge: 26,
      sort: 'graduation_rank',
      limit: 100,
    })
    const paulSkenes = feed.items.find(
      (item) => item.player.name === 'Paul Skenes',
    )

    expect(feed.schemaVersion).toBe('backstop-binder-index.v2')
    expect(feed.meta.sports).toEqual([
      'baseball',
      'football',
      'basketball',
    ])
    expect(feed.meta.coverageBySport.baseball).toBeGreaterThan(100)
    expect(paulSkenes).toMatchObject({
      player: {
        sport: 'baseball',
        developmentStage: 'early_career',
      },
      graduation: {
        globalRank: 8,
        probability: null,
      },
      playerSignal: {
        basis: 'career_index_route_outcome',
        ageTreatment: 'development_runway_embedded_in_outlook',
      },
    })
    expect(new Set(
      feed.items.slice(0, 12).map((item) => item.player.sport),
    )).toEqual(new Set(['baseball', 'football', 'basketball']))
  })

  it('preserves the global rank when baseball is selected', () => {
    const unifiedCatalog = catalog()
    const all = buildBinderGraduationV2Feed(unifiedCatalog, {
      maxAge: 26,
      limit: 100,
    })
    const baseball = buildBinderGraduationV2Feed(unifiedCatalog, {
      sport: 'baseball',
      maxAge: 26,
      limit: 100,
    })
    const allSkenes = all.items.find(
      (item) => item.player.name === 'Paul Skenes',
    )
    const baseballSkenes = baseball.items.find(
      (item) => item.player.name === 'Paul Skenes',
    )

    expect(baseballSkenes?.graduation.globalRank).toBe(
      allSkenes?.graduation.globalRank,
    )
    expect(baseball.items.every(
      (item) => item.player.sport === 'baseball',
    )).toBe(true)
  })

  it('finds a player when mobile punctuation differs from the source name', () => {
    const feed = buildBinderGraduationV2Feed(catalog(), {
      q: 'CJ Stroud',
      sport: 'all',
      limit: 10,
    })

    expect(feed.items[0]?.player.name).toBe('C.J. Stroud')
  })

  it('uses sport-specific outlooks against one absolute market target', () => {
    const feed = buildBinderGraduationV2Feed(catalog(), {
      maxAge: 26,
      limit: 100,
    })
    const baseball = feed.items.find(
      (item) => item.player.sport === 'baseball',
    )
    const football = feed.items.find(
      (item) => item.player.sport === 'football',
    )

    expect(baseball?.playerSignal.basis).toBe(
      'career_index_route_outcome',
    )
    expect(football?.playerSignal.basis).toBe(
      'dynasty_market_consensus',
    )
    expect(baseball?.graduation.target).toEqual(
      football?.graduation.target,
    )
    expect(feed.meta.playerModelPolicy).toContain(
      'sport_specific_player_outlook_models',
    )
  })
})
