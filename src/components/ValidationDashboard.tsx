import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  LoaderCircle,
  ShieldX,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface ValidationCell {
  role: 'hitter' | 'pitcher'
  horizonMonths: number
  rows: number
  events: number
  candidateBrier: number
  baselineBrier: number
  ece: number
  calibrationSlope: number
  observedExpected: number
}

interface ModelStatusResponse {
  schemaVersion: 'model-status/v1'
  status: string
  releaseEligible: false
  asOf: string
  coverage: {
    externalSnapshots: number
    externalPlayers: number
    predictionOnly2025: number
    predictionRows: number
  }
  headline: {
    sufficientCells: number
    positiveBrierCells: number
    pairedBrierImprovement: number
    pairedBrierLow: number
    pairedBrierHigh: number
    ecePassedCells: number
    eceRequiredCells: number
  }
  failedReasons: string[]
  cells: ValidationCell[]
  disclosures: string[]
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

export function ValidationDashboard() {
  const [status, setStatus] = useState<ModelStatusResponse | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/model-status', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Model status unavailable')
        const body = (await response.json()) as ModelStatusResponse
        if (body.schemaVersion !== 'model-status/v1') throw new Error('Unexpected model status')
        setStatus(body)
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setError(true)
      })
    return () => controller.abort()
  }, [])

  const chartData = status?.cells.map((cell) => ({
    cohort: `${cell.role === 'hitter' ? 'H' : 'P'} · ${cell.horizonMonths}m`,
    candidate: cell.candidateBrier,
    baseline: cell.baselineBrier,
  })) ?? []

  return (
    <main className="workspace-page validation-dashboard">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">MEASURED MODEL EVIDENCE</span>
          <h1>Validation</h1>
          <p>External performance, calibration, population shift, and the current release decision.</p>
        </div>
        <span className="build-badge build-badge--warning"><ShieldX size={14} aria-hidden="true" /> Not release eligible</span>
      </header>

      {!status && !error ? (
        <div className="validation-loading" role="status"><LoaderCircle className="spin" size={20} /> Loading frozen report</div>
      ) : null}
      {error ? (
        <div className="empty-state empty-state--error" role="alert"><AlertTriangle size={22} /><strong>Validation report unavailable</strong></div>
      ) : null}

      {status ? (
        <>
          <section className="validation-kpis" aria-label="External evaluation summary">
            <div><span>EXTERNAL PLAYERS</span><strong>{status.coverage.externalPlayers.toLocaleString()}</strong><small>{status.coverage.externalSnapshots.toLocaleString()} snapshots</small></div>
            <div><span>BRIER WINS</span><strong>{status.headline.positiveBrierCells}/{status.headline.sufficientCells}</strong><small>candidate vs censoring-aware baseline</small></div>
            <div><span>PAIRED IMPROVEMENT</span><strong>{percent(status.headline.pairedBrierImprovement)}</strong><small>95% CI {percent(status.headline.pairedBrierLow)}–{percent(status.headline.pairedBrierHigh)}</small></div>
            <div><span>ECE GATE</span><strong>{status.headline.ecePassedCells}/{status.headline.sufficientCells}</strong><small>{status.headline.eceRequiredCells} cells required</small></div>
          </section>

          <div className="validation-layout">
            <section className="validation-chart-panel" aria-labelledby="brier-chart-title">
              <div className="section-heading-row">
                <div><span className="eyebrow">LOWER IS BETTER</span><h2 id="brier-chart-title">Brier score by role and horizon</h2></div>
                <FlaskConical size={19} aria-hidden="true" />
              </div>
              <div className="validation-chart" role="img" aria-label="Candidate and baseline Brier score comparison">
                <ResponsiveContainer width="100%" height="100%" minWidth={320} minHeight={300}>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#e4e7e5" strokeDasharray="2 5" vertical={false} />
                    <XAxis dataKey="cohort" axisLine={false} tickLine={false} tick={{ fill: '#69716f', fontSize: 10 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#69716f', fontSize: 10 }} tickFormatter={(value) => Number(value).toFixed(2)} />
                    <Tooltip formatter={(value) => Number(value).toFixed(4)} />
                    <Legend />
                    <Bar dataKey="candidate" name="Candidate" fill="#147965" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="baseline" name="Baseline" fill="#aeb8b4" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="release-decision" aria-labelledby="release-title">
              <div className="section-heading-row">
                <div><span className="eyebrow">PROMOTION DECISION</span><h2 id="release-title">Why the model stays in research</h2></div>
                <ShieldX size={19} aria-hidden="true" />
              </div>
              <div className="decision-list">
                <div className="is-pass"><CheckCircle2 size={17} /><span><strong>Predictive skill</strong><small>Positive Brier improvement in all eight sufficient cells.</small></span></div>
                <div className="is-fail"><AlertTriangle size={17} /><span><strong>Calibration coverage</strong><small>ECE passed five of eight cells; six were required.</small></span></div>
                <div className="is-fail"><AlertTriangle size={17} /><span><strong>Population shift</strong><small>Unseen-category and stability admission gates failed.</small></span></div>
                <div className="is-fail"><AlertTriangle size={17} /><span><strong>Prospective evidence</strong><small>The test is retrospective and 60-month outcomes are not mature.</small></span></div>
              </div>
              <div className="validation-disclosures">
                {status.disclosures.map((disclosure) => <p key={disclosure}>{disclosure}</p>)}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </main>
  )
}
