/**
 * The storage sheet (issue #749, board A2 "Tap the fridge"): header, search
 * across every place, place tabs with counts, the Scene and List views, and the
 * add key.
 */
import React, { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import StorageSheet, { type StorageView } from '@/components/kitchen/StorageSheet'
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
  item('p', 'peas', 'freezer', { category: 'frozen', quantity: 2, unit: 'bag' }),
  item('rice', 'rice', 'pantry', { category: 'dry_goods', unit: 'kg' }),
  item('parm', 'parmesan', 'pantry', { category: 'dairy', unit: 'wedge' }),
  item('a', 'apples', 'counter', { quantity: 5 }),
]

function Harness({
  initialPlace = 'fridge',
  initialView = 'scene',
  items = ITEMS,
  onEdit = jest.fn(),
  onAdd = jest.fn(),
  onClose = jest.fn(),
  status = 'ready',
}: {
  initialPlace?: PlaceKey
  initialView?: StorageView
  items?: StoredItem[] | null
  onEdit?: (item: StoredItem) => void
  onAdd?: (place: PlaceKey) => void
  onClose?: () => void
  status?: 'loading' | 'error' | 'ready'
}) {
  const [place, setPlace] = useState<PlaceKey>(initialPlace)
  const [view, setView] = useState<StorageView>(initialView)
  return (
    <StorageSheet
      open
      place={place}
      view={view}
      items={items}
      status={status}
      palette={palette}
      today={TODAY}
      onPlaceChange={setPlace}
      onViewChange={setView}
      onClose={onClose}
      onEdit={onEdit}
      onAdd={onAdd}
      onRetry={jest.fn()}
    />
  )
}

