/**
 * Issue #439 — `AddItemRow`'s catalog-select auto-fill built the expiry date
 * with `toISOString().slice(0, 10)`, which reports the date in UTC. In the
 * evening in US timezones that's a calendar day ahead of local time, so the
 * auto-filled expiry silently landed a day early. Reproduced by fixing the
 * clock to a US-evening instant where the UTC date has already rolled over.
 */

import React, { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import AddItemRow, { type ManualRow } from '@/components/pantry/AddItemRow'
import * as foodsApi from '@/lib/api/foods'

jest.mock('@/lib/api/foods')

const mockSearchFoods = foodsApi.searchFoods as jest.MockedFunction<typeof foodsApi.searchFoods>

// `AddItemRow`'s name field is a controlled input — a fixed `row` prop with a
// no-op `onChange` would just snap the typed value straight back to empty on
// every keystroke. This wrapper feeds `onChange` back into `row` like the
// real caller (`TypeTab`) does, and exposes each update for assertions.
function StatefulRow({ onUpdate }: { onUpdate: (row: ManualRow) => void }) {
  const [row, setRow] = useState<ManualRow>({
    id: 'row-1',
    name: '',
    quantity: 1,
    unit: 'item',
    category: 'other',
    storage_location: 'pantry',
    expiry_date: '',
    estimated_expiry: false,
  })
  return (
    <AddItemRow
      row={row}
      index={0}
      onChange={(updated) => {
        setRow(updated)
        onUpdate(updated)
      }}
      onRemove={jest.fn()}
    />
  )
}

function renderRow(onUpdate: (row: ManualRow) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <StatefulRow onUpdate={onUpdate} />
    </QueryClientProvider>,
  )
}

const RealDate = global.Date

// 11pm Eastern on Jan 15 is 4am UTC on Jan 16 — a naive toISOString()-based
// formatter would report the 16th. This fakes only `new Date()`/`Date.now()`
// with no args (the "current instant"), leaving every timer API (debounce,
// React Query's internals) real so async flows still settle normally —
// `jest.useFakeTimers` would freeze those too and break `waitFor`.
class FixedNowDate extends RealDate {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(...args: any[]) {
    if (args.length === 0) {
      super('2026-01-16T04:00:00.000Z')
    } else {
      // @ts-expect-error — `args` loses the Date constructor's overload
      // shape once spread through a variadic `any[]` parameter.
      super(...args)
    }
  }
  static now(): number {
    return new FixedNowDate().getTime()
  }
}

beforeEach(() => {
  global.Date = FixedNowDate as unknown as DateConstructor
  mockSearchFoods.mockResolvedValue([
    {
      canonical: 'Milk',
      category: 'dairy',
      icon_slug: null,
      valid_units: ['gallon'],
      expiry_days: 0,
      default_location: 'fridge',
      emoji: '🥛',
    },
  ])
})

afterEach(() => {
  global.Date = RealDate
})

it('auto-fills the catalog expiry using the local calendar day, not the UTC day', async () => {
  const onChange = jest.fn()
  renderRow(onChange)

  fireEvent.change(screen.getByPlaceholderText('Item name (e.g. Milk, Eggs...)'), {
    target: { value: 'Milk' },
  })

  await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())
  // The `onMouseDown` commit handler lives on the option's inner <button>,
  // not the <li role="option"> itself — events don't propagate to
  // descendants, so the button is what needs the event.
  fireEvent.mouseDown(screen.getByRole('button', { name: /milk/i }))

  await waitFor(() => expect(onChange).toHaveBeenCalled())
  const updated = onChange.mock.calls[onChange.mock.calls.length - 1][0] as ManualRow
  // The expected value is the runner's own LOCAL calendar day for the faked
  // instant. That is correct in any timezone. (Setting process.env.TZ inside a
  // Jest test file doesn't change the timezone, because Jest sandboxes
  // process.env; CI runs in UTC.)
  const now = new RealDate('2026-01-16T04:00:00.000Z')
  const localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  expect(updated.expiry_date).toBe(localDay)
  // The regression this guards: west of UTC (e.g. any US timezone) this instant is
  // still Jan 15 locally, while toISOString() would say the 16th. In a UTC runner
  // the two agree, so this branch only bites where the bug can actually occur.
  if (now.getTimezoneOffset() > 0) {
    expect(updated.expiry_date).toBe('2026-01-15')
    expect(updated.expiry_date).not.toBe(now.toISOString().slice(0, 10))
  }
})
