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
    '../public/schemas/hobby-player-rankings.v2.schema.json',
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
const currentAt = new Date('2026-08-09T11:00:00.000Z')

function errors(value: unknown): string[] {
  if (validate(value)) return []
  return (validate.errors ?? []).map((error) => (
    `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`
  ))
}

describe('hobby-player-rankings.v2 JSON Schema', () => {
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
      expect(firstResponse.scope.sport).toBe(sport)
      expect(firstResponse.items.every((item) => item.sport === sport)).toBe(
        true,
      )
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

  it('accepts a stale response only when publication is empty', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      new Date('2026-08-21T00:00:00.000Z'),
    )
    const stale = buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'football',
    })

    expect(stale.snapshot.freshness.status).toBe('stale')
    expect(stale.items).toEqual([])
    expect(stale.screenSummary.rankedCount).toBe(0)
    expect(stale.page.total).toBe(0)
    expect(errors(stale)).toEqual([])
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

  it('rejects mixed-sport items and investment-like confidence', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      currentAt,
    )
    const drifted = structuredClone(buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'football',
      limit: 1,
    })) as unknown as {
      items: Array<{
        sport: string
        confidence: {
          score: number
          investmentConfidence: string
        }
      }>
    }
    drifted.items[0]!.sport = 'basketball'
    drifted.items[0]!.confidence.score = 76
    drifted.items[0]!.confidence.investmentConfidence = 'high'

    const schemaErrors = errors(drifted).join('\n')
    expect(schemaErrors).toContain('/items/0/sport')
    expect(schemaErrors).toContain('/items/0/confidence/score')
    expect(schemaErrors).toContain(
      '/items/0/confidence/investmentConfidence',
    )
  })

  it('requires the v2 evidence, concentration, and sensitivity contract', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      currentAt,
    )
    const drifted = structuredClone(buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'football',
      limit: 1,
    })) as unknown as {
      items: Array<{
        posture: string
        evidence: Record<string, unknown>
        diagnostics: Record<string, unknown>
        sensitivity: {
          ranks: Record<string, unknown>
        }
      }>
    }
    drifted.items[0]!.posture = 'Hold'
    delete drifted.items[0]!.evidence.evidenceYears
    delete drifted.items[0]!.diagnostics.salesConcentrationHhi
    delete drifted.items[0]!.sensitivity.ranks.recentWindow

    const schemaErrors = errors(drifted).join('\n')
    expect(schemaErrors).toContain('/items/0/posture')
    expect(schemaErrors).toContain('/items/0/evidence')
    expect(schemaErrors).toContain('/items/0/diagnostics')
    expect(schemaErrors).toContain('/items/0/sensitivity/ranks')
  })

  it('permits unknown age only for football', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      currentAt,
    )
    const football = structuredClone(buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'football',
      limit: 1,
    }))
    const basketball = structuredClone(buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'basketball',
      limit: 1,
    }))
    football.items[0]!.age = null
    basketball.items[0]!.age = null

    expect(errors(football)).toEqual([])
    expect(errors(basketball).join('\n')).toContain('/items/0/age')
  })

  it('rejects non-empty publication when freshness is stale', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      currentAt,
    )
    const drifted = structuredClone(buildHobbyPlayerRankingsFeed(catalog, {
      sport: 'football',
      limit: 1,
    }))
    drifted.snapshot.freshness.status = 'stale'

    expect(errors(drifted).join('\n')).toContain('/items')
  })
})
