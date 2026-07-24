import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Options } from 'ajv'
import type { Ajv2020 as Ajv2020Instance } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  buildBinderScore,
  type BinderCandidateInput,
  type BinderScoresResponse,
} from '../src/domain/binderScore.js'

const schema = JSON.parse(readFileSync(
  new URL('../public/schemas/binder-scores.v1.schema.json', import.meta.url),
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

function completeCandidate(): BinderCandidateInput {
  return {
    player: {
      id: 'mlbam:800001',
      name: 'Example Player',
      age: 23,
      route: 'early_mlb',
    },
    baseball: {
      careerIndex: 88,
      routeOutcomePercentile: 92,
      freshness: {
        status: 'current',
        dataAsOf: '2025-12-31T23:59:59.999Z',
      },
    },
    market: {
      sourcePlayerName: 'Example Player',
      identityStatus: 'unique_normalized_name',
      trailingTwelveMonthDemandPercentile: 86,
      monthlySalesUsd: [
        100, 105, 110, 112, 118, 120, 120, 125, 130, 132, 135, 140,
      ],
      freshness: {
        status: 'current',
        dataAsOf: '2026-06-30T23:59:59.999Z',
      },
      cohortId: 'gemrate-baseball-trailing-12m-2026-06',
    },
  }
}

function representativeResponse(
  candidate: BinderCandidateInput = completeCandidate(),
): BinderScoresResponse {
  const assessment = buildBinderScore(candidate)
  return {
    schemaVersion: 'binder-scores.v1',
    contractVersion: 'binder-score-contract/v1',
    snapshot: {
      id: `binder-score-snapshot/v1:${'a'.repeat(64)}`,
      baseballDataAsOf: '2025-12-31T00:00:00.000Z',
      baseballFreshness: {
        status: 'current',
        reasonCodes: [],
        cadence: 'completed_season',
      },
      marketDataThrough: '2026-06-30',
      marketPublishedAt: '2026-07-12T00:00:00.000Z',
      marketAcquiredAt: '2026-07-24T16:55:06.000Z',
      marketFreshness: {
        status: 'current',
        reasonCodes: [],
        nextExpectedBy: '2026-08-20T00:00:00.000Z',
        cadence: 'monthly',
      },
    },
    items: [
      {
        recordVersion: 'binder-score-item/v1',
        player: {
          id: candidate.player.id,
          name: candidate.player.name,
          mlbamId: '800001',
          age: candidate.player.age,
          stage: candidate.player.route,
          playerType: 'Hitter',
          organization: 'Example Organization',
          organizationCode: 'EXP',
          position: 'SS',
          level: 'MLB',
        },
        assessment,
      },
    ],
    page: {
      page: 1,
      limit: 50,
      total: 1,
      totalPages: 1,
    },
    meta: {
      researchOnly: true,
      investmentAdvice: false,
      marketSource: 'GemRate Athlete Sales Trends',
      marketMeasure: 'completed_ebay_singles_sales_volume_usd',
      marketMeaning:
        'collector_demand_is_an_ebay_singles_sales_volume_proxy_not_price_appreciation',
      careerMeaning:
        'career_evidence_is_statistical_hall_caliber_trajectory_not_hof_election_odds',
      identityPolicy:
        'exact_oracle_identity_plus_unique_normalized_gemrate_name_no_fuzzy_matching',
      nullPolicy: 'missing_evidence_shrinks_to_prior_and_withholds_action',
      rankingScope: 'cross_stage_research_heuristic',
      sourceRows: 2_060,
      ambiguousSourceKeys: 4,
      matchedUniversePlayers: 1,
      actionableUniversePlayers: assessment.action === 'insufficient_evidence' ? 0 : 1,
      permissionAttestation: 'docs/permissions/GEMRATE_ATTESTATION.md',
    },
  }
}

describe('binder-scores.v1 JSON Schema', () => {
  it('accepts complete, provisional-market, and withheld-baseball responses', () => {
    expect(schemaErrors(representativeResponse())).toEqual([])

    const provisionalMarket = completeCandidate()
    provisionalMarket.market = null
    expect(schemaErrors(representativeResponse(provisionalMarket))).toEqual([])

    const withheldBaseball = completeCandidate()
    withheldBaseball.baseball.careerIndex = null
    expect(schemaErrors(representativeResponse(withheldBaseball))).toEqual([])
  })

  it('rejects appreciation claims and removal of research-only safeguards', () => {
    const drifted = structuredClone(representativeResponse()) as unknown as {
      meta: {
        researchOnly: boolean
        investmentAdvice: boolean
        marketMeaning: string
      }
      items: Array<{
        assessment: {
          semantics: {
            publicationStatus: string
            marketMeaning: string
          }
        }
      }>
    }
    drifted.meta.researchOnly = false
    drifted.meta.investmentAdvice = true
    drifted.meta.marketMeaning = 'price_appreciation'
    drifted.items[0].assessment.semantics.publicationStatus = 'production_investment_signal'
    drifted.items[0].assessment.semantics.marketMeaning = 'price_appreciation'

    const errors = schemaErrors(drifted).join('\n')
    expect(errors).toContain('/meta/researchOnly')
    expect(errors).toContain('/meta/investmentAdvice')
    expect(errors).toContain('/meta/marketMeaning')
    expect(errors).toContain('/items/0/assessment/semantics/publicationStatus')
    expect(errors).toContain('/items/0/assessment/semantics/marketMeaning')
  })
})
