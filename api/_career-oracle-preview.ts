import { existsSync, readFileSync } from 'node:fs'
import type {
  CareerForecast,
  CareerForecastArcPoint,
  CareerForecastDecomposition,
  ConfidenceState,
  HofStandardReference,
  ModelDriver,
  PlayerStage,
  PlayerType,
  PublicationState,
  WarQuantiles,
} from './_career-oracle-types.js'

type JsonRecord = Record<string, unknown>

export interface CareerPreviewPlayer {
  id: string
  name: string
  playerType: PlayerType
  stage: PlayerStage
  age: number | null
  organization: string | null
  organizationCode: string | null
  position: string | null
  level: string | null
  batsThrows: string | null
  externalIds: Record<string, string | number | null>
  careerForecast: CareerForecast
}

export interface CareerOraclePreview {
  schemaVersion: 'career-oracle-preview/v1'
  asOf: string
  modelVersion: string
  targetVersion: string
  dataVersion: string | null
  providerVersion: string | null
  releaseEligible: boolean
  items: CareerPreviewPlayer[]
  prospectForecasts: Record<string, CareerPreviewProspectForecast>
}

export interface CareerPreviewProspectForecast {
  key: string
  mlbamId: string
  playerType: Extract<PlayerType, 'Hitter' | 'Pitcher'>
  canonicalPlayerId: string | null
  careerForecast: CareerForecast
}

const defaultPreviewPath = new URL('./_data/career-oracle-preview.json', import.meta.url)
let cachedDefaultPreview: CareerOraclePreview | undefined

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function requiredString(value: unknown, label: string): string {
  const parsed = stringValue(value)
  if (parsed === null) throw new Error(`${label} must be a non-empty string`)
  return parsed
}

function finiteNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number or null`)
  }
  return value
}

function probability(value: unknown, label: string): number | null {
  const parsed = finiteNumber(value, label)
  if (parsed !== null && (parsed < 0 || parsed > 1)) {
    throw new Error(`${label} must be between 0 and 1`)
  }
  return parsed
}

function booleanValue(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`)
  return value
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${label} is invalid`)
  }
  return value as T
}

function playerType(value: unknown, label: string): PlayerType {
  if (value === 'Hitter' || value === 'hitter') return 'Hitter'
  if (value === 'Pitcher' || value === 'pitcher') return 'Pitcher'
  if (value === 'Two-way' || value === 'two-way' || value === 'two_way') return 'Two-way'
  throw new Error(`${label} is invalid`)
}

function quantiles(value: unknown, label: string): WarQuantiles | null {
  if (value === null || value === undefined) return null
  const input = record(value, label)
  const parsed = {
    p10: finiteNumber(input.p10 ?? input.q10, `${label}.p10`),
    p25: finiteNumber(input.p25 ?? input.q25, `${label}.p25`),
    p50: finiteNumber(input.p50 ?? input.q50 ?? input.median, `${label}.p50`),
    p75: finiteNumber(input.p75 ?? input.q75, `${label}.p75`),
    p90: finiteNumber(input.p90 ?? input.q90, `${label}.p90`),
  }
  if (Object.values(parsed).some((entry) => entry === null)) {
    throw new Error(`${label} must contain p10, p25, p50, p75, and p90`)
  }

  const complete = parsed as WarQuantiles
  const ordered = [complete.p10, complete.p25, complete.p50, complete.p75, complete.p90]
  if (ordered.some((entry, index) => index > 0 && entry < ordered[index - 1]!)) {
    throw new Error(`${label} must be monotone`)
  }
  return complete
}

function confidenceState(value: unknown, score: number | null): ConfidenceState {
  if (value === 'low' || value === 'Low') return 'Low'
  if (value === 'moderate' || value === 'Moderate') return 'Moderate'
  if (value === 'high' || value === 'High') return 'High'
  if (value === 'withheld' || value === 'Withheld') return 'Withheld'
  if (value !== null && value !== undefined) throw new Error('confidence.state is invalid')
  if (score === null) return 'Withheld'
  if (score >= 0.75) return 'High'
  if (score >= 0.45) return 'Moderate'
  return 'Low'
}

function arc(value: unknown, label: string): CareerForecastArcPoint[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  const points = value.map((entry, index) => {
    const input = record(entry, `${label}[${index}]`)
    const age = finiteNumber(input.age, `${label}[${index}].age`)
    const ranges = quantiles(input, `${label}[${index}]`)
    if (age === null || ranges === null) throw new Error(`${label}[${index}] is incomplete`)
    return {
      age,
      actual: finiteNumber(input.actual, `${label}[${index}].actual`),
      ...ranges,
    }
  })
  return points.toSorted((left, right) => left.age - right.age)
}

function stringArray(value: unknown, label: string): string[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of strings`)
  }
  return value.map((entry) => entry.trim()).filter(Boolean)
}

