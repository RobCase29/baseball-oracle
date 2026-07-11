import { AlertTriangle, CheckCircle2, Database, FileKey2, Link2, Radio } from 'lucide-react'

const sourceRows = [
  {
    layer: 'Identity',
    source: 'Chadwick Register',
    coverage: 'MLB, MiLB, international IDs',
    right: 'ODC Attribution 1.0',
    status: 'Open',
  },
  {
    layer: 'MLB history',
    source: 'Retrosheet + Lahman',
    coverage: 'Events, seasons, awards, HOF',
    right: 'Attribution / CC BY-SA',
    status: 'Open',
  },
  {
    layer: 'MiLB features',
    source: 'SIS enterprise feed',
    coverage: 'Levels, tracking, defense, injuries',
    right: 'Commercial contract required',
    status: 'Proposed',
  },
  {
    layer: 'MLB live',
    source: 'Sportradar official feed',
    coverage: 'Stats, Statcast, rosters, injuries',
    right: 'Commercial contract required',
    status: 'Proposed',
  },
]

export function DataHealth() {
  return (
    <main className="workspace-page data-health">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">LINEAGE AND RIGHTS</span>
          <h1>Data health</h1>
          <p>Coverage, licensing, freshness, and point-in-time integrity before a feature reaches a model.</p>
        </div>
        <span className="build-badge build-badge--warning"><AlertTriangle size={14} aria-hidden="true" /> No live feed connected</span>
      </header>

      <section className="data-status-grid" aria-label="Data foundation status">
        <div>
          <Database size={18} aria-hidden="true" />
          <span>Production datasets</span>
          <strong>0 connected</strong>
          <small>Demo adapter active</small>
        </div>
        <div>
          <Link2 size={18} aria-hidden="true" />
          <span>Identity strategy</span>
          <strong>Defined</strong>
          <small>Crosswalk-first canonical IDs</small>
        </div>
        <div>
          <FileKey2 size={18} aria-hidden="true" />
          <span>Rights review</span>
          <strong>Required</strong>
          <small>Before bulk collection</small>
        </div>
        <div>
          <Radio size={18} aria-hidden="true" />
          <span>Freshness SLA</span>
          <strong>Not started</strong>
          <small>Set after vendor selection</small>
        </div>
      </section>

      <section className="source-plan" aria-labelledby="source-plan-title">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">RECOMMENDED STACK</span>
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
                      {row.status === 'Open' ? <CheckCircle2 size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
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
          <strong>Public access does not equal commercial model rights.</strong>
          <p>Every production agreement must permit historical storage, ML training, derived probability display, corrections, and investment-oriented use.</p>
        </div>
      </section>
    </main>
  )
}
