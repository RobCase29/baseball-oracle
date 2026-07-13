export type MinorTraitPlayerType = 'Hitter' | 'Pitcher'

type NumericInput = bigint | number | string | null | undefined

export interface MinorTraitMetricInput {
  key: string
  label: string
  value?: string | null
  percentile: NumericInput
  source?: string | null
}

export interface MinorTraitOpportunityInput {
  plateAppearances?: NumericInput
  inningsPitched?: NumericInput
  pitches?: NumericInput
  observed?: {
    label: string
    value: string
  } | null
}

export interface MinorTraitEvidenceInput {
  playerType: MinorTraitPlayerType
  metrics: readonly MinorTraitMetricInput[]
  opportunity?: MinorTraitOpportunityInput | null
}

type OpportunityState = 'unavailable' | 'insufficient' | 'provisional' | 'sufficient'

interface OpportunityThreshold {
  unit: 'PA' | 'IP' | 'Pitches'
  provisional: number
  sufficient: number
}

export interface MinorTraitSourceMetric {
  key: string
  label: string
  value: string | null
  percentile: number
  pillar: string
  source: 'Prospect Savant'
}

export interface MinorTraitPillar {
  key: string
  label: string
  covered: boolean
  strong: boolean
  availableMetricCount: number
  strongestMetric: MinorTraitSourceMetric | null
  metrics: MinorTraitSourceMetric[]
}

export interface MinorTraitEvidence {
  version: 'minor-trait-evidence-v1'
  status: 'descriptive_source_evidence_only'
  predictiveValidation: false
  playerType: MinorTraitPlayerType
  opportunity: {
    state: OpportunityState
    sufficient: boolean
    observed: {
      plateAppearances: number | null
      inningsPitched: number | null
      pitches: number | null
    }
    thresholds: OpportunityThreshold[]
  }
  coverage: {
    availableMetricCount: number
    coveredPillarCount: number
    totalPillarCount: number
    requiredCoveredPillars: number
    sufficient: boolean
    missingPillars: string[]
  }
  corroboration: {
    strongPercentileThreshold: number
    strongPillarCount: number
    requiredStrongPillars: number
    multiPillar: boolean
    passesAllDescriptiveGates: boolean
  }
  pillars: MinorTraitPillar[]
  strongestMetrics: MinorTraitSourceMetric[]
  exclusions: {
    providerCompositeMetricCount: number
    kMinusBbPercentileCount: number
    unsupportedSourceMetricCount: number
    invalidPercentileCount: number
    duplicateMetricKeyCount: number
  }
  warnings: string[]
}

interface PillarPolicy {
  key: string
  label: string
  metricKeys: readonly string[]
}

const SOURCE = 'Prospect Savant' as const
const STRONG_PERCENTILE = 80
const REQUIRED_COVERED_PILLARS = 3
const REQUIRED_STRONG_PILLARS = 2
const MAX_STRONGEST_METRICS = 5

const PILLARS: Readonly<Record<MinorTraitPlayerType, readonly PillarPolicy[]>> = {
  Hitter: [
    {
      key: 'damage',
      label: 'Damage',
      metricKeys: [
        'exit-velocity',
        'exit-velocity-90',
        'max-exit-velocity',
        'hard-hit-rate',
        'barrel-rate',
      ],
    },
    {
      key: 'contact',
      label: 'Contact',
      metricKeys: ['whiff-rate', 'zone-contact-rate', 'strikeout-rate'],
    },
    {
      key: 'swing-decisions',
      label: 'Swing decisions',
      metricKeys: ['chase-rate', 'walk-rate'],
    },
    {
      key: 'expected-output',
      label: 'Expected output',
      metricKeys: ['xwoba'],
    },
  ],
  Pitcher: [
    {
      key: 'arsenal',
      label: 'Arsenal',
      metricKeys: ['velocity'],
    },
    {
      key: 'bat-missing',
      label: 'Bat missing',
      metricKeys: ['whiff-rate', 'swinging-strike-rate', 'strikeout-rate'],
    },
    {
      key: 'command',
      label: 'Command',
      metricKeys: ['chase-rate', 'walk-rate'],
    },
    {
      key: 'contact-management',
      label: 'Contact management',
      metricKeys: ['xwoba'],
    },
  ],
}

const OPPORTUNITY_THRESHOLDS: Readonly<
  Record<MinorTraitPlayerType, readonly OpportunityThreshold[]>
