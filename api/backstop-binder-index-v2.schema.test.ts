import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Options } from 'ajv'
import type { Ajv2020 as Ajv2020Instance } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  buildBaseballGraduationUniverseFromRows,
} from './_baseball-graduation-universe.js'
import {
  buildBinderGraduationV2Catalog,
  buildBinderGraduationV2Feed,
} from './_binder-graduation-index-v2.js'

const schema = JSON.parse(readFileSync(
  new URL(
    '../public/schemas/backstop-binder-index.v2.schema.json',
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
const catalog = buildBinderGraduationV2Catalog(
  buildBaseballGraduationUniverseFromRows([], currentAt),
  currentAt,
)

function errors(value: unknown): string[] {
  if (validate(value)) return []
  return (validate.errors ?? []).map((error) => (
    `${error.instancePath || '/'} ${error.message ?? 'is invalid'} ${
      JSON.stringify(error.params)
    }`
  ))
}

describe('backstop-binder-index.v2 JSON Schema', () => {
  it('accepts all unified and sport-filtered pages', () => {
    for (
      const sport of [
        'all',
        'baseball',
        'football',
        'basketball',
      ] as const
    ) {
      const firstResponse = buildBinderGraduationV2Feed(catalog, {
        sport,
        limit: 100,
      })

      expect(firstResponse.snapshot.freshness.status).toBe('current')
      expect(firstResponse.items.length).toBeGreaterThan(0)
      if (sport !== 'all') {
        expect(firstResponse.items.every(
          (item) => item.player.sport === sport,
        )).toBe(true)
      }
      for (
        let page = 1;
        page <= firstResponse.page.totalPages;
        page += 1
      ) {
        expect(errors(buildBinderGraduationV2Feed(catalog, {
          sport,
          page,
          limit: 100,
        }))).toEqual([])
      }
    }
  })

  it('rejects probability and investment-return drift', () => {
    const drifted = structuredClone(
      buildBinderGraduationV2Feed(catalog, {
        sport: 'baseball',
        limit: 1,
      }),
    ) as unknown as {
      meta: Record<string, unknown>
      items: Array<Record<string, unknown> & {
        graduation: Record<string, unknown>
      }>
    }
    drifted.items[0]!.graduation.probability = 0.72
    drifted.meta.expectedAnnualReturn = 0.18
    drifted.items[0]!.investmentRecommendation = 'buy'

    const schemaErrors = errors(drifted).join('\n')
    expect(schemaErrors).toContain(
      '/items/0/graduation/probability must be null',
    )
    expect(schemaErrors).toContain(
      '"additionalProperty":"expectedAnnualReturn"',
    )
    expect(schemaErrors).toContain(
      '"additionalProperty":"investmentRecommendation"',
    )
  })
})
