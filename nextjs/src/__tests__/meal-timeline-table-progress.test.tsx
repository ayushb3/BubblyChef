/**
 * Issue #653 — component tests for `MealTimelineTable`'s additive
 * `progress` prop: done/skipped fade the cell, skipped strikes the label,
 * the current step gets a ring, and (review round 1, S5) none of that is
 * colour-only — each state also has a text/sr-only marker.
 *
 * The existing #649 suite (`meal-timeline-table.test.tsx`) already covers
 * that omitting `progress` leaves output unchanged; this file only exercises
 * the new prop.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import MealTimelineTable from '@/components/meal/MealTimelineTable'
import type { MealTimeline, RowCell } from '@/lib/meal-scheduler'

function buildTimeline(cells: { main?: RowCell; side_1?: RowCell }): MealTimeline {
  return {
    placements: [],
    total_minutes: 20,
    hands_on_minutes: 10,
    finish_spread_minutes: 0,
    warnings: [],
    degraded: false,
    rows: [{ offset_minutes: 0, cells }],
  }
}

const COLUMNS = [
  { column: 'main' as const, title: 'Pasta' },
  { column: 'side_1' as const, title: 'Salad' },
]

describe('MealTimelineTable progress', () => {
  it('fades a done cell and marks it with a visible ✓ plus an sr-only "done"', () => {
    const timeline = buildTimeline({
      main: { kind: 'start', label: 'Boil pasta', text: 'Boil the pasta', duration_minutes: 10, hands_on: false, step_index: 0 },
    })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={COLUMNS}
        progress={{ statuses: { 'main:0': 'done' } }}
      />,
    )
    const cell = screen.getByTestId('meal-timeline-cell-start')
    expect(cell).toHaveAttribute('data-status', 'done')
    expect(cell.className).toContain('opacity-60')

    const marker = screen.getByTestId('meal-timeline-cell-done-marker')
    expect(marker).toHaveTextContent('✓')
    expect(marker).toHaveTextContent('done')
    // The sr-only "done" is what carries the meaning for assistive tech —
    // present even if a screen reader doesn't render the glyph itself.
    expect(marker.querySelector('.sr-only')).toHaveTextContent('done')
  })

  it('strikes through a skipped cell label, fades it, and shows visible "skipped" text', () => {
    const timeline = buildTimeline({
      main: { kind: 'start', label: 'Boil pasta', text: 'Boil the pasta', duration_minutes: 10, hands_on: false, step_index: 0 },
    })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={COLUMNS}
        progress={{ statuses: { 'main:0': 'skipped' } }}
      />,
    )
    const cell = screen.getByTestId('meal-timeline-cell-start')
    expect(cell).toHaveAttribute('data-status', 'skipped')
    expect(cell.className).toContain('opacity-60')
    const label = screen.getByText(/Boil pasta/)
    expect(label).toHaveStyle({ textDecoration: 'line-through' })
    expect(screen.getByTestId('meal-timeline-cell-skipped-marker')).toHaveTextContent('skipped')
  })

  it('rings the current cell in --color-text (not the dish colour), shows a "Now" marker, and aria-current="step"', () => {
    const timeline = buildTimeline({
      side_1: { kind: 'start', label: 'Toss salad', text: 'Toss the salad', duration_minutes: 3, hands_on: true, step_index: 2 },
    })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={COLUMNS}
        progress={{ statuses: {}, current: { column: 'side_1', step_index: 2 } }}
      />,
    )
    const cell = screen.getByTestId('meal-timeline-cell-start')
    expect(cell).toHaveStyle({ boxShadow: '0 0 0 2px var(--color-text)' })
    expect(cell).toHaveAttribute('aria-current', 'step')
    expect(screen.getByTestId('meal-timeline-cell-now-marker')).toHaveTextContent('Now')
  })

  it('does not ring, mark, or aria-current a cell that is not the current step', () => {
    const timeline = buildTimeline({
      main: { kind: 'start', label: 'Boil pasta', text: 'Boil the pasta', duration_minutes: 10, hands_on: false, step_index: 0 },
    })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={COLUMNS}
        progress={{ statuses: {}, current: { column: 'main', step_index: 1 } }}
      />,
    )
    const cell = screen.getByTestId('meal-timeline-cell-start')
    expect(cell.style.boxShadow).toBe('')
    expect(cell).not.toHaveAttribute('aria-current')
    expect(screen.queryByTestId('meal-timeline-cell-now-marker')).not.toBeInTheDocument()
  })

  it('marks a done ongoing cell the same way', () => {
    const timeline = buildTimeline({
      main: {
        kind: 'ongoing',
        ongoing_label: 'the sauce simmers',
        label: 'Simmer sauce',
        remaining_minutes: 4,
        hands_on: false,
        step_index: 1,
      },
    })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={COLUMNS}
        progress={{ statuses: { 'main:1': 'done' } }}
      />,
    )
    const cell = screen.getByTestId('meal-timeline-cell-ongoing')
    expect(cell).toHaveAttribute('data-status', 'done')
    expect(cell.className).toContain('opacity-60')
    expect(screen.getByTestId('meal-timeline-cell-done-marker')).toBeInTheDocument()
  })

  it('shows "cooking" on a running hands-off cell', () => {
    const timeline = buildTimeline({
      main: {
        kind: 'ongoing',
        ongoing_label: 'the sauce simmers',
        label: 'Simmer sauce',
        remaining_minutes: 4,
        hands_on: false,
        step_index: 1,
      },
    })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={COLUMNS}
        progress={{ statuses: { 'main:1': 'running' } }}
      />,
    )
    expect(screen.getByTestId('meal-timeline-cell-cooking-marker')).toHaveTextContent('cooking')
  })

  it('does not show "cooking" on a running hands-on cell — that step is the Now card, not this table', () => {
    const timeline = buildTimeline({
      main: { kind: 'start', label: 'Boil pasta', text: 'Boil the pasta', duration_minutes: 10, hands_on: true, step_index: 0 },
    })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={COLUMNS}
        progress={{ statuses: { 'main:0': 'running' } }}
      />,
    )
    expect(screen.queryByTestId('meal-timeline-cell-cooking-marker')).not.toBeInTheDocument()
  })

  it('renders unchanged with no progress prop', () => {
    const timeline = buildTimeline({
      main: { kind: 'start', label: 'Boil pasta', text: 'Boil the pasta', duration_minutes: 10, hands_on: false, step_index: 0 },
    })
    render(<MealTimelineTable timeline={timeline} columns={COLUMNS} />)
    const cell = screen.getByTestId('meal-timeline-cell-start')
    expect(cell).not.toHaveAttribute('data-status')
    expect(cell).not.toHaveAttribute('aria-current')
    expect(cell.style.boxShadow).toBe('')
    expect(screen.queryByTestId('meal-timeline-cell-now-marker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('meal-timeline-cell-done-marker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('meal-timeline-cell-skipped-marker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('meal-timeline-cell-cooking-marker')).not.toBeInTheDocument()
  })
})
