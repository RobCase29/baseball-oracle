import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  FileKey2,
  RefreshCw,
  UsersRound,
} from 'lucide-react'

interface CoverageStatus {
  season: number
  oldestSliceAt?: string
  newestSliceAt?: string
  oldestSideAt?: string
  newestSideAt?: string
}

interface SourceStatus {
  source: string
  dataset: string
  lastAttemptStatus: string | null
  lastSuccessFinishedAt: string | null
  lastChangedAt: string | null
}

interface RefreshJob {
  job_key: string
  status: string
  started_at: string
  finished_at: string | null
}

interface DatabaseHealthResponse {
  status: 'ok' | 'unavailable' | 'unconfigured'
  migrations?: number
  directory?: {
    rows: number
    season: number | null
    oldestSourceAt: string | null
    newestSourceAt: string | null
  }
  sources?: SourceStatus[]
  currentCoverage?: {
    prospectSavant: (CoverageStatus & { observedSlices: number; expectedSlices: number }) | null
    baseballReference: (CoverageStatus & { observedSides: number; expectedSides: number }) | null
  }
  scheduledRefresh?: {
    configured: boolean
    scheduleUtc: string
    jobs: RefreshJob[]
  }
  modelArtifacts?: {
    arrival?: { featureAsOf?: string | null; rows?: number | null }
    milbImpact?: { featureAsOf?: string | null; rows?: number | null }
    career?: { latestCompleteFeatureSeason?: number | null; players?: number | null }
  }
}

interface PlayerHealthResponse {
  page?: { total?: number }
  meta?: { season?: number | null; dataAsOf?: string | null }
}

interface ModelHealthResponse {
  coverage?: { externalSnapshots?: number; externalPlayers?: number }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not yet available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not yet available'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function latestDate(...values: Array<string | null | undefined>): string | null {
  const valid = values
    .map((value) => value ? new Date(value) : null)
    .filter((value): value is Date => value !== null && !Number.isNaN(value.getTime()))
  if (valid.length === 0) return null
  return new Date(Math.max(...valid.map((value) => value.getTime()))).toISOString()
}

function oldestDate(...values: Array<string | null | undefined>): string | null {
  const valid = values
    .map((value) => value ? new Date(value) : null)
    .filter((value): value is Date => value !== null && !Number.isNaN(value.getTime()))
  if (valid.length === 0) return null
  return new Date(Math.min(...valid.map((value) => value.getTime()))).toISOString()
}

function updatedWithin(value: string | null | undefined, hours: number): boolean {
  if (!value) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && Date.now() - timestamp <= hours * 60 * 60 * 1_000
}

