export const CURRENT_REFRESH_SCHEDULE_UTC = ['17 10 * * *', '17 22 * * *'] as const
export const CURRENT_REFRESH_DAILY_MINUTES_UTC = [10 * 60 + 17, 22 * 60 + 17] as const

const HOUR_MS = 60 * 60 * 1_000

export type FreshnessStatus = 'ok' | 'degraded' | 'stale'
export type RefreshRunStatus = 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped'
export type RefreshSourceStatus = 'succeeded' | 'failed' | 'not_configured'

export type FreshnessReasonCode =
  | 'cron_not_configured'
  | 'scheduled_run_not_observed'
  | 'scheduled_success_missing'
  | 'scheduled_success_overdue'
  | 'latest_scheduled_run_failed'
  | 'latest_scheduled_run_partial'
  | 'scheduled_run_stuck'
  | 'required_source_check_missing'
  | 'required_source_check_overdue'
  | 'latest_required_source_check_failed'
  | 'current_coverage_incomplete'

export interface FreshnessRun {
  jobKey: string
  triggerKind: string
  status: RefreshRunStatus
  season: number | null
  startedAt: string
  finishedAt: string | null
  sourceStatuses?: Record<string, RefreshSourceStatus>
  sourceErrors?: Record<string, string>
}

export interface FreshnessSourceInput {
  key: string
  required: boolean
  statsChangedAt: string | null
  coverageComplete: boolean | null
}

export interface FreshnessReason {
  code: FreshnessReasonCode
  source: string | null
}

export interface FreshnessSourceStatus {
  statsChangedAt: string | null
  lastCheckedAt: string | null
  lastSuccessfulCheckAt: string | null
  lastCheckStatus: RefreshSourceStatus | null
}

export interface FreshnessAssessment {
  status: FreshnessStatus
  reasonCodes: FreshnessReasonCode[]
  reasons: FreshnessReason[]
  statsChangedAt: string | null
  lastCheckedAt: string | null
  nextDueAt: string
  cronProof: {
    observed: boolean
    latestObservedAt: string | null
    latestSuccessAt: string | null
  }
  runs: {
    latest: FreshnessRun | null
    latestScheduled: FreshnessRun | null
    latestScheduledSuccess: FreshnessRun | null
    latestManual: FreshnessRun | null
    latestManualSuccess: FreshnessRun | null
  }
  sources: Record<string, FreshnessSourceStatus>
}

export interface FreshnessAssessmentInput {
  now: Date
  cronConfigured: boolean
  runs: FreshnessRun[]
  sources: FreshnessSourceInput[]
  scheduleMinutesUtc?: readonly number[]
  staleAfterHours?: number
  stuckAfterMinutes?: number
}

function timestamp(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function runTime(run: FreshnessRun): number {
  return timestamp(run.finishedAt) ?? timestamp(run.startedAt) ?? Number.NEGATIVE_INFINITY
}

function newestRun(runs: FreshnessRun[]): FreshnessRun | null {
  return runs.reduce<FreshnessRun | null>(
    (latest, run) => latest === null || runTime(run) > runTime(latest) ? run : latest,
    null,
  )
}

function newestIso(values: Array<string | null>): string | null {
  let latest: { value: string; time: number } | null = null
  for (const value of values) {
    const time = timestamp(value)
    if (value && time !== null && (latest === null || time > latest.time)) {
      latest = { value, time }
    }
  }
  return latest?.value ?? null
}

export function nextDailyScheduleAt(
  now: Date,
  scheduleMinutesUtc: readonly number[] = CURRENT_REFRESH_DAILY_MINUTES_UTC,
): Date {
  if (scheduleMinutesUtc.length === 0) {
    throw new Error('At least one UTC refresh time is required')
  }

  const normalized = [...new Set(scheduleMinutesUtc)].sort((left, right) => left - right)
  if (normalized.some((minutes) => !Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60)) {
    throw new Error('UTC refresh times must be integer minutes within a day')
  }

  for (const minutes of normalized) {
    const candidate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      Math.floor(minutes / 60),
      minutes % 60,
    ))
    if (candidate.getTime() > now.getTime()) return candidate
  }

  const first = normalized[0]
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    Math.floor(first / 60),
    first % 60,
  ))
}

function publicRun(run: FreshnessRun | null): FreshnessRun | null {
  return run
    ? {
        ...run,
        sourceStatuses: run.sourceStatuses ? { ...run.sourceStatuses } : undefined,
        sourceErrors: run.sourceErrors ? { ...run.sourceErrors } : undefined,
      }
    : null
}

