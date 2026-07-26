import type {
  MagnificentXDomain,
  MagnificentXFreshnessStatus,
  MagnificentXSourceRow,
} from './magnificentX.js'

export const HOBBY_SALES_TREND_MODEL_VERSION =
  'hobby-sales-trend/completed-sales-yoy-v1.0.0' as const
export const HOBBY_SALES_TREND_MIN_WINDOW_USD = 50_000 as const

export type HobbySalesTrendState =
  | 'surging'
  | 'rising'
  | 'steady'
  | 'falling'
  | 'steep_decline'
  | 'cooling'
  | 'rebounding'
  | 'early_rise'
  | 'early_decline'
  | 'withheld'

export type HobbySalesTrendDirection =
  | 'up'
  | 'flat'
  | 'down'
  | 'mixed'
  | 'unavailable'

export type HobbySalesTrendRelativePace =
  | 'ahead'
  | 'inline'
  | 'lagging'
  | 'unavailable'

export type HobbySalesTrendEvidence =
  | 'confirmed'
  | 'mixed_window'
  | 'thin_base'
  | 'withheld'

export interface HobbySalesTrend {
  modelVersion: typeof HOBBY_SALES_TREND_MODEL_VERSION
  available: boolean
  state: HobbySalesTrendState
  label:
    | 'Surging'
    | 'Rising'
    | 'Steady'
    | 'Falling'
    | 'Steep decline'
    | 'Cooling'
    | 'Rebounding'
    | 'Early rise'
    | 'Early decline'
    | 'Refresh needed'
  direction: HobbySalesTrendDirection
  sixMonthChangePct: number | null
  recentThreeMonthChangePct: number | null
  domainMedianSixMonthChangePct: number | null
  relativeToDomain: HobbySalesTrendRelativePace
  evidence: HobbySalesTrendEvidence
  reasonCodes: string[]
}

export interface HobbySalesTrendInput {
  monthlySalesUsd: readonly number[]
  currentSixMonthSalesUsd: number
  priorYearSixMonthSalesUsd: number
  effectiveSalesMonths: number
  sixMonthLogGrowth: number
  recentThreeMonthLogGrowth: number
  domainMedianSixMonthLogGrowth: number | null
  freshnessStatus: MagnificentXFreshnessStatus
}

interface DomainTrendRow {
  domain: MagnificentXDomain
  taxonomyStatus: MagnificentXSourceRow['taxonomyStatus']
  monthlySalesUsd: readonly number[]
}

const MILD_LOG_CHANGE = Math.log(1.15)
const STRONG_LOG_CHANGE = Math.log(1.5)

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = values.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

function percentChange(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null
  return round(100 * (current - prior) / prior)
}

function percentFromLog(logGrowth: number | null): number | null {
  return logGrowth === null ? null : round(100 * Math.expm1(logGrowth))
}

function baseState(logGrowth: number): Exclude<
  HobbySalesTrendState,
  'cooling' | 'rebounding' | 'early_rise' | 'early_decline' | 'withheld'
> {
  if (logGrowth >= STRONG_LOG_CHANGE) return 'surging'
  if (logGrowth >= MILD_LOG_CHANGE) return 'rising'
  if (logGrowth <= -STRONG_LOG_CHANGE) return 'steep_decline'
  if (logGrowth <= -MILD_LOG_CHANGE) return 'falling'
  return 'steady'
}

function trendState(
  sixMonthLogGrowth: number,
  recentThreeMonthLogGrowth: number,
): Exclude<HobbySalesTrendState, 'withheld'> {
  if (
    sixMonthLogGrowth >= MILD_LOG_CHANGE &&
    recentThreeMonthLogGrowth <= -MILD_LOG_CHANGE
  ) {
    return 'cooling'
  }
  if (
    sixMonthLogGrowth <= -MILD_LOG_CHANGE &&
    recentThreeMonthLogGrowth >= MILD_LOG_CHANGE
  ) {
    return 'rebounding'
  }
  if (
    Math.abs(sixMonthLogGrowth) < MILD_LOG_CHANGE &&
    recentThreeMonthLogGrowth >= STRONG_LOG_CHANGE
  ) {
    return 'early_rise'
  }
  if (
    Math.abs(sixMonthLogGrowth) < MILD_LOG_CHANGE &&
    recentThreeMonthLogGrowth <= -STRONG_LOG_CHANGE
  ) {
    return 'early_decline'
  }
  return baseState(sixMonthLogGrowth)
}

const stateLabels: Record<Exclude<HobbySalesTrendState, 'withheld'>, HobbySalesTrend['label']> = {
  surging: 'Surging',
  rising: 'Rising',
  steady: 'Steady',
  falling: 'Falling',
  steep_decline: 'Steep decline',
  cooling: 'Cooling',
  rebounding: 'Rebounding',
  early_rise: 'Early rise',
  early_decline: 'Early decline',
}

function directionFor(
  state: Exclude<HobbySalesTrendState, 'withheld'>,
): Exclude<HobbySalesTrendDirection, 'unavailable'> {
  if (state === 'cooling' || state === 'rebounding') return 'mixed'
  if (state === 'steady') return 'flat'
  return state === 'surging' || state === 'rising' || state === 'early_rise'
    ? 'up'
    : 'down'
}

