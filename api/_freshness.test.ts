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
      mlbStatsApi: 'succeeded',
      mlbRoster: 'succeeded',
      baseballReference: 'succeeded',
      fangraphs: 'succeeded',
    },
    ...overrides,
  }
}

function runWithoutRosterStatus(overrides: Partial<FreshnessRun> = {}): FreshnessRun {
  const value = run(overrides)
  const { mlbRoster: _mlbRoster, ...sourceStatuses } = value.sourceStatuses ?? {}
  return { ...value, sourceStatuses }
}

const sources = [
  {
    key: 'prospectSavant',
    required: true,
    statsChangedAt: '2026-07-12T10:18:00.000Z',
    coverageComplete: true,
  },
  {
    key: 'mlbStatsApi',
    required: true,
    statsChangedAt: '2026-07-13T10:19:00.000Z',
    coverageComplete: true,
  },
  {
    key: 'mlbRoster',
    required: true,
    statsChangedAt: '2026-07-13T10:19:30.000Z',
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
    required: true,
    statsChangedAt: '2026-07-13T10:18:30.000Z',
    coverageComplete: true,
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
    expect(result.statsChangedAt).toBe('2026-07-13T10:19:30.000Z')
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
        mlbStatsApi: 'succeeded',
        mlbRoster: 'succeeded',
        baseballReference: 'succeeded',
        fangraphs: 'succeeded',
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

  it('accepts a current audited snapshot as initial proof until an operational check appears', () => {
    const result = assessCurrentDataFreshness({
      now,
      cronConfigured: true,
      runs: [runWithoutRosterStatus()],
      sources: sources.map((source) => source.key === 'mlbRoster'
        ? {
            ...source,
            statsChangedAt: '2026-07-13T09:55:00.000Z',
            initialSourceProofAt: '2026-07-13T09:55:00.000Z',
          }
        : source),
    })

    expect(result.status).toBe('ok')
    expect(result.reasonCodes).not.toContain('required_source_check_missing')
    expect(result.sources.mlbRoster).toMatchObject({
      lastCheckedAt: null,
      lastSuccessfulCheckAt: '2026-07-13T09:55:00.000Z',
      lastCheckStatus: null,
    })
  })

  it('retires initial proof after a failed operational source check', () => {
    const failed = run({
      status: 'failed',
      startedAt: '2026-07-13T14:00:00.000Z',
      finishedAt: '2026-07-13T14:02:00.000Z',
      sourceStatuses: { mlbRoster: 'failed' },
    })
    const result = assessCurrentDataFreshness({
      now,
      cronConfigured: true,
      runs: [runWithoutRosterStatus(), failed],
      sources: sources.map((source) => source.key === 'mlbRoster'
        ? {
            ...source,
            statsChangedAt: '2026-07-13T09:55:00.000Z',
            initialSourceProofAt: '2026-07-13T09:55:00.000Z',
          }
        : source),
    })

    expect(result.status).toBe('stale')
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'latest_scheduled_run_failed',
      'required_source_check_missing',
      'latest_required_source_check_failed',
    ]))
    expect(result.sources.mlbRoster.lastSuccessfulCheckAt).toBeNull()
  })

  it('does not let initial snapshot proof outlive the source freshness SLA', () => {
    const result = assessCurrentDataFreshness({
      now,
      cronConfigured: true,
      runs: [runWithoutRosterStatus()],
      sources: sources.map((source) => source.key === 'mlbRoster'
        ? {
            ...source,
            statsChangedAt: '2026-07-11T09:55:00.000Z',
            initialSourceProofAt: '2026-07-11T09:55:00.000Z',
          }
        : source),
    })

    expect(result.status).toBe('stale')
    expect(result.reasons).toContainEqual({
      code: 'required_source_check_overdue',
      source: 'mlbRoster',
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
