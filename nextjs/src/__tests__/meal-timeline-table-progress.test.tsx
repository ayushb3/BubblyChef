/**
 * Issue #653 — component tests for `MealTimelineTable`'s additive
 * `progress` prop: done/skipped fade the cell, skipped strikes the label,
 * and the current step gets a colour ring.
 *
 * The existing #649 suite (`meal-timeline-table.test.tsx`) already covers
 * that omitting `progress` leaves output unchanged; this file only exercises
 * the new prop.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import MealTimelineTable, { COLUMN_COLORS } from '@/components/meal/MealTimelineTable'
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
  it('fades a done cell', () => {
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
    expect(cell.className).toContain('opacity-40')
  })

  it('strikes through a skipped cell label, and fades it too', () => {
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
    expect(cell.className).toContain('opacity-40')
    const label = screen.getByText(/Boil pasta/)
    expect(label).toHaveStyle({ textDecoration: 'line-through' })
  })

  it('rings the current cell in its dish colour', () => {
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
    expect(cell).toHaveStyle({ boxShadow: `0 0 0 2px ${COLUMN_COLORS.side_1}` })
  })

  it('does not ring a cell that is not the current step', () => {
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
  })

  it('marks an ongoing cell the same way', () => {
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
    expect(cell.className).toContain('opacity-30')
  })

  it('renders unchanged with no progress prop', () => {
    const timeline = buildTimeline({
      main: { kind: 'start', label: 'Boil pasta', text: 'Boil the pasta', duration_minutes: 10, hands_on: false, step_index: 0 },
    })
    render(<MealTimelineTable timeline={timeline} columns={COLUMNS} />)
    const cell = screen.getByTestId('meal-timeline-cell-start')
    expect(cell).not.toHaveAttribute('data-status')
    expect(cell.style.boxShadow).toBe('')
  })
})
