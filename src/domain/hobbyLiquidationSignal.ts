import type {
  HobbyMasterFeedItem,
} from './hobbyMasterRanking.js'

export const HOBBY_EXIT_WINDOW_MODEL_VERSION =
  'binder-exit-window/18m-v1.0.0' as const
export const HOBBY_EXIT_WINDOW_MIN_TTM_PERCENTILE = 85 as const
export const HOBBY_EXIT_WINDOW_MIN_RUN_RATE_USD = 250_000 as const
export const HOBBY_EXIT_WINDOW_MIN_PERSISTENCE = 80 as const
export const HOBBY_EXIT_WINDOW_MIN_DECLINE = 0.1 as const

export type HobbyExitWindowReasonCode =
  | 'comparison_not_eligible'
  | 'market_snapshot_not_current'
  | 'complete_history_missing'
  | 'build_or_hold_designation'
  | 'ttm_demand_below_observed_p85'
  | 'current_run_rate_below_exit_floor'
  | 'monthly_persistence_below_exit_floor'
  | 'six_month_decline_below_materiality_floor'

export interface HobbyExitWindowSignal {
  modelVersion: typeof HOBBY_EXIT_WINDOW_MODEL_VERSION
  eligible: boolean
  score: number
  resaleHeat: number
  declinePressure: number
  sixMonthChange: number
  recentThreeMonthChange: number
  openBuildGates: number
  reasonCodes: HobbyExitWindowReasonCode[]
  interpretation:
    'subject_level_exit_window_proxy_not_exact_card_liquidity_or_sell_advice'
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function weightedGeometricMean(
  values: readonly number[],
  weights: readonly number[],
): number {
  if (values.some((value) => value <= 0)) return 0
  return Math.exp(values.reduce(
    (total, value, index) => total + weights[index]! * Math.log(value),
    0,
  ))
}

function changeFromLog(value: number): number {
  return Math.expm1(value)
}

function declineSeverity(
  change: number,
  materialityFloor: number,
  severeDecline: number,
): number {
  const decline = Math.max(0, -change)
  return 100 * clamp(
    (decline - materialityFloor) /
      (severeDecline - materialityFloor),
    0,
    1,
  )
}

export function buildHobbyExitWindowSignal(
  item: HobbyMasterFeedItem,
): HobbyExitWindowSignal {
  const assessment = item.assessment
  const signal = assessment.marketSignal
  const checks = assessment.buildQualification.checks
  const sixMonthChange = changeFromLog(
    signal.diagnostics.yearOverYearSixMonthLogGrowth,
  )
  const recentThreeMonthChange = changeFromLog(
    signal.diagnostics.recentThreeMonthYearOverYearLogGrowth,
  )
  const notLongTermHold =
    !assessment.buildQualification.eligible &&
    assessment.posture !== 'hold_candidate'
  const reasonCodes: HobbyExitWindowReasonCode[] = [
    ...(checks.comparisonEligible ? [] : ['comparison_not_eligible'] as const),
    ...(checks.sourceCurrent ? [] : ['market_snapshot_not_current'] as const),
    ...(checks.completeEighteenMonthHistory
      ? []
      : ['complete_history_missing'] as const),
    ...(notLongTermHold ? [] : ['build_or_hold_designation'] as const),
    ...(signal.globalObservedPercentile >=
        HOBBY_EXIT_WINDOW_MIN_TTM_PERCENTILE
      ? []
      : ['ttm_demand_below_observed_p85'] as const),
    ...(signal.annualizedCurrentSixMonthSalesUsd >=
        HOBBY_EXIT_WINDOW_MIN_RUN_RATE_USD
      ? []
      : ['current_run_rate_below_exit_floor'] as const),
    ...(signal.components.persistence >= HOBBY_EXIT_WINDOW_MIN_PERSISTENCE
      ? []
      : ['monthly_persistence_below_exit_floor'] as const),
    ...(sixMonthChange <= -HOBBY_EXIT_WINDOW_MIN_DECLINE
      ? []
      : ['six_month_decline_below_materiality_floor'] as const),
  ]
  const resaleHeat = round(weightedGeometricMean(
    [
      signal.components.currentRunRateMagnitude,
      signal.components.trailingTwelveMonthMagnitude,
      signal.components.persistence,
      signal.components.shockResistance,
    ],
    [0.5, 0.2, 0.18, 0.12],
  ))
  const sixMonthSeverity = declineSeverity(
    sixMonthChange,
    HOBBY_EXIT_WINDOW_MIN_DECLINE,
    0.5,
  )
  const recentSeverity = declineSeverity(
    recentThreeMonthChange,
    0,
    0.5,
  )
  const downsideFragility = clamp(
    2 * (100 - signal.downsideProtectionScore),
    0,
    100,
  )
  const declinePressure = round(
    0.55 * sixMonthSeverity +
    0.25 * recentSeverity +
    0.2 * downsideFragility,
  )
  const rawScore = round(
    0.65 * Math.min(resaleHeat, declinePressure) +
    0.35 * Math.sqrt(resaleHeat * declinePressure),
  )
  return {
    modelVersion: HOBBY_EXIT_WINDOW_MODEL_VERSION,
    eligible: reasonCodes.length === 0,
    score: reasonCodes.length === 0 ? rawScore : 0,
    resaleHeat,
    declinePressure,
    sixMonthChange: round(sixMonthChange, 4),
    recentThreeMonthChange: round(recentThreeMonthChange, 4),
    openBuildGates:
      assessment.buildQualification.required -
      assessment.buildQualification.passed,
    reasonCodes,
    interpretation:
      'subject_level_exit_window_proxy_not_exact_card_liquidity_or_sell_advice',
  }
}