export function DataHealth() {
  const [databaseHealth, setDatabaseHealth] = useState<
    DatabaseHealthResponse | { status: 'checking' }
  >({ status: 'checking' })
  const [playerHealth, setPlayerHealth] = useState<PlayerHealthResponse | null>(null)
  const [modelHealth, setModelHealth] = useState<ModelHealthResponse | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    Promise.all([
      fetch('/api/health', { signal: controller.signal }),
      fetch('/api/players?limit=1', { signal: controller.signal }),
      fetch('/api/model-status', { signal: controller.signal }),
    ])
      .then(async ([healthResponse, playersResponse, modelResponse]) => {
        setDatabaseHealth((await healthResponse.json()) as DatabaseHealthResponse)
        if (playersResponse.ok) setPlayerHealth((await playersResponse.json()) as PlayerHealthResponse)
        if (modelResponse.ok) setModelHealth((await modelResponse.json()) as ModelHealthResponse)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setDatabaseHealth({ status: 'unavailable' })
      })

    return () => controller.abort()
  }, [])

  const health = databaseHealth.status === 'ok' ? databaseHealth : null
  const databaseConnected = health !== null
  const minorCoverage = health?.currentCoverage?.prospectSavant ?? null
  const mlbCoverage = health?.currentCoverage?.baseballReference ?? null
  const refresh = health?.scheduledRefresh
  const latestJob = refresh?.jobs.find((job) => job.job_key === 'current-baseball-source-refresh-v1')
  const latestJobAt = latestJob?.finished_at ?? latestJob?.started_at
  const automaticUpdatesHealthy = refresh?.configured === true &&
    (latestJob?.status === 'succeeded' || latestJob?.status === 'running') &&
    updatedWithin(latestJobAt, 36)
  const modelSeason = health?.modelArtifacts?.career?.latestCompleteFeatureSeason ?? null
  const minorUpdatedAt = minorCoverage?.oldestSliceAt ?? minorCoverage?.newestSliceAt
  const mlbUpdatedAt = mlbCoverage?.oldestSideAt ?? mlbCoverage?.newestSideAt
  const currentDataAt = minorUpdatedAt && mlbUpdatedAt
    ? oldestDate(minorUpdatedAt, mlbUpdatedAt)
    : latestDate(minorUpdatedAt, mlbUpdatedAt, playerHealth?.meta?.dataAsOf)
  const currentProfiles = playerHealth?.page?.total ?? health?.directory?.rows
  const minorComplete = minorCoverage !== null &&
    minorCoverage.observedSlices === minorCoverage.expectedSlices &&
    updatedWithin(minorUpdatedAt, 36)
  const mlbComplete = mlbCoverage !== null &&
    mlbCoverage.observedSides === mlbCoverage.expectedSides &&
    updatedWithin(mlbUpdatedAt, 36)

  const sourceRows = [
    {
      source: 'Prospect Savant',
      adds: 'Current minor-league performance and tracking stats',
      cadence: 'Daily',
      updated: formatDate(minorUpdatedAt),
      status: minorComplete ? 'Current' : 'Partial',
    },
    {
      source: 'Baseball-Reference',
      adds: 'Current MLB WAR and playing time, plus historical career outcomes',
      cadence: 'Daily',
      updated: formatDate(mlbUpdatedAt),
      status: mlbComplete ? 'Current' : 'Partial',
    },
    {
      source: 'FanGraphs Prospect Board',
      adds: 'Dated scouting grades and public prospect context',
      cadence: 'Verified snapshots',
      updated: 'Historical editions stored',
      status: 'Current feed pending',
    },
    {
      source: 'Chadwick, Retrosheet and Lahman',
      adds: 'Player identity, game history, awards and Hall of Fame results',
      cadence: 'Versioned archive',
      updated: `${modelHealth?.coverage?.externalPlayers?.toLocaleString() ?? 'Historical'} linked players`,
      status: 'Stored',
    },
  ]

  return (
    <main className="workspace-page data-health">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">DATA UPDATES</span>
          <h1>Data freshness</h1>
          <p>See when player stats last changed, whether the daily update ran, and which season powers the score.</p>
        </div>
        <span className={`build-badge${automaticUpdatesHealthy ? '' : ' build-badge--warning'}`}>
          {automaticUpdatesHealthy
            ? <CheckCircle2 size={14} aria-hidden="true" />
            : <AlertTriangle size={14} aria-hidden="true" />}
          {databaseHealth.status === 'checking'
            ? 'Checking updates'
            : automaticUpdatesHealthy
              ? 'Daily updates on'
              : 'Update setup needs attention'}
        </span>
      </header>

      <section className="data-status-grid" aria-label="Current data status">
        <div>
          <RefreshCw size={18} aria-hidden="true" />
          <span>Automatic updates</span>
          <strong>{refresh?.configured ? 'Daily' : 'Not configured'}</strong>
          <small>{latestJob ? `Last run ${formatDate(latestJob.finished_at ?? latestJob.started_at)}` : 'First run pending'}</small>
        </div>
        <div>
          <Clock3 size={18} aria-hidden="true" />
          <span>Latest player stats</span>
          <strong>{formatDate(currentDataAt)}</strong>
          <small>{minorComplete && mlbComplete ? 'MiLB and MLB updates complete' : 'Some current data is still pending'}</small>
        </div>
        <div>
          <UsersRound size={18} aria-hidden="true" />
          <span>Active player coverage</span>
          <strong>{currentProfiles?.toLocaleString() ?? '—'} players</strong>
          <small>{minorCoverage?.season ?? mlbCoverage?.season ?? playerHealth?.meta?.season ?? 'Current'} season</small>
        </div>
        <div>
          <Database size={18} aria-hidden="true" />
          <span>Oracle Score inputs</span>
          <strong>{modelSeason ? `Through ${modelSeason}` : 'Update pending'}</strong>
          <small>Current stats are shown separately until the next tested model release</small>
        </div>
      </section>

      <section className="freshness-detail" aria-label="Daily update coverage">
        <div>
          <span>MINOR-LEAGUE UPDATE</span>
          <strong>{minorCoverage ? `${minorCoverage.observedSlices}/${minorCoverage.expectedSlices} data groups` : 'Waiting for first update'}</strong>
          <small>{formatDate(minorUpdatedAt)}</small>
        </div>
        <div>
          <span>MAJOR-LEAGUE UPDATE</span>
          <strong>{mlbCoverage ? `${mlbCoverage.observedSides}/${mlbCoverage.expectedSides} batting and pitching groups` : 'Waiting for first update'}</strong>
          <small>{formatDate(mlbUpdatedAt)}</small>
        </div>
        <div>
          <span>SCORE MODEL</span>
          <strong>{modelSeason ? `Completed ${modelSeason} season` : 'Model date unavailable'}</strong>
          <small>Re-scoring is a tested release, not an automatic in-season change</small>
        </div>
      </section>

      <section className="source-plan" aria-labelledby="source-plan-title">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">SOURCES</span>
            <h2 id="source-plan-title">What powers the product</h2>
          </div>
          <span className="record-count">Current data {formatDate(currentDataAt)}</span>
        </div>
        <div className="source-table-wrap">
          <table className="source-table source-table--plain">
            <thead>
              <tr>
                <th scope="col">Data source</th>
                <th scope="col">What it adds</th>
                <th scope="col">Update plan</th>
                <th scope="col">Last update</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {sourceRows.map((row) => (
                <tr key={row.source}>
                  <td><strong>{row.source}</strong></td>
                  <td>{row.adds}</td>
                  <td>{row.cadence}</td>
                  <td>{row.updated}</td>
                  <td>
                    <span className={`source-status${row.status === 'Current' || row.status === 'Stored' ? ' source-status--open' : ' source-status--proposed'}`}>
                      {row.status === 'Current' || row.status === 'Stored'
                        ? <CheckCircle2 size={13} aria-hidden="true" />
                        : <AlertTriangle size={13} aria-hidden="true" />}
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rights-notice">
        <FileKey2 size={19} aria-hidden="true" />
        <div>
          <strong>Every update is traceable.</strong>
          <p>The product records the source, retrieval time, parser version, and response fingerprint behind each stored update. Database status: {databaseConnected ? `connected with ${health?.migrations ?? 0} migrations` : 'unavailable'}.</p>
        </div>
      </section>
    </main>
  )
}
