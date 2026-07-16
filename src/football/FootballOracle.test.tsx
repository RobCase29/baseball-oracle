// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { FootballOracle } from './FootballOracle'

afterEach(cleanup)

describe('Football Oracle universe navigation', () => {
  it('opens on the NFL QB board and moves to a fail-closed college QB board', () => {
    render(<FootballOracle />)

    const table = screen.getByRole('table')
    const nflButton = screen.getByRole('button', { name: 'NFL / Dynasty' })
    const collegeButton = screen.getByRole('button', { name: 'College / Devy' })

    expect(nflButton).toHaveAttribute('aria-pressed', 'true')
    expect(within(table).getByText('Jared Goff')).toBeInTheDocument()
    expect(within(table).queryByText('Arch Manning')).not.toBeInTheDocument()
    expect(screen.getByText('Completed-season evidence')).toBeInTheDocument()
    expect(screen.getByText(/Ordinal signals, not probabilities/u)).toBeInTheDocument()

    fireEvent.click(collegeButton)

    expect(collegeButton).toHaveAttribute('aria-pressed', 'true')
    expect(nflButton).toHaveAttribute('aria-pressed', 'false')
    expect(within(table).getByText('Arch Manning')).toBeInTheDocument()
    expect(within(table).queryByText('Jared Goff')).not.toBeInTheDocument()

    const archRow = within(table).getByText('Arch Manning').closest('tr')
    expect(archRow).not.toBeNull()
    expect(within(archRow!).getByText('Withheld')).toBeInTheDocument()
    expect(within(archRow!).getByText('Coverage building')).toBeInTheDocument()
    expect(screen.getByText('College feature feed pending')).toBeInTheDocument()
    expect(screen.getByText(/model rank stays withheld/u)).toBeInTheDocument()
  })

  it('keeps position and search filtering inside the selected college universe', () => {
    render(<FootballOracle />)

    fireEvent.click(screen.getByRole('button', { name: 'College / Devy' }))
    fireEvent.click(screen.getByRole('button', { name: 'WR' }))

    const table = screen.getByRole('table')
    expect(within(table).getByText('Jeremiah Smith')).toBeInTheDocument()
    expect(within(table).queryByText("Ja'Marr Chase")).not.toBeInTheDocument()
    expect(within(table).queryByText('Arch Manning')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search football players' }), {
      target: { value: 'Texas' },
    })

    expect(within(table).getByText('Cam Coleman')).toBeInTheDocument()
    expect(within(table).queryByText('Jeremiah Smith')).not.toBeInTheDocument()
    expect(within(table).queryByText('Dakorien Moore')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'NFL / Dynasty' }))

    expect(screen.getByRole('textbox', { name: 'Search football players' })).toHaveValue('')
    expect(within(table).getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(within(table).queryByText('Cam Coleman')).not.toBeInTheDocument()
  })
})
