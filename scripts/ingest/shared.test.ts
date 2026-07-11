import { describe, expect, it } from 'vitest'
import {
  boundedSourceRecordKey,
  disambiguateSourceRecordKeys,
  SOURCE_RECORD_KEY_MAX_BYTES,
} from './shared.js'

describe('shared ingestion helpers', () => {
  it('gives every repeated identical source row a deterministic unique key', () => {
    const rows = [{ id: 1 }, { id: 1 }, { id: 1 }]
    const keys = disambiguateSourceRecordKeys(rows, (row) => `id:${row.id}`)

    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe('id:1')
    expect(keys[1]).toContain('duplicate:2:')
    expect(keys[2]).toContain('duplicate:3:')
  })

  it('hashes provider keys that cannot safely fit a B-tree index entry', () => {
    const oversized = `Team:${'<a>provider markup</a>'.repeat(400)}`
    const bounded = boundedSourceRecordKey(oversized)

    expect(bounded).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(new TextEncoder().encode(bounded).byteLength).toBeLessThanOrEqual(
      SOURCE_RECORD_KEY_MAX_BYTES,
    )
    expect(boundedSourceRecordKey(oversized)).toBe(bounded)
  })
})
