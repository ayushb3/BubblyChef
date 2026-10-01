/**
 * The storage sheet's List view (issue #750, board A4 "Fridge list"): the old
 * Pantry page, moved into the sheet. Every place in one list, the category and
 * expiry filters, "Cook this", swipe-to-resolve and Used up / Tossed, and a
 * select mode for bulk Move to <place> / Used up / Tossed.
 *
 * Presentation-level: the sheet is handed `onMove` / `onResolve` and reports
 * what the user asked for; `kitchen-home-list.test.tsx` runs the same through
 * `HeroHome` and the real endpoints' shapes.
 */
import React, { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import StorageSheet, {
  type BulkResult,
  type StorageView,
} from '@/components/kitchen/StorageSheet'
import { cookThisHref } from '@/lib/chat-seed'
import type { PlaceKey, StoredItem } from '@/lib/kitchen/places'
import { getDefaultKitchenTheme } from '@/lib/kitchen/themes'

const TODAY = '2026-10-01'
const palette = getDefaultKitchenTheme().wall

function item(
  id: string,
  name: string,
  location: string,
  extra: Partial<StoredItem> = {},
): StoredItem {
  return {
    id,
    name,
    location,
    category: 'produce',
    quantity: 1,
    unit: 'item',
    expiry_date: null,
    ...extra,
  }
}

const ITEMS: StoredItem[] = [
  item('r', 'romaine', 'fridge', { unit: 'head', expiry_date: '2026-10-01' }),
  item('c', 'chicken thighs', 'fridge', { category: 'meat', quantity: 4, expiry_date: '2026-10-04' }),
  item('l', 'lemons', 'fridge', { expiry_date: '2026-10-20' }),
  item('m', 'milk', 'fridge', { category: 'dairy', unit: 'L' }),
  item('y', 'old yogurt', 'fridge', { category: 'dairy', unit: 'tub', expiry_date: '2026-09-28' }),
  item('p', 'peas', 'freezer', { category: 'frozen', quantity: 2, unit: 'bag' }),
  item('rice', 'rice', 'pantry', { category: 'dry_goods', unit: 'kg' }),
  item('parm', 'parmesan', 'pantry', { category: 'dairy', unit: 'wedge' }),
  item('a', 'apples', 'counter', { quantity: 5 }),
]

type MoveFn = (ids: string[], place: PlaceKey) => Promise<BulkResult>
type ResolveFn = (ids: string[], outcome: 'used' | 'tossed') => Promise<BulkResult>

const ok = (ids: string[]): BulkResult => ({ done: ids, failed: [] })

function Harness({
  items = ITEMS,
  initialPlace = 'fridge',
  initialView = 'list',
  initialExpiry,
  onEdit = jest.fn(),
  onMove = jest.fn<Promise<BulkResult>, Parameters<MoveFn>>(async (ids) => ok(ids)),
  onResolve = jest.fn<Promise<BulkResult>, Parameters<ResolveFn>>(async (ids) => ok(ids)),
}: {
  items?: StoredItem[]
  initialPlace?: PlaceKey
  initialView?: StorageView
  initialExpiry?: readonly string[]
  onEdit?: (item: StoredItem) => void
  onMove?: MoveFn
  onResolve?: ResolveFn
}) {
  const [place, setPlace] = useState<PlaceKey>(initialPlace)
  const [view, setView] = useState<StorageView>(initialView)
  return (
    <StorageSheet
      open
      place={place}
      view={view}
      items={items}
      status="ready"
      palette={palette}
      today={TODAY}
      initialExpiry={initialExpiry}
      onPlaceChange={setPlace}
      onViewChange={setView}
      onClose={jest.fn()}
      onEdit={onEdit}
      onAdd={jest.fn()}
      onMove={onMove}
      onResolve={onResolve}
      onRetry={jest.fn()}
    />
  )
}

const rowNames = () => screen.getAllByTestId('storage-row').map((r) => r.getAttribute('aria-label'))
const rowOf = (label: RegExp | string) => screen.getByRole('button', { name: label }).closest('li')!

describe('List: every place in one list', () => {
  it('lists the items of every place, in wall order, each place under its own heading and count', () => {
    render(<Harness />)
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    const places = headings.filter((t) => /^(Fridge|Freezer|Shelves|Basket) \d+$/.test(t ?? ''))
    expect(places).toEqual(['Fridge 5', 'Freezer 1', 'Shelves 2', 'Basket 1'])
    expect(screen.getAllByTestId('storage-row')).toHaveLength(9)
  })

  it('says how many items it covers', () => {
    render(<Harness />)
    expect(screen.getByText(/All 9 items/)).toBeInTheDocument()
  })

  it('groups a place by food category and puts what needs using first inside each group', () => {
    render(<Harness />)
    const fridge = screen.getByRole('region', { name: /^Fridge/ })
    const names = within(fridge)
      .getAllByTestId('storage-row')
      .map((r) => r.getAttribute('aria-label'))
    expect(names).toEqual([
      'Romaine, 1 head, expires today',
      'Lemons, 1',
      'Old Yogurt, 1 tub, expired',
      'Milk, 1 L',
      'Chicken Thighs, 4, expires in 3 days',
    ])
  })

  it('is a plain list a screen reader can walk: every row is a labelled button inside a list item', () => {
    render(<Harness />)
    const row = rowOf(/^Romaine/)
    expect(row.tagName).toBe('LI')
    expect(within(row).getByRole('button', { name: 'Romaine, 1 head, expires today' })).toBeInTheDocument()
    expect(row.closest('ul')).not.toBeNull()
  })

  it('tapping a place tab keeps every place listed and brings that place into view', () => {
    const scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      render(<Harness />)
      scrolled.length = 0
      fireEvent.click(screen.getByRole('tab', { name: /^Shelves/ }))
      expect(screen.getAllByTestId('storage-row')).toHaveLength(9)
      expect(screen.getByRole('tab', { name: /^Shelves/ })).toHaveAttribute('aria-selected', 'true')
      expect(scrolled.some((el) => el === screen.getByRole('region', { name: /^Shelves/ }))).toBe(true)
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('tapping a row opens that item to edit', () => {
    const onEdit = jest.fn()
    render(<Harness onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: /^Milk/ }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'm' }))
  })
})

