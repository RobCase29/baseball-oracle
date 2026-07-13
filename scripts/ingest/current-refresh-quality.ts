import type { ProspectSavantSlice } from './prospect-savant.js'
import type { MlbStatsApiMilbSlice } from './mlb-statsapi-milb.js'

export const PROSPECT_SAVANT_CURRENT_MINIMUM_ROWS = 100
export const BASEBALL_REFERENCE_CURRENT_MINIMUM_ROWS = 200
export const MLB_STATSAPI_MILB_CURRENT_MINIMUM_ROWS = 50
export const CURRENT_REFRESH_MINIMUM_PREVIOUS_RETENTION = 0.6

export interface CurrentRefreshCardinalityGate {
  observedRows: number
  absoluteMinimumRows: number
  previousRows: number | null
  previousRetentionMinimumRows: number | null
  requiredRows: number
}

function assertRowCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} row count must be a non-negative integer`)
  }
}

function cardinalityGate(
  observedRows: number,
  absoluteMinimumRows: number,
  previousRows: number | null,
): CurrentRefreshCardinalityGate {
  assertRowCount(observedRows, 'Observed')
  assertRowCount(absoluteMinimumRows, 'Absolute minimum')
  if (previousRows !== null) assertRowCount(previousRows, 'Previous')

  const previousRetentionMinimumRows =
    previousRows === null
      ? null
      : Math.ceil(previousRows * CURRENT_REFRESH_MINIMUM_PREVIOUS_RETENTION)
  return {
    observedRows,
    absoluteMinimumRows,
    previousRows,
    previousRetentionMinimumRows,
    requiredRows: Math.max(
      absoluteMinimumRows,
      previousRetentionMinimumRows ?? 0,
    ),
  }
}

export function assertProspectSavantCurrentCardinality(
  observedRows: number,
  slice: ProspectSavantSlice,
  previousRows: number | null,
): CurrentRefreshCardinalityGate {
  const gate = cardinalityGate(
    observedRows,
    PROSPECT_SAVANT_CURRENT_MINIMUM_ROWS,
    previousRows,
  )
  if (observedRows < gate.requiredRows) {
    throw new Error(
      `Prospect Savant ${slice.season} ${slice.level} ${slice.role} returned ` +
        `${observedRows} rows; current refresh requires at least ${gate.requiredRows}` +
        (previousRows === null ? '' : ` after ${previousRows} rows previously`),
    )
  }
  return gate
}

export function assertBaseballReferenceCurrentCardinality(
  observedRows: number,
  season: number,
  side: 'batting' | 'pitching',
  previousRows: number | null,
): CurrentRefreshCardinalityGate {
  const gate = cardinalityGate(
    observedRows,
    BASEBALL_REFERENCE_CURRENT_MINIMUM_ROWS,
    previousRows,
  )
  if (observedRows < gate.requiredRows) {
    throw new Error(
      `Baseball-Reference ${season} ${side} returned ${observedRows} rows; ` +
        `current refresh requires at least ${gate.requiredRows}` +
        (previousRows === null ? '' : ` after ${previousRows} rows previously`),
    )
  }
  return gate
}

export function assertMlbStatsApiMilbCurrentCardinality(
  observedRows: number,
  slice: MlbStatsApiMilbSlice,
  previousRows: number | null,
): CurrentRefreshCardinalityGate {
  const gate = cardinalityGate(
    observedRows,
    MLB_STATSAPI_MILB_CURRENT_MINIMUM_ROWS,
    previousRows,
  )
  if (observedRows < gate.requiredRows) {
    throw new Error(
      `MLB StatsAPI ${slice.season} ${slice.level} ${slice.role} returned ` +
        `${observedRows} rows; current refresh requires at least ${gate.requiredRows}` +
        (previousRows === null ? '' : ` after ${previousRows} rows previously`),
    )
  }
  return gate
}
