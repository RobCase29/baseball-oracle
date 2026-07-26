// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { GlobalBoardSearch } from './GlobalBoardSearch'

afterEach(cleanup)

describe('GlobalBoardSearch', () => {
  it('makes the full-universe scope explicit and supports quick focus', () => {
    const onChange = vi.fn()
    render(
      <GlobalBoardSearch
        lens="market"
        value=""
        loading={false}
        resultCount={null}
        onChange={onChange}
      />,
    )

    const search = screen.getByRole('searchbox', {
      name: 'Search every subject',
    })
    expect(screen.getByText('All labels · all sports')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '/' })
    expect(search).toHaveFocus()
    fireEvent.change(search, { target: { value: 'Michael Jordan' } })
    expect(onChange).toHaveBeenCalledWith('Michael Jordan')
  })

  it('announces result count and exposes a touch-friendly clear action', () => {
    const onChange = vi.fn()
    render(
      <GlobalBoardSearch
        lens="market"
        value="Michael Jordan"
        loading={false}
        resultCount={1}
        onChange={onChange}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('1 match')
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Clear search every subject',
      }),
    )
    expect(onChange).toHaveBeenCalledWith('')
  })
})