describe('List: filters', () => {
  const openFacet = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }))
  const pick = (facet: RegExp, option: string) => {
    openFacet(facet)
    fireEvent.click(within(screen.getByRole('group', { name: facet })).getByRole('button', { name: option }))
  }

  it('filters by category', () => {
    render(<Harness />)
    pick(/Filter by category/, 'Dairy and eggs')
    expect(rowNames()).toEqual([
      'Old Yogurt, 1 tub, expired',
      'Milk, 1 L',
      'Parmesan, 1 wedge',
    ])
  })

  it('filters by expiry: expiring soon', () => {
    render(<Harness />)
    pick(/Filter by expiry/, 'Expiring soon')
    expect(rowNames()).toEqual(['Romaine, 1 head, expires today', 'Chicken Thighs, 4, expires in 3 days'])
  })

  it('filters by expiry: expired', () => {
    render(<Harness />)
    pick(/Filter by expiry/, 'Expired')
    expect(rowNames()).toEqual(['Old Yogurt, 1 tub, expired'])
  })

  it('combines category and expiry', () => {
    render(<Harness />)
    pick(/Filter by category/, 'Produce')
    pick(/Filter by expiry/, 'Expiring soon')
    expect(rowNames()).toEqual(['Romaine, 1 head, expires today'])
  })

  it('opens with the expiry filter on when handed one (the old Use Soon address)', () => {
    render(<Harness initialExpiry={['expiring', 'expired']} />)
    expect(rowNames()).toEqual([
      'Romaine, 1 head, expires today',
      'Old Yogurt, 1 tub, expired',
      'Chicken Thighs, 4, expires in 3 days',
    ])
    expect(screen.getByRole('button', { name: /Filter by expiry status, 2 selected/ })).toBeInTheDocument()
  })

  it('says so, and keeps the filters reachable, when nothing matches', () => {
    render(<Harness items={[item('milk', 'milk', 'fridge', { category: 'dairy' })]} />)
    pick(/Filter by expiry/, 'Expired')
    expect(screen.getByText('No items match your filters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Filter by category/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Filter by expiry/ })).toBeInTheDocument()
  })

  it('on an empty pantry shows the empty prompt and no filter controls', () => {
    render(<Harness items={[]} />)
    expect(screen.getByText('Your pantry is empty!')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Filter by/ })).not.toBeInTheDocument()
  })

  // Moved from the Pantry page (#465): a filter left on from before the last
  // item went must not turn the empty-pantry prompt into "no matches".
  it('shows the empty prompt, not the stale "no matches" text, once the last item is gone', () => {
    const { rerender } = render(<Harness items={[item('milk', 'milk', 'fridge', { category: 'dairy' })]} />)
    fireEvent.click(screen.getByRole('button', { name: /Filter by category/ }))
    fireEvent.click(within(screen.getByRole('group', { name: /Filter by category/ })).getByRole('button', { name: 'Dairy and eggs' }))
    expect(rowNames()).toEqual(['Milk, 1'])
    rerender(<Harness items={[]} />)
    expect(screen.getByText('Your pantry is empty!')).toBeInTheDocument()
    expect(screen.queryByText('No items match your filters')).not.toBeInTheDocument()
  })

  it('has no location filter (the places are the tabs)', () => {
    render(<Harness />)
    expect(screen.queryByRole('button', { name: /Filter by location/ })).not.toBeInTheDocument()
  })
})

