import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Options } from 'ajv'
import type { Ajv2020 as Ajv2020Instance } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  buildBinderGraduationCatalog,
  buildBinderGraduationFeed,
} from './_binder-graduation-index.js'

const schema = JSON.parse(readFileSync(
  new URL(
    '../public/schemas/backstop-binder-index.v1.schema.json',
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
const currentAt = new Date('2026-08-02T11:00:00.000Z')

function errors(value: unknown): string[] {
  if (validate(value)) return []
  return (validate.errors ?? []).map((error) => (
    `${error.instancePath || '/'} ${error.message ?? 'is invalid'} ${
      JSON.stringify(error.params)
    }`
  ))
}

describe('backstop-binder-index.v1 JSON Schema', () => {
  it('accepts every live all-sport, football, and basketball page', () => {
    const catalog = buildBinderGraduationCatalog(currentAt)

    for (const sport of ['all', 'football', 'basketball'] as const) {
      const firstResponse = buildBinderGraduationFeed(catalog, {
        sport,
        limit: 100,
      })

      expect(firstResponse.snapshot.freshness.status).toBe('current')
      expect(firstResponse.items.length).toBeGreaterThan(0)
      expect(firstResponse.scope.sport).toBe(sport)
      if (sport !== 'all') {
        expect(
          firstResponse.items.every((item) => item.player.sport === sport),
        ).toBe(true)
      }

      for (
        let page = 1;
        page <= firstResponse.page.totalPages;
        page += 1
      ) {
        expect(errors(buildBinderGraduationFeed(catalog, {
          sport,
          page,
          limit: 100,
        }))).toEqual([])
      }
    }
  })

  it('rejects a numeric graduation probability', () => {
    const catalog = buildBinderGraduationCatalog(currentAt)
    const drifted = structuredClone(buildBinderGraduationFeed(catalog, {
      sport: 'football',
      limit: 1,
    })) as unknown as {
      items: Array<{
        graduation: {
          probability: number | null
        }
      }>
    }
    drifted.items[0]!.graduation.probability = 0.72

    expect(errors(drifted).join('\n')).toContain(
      '/items/0/graduation/probability must be null',
    )
  })

  it('rejects expected-return and investment-recommendation fields', () => {
    const catalog = buildBinderGraduationCatalog(currentAt)
    const drifted = structuredClone(buildBinderGraduationFeed(catalog, {
      sport: 'basketball',
      limit: 1,
    })) as unknown as {
      meta: Record<string, unknown>
      items: Array<Record<string, unknown> & {
        graduation: Record<string, unknown>
      }>
    }
    drifted.meta.expectedAnnualReturn = 0.18
    drifted.items[0]!.expectedReturn = 0.25
    drifted.items[0]!.graduation.investmentRecommendation = 'buy'

    const schemaErrors = errors(drifted).join('\n')
    expect(schemaErrors).toContain('"additionalProperty":"expectedAnnualReturn"')
    expect(schemaErrors).toContain('"additionalProperty":"expectedReturn"')
    expect(schemaErrors).toContain(
      '"additionalProperty":"investmentRecommendation"',
    )
  })
})
