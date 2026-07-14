import livePriorJson from './_data/milb-impact-live-prior.json' with { type: 'json' }
import { z } from 'zod'

const finiteProbabilitySchema = z.number().finite().min(0).max(1)
const identityRoleSchema = z.enum(['hitter', 'pitcher'])

const runtimeArtifactSchema = z.object({
  schemaVersion: z.literal('milb-impact-live-prior-runtime/v1'),
  status: z.literal('research_only'),
  releaseEligible: z.literal(false),
  modelVersion: z.literal('milb-impact-five-calendar-year-war-v1'),
  priorModel: z.literal('age_level_role_performance_prior'),
  sourceFeatureSeason: z.literal(2025),
  sourceFeatureAsOf: z.iso.datetime({ offset: true }),
  sourceModelSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceScoresSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  target: z.object({
    id: z.literal('mlb_war_next_5_ge_5'),
    label: z.string().min(1),
    scope: z.literal('unconditional'),
  }).strict(),
  inputPolicy: z.object({
    identity: z.literal('exact_mlbam_and_role'),
    eligibility: z.literal('official_current_milb_stat_row'),
    levelMap: z.object({
      AAA: z.literal('AAA'),
      AA: z.literal('AA'),
      'A+': z.literal('Adv A'),
      A: z.literal('A'),
      RkDomestic: z.literal('Rookie'),
      RkDsl: z.literal('Foreign Rookie'),
    }).strict(),
    hitterPerformance: z.literal('iso_plus_bb_rate_minus_k_rate'),
    pitcherPerformance: z.literal('k_minus_bb_rate'),
    partialSeasonPolicy: z.literal('numeric_rank_with_explicit_high_volatility'),
    rankReference: z.literal(
      'frozen_prior_probability_then_continuous_prior_performance_signal_then_age_then_exact_mlbam',
    ),
  }).strict(),
  fittedPrior: z.object({
    smoothing: z.number().finite().positive(),
    globalProbability: finiteProbabilitySchema,
    performanceEdges: z.object({
      hitter: z.array(z.number().finite()).length(3),
      pitcher: z.array(z.number().finite()).length(3),
    }).strict(),
    hierarchy: z.array(z.object({
      columns: z.array(z.enum(['role', 'level', 'age_band', 'performance_band'])).min(1),
      rates: z.array(z.object({
        key: z.array(z.string().min(1)).min(1),
        probability: finiteProbabilitySchema,
      }).strict()).min(1),
    }).strict()).length(4),
  }).strict(),
  referenceUniverse: z.object({
    rows: z.number().int().positive(),
    featureSeason: z.literal(2025),
    ordering: z.tuple([
      z.literal('prior_probability_desc'),
      z.literal('performance_signal_desc_nulls_last'),
      z.literal('age_asc_nulls_last'),
      z.literal('mlbam_id_asc'),
    ]),
    entries: z.array(z.object({
      mlbamId: z.string().regex(/^\d+$/u),
      role: identityRoleSchema,
      age: z.number().finite().positive().nullable(),
      priorProbability: finiteProbabilitySchema,
      performanceSignal: z.number().finite().nullable(),
    }).strict()).min(1),
  }).strict(),
  warnings: z.array(z.string().min(1)).min(1),
}).strict()

const artifact = runtimeArtifactSchema.parse(livePriorJson)
if (artifact.referenceUniverse.entries.length !== artifact.referenceUniverse.rows) {
  throw new Error('Live MiLB impact prior reference count is inconsistent')
}

const referenceIdentities = new Set<string>()
for (const entry of artifact.referenceUniverse.entries) {
  const identity = `${entry.mlbamId}:${entry.role}`
  if (referenceIdentities.has(identity)) {
    throw new Error(`Duplicate live MiLB impact prior reference identity: ${identity}`)
  }
  referenceIdentities.add(identity)
}

