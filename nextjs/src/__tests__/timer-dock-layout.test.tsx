/**
 * Issue #664 — the expanded dock stacks one full-width row per timer instead
 * of squeezing every badge into one row (which clipped "+2 min" and pushed
 * Dismiss off-screen at 375px). jsdom can't measure layout, so these assert
 * the layout contract (classes and data hooks); the real fit is proven by
 * the in-page hit-test in the PR's `verify` run.
 */

import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import TimerDock from '@/components/timers/TimerDock'
import { useCookingTimers, type CookingTimer } from '@/lib/useCookingTimers'

jest.mock('@/lib/useCookingTimers', () => {
  const actual = jest.requireActual('@/lib/useCookingTimers')
  return { ...actual, useCookingTimers: jest.fn() }
})

const mockedUseCookingTimers = useCookingTimers as unknown as jest.Mock

const LONG = 'Simmer the tomato sauce until thick'

function makeTimers(n: number): CookingTimer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    label: `${LONG} ${i + 1}`,
    durationSeconds: 600,
    remainingSeconds: 545,
    status: 'running' as const,
  }))
}

function setup(n: number) {
  const dismiss = jest.fn()
  const extend = jest.fn()
  mockedUseCookingTimers.mockReturnValue({
    timers: makeTimers(n),
    start: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    dismiss,
    extend,
  })
  render(<TimerDock />)
  return { dismiss, extend }
}

const expand = () => fireEvent.click(screen.getByLabelText('Expand timers'))

describe('TimerDock layout (issue #664)', () => {
  it('collapsed is a single row of non-shrinking badges', () => {
    setup(3)
    expect(screen.getByTestId('timer-dock-list')).toHaveAttribute('data-layout', 'row')
    for (const id of ['t1', 't2', 't3']) {
      expect(screen.getByTestId(`timer-badge-${id}`).className).toContain('flex-shrink-0')
    }
  })

  it('expanded stacks the timers', () => {
    setup(3)
    expand()
    const list = screen.getByTestId('timer-dock-list')
    expect(list).toHaveAttribute('data-layout', 'stack')
    expect(list.className).toContain('flex-col')
    expect(list.className).toContain('max-h-[50vh]')
    expect(list.className).toContain('overflow-y-auto')
  })

  it('the toggle meets the 44px target in both layouts', () => {
    setup(3)
    expect(screen.getByLabelText('Expand timers').className).toContain('min-h-[44px]')
    expect(screen.getByLabelText('Expand timers').className).toContain('min-w-[44px]')
    expand()
    expect(screen.getByLabelText('Collapse timers').className).toContain('min-h-[44px]')
    expect(screen.getByLabelText('Collapse timers').className).toContain('min-w-[44px]')
  })

  it('every control is nowrap, non-shrinking and 44px; labels truncate without a max width', () => {
    setup(3)
    expand()
    for (let i = 1; i <= 3; i++) {
      const label = `${LONG} ${i}`
      const badge = screen.getByTestId(`timer-badge-t${i}`)
      for (const name of [`Pause ${label} timer`, `Add 2 minutes to ${label} timer`, `Dismiss ${label} timer`]) {
        const btn = within(badge).getByLabelText(name)
        expect(btn.className).toContain('whitespace-nowrap')
        expect(btn.className).toContain('flex-shrink-0')
        expect(btn.className).toContain('min-h-[44px]')
        expect(btn.className).toContain('min-w-[44px]')
      }
      const labelEl = within(badge).getByText(label)
      expect(labelEl.className).toContain('min-w-0')
      expect(labelEl.className).toContain('truncate')
      expect(labelEl.className).not.toContain('max-w-[90px]')
    }
  })

  it("wires the third timer's +2 min and Dismiss to its own id", () => {
    const { dismiss, extend } = setup(3)
    expand()
    fireEvent.click(screen.getByLabelText(`Add 2 minutes to ${LONG} 3 timer`))
    expect(extend).toHaveBeenCalledWith('t3', 120)
    fireEvent.click(screen.getByLabelText(`Dismiss ${LONG} 3 timer`))
    expect(dismiss).toHaveBeenCalledWith('t3')
  })

  it('renders one row per timer (four timers, four rows)', () => {
    setup(4)
    expand()
    expect(screen.getAllByTestId(/^timer-badge-/)).toHaveLength(4)
  })
})
