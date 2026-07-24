import { describe, expect, it } from 'vitest'
import {
  buildMagnificentXCatalog,
  buildMagnificentXFeed,
  magnificentXCatalog,
  magnificentXFreshness,
  parseHobbySnapshot,
} from './_magnificent-x.js'

describe('Magnificent X hobby catalog', () => {
  it('validates the licensed, hashed 18-month all-hobby snapshot', () => {
    const snapshot = parseHobbySnapshot(magnificentXCatalog.snapshot)

    expect(snapshot.metadata).toMatchObject({
      athleteRowCount: 5_000,
      pokemonRowCount: 1_022,
      subjectRowCount: 6_022,
      overlapChecks: 36_132,
    })
    expect(snapshot.historyMonths).toHaveLength(18)
    expect(snapshot.metadata.cohortCounts).toContainEqual({
      domain: 'baseball',
      sourceCategory: '⚾',
      taxonomyStatus: 'coherent_provider_cohort',
      rowCount: 2_064,
    })
    expect(snapshot.sources.every(
      (source) => source.permissionBasis === 'licensed_user_provided_permission',
    )).toBe(true)
  })

  it('builds every subject but emits zero false durable-investment designations', () => {
    const catalog = buildMagnificentXCatalog(
      magnificentXCatalog.snapshot,
      new Date('2026-07-24T20:00:00.000Z'),
    )

    expect(catalog.items).toHaveLength(6_022)
    expect(catalog.items.some(
      (item) => item.subject.type === 'pokemon_character',
    )).toBe(true)
    expect(catalog.items.every(
      (item) => item.assessment.magnificentX.eligible === false,
    )).toBe(true)
    expect(catalog.cohortSummaries.every(
      (cohort) => cohort.magnificentEligibleCount === 0,
    )).toBe(true)
  })

  it('filters Pokémon leaders and publishes comparison and card-level limits', () => {
    const response = buildMagnificentXFeed(magnificentXCatalog, {
      domain: 'pokemon',
      tier: 'market_leader',
      q: 'char',
      limit: 10,
    })

    expect(response.items.map((item) => item.subject.name)).toContain('Charizard')
    expect(response.items.every(
      (item) => item.subject.domain === 'pokemon' &&
        item.assessment.researchTier === 'market_leader',
    )).toBe(true)
    expect(response.meta).toMatchObject({
      researchOnly: true,
      investmentAdvice: false,
      magnificentEligibleCount: 0,
      globalRankingAvailable: false,
      exactCardRecommendationsAvailable: false,
      ageIncluded: false,
    })
    expect(response.snapshot).toMatchObject({
      historyMonths: 18,
      dataThrough: '2026-06-30',
    })
  })

  it('uses a monthly deadline and becomes stale rather than silently aging', () => {
    expect(
      magnificentXFreshness(
        '2026-06-30',
        new Date('2026-08-20T00:00:00.000Z'),
      ).status,
    ).toBe('current')
    expect(
      magnificentXFreshness(
        '2026-06-30',
        new Date('2026-08-20T00:00:00.001Z'),
      ),
    ).toMatchObject({
      status: 'stale',
      reasonCodes: ['gemrate_monthly_snapshot_overdue'],
    })
  })
})
