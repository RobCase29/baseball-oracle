import { describe, expect, it } from 'vitest'
import type { MlbIdentityCrosswalk } from './_mlb-identity-crosswalk.js'
import { composeMlbIdentityCrosswalk } from './_mlb-identity-overlay.js'

const observedAt = '2026-07-13T12:00:00.000Z'
const chadwickLookup = {
  byKeyPerson(value: string | null) {
    if (value === null) return null
    return new Map([
      ['a1b2c3d4', 800_325],
      ['0a0b0c0d', 123],
    ]).get(value) ?? null
  },
}

function staticCrosswalk(): MlbIdentityCrosswalk {
  const records = new Map([
    [660_271, {
      mlbam: 660_271,
      bbref: 'ohtansh01',
      firstMlbSeason: 2018,
      lastMlbSeason: 2026,
      seasonEvidence: 'baseball-reference-player-seasons' as const,
    }],
  ])
  return {
    summary: {
      schemaVersion: 'mlb-identity-crosswalk/v1',
      asOf: '2026-07-13T00:00:00.000Z',
      identityPolicy: 'exact_mlbam_bbref_only_no_name_matching',
      recordCount: 1,
      coverage: {
        recordsWithBbref: 1,
        baseballReferenceSeasonEvidence: 1,
        chadwickSeasonEvidence: 0,
        crosswalkOnly: 0,
      },
      source: {} as MlbIdentityCrosswalk['summary']['source'],
    },
    byMlbam(value) {
      const parsed = typeof value === 'bigint' ? Number(value) : Number(value)
      return Number.isSafeInteger(parsed) ? records.get(parsed) ?? null : null
    },
    byBbref(value) {
      return [...records.values()].find((record) => record.bbref === value) ?? null
    },
  }
}

describe('composed MLB identity crosswalk', () => {
  it('adds a durable exact debut overlay without changing static records', () => {
    const composed = composeMlbIdentityCrosswalk(staticCrosswalk(), [{
      bbref_id: 'newdebu01',
      chadwick_key: 'a1b2c3d4',
      mlbam_id: '800325',
      first_mlb_season: 2026,
      first_observed_at: observedAt,
      last_observed_at: observedAt,
    }], chadwickLookup)

    expect(composed.crosswalk.byBbref('newdebu01')).toMatchObject({
      mlbam: 800_325,
      firstMlbSeason: 2026,
    })
    expect(composed.crosswalk.byMlbam(800_325)).toMatchObject({ bbref: 'newdebu01' })
    expect(composed.crosswalk.byBbref('ohtansh01')).toMatchObject({ mlbam: 660_271 })
    expect(composed.overlay).toMatchObject({
      acceptedRecords: 1,
      conflicts: [],
      newestObservedAt: '2026-07-13T12:00:00.000Z',
    })
  })

  it('fails closed on static conflicts and malformed evidence', () => {
    const composed = composeMlbIdentityCrosswalk(staticCrosswalk(), [
      {
        bbref_id: 'ohtansh01',
        chadwick_key: '0a0b0c0d',
        mlbam_id: 123,
        first_mlb_season: 2026,
        first_observed_at: observedAt,
        last_observed_at: observedAt,
      },
      {
        bbref_id: 'UPPER',
        chadwick_key: 'not-a-key',
        mlbam_id: 456,
        first_mlb_season: 2026,
        first_observed_at: observedAt,
        last_observed_at: observedAt,
      },
    ], chadwickLookup)

    expect(composed.overlay.acceptedRecords).toBe(0)
    expect(composed.overlay.conflicts.map((conflict) => conflict.reason)).toEqual([
      'static_bbref_conflict',
      'invalid_overlay_row',
    ])
    expect(composed.crosswalk.byBbref('ohtansh01')).toMatchObject({ mlbam: 660_271 })
  })

  it('promotes a crosswalk-only static identity to observed MLB experience', () => {
    const base = staticCrosswalk()
    const originalByMlbam = base.byMlbam
    const originalByBbref = base.byBbref
    const unresolved = {
      mlbam: 800_325,
      bbref: 'newdebu01',
      firstMlbSeason: null,
      lastMlbSeason: null,
      seasonEvidence: null,
    }
    base.byMlbam = (value) => Number(value) === unresolved.mlbam
      ? unresolved
      : originalByMlbam(value)
    base.byBbref = (value) => value === unresolved.bbref
      ? unresolved
      : originalByBbref(value)

    const composed = composeMlbIdentityCrosswalk(base, [{
      bbref_id: unresolved.bbref,
      chadwick_key: 'a1b2c3d4',
      mlbam_id: unresolved.mlbam,
      first_mlb_season: 2026,
      first_observed_at: observedAt,
      last_observed_at: observedAt,
    }], chadwickLookup)

    expect(composed.crosswalk.byMlbam(unresolved.mlbam)).toMatchObject({
      firstMlbSeason: 2026,
      lastMlbSeason: 2026,
    })
  })

  it('preserves a veteran MLBAM-only career span when an exact BRef link arrives', () => {
    const base = staticCrosswalk()
    const originalByMlbam = base.byMlbam
    const veteran = {
      mlbam: 800_325,
      bbref: null,
      firstMlbSeason: 2016,
      lastMlbSeason: 2025,
      seasonEvidence: 'chadwick-register' as const,
    }
    base.byMlbam = (value) => Number(value) === veteran.mlbam
      ? veteran
      : originalByMlbam(value)

    const composed = composeMlbIdentityCrosswalk(base, [{
      bbref_id: 'veteran01',
      chadwick_key: 'a1b2c3d4',
      mlbam_id: veteran.mlbam,
      first_mlb_season: 2026,
      first_observed_at: observedAt,
      last_observed_at: observedAt,
    }], chadwickLookup)

    expect(composed.crosswalk.byBbref('veteran01')).toMatchObject({
      mlbam: veteran.mlbam,
      bbref: 'veteran01',
      firstMlbSeason: 2016,
      lastMlbSeason: 2025,
      seasonEvidence: 'chadwick-register',
    })
  })

  it('rejects unknown, conflicting, and reused Chadwick keys', () => {
    const composed = composeMlbIdentityCrosswalk(staticCrosswalk(), [
      {
        bbref_id: 'unknown01',
        chadwick_key: 'ffffffff',
        mlbam_id: 111,
        first_mlb_season: 2026,
        first_observed_at: observedAt,
        last_observed_at: observedAt,
      },
      {
        bbref_id: 'wrongmap01',
        chadwick_key: 'a1b2c3d4',
        mlbam_id: 111,
        first_mlb_season: 2026,
        first_observed_at: observedAt,
        last_observed_at: observedAt,
      },
      {
        bbref_id: 'accepted01',
        chadwick_key: 'a1b2c3d4',
        mlbam_id: 800_325,
        first_mlb_season: 2026,
        first_observed_at: observedAt,
        last_observed_at: observedAt,
      },
      {
        bbref_id: 'duplicate01',
        chadwick_key: 'a1b2c3d4',
        mlbam_id: 800_325,
        first_mlb_season: 2026,
        first_observed_at: observedAt,
        last_observed_at: observedAt,
      },
    ], chadwickLookup)

    expect(composed.overlay.acceptedRecords).toBe(1)
    expect(composed.overlay.conflicts.map((conflict) => conflict.reason)).toEqual([
      'unknown_chadwick',
      'chadwick_mlbam_conflict',
      'duplicate_chadwick',
    ])
  })
})