export function assessCurrentDataFreshness(
  input: FreshnessAssessmentInput,
): FreshnessAssessment {
  if (Number.isNaN(input.now.getTime())) throw new Error('A valid assessment time is required')

  const staleAfterMs = (input.staleAfterHours ?? 26) * HOUR_MS
  const stuckAfterMs = (input.stuckAfterMinutes ?? 20) * 60 * 1_000
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    throw new Error('Stale threshold must be positive')
  }
  if (!Number.isFinite(stuckAfterMs) || stuckAfterMs <= 0) {
    throw new Error('Stuck-run threshold must be positive')
  }

  const scheduledRuns = input.runs.filter((run) => run.triggerKind === 'vercel_cron')
  const manualRuns = input.runs.filter((run) => run.triggerKind === 'authenticated_manual')
  const latest = newestRun(input.runs)
  const latestScheduled = newestRun(scheduledRuns)
  const latestScheduledSuccess = newestRun(
    scheduledRuns.filter((run) => run.status === 'succeeded'),
  )
  const latestManual = newestRun(manualRuns)
  const latestManualSuccess = newestRun(
    manualRuns.filter((run) => run.status === 'succeeded'),
  )

  const reasons: FreshnessReason[] = []
  const staleReasons = new Set<FreshnessReasonCode>()
  const addReason = (
    code: FreshnessReasonCode,
    source: string | null = null,
    stale = false,
  ) => {
    if (!reasons.some((reason) => reason.code === code && reason.source === source)) {
      reasons.push({ code, source })
    }
    if (stale) staleReasons.add(code)
  }

  if (!input.cronConfigured) addReason('cron_not_configured')
  if (!latestScheduled) {
    addReason('scheduled_run_not_observed')
  } else {
    if (latestScheduled.status === 'failed') addReason('latest_scheduled_run_failed')
    if (latestScheduled.status === 'partial') addReason('latest_scheduled_run_partial')
    const latestStartedAt = timestamp(latestScheduled.startedAt)
    if (
      latestScheduled.status === 'running' &&
      latestStartedAt !== null &&
      input.now.getTime() - latestStartedAt > stuckAfterMs
    ) {
      addReason('scheduled_run_stuck')
    }
  }

  const scheduledSuccessAt = latestScheduledSuccess
    ? timestamp(latestScheduledSuccess.finishedAt ?? latestScheduledSuccess.startedAt)
    : null
  if (latestScheduled && scheduledSuccessAt === null) {
    addReason('scheduled_success_missing', null, true)
  } else if (
    scheduledSuccessAt !== null &&
    input.now.getTime() - scheduledSuccessAt > staleAfterMs
  ) {
    addReason('scheduled_success_overdue', null, true)
  }

  const sourceStatuses: Record<string, FreshnessSourceStatus> = {}
  for (const source of input.sources) {
    const checks = input.runs
      .filter((run) => run.finishedAt !== null && run.sourceStatuses?.[source.key] !== undefined)
      .sort((left, right) => runTime(right) - runTime(left))
    const latestCheck = checks[0] ?? null
    const latestSuccessfulCheck = checks.find(
      (run) => run.sourceStatuses?.[source.key] === 'succeeded',
    ) ?? null
    const lastCheckedAt = latestCheck?.finishedAt ?? null
    const lastSuccessfulCheckAt = latestSuccessfulCheck?.finishedAt ?? null
    const lastCheckStatus = latestCheck?.sourceStatuses?.[source.key] ?? null

    sourceStatuses[source.key] = {
      statsChangedAt: source.statsChangedAt,
      lastCheckedAt,
      lastSuccessfulCheckAt,
      lastCheckStatus,
    }

    if (!source.required) continue
    if (source.coverageComplete === false) {
      addReason('current_coverage_incomplete', source.key)
    }
    if (lastSuccessfulCheckAt === null) {
      addReason('required_source_check_missing', source.key, true)
    } else {
      const successTime = timestamp(lastSuccessfulCheckAt)
      if (successTime !== null && input.now.getTime() - successTime > staleAfterMs) {
        addReason('required_source_check_overdue', source.key, true)
      }
    }
    if (lastCheckStatus === 'failed') {
      addReason('latest_required_source_check_failed', source.key)
    }
  }

  const reasonCodes = [...new Set(reasons.map((reason) => reason.code))]
  const status: FreshnessStatus = staleReasons.size > 0
    ? 'stale'
    : reasons.length > 0
      ? 'degraded'
      : 'ok'

  return {
    status,
    reasonCodes,
    reasons,
    statsChangedAt: newestIso(input.sources.map((source) => source.statsChangedAt)),
    lastCheckedAt: newestIso(
      Object.values(sourceStatuses).map((source) => source.lastCheckedAt),
    ),
    nextDueAt: nextDailyScheduleAt(
      input.now,
      input.scheduleMinutesUtc ?? CURRENT_REFRESH_DAILY_MINUTES_UTC,
    ).toISOString(),
    cronProof: {
      observed: latestScheduled !== null,
      latestObservedAt: latestScheduled?.finishedAt ?? latestScheduled?.startedAt ?? null,
      latestSuccessAt: latestScheduledSuccess?.finishedAt ?? null,
    },
    runs: {
      latest: publicRun(latest),
      latestScheduled: publicRun(latestScheduled),
      latestScheduledSuccess: publicRun(latestScheduledSuccess),
      latestManual: publicRun(latestManual),
      latestManualSuccess: publicRun(latestManualSuccess),
    },
    sources: sourceStatuses,
  }
}
