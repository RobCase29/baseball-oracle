export const PLAYER_MAP_VERSION = 'oracle-player-map/v1' as const

export type PlayerMapRoute = 'milb' | 'mlb'
export type PlayerMapState =
  | 'conviction'
  | 'discovery'
  | 'rising'
  | 'monitor'
  | 'mapped'
  | 'evidence_building'
  | 'profile_only'

export type PlayerMapScoreScale =
  | 'ordinal_percentile'
  | 'descriptive_percentile'
  | 'probability_percent'
  | 'coverage_percent'
  | 'ordinal_rank'

export interface PlayerMapScore {
  key: 'outcome' | 'readiness' | 'trajectory' | 'best_trait' | 'evidence'
  label: string
  value: number | null
  display: string
  scale: PlayerMapScoreScale
  status: 'observed' | 'research' | 'withheld'
  basis: string
  target: string | null
  rank: number | null
  universe: number | null
  asOf: string | null
}

export interface PlayerMapTrait {
  key: string
  label: string
  value: string | null
  percentile: number
  pillar: string | null
  source: string
}

export interface PlayerMapSignal {
  code:
    | 'dual_confirmed'
    | 'ceiling_readiness_split'
    | 'thin_data_upside'
    | 'trait_corroborated'
    | 'live_evidence_split'
    | 'model_alpha'
    | 'rising_trajectory'
  label: string
  detail: string
}

export interface PlayerMapOracleScore {
  value: number | null
  scale: 'stage_rank_percentile'
  route: PlayerMapRoute
  rank: number | null
  universe: number | null
  target: string | null
  asOf: string | null
  definition: 'Rounded stage-specific modeled outcome rank percentile; not a probability or composite score'
}

export interface PlayerMapProfile {
  version: typeof PLAYER_MAP_VERSION
  asOf: string | null
  route: PlayerMapRoute
  mappingStatus: 'scored' | 'insufficient_sample' | 'coverage_gap' | 'withheld' | 'not_applicable'
  claimStatus: 'research_rank_only' | 'descriptive_only' | 'withheld'
  state: PlayerMapState
  stateLabel: string
  archetype: string
  summary: string
  oracleScore: PlayerMapOracleScore
  scores: {
    outcome: PlayerMapScore
    readiness: PlayerMapScore
    trajectory: PlayerMapScore
    bestTrait: PlayerMapScore
    evidence: PlayerMapScore
  }
  strengths: PlayerMapTrait[]
  risks: PlayerMapTrait[]
  signals: PlayerMapSignal[]
  missingEvidence: string[]
  nextEvidence: string[]
  marketIndependent: true
  marketInputsIncluded: false
  comparableWithinStageOnly: true
}

interface PlayerMapInputMetric {
  key: string
  label: string
  value: string | null
  percentile: number | null
  source: string
}

interface PlayerMapInputTrait extends PlayerMapInputMetric {
  pillar?: string | null
}

export interface PlayerMapInput {
  name: string
  playerType: 'Hitter' | 'Pitcher' | 'Two-way'
  stage: 'pre_debut' | 'early_mlb' | 'established_mlb' | 'inactive'
  age: number | null
  level: string | null
  metrics: PlayerMapInputMetric[]
  provenance: {
    retrievedAt: string | null
  }
  milbImpactRanking?: {
    rank: number
    rankPercentile: number
    universeRows: number
    frozenAsOf: string
    target: { id: string }
  } | null
  milbAlphaSignal?: {
    eligible: boolean
    rank: number | null
    asOf: string | null
    ageContext: {
      youngerThanPercent: number
      referencePlayers: number
      priorLevel: string
    } | null
    gates: {
      supportedHistoricalContext: boolean
      youngForRoleAndLevel: boolean
      minimumRawWorkload: boolean
      minimumPrimaryProbability: boolean
      positivePrimaryModelEdge: boolean
      positiveLongHorizonModelEdge: boolean
    }
  } | null
  minorTraitEvidence?: {
    opportunity: {
      state: 'unavailable' | 'insufficient' | 'provisional' | 'sufficient'
      observed: {
        plateAppearances: number | null
        inningsPitched: number | null
        pitches: number | null
      }
      thresholds: Array<{
        unit: 'PA' | 'IP' | 'Pitches'
        provisional: number
        sufficient: number
      }>
    }
    coverage: {
      coveredPillarCount: number
      totalPillarCount: number
      missingPillars: string[]
    }
    corroboration: {
      passesAllDescriptiveGates: boolean
    }
    strongestMetrics: PlayerMapInputTrait[]
  } | null
  careerForecast: {
    asOf: string
    rank: number | null
    hofCaliberProbability: number | null
    confidenceScore: number | null
    confidenceState: string
    finalCareerWar?: {
      p10: number
      p25: number
      p50: number
      p75: number
      p90: number
    } | null
    decomposition?: {
      estimatedDebutAge: number | null
    } | null
    careerChapter?: {
      status: 'research' | 'withheld'
      label: string
      trajectoryState: string
      evidence: {
        historicalPacePercentile: number | null
      }
      exceptionalTrajectory: {
        probability: number
        target: string
      } | null
    } | null
    alphaSignal?: {
      status: 'research' | 'withheld'
      eligible: boolean
    } | null
  } | null
}

