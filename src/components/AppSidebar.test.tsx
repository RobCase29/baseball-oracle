// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AppSidebar } from './AppSidebar'

afterEach(cleanup)

describe('AppSidebar sport navigation', () => {
  it('keeps the Baseball controls and links to the isolated Football and hobby pages', () => {
    const onChangeView = vi.fn()

    render(
      <AppSidebar
        activeView="Board"
        collapsed={false}
        onChangeView={onChangeView}
        onToggleCollapsed={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Rankings' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Build a Binder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Model review' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Football' })).toHaveAttribute('href', '/football')
    expect(screen.getByRole('link', { name: 'Magnificent X' })).toHaveAttribute('href', '/hobby')

    fireEvent.click(screen.getByRole('button', { name: 'Model review' }))
    expect(onChangeView).toHaveBeenCalledWith('Model lab')

    fireEvent.click(screen.getByRole('button', { name: 'Build a Binder' }))
    expect(onChangeView).toHaveBeenCalledWith('Binder')
  })
})
