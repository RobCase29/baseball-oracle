import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CareerForecastArcPoint } from '../domain/forecast'

interface CareerArcChartProps {
  data: CareerForecastArcPoint[]
  currentAge: number | null
}

interface CareerTooltipProps {
  active?: boolean
  label?: number
  payload?: Array<{
    dataKey?: string | number
    value?: number | [number, number]
  }>
}

function CareerTooltip({ active, label, payload }: CareerTooltipProps) {
  if (!active || !payload?.length) return null

  const median = payload.find((item) => item.dataKey === 'p50')?.value
  const range = payload.find((item) => item.dataKey === 'range')?.value
  const actual = payload.find((item) => item.dataKey === 'actual')?.value

  return (
    <div className="chart-tooltip">
      <strong>Age {label}</strong>
      {typeof median === 'number' ? <span>Median: {median.toFixed(1)} WAR</span> : null}
      {Array.isArray(range) ? (
        <span>
          P10–P90: {range[0].toFixed(1)}–{range[1].toFixed(1)} WAR
        </span>
      ) : null}
      {typeof actual === 'number' ? <span>Recorded: {actual.toFixed(1)} WAR</span> : null}
    </div>
  )
}

export function CareerArcChart({ data, currentAge }: CareerArcChartProps) {
  const chartData = data.map((point) => ({
    ...point,
    range: [point.p10, point.p90],
  }))

  return (
    <div className="career-chart" role="img" aria-label="Recorded cumulative WAR and terminal career WAR distribution by age">
      <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={240}>
        <ComposedChart data={chartData} margin={{ top: 12, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#e4e7e5" strokeDasharray="2 5" vertical={false} />
          <XAxis
            dataKey="age"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#69716f', fontSize: 11 }}
            minTickGap={22}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#69716f', fontSize: 11 }}
            width={44}
            tickFormatter={(value) => `${value}`}
          />
          <Tooltip content={<CareerTooltip />} cursor={{ stroke: '#9ca7a3', strokeDasharray: '3 3' }} />
          {currentAge === null ? null : (
            <ReferenceLine
              x={currentAge}
              stroke="#8a9491"
              strokeDasharray="4 4"
              label={{ value: 'NOW', position: 'insideTopLeft', fill: '#69716f', fontSize: 10 }}
            />
          )}
          <Area
            type="monotone"
            dataKey="range"
            stroke="none"
            fill="#b8d9d1"
            fillOpacity={0.48}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="p50"
            stroke="#147965"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="#ca5f3c"
            strokeWidth={2.5}
            dot={{ r: 3, fill: '#ca5f3c' }}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
