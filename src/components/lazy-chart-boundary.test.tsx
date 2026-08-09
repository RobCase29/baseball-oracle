// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { lazy, Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LazyChartBoundary } from './LazyChartBoundary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('LazyChartBoundary', () => {
  it('contains a rejected chart import and preserves the surrounding dossier', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const RejectedChart = lazy(() => Promise.reject(
      new TypeError("Cannot read properties of undefined (reading 'toString')"),
    ))

    render(
      <main>
        <p>Career forecast summary</p>
        <LazyChartBoundary fallback={<p role="status">Interactive chart unavailable</p>}>
          <Suspense fallback={<p>Loading chart</p>}>
            <RejectedChart />
          </Suspense>
        </LazyChartBoundary>
        <p>Advanced forecast details</p>
      </main>,
    )

    expect(await screen.findByRole('status')).toHaveTextContent('Interactive chart unavailable')
    expect(screen.getByText('Career forecast summary')).toBeInTheDocument()
    expect(screen.getByText('Advanced forecast details')).toBeInTheDocument()
  })
})
