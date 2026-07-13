import {
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CareerForecastArcPoint } from '../domain/forecast'

interface CareerArcChartProps {
  data: CareerForecastArcPoint[]
  currentAge: number | null
}

interface RecordedCareerDatum {
  kind: 'recorded'
  age: number
  actual: number | null
}

export interface TerminalCareerDatum {
  kind: 'terminal'
  age: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  outerError: [number, number]
  innerError: [number, number]
}

type CareerChartDatum = RecordedCareerDatum | TerminalCareerDatum

interface CareerTooltipProps {
  active?: boolean
  label?: number | string
  payload?: Array<{
    dataKey?: string | number
    value?: number | [number, number]
    payload?: CareerChartDatum
  }>
}

function buildCareerArcSeries(data: CareerForecastArcPoint[]) {
  const ordered = data.toSorted((left, right) => left.age - right.age)
  const recorded: RecordedCareerDatum[] = ordered.map((point) => ({
    kind: 'recorded',
    age: point.age,
    actual: point.actual,
  }))
  const terminal: TerminalCareerDatum[] = ordered
    .filter((point) => point.actual === null)
    .map((point) => ({
      kind: 'terminal',
      age: point.age,
      p10: point.p10,
      p25: point.p25,
      p50: point.p50,
      p75: point.p75,
      p90: point.p90,
      outerError: [point.p50 - point.p10, point.p90 - point.p50],
      innerError: [point.p50 - point.p25, point.p75 - point.p50],
    }))

  return { recorded, terminal }
}

function CareerTooltip({ active, label, payload }: CareerTooltipProps) {
  if (!active || !payload?.length) return null

  const terminal = payload.find((item) => item.payload?.kind === 'terminal')?.payload
  if (terminal?.kind === 'terminal') {
    return (
      <div className="chart-tooltip">
        <strong>Terminal age {terminal.age}</strong>
        <span>Median: {terminal.p50.toFixed(1)} WAR</span>
        <span>P25–P75: {terminal.p25.toFixed(1)}–{terminal.p75.toFixed(1)} WAR</span>
        <span>P10–P90: {terminal.p10.toFixed(1)}–{terminal.p90.toFixed(1)} WAR</span>
        <span>Terminal career estimate</span>
      </div>
    )
  }

  const recorded = payload.find((item) => item.payload?.kind === 'recorded')?.payload
  if (recorded?.kind !== 'recorded' || recorded.actual === null) return null

  return (
    <div className="chart-tooltip">
      <strong>Age {label ?? recorded.age}</strong>
      <span>Recorded cumulative: {recorded.actual.toFixed(1)} WAR</span>
    </div>
  )
}

function accessibleDescription(recorded: RecordedCareerDatum[], terminal: TerminalCareerDatum[]) {
  const actualHistory = recorded.filter(
    (point): point is RecordedCareerDatum & { actual: number } => point.actual !== null,
  )
  const latestActual = actualHistory.at(-1)
  const recordedText = latestActual
    ? `Recorded cumulative WAR through age ${latestActual.age}: ${latestActual.actual.toFixed(1)} WAR.`
    : 'No recorded cumulative WAR is present.'
  const terminalText = terminal.length > 0
    ? terminal.map((point) => (
        `Discrete terminal estimate at age ${point.age}: P10 ${point.p10.toFixed(1)}, `
        + `P25 ${point.p25.toFixed(1)}, median ${point.p50.toFixed(1)}, `
        + `P75 ${point.p75.toFixed(1)}, and P90 ${point.p90.toFixed(1)} WAR.`
      )).join(' ')
    : 'No terminal career estimate is present.'

  return `${recordedText} ${terminalText} Terminal estimates are not age-by-age projection paths.`
}

export function CareerArcChart({ data, currentAge }: CareerArcChartProps) {
  const { recorded, terminal } = buildCareerArcSeries(data)
  const ages = data.map((point) => point.age)
  const ageDomain: [number | 'dataMin', number | 'dataMax'] = ages.length > 0
    ? [Math.min(...ages), Math.max(...ages)]
    : ['dataMin', 'dataMax']

  return (
    <div
      className="career-chart"
      role="img"
      aria-label={accessibleDescription(recorded, terminal)}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={240}>
        <ComposedChart data={recorded} margin={{ top: 12, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 5" vertical={false} />
          <XAxis
            dataKey="age"
            type="number"
            domain={ageDomain}
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            minTickGap={22}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            width={44}
            tickFormatter={(value) => `${value}`}
          />
          <Tooltip content={<CareerTooltip />} cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }} />
          {currentAge === null ? null : (
            <ReferenceLine
              x={currentAge}
              stroke="var(--muted)"
              strokeDasharray="4 4"
              label={{ value: 'NOW', position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 10 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="actual"
            name="Recorded cumulative WAR"
            stroke="var(--orange)"
            strokeWidth={2.5}
            dot={{ r: 3, fill: 'var(--orange)' }}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Scatter
            data={terminal}
            dataKey="p50"
            name="Terminal career WAR distribution"
            shape="diamond"
            fill="var(--green)"
            stroke="var(--green-dark)"
            isAnimationActive={false}
          >
            <ErrorBar
              dataKey="outerError"
              direction="y"
              width={7}
              stroke="var(--green-dark)"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
            <ErrorBar
              dataKey="innerError"
              direction="y"
              width={0}
              stroke="var(--green)"
              strokeWidth={7}
              isAnimationActive={false}
            />
          </Scatter>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
