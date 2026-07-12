import researchPreviewJson from './_data/research-arrival-2025.json' with { type: 'json' }

interface StoredEstimate {
  snapshotId: string
  coldStart: boolean
  priorLevel: string
  age: number
  probabilities: number[]
  baselines: number[]
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
  }>
  lineage: {
    predictionManifestSha256: string
    evaluationReportSha256: string
  }
}

const researchPreview = researchPreviewJson as unknown as ResearchPreviewData

if (
  researchPreview.schemaVersion !== 'research-arrival-preview/v1' ||
  researchPreview.releaseEligible !== false ||
  researchPreview.horizons.length !== 5
) {
  throw new Error('Research arrival preview artifact is invalid')
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
      externallyValidated: months < 60,
    })),
    lineage: {
      predictionManifestSha256: researchPreview.predictionManifestSha256,
      evaluationReportSha256: researchPreview.evaluationReportSha256,
    },
  }
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
}