export interface PlayerMapBuildContext {
  mlbUniverse?: number | null
  minorUniverse?: number | null
}

const stateLabels: Record<PlayerMapState, string> = {
  conviction: 'Conviction',
  discovery: 'Discovery',
  rising: 'Rising',
  monitor: 'Monitor',
  mapped: 'Mapped',
  evidence_building: 'Evidence building',
  profile_only: 'Profile only',
}

function validPercentile(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

function ordinalPercentile(rank: number | null, universe: number | null): number | null {
  if (rank === null || universe === null || rank < 1 || universe < rank) return null
  if (universe === 1) return 100
  return 100 * (universe - rank) / (universe - 1)
}

function percentileDisplay(value: number | null): string {
  if (value === null) return 'Unavailable'
  const digits = value >= 99 ? 1 : 0
  return `P${value.toFixed(digits)}`
}

function roundedOracleValue(value: number | null): number | null {
  if (value === null) return null
  return value >= 99 ? Math.round(value * 10) / 10 : Math.round(value)
}

function rankDisplay(rank: number | null, universe: number | null): string {
  if (rank === null) return 'Not confirmed'
  return universe === null
    ? `#${rank.toLocaleString()}`
    : `#${rank.toLocaleString()} / ${universe.toLocaleString()}`
}

function score(input: PlayerMapScore): PlayerMapScore {
  return input
}

function oracleScore(
  route: PlayerMapRoute,
  value: number | null,
  rank: number | null,
  universe: number | null,
  target: string | null,
  asOf: string | null,
): PlayerMapOracleScore {
  return {
    value: roundedOracleValue(value),
    scale: 'stage_rank_percentile',
    route,
    rank,
    universe,
    target,
    asOf,
    definition: 'Rounded stage-specific modeled outcome rank percentile; not a probability or composite score',
  }
}

function uniqueTraits(traits: PlayerMapInputTrait[]): PlayerMapTrait[] {
  const seen = new Set<string>()
  return traits.flatMap((trait) => {
    if (seen.has(trait.key) || !validPercentile(trait.percentile)) return []
    seen.add(trait.key)
    return [{
      key: trait.key,
      label: trait.label,
      value: trait.value,
      percentile: trait.percentile,
      pillar: trait.pillar ?? null,
      source: trait.source,
    }]
  })
}

function opportunityObserved(
  observed: NonNullable<PlayerMapInput['minorTraitEvidence']>['opportunity']['observed'],
  unit: 'PA' | 'IP' | 'Pitches',
): number | null {
  if (unit === 'PA') return observed.plateAppearances
  if (unit === 'IP') return observed.inningsPitched
  return observed.pitches
}

function minorNextEvidence(player: PlayerMapInput): string[] {
  const traits = player.minorTraitEvidence
  if (!traits) return ['Add current performance and tracking evidence']

  const steps: string[] = []
  for (const threshold of traits.opportunity.thresholds) {
    const observed = opportunityObserved(traits.opportunity.observed, threshold.unit)
    if (observed === null || observed >= threshold.sufficient) continue
    const remaining = Math.max(0, threshold.sufficient - observed)
    steps.push(`${remaining.toFixed(threshold.unit === 'IP' ? 1 : 0)} ${threshold.unit} to the sufficient current-sample threshold`)
  }
  if (traits.coverage.missingPillars.length > 0) {
    steps.push(`Add ${traits.coverage.missingPillars.join(' and ')} evidence`)
  }
  if (!player.milbImpactRanking) steps.push('Create an exact frozen model snapshot match')
  if (steps.length === 0) steps.push('Refresh at the next completed-season model snapshot')
  return steps.slice(0, 3)
}

function minorArchetype(strengths: PlayerMapTrait[], risks: PlayerMapTrait[]): string {
  const strongest = strengths[0]
  const primaryRisk = risks[0]
  if (!strongest) return 'Partial profile'

  const strength = strongest.pillar
    ? `${strongest.pillar.replaceAll('-', ' ')}-led`
    : `${strongest.label}-led`
  if (!primaryRisk) return strength
  const risk = primaryRisk.pillar === 'swing-decisions'
    ? 'approach risk'
    : `${primaryRisk.label.toLocaleLowerCase('en-US')} risk`
  return `${strength} / ${risk}`
}

function buildMinorMap(
  player: PlayerMapInput,
  context: PlayerMapBuildContext,
): PlayerMapProfile {
  const impact = player.milbImpactRanking
  const arrival = player.milbAlphaSignal
  const career = player.careerForecast
  const traits = player.minorTraitEvidence
  const traitInputs = traits?.strongestMetrics ?? player.metrics
  const traitRows = uniqueTraits(traitInputs)
  const strengths = traitRows.filter((trait) => trait.percentile >= 80)
    .toSorted((left, right) => right.percentile - left.percentile)
    .slice(0, 3)
  const risks = traitRows.filter((trait) => trait.percentile <= 20)
    .toSorted((left, right) => left.percentile - right.percentile)
    .slice(0, 3)
  const coveredPillars = traits?.coverage.coveredPillarCount ?? 0
  const totalPillars = traits?.coverage.totalPillarCount ?? 0
  const evidenceValue = totalPillars > 0 ? 100 * coveredPillars / totalPillars : null
  const impactWorkloadSupported = arrival?.gates?.minimumRawWorkload !== false
  const rawImpactValue = validPercentile(impact?.rankPercentile) ? impact.rankPercentile : null
  const impactValue = impactWorkloadSupported ? rawImpactValue : null
  const careerRank = career?.rank ?? null
  const careerUniverse = context.minorUniverse ?? impact?.universeRows ?? null
  const careerValue = ordinalPercentile(careerRank, careerUniverse)
  const estimatedDebutAge = career?.decomposition?.estimatedDebutAge ?? null
  const ageValue = validPercentile(arrival?.ageContext?.youngerThanPercent)
    ? arrival.ageContext.youngerThanPercent
    : null
  const bestTrait = strengths[0] ?? traitRows.toSorted((left, right) => right.percentile - left.percentile)[0] ?? null
  const evidenceState = traits?.opportunity.state ?? 'unavailable'
  const dualConfirmed = arrival?.eligible === true && (careerValue ?? -1) >= 90
  const traitConfirmed = traits?.corroboration.passesAllDescriptiveGates === true

  const state: PlayerMapState = dualConfirmed && traitConfirmed
    ? 'conviction'
    : (careerValue ?? -1) >= 90
      ? 'discovery'
      : (careerValue ?? -1) >= 75 || traitConfirmed
        ? 'monitor'
        : careerValue !== null
          ? 'mapped'
          : traitRows.length > 0
            ? 'evidence_building'
            : 'profile_only'

  const signals: PlayerMapSignal[] = []
  if (dualConfirmed) {
    signals.push({
      code: 'dual_confirmed',
      label: 'Dual-confirmed upside',
      detail: 'The runway-adjusted career rank and separate MLB arrival gate both cleared.',
    })
  }
  if ((careerValue ?? -1) >= 90 && arrival?.eligible !== true) {
    signals.push({
      code: 'ceiling_readiness_split',
      label: 'Ceiling / readiness split',
      detail: 'The career ceiling route is top decile, while the separate arrival confirmation did not clear.',
    })
  }
  if ((careerValue ?? -1) >= 90 && evidenceState !== 'sufficient') {
    signals.push({
      code: 'thin_data_upside',
      label: 'Thin-data upside',
      detail: `The career rank is high while current evidence remains ${evidenceState}.`,
    })
  }
  if (traitConfirmed) {
    signals.push({
      code: 'trait_corroborated',
      label: 'Trait corroborated',
      detail: 'Current opportunity, pillar coverage, and multi-pillar strength gates cleared.',
    })
  }
  if (strengths.length > 0 && risks.length > 0) {
    signals.push({
      code: 'live_evidence_split',
      label: 'Split live evidence',
      detail: 'The current profile contains at least one strong trait and one material risk.',
    })
  }

  const outlookText = careerValue === null
    ? 'does not yet have a matched runway-adjusted career rank'
    : `ranks ${rankDisplay(careerRank, careerUniverse)} on the runway-adjusted career ceiling route`
  const runwayText = estimatedDebutAge === null
    ? ''
    : ` Projected MLB arrival age is ${estimatedDebutAge}, which shapes the remaining career runway.`
  const strengthText = strengths[0]
    ? ` Best observed strength: ${strengths[0].label} ${percentileDisplay(strengths[0].percentile)}.`
    : ''
  const riskText = risks[0]
    ? ` Primary current risk: ${risks[0].label} ${percentileDisplay(risks[0].percentile)}.`
    : ''

  return {
    version: PLAYER_MAP_VERSION,
    asOf: career?.asOf ?? impact?.frozenAsOf ?? arrival?.asOf ?? player.provenance.retrievedAt,
    route: 'milb',
    mappingStatus: careerRank !== null && careerValue !== null
      ? 'scored'
      : evidenceState === 'insufficient' || evidenceState === 'provisional'
        ? 'insufficient_sample'
        : 'coverage_gap',
    claimStatus: careerRank !== null ? 'research_rank_only' : traitRows.length > 0 ? 'descriptive_only' : 'withheld',
    state,
    stateLabel: stateLabels[state],
    archetype: minorArchetype(strengths, risks),
    summary: `${player.name} ${outlookText}.${runwayText} Current data coverage is ${evidenceState}.${strengthText}${riskText}`,
    oracleScore: oracleScore(
      'milb',
      careerValue,
      careerRank,
      careerUniverse,
      'mlb-debut-age-mixed-final-standard-bridge-v1',
      career?.asOf ?? null,
    ),
    scores: {
      outcome: score({
        key: 'outcome',
        label: 'Five-year MLB impact',
        value: impactValue,
        display: !impact
          ? 'Unmapped'
          : !impactWorkloadSupported
            ? 'Needs more data'
            : impactValue === null ? 'Unmapped' : percentileDisplay(impactValue),
        scale: 'ordinal_percentile',
        status: impact && impactWorkloadSupported ? 'research' : 'withheld',
        basis: impact && !impactWorkloadSupported
          ? 'The completed-season model input did not clear its minimum workload gate'
          : 'Separate frozen five-calendar-year MLB impact rank',
        target: impact?.target?.id ?? null,
        rank: impactWorkloadSupported ? impact?.rank ?? null : null,
        universe: impact?.universeRows ?? null,
        asOf: impact?.frozenAsOf ?? null,
      }),
      readiness: score({
        key: 'readiness',
        label: 'Arrival confirmation',
        value: null,
        display: rankDisplay(arrival?.rank ?? null, null),
        scale: 'ordinal_rank',
        status: arrival ? 'research' : 'withheld',
        basis: arrival?.eligible ? 'Frozen arrival anomaly rank' : 'Frozen arrival gate diagnostics',
        target: 'first_mlb_arrival_within_36_months',
        rank: arrival?.rank ?? null,
        universe: null,
        asOf: arrival?.asOf ?? null,
      }),
      trajectory: score({
        key: 'trajectory',
        label: 'Projected MLB arrival age',
        value: ageValue,
        display: estimatedDebutAge === null
          ? ageValue === null ? `Age ${player.age ?? '-'} / ${player.level ?? '-'}` : percentileDisplay(ageValue)
          : `Age ${estimatedDebutAge}`,
        scale: 'descriptive_percentile',
        status: estimatedDebutAge === null && ageValue === null ? 'withheld' : 'research',
        basis: estimatedDebutAge === null
          ? arrival?.ageContext
            ? `Younger-than percentile among historical ${arrival.ageContext.priorLevel} role peers`
            : 'Historical role-level age context unavailable'
          : `Projected debut age ${estimatedDebutAge}; later arrival leaves less time to build career value`,
        target: 'estimated_mlb_debut_age',
        rank: null,
        universe: arrival?.ageContext?.referencePlayers ?? null,
        asOf: arrival?.asOf ?? null,
      }),
      bestTrait: score({
        key: 'best_trait',
        label: 'Best current trait',
        value: bestTrait?.percentile ?? null,
        display: bestTrait ? percentileDisplay(bestTrait.percentile) : 'Unavailable',
        scale: 'descriptive_percentile',
        status: bestTrait ? 'observed' : 'withheld',
        basis: bestTrait ? `${bestTrait.label} (${bestTrait.value ?? 'value unavailable'})` : 'No supported current trait percentile',
        target: null,
        rank: null,
        universe: null,
        asOf: player.provenance.retrievedAt,
      }),
      evidence: score({
        key: 'evidence',
        label: 'Evidence depth',
        value: evidenceValue,
        display: totalPillars > 0 ? `${coveredPillars} / ${totalPillars} pillars` : 'Identity only',
        scale: 'coverage_percent',
        status: traits ? 'observed' : 'withheld',
        basis: `${evidenceState} opportunity; evidence changes trust, not outcome rank`,
        target: null,
        rank: null,
        universe: totalPillars || null,
        asOf: player.provenance.retrievedAt,
      }),
    },
    strengths,
    risks,
    signals,
    missingEvidence: [
      ...(traits?.coverage.missingPillars ?? []),
      ...(careerRank === null ? ['Runway-adjusted career estimate'] : []),
      ...(!impact ? ['Frozen five-year impact rank'] : []),
      ...(impact && !impactWorkloadSupported ? ['Stable completed-season impact sample'] : []),
      ...(!arrival?.ageContext ? ['Historical role-level age context'] : []),
    ],
    nextEvidence: minorNextEvidence(player),
    marketIndependent: true,
    marketInputsIncluded: false,
    comparableWithinStageOnly: true,
  }
}

function buildMlbMap(player: PlayerMapInput, context: PlayerMapBuildContext): PlayerMapProfile {
  const forecast = player.careerForecast
  const chapter = forecast?.careerChapter?.status === 'research' ? forecast.careerChapter : null
  const currentTraits = uniqueTraits(player.metrics)
  const currentStrengths = currentTraits
    .filter((trait) => trait.percentile >= 80)
    .toSorted((left, right) => right.percentile - left.percentile)
    .slice(0, 3)
  const currentRisks = currentTraits
    .filter((trait) => trait.percentile <= 20)
    .toSorted((left, right) => left.percentile - right.percentile)
    .slice(0, 3)
  const bestCurrentTrait = currentTraits
    .toSorted((left, right) => right.percentile - left.percentile)[0] ?? null
  const rank = forecast?.rank ?? null
  const universe = context.mlbUniverse ?? null
  const outlookValue = ordinalPercentile(rank, universe)
  const readinessValue = chapter?.exceptionalTrajectory?.probability === undefined || chapter.exceptionalTrajectory === null
    ? null
    : chapter.exceptionalTrajectory.probability * 100
  const paceValue = validPercentile(chapter?.evidence.historicalPacePercentile)
    ? chapter.evidence.historicalPacePercentile
    : null
  const evidenceValue = forecast?.confidenceScore === null || forecast?.confidenceScore === undefined
    ? null
    : forecast.confidenceScore * 100
  const alphaEligible = forecast?.alphaSignal?.status === 'research' && forecast.alphaSignal.eligible
  const rising = chapter?.trajectoryState === 'breakout' || chapter?.trajectoryState === 'rising'
  const state: PlayerMapState = alphaEligible
    ? 'conviction'
    : rising && paceValue !== null && paceValue >= 75
      ? 'rising'
      : rank !== null
        ? 'mapped'
        : chapter
          ? 'monitor'
          : 'profile_only'
  const signals: PlayerMapSignal[] = []
  if (alphaEligible) {
    signals.push({
      code: 'model_alpha',
      label: 'Model alpha eligible',
      detail: 'The early-career, runway, baseline-support, positive-edge, and absolute-ceiling gates cleared.',
    })
  }
  if (rising) {
    signals.push({
      code: 'rising_trajectory',
      label: 'Rising trajectory',
      detail: `The completed-season career chapter is ${chapter?.trajectoryState ?? 'rising'}.`,
    })
  }
  if (bestCurrentTrait && bestCurrentTrait.percentile >= 80) {
    signals.push({
      code: 'trait_corroborated',
      label: 'Current performance corroboration',
      detail: `${bestCurrentTrait.label} is in the top 20% of the current role group.`,
    })
  }

  const outlookText = rank === null
    ? 'does not have a supported terminal-outcome rank'
    : `ranks ${rankDisplay(rank, universe)} on the current MLB terminal-outcome route`
  const paceText = paceValue === null ? '' : ` Historical WAR pace is ${percentileDisplay(paceValue)}.`
  const currentText = bestCurrentTrait === null
    ? ''
    : ` Current ${bestCurrentTrait.label.toLocaleLowerCase('en-US')} is ${percentileDisplay(bestCurrentTrait.percentile)}.`

  return {
    version: PLAYER_MAP_VERSION,
    asOf: forecast?.asOf ?? player.provenance.retrievedAt,
    route: 'mlb',
    mappingStatus: rank !== null ? 'scored' : forecast ? 'withheld' : 'coverage_gap',
    claimStatus: rank !== null ? 'research_rank_only' : 'withheld',
    state,
    stateLabel: stateLabels[state],
    archetype: chapter ? `${chapter.label} / ${chapter.trajectoryState}` : 'MLB profile',
    summary: `${player.name} ${outlookText}.${paceText}${currentText} Evidence confidence remains ${forecast?.confidenceState ?? 'withheld'}.`,
    oracleScore: oracleScore(
      'mlb',
      outlookValue,
      rank,
      universe,
      'hof-caliber-point-in-time-jaws-v1',
      forecast?.asOf ?? null,
    ),
    scores: {
      outcome: score({
        key: 'outcome',
        label: 'MLB terminal outlook',
        value: outlookValue,
        display: rankDisplay(rank, universe),
        scale: 'ordinal_percentile',
        status: rank === null ? 'withheld' : 'research',
        basis: 'Current MLB Hall-caliber research rank',
        target: 'hof-caliber-point-in-time-jaws-v1',
        rank,
        universe,
        asOf: forecast?.asOf ?? null,
      }),
      readiness: score({
        key: 'readiness',
        label: 'Three-year impact',
        value: readinessValue,
        display: readinessValue === null ? 'Withheld' : `${readinessValue.toFixed(1)}%`,
        scale: 'probability_percent',
        status: readinessValue === null ? 'withheld' : 'research',
        basis: 'Next three completed MLB seasons above the frozen WAR threshold',
        target: chapter?.exceptionalTrajectory?.target ?? null,
        rank: null,
        universe: null,
        asOf: forecast?.asOf ?? null,
      }),
      trajectory: score({
        key: 'trajectory',
        label: 'Historical WAR pace',
        value: paceValue,
        display: percentileDisplay(paceValue),
        scale: 'descriptive_percentile',
        status: paceValue === null ? 'withheld' : 'research',
        basis: chapter ? `${chapter.label}; completed-season historical pace` : 'Completed-season chapter unavailable',
        target: null,
        rank: null,
        universe: null,
        asOf: forecast?.asOf ?? null,
      }),
      bestTrait: score({
        key: 'best_trait',
        label: 'Current-season performance',
        value: bestCurrentTrait?.percentile ?? null,
        display: bestCurrentTrait ? percentileDisplay(bestCurrentTrait.percentile) : 'Not available',
        scale: 'descriptive_percentile',
        status: bestCurrentTrait ? 'observed' : 'withheld',
        basis: bestCurrentTrait
          ? `${bestCurrentTrait.label} (${bestCurrentTrait.value ?? 'value unavailable'})`
          : 'Current role-relative performance is not available',
        target: null,
        rank: null,
        universe: null,
        asOf: player.provenance.retrievedAt,
      }),
      evidence: score({
        key: 'evidence',
        label: 'Model evidence',
        value: evidenceValue,
        display: evidenceValue === null ? 'Withheld' : `${evidenceValue.toFixed(0)} / 100`,
        scale: 'coverage_percent',
        status: evidenceValue === null ? 'withheld' : 'research',
        basis: 'Heuristic evidence and uncertainty index; not outcome probability',
        target: null,
        rank: null,
        universe: null,
        asOf: forecast?.asOf ?? null,
      }),
    },
    strengths: currentStrengths,
    risks: currentRisks,
    signals,
    missingEvidence: [
      ...(!forecast ? ['Supported terminal forecast'] : []),
      ...(!bestCurrentTrait ? ['Current MLB performance'] : []),
    ],
    nextEvidence: [
      'Next completed-season Career Oracle snapshot',
      ...(!bestCurrentTrait ? ['Current MLB performance and tracking ingestion'] : []),
    ],
    marketIndependent: true,
    marketInputsIncluded: false,
    comparableWithinStageOnly: true,
  }
}

export function buildPlayerMap(
  player: PlayerMapInput,
  context: PlayerMapBuildContext = {},
): PlayerMapProfile {
  return player.stage === 'pre_debut'
    ? buildMinorMap(player, context)
    : buildMlbMap(player, context)
}
