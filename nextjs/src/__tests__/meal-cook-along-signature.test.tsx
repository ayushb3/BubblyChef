/**
 * Issue #745 — the cook-along cards in the signature style: the Now card is a
 * PixelPanel carrying the dish tag in its pastel, the hands-on / hands-off
 * chip, the keycap actions and a per-dish progress strip; Next up and the
 * running strip carry the same dish pastel bar / hatched language.
 *
 * Behaviour (Done / +2 min / Skip, the live region, Start now rules) is pinned
 * by `meal-now-card.test.tsx`, which is unchanged apart from nothing here.
 */

import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import MealNowCard from '@/components/meal/MealNowCard'
import MealNextUp from '@/components/meal/MealNextUp'
import MealRunningStrip from '@/components/meal/MealRunningStrip'
import { dishProgress } from '@/components/meal/dish-progress'
import type { StreamStep } from '@/lib/meal-cook-stream'

const STEP: StreamStep = {
  key: 'r1:0',
  dish_id: 'r1',
  column: 'main',
  dish_title: 'Pasta with tomato sauce',
  step_index: 0,
  label: 'Boil the pasta',
  ongoing_label: null,
  text: 'Bring a large pot of salted water to a boil.',
  duration_minutes: 10,
  hands_on: true,
  start: 0,
  end: 10,
}

const OFF: StreamStep = { ...STEP, key: 'r1:1', step_index: 1, label: 'Simmer the sauce', hands_on: false, ongoing_label: 'the sauce simmers' }
const SIDE: StreamStep = { ...STEP, key: 'r2:0', dish_id: 'r2', column: 'side_1', dish_title: 'Green salad', label: 'Toss the salad' }

const clockLabel = (n: number) => `+${n}`
const noop = () => {}

function renderCard(card: React.ComponentProps<typeof MealNowCard>['card'], extra: Partial<React.ComponentProps<typeof MealNowCard>> = {}) {
  return render(
    <MealNowCard card={card} clockLabel={clockLabel} onDone={noop} onExtend={noop} onSkip={noop} onStartEarly={noop} {...extra} />,
  )
}

describe('dishProgress', () => {
  it('counts done and skipped steps per dish, in dish order', () => {
    const steps = [STEP, OFF, SIDE]
    const progress = dishProgress(steps, {
      'r1:0': { status: 'done' },
      'r1:1': { status: 'running' },
      'r2:0': { status: 'skipped' },
    })
    expect(progress).toEqual([
      { column: 'main', title: 'Pasta with tomato sauce', done: 1, total: 2 },
      { column: 'side_1', title: 'Green salad', done: 1, total: 1 },
    ])
  })

  it('is empty when there are no steps', () => {
    expect(dishProgress([], {})).toEqual([])
  })
})

describe('MealNowCard — signature look (issue #745)', () => {
  it('is a pixel panel that stays one stable labelled live region', () => {
    renderCard({ kind: 'active', step: STEP })
    const card = screen.getByTestId('meal-now-card')
    expect(card).toHaveAttribute('data-pixel-panel')
    expect(card).toHaveAttribute('aria-live', 'polite')
    expect(card).toHaveAttribute('aria-label', 'Now')
  })

  it('tags the dish with its pastel and prints the dish name next to it', () => {
    renderCard({ kind: 'active', step: SIDE })
    const tag = screen.getByTestId('meal-now-card-dish-tag')
    expect(tag).toHaveTextContent('Green salad')
    expect(tag.className).toContain('--color-dish-side-1')
  })

  it('draws hands-on solid and hands-off hatched in the badge', () => {
    const { rerender } = renderCard({ kind: 'active', step: STEP })
    expect(screen.getByTestId('meal-now-card-badge')).toHaveAttribute('data-look', 'solid')
    rerender(
      <MealNowCard card={{ kind: 'active', step: OFF }} clockLabel={clockLabel} onDone={noop} onExtend={noop} onSkip={noop} onStartEarly={noop} />,
    )
    expect(screen.getByTestId('meal-now-card-badge')).toHaveAttribute('data-look', 'hatched')
  })

  it('actions are keycaps with 44px targets, and still fire their callbacks', () => {
    const onDone = jest.fn()
    const onExtend = jest.fn()
    const onSkip = jest.fn()
    renderCard({ kind: 'active', step: STEP }, { onDone, onExtend, onSkip })
    for (const name of ['Done', 'Add 2 minutes', 'Skip']) {
      const key = screen.getByRole('button', { name })
      expect(key).toHaveAttribute('data-keycap')
      expect(key.className).toMatch(/min-h-\[44px\]/)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 minutes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onExtend).toHaveBeenCalledTimes(1)
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('shows the per-dish progress strip, one labelled bar per dish', () => {
    renderCard(
      { kind: 'active', step: STEP },
      {
        progress: [
          { column: 'main', title: 'Pasta with tomato sauce', done: 1, total: 4 },
          { column: 'side_1', title: 'Green salad', done: 0, total: 2 },
        ],
      },
    )
    const strip = screen.getByTestId('meal-progress-strip')
    const items = within(strip).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Pasta with tomato sauce')
    expect(items[0]).toHaveTextContent('1 of 4 steps done')
    expect(items[1]).toHaveTextContent('0 of 2 steps done')
    expect(items[0].innerHTML).toContain('--color-dish-main')
  })

  it('omits the progress strip when no progress is passed, and on a waiting card', () => {
    const { rerender } = renderCard({ kind: 'active', step: STEP })
    expect(screen.queryByTestId('meal-progress-strip')).not.toBeInTheDocument()
    rerender(
      <MealNowCard
        card={{ kind: 'waiting', running: [OFF] }}
        clockLabel={clockLabel}
        onDone={noop}
        onExtend={noop}
        onSkip={noop}
        onStartEarly={noop}
        progress={[{ column: 'main', title: 'Pasta', done: 1, total: 2 }]}
      />,
    )
    // Waiting still shows what's running, and the strip is still useful there.
    expect(screen.getByTestId('meal-progress-strip')).toBeInTheDocument()
  })
})

describe('MealNextUp / MealRunningStrip — signature look (issue #745)', () => {
  it('Next up carries a pastel bar for the dish and keeps the dish name printed', () => {
    render(<MealNextUp step={SIDE} clockLabel={clockLabel} />)
    const row = screen.getByTestId('meal-next-up')
    expect(row).toHaveAttribute('role', 'group')
    expect(row).toHaveAttribute('aria-label', 'Next up')
    expect(row).toHaveTextContent('Green salad')
    expect(row.innerHTML).toContain('--color-dish-side-1')
  })

  it('running steps are hatched, like any step that is just cooking', () => {
    render(<MealRunningStrip steps={[OFF]} clockLabel={clockLabel} />)
    const [item] = screen.getAllByRole('listitem')
    expect(item).toHaveAttribute('data-look', 'hatched')
    expect(item).toHaveTextContent('the sauce simmers')
  })
})