> = {
  Hitter: [{ unit: 'PA', provisional: 75, sufficient: 150 }],
  Pitcher: [
    { unit: 'Pitches', provisional: 300, sufficient: 600 },
    { unit: 'IP', provisional: 20, sufficient: 40 },
  ],
}

const PROVIDER_COMPOSITE_IDENTITIES = new Set([
  'pscore',
  'psscore',
  'pspercentile',
  'scorep',
])

const K_MINUS_BB_IDENTITIES = new Set([
  'kbb',
  'kbbp',
  'kbbrate',
  'kminusbb',
  'kminusbbp',
  'kminusbbrate',
])

function finiteNumber(value: NumericInput): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegativeNumber(value: NumericInput): number | null {
  const number = finiteNumber(value)
  return number !== null && number >= 0 ? number : null
}

function percentile(value: NumericInput): number | null {
  const number = finiteNumber(value)
  return number !== null && number >= 0 && number <= 100 ? number : null
}

function normalizedKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('en-US')
    .replaceAll('_', '-')
    .replace(/\s+/gu, '-')
}

function keyIdentity(value: string): string {
  return normalizedKey(value).replace(/[^a-z0-9]/gu, '')
}

function parseObservedOpportunity(
  observed: MinorTraitOpportunityInput['observed'],
): Partial<Record<'plateAppearances' | 'inningsPitched' | 'pitches', number>> {
  if (!observed) return {}
  const value = nonNegativeNumber(observed.value.replaceAll(',', ''))
  if (value === null) return {}

  switch (observed.label.trim().toLocaleUpperCase('en-US')) {
    case 'PA':
      return { plateAppearances: value }
    case 'IP':
      return { inningsPitched: value }
    case 'PITCHES':
      return { pitches: value }
    default:
      return {}
  }
}

function opportunityEvidence(
  playerType: MinorTraitPlayerType,
  input: MinorTraitOpportunityInput | null | undefined,
): MinorTraitEvidence['opportunity'] {
  const observedFallback = parseObservedOpportunity(input?.observed)
  const observed = {
    plateAppearances:
      nonNegativeNumber(input?.plateAppearances) ??
      observedFallback.plateAppearances ??
      null,
    inningsPitched:
      nonNegativeNumber(input?.inningsPitched) ??
      observedFallback.inningsPitched ??
      null,
    pitches:
      nonNegativeNumber(input?.pitches) ?? observedFallback.pitches ?? null,
  }
  const thresholds = OPPORTUNITY_THRESHOLDS[playerType].map((entry) => ({
    ...entry,
  }))

  const ratios = thresholds.map((threshold) => {
    const value = threshold.unit === 'PA'
      ? observed.plateAppearances
      : threshold.unit === 'IP'
        ? observed.inningsPitched
        : observed.pitches
    return value === null
      ? null
      : {
          provisional: value / threshold.provisional,
          sufficient: value / threshold.sufficient,
        }
  })
  const availableRatios = ratios.filter(
    (entry): entry is { provisional: number; sufficient: number } => entry !== null,
  )
  const state: OpportunityState = availableRatios.length === 0
    ? 'unavailable'
    : availableRatios.some((entry) => entry.sufficient >= 1)
      ? 'sufficient'
      : availableRatios.some((entry) => entry.provisional >= 1)
        ? 'provisional'
        : 'insufficient'

  return {
    state,
    sufficient: state === 'sufficient',
    observed,
    thresholds,
  }
}

function compareSourceMetrics(
  left: MinorTraitSourceMetric,
  right: MinorTraitSourceMetric,
): number {
  return right.percentile - left.percentile || left.key.localeCompare(right.key)
}