describe('List: resolving one item', () => {
  it('an item that needs using has a "Cook this" link to a recipe that uses it', () => {
    render(<Harness />)
    const link = within(rowOf(/^Romaine/)).getByRole('link', { name: 'Cook this romaine' })
    expect(link).toHaveAttribute('href', cookThisHref('romaine', '2026-10-01'))
  })

  it('an expired item has no "Cook this" (nothing to cook), only Used up / Tossed', () => {
    render(<Harness />)
    const row = rowOf(/^Old Yogurt/)
    expect(within(row).queryByRole('link', { name: /Cook this/ })).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Mark old yogurt as used up/i })).toBeInTheDocument()
  })

  it('shows Used up / Tossed buttons on expiring and expired rows only; the rest resolve by swipe', () => {
    render(<Harness />)
    expect(within(rowOf(/^Romaine/)).getByRole('button', { name: /used up/i })).toBeInTheDocument()
    expect(within(rowOf(/^Chicken/)).getByRole('button', { name: /tossed/i })).toBeInTheDocument()
    expect(within(rowOf(/^Milk/)).queryByRole('button', { name: /used up/i })).not.toBeInTheDocument()
    expect(within(rowOf(/^Milk/)).getByTestId('swipe-to-resolve')).toBeInTheDocument()
    expect(within(rowOf(/^Romaine/)).queryByTestId('swipe-to-resolve')).not.toBeInTheDocument()
  })

  it('"Used up" commits on one tap', async () => {
    const onResolve = jest.fn<Promise<BulkResult>, Parameters<ResolveFn>>(async (ids) => ok(ids))
    render(<Harness onResolve={onResolve} />)
    fireEvent.click(within(rowOf(/^Romaine/)).getByRole('button', { name: /used up/i }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(['r'], 'used'))
  })

  it('"Tossed" only commits after the confirm', async () => {
    const onResolve = jest.fn<Promise<BulkResult>, Parameters<ResolveFn>>(async (ids) => ok(ids))
    render(<Harness onResolve={onResolve} />)
    fireEvent.click(within(rowOf(/^Romaine/)).getByRole('button', { name: /tossed/i }))
    expect(onResolve).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /confirm romaine was tossed/i }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(['r'], 'tossed'))
  })

  it('says so when it could not resolve the item', async () => {
    const onResolve = jest.fn(async (ids: string[]) => ({ done: [], failed: ids }))
    render(<Harness onResolve={onResolve} />)
    fireEvent.click(within(rowOf(/^Romaine/)).getByRole('button', { name: /used up/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t update romaine/i)
  })
})

