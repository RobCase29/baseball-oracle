import { describe, expect, it } from 'vitest'
import {
  assessCurrentDataFreshness,
  nextDailyScheduleAt,
  type FreshnessRun,
} from './_freshness.js'

const now = new Date('2026-07-13T15:00:00.000Z')

function run(overrides: Partial<FreshnessRun> = {}): FreshnessRun {
  return {
    jobKey: 'current-baseball-source-refresh-v1',
    triggerKind: 'vercel_cron',
    status: 'succeeded',
    season: 2026,
    startedAt: '2026-07-13T10:17:00.000Z',
    finishedAt: '2026-07-13T10:20:00.000Z',
    sourceStatuses: {
      prospectSavant: 'succeeded',
      baseballReference: 'succeeded',
      fangraphs: 'not_configured',
    },
    ...overrides,
  }
}

const sources = [
  {
    key: 'prospectSavant',
    required: true,
    statsChangedAt: '2026-07-12T10:18:00.000Z',
    coverageComplete: true,
  },
  {
    key: 'baseballReference',
    required: true,
    statsChangedAt: '2026-07-10T10:18:00.000Z',
    coverageComplete: true,
  },
  {
    key: 'fangraphs',
    required: false,
    statsChangedAt: null,
    coverageComplete: null,
  },
]

describe('current data freshness assessment', () => {
  it('uses successful checks, not unchanged content, to prove current data freshness', () => {
    const result = assessCurrentDataFreshness({
      now,
      cronConfigured: true,
      runs: [run()],
      sources,
    })

    expect(result.status).toBe('ok')
    expect(result.statsChangedAt).toBe('2026-07-12T10:18:00.000Z')
    expect(result.lastCheckedAt).toBe('2026-07-13T10:20:00.000Z')
    expect(result.sources.baseballReference).toMatchObject({
      statsChangedAt: '2026-07-10T10:18:00.000Z',
      lastCheckedAt: '2026-07-13T10:20:00.000Z',
      lastSuccessfulCheckAt: '2026-07-13T10:20:00.000Z',
    })
  })

  it('requires a Vercel-triggered receipt as cron proof while exposing manual recovery', () => {
    const manual = run({
      triggerKind: 'authenticated_manual',
      startedAt: '2026-07-13T14:00:00.000Z',
      finishedAt: '2026-07-13T14:03:00.000Z',
    })
    const result = assessCurrentDataFreshness({
      now,
      cronConfigured: true,
      runs: [manual],
      sources,
    })

    expect(result.status).toBe('degraded')
    expect(result.reasonCodes).toContain('scheduled_run_not_observed')
    expect(result.cronProof.observed).toBe(false)
    expect(result.runs.latestManualSuccess?.finishedAt).toBe(
      '2026-07-13T14:03:00.000Z',
    )
    expect(result.runs.latestScheduledSuccess).toBeNull()
  })

  it('reports a failed scheduled attempt as degraded while the last success is current', () => {
    const failed = run({
      status: 'failed',
      startedAt: '2026-07-13T14:00:00.000Z',
      finishedAt: '2026-07-13T14:02:00.000Z',
      sourceStatuses: {
        prospectSavant: 'failed',
        baseballReference: 'succeeded',
      },
    })
    const result = assessCurrentDataFreshness({
      now,
      cronConfigured: true,
      runs: [run(), failed],
      sources,
    })

    expect(result.status).toBe('degraded')
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'latest_scheduled_run_failed',
      'latest_required_source_check_failed',
    ]))
  })

  it('reports stale when scheduled and required-source successes exceed the hard limit', () => {
    const old = run({
      startedAt: '2026-07-11T10:17:00.000Z',
      finishedAt: '2026-07-11T10:20:00.000Z',
    })
    const result = assessCurrentDataFreshness({
      now,
      cronConfigured: true,
      runs: [old],
      sources,
    })

    expect(result.status).toBe('stale')
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'scheduled_success_overdue',
      'required_source_check_overdue',
    ]))
  })

  it('reports incomplete current-source coverage independently of the check clock', () => {
    const result = assessCurrentDataFreshness({
      now,
      cronConfigured: true,
      runs: [run()],
      sources: sources.map((source) => source.key === 'baseballReference'
        ? { ...source, coverageComplete: false }
        : source),
    })

    expect(result.status).toBe('degraded')
    expect(result.reasons).toContainEqual({
      code: 'current_coverage_incomplete',
      source: 'baseballReference',
    })
  })
})

describe('twice-daily schedule calculation', () => {
  it('returns the next same-day recovery window', () => {
    expect(nextDailyScheduleAt(new Date('2026-07-13T15:00:00.000Z')).toISOString())
      .toBe('2026-07-13T22:17:00.000Z')
  })

  it('rolls to the next morning after the evening window', () => {
    expect(nextDailyScheduleAt(new Date('2026-07-13T23:00:00.000Z')).toISOString())
      .toBe('2026-07-14T10:17:00.000Z')
  })
})
