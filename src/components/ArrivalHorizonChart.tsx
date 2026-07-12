import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ResearchArrivalHorizon } from '../domain/forecast'

interface ArrivalHorizonChartProps {
  horizons: ResearchArrivalHorizon[]
}

interface ArrivalTooltipProps {
  active?: boolean
  label?: number
  payload?: Array<{ dataKey?: string | number; value?: number }>
}

function ArrivalTooltip({ active, label, payload }: ArrivalTooltipProps) {
  if (!active || !payload?.length) return null
  const candidate = payload.find((item) => item.dataKey === 'candidate')?.value
  const baseline = payload.find((item) => item.dataKey === 'baseline')?.value

  return (
    <div className="chart-tooltip">
      <strong>{label} months</strong>
      {typeof candidate === 'number' ? <span>Candidate: {candidate.toFixed(1)}%</span> : null}
      {typeof baseline === 'number' ? <span>Baseline: {baseline.toFixed(1)}%</span> : null}
    </div>
  )
}

export function ArrivalHorizonChart({ horizons }: ArrivalHorizonChartProps) {
  const data = horizons.map((horizon) => ({
    months: horizon.months,
    candidate: horizon.probability * 100,
    baseline: horizon.baselineProbability * 100,
  }))

  return (
    <div className="arrival-chart" role="img" aria-label="Cumulative MLB arrival probability by horizon">
      <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={230}>
        <LineChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#e4e7e5" strokeDasharray="2 5" vertical={false} />
          <XAxis dataKey="months" axisLine={false} tickLine={false} tick={{ fill: '#69716f', fontSize: 11 }} unit="m" />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: '#69716f', fontSize: 11 }} unit="%" domain={[0, 100]} />
          <Tooltip content={<ArrivalTooltip />} cursor={{ stroke: '#9ca7a3', strokeDasharray: '3 3' }} />
          <Line type="monotone" dataKey="candidate" stroke="#147965" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="baseline" stroke="#8a9491" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