const hierarchy = artifact.fittedPrior.hierarchy.map((level) => ({
  columns: level.columns,
  rates: new Map(level.rates.map((rate) => [rate.key.join('\u001f'), rate.probability])),
}))

type DatabaseNumber = bigint | number | string | null | undefined
type LivePriorRole = z.infer<typeof identityRoleSchema>

export interface LiveMilbImpactPriorInput {
  mlbamId: DatabaseNumber
  playerType: 'Hitter' | 'Pitcher'
  officialStatsObserved: boolean
  season: DatabaseNumber
  knownAt: string
  age: DatabaseNumber
  level: string | null
  teamName?: string | null
  pa?: DatabaseNumber
  ba?: DatabaseNumber
  slg?: DatabaseNumber
  iso?: DatabaseNumber
  walkRate?: DatabaseNumber
  strikeoutRate?: DatabaseNumber
  ip?: DatabaseNumber
  kMinusBbRate?: DatabaseNumber
}

export interface LiveMilbImpactPriorComponents {
  identity: string
  mlbamId: string
  role: LivePriorRole
  season: number
  age: number | null
  level: string
  ageBand: string
  performanceBand: string
  performanceSignal: number | null
  internalOrderingProbability: number
  hierarchyDepth: number
  workload: number | null
}

export interface ResearchLiveMilbImpactPriorRanking {
  rank: number
  rankPercentile: number
  universeRows: number
  rankScope: 'completed_2025_prior_reference_equivalent'
  rankBasis: 'in_season_early_estimate'
  mappingStatus: 'insufficient_sample'
  reason: 'live_in_season_prior'
  volatility: 'high' | 'very_high'
  status: 'research_only'
  releaseEligible: false
  modelVersion: 'milb-impact-five-calendar-year-war-v1'
  priorModel: 'age_level_role_performance_prior'
  featureSeason: number
  featureAsOf: string
  target: {
    id: 'mlb_war_next_5_ge_5'
    label: string
    scope: 'unconditional'
    windowStartSeason: number
    windowEndSeason: number
  }
  evidence: {
    source: 'MLB StatsAPI'
    identity: 'exact_mlbam_and_role'
    level: string
    ageBand: string
    performanceBand: string
    workload: number | null
  }
  warnings: string[]
}

