/**
 * The bottom nav (issue #750, board A of the Kitchen Home canvas): Kitchen,
 * Chat, Recipes, Scan. The Pantry tab is gone; the kitchen is the way in.
 */
import React from 'react'
import { render, screen, within } from '@testing-library/react'
import BottomNav from '@/components/layout/BottomNav'

let mockPathname = '/'
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

beforeEach(() => {
  mockPathname = '/'
})

function links() {
  const nav = screen.getByRole('navigation')
  return within(nav).getAllByRole('link')
}

describe('BottomNav', () => {
  it('shows Kitchen, Chat, Recipes and Scan, in that order', () => {
    render(<BottomNav />)
    expect(links().map((l) => l.textContent)).toEqual(['Kitchen', 'Chat', 'Recipes', 'Scan'])
  })

  it('points Kitchen home, and Scan at the scan page', () => {
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Kitchen' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/chat')
    expect(screen.getByRole('link', { name: 'Recipes' })).toHaveAttribute('href', '/recipes')
    expect(screen.getByRole('link', { name: 'Scan' })).toHaveAttribute('href', '/scan')
  })

  it('has no item that points at /pantry', () => {
    render(<BottomNav />)
    for (const link of links()) expect(link.getAttribute('href')).not.toMatch(/^\/pantry/)
    expect(screen.queryByRole('link', { name: /pantry/i })).not.toBeInTheDocument()
  })

  it('marks the current page, and only it', () => {
    mockPathname = '/recipes/abc'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Recipes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Kitchen' })).not.toHaveAttribute('aria-current')
  })

  it('marks Kitchen on the home page only, not on every path', () => {
    mockPathname = '/'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Kitchen' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Scan' })).not.toHaveAttribute('aria-current')
  })

  it('keeps the tour targets for Chat and Recipes', () => {
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('data-tour', 'nav-chat')
    expect(screen.getByRole('link', { name: 'Recipes' })).toHaveAttribute('data-tour', 'nav-recipes')
  })

  it('gives every item a 44px target', () => {
    render(<BottomNav />)
    for (const link of links()) expect(link.className).toContain('min-h-[44px]')
  })

  it('is hidden on the login page', () => {
    mockPathname = '/login'
    const { container } = render(<BottomNav />)
    expect(container).toBeEmptyDOMElement()
  })
})
