import type {
  HobbyBreakoutSignal,
} from './hobbyBreakoutSignal.js'

export const HOBBY_COMPOUNDING_MODEL_VERSION =
  'hobby-compounding-signal/observed-tail-v1.0.0' as const

export const HOBBY_COMPOUNDING_TAIL_PERCENTILE = 99 as const
export const HOBBY_COMPOUNDING_RETENTION_PERCENTILE = 98.5 as const
export const HOBBY_COMPOUNDING_MULTIPLE_FLOOR = 1.15 as const
export const HOBBY_COMPOUNDING_DOLLAR_LIFT_FLOOR_USD = 250_000 as const
export const HOBBY_COMPOUNDING_PRESSURE_MULTIPLE = 0.9 as const

export type HobbyCompoundingState =
  | 'tail_compounder'
  | 'tail_resident'
  | 'tail_entrant'
  | 'tail_transition'
  | 'tail_concentration'
  | 'tail_pressure'
  | 'forming'
  | 'not_surfaced'
  | 'withheld'

export type HobbyCompoundingReasonCode =
  | 'comparison_not_eligible'
  | 'market_snapshot_not_current'
  | 'complete_history_missing'
  | 'current_six_global_percentile_below_98_5'
  | 'six_month_multiple_below_0_9'
  | 'fewer_than_five_months_confirm'
  | 'current_six_month_demand_too_concentrated'
  | 'latest_twelve_month_demand_too_concentrated'
  | 'current_three_month_demand_too_concentrated'
  | 'single_month_exceeds_40pct_of_current_six_months'
  | 'current_three_months_exceed_85pct_of_current_six_months'
  | 'six_month_multiple_below_1_15'
  | 'six_month_dollar_lift_below_250k'
  | 'domain_relative_six_month_multiple_below_1'
  | 'breakout_surfaced_outside_observed_tail'
  | 'current_six_global_percentile_below_99'
  | 'breakout_not_surfaced'

export interface HobbyCompoundingSignalInput {
  monthlySalesUsd: readonly number[]
  comparisonEligible: boolean
  sourceCurrent: boolean
  completeEighteenMonthHistory: boolean
  priorSixMonthGlobalPercentile: number
  currentSixMonthGlobalPercentile: number
  domainRelativeSixMonthMultiple: number
  breakoutSignal?: HobbyBreakoutSignal | null
}

export interface HobbyCompoundingChecks {
  comparisonEligible: boolean
  sourceCurrent: boolean
  completeEighteenMonthHistory: boolean
  priorSixGlobalPercentileAtLeast99: boolean
  currentSixGlobalPercentileAtLeast99: boolean
  currentSixGlobalPercentileAtLeast98_5: boolean
  retainedTail: boolean
  enteredTail: boolean
  sixMonthMultipleAtLeast1_15: boolean
  sixMonthDemandAddedAtLeast250k: boolean
  absoluteCompounding: boolean
  domainRelativeSixMonthMultipleAtLeast1: boolean
  shareCompounding: boolean
  confirmingMonthsAtLeast5: boolean
  currentSixMonthEffectiveMonthsAtLeast4: boolean
  latestTwelveMonthEffectiveMonthsAtLeast6: boolean
  currentThreeMonthEffectiveMonthsAtLeast2_3: boolean
  currentSixMonthPeakShareAtMost40Pct: boolean
  currentThreeMonthShareAtMost85Pct: boolean
  breadthConfirmed: boolean
  retentionLost: boolean
  sixMonthMultipleBelow0_9: boolean
  breakoutSurfaced: boolean
}

