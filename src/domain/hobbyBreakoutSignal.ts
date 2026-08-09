import type {
  MagnificentXDomain,
  MagnificentXSourceRow,
} from './magnificentX.js'

export const HOBBY_BREAKOUT_MODEL_VERSION =
  'hobby-breakout-radar/domain-relative-demand-v1.0.0' as const
export const HOBBY_BREAKOUT_DISPLAY_LIMIT = 25 as const
export const HOBBY_BREAKOUT_SCORE_FLOOR = 50 as const
export const HOBBY_BREAKOUT_PRIOR_SIX_MONTH_FLOOR_USD = 50_000 as const
export const HOBBY_BREAKOUT_PRIOR_THREE_MONTH_FLOOR_USD = 25_000 as const
export const HOBBY_BREAKOUT_MIN_RUN_RATE_USD = 500_000 as const
export const HOBBY_BREAKOUT_MAX_RUN_RATE_USD = 15_000_000 as const
export const HOBBY_BREAKOUT_MAX_TTM_USD = 12_000_000 as const

export type HobbyBreakoutEvidence =
  | 'confirmed'
  | 'volume_confirmed_cold_start'
  | 'withheld'

export type HobbyBreakoutTier =
  | 'breakout'
  | 'strong'
  | 'emerging'
  | 'below_surface'

export type HobbyBreakoutDemandScale = 'small' | 'mid' | 'outside'

export interface HobbyBreakoutDomainBaseline {
  sixMonthMultiple: number
  recentThreeMonthMultiple: number
  sixMonthSampleSize: number
  recentThreeMonthSampleSize: number
}

export interface HobbyBreakoutSignalInput {
  monthlySalesUsd: readonly number[]
  latestTwelveMonthSalesUsd: number
  annualizedCurrentSixMonthSalesUsd: number
  persistence: number
  shockResistance: number
  comparisonEligible: boolean
  sourceCurrent: boolean
  completeEighteenMonthHistory: boolean
  buildEligible: boolean
  baselineSixMonthMultiple: number
  baselineRecentThreeMonthMultiple: number
}

export interface HobbyBreakoutChecks {
  comparisonEligible: boolean
  sourceCurrent: boolean
  completeEighteenMonthHistory: boolean
  notAlreadyBuild: boolean
  domainBaselineAvailable: boolean
  currentRunRateInBand: boolean
  trailingTwelveMonthBelowCeiling: boolean
  sixMonthDollarLiftAtLeast250k: boolean
  adjustedSixMonthMultipleAtLeast2: boolean
  relativeSixMonthMultipleAtLeast2: boolean
  adjustedRecentThreeMonthMultipleAtLeast1_5: boolean
  relativeRecentThreeMonthMultipleAtLeast1_5: boolean
  recentThreeMonthsNotDeclining: boolean
  atLeastFiveMonthsConfirm: boolean
  currentSixMonthEffectiveMonthsAtLeast4: boolean
  latestTwelveMonthEffectiveMonthsAtLeast6: boolean
  currentThreeMonthEffectiveMonthsAtLeast2_3: boolean
  currentSixMonthPeakShareAtMost40Pct: boolean
  currentThreeMonthShareAtMost85Pct: boolean
  coldStartAbsoluteDemandConfirmed: boolean
}

export type HobbyBreakoutReasonCode =
  | 'comparison_not_eligible'
  | 'market_snapshot_not_current'
  | 'complete_history_missing'
  | 'already_on_build_board'
  | 'domain_baseline_unavailable'
  | 'current_run_rate_outside_small_mid_band'
  | 'ttm_demand_at_or_above_12m'
  | 'six_month_dollar_lift_below_250k'
  | 'adjusted_six_month_growth_below_2x'
  | 'six_month_growth_below_2x_domain_pace'
  | 'adjusted_recent_three_month_growth_below_1_5x'
  | 'recent_three_month_growth_below_1_5x_domain_pace'
  | 'recent_three_month_window_declining'
  | 'fewer_than_five_months_confirm'
  | 'current_six_month_demand_too_concentrated'
  | 'ttm_demand_too_concentrated'
  | 'current_three_month_demand_too_concentrated'
  | 'single_month_exceeds_40pct_of_current_six_months'
  | 'current_three_months_exceed_85pct_of_current_six_months'
  | 'cold_start_absolute_demand_not_confirmed'
  | 'breakout_score_below_50'

