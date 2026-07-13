import { describe, expect, it } from 'vitest'
import {
  assessMlbIdentityCrosswalkFreshness,
  loadMlbIdentityCrosswalk,
  requireMlbIdentityCrosswalk,
  validateMlbIdentityCrosswalkArtifact,
} from './_mlb-identity-crosswalk.js'

const sha256 = 'a'.repeat(64)

function artifactFixture() {
  return {
    schemaVersion: 'mlb-identity-crosswalk/v1',
    asOf: '2026-07-12T18:30:20.537Z',
    identityPolicy: 'exact_mlbam_bbref_only_no_name_matching',
    recordCount: 3,
    coverage: {
      recordsWithBbref: 2,
      baseballReferenceSeasonEvidence: 1,
      chadwickSeasonEvidence: 1,
      crosswalkOnly: 1,
    },
    source: {
      chadwickRegister: {
        version: '7e23e7dfaff51b3ae72c16393703eda7e5ecad27',
        sourceLockPath: 'data/source-lock.json',
        sourceLockSha256: sha256,
        shards: Array.from({ length: 16 }, (_, index) => ({
          path: `data/raw/chadwick-register/people-${index.toString(16)}.csv`,
          sha256,
          bytes: 100,
        })),
      },
      baseballReferencePlayerSeasons: {
        path: 'data/processed/baseball-reference-mlb-war/player_seasons.json',
        sha256,
        bytes: 1_000,
        rows: 10,
        manifestPath: 'data/processed/baseball-reference-mlb-war/manifest.json',
        manifestSha256: sha256,
        referenceLockPath: 'data/reference-locks/baseball-reference-mlb-war.json',
        referenceLockSha256: sha256,
        generatedAt: '2026-07-12T18:30:20.537Z',
      },
    },
    recordShape: [
      'mlbam',
      'bbref',
      'firstMlbSeason',
      'lastMlbSeason',
      'seasonEvidence',
    ],
    records: [
      [100, 'exactaa01', 2020, 2026, 'bref'],
      [101, null, 2024, 2024, 'chadwick'],
      [102, 'futureaa01', null, null, null],
    ],
  }
}

describe('MLB identity crosswalk', () => {
  it('loads the committed exact-ID artifact and resolves current debut edge cases', () => {
    const crosswalk = requireMlbIdentityCrosswalk()

    expect(crosswalk.summary).toMatchObject({
      schemaVersion: 'mlb-identity-crosswalk/v1',
      recordCount: 23_764,
      coverage: {
        recordsWithBbref: 23_763,
        baseballReferenceSeasonEvidence: 23_603,
        chadwickSeasonEvidence: 1,
        crosswalkOnly: 160,
      },
    })
    expect(crosswalk.byBbref('ohtansh01')).toEqual({
      mlbam: 660_271,
      bbref: 'ohtansh01',
      firstMlbSeason: 2018,
      lastMlbSeason: 2026,
      seasonEvidence: 'baseball-reference-player-seasons',
    })
    expect(crosswalk.byMlbam('682445')).toMatchObject({
      bbref: 'gonzado01',
      firstMlbSeason: 2026,
    })
    expect(crosswalk.byMlbam(681_252)).toMatchObject({
      bbref: 'anderja02',
      firstMlbSeason: 2026,
    })
    expect(crosswalk.byBbref('laralu01')).toMatchObject({
      mlbam: 800_325,
      firstMlbSeason: 2026,
      seasonEvidence: 'baseball-reference-player-seasons',
    })
    expect(crosswalk.byMlbam(671_155)).toEqual({
      mlbam: 671_155,
      bbref: 'johnsiv01',
      firstMlbSeason: 2026,
      lastMlbSeason: 2026,
      seasonEvidence: 'baseball-reference-player-seasons',
    })
  })

  it('rejects malformed lookup identifiers rather than normalizing them fuzzily', () => {
    const crosswalk = requireMlbIdentityCrosswalk()

    expect(crosswalk.byMlbam(' 660271')).toBeNull()
    expect(crosswalk.byMlbam('660271.0')).toBeNull()
    expect(crosswalk.byMlbam(-1)).toBeNull()
    expect(crosswalk.byBbref('OHTANSH01')).toBeNull()
    expect(crosswalk.byBbref(' ohtansh01')).toBeNull()
    expect(crosswalk.byBbref(null)).toBeNull()
    expect(crosswalk.byBbref("o'bermi01")).toMatchObject({
      bbref: "o'bermi01",
      firstMlbSeason: 1979,
    })
  })

  it('rejects duplicate identities and inconsistent debut evidence', () => {
    const duplicate = structuredClone(artifactFixture())
    duplicate.records[1]![0] = 100
    expect(() => validateMlbIdentityCrosswalkArtifact(duplicate)).toThrow(/unique|Duplicate/iu)

    const incomplete = structuredClone(artifactFixture())
    incomplete.records[0]![3] = null
    expect(() => validateMlbIdentityCrosswalkArtifact(incomplete)).toThrow(/season span/iu)

    const namePolicyDrift = structuredClone(artifactFixture())
    namePolicyDrift.identityPolicy = 'name_matching_allowed'
    expect(() => validateMlbIdentityCrosswalkArtifact(namePolicyDrift)).toThrow()
  })

  it('uses the newest exact-ID source as the artifact clock', () => {
    const fixture = artifactFixture()
    fixture.asOf = '2026-07-13T19:29:41.606Z'
    Object.assign(fixture.source, {
      baseballReferenceChadwickLinks: {
        path: 'data/reference-locks/baseball-reference-chadwick-identity-links-2026-07-13.json',
        sha256,
        asOf: fixture.asOf,
        records: 13,
        identityPolicy: 'exact_bbref_page_meta_to_pinned_chadwick_key_no_name_matching',
      },
    })

    expect(validateMlbIdentityCrosswalkArtifact(fixture).asOf).toBe(fixture.asOf)
    const staleClock = structuredClone(fixture)
    staleClock.asOf = '2026-07-12T18:30:20.537Z'
    expect(() => validateMlbIdentityCrosswalkArtifact(staleClock)).toThrow(/newest exact-ID source/iu)
  })

  it('returns null for a missing artifact path', () => {
    expect(loadMlbIdentityCrosswalk('/definitely/missing/crosswalk.json')).toBeNull()
  })

  it('makes stale exact-ID coverage operationally visible', () => {
    expect(assessMlbIdentityCrosswalkFreshness(
      '2026-07-12T18:30:20.537Z',
      new Date('2026-07-13T18:30:20.537Z'),
    )).toMatchObject({ status: 'current', ageHours: 24, maxAgeHours: 168 })
    expect(assessMlbIdentityCrosswalkFreshness(
      '2026-07-01T00:00:00.000Z',
      new Date('2026-07-13T00:00:00.000Z'),
    )).toMatchObject({ status: 'stale', ageHours: 288 })
    expect(assessMlbIdentityCrosswalkFreshness(
      'not-a-date',
      new Date('2026-07-13T00:00:00.000Z'),
    )).toMatchObject({ status: 'invalid', ageHours: null })
  })
})
