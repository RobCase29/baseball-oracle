import impactPreviewJson from './_data/milb-impact-2025.json' with { type: 'json' }
import { z } from 'zod'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const positiveIntegerSchema = z.number().int().positive()

const estimateSchema = z.object({
  rank: positiveIntegerSchema,
  rankPercentile: z.number().finite().min(0).max(100),
  role: z.enum(['hitter', 'pitcher']),
}).strict()

const impactArtifactSchema = z.object({
  schemaVersion: z.literal('milb-impact-preview/v1'),
  status: z.literal('research_only'),
  releaseEligible: z.literal(false),
  frozenAsOf: z.iso.datetime({ offset: true }),
  sourceRunAsOf: z.iso.datetime({ offset: true }),
  modelVersion: z.literal('milb-impact-five-calendar-year-war-v1'),
  selectedModel: z.literal('regularized_logistic'),
  universeRows: positiveIntegerSchema,
  rankPercentileMethod: z.literal('100 * (universeRows - rank) / (universeRows - 1)'),
  target: z.object({
    id: z.literal('mlb_war_next_5_ge_5'),
    label: z.literal('At least 5 total MLB WAR in the next five calendar seasons'),
    scope: z.literal('unconditional'),
    windowStartSeason: z.literal(2026),
    windowEndSeason: z.literal(2030),
    hallOfFameProbability: z.literal(false),
  }).strict(),
  oofRankEvidence: z.object({
    method: z.literal('player-purged expanding prediction-origin out-of-fold evaluation'),
    rows: positiveIntegerSchema,
    players: positiveIntegerSchema,
    eventPlayers: positiveIntegerSchema,
    topDecileLift: z.number().finite().positive(),
    brierSkillVsTransparentBaseline: z.number().finite(),
    foldTopDecileLiftRange: z.object({
      minimum: z.number().finite().positive(),
      maximum: z.number().finite().positive(),
      folds: positiveIntegerSchema,
      validationSeasons: z.array(z.number().int()).min(1),
    }).strict(),
  }).strict(),
  gates: z.object({
    tailCalibrationPassed: z.literal(false),
    prospectiveValidationPassed: z.literal(false),
    knowledgeTimeVerified: z.literal(false),
  }).strict(),
  lineage: z.object({
    runContentSha256: sha256Schema,
    currentScoresSha256: sha256Schema,
  }).strict(),
  warnings: z.array(z.string().min(1)).min(1),
  estimates: z.record(z.string(), estimateSchema),
}).strict()

type MilbImpactArtifact = z.infer<typeof impactArtifactSchema>
type MilbImpactEstimate = z.infer<typeof estimateSchema>

const PERCENTILE_TOLERANCE = 1e-6

function expectedRankPercentile(rank: number, universeRows: number): number {
  if (universeRows <= 1) return 100
  return 100 * (universeRows - rank) / (universeRows - 1)
}

function assertNoProbabilityValue(value: unknown, path = 'artifact'): void {
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (/probability/iu.test(key) && typeof child !== 'boolean') {
      throw new Error(`MiLB impact artifact cannot expose a probability value at ${path}.${key}`)
    }
    assertNoProbabilityValue(child, `${path}.${key}`)
  }
}

