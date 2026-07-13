import { existsSync, readFileSync } from 'node:fs'
import type {
  AlphaSignal,
  CareerChapter,
  CareerForecast,
  CareerForecastArcPoint,
  CareerForecastDecomposition,
  ConfidenceState,
  HofStandardReference,
  ModelDriver,
  PlayerStage,
  PlayerType,
  PublicationState,
  RelativeSignal,
  RelativeSignalReliability,
  WarQuantiles,
} from './_career-oracle-types.js'

type JsonRecord = Record<string, unknown>

const alphaPriorityDelta = 0.10
const alphaMinimumRunwayYears = 2
const alphaMaximumEarlySeason = 6
const alphaExperienceBandRanges: Record<string, readonly [number, number]> = {
  first: [1, 1],
  seasons_2_3: [2, 3],
  seasons_4_6: [4, 6],
  seasons_7_10: [7, 10],
  season_11_plus: [11, 100],
}

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

function requiredFiniteNumber(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label)
  if (parsed === null) throw new Error(`${label} is required`)
  return parsed
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = requiredFiniteNumber(value, label)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
  return parsed
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = requiredFiniteNumber(value, label)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return parsed
}

function percentile(value: unknown, label: string): number {
  const parsed = requiredFiniteNumber(value, label)
  if (parsed < 0 || parsed > 100) throw new Error(`${label} must be between 0 and 100`)
  return parsed
}

function probability(value: unknown, label: string): number | null {
  const parsed = finiteNumber(value, label)
  if (parsed !== null && (parsed < 0 || parsed > 1)) {
    throw new Error(`${label} must be between 0 and 1`)
  }
  return parsed
}

function requiredProbability(value: unknown, label: string): number {
  const parsed = probability(value, label)
  if (parsed === null) throw new Error(`${label} is required`)
  return parsed
}

