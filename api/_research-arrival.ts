import researchPreviewJson from './_data/research-arrival-2025.json' with { type: 'json' }
import { z } from 'zod'

interface StoredEstimate {
  snapshotId: string
  coldStart: boolean
  priorLevel: string
  age: number
  probabilities: number[]
  baselines: number[]
  milbAlphaSignal?: unknown
}

interface ResearchPreviewData {
  schemaVersion: 'research-arrival-preview/v1'
  status: 'external_validation_failed_research_only'
  releaseEligible: false
  asOf: string
  horizons: number[]
  rows: number
  lockSha256: string
  predictionManifestSha256: string
  predictionTableSha256: string
  evaluationReportSha256: string
  estimates: Record<string, StoredEstimate>
}

export interface ResearchArrivalEstimate {
  status: 'research_only'
  releaseEligible: false
  asOf: string
  modelVersion: string
  snapshotId: string
  coldStart: boolean
  priorLevel: string
  modelAge: number
  currentStatusVerified: false
  horizons: Array<{
    months: number
    probability: number
    baselineProbability: number
    externallyValidated: boolean
    externalEvaluationStatus: 'failed_release_gate' | 'immature'
  }>
  lineage: {
    predictionManifestSha256: string
    evaluationReportSha256: string
  }
}

const probabilitySchema = z.number().finite().min(0).max(1)
const nonnegativeIntegerSchema = z.number().int().min(0)

const edgeSchema = z.object({
  horizonMonths: z.union([z.literal(36), z.literal(60)]),
  probability: probabilitySchema,
  baselineProbability: probabilitySchema,
  probabilityDelta: z.number().finite().min(-1).max(1),
  liftMultiple: z.number().finite().nonnegative().nullable(),
  externallyValidated: z.literal(false).optional(),
}).strict()

const milbAlphaSignalSchema = z.object({
  version: z.literal('milb-alpha-signal-v1'),
  status: z.literal('research'),
  releaseEligible: z.literal(false),
  target: z.literal('first_mlb_arrival_within_36_months'),
  eligible: z.boolean(),
  tier: z.enum(['priority', 'watch', 'none']),
  rank: z.number().int().positive().nullable(),
  rankScope: z.literal('frozen_2025_milb_arrival_alpha').nullable(),
  asOf: z.string().nullable(),
  primaryEdge: edgeSchema,
  longHorizonEdge: edgeSchema.extend({
    horizonMonths: z.literal(60),
    externallyValidated: z.literal(false),
  }),
  ageContext: z.object({
    age: z.number().finite().positive(),
    percentileWithinRoleLevel: z.number().finite().min(0).max(100),
    youngerThanPercent: z.number().finite().min(0).max(100),
    referencePlayers: z.number().int().positive(),
    referenceRows: z.number().int().positive(),
    role: z.enum(['hitter', 'pitcher']),
    priorLevel: z.string().min(1),
    playerEqualWeighted: z.literal(true),
  }).strict().nullable(),
  workload: z.object({
    kind: z.enum(['PA', 'IP']),
    value: z.number().finite().nonnegative(),
    minimum: z.number().finite().positive(),
  }).strict(),
  baselineSupport: z.object({
    minimumRows: nonnegativeIntegerSchema,
    minimumEvents: nonnegativeIntegerSchema,
    horizons: z.array(z.object({
      horizonMonths: z.union([z.literal(36), z.literal(60)]),
      scope: z.enum(['role_level_age_band', 'role_level', 'role']),
      rows: nonnegativeIntegerSchema,
      events: nonnegativeIntegerSchema,
    }).strict()).length(2),
    referenceSeasons: z.array(z.number().int()).min(1),
  }).strict(),
  descriptiveDrivers: z.array(z.object({
    metric: z.string().min(1),
    label: z.string().min(1),
    value: z.number().finite(),
    favorablePercentile: z.number().finite().min(0).max(100),
    favorableDirection: z.enum(['higher', 'lower']),
    referenceScope: z.enum(['role_level_age_band', 'role_level']),
    referencePlayers: z.number().int().positive(),
  }).strict()).max(3),
  gates: z.object({
    supportedHistoricalContext: z.boolean(),
    youngForRoleAndLevel: z.boolean(),
    minimumRawWorkload: z.boolean(),
    minimumPrimaryProbability: z.boolean(),
    positivePrimaryModelEdge: z.boolean(),
    positiveLongHorizonModelEdge: z.boolean(),
  }).strict(),
  releaseGates: z.object({
    externalValidationPassed: z.literal(false),
    probabilityCalibrationPassed: z.literal(false),
    currentFeatureAlignmentPassed: z.literal(false),
  }).strict(),
  validation: z.object({
    status: z.literal('external_validation_failed'),
    releaseEligible: z.literal(false),
    validatedHorizons: z.tuple([]),
    retrospectiveRankingDiagnosticOnly: z.tuple([z.literal(36)]),
  }).strict(),
  inputPolicy: z.literal('raw_stats_age_level_role_no_composite_score_or_external_rank'),
  warnings: z.array(z.string().min(1)),
}).strict()

export type ResearchMilbAlphaSignal = z.infer<typeof milbAlphaSignalSchema>

const SIGNAL_TOLERANCE = 1e-7

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= SIGNAL_TOLERANCE
}

