import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Options } from 'ajv'
import type { Ajv2020 as Ajv2020Instance } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  communitySignalsResponse,
  type CommunitySignalRow,
} from './_community-signals.js'

const schema = JSON.parse(readFileSync(
  new URL('../public/schemas/dynasty-scores.v1.schema.json', import.meta.url),
  'utf8',
)) as object
const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020.js') as new (options?: Options) => Ajv2020Instance
const addFormats = require('ajv-formats') as (instance: Ajv2020Instance) => Ajv2020Instance
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false })
addFormats(ajv)
const validate = ajv.compile(schema)

function schemaErrors(value: unknown): string[] {
  if (validate(value)) return []
  return (validate.errors ?? []).map((error) => (
    `${error.instancePath || '/'} ${error.message ?? 'is invalid'} ${JSON.stringify(error.params)}`
  ))
}

function row(overrides: Partial<CommunitySignalRow> = {}): CommunitySignalRow {
  return {
    oracle_player_id: 'mlbam:660271',
    mlbam_id: 660271,
    hkb_player_id: 'ohtani-hkb',
    player_name: 'Shohei Ohtani',
    dynasty_value: 10_000,
    overall_rank: 1,
    overall_universe: 1_744,
    prospect_rank: null,
    prospect_universe: 728,
    rank_change_7d: 1,
    rank_change_30d: 2,
    value_change_7d: 30,
    value_change_30d: 80,
    rank_history_30d: [2, 1, 1],
    value_history_30d: [9_950, 9_980, 10_000],
    attention_count_30d: 120,
    attention_rank_30d: 2,
    prospect_attention_count_30d: null,
    prospect_attention_rank_30d: null,
    source_updated_at: '2026-07-16T16:56:45.455Z',
    captured_at: '2026-07-16T17:00:00.000Z',
    source_url: 'https://harryknowsball.com/rankings',
    ...overrides,
  }
}

describe('dynasty-scores.v1 JSON Schema', () => {
  it('accepts normalized ranked, floor, and empty responses', () => {
    expect(schemaErrors(communitySignalsResponse([row()], ['660271']))).toEqual([])
    expect(schemaErrors(communitySignalsResponse([
      row({ dynasty_value: 10, overall_rank: 840 }),
    ], ['660271']))).toEqual([])
    expect(schemaErrors(communitySignalsResponse([], ['660271']))).toEqual([])
    expect(schemaErrors(communitySignalsResponse([
      row({
        rank_history_30d: [null, null, 2, 1],
        value_history_30d: [null, null, 9_980, 10_000],
      }),
    ], ['660271']))).toEqual([])
  })

  it('rejects relabeling the external score as a probability or Oracle model input', () => {
    const response = structuredClone(communitySignalsResponse([row()], ['660271'])) as unknown as {
      meta: {
        excludedFromOracleModel: boolean
        dynastyScoreScale: { isProbability: boolean }
      }
    }
    response.meta.excludedFromOracleModel = false
    response.meta.dynastyScoreScale.isProbability = true
    const errors = schemaErrors(response).join('\n')
    expect(errors).toContain('/meta/excludedFromOracleModel')
    expect(errors).toContain('/meta/dynastyScoreScale/isProbability')
  })

  it('rejects a default-floor label applied above the provider floor', () => {
    const response = structuredClone(communitySignalsResponse([row()], ['660271'])) as unknown as {
      items: Array<{ dynastyScore: { value: number; signalStatus: string } }>
    }
    response.items[0].dynastyScore.value = 11
    response.items[0].dynastyScore.signalStatus = 'default_floor'
    expect(schemaErrors(response).join('\n')).toContain('/items/0/dynastyScore/value')
  })

  it('rejects zero as a substitute for unavailable attention', () => {
    const response = structuredClone(communitySignalsResponse([row()], ['660271'])) as unknown as {
      items: Array<{ dynastyScore: { attention: { views30d: number | null } } }>
    }
    response.items[0].dynastyScore.attention.views30d = 0
    expect(schemaErrors(response).join('\n')).toContain('/items/0/dynastyScore/attention/views30d')
  })
})
