// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CareerForecastArcPoint } from '../domain/forecast'
import { CareerArcChart } from './CareerArcChart'

vi.mock('recharts', async () => {
  const React = await import('react')

  return {
    CartesianGrid: () => null,
    ComposedChart: ({ children, data }: { children: React.ReactNode; data: unknown }) => (
      <div data-testid="composed-chart" data-chart={JSON.stringify(data)}>{children}</div>
    ),
    ErrorBar: (props: { dataKey: string; direction: string; width: number }) => (
      <i
        data-testid="error-bar"
        data-key={props.dataKey}
        data-direction={props.direction}
        data-width={props.width}
      />
    ),
    Line: (props: { dataKey: string; connectNulls: boolean }) => (
      <i
        data-testid="line"
        data-key={props.dataKey}
        data-connect-nulls={String(props.connectNulls)}
      />
    ),
    ReferenceLine: () => null,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Scatter: ({ children, data, dataKey }: {
      children: React.ReactNode
      data: unknown
      dataKey: string
    }) => (
      <div data-testid="scatter" data-key={dataKey} data-points={JSON.stringify(data)}>{children}</div>
    ),
    Tooltip: ({ content }: { content: React.ReactElement<Record<string, unknown>> }) => React.cloneElement(content, {
      active: true,
      label: 37,
      payload: [{
        payload: {
          kind: 'terminal',
          age: 37,
          p10: 10,
          p25: 24,
          p50: 30,
          p75: 42,
          p90: 55,
          outerError: [20, 25],
          innerError: [6, 12],
        },
      }],
    }),
    XAxis: () => null,
    YAxis: () => null,
  }
})

const arc: CareerForecastArcPoint[] = [
  { age: 33, actual: 18.4, p10: 18.4, p25: 18.4, p50: 18.4, p75: 18.4, p90: 18.4 },
  { age: 32, actual: 14.2, p10: 14.2, p25: 14.2, p50: 14.2, p75: 14.2, p90: 14.2 },
  { age: 37, actual: null, p10: 10, p25: 24, p50: 30, p75: 42, p90: 55 },
]

afterEach(cleanup)

describe('CareerArcChart', () => {
  it('separates recorded history from discrete terminal distributions without inventing an aging path', () => {
    render(<CareerArcChart data={arc} currentAge={33} />)

    expect(JSON.parse(screen.getByTestId('composed-chart').getAttribute('data-chart') ?? 'null')).toEqual([
      { kind: 'recorded', age: 32, actual: 14.2 },
      { kind: 'recorded', age: 33, actual: 18.4 },
      { kind: 'recorded', age: 37, actual: null },
    ])
    expect(JSON.parse(screen.getByTestId('scatter').getAttribute('data-points') ?? 'null')).toEqual([{
      kind: 'terminal',
      age: 37,
      p10: 10,
      p25: 24,
      p50: 30,
      p75: 42,
      p90: 55,
      outerError: [20, 25],
      innerError: [6, 12],
    }])
  })

  it('renders actuals as the only line and the future endpoint as a box-and-whisker mark', () => {
    render(<CareerArcChart data={arc} currentAge={33} />)

    expect(screen.getAllByTestId('line')).toHaveLength(1)
    expect(screen.getByTestId('line')).toHaveAttribute('data-key', 'actual')
    expect(screen.getByTestId('line')).toHaveAttribute('data-connect-nulls', 'false')
    expect(screen.getByTestId('scatter')).toHaveAttribute('data-key', 'p50')
    expect(screen.getAllByTestId('error-bar')).toHaveLength(2)
    expect(screen.getAllByTestId('error-bar').map((node) => node.getAttribute('data-key')))
      .toEqual(['outerError', 'innerError'])
  })

  it('states the terminal quantiles in both the accessible chart name and tooltip', () => {
    render(<CareerArcChart data={arc} currentAge={33} />)

    expect(screen.getByRole('img')).toHaveAccessibleName(
      /Recorded cumulative WAR through age 33: 18\.4 WAR\..*Discrete terminal estimate at age 37: P10 10\.0, P25 24\.0, median 30\.0, P75 42\.0, and P90 55\.0 WAR\..*not age-by-age projection paths\./,
    )
    expect(screen.getByText('Terminal age 37')).toBeInTheDocument()
    expect(screen.getByText('Median: 30.0 WAR')).toBeInTheDocument()
    expect(screen.getByText('P25–P75: 24.0–42.0 WAR')).toBeInTheDocument()
    expect(screen.getByText('P10–P90: 10.0–55.0 WAR')).toBeInTheDocument()
  })
})
