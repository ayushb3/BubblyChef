/**
 * Issue #649 — component tests for `MealTimelineTable`, driven by
 * `scheduleMeal` fixtures from `@/lib/meal-fixtures` per the spec's
 * testing decision ("component tests for the timeline table, driven by
 * scheduler fixtures").
 */

import React from 'react'
import { render, screen, within } from '@testing-library/react'
import MealTimelineTable, { timelineNotes } from '@/components/meal/MealTimelineTable'
import { scheduleMeal } from '@/lib/meal-scheduler'
import { PASTA_SAUCE_SALAD, ONE_PAN_MEAL, ONE_SIDE_MEAL, ROAST_TWO_SIDES } from '@/lib/meal-fixtures'

describe('MealTimelineTable', () => {
  it('renders one column per dish plus the time column', () => {
    const timeline = scheduleMeal({ dishes: PASTA_SAUCE_SALAD.dishes })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={[
          { column: 'main', title: 'Pasta with tomato sauce' },
          { column: 'side_1', title: 'Green salad' },
        ]}
      />,
    )
    expect(screen.getByText('Pasta with tomato sauce')).toBeInTheDocument()
    expect(screen.getByText('Green salad')).toBeInTheDocument()
    expect(screen.getAllByTestId('meal-timeline-row').length).toBe(timeline.rows.length)
  })

  it('renders three columns for a three-dish meal', () => {
    const timeline = scheduleMeal({ dishes: ROAST_TWO_SIDES.dishes })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={[
          { column: 'main', title: 'Roast chicken' },
          { column: 'side_1', title: 'Roast potatoes' },
          { column: 'side_2', title: 'Green beans' },
        ]}
      />,
    )
    expect(screen.getByText('Roast chicken')).toBeInTheDocument()
    expect(screen.getByText('Roast potatoes')).toBeInTheDocument()
    expect(screen.getByText('Green beans')).toBeInTheDocument()
  })

  it('renders a faded ongoing cell with the remaining minutes', () => {
    const timeline = scheduleMeal({ dishes: PASTA_SAUCE_SALAD.dishes })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={[
          { column: 'main', title: 'Pasta with tomato sauce' },
          { column: 'side_1', title: 'Green salad' },
        ]}
      />,
    )
    const ongoingCells = screen.getAllByTestId('meal-timeline-cell-ongoing')
    expect(ongoingCells.length).toBeGreaterThan(0)
    expect(ongoingCells[0]).toHaveTextContent('the sauce reduces')
    expect(ongoingCells[0]).toHaveTextContent('min')
    expect(ongoingCells[0].className).toContain('opacity-50')
  })

  it('renders the cue on its row', () => {
    const timeline = scheduleMeal({ dishes: PASTA_SAUCE_SALAD.dishes })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={[
          { column: 'main', title: 'Pasta with tomato sauce' },
          { column: 'side_1', title: 'Green salad' },
        ]}
      />,
    )
    expect(screen.getByText(/While the sauce reduces, chop salad veg/)).toBeInTheDocument()
  })

  it('renders relative time offsets by default ("+0", "+N min")', () => {
    const timeline = scheduleMeal({ dishes: PASTA_SAUCE_SALAD.dishes })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={[
          { column: 'main', title: 'Pasta with tomato sauce' },
          { column: 'side_1', title: 'Green salad' },
        ]}
      />,
    )
    expect(screen.getByText('+0')).toBeInTheDocument()
    expect(screen.getByText('+18 min')).toBeInTheDocument()
  })

  it('renders clock times when a clock anchor is supplied', () => {
    const timeline = scheduleMeal({ dishes: PASTA_SAUCE_SALAD.dishes })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={[
          { column: 'main', title: 'Pasta with tomato sauce' },
          { column: 'side_1', title: 'Green salad' },
        ]}
        anchor={{ status: 'clock', start_at: new Date('2026-09-29T18:00:00') }}
      />,
    )
    expect(screen.getByText('6:00 PM')).toBeInTheDocument()
  })

  it('a one-pan meal shows the two pan steps in sequence, never overlapping in rows', () => {
    const timeline = scheduleMeal({ dishes: ONE_PAN_MEAL.dishes, constraints: ONE_PAN_MEAL.constraints })
    render(
      <MealTimelineTable
        timeline={timeline}
        columns={[
          { column: 'main', title: 'Pan-seared chicken' },
          { column: 'side_1', title: 'Braised vegetables' },
        ]}
      />,
    )
    const rows = screen.getAllByTestId('meal-timeline-row')
    // The main's sear starts in the first row, the side's braise starts later —
    // never in the same row, since they share the "pan" exclusive tag.
    const rowWithSear = rows.find((r) =>
      within(r).queryAllByTestId('meal-timeline-cell-start').some((c) => /Sear chicken/.test(c.textContent ?? '')),
    )
    const rowWithBraise = rows.find((r) =>
      within(r).queryAllByTestId('meal-timeline-cell-start').some((c) => /Braise veg/.test(c.textContent ?? '')),
    )
    expect(rowWithSear).toBeDefined()
    expect(rowWithBraise).toBeDefined()
    expect(rowWithSear).not.toBe(rowWithBraise)
  })

  it('renders nothing-to-cook copy for an empty timeline', () => {
    const timeline = scheduleMeal({ dishes: [] })
    render(<MealTimelineTable timeline={timeline} columns={[]} />)
    expect(screen.getByTestId('meal-timeline-empty')).toBeInTheDocument()
  })
})

describe('timelineNotes', () => {
  it('turns finish_spread into copy with the spread, never the raw code', () => {
    const timeline = scheduleMeal({ dishes: ONE_SIDE_MEAL.dishes })
    expect(timeline.warnings).toContain('finish_spread')
    const notes = timelineNotes(timeline)
    expect(notes).toEqual([
      "The dishes finish up to 3 min apart: the steps can't line up any closer.",
    ])
    expect(notes.join(' ')).not.toMatch(/finish_spread/)
  })

  it('is empty when there are no warnings', () => {
    expect(timelineNotes(scheduleMeal({ dishes: PASTA_SAUCE_SALAD.dishes }))).toEqual([])
  })
})
