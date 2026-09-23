/**
 * Issue #397 — the kitchen-location field is gone from the UI.
 *
 * This file was written for #478 (one shared `LOCATIONS` vocabulary). #397
 * removes that vocabulary outright: the Fridge/Freezer/Pantry/Counter field
 * only fed the gamified kitchen scene, which is on hold (PR #124). The
 * `pantry_items.location` column stays (it has a DEFAULT, so no migration),
 * and the scan path still forwards the AI service's category-derived value
 * because the server's expiry heuristic scales by it — but no surface shows,
 * offers or edits a location any more.
 *
 * Four `it(...)` names here were rewritten to say what each test now asserts.
 * That trips `scripts/agent-gates/test-count-guard.sh`, which matches test
 * names textually and reads a rename as a deletion — so this PR carries the
 * `test-removal-approved` label. Keeping the old names would have left a test
 * called "renders one toggle per shared location" asserting that no toggle
 * exists: a passing test that lies to the next person who greps for the
 * behaviour, which is worse than tripping the guard.
 */
import fs from 'fs'
import path from 'path'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import EditItemModal from '@/components/pantry/AddItemModal'
import AddItemRow, { type ManualRow } from '@/components/pantry/AddItemRow'
import ScannedItemCard from '@/components/scan/ScannedItemCard'
import { scannedToBulkAddItem } from '@/lib/scan-helpers'
import * as pantryApi from '@/lib/api/pantry'
import type { PantryItem } from '@/types/pantry'
import type { ScannedItemWithId } from '@/lib/scan-helpers'

jest.mock('@/lib/api/foods')
jest.mock('@/lib/api/pantry')

const mockUpdatePantryItem = pantryApi.updatePantryItem as jest.MockedFunction<
  typeof pantryApi.updatePantryItem
>

/** The four strings the column has always stored, in the order #478 pinned. */
const STORED_VALUES = ['fridge', 'freezer', 'pantry', 'counter']

function withQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function scanned(location: string | undefined): ScannedItemWithId {
  return {
    _id: 'bananas-1',
    name: 'Bananas',
    original_name: 'bananas',
    source_line: 'BANANAS 1.29',
    price: 1.29,
    quantity: 1,
    unit: 'bunch',
    category: 'produce',
    location: location as string,
    confidence: 0.9,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('no kitchen-location surface anywhere (#397)', () => {
  // Now checks: the scan write path forwards whichever of the four stored
  // values the AI service derived, unchanged and in order, and falls back to
  // the column's own default when the parse has none. The UI never remaps
  // these strings — the column is untouched by #397.
  it('scan path still forwards the AI-derived location unchanged, defaulting to pantry', () => {
    const forwarded = STORED_VALUES.map((v) => scannedToBulkAddItem(scanned(v)).storage_location)
    expect(forwarded).toEqual(STORED_VALUES)
    expect(scannedToBulkAddItem(scanned(undefined)).storage_location).toBe('pantry')
  })

  // Now checks: the edit modal renders no storage-location control at all,
  // and saving omits `location` from the update so the stored value is
  // preserved rather than rewritten.
  it('EditItemModal shows no storage-location control and omits location when saving', async () => {
      mockUpdatePantryItem.mockResolvedValue({} as PantryItem)
      const item: PantryItem = {
        id: 'i1',
        name: 'milk',
        category: 'dairy',
        location: 'fridge',
        quantity: 1,
        unit: 'gallon',
        expiry_date: null,
      }
      const onClose = jest.fn()
      withQuery(<EditItemModal isOpen onClose={onClose} editItem={item} />)

      expect(screen.queryByRole('group', { name: /storage location/i })).not.toBeInTheDocument()
      expect(screen.queryByText(/storage location/i)).not.toBeInTheDocument()
      for (const label of ['Fridge', 'Freezer', 'Pantry', 'Counter']) {
        expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
      }

      fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
      await waitFor(() => expect(mockUpdatePantryItem).toHaveBeenCalledTimes(1))
      const [id, updates] = mockUpdatePantryItem.mock.calls[0]
      expect(id).toBe('i1')
      expect(updates).not.toHaveProperty('location')
      expect(updates).not.toHaveProperty('storage_location')
      expect(updates).toMatchObject({ name: 'milk', category: 'dairy' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  // Now checks: the manual add row has no storage-location select; its only
  // selects are Unit and Category.
  it('AddItemRow shows no storage-location select', () => {
    const row: ManualRow = {
      id: 'r1',
      name: '',
      quantity: 1,
      unit: 'item',
      category: 'other',
      expiry_date: '',
      estimated_expiry: false,
    }
    withQuery(<AddItemRow row={row} onChange={() => {}} onRemove={() => {}} index={0} />)
    expect(screen.queryByRole('combobox', { name: /storage location/i })).not.toBeInTheDocument()
    const selects = screen.getAllByRole('combobox').filter((el) => el.tagName === 'SELECT')
    expect(selects.map((s) => s.getAttribute('aria-label'))).toEqual(['Unit', 'Category'])
  })

  // Now checks: the scan review card has no Location select, only Category,
  // and the card never edits `item.location` (the backend-derived value
  // rides through untouched).
  it('ScannedItemCard shows no storage-location select', () => {
    const onChange = jest.fn()
    render(
      <ScannedItemCard
        item={scanned('counter')}
        checked
        onChange={onChange}
        onDismiss={() => {}}
        onCheckedChange={() => {}}
      />,
    )
    expect(screen.queryByRole('combobox', { name: /^location$/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/^location$/i)).not.toBeInTheDocument()
    const selects = screen.getAllByRole('combobox').filter((el) => el.tagName === 'SELECT')
    expect(selects.map((s) => s.getAttribute('aria-label'))).toEqual(['Category'])

    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), {
      target: { value: 'dairy' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ category: 'dairy', location: 'counter' }))
  })

  // Now checks: the shared vocabulary module is gone and nothing under
  // components/, app/ or lib/ declares or imports a location list.
  it('no component or page declares its own LOCATIONS list any more', () => {
    const src = path.join(__dirname, '..')
    expect(fs.existsSync(path.join(src, 'lib', 'pantry-vocab.ts'))).toBe(false)

    const roots = ['components', 'app', 'lib'].map((d) => path.join(src, d))
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8')
          if (/^\s*(export\s+)?const\s+LOCATIONS?\s*[=:]/m.test(text)) offenders.push(full)
          if (/\bLOCATION_VALUES\b|\bDEFAULT_LOCATION\b|pantry-vocab/.test(text)) offenders.push(full)
        }
      }
    }
    roots.forEach(walk)
    expect(offenders).toEqual([])
  })
})