function relativePace(
  sixMonthLogGrowth: number,
  domainMedianSixMonthLogGrowth: number | null,
): HobbySalesTrendRelativePace {
  if (domainMedianSixMonthLogGrowth === null) return 'unavailable'
  const difference = sixMonthLogGrowth - domainMedianSixMonthLogGrowth
  if (difference >= MILD_LOG_CHANGE) return 'ahead'
  if (difference <= -MILD_LOG_CHANGE) return 'lagging'
  return 'inline'
}

function monthAgreement(
  monthlySalesUsd: readonly number[],
  sixMonthLogGrowth: number,
): number {
  if (monthlySalesUsd.length !== 18) return 0
  const direction = sixMonthLogGrowth >= MILD_LOG_CHANGE
    ? 1
    : sixMonthLogGrowth <= -MILD_LOG_CHANGE
      ? -1
      : 0
  if (direction === 0) return 6
  return monthlySalesUsd.slice(-6).filter((current, index) => {
    const prior = monthlySalesUsd[index]!
    return direction > 0 ? current > prior : current < prior
  }).length
}

export function buildHobbySalesTrend(
  input: HobbySalesTrendInput,
): HobbySalesTrend {
  const currentRecentThree = sum(input.monthlySalesUsd.slice(-3))
  const priorRecentThree = sum(input.monthlySalesUsd.slice(3, 6))
  const sixMonthChangePct = percentChange(
    input.currentSixMonthSalesUsd,
    input.priorYearSixMonthSalesUsd,
  )
  const recentThreeMonthChangePct = percentChange(
    currentRecentThree,
    priorRecentThree,
  )
  const domainMedianSixMonthChangePct = percentFromLog(
    input.domainMedianSixMonthLogGrowth,
  )

  if (input.freshnessStatus !== 'current') {
    return {
      modelVersion: HOBBY_SALES_TREND_MODEL_VERSION,
      available: false,
      state: 'withheld',
      label: 'Refresh needed',
      direction: 'unavailable',
      sixMonthChangePct,
      recentThreeMonthChangePct,
      domainMedianSixMonthChangePct,
      relativeToDomain: 'unavailable',
      evidence: 'withheld',
      reasonCodes: ['market_snapshot_not_current'],
    }
  }

  const state = trendState(
    input.sixMonthLogGrowth,
    input.recentThreeMonthLogGrowth,
  )
  const thinCurrent =
    input.currentSixMonthSalesUsd < HOBBY_SALES_TREND_MIN_WINDOW_USD
  const thinPrior =
    input.priorYearSixMonthSalesUsd < HOBBY_SALES_TREND_MIN_WINDOW_USD
  const turning = state === 'cooling' || state === 'rebounding'
  const agreement = monthAgreement(
    input.monthlySalesUsd,
    input.sixMonthLogGrowth,
  )
  const concentrated = input.effectiveSalesMonths < 6
  const reasonCodes = [
    ...(thinCurrent ? ['current_six_month_base_below_50k'] : []),
    ...(thinPrior ? ['prior_six_month_base_below_50k'] : []),
    ...(turning ? ['recent_three_month_direction_reversal'] : []),
    ...(agreement < 4 ? ['fewer_than_four_months_confirm_direction'] : []),
    ...(concentrated ? ['sales_concentrated_in_fewer_than_six_effective_months'] : []),
  ]
  const evidence: HobbySalesTrendEvidence =
    thinCurrent || thinPrior
      ? 'thin_base'
      : turning || agreement < 4 || concentrated
        ? 'mixed_window'
        : 'confirmed'

  return {
    modelVersion: HOBBY_SALES_TREND_MODEL_VERSION,
    available: true,
    state,
    label: stateLabels[state],
    direction: directionFor(state),
    sixMonthChangePct,
    recentThreeMonthChangePct,
    domainMedianSixMonthChangePct,
    relativeToDomain: relativePace(
      input.sixMonthLogGrowth,
      input.domainMedianSixMonthLogGrowth,
    ),
    evidence,
    reasonCodes,
  }
}

export function hobbySalesTrendDomainMedians(
  rows: readonly DomainTrendRow[],
): Map<MagnificentXDomain, number | null> {
  const values = new Map<MagnificentXDomain, number[]>()
  const domains = new Set<MagnificentXDomain>()
  for (const row of rows) {
    domains.add(row.domain)
    if (
      row.taxonomyStatus !== 'coherent_provider_cohort' ||
      row.monthlySalesUsd.length !== 18
    ) {
      continue
    }
    const current = sum(row.monthlySalesUsd.slice(-6))
    const prior = sum(row.monthlySalesUsd.slice(0, 6))
    if (
      current < HOBBY_SALES_TREND_MIN_WINDOW_USD ||
      prior < HOBBY_SALES_TREND_MIN_WINDOW_USD
    ) {
      continue
    }
    values.set(row.domain, [
      ...(values.get(row.domain) ?? []),
      Math.log((current + 1) / (prior + 1)),
    ])
  }
  return new Map(
    [...domains].map((domain) => [
      domain,
      median(values.get(domain) ?? []),
    ]),
  )
}