function drivers(value: unknown, label: string): ModelDriver[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((entry, index) => {
    const input = record(entry, `${label}[${index}]`)
    const impact = finiteNumber(input.impact, `${label}[${index}].impact`)
    if (impact === null) throw new Error(`${label}[${index}].impact is required`)
    return {
      label: requiredString(input.label, `${label}[${index}].label`),
      value: requiredString(input.value, `${label}[${index}].value`),
      detail: requiredString(input.detail, `${label}[${index}].detail`),
      impact,
      source: stringValue(input.source) ?? undefined,
    }
  })
}

function externalIds(value: unknown): Record<string, string | number | null> {
  if (value === null || value === undefined) return {}
  const input = record(value, 'externalIds')
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string | number | null] =>
        entry[1] === null || typeof entry[1] === 'string' || typeof entry[1] === 'number',
    ),
  )
}

function scalarLineage(value: unknown, label: string): Record<string, string | number | boolean | null> {
  if (value === null || value === undefined) return {}
  const input = record(value, label)
  const output: Record<string, string | number | boolean | null> = {}
  for (const [key, entry] of Object.entries(input)) {
    if (
      entry === null ||
      typeof entry === 'string' ||
      typeof entry === 'boolean' ||
      (typeof entry === 'number' && Number.isFinite(entry))
    ) {
      output[key] = entry
    }
  }
  return output
}

function arrivalProbability36(input: JsonRecord): number | null {
  const direct = input.arrivalProbability36 ?? input.mlbArrivalProbability36
  if (direct !== null && direct !== undefined) return probability(direct, 'arrivalProbability36')

  if (typeof input.arrivalProbabilities === 'object' && input.arrivalProbabilities !== null) {
    const probabilities = input.arrivalProbabilities as JsonRecord
    if (probabilities['36'] !== undefined) {
      return probability(probabilities['36'], 'arrivalProbabilities.36')
    }
  }

  const horizons = input.arrivalHorizons
  if (Array.isArray(horizons)) {
    const horizon = horizons.find((entry) => {
      if (typeof entry !== 'object' || entry === null) return false
      return (entry as JsonRecord).months === 36
    })
    if (horizon) return probability((horizon as JsonRecord).probability, 'arrivalHorizons.36')
  }
  return null
}

function decomposition(value: unknown, forecast: JsonRecord): CareerForecastDecomposition {
  const input = value === null || value === undefined ? {} : record(value, 'decomposition')
  return {
    arrivalProbability: probability(
      input.arrivalProbability ?? forecast.arrivalProbability,
      'decomposition.arrivalProbability',
    ),
    hofCaliberGivenMlbProbability: probability(
      input.hofCaliberGivenMlbProbability ?? input.hofGivenMlbProbability ??
        input.conditionalHofCaliberProbability ?? forecast.conditionalHofCaliberProbability,
      'decomposition.hofCaliberGivenMlbProbability',
    ),
    noMlbProbability: probability(
      input.noMlbProbability ?? input.noArrivalProbability,
      'decomposition.noMlbProbability',
    ),
    observedCumulativeWar: finiteNumber(
      input.observedCumulativeWar ?? forecast.cumulativeWar ?? forecast.actualCumulativeWar,
      'decomposition.observedCumulativeWar',
    ),
  }
}

function hofStandard(value: unknown): HofStandardReference | null {
  if (value === null || value === undefined) return null
  const input = record(value, 'hofStandard')
  return {
    label: requiredString(input.label ?? input.key, 'hofStandard.label'),
    roleOrPosition: stringValue(input.roleOrPosition ?? input.position ?? input.key),
    careerWar: finiteNumber(input.careerWar, 'hofStandard.careerWar'),
    peakSevenWar: finiteNumber(input.peakSevenWar, 'hofStandard.peakSevenWar'),
    jaws: finiteNumber(input.jaws, 'hofStandard.jaws'),
    fallbackUsed: booleanValue(
      input.fallbackUsed ?? input.derivedFallback,
      false,
      'hofStandard.fallbackUsed',
    ),
  }
}

type PreviewBase = Omit<CareerOraclePreview, 'items' | 'prospectForecasts'>

