/**
 * Issue #848 — two things about where the timer dock sits in the app:
 *
 *  - a chip links back to the cook it belongs to (a meal cook-along's timer to
 *    `/meals/<id>/cook`; while a recipe is mid-cook, to that recipe's cook);
 *    a timer with no cook behind it (a quick-set "Pasta 10 min") is not a link;
 *  - the dock reserves its own space: it publishes its height as
 *    `--timer-dock-h` on the document root so pages pad their bottom by it, and
 *    the variable is 0 while no timer is showing.
 */

import React, { useRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { CookingTimersProvider, useCookingTimers } from '@/lib/useCookingTimers'
import TimerDock from '@/components/timers/TimerDock'
import {
  saveMealCookProgress,
  startMealCookSession,
} from '@/lib/meal-cook-session'
import { startGuidedCookSession, saveCookProgress } from '@/lib/cook-session'

function Starter({ onId }: { onId: (id: string) => void }) {
  const { start } = useCookingTimers()
  const ran = useRef(false)
  return (
    <button
      type="button"
      onClick={() => {
        if (ran.current) return
        ran.current = true
        onId(start('Simmer sauce', 600))
      }}
    >
      start
    </button>
  )
}

function mountWithTimer(): { id: string } {
  const box = { id: '' }
  render(
    <CookingTimersProvider>
      <Starter onId={(id) => (box.id = id)} />
      <TimerDock />
    </CookingTimersProvider>,
  )
  act(() => {
    screen.getByText('start').click()
  })
  return box
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.style.removeProperty('--timer-dock-h')
})

describe('timer chips link back to their cook (issue #848)', () => {
  it('a timer a meal cook-along started links to that meal cook', () => {
    // The session has to name the timer, so start it first, then record it.
    const box = { id: '' }
    render(
      <CookingTimersProvider>
        <Starter onId={(id) => (box.id = id)} />
        <TimerDock />
      </CookingTimersProvider>,
    )
    act(() => {
      screen.getByText('start').click()
    })
    const session = startMealCookSession('meal-7', ['d1'], 0, ['1:Simmer'])
    act(() => {
      saveMealCookProgress({
        ...session,
        steps: {
          'd1:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: box.id },
        },
      })
    })

    const link = screen.getByRole('link', { name: /simmer sauce/i })
    expect(link).toHaveAttribute('href', '/meals/meal-7/cook')
  })

  it('while a recipe is mid-cook, a timer links to that recipe cook', () => {
    startGuidedCookSession('r-lemon')
    saveCookProgress('r-lemon', 2)
    mountWithTimer()

    expect(screen.getByRole('link', { name: /simmer sauce/i })).toHaveAttribute(
      'href',
      '/recipes?resume=r-lemon',
    )
  })

  it('a timer with no cook behind it is not a link', () => {
    mountWithTimer()
    expect(screen.queryByRole('link', { name: /simmer sauce/i })).not.toBeInTheDocument()
    expect(screen.getByTestId(/timer-badge-/)).toBeInTheDocument()
  })
})

describe('a linked chip keeps truncating a long label (issue #848 review)', () => {
  const LONG = 'Slow-roast the whole spatchcocked chicken with lemon, thyme and garlic until golden'

  function LongStarter() {
    const { start } = useCookingTimers()
    return (
      <button type="button" onClick={() => start(LONG, 600)}>
        start
      </button>
    )
  }

  function mountLongLabelWithLink() {
    startGuidedCookSession('r-lemon')
    saveCookProgress('r-lemon', 2)
    render(
      <CookingTimersProvider>
        <LongStarter />
        <TimerDock />
      </CookingTimersProvider>,
    )
    act(() => {
      screen.getByText('start').click()
    })
  }

  it('expanded: the link takes the row slack and may shrink, so the inner label truncates', () => {
    mountLongLabelWithLink()
    fireEvent.click(screen.getByRole('button', { name: /expand timers/i }))

    const link = screen.getByRole('link', { name: /back to cooking/i })
    expect(link.className).toContain('flex-1')
    expect(link.className).toContain('min-w-0')
    expect(link.className).not.toContain('flex-shrink-0')
    const label = screen.getByText(LONG)
    expect(label.className).toContain('truncate')
    expect(label.className).toContain('min-w-0')
  })

  it('collapsed: the pill still never shrinks', () => {
    mountLongLabelWithLink()
    const link = screen.getByRole('link', { name: /back to cooking/i })
    expect(link.className).toContain('flex-shrink-0')
  })

  it('every dock control stays non-shrinking next to a linked label', () => {
    mountLongLabelWithLink()
    fireEvent.click(screen.getByRole('button', { name: /expand timers/i }))
    for (const name of [/pause/i, /add 2 minutes/i, /dismiss/i]) {
      expect(screen.getByRole('button', { name }).className).toContain('flex-shrink-0')
    }
  })
})

describe('the dock reserves its own space (issue #848)', () => {
  const read = () => document.documentElement.style.getPropertyValue('--timer-dock-h')

  it('publishes a non-zero height while a timer shows', () => {
    mountWithTimer()
    // jsdom has no layout, so the dock falls back to its known row height.
    expect(parseInt(read(), 10)).toBeGreaterThan(0)
  })

  it('is 0 (or unset) with no timers', () => {
    render(
      <CookingTimersProvider>
        <TimerDock />
      </CookingTimersProvider>,
    )
    expect(parseInt(read() || '0', 10)).toBe(0)
  })

  it('goes back to 0 when the dock unmounts', () => {
    const { unmount } = render(
      <CookingTimersProvider>
        <Starter onId={() => {}} />
        <TimerDock />
      </CookingTimersProvider>,
    )
    act(() => {
      screen.getByText('start').click()
    })
    expect(parseInt(read(), 10)).toBeGreaterThan(0)
    unmount()
    expect(parseInt(read() || '0', 10)).toBe(0)
  })
})
