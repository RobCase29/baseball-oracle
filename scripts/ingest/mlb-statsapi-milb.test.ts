import { describe, expect, it } from 'vitest'
import {
  assertMlbStatsApiMilbCurrentCardinality,
  MLB_STATSAPI_MILB_CURRENT_MINIMUM_ROWS,
} from './current-refresh-quality.js'
import {
  buildMlbStatsApiMilbSlices,
  buildMlbStatsApiMilbUrl,
  mlbStatsApiMilbSourceRecordKey,
  parseMlbStatsApiMilbEnvelope,
  type MlbStatsApiMilbSlice,
} from './mlb-statsapi-milb.js'

const hitterSlice: MlbStatsApiMilbSlice = {
  season: 2026,
  role: 'hitter',
  level: 'A',
  sportId: 14,
}

function hitterRecord(overrides: Record<string, unknown> = {}) {
  return {
    season: '2026',
    stat: {
      gamesPlayed: 42,
      plateAppearances: 180,
      atBats: 150,
      hits: 42,
      baseOnBalls: 24,
      strikeOuts: 31,
    },
    team: { id: 100, name: 'A Club', parentOrgId: 146 },
    player: {
      id: 829854,
      fullName: 'Luis Arana',
      active: true,
      currentTeam: { id: 100, name: 'A Club', parentOrgId: 146 },
    },
    sport: { id: 14, abbreviation: 'A' },
    position: { abbreviation: 'SS' },
    ...overrides,
  }
}

function response(records: unknown[], totalSplits = records.length, group = 'hitting') {
  return JSON.stringify({
    copyright: 'MLB Advanced Media',
    stats: [
      {
        type: { displayName: 'season' },
        group: { displayName: group },
        totalSplits,
        splits: records,
      },
    ],
  })
}

describe('MLB StatsAPI MiLB current-season ingestion contract', () => {
  it('builds all role and level slices while holding Rookie ball on its own clock', () => {
    const slices = buildMlbStatsApiMilbSlices({ season: 2027, rookieSeason: 2026 })

    expect(slices).toHaveLength(10)
    expect(slices.filter((slice) => slice.level === 'Rk'))
      .toEqual([
        { season: 2026, role: 'hitter', level: 'Rk', sportId: 16 },
        { season: 2026, role: 'pitcher', level: 'Rk', sportId: 16 },
      ])
    expect(slices.filter((slice) => slice.level !== 'Rk')
      .every((slice) => slice.season === 2027)).toBe(true)
  })

  it('uses an unqualified all-player query with current-team hydration', () => {
    const url = new URL(buildMlbStatsApiMilbUrl(hitterSlice))

    expect(url.origin).toBe('https://statsapi.mlb.com')
    expect(url.pathname).toBe('/api/v1/stats')
    expect(url.searchParams.get('stats')).toBe('season')
    expect(url.searchParams.get('group')).toBe('hitting')
    expect(url.searchParams.get('sportIds')).toBe('14')
    expect(url.searchParams.get('playerPool')).toBe('ALL')
    expect(url.searchParams.get('limit')).toBe('5000')
    expect(url.searchParams.get('hydrate')).toBe('person(currentTeam),team')
  })

  it('accepts only complete exact-MLBAM rows at the requested season and level', () => {
    const parsed = parseMlbStatsApiMilbEnvelope(response([hitterRecord()]), hitterSlice)

    expect(parsed.records).toHaveLength(1)
    expect(parsed.semanticQuality).toMatchObject({
      expectedRows: 1,
      observedRows: 1,
      exactMlbamRows: 1,
      uniqueMlbamRows: 1,
      matchingSeasonRows: 1,
      matchingSportRows: 1,
      validCoreRows: 1,
    })
    expect(mlbStatsApiMilbSourceRecordKey(parsed.records[0], hitterSlice)).toBe(
      'mlbam:829854|role:hitter|season:2026|level:A|sport:14',
    )
  })

  it('rejects a paginated response that does not contain every reported split', () => {
    expect(() =>
      parseMlbStatsApiMilbEnvelope(response([hitterRecord()], 2), hitterSlice),
    ).toThrow('returned 1 of 2 rows')
  })

  it('rejects duplicate identities and mismatched sport metadata', () => {
    expect(() =>
      parseMlbStatsApiMilbEnvelope(
        response([hitterRecord(), hitterRecord({ sport: { id: 13 } })]),
        hitterSlice,
      ),
    ).toThrow('exact-ID/schema gate')
  })

  it('requires outs-based workload for pitchers', () => {
    const pitcherSlice: MlbStatsApiMilbSlice = {
      season: 2026,
      role: 'pitcher',
      level: 'AA',
      sportId: 12,
    }
    const pitcher = hitterRecord({
      sport: { id: 12, abbreviation: 'AA' },
      stat: {
        gamesPlayed: 10,
        outs: 75,
        inningsPitched: '25.0',
        battersFaced: 101,
        numberOfPitches: 390,
        hits: 21,
        baseOnBalls: 8,
        strikeOuts: 30,
        earnedRuns: 9,
      },
    })

    expect(
      parseMlbStatsApiMilbEnvelope(response([pitcher], 1, 'pitching'), pitcherSlice)
        .semanticQuality.roleCoreRule,
    ).toBe('pitcher_outs_workload_and_rates')

    const invalidPitcher = {
      ...pitcher,
      stat: { ...(pitcher.stat as Record<string, unknown>), outs: undefined },
    }
    expect(() =>
      parseMlbStatsApiMilbEnvelope(
        response([invalidPitcher], 1, 'pitching'),
        pitcherSlice,
      ),
    ).toThrow('exact-ID/schema gate')
  })

  it('rejects implausibly small refreshes and large drops from the prior slice', () => {
    expect(() =>
      assertMlbStatsApiMilbCurrentCardinality(
        MLB_STATSAPI_MILB_CURRENT_MINIMUM_ROWS - 1,
        hitterSlice,
        null,
      ),
    ).toThrow(`requires at least ${MLB_STATSAPI_MILB_CURRENT_MINIMUM_ROWS}`)
    expect(() =>
      assertMlbStatsApiMilbCurrentCardinality(299, hitterSlice, 500),
    ).toThrow('requires at least 300')
    expect(assertMlbStatsApiMilbCurrentCardinality(300, hitterSlice, 500))
      .toMatchObject({ requiredRows: 300, observedRows: 300, previousRows: 500 })
  })
})