function parseForecast(
  input: JsonRecord,
  forecastInput: JsonRecord,
  label: string,
  preview: PreviewBase,
): CareerForecast {
  const publicationState = oneOf<PublicationState>(
    input.publicationState ?? forecastInput.publicationState,
    ['observed', 'research', 'released', 'withheld'],
    `${label}.publicationState`,
  )
  const confidenceInput = typeof forecastInput.confidence === 'object' && forecastInput.confidence !== null
    ? record(forecastInput.confidence, `${label}.confidence`)
    : {}
  const confidenceScore = probability(
    confidenceInput.score ?? forecastInput.confidenceScore ??
      (typeof forecastInput.confidence === 'number' ? forecastInput.confidence : null),
    `${label}.confidence.score`,
  )
  const rawRank = finiteNumber(input.rank ?? forecastInput.rank, `${label}.rank`)
  if (rawRank !== null && (!Number.isInteger(rawRank) || rawRank < 1)) {
    throw new Error(`${label}.rank must be a positive integer or null`)
  }
  const hofCaliberProbability = probability(
    forecastInput.hofCaliberProbability ?? input.hofCaliberProbability ??
      forecastInput.hofProbability ?? forecastInput.unconditionalHofCaliberProbability,
    `${label}.hofCaliberProbability`,
  )
  if ((publicationState === 'research' || publicationState === 'released') && hofCaliberProbability === null) {
    throw new Error(`${label} publishes a forecast without hofCaliberProbability`)
  }
  const rawLineage = scalarLineage(
    forecastInput.lineage ?? input.lineage,
    `${label}.lineage`,
  )

  return {
    publicationState,
    releaseEligible: booleanValue(
      forecastInput.releaseEligible ?? input.releaseEligible,
      preview.releaseEligible,
      `${label}.releaseEligible`,
    ),
    asOf: requiredString(
      forecastInput.asOf ?? input.asOf ?? rawLineage.arrivalAsOf ?? preview.asOf,
      `${label}.asOf`,
    ),
    rank: rawRank,
    hofCaliberProbability,
    finalCareerWar: quantiles(
      forecastInput.finalCareerWar ?? input.finalCareerWar,
      `${label}.finalCareerWar`,
    ),
    peakSevenWar: quantiles(
      forecastInput.peakSevenWar ?? input.peakSevenWar,
      `${label}.peakSevenWar`,
    ),
    finalJaws: quantiles(
      forecastInput.finalJaws ?? input.finalJaws,
      `${label}.finalJaws`,
    ),
    scenarioSupportExtensionJaws: finiteNumber(
      forecastInput.scenarioSupportExtensionJaws ?? input.scenarioSupportExtensionJaws,
      `${label}.scenarioSupportExtensionJaws`,
    ),
    cumulativeWar: finiteNumber(
      forecastInput.cumulativeWar ?? forecastInput.actualCumulativeWar ?? input.cumulativeWar,
      `${label}.cumulativeWar`,
    ),
    arrivalProbability36: arrivalProbability36({ ...input, ...forecastInput }),
    confidenceScore,
    confidenceState: confidenceState(
      confidenceInput.state ?? forecastInput.confidenceState,
      confidenceScore,
    ),
    intervalWidth: finiteNumber(
      confidenceInput.intervalWidth ?? forecastInput.intervalWidth,
      `${label}.intervalWidth`,
    ),
    arc: arc(forecastInput.arc ?? forecastInput.careerArc, `${label}.arc`),
    decomposition: decomposition(
      forecastInput.decomposition ?? input.decomposition,
      { ...input, ...forecastInput },
    ),
    hofStandard: hofStandard(
      forecastInput.hofStandard ?? forecastInput.standardReference ??
        input.hofStandard ?? input.standardReference,
    ),
    summary: stringValue(forecastInput.summary ?? input.summary),
    drivers: drivers(forecastInput.drivers ?? input.drivers, `${label}.drivers`),
    warnings: stringArray(forecastInput.warnings ?? input.warnings, `${label}.warnings`),
    lineage: {
      ...rawLineage,
      modelVersion: requiredString(
        rawLineage.modelVersion ?? forecastInput.modelVersion ?? preview.modelVersion,
        `${label}.modelVersion`,
      ),
      targetVersion: requiredString(
        rawLineage.targetVersion ?? forecastInput.targetVersion ?? preview.targetVersion,
        `${label}.targetVersion`,
      ),
      dataVersion: stringValue(
        rawLineage.dataVersion ?? forecastInput.dataVersion ?? preview.dataVersion,
      ),
      providerVersion: stringValue(
        rawLineage.providerVersion ?? forecastInput.providerVersion ?? preview.providerVersion,
      ),
    },
  }
}

