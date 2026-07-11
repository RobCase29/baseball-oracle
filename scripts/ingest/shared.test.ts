import { describe, expect, it } from 'vitest'
import { disambiguateSourceRecordKeys } from './shared.js'

describe('shared ingestion helpers', () => {
  it('gives every repeated identical source row a deterministic unique key', () => {
    const rows = [{ id: 1 }, { id: 1 }, { id: 1 }]
    const keys = disambiguateSourceRecordKeys(rows, (row) => `id:${row.id}`)

    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe('id:1')
    expect(keys[1]).toContain('duplicate:2:')
    expect(keys[2]).toContain('duplicate:3:')
  })
})