function validateMilbAlphaSignal(value: unknown): ResearchMilbAlphaSignal {
  const parsed = milbAlphaSignalSchema.parse(value)
  if (parsed.primaryEdge.horizonMonths !== 36) {
    throw new Error('MiLB alpha primary horizon must be 36 months')
  }
  for (const edge of [parsed.primaryEdge, parsed.longHorizonEdge]) {
    if (!nearlyEqual(edge.probabilityDelta, edge.probability - edge.baselineProbability)) {
      throw new Error('MiLB alpha edge does not match probability minus baseline')
    }
  }

  const supportedHistoricalContext = parsed.ageContext !== null &&
    parsed.ageContext.referencePlayers >= 400 &&
    parsed.baselineSupport.minimumRows >= 100 &&
    parsed.baselineSupport.minimumEvents >= 5
  const derivedGates = {
    supportedHistoricalContext,
    youngForRoleAndLevel: (parsed.ageContext?.percentileWithinRoleLevel ?? 101) <= 33,
    minimumRawWorkload: parsed.workload.value >= parsed.workload.minimum,
    minimumPrimaryProbability: parsed.primaryEdge.probability >= 0.2,
    positivePrimaryModelEdge: parsed.primaryEdge.probabilityDelta >= 0.1,
    positiveLongHorizonModelEdge: parsed.longHorizonEdge.probabilityDelta > 0,
  }
  for (const [gate, expected] of Object.entries(derivedGates)) {
    if (parsed.gates[gate as keyof typeof parsed.gates] !== expected) {
      throw new Error(`MiLB alpha gate is inconsistent: ${gate}`)
    }
  }
  const eligible = Object.values(derivedGates).every(Boolean)
  const priority = eligible && parsed.primaryEdge.probabilityDelta >= 0.25 &&
    (parsed.ageContext?.percentileWithinRoleLevel ?? 101) <= 25
  const expectedTier = priority ? 'priority' : eligible ? 'watch' : 'none'
  if (parsed.eligible !== eligible || parsed.tier !== expectedTier) {
    throw new Error('MiLB alpha eligibility or tier is inconsistent with its gates')
  }
  if (eligible !== (parsed.rank !== null && parsed.rankScope !== null)) {
    throw new Error('MiLB alpha eligible rows require a rank and rank scope')
  }
  if (!nearlyEqual(
    parsed.ageContext?.youngerThanPercent ?? 0,
    100 - (parsed.ageContext?.percentileWithinRoleLevel ?? 100),
  )) {
    throw new Error('MiLB alpha age context is inconsistent')
  }
  return parsed
}

const researchPreview = researchPreviewJson as unknown as ResearchPreviewData

if (
  researchPreview.schemaVersion !== 'research-arrival-preview/v1' ||
  researchPreview.releaseEligible !== false ||
  researchPreview.horizons.length !== 5
) {
  throw new Error('Research arrival preview artifact is invalid')
}

const milbAlphaSignals = new Map<string, ResearchMilbAlphaSignal>()
for (const [key, estimate] of Object.entries(researchPreview.estimates)) {
  if (estimate.milbAlphaSignal !== undefined) {
    milbAlphaSignals.set(key, validateMilbAlphaSignal(estimate.milbAlphaSignal))
  }
}
const rankedSignals = [...milbAlphaSignals.values()]
  .filter((signal) => signal.eligible)
  .sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0))
if (rankedSignals.some((signal, index) => signal.rank !== index + 1)) {
  throw new Error('MiLB alpha ranks must be unique and contiguous')
}

function estimateKey(
  mlbamId: bigint | number | string | null,
  playerType: 'Hitter' | 'Pitcher',
): string | null {
  if (mlbamId === null) return null
  const id = String(mlbamId)
  if (!/^\d+$/u.test(id)) return null
  return `${id}:${playerType.toLocaleLowerCase('en-US')}`
}

export function researchArrivalEstimate(
  mlbamId: bigint | number | string | null,
  playerType: 'Hitter' | 'Pitcher',
): ResearchArrivalEstimate | null {
  const key = estimateKey(mlbamId, playerType)
  const stored = key ? researchPreview.estimates[key] : undefined
  if (!stored) return null

  return {
    status: 'research_only',
    releaseEligible: false,
    asOf: researchPreview.asOf,
    modelVersion: researchPreview.lockSha256,
    snapshotId: stored.snapshotId,
    coldStart: stored.coldStart,
    priorLevel: stored.priorLevel,
    modelAge: stored.age,
    currentStatusVerified: false,
    horizons: researchPreview.horizons.map((months, index) => ({
      months,
      probability: stored.probabilities[index] ?? 0,
      baselineProbability: stored.baselines[index] ?? 0,
      externallyValidated: false,
      externalEvaluationStatus: months < 60 ? 'failed_release_gate' : 'immature',
    })),
    lineage: {
      predictionManifestSha256: researchPreview.predictionManifestSha256,
      evaluationReportSha256: researchPreview.evaluationReportSha256,
    },
  }
}

export function researchMilbAlphaSignal(
  mlbamId: bigint | number | string | null,
  playerType: 'Hitter' | 'Pitcher',
): ResearchMilbAlphaSignal | null {
  const key = estimateKey(mlbamId, playerType)
  return key === null ? null : milbAlphaSignals.get(key) ?? null
}

export function researchArrivalProbability(
  mlbamId: bigint | number | string | null,
  playerType: 'Hitter' | 'Pitcher',
  horizonMonths: number,
): number | null {
  const estimate = researchArrivalEstimate(mlbamId, playerType)
  return estimate?.horizons.find((horizon) => horizon.months === horizonMonths)?.probability ?? null
}

export const researchPreviewSummary = {
  asOf: researchPreview.asOf,
  eligibleRows: researchPreview.rows,
  releaseEligible: researchPreview.releaseEligible,
  status: researchPreview.status,
  milbAlphaSignalCoverage: milbAlphaSignals.size,
  milbAlphaSignalEligible: rankedSignals.length,
}