export interface HobbyBreakoutSignal {
  modelVersion: typeof HOBBY_BREAKOUT_MODEL_VERSION
  eligible: boolean
  surfaced: boolean
  rank: number | null
  score: number
  tier: HobbyBreakoutTier
  evidence: HobbyBreakoutEvidence
  demandScale: HobbyBreakoutDemandScale
  currentSixMonthSalesUsd: number
  priorYearSixMonthSalesUsd: number
  currentThreeMonthSalesUsd: number
  precedingThreeMonthSalesUsd: number
  sixMonthDemandAddedUsd: number
  recentThreeMonthDemandAddedUsd: number
  confirmingMonths: number
  currentSixMonthEffectiveMonths: number
  currentThreeMonthEffectiveMonths: number
  latestTwelveMonthEffectiveMonths: number
  currentSixMonthPeakShare: number
  currentThreeMonthShareOfCurrentSix: number
  adjustedSixMonthMultiple: number
  relativeSixMonthMultiple: number
  adjustedRecentThreeMonthMultiple: number
  relativeRecentThreeMonthMultiple: number
  sequentialThreeMonthMultiple: number
  latestMonthCooling: boolean
  components: {
    currentDemandVelocity: number
    absoluteDemandExpansion: number
    relativeSixMonthExpansion: number
    relativeRecentThreeMonthExpansion: number
    sequentialAcceleration: number
    breadth: number
    dispersion: number
  }
  checks: HobbyBreakoutChecks
  reasonCodes: HobbyBreakoutReasonCode[]
  warningCodes: Array<'latest_month_cooling'>
  interpretation:
    'subject_level_completed_sales_demand_not_binder_score_card_price_or_investment_advice'
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function effectiveMonths(values: readonly number[]): number {
  const total = sum(values)
  if (total <= 0) return 0
  const sumSquares = values.reduce(
    (accumulator, value) => accumulator + value ** 2,
    0,
  )
  return sumSquares <= 0 ? 0 : total ** 2 / sumSquares
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = values.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

function geometricMedian(multiples: readonly number[]): number | null {
  const logs = multiples
    .filter((value) => Number.isFinite(value) && value > 0)
    .map(Math.log)
  const middle = median(logs)
  return middle === null ? null : Math.exp(middle)
}

function multiple(current: number, prior: number): number {
  return (current + 1) / (prior + 1)
}

function adjustedMultiple(
  current: number,
  prior: number,
  priorFloor: number,
): number {
  return multiple(current, Math.max(prior, priorFloor))
}

function logScale(value: number, low: number, high: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return 100 * clamp(
    Math.log(value / low) / Math.log(high / low),
    0,
    1,
  )
}

export function buildHobbyBreakoutDomainBaseline(
  rows: readonly Pick<
    MagnificentXSourceRow,
    'domain' | 'taxonomyStatus' | 'monthlySalesUsd'
  >[],
): Map<MagnificentXDomain, HobbyBreakoutDomainBaseline> {
  const values = new Map<MagnificentXDomain, {
    sixMonth: number[]
    recentThreeMonth: number[]
  }>()
  const domains = new Set<MagnificentXDomain>()

  for (const row of rows) {
    domains.add(row.domain)
    if (
      row.taxonomyStatus !== 'coherent_provider_cohort' ||
      row.monthlySalesUsd.length !== 18
    ) {
      continue
    }
    const currentSix = sum(row.monthlySalesUsd.slice(-6))
    const priorSix = sum(row.monthlySalesUsd.slice(0, 6))
    const currentThree = sum(row.monthlySalesUsd.slice(-3))
    const priorYearThree = sum(row.monthlySalesUsd.slice(3, 6))
    const domainValues = values.get(row.domain) ?? {
      sixMonth: [],
      recentThreeMonth: [],
    }
    if (
      currentSix >= HOBBY_BREAKOUT_PRIOR_SIX_MONTH_FLOOR_USD &&
      priorSix >= HOBBY_BREAKOUT_PRIOR_SIX_MONTH_FLOOR_USD
    ) {
      domainValues.sixMonth.push(multiple(currentSix, priorSix))
    }
    if (
      currentThree >= HOBBY_BREAKOUT_PRIOR_THREE_MONTH_FLOOR_USD &&
      priorYearThree >= HOBBY_BREAKOUT_PRIOR_THREE_MONTH_FLOOR_USD
    ) {
      domainValues.recentThreeMonth.push(
        multiple(currentThree, priorYearThree),
      )
    }
    values.set(row.domain, domainValues)
  }

  return new Map([...domains].map((domain) => {
    const domainValues = values.get(domain) ?? {
      sixMonth: [],
      recentThreeMonth: [],
    }
    return [
      domain,
      {
        sixMonthMultiple:
          geometricMedian(domainValues.sixMonth) ?? 1,
        recentThreeMonthMultiple:
          geometricMedian(domainValues.recentThreeMonth) ?? 1,
        sixMonthSampleSize: domainValues.sixMonth.length,
        recentThreeMonthSampleSize: domainValues.recentThreeMonth.length,
      },
    ]
  }))
}

function demandScale(
  latestTwelveMonthSalesUsd: number,
): HobbyBreakoutDemandScale {
  if (latestTwelveMonthSalesUsd < 3_000_000) return 'small'
  if (latestTwelveMonthSalesUsd < HOBBY_BREAKOUT_MAX_TTM_USD) return 'mid'
  return 'outside'
}

function tierFor(score: number, surfaced: boolean): HobbyBreakoutTier {
  if (!surfaced) return 'below_surface'
  if (score >= 75) return 'breakout'
  if (score >= 65) return 'strong'
  return 'emerging'
}

export function buildHobbyBreakoutSignal(
  input: HobbyBreakoutSignalInput,
): HobbyBreakoutSignal {
  const months = input.monthlySalesUsd
  if (
    months.length !== 18 ||
    months.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error(
      'Breakout Radar requires 18 complete non-negative sales months',
    )
  }

  const currentSixMonths = months.slice(-6)
  const latestTwelveMonths = months.slice(-12)
  const currentThreeMonths = months.slice(-3)
  const precedingThreeMonths = months.slice(-6, -3)
  const currentSixMonthSalesUsd = sum(currentSixMonths)
  const priorYearSixMonthSalesUsd = sum(months.slice(0, 6))
  const currentThreeMonthSalesUsd = sum(currentThreeMonths)
  const precedingThreeMonthSalesUsd = sum(precedingThreeMonths)
  const priorYearThreeMonthSalesUsd = sum(months.slice(3, 6))
  const sixMonthDemandAddedUsd =
    currentSixMonthSalesUsd - priorYearSixMonthSalesUsd
  const recentThreeMonthDemandAddedUsd =
    currentThreeMonthSalesUsd - precedingThreeMonthSalesUsd
  const adjustedSixMonthMultiple = adjustedMultiple(
    currentSixMonthSalesUsd,
    priorYearSixMonthSalesUsd,
    HOBBY_BREAKOUT_PRIOR_SIX_MONTH_FLOOR_USD,
  )
  const adjustedRecentThreeMonthMultiple = adjustedMultiple(
    currentThreeMonthSalesUsd,
    priorYearThreeMonthSalesUsd,
    HOBBY_BREAKOUT_PRIOR_THREE_MONTH_FLOOR_USD,
  )
  const baselineAvailable =
    Number.isFinite(input.baselineSixMonthMultiple) &&
    input.baselineSixMonthMultiple > 0 &&
    Number.isFinite(input.baselineRecentThreeMonthMultiple) &&
    input.baselineRecentThreeMonthMultiple > 0
  const relativeSixMonthMultiple = baselineAvailable
    ? adjustedSixMonthMultiple / input.baselineSixMonthMultiple
    : 0
  const relativeRecentThreeMonthMultiple = baselineAvailable
    ? adjustedRecentThreeMonthMultiple /
      input.baselineRecentThreeMonthMultiple
    : 0
  const sequentialThreeMonthMultiple = multiple(
    currentThreeMonthSalesUsd,
    precedingThreeMonthSalesUsd,
  )
  const confirmingMonths = currentSixMonths.filter(
    (value, index) => value > months[index]!,
  ).length
  const currentSixMonthEffectiveMonths = effectiveMonths(currentSixMonths)
  const currentThreeMonthEffectiveMonths =
    effectiveMonths(currentThreeMonths)
  const latestTwelveMonthEffectiveMonths =
    effectiveMonths(latestTwelveMonths)
  const currentSixMonthPeakShare = currentSixMonthSalesUsd <= 0
    ? 1
    : Math.max(...currentSixMonths) / currentSixMonthSalesUsd
  const currentThreeMonthShareOfCurrentSix =
    currentSixMonthSalesUsd <= 0
      ? 1
      : currentThreeMonthSalesUsd / currentSixMonthSalesUsd
  const coldStart =
    priorYearSixMonthSalesUsd <
      HOBBY_BREAKOUT_PRIOR_SIX_MONTH_FLOOR_USD ||
    priorYearThreeMonthSalesUsd <
      HOBBY_BREAKOUT_PRIOR_THREE_MONTH_FLOOR_USD
  const coldStartAbsoluteDemandConfirmed =
    !coldStart ||
    (
      currentSixMonthSalesUsd >= 500_000 &&
      currentThreeMonthSalesUsd >= 250_000 &&
      sixMonthDemandAddedUsd >= 500_000
    )
  const latestMonth = months.at(-1)!
  const precedingMonth = months.at(-2)!
  const latestMonthCooling =
    precedingMonth > 0 && latestMonth / precedingMonth < 0.75

  const checks: HobbyBreakoutChecks = {
    comparisonEligible: input.comparisonEligible,
    sourceCurrent: input.sourceCurrent,
    completeEighteenMonthHistory: input.completeEighteenMonthHistory,
    notAlreadyBuild: !input.buildEligible,
    domainBaselineAvailable: baselineAvailable,
    currentRunRateInBand:
      input.annualizedCurrentSixMonthSalesUsd >=
        HOBBY_BREAKOUT_MIN_RUN_RATE_USD &&
      input.annualizedCurrentSixMonthSalesUsd <
        HOBBY_BREAKOUT_MAX_RUN_RATE_USD,
    trailingTwelveMonthBelowCeiling:
      input.latestTwelveMonthSalesUsd < HOBBY_BREAKOUT_MAX_TTM_USD,
    sixMonthDollarLiftAtLeast250k: sixMonthDemandAddedUsd >= 250_000,
    adjustedSixMonthMultipleAtLeast2: adjustedSixMonthMultiple >= 2,
    relativeSixMonthMultipleAtLeast2: relativeSixMonthMultiple >= 2,
    adjustedRecentThreeMonthMultipleAtLeast1_5:
      adjustedRecentThreeMonthMultiple >= 1.5,
    relativeRecentThreeMonthMultipleAtLeast1_5:
      relativeRecentThreeMonthMultiple >= 1.5,
    recentThreeMonthsNotDeclining: sequentialThreeMonthMultiple >= 1,
    atLeastFiveMonthsConfirm: confirmingMonths >= 5,
    currentSixMonthEffectiveMonthsAtLeast4:
      currentSixMonthEffectiveMonths >= 4,
    latestTwelveMonthEffectiveMonthsAtLeast6:
      latestTwelveMonthEffectiveMonths >= 6,
    currentThreeMonthEffectiveMonthsAtLeast2_3:
      currentThreeMonthEffectiveMonths >= 2.3,
    currentSixMonthPeakShareAtMost40Pct:
      currentSixMonthPeakShare <= 0.4,
    currentThreeMonthShareAtMost85Pct:
      currentThreeMonthShareOfCurrentSix <= 0.85,
    coldStartAbsoluteDemandConfirmed,
  }
  const reasonLabels: Array<
    [keyof HobbyBreakoutChecks, HobbyBreakoutReasonCode]
  > = [
    ['comparisonEligible', 'comparison_not_eligible'],
    ['sourceCurrent', 'market_snapshot_not_current'],
    ['completeEighteenMonthHistory', 'complete_history_missing'],
    ['notAlreadyBuild', 'already_on_build_board'],
    ['domainBaselineAvailable', 'domain_baseline_unavailable'],
    [
      'currentRunRateInBand',
      'current_run_rate_outside_small_mid_band',
    ],
    ['trailingTwelveMonthBelowCeiling', 'ttm_demand_at_or_above_12m'],
    [
      'sixMonthDollarLiftAtLeast250k',
      'six_month_dollar_lift_below_250k',
    ],
    [
      'adjustedSixMonthMultipleAtLeast2',
      'adjusted_six_month_growth_below_2x',
    ],
    [
      'relativeSixMonthMultipleAtLeast2',
      'six_month_growth_below_2x_domain_pace',
    ],
    [
      'adjustedRecentThreeMonthMultipleAtLeast1_5',
      'adjusted_recent_three_month_growth_below_1_5x',
    ],
    [
      'relativeRecentThreeMonthMultipleAtLeast1_5',
      'recent_three_month_growth_below_1_5x_domain_pace',
    ],
    [
      'recentThreeMonthsNotDeclining',
      'recent_three_month_window_declining',
    ],
    ['atLeastFiveMonthsConfirm', 'fewer_than_five_months_confirm'],
    [
      'currentSixMonthEffectiveMonthsAtLeast4',
      'current_six_month_demand_too_concentrated',
    ],
    [
      'latestTwelveMonthEffectiveMonthsAtLeast6',
      'ttm_demand_too_concentrated',
    ],
    [
      'currentThreeMonthEffectiveMonthsAtLeast2_3',
      'current_three_month_demand_too_concentrated',
    ],
    [
      'currentSixMonthPeakShareAtMost40Pct',
      'single_month_exceeds_40pct_of_current_six_months',
    ],
    [
      'currentThreeMonthShareAtMost85Pct',
      'current_three_months_exceed_85pct_of_current_six_months',
    ],
    [
      'coldStartAbsoluteDemandConfirmed',
      'cold_start_absolute_demand_not_confirmed',
    ],
  ]
  const eligibilityReasonCodes = reasonLabels.flatMap(([check, reason]) => (
    checks[check] ? [] : [reason]
  ))
  const eligible = eligibilityReasonCodes.length === 0

  const components = {
    currentDemandVelocity: round(logScale(
      input.annualizedCurrentSixMonthSalesUsd,
      HOBBY_BREAKOUT_MIN_RUN_RATE_USD,
      HOBBY_BREAKOUT_MAX_RUN_RATE_USD,
    )),
    absoluteDemandExpansion: round(logScale(
      Math.max(1, sixMonthDemandAddedUsd),
      250_000,
      10_000_000,
    )),
    relativeSixMonthExpansion: round(logScale(
      relativeSixMonthMultiple,
      2,
      8,
    )),
    relativeRecentThreeMonthExpansion: round(logScale(
      relativeRecentThreeMonthMultiple,
      1.5,
      8,
    )),
    sequentialAcceleration: round(logScale(
      sequentialThreeMonthMultiple,
      1,
      4,
    )),
    breadth: round(100 * (
      0.5 * clamp((confirmingMonths - 4) / 2, 0, 1) +
      0.5 * clamp((currentSixMonthEffectiveMonths - 4) / 2, 0, 1)
    )),
    dispersion: round(100 * (
      0.5 * clamp(
        (currentThreeMonthEffectiveMonths - 2.3) / 0.7,
        0,
        1,
      ) +
      0.5 * clamp(
        (0.4 - currentSixMonthPeakShare) / 0.067,
        0,
        1,
      )
    )),
  }
  const rawScore = round(
    0.2 * components.currentDemandVelocity +
    0.15 * components.absoluteDemandExpansion +
    0.25 * components.relativeSixMonthExpansion +
    0.15 * components.relativeRecentThreeMonthExpansion +
    0.1 * components.sequentialAcceleration +
    0.1 * components.breadth +
    0.05 * components.dispersion,
  )
  const score = eligible ? rawScore : 0
  const surfaced = eligible && score >= HOBBY_BREAKOUT_SCORE_FLOOR
  const reasonCodes: HobbyBreakoutReasonCode[] = [
    ...eligibilityReasonCodes,
    ...(eligible && !surfaced ? ['breakout_score_below_50'] as const : []),
  ]

  return {
    modelVersion: HOBBY_BREAKOUT_MODEL_VERSION,
    eligible,
    surfaced,
    rank: null,
    score,
    tier: tierFor(score, surfaced),
    evidence: eligible
      ? coldStart
        ? 'volume_confirmed_cold_start'
        : 'confirmed'
      : 'withheld',
    demandScale: demandScale(input.latestTwelveMonthSalesUsd),
    currentSixMonthSalesUsd,
    priorYearSixMonthSalesUsd,
    currentThreeMonthSalesUsd,
    precedingThreeMonthSalesUsd,
    sixMonthDemandAddedUsd,
    recentThreeMonthDemandAddedUsd,
    confirmingMonths,
    currentSixMonthEffectiveMonths: round(currentSixMonthEffectiveMonths),
    currentThreeMonthEffectiveMonths: round(
      currentThreeMonthEffectiveMonths,
    ),
    latestTwelveMonthEffectiveMonths: round(
      latestTwelveMonthEffectiveMonths,
    ),
    currentSixMonthPeakShare: round(currentSixMonthPeakShare, 4),
    currentThreeMonthShareOfCurrentSix: round(
      currentThreeMonthShareOfCurrentSix,
      4,
    ),
    adjustedSixMonthMultiple: round(adjustedSixMonthMultiple, 4),
    relativeSixMonthMultiple: round(relativeSixMonthMultiple, 4),
    adjustedRecentThreeMonthMultiple: round(
      adjustedRecentThreeMonthMultiple,
      4,
    ),
    relativeRecentThreeMonthMultiple: round(
      relativeRecentThreeMonthMultiple,
      4,
    ),
    sequentialThreeMonthMultiple: round(sequentialThreeMonthMultiple, 4),
    latestMonthCooling,
    components,
    checks,
    reasonCodes,
    warningCodes: latestMonthCooling ? ['latest_month_cooling'] : [],
    interpretation:
      'subject_level_completed_sales_demand_not_binder_score_card_price_or_investment_advice',
  }
}
