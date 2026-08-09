import { describe, expect, it } from 'vitest'
import {
  binderBaseballModelFreshness,
  binderMarketCatalog,
  binderMarketFreshness,
  binderMarketInputForPlayer,
  binderMarketNextExpectedBy,
  buildCandidateBinderScore,
  parseGemRateSnapshot,
} from './_binder-scores.js'

describe('GemRate Binder market snapshot', () => {
  it('loads the checked-in licensed baseball snapshot and verifies its hash', () => {
    const snapshot = parseGemRateSnapshot(binderMarketCatalog.snapshot)

    expect(snapshot.metadata).toMatchObject({
      sourceRowCount: 5000,
      baseballRowCount: 2060,
    })
    expect(snapshot.metadata.ambiguousNormalizedNames).toHaveLength(4)
    expect(binderMarketCatalog.ambiguousNormalizedNames.size).toBe(5)
    expect(snapshot.source.permissionBasis).toBe('licensed_user_provided_permission')
  })

  it('matches only unique normalized names attached to an exact Oracle identity', () => {
    const matched = binderMarketInputForPlayer({
      playerName: 'Shohei Ohtani',
      mlbamId: '660271',
      age: 31,
      normalizedOracleNameCount: 1,
      now: new Date('2026-07-24T00:00:00.000Z'),
    })
    const profileOnly = binderMarketInputForPlayer({
      playerName: 'Shohei Ohtani',
      mlbamId: null,
      age: 31,
      normalizedOracleNameCount: 1,
    })

    expect(matched).toMatchObject({
      sourcePlayerName: 'Shohei Ohtani',
      identityStatus: 'manual_verified',
      cohortId: 'gemrate-baseball-trailing-12m-2026-06',
    })
    expect(matched?.monthlySalesUsd).toHaveLength(12)
    expect(matched?.trailingTwelveMonthDemandPercentile).toBeGreaterThan(99)
    expect(profileOnly).toBeNull()
  })

  it('fails closed for a known source-name ambiguity', () => {
    const result = binderMarketInputForPlayer({
      playerName: 'Jesús Made',
      mlbamId: '123',
      age: 19,
      normalizedOracleNameCount: 1,
    })

    expect(result).toMatchObject({
      identityStatus: 'ambiguous',
      trailingTwelveMonthDemandPercentile: null,
      monthlySalesUsd: [],
    })
  })

  it('quarantines a mixed-era homonym and leaves unreviewed exact names provisional', () => {
    const homonym = binderMarketInputForPlayer({
      playerName: 'Will Smith',
      mlbamId: '669257',
      age: 31,
      normalizedOracleNameCount: 1,
    })
    const provisional = binderMarketInputForPlayer({
      playerName: 'Aaron Nola',
      mlbamId: '605400',
      age: 33,
      normalizedOracleNameCount: 1,
    })

    expect(homonym).toMatchObject({
      identityStatus: 'ambiguous',
      trailingTwelveMonthDemandPercentile: null,
    })
    expect(provisional).toMatchObject({
      identityStatus: 'unique_normalized_name',
    })
  })

  it('uses a monthly freshness deadline instead of pretending the feed is daily', () => {
    expect(binderMarketNextExpectedBy('2026-06-30')).toBe(
      '2026-08-20T00:00:00.000Z',
    )
    expect(
      binderMarketFreshness(new Date('2026-08-19T23:59:59.000Z')).status,
    ).toBe('current')
    expect(
      binderMarketFreshness(new Date('2026-08-20T00:00:00.001Z')).status,
    ).toBe('stale')
  })

  it('keeps the latest completed-season model current only through the next offseason', () => {
    expect(
      binderBaseballModelFreshness(
        '2025-12-31T00:00:00.000Z',
        new Date('2026-07-24T00:00:00.000Z'),
      ).status,
    ).toBe('current')
    expect(
      binderBaseballModelFreshness(
        '2025-12-31T00:00:00.000Z',
        new Date('2027-04-01T00:00:00.000Z'),
      ),
    ).toMatchObject({
      status: 'stale',
      reasonCodes: ['completed_season_career_model_overdue'],
    })
    expect(binderBaseballModelFreshness(null)).toMatchObject({
      status: 'unknown',
      reasonCodes: ['career_model_timestamp_unavailable'],
    })
  })

  it('builds an actionable research score without calling sales volume appreciation', () => {
    const result = buildCandidateBinderScore({
      candidate: {
        player: {
          id: 'mlbam:660271',
          name: 'Shohei Ohtani',
          age: 32,
          route: 'established_mlb',
        },
        baseball: {
          careerIndex: 96,
          routeOutcomePercentile: 99,
          freshness: {
            status: 'current',
            dataAsOf: '2025-12-31T00:00:00.000Z',
          },
        },
      },
      mlbamId: '660271',
      normalizedOracleNameCount: 1,
      now: new Date('2026-07-24T00:00:00.000Z'),
    })

    expect(result.score).toBeGreaterThan(75)
    expect(result.action).toBe('build')
    expect(result.semantics.marketMeaning).toContain('not_price_appreciation')
    expect(result.confidence.band).toBe('moderate')
  })
})
