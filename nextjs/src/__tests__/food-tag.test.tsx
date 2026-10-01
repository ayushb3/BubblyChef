/**
 * Food tag (issue #741, Goal 3 signature #6): Chip in expiry mode. Days until
 * expiry -> tone + short label on the theme-invariant expiry tokens; the
 * expiring tone droops once (not under reduced motion) and only for real
 * expiry tags. `chip-aria.test.tsx` keeps guarding the toggle semantics.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'

let mockReduced = false

jest.mock('framer-motion', () => {
  const PASS = ['initial', 'animate', 'exit', 'transition', 'whileTap']
  function stub(Tag: string) {
    function MotionStub({
      children,
      variants,
      ...rest
    }: Record<string, unknown> & { children?: React.ReactNode; variants?: Record<string, unknown> }) {
      const dom = Object.fromEntries(Object.entries(rest).filter(([k]) => !PASS.includes(k)))
      // surface the reaction (if any) so the test can see what would play
      return React.createElement(
        Tag,
        { ...dom, ...(variants ? { 'data-reaction': JSON.stringify(variants.play) } : {}) },
        children,
      )
    }
    MotionStub.displayName = `motion.${Tag}`
    return MotionStub
  }
  return {
    motion: new Proxy({} as Record<string, unknown>, {
      // cache per tag: a fresh component type each render would remount the subtree
      get: (t, tag: string) => (t[tag] ??= stub(tag)),
    }),
    useReducedMotion: () => mockReduced,
  }
})

import Chip from '@/components/ui/Chip'
import { expiryTag } from '@/lib/food-tag'

beforeEach(() => {
  mockReduced = false
})

describe('expiryTag', () => {
  it.each([
    [0, 'expiring', 'Today'],
    [1, 'expiring', '1 day'],
    [3, 'expiring', '3 days'],
    [4, 'fresh', '4 days'],
    [12, 'fresh', '12 days'],
    [-1, 'expired', 'Expired'],
    [-30, 'expired', 'Expired'],
  ])('%i days -> %s "%s"', (days, tone, label) => {
    expect(expiryTag(days)).toEqual({ tone, label })
  })

  it('has no tag when the expiry is unknown', () => {
    expect(expiryTag(null)).toBeNull()
    expect(expiryTag(undefined)).toBeNull()
  })
})

describe('Chip as a food tag', () => {
  it('appends the short label after the name and takes the matching tone', () => {
    const { rerender, container } = render(<Chip expiresInDays={0}>Romaine</Chip>)
    const root = () => container.firstElementChild as HTMLElement
    expect(root()).toHaveTextContent('Romaine · Today')
    expect(root()).toHaveAttribute('data-tone', 'expiring')
    expect(root().style.background).toContain('--color-expiring')

    rerender(<Chip expiresInDays={-2}>Bananas</Chip>)
    expect(root()).toHaveTextContent('Bananas · Expired')
    expect(root()).toHaveAttribute('data-tone', 'expired')

    rerender(<Chip expiresInDays={9}>Feta</Chip>)
    expect(root()).toHaveTextContent('Feta · 9 days')
    expect(root()).toHaveAttribute('data-tone', 'fresh')
  })

  it('without an expiry it stays a plain chip', () => {
    const { container } = render(<Chip expiresInDays={null}>Lemons</Chip>)
    expect(container.firstElementChild).toHaveTextContent(/^Lemons$/)
  })

  it('droops once on the expiring tone', () => {
    const { container } = render(<Chip expiresInDays={1}>Bread</Chip>)
    const play = JSON.parse((container.firstElementChild as HTMLElement).getAttribute('data-reaction')!)
    expect(play.rotate).not.toBe(0)
    expect(play.y).toBeGreaterThan(0)
  })

  it('has no droop on fresh or expired tags', () => {
    const { container, rerender } = render(<Chip expiresInDays={8}>Kale</Chip>)
    expect(container.firstElementChild).not.toHaveAttribute('data-reaction')
    rerender(<Chip expiresInDays={-1}>Milk</Chip>)
    expect(container.firstElementChild).not.toHaveAttribute('data-reaction')
  })

  it('has no droop on a plain yellow chip (recipe meta uses the expiring tone for cook time)', () => {
    const { container } = render(<Chip tone="expiring">30 min</Chip>)
    expect(container.firstElementChild).not.toHaveAttribute('data-reaction')
  })

  it('with reduced motion the expiring tag plays no droop', () => {
    mockReduced = true
    const { container } = render(<Chip expiresInDays={1}>Bread</Chip>)
    const play = JSON.parse((container.firstElementChild as HTMLElement).getAttribute('data-reaction')!)
    expect(play.rotate).toBe(0)
    expect(play.y).toBe(0)
    expect(play.opacity).toBe(1)
  })

  it('is not a button, and a selectable tag is a 44px-target button with a tick', () => {
    const { rerender } = render(<Chip expiresInDays={2}>Eggs</Chip>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(
      <Chip onClick={jest.fn()} selected pressed>
        Romaine
      </Chip>,
    )
    const btn = screen.getByRole('button', { name: 'Romaine' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn.className).toContain('min-h-[44px]')
    expect(screen.getByTestId('chip-tick')).toBeInTheDocument()
  })

  it('shows no tick when not selected', () => {
    render(<Chip onClick={jest.fn()}>Lemons</Chip>)
    expect(screen.queryByTestId('chip-tick')).not.toBeInTheDocument()
  })
})
