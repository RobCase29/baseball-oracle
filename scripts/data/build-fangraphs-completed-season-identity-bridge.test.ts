import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  stableStringify,
  type CompletedSeasonIdentityBridge,
} from './build-fangraphs-completed-season-identity-bridge.js'

const artifactPath =
  'data/reference-locks/fangraphs-completed-season-exact-identity-bridge-2026.json'
const migrationPath =
  'db/migrations/0018_fangraphs_completed_season_identity_bridge.sql'

async function artifact(): Promise<CompletedSeasonIdentityBridge> {
  return JSON.parse(await readFile(artifactPath, 'utf8')) as CompletedSeasonIdentityBridge
}

describe('completed-season FanGraphs exact identity bridge', () => {
  it('locks the full exact scout/stat tuple intersection without names', async () => {
    const bridge = await artifact()
    const recordsSha256 = createHash('sha256')
      .update(stableStringify(bridge.records))
      .digest('hex')

    expect(bridge).toMatchObject({
      schemaVersion: 'fangraphs-completed-season-exact-identity-bridge/v1',
      identityPolicy: 'exact_fangraphs_upid_minor_master_to_mlbam_no_name_matching',
      boardEdition: 2026,
      statsSeason: 2025,
      lockedAt: '2026-07-11T22:48:51.000Z',
      recordsSha256,
    })
    expect(bridge.records).toHaveLength(1093)
    expect(bridge.records.filter((record) => record.sourceRole === 'Hitter')).toHaveLength(533)
    expect(bridge.records.filter((record) => record.sourceRole === 'Pitcher')).toHaveLength(560)
    expect(bridge.sourceLocks.map((source) => source.sha256)).toEqual([
      '0053540e097f355e113d9a1733ac25bbf7faae3f4761660a83a821bf616fbbb0',
      '88890ba8c075b686dc651057e3ca36580e9ed1e7906e2f21bc9cec5b396966ac',
    ])

    const tupleKeys = new Set(bridge.records.map((record) => (
      `${record.sourceRole}\u0000${record.fangraphsId}\u0000${record.minorMasterId}`
    )))
    const personTupleByMlbam = new Map<number, Set<string>>()
    const mlbamByPersonTuple = new Map<string, Set<number>>()
    for (const record of bridge.records) {
      expect(Object.keys(record)).not.toContain('name')
      expect(Object.keys(record)).not.toContain('fangraphsPath')
      expect(record.statsSeason).toBe(2025)
      const tuples = personTupleByMlbam.get(record.mlbamId) ?? new Set<string>()
      tuples.add(`${record.fangraphsId}\u0000${record.minorMasterId}`)
      personTupleByMlbam.set(record.mlbamId, tuples)
      const personTuple = `${record.fangraphsId}\u0000${record.minorMasterId}`
      const mlbamIds = mlbamByPersonTuple.get(personTuple) ?? new Set<number>()
      mlbamIds.add(record.mlbamId)
      mlbamByPersonTuple.set(personTuple, mlbamIds)
    }
    expect(tupleKeys.size).toBe(bridge.records.length)
    expect([...personTupleByMlbam.values()].every((tuples) => tuples.size === 1)).toBe(true)
    expect([...mlbamByPersonTuple.values()].every((mlbamIds) => mlbamIds.size === 1)).toBe(true)
  })

  it('contains the six expected recoveries as exact identifiers only', async () => {
    const bridge = await artifact()
    const expected = [
      ['Hitter', 'sa3022609', 'sa3022609', 805795],
      ['Hitter', 'sa3021069', 'sa3021069', 806964],
      ['Pitcher', 'sa3067434', 'sa3067434', 824415],
      ['Pitcher', 'sa3018808', 'sa3018808', 703186],
      ['Pitcher', 'sa3015346', 'sa3015346', 691330],
      ['Pitcher', 'sa3023557', 'sa3023557', 805809],
    ]
    const keys = new Set(bridge.records.map((record) => JSON.stringify([
      record.sourceRole,
      record.fangraphsId,
      record.minorMasterId,
      record.mlbamId,
    ])))
    expect(expected.every((identity) => keys.has(JSON.stringify(identity)))).toBe(true)
  })

  it('keeps the migration seed byte-equivalent to the committed lock', async () => {
    const bridge = await artifact()
    const migration = await readFile(migrationPath, 'utf8')
    const embedded = migration.match(/\$bridge\$(\[.*\])\$bridge\$::jsonb/s)?.[1]
    expect(embedded).toBeDefined()
    expect(JSON.parse(embedded!)).toEqual(bridge.records)
    expect(migration).toContain(bridge.recordsSha256)
    for (const source of bridge.sourceLocks) expect(migration).toContain(source.sha256)
  })
})
