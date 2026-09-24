/**
 * Issue #495 — Spec B.3 cooking timers. Acceptance criterion: "Prep/Cook/
 * Total quick-set buttons only render for fields the recipe has."
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import HeaderQuickSetTimers from '@/components/timers/HeaderQuickSetTimers'
import { CookingTimersProvider, useCookingTimers } from '@/lib/useCookingTimers'

function TimerList() {
  const { timers } = useCookingTimers()
  return (
    <ul>
      {timers.map((t) => (
        <li key={t.id}>{t.label}</li>
      ))}
    </ul>
  )
}

function renderWithProvider(ui: React.ReactNode) {
  return render(<CookingTimersProvider>{ui}</CookingTimersProvider>)
}

describe('HeaderQuickSetTimers', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders nothing when no time fields are set', () => {
    const { container } = renderWithProvider(<HeaderQuickSetTimers />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders only the buttons for fields that are set', () => {
    renderWithProvider(<HeaderQuickSetTimers prepTimeMinutes={10} cookTimeMinutes={null} totalTimeMinutes={undefined} />)
    expect(screen.getByText(/Prep 10m/)).toBeInTheDocument()
    expect(screen.queryByText(/Cook/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument()
  })

  it('renders all three when all three fields are set', () => {
    renderWithProvider(
      <HeaderQuickSetTimers prepTimeMinutes={10} cookTimeMinutes={20} totalTimeMinutes={30} />,
    )
    expect(screen.getByText(/Prep 10m/)).toBeInTheDocument()
    expect(screen.getByText(/Cook 20m/)).toBeInTheDocument()
    expect(screen.getByText(/Total 30m/)).toBeInTheDocument()
  })

  it('ignores a zero value the same as unset', () => {
    renderWithProvider(<HeaderQuickSetTimers prepTimeMinutes={0} />)
    expect(screen.queryByText(/Prep/)).not.toBeInTheDocument()
  })

  it('tapping a quick-set button starts a timer for that many minutes', () => {
    renderWithProvider(
      <>
        <HeaderQuickSetTimers cookTimeMinutes={25} />
        <TimerList />
      </>,
    )
    fireEvent.click(screen.getByText(/Cook 25m/))
    expect(screen.getByText('Cook')).toBeInTheDocument()
  })
})
