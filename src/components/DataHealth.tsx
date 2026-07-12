import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, FileKey2, Link2, Radio } from 'lucide-react'

interface DatabaseHealthResponse {
  status: 'ok' | 'unavailable' | 'unconfigured'
  migrations?: number
}

interface PlayerHealthResponse {
  page?: { total?: number }
  meta?: { season?: number | null; dataAsOf?: string | null }
}

interface ModelHealthResponse {
  coverage?: { externalSnapshots?: number; externalPlayers?: number }
  releaseEligible?: boolean
}

const sourceRows = [
  {
    layer: 'Identity',
    source: 'Chadwick Register',
    coverage: 'MLB, MiLB, international IDs',
    right: 'ODC Attribution 1.0',
    status: 'Open',
  },
  {
    layer: 'Scouting',
    source: 'FanGraphs Prospect Board',
    coverage: 'Grades, ranks, risk, ETA, MiLB stats',
    right: 'Authorized research use',
    status: 'Authorized',
  },
  {
    layer: 'MiLB tracking',
    source: 'Prospect Savant',
    coverage: '2023+ Statcast-derived metrics, Rk through AAA',
    right: 'Authorized research use',
    status: 'Authorized',
  },
  {
    layer: 'Player history',
    source: 'Sports Reference',
    coverage: 'Player, season, game, and event records',
    right: 'Authorized research use',
    status: 'Authorized',
  },
  {
    layer: 'MLB history',
    source: 'Retrosheet + Lahman',
    coverage: 'Events, seasons, awards, HOF',
    right: 'Attribution / CC BY-SA',
    status: 'Open',
  },
]

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

  const databaseConnected = databaseHealth.status === 'ok'

  return (
    <main className="workspace-page data-health">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">LINEAGE AND RIGHTS</span>
          <h1>Data health</h1>
          <p>Coverage, licensing, freshness, and point-in-time integrity before a feature reaches a model.</p>
        </div>
        <span className={`build-badge${databaseConnected ? '' : ' build-badge--warning'}`}>
          {databaseConnected ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
          {databaseHealth.status === 'checking'
            ? 'Checking Neon'
            : databaseConnected
              ? 'Neon connected'
              : 'Database API pending'}
        </span>
      </header>

      <section className="data-status-grid" aria-label="Data foundation status">
        <div>
          <Database size={18} aria-hidden="true" />
          <span>Neon database</span>
          <strong>{databaseConnected ? 'Connected' : 'Pending'}</strong>
          <small>
            {databaseConnected
              ? `${databaseHealth.migrations ?? 0} migration${databaseHealth.migrations === 1 ? '' : 's'} applied`
              : 'Live database endpoint unavailable'}
          </small>
        </div>
        <div>
          <Link2 size={18} aria-hidden="true" />
          <span>Identity strategy</span>
          <strong>Active</strong>
          <small>{playerHealth?.page?.total?.toLocaleString() ?? '—'} current {playerHealth?.meta?.season ?? ''} profiles</small>
        </div>
        <div>
          <FileKey2 size={18} aria-hidden="true" />
          <span>Source permissions</span>
          <strong>Recorded</strong>
          <small>Versioned per ingestion run</small>
        </div>
        <div>
          <Radio size={18} aria-hidden="true" />
          <span>External model corpus</span>
          <strong>{modelHealth?.coverage?.externalSnapshots?.toLocaleString() ?? '—'} snapshots</strong>
          <small>{modelHealth?.coverage?.externalPlayers?.toLocaleString() ?? '—'} identity-linked players</small>
        </div>
      </section>

      <section className="source-plan" aria-labelledby="source-plan-title">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">RESEARCH STACK</span>
            <h2 id="source-plan-title">Source plan</h2>
          </div>
          <span className="record-count">Researched Jul 11, 2026</span>
        </div>
        <div className="source-table-wrap">
          <table className="source-table">
            <thead>
              <tr>
                <th scope="col">Layer</th>
                <th scope="col">Candidate source</th>
                <th scope="col">Coverage</th>
                <th scope="col">Rights posture</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {sourceRows.map((row) => (
                <tr key={row.layer}>
                  <td><strong>{row.layer}</strong></td>
                  <td>{row.source}</td>
                  <td>{row.coverage}</td>
                  <td>{row.right}</td>
                  <td>
                    <span className={`source-status source-status--${row.status.toLowerCase()}`}>
                      <CheckCircle2 size={13} aria-hidden="true" />
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
          <strong>Research permission is recorded, not generalized.</strong>
          <p>Each ingestion run pins the exact permission version, source request, retrieval time, parser version, and immutable response hash.</p>
        </div>
      </section>
    </main>
  )
}
