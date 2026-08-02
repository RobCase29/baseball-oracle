import { describe, expect, it } from 'vitest'
import {
  buildBinderGraduationCatalog,
  buildBinderGraduationFeed,
} from './_binder-graduation-index.js'

const currentAt = new Date('2026-08-02T11:00:00.000Z')

describe('Backstop Binder Index feed', () => {
  it('builds one cross-sport graduation order with no sport quotas', () => {
    const catalog = buildBinderGraduationCatalog(currentAt)
    const feed = buildBinderGraduationFeed(catalog, {
      maxAge: 26,
      sort: 'graduation_rank',
      limit: 100,
    })
    const nonGraduates = feed.items.filter(
      (item) => item.graduation.status === 'ranked',
    )

    expect(feed.schemaVersion).toBe('backstop-binder-index.v1')
    expect(feed.meta.probabilityAvailable).toBe(false)
    expect(feed.meta.rankingPolicy).toContain('one_global_rank')
    expect(nonGraduates.slice(0, 6).map((item) => item.player.name)).toEqual([
      'Kon Knueppel',
      'Caleb Williams',
      'Jaxson Dart',
      'Dylan Harper',
      'Anthony Edwards',
      'Jayden Daniels',
    ])
    expect(new Set(
      nonGraduates.slice(0, 6).map((item) => item.player.sport),
    )).toEqual(new Set(['football', 'basketball']))
  })

  it('preserves global ranks after sport and age filters', () => {
    const catalog = buildBinderGraduationCatalog(currentAt)
    const all = buildBinderGraduationFeed(catalog, {
      maxAge: 26,
      limit: 100,
    })
    const football = buildBinderGraduationFeed(catalog, {
      sport: 'football',
      maxAge: 26,
      limit: 100,
    })
    const allCaleb = all.items.find(
      (item) => item.player.name === 'Caleb Williams',
    )
    const footballCaleb = football.items.find(
      (item) => item.player.name === 'Caleb Williams',
    )

    expect(footballCaleb?.graduation.globalRank).toBe(
      allCaleb?.graduation.globalRank,
    )
  })

  it('filters by readiness band without recasting the index as probability', () => {
    const catalog = buildBinderGraduationCatalog(currentAt)
    const onDeck = buildBinderGraduationFeed(catalog, {
      maxAge: 26,
      band: 'on_deck',
      limit: 100,
    })

    expect(onDeck.page.total).toBe(4)
    expect(onDeck.items.every(
      (item) =>
        item.graduation.band === 'on_deck' &&
        item.graduation.probability === null,
    )).toBe(true)
  })

  it('fails closed when a selected source is stale', () => {
    const catalog = buildBinderGraduationCatalog(
      new Date('2026-08-21T00:00:00.000Z'),
    )
    const feed = buildBinderGraduationFeed(catalog, {
      sport: 'football',
    })

    expect(feed.snapshot.freshness.status).toBe('stale')
    expect(feed.items).toEqual([])
    expect(feed.page.total).toBe(0)
  })
})
