import { describe, expect, it } from 'vitest'
import { assertCurrentMlbRoleSnapshot } from './player-directory.js'

describe('current MLB role snapshot audit', () => {
  it('accepts substantive role cohorts', () => {
    expect(() => assertCurrentMlbRoleSnapshot({
      invalid_two_way_rows: 0,
      invalid_small_cohort_percentiles: 0,
    })).not.toThrow()
  })

  it('rejects nominal two-way rows and undersized percentiles', () => {
    expect(() => assertCurrentMlbRoleSnapshot({
      invalid_two_way_rows: 1,
      invalid_small_cohort_percentiles: 0,
    })).toThrow(/nominal two-way/u)
    expect(() => assertCurrentMlbRoleSnapshot({
      invalid_two_way_rows: 0,
      invalid_small_cohort_percentiles: 1,
    })).toThrow(/undersized role cohorts/u)
    expect(() => assertCurrentMlbRoleSnapshot(undefined)).toThrow(/no result/u)
  })
})
