import { describe, expect, it } from 'vitest'
import {
  loadChadwickKeyMlbamLookup,
  requireChadwickKeyMlbamLookup,
  validateChadwickKeyMlbamArtifact,
} from './_chadwick-key-mlbam.js'

const sha256 = 'a'.repeat(64)

function fixture() {
  return {
    schemaVersion: 'chadwick-key-mlbam/v1',
    asOf: '2026-07-11T22:48:51.000Z',
    identityPolicy: 'exact_chadwick_key_person_to_mlbam_no_name_matching',
    recordCount: 2,
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
    },
    recordShape: ['keyPerson', 'mlbam'],
    records: [
      ['00000001', 100],
      ['00000002', 101],
    ],
  }
}

describe('pinned Chadwick key/MLBAM lookup', () => {
  it('loads the committed name-free bridge in both exact directions', () => {
    const lookup = requireChadwickKeyMlbamLookup()

    expect(lookup.summary).toMatchObject({
      schemaVersion: 'chadwick-key-mlbam/v1',
      recordCount: 128_914,
      identityPolicy: 'exact_chadwick_key_person_to_mlbam_no_name_matching',
    })
    expect(lookup.byKeyPerson('5401e885')).toBe(800_325)
    expect(lookup.keyPersonByMlbam(800_325)).toBe('5401e885')
    expect(lookup.byKeyPerson('5401E885')).toBeNull()
    expect(lookup.keyPersonByMlbam('0800325')).toBeNull()
  })

  it('rejects unordered keys, duplicate MLBAM IDs, and lineage drift', () => {
    const unordered = structuredClone(fixture())
    unordered.records.reverse()
    expect(() => validateChadwickKeyMlbamArtifact(unordered)).toThrow(/ordered/iu)

    const duplicateMlbam = structuredClone(fixture())
    duplicateMlbam.records[1]![1] = 100
    expect(() => validateChadwickKeyMlbamArtifact(duplicateMlbam)).toThrow(/Duplicate MLBAM/iu)

    const lineageDrift = structuredClone(fixture())
    lineageDrift.source.chadwickRegister.shards[0]!.path = 'people-f.csv'
    expect(() => validateChadwickKeyMlbamArtifact(lineageDrift)).toThrow(/shards/iu)
  })

  it('returns null for a missing artifact', () => {
    expect(loadChadwickKeyMlbamLookup('/definitely/missing/chadwick.json')).toBeNull()
  })
})
