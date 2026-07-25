import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Options } from 'ajv'
import type { Ajv2020 as Ajv2020Instance } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  buildHobbyMasterFeed,
  hobbyMasterCatalog,
} from './_hobby-master-ranking.js'

const schema = JSON.parse(readFileSync(
  new URL(
    '../public/schemas/hobby-oracle-master-ranking.v2.schema.json',
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

function errors(value: unknown): string[] {
  if (validate(value)) return []
  return (validate.errors ?? []).map((error) => (
    `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`
  ))
}

describe('hobby-oracle-master-ranking.v2 JSON Schema', () => {
  it('accepts representative master and cohort-filtered pages', () => {
    expect(errors(buildHobbyMasterFeed(hobbyMasterCatalog, {
      posture: 'build_candidate',
      limit: 100,
    }))).toEqual([])
    expect(errors(buildHobbyMasterFeed(hobbyMasterCatalog, {
      domain: 'football',
      posture: 'all',
      limit: 5,
    }))).toEqual([])
  })

  it('rejects investment claims and an unqualified Build designation', () => {
    const drifted = structuredClone(buildHobbyMasterFeed(
      hobbyMasterCatalog,
      { posture: 'hold_candidate', limit: 1 },
    )) as unknown as {
      meta: {
        investmentAdvice: boolean
        exactCardRecommendationsAvailable: boolean
      }
      items: Array<{
        assessment: {
          buildQualification: {
            eligible: boolean
            designation: string
            passed: number
            required: number
            reasonCodes: string[]
          }
        }
      }>
    }
    drifted.meta.investmentAdvice = true
    drifted.meta.exactCardRecommendationsAvailable = true
    drifted.items[0]!.assessment.buildQualification.eligible = true
    drifted.items[0]!.assessment.buildQualification.designation = 'Build'
    drifted.items[0]!.assessment.buildQualification.passed = 1
    drifted.items[0]!.assessment.buildQualification.reasonCodes = ['open_gate']

    const schemaErrors = errors(drifted).join('\n')
    expect(schemaErrors).toContain('/meta/investmentAdvice')
    expect(schemaErrors).toContain('/meta/exactCardRecommendationsAvailable')
    expect(schemaErrors).toContain(
      '/items/0/assessment/buildQualification/passed',
    )
    expect(schemaErrors).toContain(
      '/items/0/assessment/buildQualification/reasonCodes',
    )
  })
})