export function validateMilbImpactArtifact(value: unknown): MilbImpactArtifact {
  assertNoProbabilityValue(value)
  const parsed = impactArtifactSchema.parse(value)
  const entries = Object.entries(parsed.estimates)
  if (entries.length !== parsed.universeRows) {
    throw new Error('MiLB impact universe size does not match its estimates')
  }
  if (parsed.target.windowEndSeason - parsed.target.windowStartSeason !== 4) {
    throw new Error('MiLB impact target must cover five calendar seasons')
  }
  const range = parsed.oofRankEvidence.foldTopDecileLiftRange
  if (range.minimum > range.maximum) {
    throw new Error('MiLB impact fold lift range is reversed')
  }
  if (range.validationSeasons.length !== range.folds) {
    throw new Error('MiLB impact fold count does not match its validation seasons')
  }
  if (new Set(range.validationSeasons).size !== range.validationSeasons.length) {
    throw new Error('MiLB impact validation seasons must be unique')
  }
  if (range.validationSeasons.some((season, index, seasons) => index > 0 && season <= seasons[index - 1]!)) {
    throw new Error('MiLB impact validation seasons must be strictly increasing')
  }
  if (
    parsed.oofRankEvidence.topDecileLift < range.minimum ||
    parsed.oofRankEvidence.topDecileLift > range.maximum
  ) {
    throw new Error('MiLB impact aggregate lift must fall within the fold range')
  }

  const ranks = new Set<number>()
  for (const [key, estimate] of entries) {
    const match = /^(\d+):(hitter|pitcher)$/u.exec(key)
    if (!match || match[2] !== estimate.role) {
      throw new Error(`MiLB impact identity key does not match its role: ${key}`)
    }
    if (estimate.rank > parsed.universeRows || ranks.has(estimate.rank)) {
      throw new Error('MiLB impact ranks must be unique and within the universe')
    }
    ranks.add(estimate.rank)
    const expected = expectedRankPercentile(estimate.rank, parsed.universeRows)
    if (Math.abs(estimate.rankPercentile - expected) > PERCENTILE_TOLERANCE) {
      throw new Error(`MiLB impact rank percentile is inconsistent at rank ${estimate.rank}`)
    }
  }
  if (ranks.size !== parsed.universeRows) {
    throw new Error('MiLB impact ranks must be contiguous')
  }
  for (let rank = 1; rank <= parsed.universeRows; rank += 1) {
    if (!ranks.has(rank)) throw new Error('MiLB impact ranks must be contiguous')
  }
  return parsed
}

const impactArtifact = validateMilbImpactArtifact(impactPreviewJson)

function estimateKey(
  mlbamId: bigint | number | string | null,
  playerType: 'Hitter' | 'Pitcher',
): string | null {
  if (mlbamId === null) return null
  const id = String(mlbamId)
  if (!/^\d+$/u.test(id)) return null
  return `${id}:${playerType.toLocaleLowerCase('en-US')}`
}

export interface ResearchMilbImpactRanking extends MilbImpactEstimate {
  status: 'research_only'
  releaseEligible: false
  frozenAsOf: string
  modelVersion: 'milb-impact-five-calendar-year-war-v1'
  selectedModel: 'regularized_logistic'
  universeRows: number
  target: MilbImpactArtifact['target']
  oofRankEvidence: MilbImpactArtifact['oofRankEvidence']
  gates: MilbImpactArtifact['gates']
  lineage: MilbImpactArtifact['lineage']
  warnings: string[]
}

export function researchMilbImpactRanking(
  mlbamId: bigint | number | string | null,
  playerType: 'Hitter' | 'Pitcher',
): ResearchMilbImpactRanking | null {
  const key = estimateKey(mlbamId, playerType)
  const estimate = key === null ? undefined : impactArtifact.estimates[key]
  if (!estimate) return null
  return {
    ...estimate,
    status: impactArtifact.status,
    releaseEligible: impactArtifact.releaseEligible,
    frozenAsOf: impactArtifact.frozenAsOf,
    modelVersion: impactArtifact.modelVersion,
    selectedModel: impactArtifact.selectedModel,
    universeRows: impactArtifact.universeRows,
    target: impactArtifact.target,
    oofRankEvidence: impactArtifact.oofRankEvidence,
    gates: impactArtifact.gates,
    lineage: impactArtifact.lineage,
    warnings: [...impactArtifact.warnings],
  }
}

export const researchMilbImpactSummary = {
  status: impactArtifact.status,
  releaseEligible: impactArtifact.releaseEligible,
  frozenAsOf: impactArtifact.frozenAsOf,
  modelVersion: impactArtifact.modelVersion,
  selectedModel: impactArtifact.selectedModel,
  universeRows: impactArtifact.universeRows,
  target: impactArtifact.target,
  oofRankEvidence: impactArtifact.oofRankEvidence,
  gates: impactArtifact.gates,
}