export function minorTraitEvidence(
  input: MinorTraitEvidenceInput,
): MinorTraitEvidence {
  const policies = PILLARS[input.playerType]
  const supportedMetricKeys = new Set(
    policies.flatMap((pillar) => pillar.metricKeys),
  )
  const candidates = new Map<string, MinorTraitMetricInput[]>()
  let providerCompositeMetricCount = 0
  let kMinusBbPercentileCount = 0
  let unsupportedSourceMetricCount = 0
  let invalidPercentileCount = 0

  for (const metric of input.metrics) {
    const key = normalizedKey(metric.key)
    const identity = keyIdentity(key)
    if (PROVIDER_COMPOSITE_IDENTITIES.has(identity)) {
      providerCompositeMetricCount += 1
      continue
    }
    if (K_MINUS_BB_IDENTITIES.has(identity)) {
      kMinusBbPercentileCount += 1
      continue
    }
    if (!supportedMetricKeys.has(key)) continue
    if (metric.source !== SOURCE) {
      unsupportedSourceMetricCount += 1
      continue
    }
    if (percentile(metric.percentile) === null) {
      if (metric.percentile !== null && metric.percentile !== undefined) {
        invalidPercentileCount += 1
      }
      continue
    }
    candidates.set(key, [...(candidates.get(key) ?? []), metric])
  }

  const duplicateMetricKeys = new Set(
    [...candidates.entries()]
      .filter(([, metrics]) => metrics.length > 1)
      .map(([key]) => key),
  )
  const metricToPillar = new Map(
    policies.flatMap((pillar) =>
      pillar.metricKeys.map((metricKey) => [metricKey, pillar] as const),
    ),
  )
  const sourceMetrics: MinorTraitSourceMetric[] = []

  for (const [key, metrics] of candidates) {
    if (duplicateMetricKeys.has(key)) continue
    const metric = metrics[0]
    const pillar = metricToPillar.get(key)
    const metricPercentile = percentile(metric?.percentile)
    if (!metric || !pillar || metricPercentile === null) continue
    sourceMetrics.push({
      key,
      label: metric.label,
      value: metric.value ?? null,
      percentile: metricPercentile,
      pillar: pillar.key,
      source: SOURCE,
    })
  }

  const pillars: MinorTraitPillar[] = policies.map((policy) => {
    const metrics = sourceMetrics
      .filter((metric) => metric.pillar === policy.key)
      .sort(compareSourceMetrics)
    const strongestMetric = metrics[0] ?? null
    return {
      key: policy.key,
      label: policy.label,
      covered: metrics.length > 0,
      strong:
        strongestMetric !== null &&
        strongestMetric.percentile >= STRONG_PERCENTILE,
      availableMetricCount: metrics.length,
      strongestMetric,
      metrics,
    }
  })
  const coveredPillars = pillars.filter((pillar) => pillar.covered)
  const strongPillars = pillars.filter((pillar) => pillar.strong)
  const coverageSufficient = coveredPillars.length >= REQUIRED_COVERED_PILLARS
  const multiPillar = strongPillars.length >= REQUIRED_STRONG_PILLARS
  const opportunity = opportunityEvidence(input.playerType, input.opportunity)
  const warnings: string[] = []

  if (opportunity.state === 'unavailable' || opportunity.state === 'insufficient') {
    warnings.push('insufficient_opportunity')
  } else if (opportunity.state === 'provisional') {
    warnings.push('provisional_opportunity')
  }
  if (!coverageSufficient) warnings.push('insufficient_pillar_coverage')
  if (providerCompositeMetricCount > 0) {
    warnings.push('provider_composite_metric_excluded')
  }
  if (kMinusBbPercentileCount > 0) {
    warnings.push('source_k_minus_bb_percentile_withheld')
  }
  if (unsupportedSourceMetricCount > 0) {
    warnings.push('unsupported_metric_source_excluded')
  }
  if (invalidPercentileCount > 0) warnings.push('invalid_percentile_excluded')
  if (duplicateMetricKeys.size > 0) warnings.push('duplicate_metric_key_excluded')

  return {
    version: 'minor-trait-evidence-v1',
    status: 'descriptive_source_evidence_only',
    predictiveValidation: false,
    playerType: input.playerType,
    opportunity,
    coverage: {
      availableMetricCount: sourceMetrics.length,
      coveredPillarCount: coveredPillars.length,
      totalPillarCount: pillars.length,
      requiredCoveredPillars: REQUIRED_COVERED_PILLARS,
      sufficient: coverageSufficient,
      missingPillars: pillars
        .filter((pillar) => !pillar.covered)
        .map((pillar) => pillar.label),
    },
    corroboration: {
      strongPercentileThreshold: STRONG_PERCENTILE,
      strongPillarCount: strongPillars.length,
      requiredStrongPillars: REQUIRED_STRONG_PILLARS,
      multiPillar,
      passesAllDescriptiveGates:
        opportunity.sufficient && coverageSufficient && multiPillar,
    },
    pillars,
    strongestMetrics: [...sourceMetrics]
      .sort(compareSourceMetrics)
      .slice(0, MAX_STRONGEST_METRICS),
    exclusions: {
      providerCompositeMetricCount,
      kMinusBbPercentileCount,
      unsupportedSourceMetricCount,
      invalidPercentileCount,
      duplicateMetricKeyCount: duplicateMetricKeys.size,
    },
    warnings,
  }
}
