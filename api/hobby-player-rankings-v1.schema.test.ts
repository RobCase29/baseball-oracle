import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Options } from 'ajv'
import type { Ajv2020 as Ajv2020Instance } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  buildHobbyPlayerRankingCatalog,
  buildHobbyPlayerRankingsFeed,
} from './_hobby-player-rankings-v1.js'

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
const currentAt = new Date('2026-07-25T01:00:00.000Z')

describe('hobby-player-rankings.v1 compatibility schema', () => {
  it('keeps both sport feeds on the original v1 contract', () => {
    const catalog = buildHobbyPlayerRankingCatalog(
      undefined,
      undefined,
      currentAt,
    )

    for (const sport of ['football', 'basketball'] as const) {
      const response = buildHobbyPlayerRankingsFeed(catalog, {
        sport,
        limit: 100,
      })
      expect(response.schemaVersion).toBe('hobby-player-rankings.v1')
      expect(validate(response), JSON.stringify(validate.errors)).toBe(true)
    }
  })
})
