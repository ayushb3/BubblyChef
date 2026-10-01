/**
 * Issue #745 (Goal 3, signature #4) — the meal timeline in the signature
 * style: one dish pastel per column from the theme-invariant tokens (no hex
 * literal), solid steps you do and hatched steps that are just cooking, a
 * Serve row that closes the plan, clock times that end at the serving time,
 * and the "now" marker on the row being cooked.
 *
 * The scheduler and the cook-along logic are unchanged; this only pins the
 * look's observable contract (data attributes and tokens, never colours).
 */

import React from 'react'
import { render, screen, within } from '@testing-library/react'
import MealTimelineTable from '@/components/meal/MealTimelineTable'
import ServeAtControl from '@/components/meal/ServeAtControl'
import { resolveMealAnchor } from '@/lib/meal-anchor'
import { scheduleMeal } from '@/lib/meal-scheduler'
import { PASTA_SAUCE_SALAD } from '@/lib/meal-fixtures'

const COLUMNS = [
  { column: 'main' as const, title: 'Pasta with tomato sauce' },
  { column: 'side_1' as const, title: 'Green salad' },
]

function renderTable(props: Partial<React.ComponentProps<typeof MealTimelineTable>> = {}) {
  const timeline = scheduleMeal({ dishes: PASTA_SAUCE_SALAD.dishes })
  const utils = render(<MealTimelineTable timeline={timeline} columns={COLUMNS} {...props} />)
  return { timeline, ...utils }
}

describe('MealTimelineTable — signature look (issue #745)', () => {
  it('colours each dish column from its dish pastel token, with no hex literal anywhere', () => {
    const { container } = renderTable()
    const html = container.innerHTML
    expect(html).toContain('--color-dish-main')
    expect(html).toContain('--color-dish-side-1')
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('draws a step you do solid and a step that is just cooking hatched', () => {
    renderTable()
    const starts = screen.getAllByTestId('meal-timeline-cell-start')
    expect(starts.length).toBeGreaterThan(0)
    for (const cell of starts) expect(cell).toHaveAttribute('data-look', 'solid')

    const ongoing = screen.getAllByTestId('meal-timeline-cell-ongoing')
    expect(ongoing.length).toBeGreaterThan(0)
    for (const cell of ongoing) expect(cell).toHaveAttribute('data-look', 'hatched')
  })

  it('says hands-off on a hands-off start cell and shows only the minutes on a hands-on one', () => {
    renderTable()
    const starts = screen.getAllByTestId('meal-timeline-cell-start')
    const handsOff = starts.filter((c) => /hands-off/.test(c.textContent ?? ''))
    const handsOn = starts.filter((c) => !/hands-off/.test(c.textContent ?? ''))
    expect(handsOff.length).toBeGreaterThan(0)
    expect(handsOn.length).toBeGreaterThan(0)
    for (const cell of [...handsOff, ...handsOn]) expect(cell).toHaveTextContent(/\d+ min/)
  })

  it('closes the plan with a Serve row spanning every dish column at the total time', () => {
    const { timeline } = renderTable()
    const serve = screen.getByTestId('meal-timeline-serve-row')
    expect(within(serve).getAllByText('Serve')).toHaveLength(COLUMNS.length)
    expect(serve).toHaveTextContent(`+${timeline.total_minutes} min`)
    // The serve row comes after every cooking row.
    const rows = screen.getAllByTestId('meal-timeline-row')
    expect(rows[rows.length - 1].compareDocumentPosition(serve)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('serve at 19:00 shifts every row to clock times ending at 19:00', () => {
    const timeline = scheduleMeal({ dishes: PASTA_SAUCE_SALAD.dishes })
    const now = new Date('2026-10-01T17:00:00')
    const serveAt = new Date('2026-10-01T19:00:00')
    const anchor = resolveMealAnchor({ mode: 'serve-at', total_minutes: timeline.total_minutes, now, serve_at: serveAt })
    expect(anchor.status).toBe('clock')

    render(<MealTimelineTable timeline={timeline} columns={COLUMNS} anchor={anchor} />)
    expect(screen.getByTestId('meal-timeline-serve-row')).toHaveTextContent('7:00 PM')
    for (const row of screen.getAllByTestId('meal-timeline-row')) {
      expect(row).not.toHaveTextContent(/\+\d+ min/)
      expect(row).toHaveTextContent(/\d:\d\d [AP]M/)
    }
  })

  it('puts a "Now" line on the row being cooked, and keeps a screen-reader marker in the cell', () => {
    const timeline = scheduleMeal({ dishes: PASTA_SAUCE_SALAD.dishes })
    const first = timeline.rows[0]
    const cell = first.cells.main
    if (!cell || cell.kind !== 'start') throw new Error('fixture: expected a start cell')
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={COLUMNS}
        progress={{ statuses: {}, current: { column: 'main', step_index: cell.step_index } }}
      />,
    )
    const line = screen.getByTestId('meal-timeline-now-line')
    expect(line).toHaveTextContent('Now')
    expect(line.closest('[data-testid="meal-timeline-row"]')).toBe(screen.getAllByTestId('meal-timeline-row')[0])
    expect(screen.getByTestId('meal-timeline-cell-now-marker')).toHaveTextContent('Now')
  })

  it('shows no Now line without progress', () => {
    renderTable()
    expect(screen.queryByTestId('meal-timeline-now-line')).not.toBeInTheDocument()
  })
})

describe('ServeAtControl — segmented toggle (issue #745)', () => {
  it('is a two-option radio group with 44px targets, the chosen option marked', () => {
    render(
      <ServeAtControl
        mode="serve-at"
        serveAt="19:00"
        anchor={{ status: 'relative' }}
        onModeChange={jest.fn()}
        onServeAtChange={jest.fn()}
      />,
    )
    const group = screen.getByRole('radiogroup', { name: /when to start cooking/i })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios[0]).toHaveAttribute('aria-checked', 'false')
    expect(radios[1]).toHaveAttribute('aria-checked', 'true')
    for (const r of radios) expect(r.className).toMatch(/min-h-\[44px\]/)
  })

  it('shows the serving time inside the Serve at option, without changing its accessible name', () => {
    render(
      <ServeAtControl
        mode="start-now"
        serveAt="19:00"
        anchor={{ status: 'relative' }}
        onModeChange={jest.fn()}
        onServeAtChange={jest.fn()}
      />,
    )
    const serveAt = screen.getByRole('radio', { name: 'Serve at' })
    expect(serveAt).toHaveTextContent('7:00 PM')
  })
})