describe('header', () => {
  it('names the place with its count and how many to use soon', () => {
    render(<Harness />)
    const dialog = screen.getByRole('dialog', { name: 'Fridge' })
    expect(dialog).toHaveTextContent('4 items')
    expect(dialog).toHaveTextContent('2 to use soon')
    expect(within(dialog).getByTestId('place-sprite')).toHaveAttribute('data-place', 'fridge')
  })

  it('leaves out "to use soon" when nothing is', () => {
    render(<Harness initialPlace="freezer" />)
    const dialog = screen.getByRole('dialog', { name: 'Freezer' })
    expect(dialog).toHaveTextContent('1 item')
    expect(dialog).not.toHaveTextContent('to use soon')
  })

  it('has a close button that closes', () => {
    const onClose = jest.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('place tabs', () => {
  it('shows all four places with their counts, the open one selected', () => {
    render(<Harness />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Fridge 4',
      'Freezer 1',
      'Shelves 2',
      'Basket 1',
    ])
    expect(screen.getByRole('tab', { name: /Fridge/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Basket/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('switches place without closing the sheet', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: /Shelves/ }))
    expect(screen.getByRole('dialog', { name: 'Shelves' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Rice/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Milk/ })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Shelves/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('moves between tabs with the arrow keys', () => {
    render(<Harness />)
    const fridge = screen.getByRole('tab', { name: /Fridge/ })
    fridge.focus()
    fireEvent.keyDown(fridge, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /Freezer/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Freezer/ })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: /Freezer/ }), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: /Fridge/ })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('Scene view', () => {
  it('leads with "Use first": what needs using soonest, with its food tag', () => {
    render(<Harness />)
    const section = screen.getByRole('region', { name: 'Use first' })
    const tiles = within(section).getAllByTestId('storage-tile')
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual([
      'Romaine, 1 head, expires today',
      'Chicken Thighs, 4, expires in 3 days',
    ])
    expect(within(tiles[0]).getByTestId('storage-expiry-pill')).toHaveTextContent('Today')
  })

  it('groups the rest by food category, without repeating the use-first items', () => {
    render(<Harness />)
    expect(screen.getByRole('heading', { name: 'Produce' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Dairy and eggs' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Romaine/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Lemons, 1$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Milk, 1 L$/ })).toBeInTheDocument()
  })

  it('"Plan dinner around these" seeds the plan-dinner chat with the use-first foods', () => {
    render(<Harness />)
    const link = screen.getByRole('link', { name: 'Plan dinner around these' })
    const href = link.getAttribute('href')!
    const params = new URL(href, 'http://x').searchParams
    expect(params.get('plan')).toBe('dinner')
    expect(params.get('with')).toBe('romaine|chicken thighs')
  })

  it('shows no Use first row when nothing needs using', () => {
    render(<Harness initialPlace="shelves" />)
    expect(screen.queryByRole('region', { name: 'Use first' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /plan dinner/i })).not.toBeInTheDocument()
  })

  it('tapping a tile opens that item to edit', () => {
    const onEdit = jest.fn()
    render(<Harness onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: /^Lemons/ }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'l', name: 'lemons' }))
  })

  it('says so when the place is empty', () => {
    render(<Harness items={ITEMS.filter((i) => i.location !== 'counter')} initialPlace="basket" />)
    expect(screen.getByText(/nothing in the basket yet/i)).toBeInTheDocument()
  })
})

describe('Scene | List', () => {
  it('switches views without closing the sheet', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Scene' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByRole('dialog', { name: 'Fridge' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('region', { name: 'Use first' })).not.toBeInTheDocument()
    // The same place's items, as rows: name, quantity, tag; tap to edit.
    expect(screen.getAllByTestId('storage-row')).toHaveLength(4)
    expect(screen.queryAllByTestId('storage-tile')).toHaveLength(0)
  })

  it('lists every item in the place, soonest first inside each food group', () => {
    render(<Harness initialView="list" />)
    const rows = screen.getAllByTestId('storage-row').map((r) => r.getAttribute('aria-label'))
    expect(rows).toEqual([
      'Romaine, 1 head, expires today',
      'Lemons, 1',
      'Milk, 1 L',
      'Chicken Thighs, 4, expires in 3 days',
    ])
  })

  it('tapping a row opens that item to edit', () => {
    const onEdit = jest.fn()
    render(<Harness initialView="list" onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: /^Milk/ }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'm' }))
  })
})

describe('search', () => {
  it('says how many items it covers across every place', () => {
    render(<Harness />)
    expect(screen.getByRole('searchbox', { name: /search/i })).toHaveAttribute(
      'placeholder',
      'Search all 8 items',
    )
  })

  it('finds "parm" from the Fridge sheet wherever it is stored, labelled with its place', () => {
    render(<Harness />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'parm' } })

    expect(screen.getByRole('status')).toHaveTextContent('1 match in every place')
    const row = screen.getByRole('button', { name: /^Parmesan/ })
    expect(row).toHaveAccessibleName(/in the Shelves$/)
    expect(row).toHaveTextContent('Shelves · Dairy and eggs')
    // Tabs and the scene give way to the results.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Use first' })).not.toBeInTheDocument()
  })

  it('groups matches by place, and names the places with none', () => {
    render(<Harness />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'e' } })
    expect(screen.getByRole('heading', { level: 3, name: /^Fridge/ })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'parm' } })
    expect(screen.getByText('Fridge, Freezer and Basket: nothing matches.')).toBeInTheDocument()
  })

  it('opens a result to edit', () => {
    const onEdit = jest.fn()
    render(<Harness onEdit={onEdit} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'parm' } })
    fireEvent.click(screen.getByRole('button', { name: /^Parmesan/ }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'parm' }))
  })

  it('says so when nothing matches', () => {
    render(<Harness />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.getByRole('status')).toHaveTextContent('No matches for “zzz”')
  })

  it('clears with the clear button, and Escape clears before it closes the sheet', () => {
    const onClose = jest.fn()
    render(<Harness onClose={onClose} />)
    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'parm' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box).toHaveValue('')
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.change(box, { target: { value: 'milk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(box).toHaveValue('')
  })
})

describe('add key', () => {
  it.each([
    ['fridge', 'Add to the fridge'],
    ['freezer', 'Add to the freezer'],
    ['shelves', 'Add to the shelves'],
    ['basket', 'Add to the basket'],
  ] as const)('on the %s: "%s", with that place', (place, label) => {
    const onAdd = jest.fn()
    render(<Harness initialPlace={place} onAdd={onAdd} />)
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(onAdd).toHaveBeenCalledWith(place)
  })
})

describe('loading and failure', () => {
  it('shows a loading state, not a made-up empty place', () => {
    render(<Harness items={null} status="loading" />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(screen.queryByText(/nothing in the fridge/i)).not.toBeInTheDocument()
  })

  it('offers a retry when the pantry could not be loaded', () => {
    render(<Harness items={null} status="error" />)
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load/i)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
