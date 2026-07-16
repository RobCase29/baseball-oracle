// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { FootballOracle } from './FootballOracle'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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

  it('loads exact KTC ranks while keeping Dynasty Daddy provider-default ranks directional', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: 'football-market-feed.v1',
      generatedAt: '2026-07-16T18:30:00.000Z',
      request: { universe: 'nfl', formatId: 'sf_12t_half_ppr_no_tep' },
      providers: [
        {
          provider: 'keeptradecut',
          label: 'KeepTradeCut Dynasty',
          status: 'available',
          sourceUrl: 'https://keeptradecut.com/dynasty-rankings',
          fetchedAt: '2026-07-16T18:30:00.000Z',
          rowCount: 464,
          errorCode: null,
          comparisonScope: 'exact_format',
          formatId: 'sf_12t_half_ppr_no_tep',
        },
        {
          provider: 'dynasty-daddy',
          label: 'Dynasty Daddy',
          status: 'available',
          sourceUrl: 'https://dynasty-daddy.com/fantasy-rankings',
          fetchedAt: '2026-07-16T18:30:00.000Z',
          rowCount: 610,
          errorCode: null,
          comparisonScope: 'provider_default_directional',
          formatId: 'dd_sf_provider_default',
        },
      ],
      rankings: [
        {
          provider: 'keeptradecut',
          providerLabel: 'KeepTradeCut Dynasty',
          providerPlayerId: 'ktc-1',
          name: 'Jared Goff',
          normalizedName: 'jaredgoff',
          universe: 'nfl',
          position: 'QB',
          requestedFormatId: 'sf_12t_half_ppr_no_tep',
          formatId: 'sf_12t_half_ppr_no_tep',
          comparisonScope: 'exact_format',
          positionRank: 12,
          positionUniverseSize: 64,
          positionPercentile: 82.53968253968253,
          overallRank: 40,
          value: 3500,
          tier: 5,
          sourceUrl: 'https://keeptradecut.com/dynasty-rankings',
          fetchedAt: '2026-07-16T18:30:00.000Z',
        },
        {
          provider: 'dynasty-daddy',
          providerLabel: 'Dynasty Daddy',
          providerPlayerId: 'jaredgoffqb',
          name: 'Jared Goff',
          normalizedName: 'jaredgoff',
          universe: 'nfl',
          position: 'QB',
          requestedFormatId: 'sf_12t_half_ppr_no_tep',
          formatId: 'dd_sf_provider_default',
          comparisonScope: 'provider_default_directional',
          positionRank: 14,
          positionUniverseSize: 62,
          positionPercentile: 78.68852459016394,
          overallRank: 44,
          value: 3200,
          tier: null,
          sourceUrl: 'https://dynasty-daddy.com/fantasy-rankings',
          fetchedAt: '2026-07-16T18:30:00.000Z',
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    render(<FootballOracle />)

    await waitFor(() => {
      expect(screen.getByText(/2 authorized sources live from the shared cache/u)).toBeInTheDocument()
    })

    const goffRow = within(screen.getByRole('table')).getByText('Jared Goff').closest('tr')
    expect(goffRow).not.toBeNull()
    expect(within(goffRow!).getByText('82.5 · 1 src')).toBeInTheDocument()

    const providerRanks = screen.getByLabelText('Provider ranks for selected player')
    expect(within(providerRanks).getByText('KeepTradeCut Dynasty')).toBeInTheDocument()
    expect(within(providerRanks).getByText('Dynasty Daddy')).toBeInTheDocument()
    expect(within(providerRanks).getByText('Provider default · directional only')).toBeInTheDocument()
  })
})