export interface HobbyCompoundingSignal {
  modelVersion: typeof HOBBY_COMPOUNDING_MODEL_VERSION
  state: HobbyCompoundingState
  available: boolean
  surfaced: boolean
  priorSixMonthGlobalPercentile: number
  currentSixMonthGlobalPercentile: number
  globalPercentileDelta: number
  baseSixMonthSalesUsd: number
  middleSixMonthSalesUsd: number
  currentSixMonthSalesUsd: number
  latestTwelveMonthSalesUsd: number
  sixMonthDemandAddedUsd: number
  sixMonthMultiple: number
  domainRelativeSixMonthMultiple: number
  confirmingMonths: number
  currentSixMonthEffectiveMonths: number
  latestTwelveMonthEffectiveMonths: number
  currentThreeMonthEffectiveMonths: number
  currentSixMonthPeakShare: number
  currentThreeMonthShareOfCurrentSix: number
  checks: HobbyCompoundingChecks
  reasonCodes: HobbyCompoundingReasonCode[]
  interpretation:
    'subject_level_completed_sales_tail_context_not_card_value_forecast_or_investment_advice'
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function multiple(current: number, prior: number): number {
  if (prior === 0) return current === 0 ? 1 : current
  return current / prior
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

function validatePercentile(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a finite percentile from 0 to 100`)
  }
}

function validateInput(input: HobbyCompoundingSignalInput): void {
  if (
    input.monthlySalesUsd.length !== 18 ||
    input.monthlySalesUsd.some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  ) {
    throw new Error(
      'Hobby compounding signal requires 18 complete non-negative sales months',
    )
  }
  validatePercentile(
    input.priorSixMonthGlobalPercentile,
    'Prior-six global percentile',
  )
  validatePercentile(
    input.currentSixMonthGlobalPercentile,
    'Current-six global percentile',
  )
  if (
    !Number.isFinite(input.domainRelativeSixMonthMultiple) ||
    input.domainRelativeSixMonthMultiple < 0
  ) {
    throw new Error(
      'Domain-relative six-month multiple must be finite and non-negative',
    )
  }
}

function withheldReasonCodes(
  checks: HobbyCompoundingChecks,
): HobbyCompoundingReasonCode[] {
  return [
    ...(
      checks.comparisonEligible
        ? []
        : ['comparison_not_eligible' as const]
    ),
    ...(
      checks.sourceCurrent
        ? []
        : ['market_snapshot_not_current' as const]
    ),
    ...(
      checks.completeEighteenMonthHistory
        ? []
        : ['complete_history_missing' as const]
    ),
  ]
}

function pressureReasonCodes(
  checks: HobbyCompoundingChecks,
): HobbyCompoundingReasonCode[] {
  return [
    ...(
      checks.retentionLost
        ? ['current_six_global_percentile_below_98_5' as const]
        : []
    ),
    ...(
      checks.sixMonthMultipleBelow0_9
        ? ['six_month_multiple_below_0_9' as const]
        : []
    ),
  ]
}

function concentrationReasonCodes(
  checks: HobbyCompoundingChecks,
): HobbyCompoundingReasonCode[] {
  return [
    ...(
      checks.confirmingMonthsAtLeast5
        ? []
        : ['fewer_than_five_months_confirm' as const]
    ),
    ...(
      checks.currentSixMonthEffectiveMonthsAtLeast4
        ? []
        : ['current_six_month_demand_too_concentrated' as const]
    ),
    ...(
      checks.latestTwelveMonthEffectiveMonthsAtLeast6
        ? []
        : ['latest_twelve_month_demand_too_concentrated' as const]
    ),
    ...(
      checks.currentThreeMonthEffectiveMonthsAtLeast2_3
        ? []
        : ['current_three_month_demand_too_concentrated' as const]
    ),
    ...(
      checks.currentSixMonthPeakShareAtMost40Pct
        ? []
        : ['single_month_exceeds_40pct_of_current_six_months' as const]
    ),
    ...(
      checks.currentThreeMonthShareAtMost85Pct
        ? []
        : ['current_three_months_exceed_85pct_of_current_six_months' as const]
    ),
  ]
}

function compoundingGapReasonCodes(
  checks: HobbyCompoundingChecks,
): HobbyCompoundingReasonCode[] {
  return [
    ...(
      checks.sixMonthMultipleAtLeast1_15
        ? []
        : ['six_month_multiple_below_1_15' as const]
    ),
    ...(
      checks.sixMonthDemandAddedAtLeast250k
        ? []
        : ['six_month_dollar_lift_below_250k' as const]
    ),
    ...(
      checks.domainRelativeSixMonthMultipleAtLeast1
        ? []
        : ['domain_relative_six_month_multiple_below_1' as const]
    ),
  ]
}

function surfacedFor(state: HobbyCompoundingState): boolean {
  return state !== 'not_surfaced' && state !== 'withheld'
}

export function buildHobbyCompoundingSignal(
  input: HobbyCompoundingSignalInput,
): HobbyCompoundingSignal {
  validateInput(input)

  const baseSixMonths = input.monthlySalesUsd.slice(0, 6)
  const middleSixMonths = input.monthlySalesUsd.slice(6, 12)
  const currentSixMonths = input.monthlySalesUsd.slice(12, 18)
  const latestTwelveMonths = input.monthlySalesUsd.slice(6, 18)
  const currentThreeMonths = input.monthlySalesUsd.slice(15, 18)
  const baseSixMonthSalesUsd = sum(baseSixMonths)
  const middleSixMonthSalesUsd = sum(middleSixMonths)
  const currentSixMonthSalesUsd = sum(currentSixMonths)
  const latestTwelveMonthSalesUsd = sum(latestTwelveMonths)
  const sixMonthDemandAddedUsd =
    currentSixMonthSalesUsd - middleSixMonthSalesUsd
  const sixMonthMultiple = multiple(
    currentSixMonthSalesUsd,
    middleSixMonthSalesUsd,
  )
  const confirmingMonths = currentSixMonths.filter(
    (value, index) => value > middleSixMonths[index]!,
  ).length
  const currentSixMonthEffectiveMonths =
    effectiveMonths(currentSixMonths)
  const latestTwelveMonthEffectiveMonths =
    effectiveMonths(latestTwelveMonths)
  const currentThreeMonthEffectiveMonths =
    effectiveMonths(currentThreeMonths)
  const currentSixMonthPeakShare = currentSixMonthSalesUsd <= 0
    ? 1
    : Math.max(...currentSixMonths) / currentSixMonthSalesUsd
  const currentThreeMonthSalesUsd = sum(currentThreeMonths)
  const currentThreeMonthShareOfCurrentSix =
    currentSixMonthSalesUsd <= 0
      ? 1
      : currentThreeMonthSalesUsd / currentSixMonthSalesUsd

  const priorTail =
    input.priorSixMonthGlobalPercentile >=
      HOBBY_COMPOUNDING_TAIL_PERCENTILE
  const currentTail =
    input.currentSixMonthGlobalPercentile >=
      HOBBY_COMPOUNDING_TAIL_PERCENTILE
  const retainedAtBuffer =
    input.currentSixMonthGlobalPercentile >=
      HOBBY_COMPOUNDING_RETENTION_PERCENTILE
  const retainedTail = priorTail && retainedAtBuffer
  const enteredTail = !priorTail && currentTail
  const sixMonthMultipleAtLeast1_15 =
    sixMonthMultiple >= HOBBY_COMPOUNDING_MULTIPLE_FLOOR
  const sixMonthDemandAddedAtLeast250k =
    sixMonthDemandAddedUsd >= HOBBY_COMPOUNDING_DOLLAR_LIFT_FLOOR_USD
  const absoluteCompounding =
    sixMonthMultipleAtLeast1_15 &&
    sixMonthDemandAddedAtLeast250k
  const shareCompounding =
    input.domainRelativeSixMonthMultiple >= 1
  const confirmingMonthsAtLeast5 = confirmingMonths >= 5
  const currentSixMonthEffectiveMonthsAtLeast4 =
    currentSixMonthEffectiveMonths >= 4
  const latestTwelveMonthEffectiveMonthsAtLeast6 =
    latestTwelveMonthEffectiveMonths >= 6
  const currentThreeMonthEffectiveMonthsAtLeast2_3 =
    currentThreeMonthEffectiveMonths >= 2.3
  const currentSixMonthPeakShareAtMost40Pct =
    currentSixMonthPeakShare <= 0.4
  const currentThreeMonthShareAtMost85Pct =
    currentThreeMonthShareOfCurrentSix <= 0.85
  const breadthConfirmed =
    confirmingMonthsAtLeast5 &&
    currentSixMonthEffectiveMonthsAtLeast4 &&
    latestTwelveMonthEffectiveMonthsAtLeast6 &&
    currentThreeMonthEffectiveMonthsAtLeast2_3 &&
    currentSixMonthPeakShareAtMost40Pct &&
    currentThreeMonthShareAtMost85Pct
  const retentionLost = priorTail && !retainedAtBuffer
  const sixMonthMultipleBelow0_9 =
    sixMonthMultiple < HOBBY_COMPOUNDING_PRESSURE_MULTIPLE

  const checks: HobbyCompoundingChecks = {
    comparisonEligible: input.comparisonEligible,
    sourceCurrent: input.sourceCurrent,
    completeEighteenMonthHistory: input.completeEighteenMonthHistory,
    priorSixGlobalPercentileAtLeast99: priorTail,
    currentSixGlobalPercentileAtLeast99: currentTail,
    currentSixGlobalPercentileAtLeast98_5: retainedAtBuffer,
    retainedTail,
    enteredTail,
    sixMonthMultipleAtLeast1_15,
    sixMonthDemandAddedAtLeast250k,
    absoluteCompounding,
    domainRelativeSixMonthMultipleAtLeast1: shareCompounding,
    shareCompounding,
    confirmingMonthsAtLeast5,
    currentSixMonthEffectiveMonthsAtLeast4,
    latestTwelveMonthEffectiveMonthsAtLeast6,
    currentThreeMonthEffectiveMonthsAtLeast2_3,
    currentSixMonthPeakShareAtMost40Pct,
    currentThreeMonthShareAtMost85Pct,
    breadthConfirmed,
    retentionLost,
    sixMonthMultipleBelow0_9,
    breakoutSurfaced: input.breakoutSignal?.surfaced === true,
  }

  const comparisonAvailable =
    checks.comparisonEligible &&
    checks.sourceCurrent &&
    checks.completeEighteenMonthHistory
  let state: HobbyCompoundingState
  let reasonCodes: HobbyCompoundingReasonCode[]

  if (!comparisonAvailable) {
    state = 'withheld'
    reasonCodes = withheldReasonCodes(checks)
  } else if (
    priorTail &&
    (retentionLost || sixMonthMultipleBelow0_9)
  ) {
    state = 'tail_pressure'
    reasonCodes = pressureReasonCodes(checks)
  } else if (
    (retainedTail || enteredTail) &&
    !breadthConfirmed
  ) {
    state = 'tail_concentration'
    reasonCodes = concentrationReasonCodes(checks)
  } else if (
    retainedTail &&
    absoluteCompounding &&
    shareCompounding &&
    breadthConfirmed
  ) {
    state = 'tail_compounder'
    reasonCodes = []
  } else if (retainedTail && breadthConfirmed) {
    state = 'tail_resident'
    reasonCodes = compoundingGapReasonCodes(checks)
  } else if (
    enteredTail &&
    absoluteCompounding &&
    breadthConfirmed
  ) {
    state = 'tail_entrant'
    reasonCodes = []
  } else if (currentTail) {
    state = 'tail_transition'
    reasonCodes = compoundingGapReasonCodes(checks)
  } else if (checks.breakoutSurfaced) {
    state = 'forming'
    reasonCodes = ['breakout_surfaced_outside_observed_tail']
  } else {
    state = 'not_surfaced'
    reasonCodes = [
      'current_six_global_percentile_below_99',
      'breakout_not_surfaced',
    ]
  }

  const roundedPriorSixMonthGlobalPercentile = round(
    input.priorSixMonthGlobalPercentile,
  )
  const roundedCurrentSixMonthGlobalPercentile = round(
    input.currentSixMonthGlobalPercentile,
  )
  const roundedGlobalPercentileDelta = round(
    input.currentSixMonthGlobalPercentile -
      input.priorSixMonthGlobalPercentile,
  )
  const roundedSixMonthMultiple = round(sixMonthMultiple)
  const roundedDomainRelativeSixMonthMultiple = round(
    input.domainRelativeSixMonthMultiple,
  )
  const roundedCurrentSixMonthEffectiveMonths = round(
    currentSixMonthEffectiveMonths,
  )
  const roundedLatestTwelveMonthEffectiveMonths = round(
    latestTwelveMonthEffectiveMonths,
  )
  const roundedCurrentThreeMonthEffectiveMonths = round(
    currentThreeMonthEffectiveMonths,
  )
  const roundedCurrentSixMonthPeakShare = round(
    currentSixMonthPeakShare,
    6,
  )
  const roundedCurrentThreeMonthShareOfCurrentSix = round(
    currentThreeMonthShareOfCurrentSix,
    6,
  )

  return {
    modelVersion: HOBBY_COMPOUNDING_MODEL_VERSION,
    state,
    available: state !== 'withheld',
    surfaced: surfacedFor(state),
    priorSixMonthGlobalPercentile:
      roundedPriorSixMonthGlobalPercentile,
    currentSixMonthGlobalPercentile:
      roundedCurrentSixMonthGlobalPercentile,
    globalPercentileDelta: roundedGlobalPercentileDelta,
    baseSixMonthSalesUsd,
    middleSixMonthSalesUsd,
    currentSixMonthSalesUsd,
    latestTwelveMonthSalesUsd,
    sixMonthDemandAddedUsd,
    sixMonthMultiple: roundedSixMonthMultiple,
    domainRelativeSixMonthMultiple:
      roundedDomainRelativeSixMonthMultiple,
    confirmingMonths,
    currentSixMonthEffectiveMonths:
      roundedCurrentSixMonthEffectiveMonths,
    latestTwelveMonthEffectiveMonths:
      roundedLatestTwelveMonthEffectiveMonths,
    currentThreeMonthEffectiveMonths:
      roundedCurrentThreeMonthEffectiveMonths,
    currentSixMonthPeakShare: roundedCurrentSixMonthPeakShare,
    currentThreeMonthShareOfCurrentSix:
      roundedCurrentThreeMonthShareOfCurrentSix,
    checks,
    reasonCodes,
    interpretation:
      'subject_level_completed_sales_tail_context_not_card_value_forecast_or_investment_advice',
  }
}
