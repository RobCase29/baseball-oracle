// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ModelLab } from './ModelLab'

afterEach(cleanup)

describe('Model review release language', () => {
  it('explains career evidence without requiring model-development jargon', () => {
    render(<ModelLab />)
    fireEvent.click(screen.getByRole('tab', { name: 'Career arc' }))

    expect(screen.getByText('Historical test')).toBeInTheDocument()
    expect(screen.getByText(/not a live forward test/u)).toBeInTheDocument()
    expect(screen.getByText('Current player version')).toBeInTheDocument()
    expect(screen.getByText(/has not been independently tested/u)).toBeInTheDocument()
    expect(screen.queryByText(/locked-test/u)).not.toBeInTheDocument()
    expect(screen.queryByText(/Brier 0\.0039/u)).not.toBeInTheDocument()
    expect(screen.getByText('Standout-player test')).toBeInTheDocument()
    expect(screen.getByText(/only four qualifying players/u)).toBeInTheDocument()
    expect(screen.getByText('New forward test')).toBeInTheDocument()
  })

  it('keeps Hall-level selection provisional and release-gated', () => {
    render(<ModelLab />)
    fireEvent.click(screen.getByRole('tab', { name: 'Hall-level careers' }))

    expect(screen.getByText('Early model selection')).toBeInTheDocument()
    expect(screen.getByText(/Too few Hall-level events/u)).toBeInTheDocument()
    expect(screen.getByText('Forward track record')).toBeInTheDocument()
    expect(screen.getByText(/Required before any superiority or release claim/u)).toBeInTheDocument()
    expect(screen.getByText('Early Hall careers')).toBeInTheDocument()
    expect(screen.getByText(/better extreme-career ranges/u)).toBeInTheDocument()
    expect(screen.queryByText(/calibrated ensemble won/u)).not.toBeInTheDocument()
  })
})
