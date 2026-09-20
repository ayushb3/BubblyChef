/**
 * Issue #478 — one storage-location vocabulary.
 *
 * `LOCATIONS` used to be hand-typed in three components (edit modal, manual
 * add row, scan review card) in two different shapes. This pins that every
 * surface which offers a location now renders exactly the shared list from
 * `lib/pantry-vocab.ts`, and that no component or page declares its own copy
 * again.
 */
import fs from 'fs'
import path from 'path'
import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LOCATIONS, LOCATION_VALUES, DEFAULT_LOCATION } from '@/lib/pantry-vocab'
import EditItemModal from '@/components/pantry/AddItemModal'
import AddItemRow, { type ManualRow } from '@/components/pantry/AddItemRow'
import ScannedItemCard from '@/components/scan/ScannedItemCard'
import type { PantryItem } from '@/types/pantry'
import type { ScannedItem } from '@/types/scan'

jest.mock('@/lib/api/foods')

const EXPECTED_VALUES = ['fridge', 'freezer', 'pantry', 'counter']

function withQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('shared LOCATIONS vocabulary (#478)', () => {
  it('keeps the four stored values, in order, and derives the bare list from them', () => {
    expect(LOCATIONS.map((l) => l.value)).toEqual(EXPECTED_VALUES)
    expect(LOCATION_VALUES).toEqual(EXPECTED_VALUES)
    expect(EXPECTED_VALUES).toContain(DEFAULT_LOCATION)
    for (const l of LOCATIONS) expect(l.label.toLowerCase()).toBe(l.value)
  })

  it('EditItemModal renders one toggle per shared location', () => {
    const item: PantryItem = {
      id: 'i1',
      name: 'milk',
      category: 'dairy',
      location: 'fridge',
      quantity: 1,
      unit: 'gallon',
      expiry_date: null,
    }
    withQuery(<EditItemModal isOpen onClose={() => {}} editItem={item} />)
    const group = screen.getByRole('group', { name: /storage location/i })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(LOCATIONS.map((l) => l.label))
    expect(within(group).getByRole('button', { name: 'Fridge' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('AddItemRow offers exactly the shared locations in its select', () => {
    const row: ManualRow = {
      id: 'r1',
      name: '',
      quantity: 1,
      unit: 'item',
      category: 'other',
      storage_location: 'pantry',
      expiry_date: '',
      estimated_expiry: false,
    }
    withQuery(<AddItemRow row={row} onChange={() => {}} onRemove={() => {}} index={0} />)
    const select = screen.getByRole('combobox', { name: /storage location/i }) as HTMLSelectElement
    const options = Array.from(select.options)
    expect(options.map((o) => o.value)).toEqual(LOCATIONS.map((l) => l.value))
    expect(options.map((o) => o.textContent)).toEqual(LOCATIONS.map((l) => l.label))
  })

  it('ScannedItemCard offers exactly the shared locations in its select', () => {
    const item: ScannedItem = {
      name: 'Bananas',
      original_name: 'bananas',
      source_line: 'BANANAS 1.29',
      price: 1.29,
      quantity: 1,
      unit: 'bunch',
      category: 'produce',
      location: 'counter',
      confidence: 0.9,
    }
    render(
      <ScannedItemCard
        item={item}
        checked
        onChange={() => {}}
        onDismiss={() => {}}
        onCheckedChange={() => {}}
      />,
    )
    const select = screen.getByRole('combobox', { name: /^location$/i }) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual([...LOCATION_VALUES])
  })

  it('no component or page declares its own LOCATIONS list any more', () => {
    const roots = ['components', 'app'].map((d) => path.join(__dirname, '..', d))
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(full, 'utf8')
          if (/^\s*(export\s+)?const\s+LOCATIONS\s*[=:]/m.test(src)) offenders.push(full)
        }
      }
    }
    roots.forEach(walk)
    expect(offenders).toEqual([])
  })
})
