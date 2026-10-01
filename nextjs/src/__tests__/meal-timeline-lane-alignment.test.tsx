/**
 * Issue #800 — the lane headers must sit over their own columns.
 *
 * The bug: the header row's "Time" label was `sr-only`, i.e. absolutely
 * positioned, so it took no grid cell. Every dish header slid one track left
 * (the first one into the 3.5rem time column) and the last column had no
 * header. jsdom has no layout, so these tests pin the structural contract
 * that makes the browser line up: the header grid and every body grid have
 * the same template and the same number of in-flow children, and the header
 * and the cell for a dish share the same index and the same `data-column` key.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import MealTimelineTable, { type MealTimelineTableColumn } from '@/components/meal/MealTimelineTable'
import { scheduleMeal } from '@/lib/meal-scheduler'
import { PASTA_SAUCE_SALAD, ROAST_TWO_SIDES } from '@/lib/meal-fixtures'

const ONE: MealTimelineTableColumn[] = [{ column: 'main', title: 'Roast chicken' }]
const TWO: MealTimelineTableColumn[] = [
  { column: 'main', title: 'Pasta with tomato sauce' },
  { column: 'side_1', title: 'Green salad' },
]
const THREE: MealTimelineTableColumn[] = [
  { column: 'main', title: 'Roast chicken' },
  { column: 'side_1', title: 'Roast potatoes' },
  { column: 'side_2', title: 'Green beans' },
]

function dishesFor(columns: MealTimelineTableColumn[]) {
  const dishes = columns.length === 3 ? ROAST_TWO_SIDES.dishes : PASTA_SAUCE_SALAD.dishes
  return dishes.slice(0, columns.length)
}

/** Direct children that occupy a grid cell: `sr-only` is `position: absolute`, which takes none. */
function inFlowChildren(grid: Element): Element[] {
  return Array.from(grid.children).filter((el) => !el.className.split(/\s+/).includes('sr-only'))
}

function bodyGrids(): HTMLElement[] {
  return [
    ...screen.getAllByTestId('meal-timeline-row').map((r) => r.querySelector(':scope > .grid') as HTMLElement),
    screen.getByTestId('meal-timeline-serve-row'),
  ]
}

describe.each([
  ['1-dish', ONE],
  ['2-dish', TWO],
  ['3-dish', THREE],
])('MealTimelineTable lane alignment (issue #800) — %s meal', (_name, columns) => {
  function setup() {
    const timeline = scheduleMeal({ dishes: dishesFor(columns) })
    return render(<MealTimelineTable timeline={timeline} columns={columns} />)
  }

  it('gives the header row the same template and track count as the body rows', () => {
    setup()
    const header = screen.getByTestId('meal-timeline-lane-headers')
    for (const grid of bodyGrids()) {
      expect(grid.style.gridTemplateColumns).toBe(header.style.gridTemplateColumns)
      expect(inFlowChildren(grid)).toHaveLength(columns.length + 1)
    }
    // time track + one track per dish: nothing in the header may be absolutely positioned and skipped.
    expect(inFlowChildren(header)).toHaveLength(columns.length + 1)
  })

  it('puts each lane header at the same index as its dish column, keyed by data-column', () => {
    setup()
    const headerCells = inFlowChildren(screen.getByTestId('meal-timeline-lane-headers'))
    // Index 0 is the time track, never a dish header.
    expect(headerCells[0]).not.toHaveAttribute('data-column')

    columns.forEach(({ column, title }, i) => {
      expect(headerCells[i + 1]).toHaveAttribute('data-column', column)
      expect(headerCells[i + 1]).toHaveTextContent(title)
      for (const grid of bodyGrids()) {
        expect(inFlowChildren(grid)[i + 1]).toHaveAttribute('data-column', column)
      }
    })
  })
})