function finiteNumber(value: DatabaseNumber): number | null {
  if (typeof value === 'bigint') {
    const converted = Number(value)
    return Number.isSafeInteger(converted) ? converted : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const converted = Number(value)
  return Number.isFinite(converted) ? converted : null
}

function canonicalMlbamId(value: DatabaseNumber): string | null {
  if (typeof value === 'bigint') return value > 0n ? value.toString() : null
  const text = String(value ?? '').trim()
  return /^\d+$/u.test(text) && BigInt(text) > 0n ? text : null
}

function canonicalSeason(value: DatabaseNumber): number | null {
  const season = finiteNumber(value)
  return season !== null && Number.isInteger(season) && season >= 1871 && season <= 2200
    ? season
    : null
}

function canonicalLevel(level: string | null, teamName: string | null | undefined): string | null {
  const value = level?.trim() ?? ''
  if (value === 'AAA' || value === 'AA' || value === 'A') return value
  if (value === 'A+' || value === 'Adv A') return 'Adv A'
  if (value === 'Foreign Rookie') return value
  if (value === 'Rookie') return value
  if (value === 'Rk') return /(^|\s)DSL(?:\s|$)/iu.test(teamName ?? '')
    ? 'Foreign Rookie'
    : 'Rookie'
  return null
}

function ageBand(age: number | null): string {
  if (age === null) return 'missing'
  if (age <= 19) return '19_or_younger'
  if (age <= 21) return '20_21'
  if (age <= 23) return '22_23'
  if (age <= 25) return '24_25'
  return '26_or_older'
}

function performanceSignal(input: LiveMilbImpactPriorInput): number | null {
  if (input.playerType === 'Pitcher') return finiteNumber(input.kMinusBbRate)
  const directIso = finiteNumber(input.iso)
  const ba = finiteNumber(input.ba)
  const slg = finiteNumber(input.slg)
  const iso = directIso ?? (ba !== null && slg !== null ? slg - ba : null)
  const walkRate = finiteNumber(input.walkRate)
  const strikeoutRate = finiteNumber(input.strikeoutRate)
  return iso !== null && walkRate !== null && strikeoutRate !== null
    ? iso + walkRate - strikeoutRate
    : null
}

function performanceBand(role: LivePriorRole, performance: number | null): string {
  if (performance === null) return 'missing'
  const edges = artifact.fittedPrior.performanceEdges[role]
  const index = edges.findIndex((edge) => performance <= edge)
  return `q${index < 0 ? edges.length + 1 : index + 1}`
}

function orderingProbability(values: Record<string, string>): {
  probability: number
  depth: number
} {
  let probability = artifact.fittedPrior.globalProbability
  let depth = 0
  for (const level of hierarchy) {
    const key = level.columns.map((column) => values[column] ?? 'missing').join('\u001f')
    const candidate = level.rates.get(key)
    if (candidate !== undefined) {
      probability = candidate
      depth += 1
    }
  }
  return { probability, depth }
}

export function liveMilbImpactPriorComponents(
  input: LiveMilbImpactPriorInput,
): LiveMilbImpactPriorComponents | null {
  if (!input.officialStatsObserved) return null
  const mlbamId = canonicalMlbamId(input.mlbamId)
  const season = canonicalSeason(input.season)
  const level = canonicalLevel(input.level, input.teamName)
  if (mlbamId === null || season === null || level === null) return null
  const role: LivePriorRole = input.playerType === 'Pitcher' ? 'pitcher' : 'hitter'
  const numericAge = finiteNumber(input.age)
  const age = numericAge !== null && numericAge > 0 ? numericAge : null
  const signal = performanceSignal(input)
  const band = performanceBand(role, signal)
  const values = {
    role,
    level,
    age_band: ageBand(age),
    performance_band: band,
  }
  const score = orderingProbability(values)
  return {
    identity: `${mlbamId}:${role}`,
    mlbamId,
    role,
    season,
    age,
    level,
    ageBand: values.age_band,
    performanceBand: band,
    performanceSignal: signal,
    internalOrderingProbability: score.probability,
    hierarchyDepth: score.depth,
    workload: finiteNumber(role === 'hitter' ? input.pa : input.ip),
  }
}

interface RankComparable {
  mlbamId: string
  role: LivePriorRole
  age: number | null
  priorProbability: number
  performanceSignal: number | null
}

function compareNullableNumber(
  left: number | null,
  right: number | null,
  direction: 'asc' | 'desc',
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return direction === 'asc' ? left - right : right - left
}

function rankOrder(left: RankComparable, right: RankComparable): number {
  const probability = right.priorProbability - left.priorProbability
  if (probability !== 0) return probability
  const performance = compareNullableNumber(
    left.performanceSignal,
    right.performanceSignal,
    'desc',
  )
  if (performance !== 0) return performance
  const age = compareNullableNumber(left.age, right.age, 'asc')
  if (age !== 0) return age
  const leftId = BigInt(left.mlbamId)
  const rightId = BigInt(right.mlbamId)
  if (leftId !== rightId) return leftId < rightId ? -1 : 1
  return left.role.localeCompare(right.role, 'en-US')
}

function rankPercentile(rank: number, universeRows: number): number {
  return universeRows <= 1 ? 100 : 100 * (universeRows - rank) / (universeRows - 1)
}

function rankingFromComponents(
  input: LiveMilbImpactPriorInput,
  components: LiveMilbImpactPriorComponents,
  rank: number,
  universeRows: number,
): ResearchLiveMilbImpactPriorRanking {
  const minimumWorkload = components.role === 'hitter' ? 75 : 20
  const volatility = components.workload !== null && components.workload >= minimumWorkload
    ? 'high' as const
    : 'very_high' as const
  return {
    rank,
    rankPercentile: Number(rankPercentile(rank, universeRows).toFixed(6)),
    universeRows,
    rankScope: 'completed_2025_prior_reference_equivalent',
    rankBasis: 'in_season_early_estimate',
    mappingStatus: 'insufficient_sample',
    reason: 'live_in_season_prior',
    volatility,
    status: artifact.status,
    releaseEligible: artifact.releaseEligible,
    modelVersion: artifact.modelVersion,
    priorModel: artifact.priorModel,
    featureSeason: components.season,
    featureAsOf: input.knownAt,
    target: {
      ...artifact.target,
      windowStartSeason: components.season + 1,
      windowEndSeason: components.season + 5,
    },
    evidence: {
      source: 'MLB StatsAPI',
      identity: 'exact_mlbam_and_role',
      level: components.level,
      ageBand: components.ageBand,
      performanceBand: components.performanceBand,
      workload: components.workload,
    },
    warnings: [...artifact.warnings],
  }
}

export function researchLiveMilbImpactPriorRankings(
  inputs: readonly LiveMilbImpactPriorInput[],
): Map<string, ResearchLiveMilbImpactPriorRanking> {
  const live = new Map<string, {
    input: LiveMilbImpactPriorInput
    components: LiveMilbImpactPriorComponents
  }>()
  for (const input of inputs) {
    const components = liveMilbImpactPriorComponents(input)
    if (components === null || referenceIdentities.has(components.identity)) continue
    if (live.has(components.identity)) {
      throw new Error(`Duplicate live MiLB impact prior identity: ${components.identity}`)
    }
    live.set(components.identity, { input, components })
  }
  if (live.size === 0) return new Map()

  const combined: Array<RankComparable & { identity: string; live: boolean }> = [
    ...artifact.referenceUniverse.entries.map((entry) => ({
      ...entry,
      identity: `${entry.mlbamId}:${entry.role}`,
      live: false,
    })),
    ...[...live.values()].map(({ components }) => ({
      identity: components.identity,
      mlbamId: components.mlbamId,
      role: components.role,
      age: components.age,
      priorProbability: components.internalOrderingProbability,
      performanceSignal: components.performanceSignal,
      live: true,
    })),
  ].sort(rankOrder)

  const ranks = new Map<string, number>()
  combined.forEach((entry, index) => {
    if (entry.live) ranks.set(entry.identity, index + 1)
  })
  const result = new Map<string, ResearchLiveMilbImpactPriorRanking>()
  for (const [identity, { input, components }] of live) {
    const rank = ranks.get(identity)
    if (rank === undefined) throw new Error(`Live MiLB impact prior rank missing: ${identity}`)
    result.set(
      identity,
      rankingFromComponents(input, components, rank, combined.length),
    )
  }
  return result
}

export function researchLiveMilbImpactPriorRanking(
  input: LiveMilbImpactPriorInput,
): ResearchLiveMilbImpactPriorRanking | null {
  const components = liveMilbImpactPriorComponents(input)
  if (components === null) return null
  return researchLiveMilbImpactPriorRankings([input]).get(components.identity) ?? null
}

export const researchLiveMilbImpactPriorSummary = {
  status: artifact.status,
  releaseEligible: artifact.releaseEligible,
  modelVersion: artifact.modelVersion,
  priorModel: artifact.priorModel,
  sourceFeatureSeason: artifact.sourceFeatureSeason,
  sourceFeatureAsOf: artifact.sourceFeatureAsOf,
  universeRows: artifact.referenceUniverse.rows,
  target: artifact.target,
  inputPolicy: artifact.inputPolicy,
  warnings: [...artifact.warnings],
}