function parsePlayer(
  value: unknown,
  index: number,
  preview: PreviewBase,
): CareerPreviewPlayer {
  const input = record(value, `items[${index}]`)
  const forecastInput = input.forecast === undefined
    ? input
    : record(input.forecast, `items[${index}].forecast`)
  const forecast = parseForecast(input, forecastInput, `items[${index}]`, preview)
  const parsedExternalIds = externalIds(input.externalIds)
  const bbrefId = stringValue(input.bbrefId)
  if (bbrefId !== null) parsedExternalIds.baseballReference = bbrefId
  const mlbamId = input.mlbamId ?? input.mlbam_id
  if (typeof mlbamId === 'string' || typeof mlbamId === 'number') {
    parsedExternalIds.mlbam = mlbamId
  } else if (mlbamId !== null && mlbamId !== undefined) {
    throw new Error(`items[${index}].mlbamId must be a string, number, or null`)
  }

  return {
    id: requiredString(
      input.canonicalPlayerId ?? input.canonicalId ?? input.playerId ?? input.id,
      `items[${index}].playerId`,
    ),
    name: requiredString(input.name ?? input.displayName, `items[${index}].name`),
    playerType: playerType(input.playerType ?? input.role, `items[${index}].playerType`),
    stage: oneOf<PlayerStage>(
      input.stage,
      ['pre_debut', 'early_mlb', 'established_mlb', 'inactive'],
      `items[${index}].stage`,
    ),
    age: finiteNumber(input.age, `items[${index}].age`),
    organization: stringValue(input.organization ?? input.team),
    organizationCode: stringValue(input.organizationCode ?? input.teamCode),
    position: stringValue(input.position),
    level: stringValue(input.level),
    batsThrows: stringValue(input.batsThrows),
    externalIds: parsedExternalIds,
    careerForecast: forecast,
  }
}

function parseProspectForecasts(
  value: unknown,
  preview: PreviewBase,
): Record<string, CareerPreviewProspectForecast> {
  if (value === null || value === undefined) return {}
  const input = record(value, 'career preview prospectForecasts')
  const output: Record<string, CareerPreviewProspectForecast> = {}

  for (const [key, rawForecast] of Object.entries(input)) {
    const match = /^(\d+):(hitter|pitcher)$/u.exec(key)
    if (!match) throw new Error(`prospectForecasts key ${key} is invalid`)
    const forecastInput = record(rawForecast, `prospectForecasts.${key}`)
    const parsedType = playerType(
      forecastInput.playerType ?? forecastInput.role ?? match[2],
      `prospectForecasts.${key}.playerType`,
    )
    const expectedType = match[2] === 'hitter' ? 'Hitter' : 'Pitcher'
    if (parsedType !== expectedType) {
      throw new Error(`prospectForecasts.${key}.playerType does not match its key`)
    }

    output[key] = {
      key,
      mlbamId: match[1]!,
      playerType: expectedType,
      canonicalPlayerId: stringValue(
        forecastInput.canonicalPlayerId ?? forecastInput.canonicalId ?? forecastInput.playerId,
      ),
      careerForecast: parseForecast(
        forecastInput,
        forecastInput,
        `prospectForecasts.${key}`,
        preview,
      ),
    }
  }

  return output
}

export function parseCareerOraclePreview(value: unknown): CareerOraclePreview {
  const input = record(value, 'career preview')
  if (input.schemaVersion !== 'career-oracle-preview/v1') {
    throw new Error('career preview schemaVersion is invalid')
  }
  const rawItems = input.items ?? input.players
  if (!Array.isArray(rawItems)) throw new Error('career preview items must be an array')

  const base = {
    schemaVersion: 'career-oracle-preview/v1' as const,
    asOf: requiredString(input.asOf, 'career preview asOf'),
    modelVersion: requiredString(input.modelVersion, 'career preview modelVersion'),
    targetVersion: requiredString(input.targetVersion, 'career preview targetVersion'),
    dataVersion: stringValue(input.dataVersion),
    providerVersion: stringValue(input.providerVersion),
    releaseEligible: booleanValue(input.releaseEligible, false, 'career preview releaseEligible'),
  }
  return {
    ...base,
    items: rawItems.map((entry, index) => parsePlayer(entry, index, base)),
    prospectForecasts: parseProspectForecasts(input.prospectForecasts, base),
  }
}

export function loadCareerOraclePreview(
  path: URL | string = defaultPreviewPath,
): CareerOraclePreview | null {
  const isDefaultPath = path === defaultPreviewPath ||
    (path instanceof URL && path.href === defaultPreviewPath.href)
  if (isDefaultPath && cachedDefaultPreview !== undefined) return cachedDefaultPreview
  if (!existsSync(path)) return null
  try {
    const parsed = parseCareerOraclePreview(JSON.parse(readFileSync(path, 'utf8')) as unknown)
    if (isDefaultPath) cachedDefaultPreview = parsed
    return parsed
  } catch (error) {
    console.error('Career Oracle preview artifact is invalid', error)
    return null
  }
}