function booleanValue(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`)
  return value
}

function requiredBoolean(value: unknown, label: string): boolean {
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
  const estimatedDebutAge = finiteNumber(
    input.estimatedDebutAge,
    'decomposition.estimatedDebutAge',
  )
  if (estimatedDebutAge !== null && (estimatedDebutAge < 16 || estimatedDebutAge > 50)) {
    throw new Error('decomposition.estimatedDebutAge must be between 16 and 50')
  }
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
    estimatedDebutAge,
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

function relativeReliability(value: unknown, label: string): RelativeSignalReliability {
  return oneOf(value, ['high', 'moderate', 'low'], label)
}

function relativeSignal(value: unknown, label: string): RelativeSignal | null {
  if (value === null || value === undefined) return null
  const input = record(value, label)
  const version = oneOf(input.version, ['relative-standing-v1'], `${label}.version`)
  const kind = oneOf(input.kind, ['hall_track', 'arrival_track'], `${label}.kind`)
  const status = oneOf(input.status, ['research', 'withheld'], `${label}.status`)

  const currentPeer = input.currentPeer === null || input.currentPeer === undefined
    ? null
    : (() => {
        const peer = record(input.currentPeer, `${label}.currentPeer`)
        const cohort = record(peer.cohort, `${label}.currentPeer.cohort`)
        const rank = positiveInteger(peer.rank, `${label}.currentPeer.rank`)
        const cohortSize = positiveInteger(
          peer.cohortSize,
          `${label}.currentPeer.cohortSize`,
        )
        if (rank > cohortSize) throw new Error(`${label}.currentPeer.rank exceeds cohortSize`)
        const ageMin = requiredFiniteNumber(
          cohort.ageMin,
          `${label}.currentPeer.cohort.ageMin`,
        )
        const ageMax = requiredFiniteNumber(
          cohort.ageMax,
          `${label}.currentPeer.cohort.ageMax`,
        )
        if (ageMin > ageMax) throw new Error(`${label}.currentPeer.cohort age range is invalid`)
        return {
          percentile: percentile(peer.percentile, `${label}.currentPeer.percentile`),
          rank,
          cohortSize,
          value: requiredProbability(peer.value, `${label}.currentPeer.value`),
          median: requiredProbability(peer.median, `${label}.currentPeer.median`),
          difference: requiredFiniteNumber(
            peer.difference,
            `${label}.currentPeer.difference`,
          ),
          basis: oneOf(
            peer.basis,
            ['hof_caliber_probability', 'arrival_probability_36'],
            `${label}.currentPeer.basis`,
          ),
          reliability: relativeReliability(
            peer.reliability,
            `${label}.currentPeer.reliability`,
          ),
          cohort: {
            scope: oneOf(
              cohort.scope,
              ['current_census'],
              `${label}.currentPeer.cohort.scope`,
            ),
            label: requiredString(cohort.label, `${label}.currentPeer.cohort.label`),
            playerType: playerType(
              cohort.playerType,
              `${label}.currentPeer.cohort.playerType`,
            ),
            stage: oneOf<PlayerStage>(
              cohort.stage,
              ['pre_debut', 'early_mlb', 'established_mlb', 'inactive'],
              `${label}.currentPeer.cohort.stage`,
            ),
            ageMin,
            ageMax,
            ageWindow: requiredFiniteNumber(
              cohort.ageWindow,
              `${label}.currentPeer.cohort.ageWindow`,
            ),
            level: stringValue(cohort.level),
          },
        }
      })()

  const historicalPace = input.historicalPace === null || input.historicalPace === undefined
    ? null
    : (() => {
        const pace = record(input.historicalPace, `${label}.historicalPace`)
        const cohort = record(pace.cohort, `${label}.historicalPace.cohort`)
        const resolvedOnly = booleanValue(
          cohort.resolvedOnly,
          false,
          `${label}.historicalPace.cohort.resolvedOnly`,
        )
        if (!resolvedOnly) throw new Error(`${label}.historicalPace must use resolved careers`)
        const seasonNumberMin = positiveInteger(
          cohort.seasonNumberMin,
          `${label}.historicalPace.cohort.seasonNumberMin`,
        )
        const seasonNumberMax = positiveInteger(
          cohort.seasonNumberMax,
          `${label}.historicalPace.cohort.seasonNumberMax`,
        )
        if (seasonNumberMin > seasonNumberMax) {
          throw new Error(`${label}.historicalPace.cohort season range is invalid`)
        }
        const ageMin = requiredFiniteNumber(
          cohort.ageMin,
          `${label}.historicalPace.cohort.ageMin`,
        )
        const ageMax = requiredFiniteNumber(
          cohort.ageMax,
          `${label}.historicalPace.cohort.ageMax`,
        )
        if (ageMin > ageMax) throw new Error(`${label}.historicalPace.cohort age range is invalid`)
        return {
          percentile: percentile(pace.percentile, `${label}.historicalPace.percentile`),
          cohortSize: positiveInteger(
            pace.cohortSize,
            `${label}.historicalPace.cohortSize`,
          ),
          playerValue: requiredFiniteNumber(
            pace.playerValue,
            `${label}.historicalPace.playerValue`,
          ),
          metric: oneOf(
            pace.metric,
            ['career_war_to_date'],
            `${label}.historicalPace.metric`,
          ),
          reliability: relativeReliability(
            pace.reliability,
            `${label}.historicalPace.reliability`,
          ),
          featureSeason: positiveInteger(
            pace.featureSeason,
            `${label}.historicalPace.featureSeason`,
          ),
          featureAge: requiredFiniteNumber(
            pace.featureAge,
            `${label}.historicalPace.featureAge`,
          ),
          cohort: {
            scope: oneOf(
              cohort.scope,
              ['historical_point_in_time'],
              `${label}.historicalPace.cohort.scope`,
            ),
            label: requiredString(cohort.label, `${label}.historicalPace.cohort.label`),
            role: requiredString(cohort.role, `${label}.historicalPace.cohort.role`),
            stageBand: requiredString(
              cohort.stageBand,
              `${label}.historicalPace.cohort.stageBand`,
            ),
            seasonNumberMin,
            seasonNumberMax,
            ageMin,
            ageMax,
            ageWindow: requiredFiniteNumber(
              cohort.ageWindow,
              `${label}.historicalPace.cohort.ageWindow`,
            ),
            resolvedOnly: true as const,
          },
        }
      })()

  if (status === 'research' && currentPeer === null && historicalPace === null) {
    throw new Error(`${label} publishes a relative signal without a supported comparison`)
  }
  return {
    version,
    kind,
    status,
    currentPeer,
    historicalPace,
    warnings: stringArray(input.warnings, `${label}.warnings`),
  }
}

function careerChapter(value: unknown, label: string): CareerChapter | null {
  if (value === null || value === undefined) return null
  const input = record(value, label)
  const evidence = record(input.evidence, `${label}.evidence`)
  const support = record(input.support, `${label}.support`)
  const exceptional = input.exceptionalTrajectory === null || input.exceptionalTrajectory === undefined
    ? null
    : (() => {
        const trajectory = record(
          input.exceptionalTrajectory,
          `${label}.exceptionalTrajectory`,
        )
        const horizonSeasons = positiveInteger(
          trajectory.horizonSeasons,
          `${label}.exceptionalTrajectory.horizonSeasons`,
        )
        if (horizonSeasons !== 3) {
          throw new Error(`${label}.exceptionalTrajectory.horizonSeasons must be three`)
        }
        return {
          probability: requiredProbability(
            trajectory.probability,
            `${label}.exceptionalTrajectory.probability`,
          ),
          target: oneOf(
            trajectory.target,
            ['next_three_war_ge_global_training_q90'],
            `${label}.exceptionalTrajectory.target`,
          ),
          thresholdWar: requiredFiniteNumber(
            trajectory.thresholdWar,
            `${label}.exceptionalTrajectory.thresholdWar`,
          ),
          horizonSeasons: 3 as const,
          referenceBaseRate: requiredProbability(
            trajectory.referenceBaseRate,
            `${label}.exceptionalTrajectory.referenceBaseRate`,
          ),
          rankScope: oneOf(
            trajectory.rankScope,
            ['current_mlb_absolute_trajectory'],
            `${label}.exceptionalTrajectory.rankScope`,
          ),
        }
      })()
  const historicalPacePercentile = evidence.historicalPacePercentile === null ||
      evidence.historicalPacePercentile === undefined
    ? null
    : percentile(
        evidence.historicalPacePercentile,
        `${label}.evidence.historicalPacePercentile`,
      )
  const priorWarPerSeason = evidence.priorWarPerSeason === null ||
      evidence.priorWarPerSeason === undefined
    ? null
    : requiredFiniteNumber(
        evidence.priorWarPerSeason,
        `${label}.evidence.priorWarPerSeason`,
      )
  const warTrend = evidence.warTrend === null || evidence.warTrend === undefined
    ? null
    : requiredFiniteNumber(evidence.warTrend, `${label}.evidence.warTrend`)
  const status = oneOf(input.status, ['research', 'withheld'], `${label}.status`)
  const referencePlayers = nonNegativeInteger(
    support.referencePlayers,
    `${label}.support.referencePlayers`,
  )
  const referenceLandmarks = nonNegativeInteger(
    support.referenceLandmarks,
    `${label}.support.referenceLandmarks`,
  )
  if (status === 'research' && exceptional === null) {
    throw new Error(`${label} publishes a research chapter without three-year impact`)
  }
  if (status === 'withheld' && exceptional !== null) {
    throw new Error(`${label} publishes a withheld chapter with three-year impact`)
  }
  if (status === 'research' && (referencePlayers === 0 || referenceLandmarks === 0)) {
    throw new Error(`${label} publishes a research chapter without historical support`)
  }

  return {
    version: oneOf(input.version, ['career-chapter-v1'], `${label}.version`),
    status,
    chapter: oneOf(
      input.chapter,
      ['launch', 'development', 'prime_plateau', 'decline', 'late_career', 'uncertain'],
      `${label}.chapter`,
    ),
    label: requiredString(input.label, `${label}.label`),
    trajectoryState: oneOf(
      input.trajectoryState,
      ['breakout', 'rising', 'maintaining', 'plateau', 'declining', 'uncertain'],
      `${label}.trajectoryState`,
    ),
    roleTrack: oneOf(
      input.roleTrack,
      ['hitter', 'starter', 'reliever'],
      `${label}.roleTrack`,
    ),
    basis: oneOf(
      input.basis,
      ['completed_seasons_only'],
      `${label}.basis`,
    ),
    featureSeason: positiveInteger(input.featureSeason, `${label}.featureSeason`),
    evidence: {
      age: requiredFiniteNumber(evidence.age, `${label}.evidence.age`),
      mlbSeasonNumber: positiveInteger(
        evidence.mlbSeasonNumber,
        `${label}.evidence.mlbSeasonNumber`,
      ),
      seasonWar: requiredFiniteNumber(evidence.seasonWar, `${label}.evidence.seasonWar`),
      recentWarPerSeason: requiredFiniteNumber(
        evidence.recentWarPerSeason,
        `${label}.evidence.recentWarPerSeason`,
      ),
      priorWarPerSeason,
      warTrend,
      historicalPacePercentile,
    },
    exceptionalTrajectory: exceptional,
    support: {
      referencePlayers,
      referenceLandmarks,
      expectedNextWarChange: requiredFiniteNumber(
        support.expectedNextWarChange,
        `${label}.support.expectedNextWarChange`,
      ),
      continuationRate: requiredProbability(
        support.continuationRate,
        `${label}.support.continuationRate`,
      ),
    },
    warnings: stringArray(input.warnings, `${label}.warnings`),
  }
}

function alphaSignal(value: unknown, label: string): AlphaSignal | null {
  if (value === null || value === undefined) return null
  const input = record(value, label)
  const status = oneOf(input.status, ['research', 'withheld'], `${label}.status`)
  const tier = oneOf(
    input.tier,
    ['priority', 'watch', 'none', 'withheld'],
    `${label}.tier`,
  )
  const eligible = requiredBoolean(input.eligible, `${label}.eligible`)
  const rawRank = finiteNumber(input.rank, `${label}.rank`)
  if (rawRank !== null && (!Number.isInteger(rawRank) || rawRank < 1)) {
    throw new Error(`${label}.rank must be a positive integer or null`)
  }
  const rankScope = input.rankScope === null || input.rankScope === undefined
    ? null
    : oneOf(
        input.rankScope,
        ['current_mlb_eligible_absolute_alpha'],
        `${label}.rankScope`,
      )
  const modeledProbability = probability(
    input.modeledProbability,
    `${label}.modeledProbability`,
  )
  const baseline = input.baseline === null || input.baseline === undefined
    ? null
    : (() => {
        const baselineInput = record(input.baseline, `${label}.baseline`)
        const seasonNumberMin = positiveInteger(
          baselineInput.seasonNumberMin,
          `${label}.baseline.seasonNumberMin`,
        )
        const seasonNumberMax = positiveInteger(
          baselineInput.seasonNumberMax,
          `${label}.baseline.seasonNumberMax`,
        )
        const ageMin = requiredFiniteNumber(baselineInput.ageMin, `${label}.baseline.ageMin`)
        const ageMax = requiredFiniteNumber(baselineInput.ageMax, `${label}.baseline.ageMax`)
        if (seasonNumberMin > seasonNumberMax || ageMin > ageMax) {
          throw new Error(`${label}.baseline range is invalid`)
        }
        if (
          baselineInput.resolvedOnly !== true ||
          baselineInput.referenceSeasonsBeforeFeature !== true ||
          baselineInput.playerEqualWeighted !== true
        ) {
          throw new Error(`${label}.baseline must preserve the registered reference policy`)
        }
        const minimumSeason = positiveInteger(
          baselineInput.minimumSeason,
          `${label}.baseline.minimumSeason`,
        )
        if (minimumSeason !== 1961) {
          throw new Error(`${label}.baseline.minimumSeason must be 1961`)
        }
        const experienceBand = requiredString(
          baselineInput.experienceBand,
          `${label}.baseline.experienceBand`,
        )
        const registeredBand = alphaExperienceBandRanges[experienceBand]
        if (
          !registeredBand ||
          seasonNumberMin !== registeredBand[0] ||
          seasonNumberMax !== registeredBand[1]
        ) {
          throw new Error(`${label}.baseline experience band is not registered`)
        }
        return {
          probability: requiredProbability(
            baselineInput.probability,
            `${label}.baseline.probability`,
          ),
          minimumSeason: 1961 as const,
          players: positiveInteger(baselineInput.players, `${label}.baseline.players`),
          landmarks: positiveInteger(baselineInput.landmarks, `${label}.baseline.landmarks`),
          roleTrack: oneOf(
            baselineInput.roleTrack,
            ['hitter', 'starter', 'reliever'],
            `${label}.baseline.roleTrack`,
          ),
          experienceBand,
          seasonNumberMin,
          seasonNumberMax,
          ageMin,
          ageMax,
          ageWindow: nonNegativeInteger(
            baselineInput.ageWindow,
            `${label}.baseline.ageWindow`,
          ),
          resolvedOnly: true as const,
          referenceSeasonsBeforeFeature: true as const,
          playerEqualWeighted: true as const,
        }
      })()
  const edge = input.edge === null || input.edge === undefined
    ? null
    : (() => {
        const edgeInput = record(input.edge, `${label}.edge`)
        const liftMultiple = edgeInput.liftMultiple === null || edgeInput.liftMultiple === undefined
          ? null
          : requiredFiniteNumber(edgeInput.liftMultiple, `${label}.edge.liftMultiple`)
        if (liftMultiple !== null && liftMultiple < 0) {
          throw new Error(`${label}.edge.liftMultiple cannot be negative`)
        }
        return {
          probabilityDelta: requiredFiniteNumber(
            edgeInput.probabilityDelta,
            `${label}.edge.probabilityDelta`,
          ),
          liftMultiple,
        }
      })()
  const ceiling = input.ceiling === null || input.ceiling === undefined
    ? null
    : (() => {
        const ceilingInput = record(input.ceiling, `${label}.ceiling`)
        return {
          p90JawsMargin: requiredFiniteNumber(
            ceilingInput.p90JawsMargin,
            `${label}.ceiling.p90JawsMargin`,
          ),
          gatePassed: requiredBoolean(
            ceilingInput.gatePassed,
            `${label}.ceiling.gatePassed`,
          ),
          target: oneOf(
            ceilingInput.target,
            ['final_jaws_minus_career_to_date_standard'],
            `${label}.ceiling.target`,
          ),
        }
      })()
  const runway = input.runway === null || input.runway === undefined
    ? null
    : (() => {
        const runwayInput = record(input.runway, `${label}.runway`)
        return {
          age: requiredFiniteNumber(runwayInput.age, `${label}.runway.age`),
          learnedTrackPrimeStartAge: requiredFiniteNumber(
            runwayInput.learnedTrackPrimeStartAge,
            `${label}.runway.learnedTrackPrimeStartAge`,
          ),
          yearsToPrime: requiredFiniteNumber(
            runwayInput.yearsToPrime,
            `${label}.runway.yearsToPrime`,
          ),
          minimumRequiredYears: requiredFiniteNumber(
            runwayInput.minimumRequiredYears,
            `${label}.runway.minimumRequiredYears`,
          ),
          gatePassed: requiredBoolean(runwayInput.gatePassed, `${label}.runway.gatePassed`),
        }
      })()
  const nearTermImpact = input.nearTermImpact === null || input.nearTermImpact === undefined
    ? null
    : (() => {
        const impactInput = record(input.nearTermImpact, `${label}.nearTermImpact`)
        const liftMultiple = impactInput.liftMultiple === null || impactInput.liftMultiple === undefined
          ? null
          : requiredFiniteNumber(
              impactInput.liftMultiple,
              `${label}.nearTermImpact.liftMultiple`,
            )
        if (liftMultiple !== null && liftMultiple < 0) {
          throw new Error(`${label}.nearTermImpact.liftMultiple cannot be negative`)
        }
        return {
          probability: requiredProbability(
            impactInput.probability,
            `${label}.nearTermImpact.probability`,
          ),
          referenceBaseRate: requiredProbability(
            impactInput.referenceBaseRate,
            `${label}.nearTermImpact.referenceBaseRate`,
          ),
          liftMultiple,
          target: oneOf(
            impactInput.target,
            ['next_three_war_ge_global_training_q90'],
            `${label}.nearTermImpact.target`,
          ),
        }
      })()
  const historicalPace = input.historicalPace === null || input.historicalPace === undefined
    ? null
    : (() => {
        const paceInput = record(input.historicalPace, `${label}.historicalPace`)
        const pacePercentile = paceInput.percentile === null || paceInput.percentile === undefined
          ? null
          : percentile(paceInput.percentile, `${label}.historicalPace.percentile`)
        const referencePlayers = paceInput.referencePlayers === null ||
            paceInput.referencePlayers === undefined
          ? null
          : positiveInteger(
              paceInput.referencePlayers,
              `${label}.historicalPace.referencePlayers`,
            )
        return {
          percentile: pacePercentile,
          referencePlayers,
          metric: oneOf(
            paceInput.metric,
            ['career_war_to_date'],
            `${label}.historicalPace.metric`,
          ),
        }
      })()
  const gatesInput = record(input.gates, `${label}.gates`)
  const gates = {
    supportedBaseline: requiredBoolean(
      gatesInput.supportedBaseline,
      `${label}.gates.supportedBaseline`,
    ),
    completedEvidence: requiredBoolean(
      gatesInput.completedEvidence,
      `${label}.gates.completedEvidence`,
    ),
    earlyCareer: requiredBoolean(gatesInput.earlyCareer, `${label}.gates.earlyCareer`),
    prePrimeRunway: requiredBoolean(
      gatesInput.prePrimeRunway,
      `${label}.gates.prePrimeRunway`,
    ),
    absoluteCeiling: requiredBoolean(
      gatesInput.absoluteCeiling,
      `${label}.gates.absoluteCeiling`,
    ),
  }

  if (status === 'research' && (!baseline || !edge || !ceiling || !runway || modeledProbability === null)) {
    throw new Error(`${label} publishes a research alpha signal without complete evidence`)
  }
  if (status === 'research' && baseline && edge && modeledProbability !== null) {
    const expectedDelta = modeledProbability - baseline.probability
    if (Math.abs(edge.probabilityDelta - expectedDelta) > 1e-6) {
      throw new Error(`${label}.edge.probabilityDelta disagrees with modeled and baseline probabilities`)
    }
    const expectedLift = baseline.probability <= 0
      ? null
      : modeledProbability / baseline.probability
    if (
      (expectedLift === null && edge.liftMultiple !== null) ||
      (expectedLift !== null && (
        edge.liftMultiple === null || Math.abs(edge.liftMultiple - expectedLift) > 0.001
      ))
    ) {
      throw new Error(`${label}.edge.liftMultiple disagrees with modeled and baseline probabilities`)
    }
  }
  if (ceiling && ceiling.gatePassed !== (ceiling.p90JawsMargin >= 0)) {
    throw new Error(`${label}.ceiling.gatePassed disagrees with the P90 JAWS margin`)
  }
  if (runway) {
    if (Math.abs(runway.minimumRequiredYears - alphaMinimumRunwayYears) > 1e-9) {
      throw new Error(`${label}.runway.minimumRequiredYears is not registered`)
    }
    if (
      Math.abs(
        runway.yearsToPrime - (runway.learnedTrackPrimeStartAge - runway.age),
      ) > 1e-6
    ) {
      throw new Error(`${label}.runway.yearsToPrime disagrees with age and learned prime`)
    }
    if (runway.gatePassed !== (runway.yearsToPrime >= runway.minimumRequiredYears)) {
      throw new Error(`${label}.runway.gatePassed disagrees with the registered runway threshold`)
    }
  }

  const expectedGates = {
    supportedBaseline: baseline !== null,
    completedEvidence: status === 'research',
    earlyCareer: baseline !== null && baseline.seasonNumberMax <= alphaMaximumEarlySeason,
    prePrimeRunway: runway?.gatePassed ?? false,
    absoluteCeiling: ceiling?.gatePassed ?? false,
  }
  for (const key of Object.keys(expectedGates) as Array<keyof typeof expectedGates>) {
    if (gates[key] !== expectedGates[key]) {
      throw new Error(`${label}.gates.${key} disagrees with the alpha evidence`)
    }
  }

  const expectedEligible = Boolean(
    status === 'research' &&
    edge !== null &&
    edge.probabilityDelta > 0 &&
    Object.values(expectedGates).every(Boolean),
  )
  if (eligible !== expectedEligible) {
    throw new Error(`${label}.eligible disagrees with the registered alpha gates`)
  }

  const expectedTier = status === 'withheld'
    ? 'withheld'
    : eligible
      ? edge!.probabilityDelta >= alphaPriorityDelta ? 'priority' : 'watch'
      : 'none'
  if (tier !== expectedTier) {
    throw new Error(`${label}.tier disagrees with the registered 10pp priority threshold`)
  }
  if (eligible ? rawRank === null || rankScope === null : rawRank !== null || rankScope !== null) {
    throw new Error(`${label} publishes a rank inconsistent with alpha eligibility`)
  }

  return {
    version: oneOf(input.version, ['alpha-signal-v1'], `${label}.version`),
    status,
    tier,
    basis: oneOf(input.basis, ['completed_seasons_only'], `${label}.basis`),
    featureSeason: positiveInteger(input.featureSeason, `${label}.featureSeason`),
    eligible,
    rank: rawRank,
    rankScope,
    modeledProbability,
    baseline,
    edge,
    ceiling,
    runway,
    nearTermImpact,
    historicalPace,
    gates,
    warnings: stringArray(input.warnings, `${label}.warnings`),
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
  const parsedAlphaSignal = alphaSignal(
    forecastInput.alphaSignal ?? input.alphaSignal,
    `${label}.alphaSignal`,
  )
  if (
    parsedAlphaSignal?.modeledProbability !== null &&
    parsedAlphaSignal?.modeledProbability !== undefined &&
    (hofCaliberProbability === null ||
      Math.abs(parsedAlphaSignal.modeledProbability - hofCaliberProbability) > 1e-8)
  ) {
    throw new Error(`${label}.alphaSignal.modeledProbability disagrees with hofCaliberProbability`)
  }

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
    finalCareerWarConditionalOnArrival: quantiles(
      forecastInput.finalCareerWarConditionalOnArrival ??
        input.finalCareerWarConditionalOnArrival,
      `${label}.finalCareerWarConditionalOnArrival`,
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
    relativeSignal: relativeSignal(
      forecastInput.relativeSignal ?? input.relativeSignal,
      `${label}.relativeSignal`,
    ),
    careerChapter: careerChapter(
      forecastInput.careerChapter ?? input.careerChapter,
      `${label}.careerChapter`,
    ),
    alphaSignal: parsedAlphaSignal,
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
