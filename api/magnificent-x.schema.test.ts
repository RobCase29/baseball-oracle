import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Options } from 'ajv'
import type { Ajv2020 as Ajv2020Instance } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  buildMagnificentXFeed,
  magnificentXCatalog,
} from './_magnificent-x.js'

const schema = JSON.parse(readFileSync(
  new URL('../public/schemas/magnificent-x-feed.v1.schema.json', import.meta.url),
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

function errors(value: unknown): string[] {
  if (validate(value)) return []
  return (validate.errors ?? []).map((error) => (
    `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`
  ))
}

describe('magnificent-x-feed.v1 JSON Schema', () => {
  it('accepts representative athlete and Pokémon pages', () => {
    expect(errors(buildMagnificentXFeed(magnificentXCatalog, {
      domain: 'baseball',
      limit: 3,
    }))).toEqual([])
    expect(errors(buildMagnificentXFeed(magnificentXCatalog, {
      domain: 'pokemon',
      limit: 3,
    }))).toEqual([])
  })

  it('rejects false investment and exact-card claims', () => {
    const drifted = structuredClone(buildMagnificentXFeed(
      magnificentXCatalog,
      { domain: 'pokemon', limit: 1 },
    )) as unknown as {
      meta: {
        investmentAdvice: boolean
        magnificentEligibleCount: number
        exactCardRecommendationsAvailable: boolean
      }
      items: Array<{
        assessment: {
          magnificentX: {
            score: number | null
            eligible: boolean
            designation: string
          }
        }
      }>
    }
    drifted.meta.investmentAdvice = true
    drifted.meta.magnificentEligibleCount = 1
    drifted.meta.exactCardRecommendationsAvailable = true
    drifted.items[0]!.assessment.magnificentX = {
      score: 99,
      eligible: true,
      designation: 'buy',
    }

    const schemaErrors = errors(drifted).join('\n')
    expect(schemaErrors).toContain('/meta/investmentAdvice')
    expect(schemaErrors).toContain('/meta/magnificentEligibleCount')
    expect(schemaErrors).toContain('/meta/exactCardRecommendationsAvailable')
    expect(schemaErrors).toContain('/items/0/assessment/magnificentX')
  })
})
