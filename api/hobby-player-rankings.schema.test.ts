import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Options } from 'ajv'
import type { Ajv2020 as Ajv2020Instance } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  buildHobbyPlayerRankingCatalog,
  buildHobbyPlayerRankingsFeed,
} from './_hobby-player-rankings.js'

const schema = JSON.parse(readFileSync(
  new URL(
    '../public/schemas/hobby-player-rankings.v1.schema.json',
    import.meta.url,
  ),
  'utf8',
)) as object
const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020.js') as new (
  options?: Options,
) => Ajv2020Instance
const addFormats = require('ajv-formats') as (
  instance: Ajv2020Instance,
) => Ajv2020Instance
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false })
addFormats(ajv)
const validate = ajv.compile(schema)
const currentAt = new Date('2026-07-24T20:00:00.000Z')

function errors(value: unknown): string[] {
  if (validate(value)) return []
  return (validate.errors ?? []).map((error) => (
    `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`
  ))
}

describe('hobby-player-rankings.v1 JSON Schema', () => {
  it('accepts current football and basketball ranking responses', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      currentAt,
    )

    for (const sport of ['football', 'basketball'] as const) {
      const firstResponse = buildHobbyPlayerRankingsFeed(catalog, {
        sport,
        limit: 100,
      })

      expect(firstResponse.snapshot.freshness.status).toBe('current')
      expect(firstResponse.items.length).toBeGreaterThan(0)
      for (
        let page = 1;
        page <= firstResponse.page.totalPages;
        page += 1
      ) {
        expect(errors(buildHobbyPlayerRankingsFeed(catalog, {
          sport,
          page,
          limit: 100,
        }))).toEqual([])
      }
    }
  })

  it('rejects unsupported investment claims and undeclared item fields', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      currentAt,
    )
    const drifted = structuredClone(buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'football',
      limit: 1,
    })) as unknown as {
      meta: {
        expectedReturnClaim: boolean
      }
      items: Array<Record<string, unknown>>
    }
    drifted.meta.expectedReturnClaim = true
    drifted.items[0]!.expectedAnnualReturn = 0.25

    const schemaErrors = errors(drifted).join('\n')
    expect(schemaErrors).toContain('/meta/expectedReturnClaim')
    expect(schemaErrors).toContain('/items/0 must NOT have additional properties')
  })
})
