// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ModelLab } from './ModelLab'

afterEach(cleanup)

describe('Model Lab release language', () => {
  it('describes career evidence as a development holdout without stale locked-test metrics', () => {
    render(<ModelLab />)
    fireEvent.click(screen.getByRole('tab', { name: 'Career arc' }))

    expect(screen.getByText('Development holdout')).toBeInTheDocument()
    expect(screen.getByText(/retrospective descriptive evidence/u)).toBeInTheDocument()
    expect(screen.getByText('Current scoring refit')).toBeInTheDocument()
    expect(screen.getByText(/cannot inherit tournament metrics/u)).toBeInTheDocument()
    expect(screen.queryByText(/locked-test/u)).not.toBeInTheDocument()
    expect(screen.queryByText(/Brier 0\.0039/u)).not.toBeInTheDocument()
  })

  it('keeps Hall-caliber selection provisional and release-gated', () => {
    render(<ModelLab />)
    fireEvent.click(screen.getByRole('tab', { name: 'HOF-caliber tail' }))

    expect(screen.getByText('Provisional entrant selection')).toBeInTheDocument()
    expect(screen.getByText(/low-event development split/u)).toBeInTheDocument()
    expect(screen.getByText('Prospective track record')).toBeInTheDocument()
    expect(screen.getByText(/Required before any superiority or release claim/u)).toBeInTheDocument()
    expect(screen.getByText('Early Hall tail')).toBeInTheDocument()
    expect(screen.getByText(/P95\/P99 validation/u)).toBeInTheDocument()
    expect(screen.queryByText(/calibrated ensemble won/u)).not.toBeInTheDocument()
  })
})