describe('List: select mode and bulk edits', () => {
  const enter = () => fireEvent.click(screen.getByRole('button', { name: 'Select' }))
  const tick = (label: RegExp) => fireEvent.click(screen.getByRole('checkbox', { name: label }))

  it('Select turns every row into a checkbox, and tapping a row no longer opens the editor', () => {
    const onEdit = jest.fn()
    render(<Harness onEdit={onEdit} />)
    enter()
    expect(screen.getAllByRole('checkbox')).toHaveLength(9)
    expect(screen.getByText('0 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /^Milk/ }))
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('swaps the add key for Move to / Used up / Tossed, all off until something is selected', () => {
    render(<Harness />)
    enter()
    expect(screen.queryByRole('button', { name: /^Add to the/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Move to/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Used up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Tossed' })).toBeDisabled()
    tick(/^Milk/)
    expect(screen.getByRole('button', { name: /^Move to/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Used up' })).toBeEnabled()
  })

  it('Select all picks every listed item; Done leaves select mode without acting', () => {
    const onResolve = jest.fn()
    const onMove = jest.fn()
    render(<Harness onResolve={onResolve} onMove={onMove} />)
    enter()
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByText('9 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Add to the/ })).toBeInTheDocument()
    expect(onResolve).not.toHaveBeenCalled()
    expect(onMove).not.toHaveBeenCalled()
  })

  it('Move to... offers the four places and moves exactly the selected items', async () => {
    const onMove = jest.fn<Promise<BulkResult>, Parameters<MoveFn>>(async (ids) => ok(ids))
    render(<Harness onMove={onMove} />)
    enter()
    tick(/^Lemons/)
    tick(/^Milk/)
    tick(/^Apples/)
    fireEvent.click(screen.getByRole('button', { name: /^Move to/ }))
    const group = screen.getByRole('group', { name: /Move 3 items to/ })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['Fridge', 'Freezer', 'Shelves', 'Basket']),
    )
    fireEvent.click(within(group).getByRole('button', { name: 'Freezer' }))
    await waitFor(() => expect(onMove).toHaveBeenCalledTimes(1))
    expect([...onMove.mock.calls[0][0]].sort()).toEqual(['a', 'l', 'm'])
    expect(onMove.mock.calls[0][1]).toBe('freezer')
  })

  it('after a clean bulk move it leaves select mode and says what happened', async () => {
    render(<Harness />)
    enter()
    tick(/^Lemons/)
    tick(/^Milk/)
    fireEvent.click(screen.getByRole('button', { name: /^Move to/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Freezer' }))
    await waitFor(() => expect(screen.queryByRole('checkbox')).not.toBeInTheDocument())
    expect(screen.getByText(/Moved 2 items to the freezer/i)).toBeInTheDocument()
  })

  it('"Used up" resolves every selected item as used', async () => {
    const onResolve = jest.fn<Promise<BulkResult>, Parameters<ResolveFn>>(async (ids) => ok(ids))
    render(<Harness onResolve={onResolve} />)
    enter()
    tick(/^Lemons/)
    tick(/^Rice/)
    tick(/^Peas/)
    fireEvent.click(screen.getByRole('button', { name: 'Used up' }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1))
    expect([...onResolve.mock.calls[0][0]].sort()).toEqual(['l', 'p', 'rice'])
    expect(onResolve.mock.calls[0][1]).toBe('used')
  })

  it('"Tossed" asks first, then resolves every selected item as tossed', async () => {
    const onResolve = jest.fn<Promise<BulkResult>, Parameters<ResolveFn>>(async (ids) => ok(ids))
    render(<Harness onResolve={onResolve} />)
    enter()
    tick(/^Lemons/)
    tick(/^Rice/)
    tick(/^Peas/)
    fireEvent.click(screen.getByRole('button', { name: 'Tossed' }))
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.getByText(/Toss 3 items\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, toss them' }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1))
    expect([...onResolve.mock.calls[0][0]].sort()).toEqual(['l', 'p', 'rice'])
    expect(onResolve.mock.calls[0][1]).toBe('tossed')
  })

  it('the toss confirm can be backed out of', () => {
    const onResolve = jest.fn()
    render(<Harness onResolve={onResolve} />)
    enter()
    tick(/^Lemons/)
    fireEvent.click(screen.getByRole('button', { name: 'Tossed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Used up' })).toBeInTheDocument()
  })

  it('when some items fail, only those stay selected and the user is told', async () => {
    const onResolve = jest.fn(async () => ({ done: ['l'], failed: ['rice'] }))
    render(<Harness onResolve={onResolve} />)
    enter()
    tick(/^Lemons/)
    tick(/^Rice/)
    fireEvent.click(screen.getByRole('button', { name: 'Used up' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/1 of 2/)
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^Rice/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^Lemons/ })).not.toBeChecked()
  })

  it('disables the actions while the request is in flight', async () => {
    let finish!: (r: BulkResult) => void
    const onResolve = jest.fn(() => new Promise<BulkResult>((res) => (finish = res)))
    render(<Harness onResolve={onResolve} />)
    enter()
    tick(/^Lemons/)
    fireEvent.click(screen.getByRole('button', { name: 'Used up' }))
    expect(screen.getByRole('button', { name: 'Used up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Tossed' })).toBeDisabled()
    await act(async () => finish(ok(['l'])))
  })

  it('a new search leaves select mode and drops the selection, so nothing unseen is acted on', () => {
    render(<Harness />)
    enter()
    tick(/^Milk/)
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'es' } })
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
    enter()
    expect(screen.getByText('0 selected')).toBeInTheDocument()
  })

  it('Scene has no select mode, and switching to it leaves select mode', () => {
    render(<Harness />)
    enter()
    fireEvent.click(screen.getByRole('button', { name: 'Scene' }))
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument()
  })

  it('works on search results too (board A4, panel 3)', async () => {
    const onResolve = jest.fn<Promise<BulkResult>, Parameters<ResolveFn>>(async (ids) => ok(ids))
    render(<Harness onResolve={onResolve} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'es' } })
    enter()
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Used up' }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1))
    // "es": parmesan and apples: matches by name only.
    expect([...onResolve.mock.calls[0][0]].sort()).toEqual(['a', 'parm'])
  })
})

describe('Scene is unchanged by the list work', () => {
  it('still has no row actions in the scene tiles', () => {
    render(<Harness initialView="scene" />)
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('storage-tile').length).toBeGreaterThan(0)
  })
})
