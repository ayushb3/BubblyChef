/**
 * The put-away sheet (issue #753, board A3 "After a scan: put the shopping
 * away"): the shared scan review surface regrouped by place, over the kitchen.
 *
 * Pins the acceptance behaviour: nothing is written before "Put away" (no
 * POST), after it each item is saved with its displayed place, Fix changes an
 * item's place and Yes moves it into Going in, a failed write keeps the sheet
 * and the items and wiggles the key, Discard clears the pending scan, and the
 * edits survive a reload (they are written back to the pending record).
 * The pantry write is mocked; no model is ever called.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PutAwaySheet from '@/components/kitchen/PutAwaySheet'
import { usePendingPutAway } from '@/hooks/usePendingPutAway'
import {
  PENDING_PUTAWAY_KEY,
  clearPendingPutAway,
  pendingFromScan,
  readPendingPutAway,
  savePendingPutAway,
} from '@/lib/kitchen/pending-putaway'
import * as pantryApi from '@/lib/api/pantry'
import type { ScanResult } from '@/types/scan'

jest.mock('@/lib/api/pantry')
const mockBulkAdd = pantryApi.bulkAddPantryItems as jest.MockedFunction<
  typeof pantryApi.bulkAddPantryItems
>

function it_(name: string, location: string, over: Record<string, unknown> = {}) {
  return {
    name,
    original_name: name.toLowerCase(),
    source_line: name.toUpperCase(),
    price: 1,
    quantity: 1,
    unit: 'item',
    category: 'other',
    location,
    confidence: 0.95,
    ...over,
  }
}

// The board's receipt: 9 confident items, 2 to ask about, 2 skipped lines.
const SCAN: ScanResult = {
  ocr_text: "TRADER JOE'S\nGRN PEP 2 @ 0.89",
  ready_to_add: [
    it_('Chicken thighs', 'fridge'),
    it_('Milk', 'fridge'),
    it_('Feta', 'fridge'),
    it_('Lemons', 'fridge'),
    it_('Peas', 'freezer'),
    it_('Orzo', 'pantry'),
    it_('Chickpeas', 'pantry'),
    it_('Bananas', 'counter'),
    it_('Garlic', 'counter'),
  ],
  needs_review: [
    it_('Green peppers', 'fridge', { quantity: 2, source_line: 'GRN PEP 2 @ 0.89', confidence: 0.6 }),
    it_('Mango mochi', 'freezer', { unit: 'box', source_line: 'TJ MOCHI MANGO', confidence: 0.55 }),
  ],
  skipped: [it_('Bag fee', 'pantry', { confidence: 0.2 }), it_('Tax', 'pantry', { confidence: 0.1 })],
  total_items: 13,
  warnings: [],
}

const originalScrollTo = window.scrollTo

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo
})
afterAll(() => {
  window.scrollTo = originalScrollTo
})

function Harness({
  onClose = jest.fn(),
  onPutAway = jest.fn(),
}: {
  onClose?: () => void
  onPutAway?: (count: number) => void | Promise<void>
}) {
  const record = usePendingPutAway()
  return <PutAwaySheet open record={record} onClose={onClose} onPutAway={onPutAway} />
}

function renderSheet(scan: ScanResult = SCAN, props: React.ComponentProps<typeof Harness> = {}) {
  savePendingPutAway(pendingFromScan(scan))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  )
}

function bulkPayload() {
  return mockBulkAdd.mock.calls[0][0]
}

describe('what the sheet shows (board A3)', () => {
  it('asks "Put the shopping away?" with the store and the item count', () => {
    renderSheet()
    const dialog = screen.getByRole('dialog', { name: 'Put the shopping away?' })
    // 11 = Going in 9 + the 2 asked about; skipped lines are not items.
    expect(within(dialog).getByText(/Trader Joe's · 11 items/)).toBeInTheDocument()
  })

  it('leaves the store out when the receipt does not say, instead of guessing wrong', () => {
    renderSheet({ ...SCAN, ocr_text: 'MILK 4.29' })
    expect(screen.getByText('11 items')).toBeInTheDocument()
  })

  it('asks about the unsure items first: emoji, name · quantity, the receipt line, "→ Place"', () => {
    renderSheet()
    expect(screen.getByRole('heading', { name: /Did I read these right\? 2/ })).toBeInTheDocument()
    const peppers = screen.getByRole('listitem', { name: /Green peppers/ })
    expect(within(peppers).getByText(/Green peppers · 2/)).toBeInTheDocument()
    expect(within(peppers).getByText('GRN PEP 2 @ 0.89')).toBeInTheDocument()
    expect(within(peppers).getByText('→ Fridge')).toBeInTheDocument()
    expect(within(peppers).getByRole('button', { name: 'Fix Green peppers' })).toBeInTheDocument()
    expect(within(peppers).getByRole('button', { name: /^Yes.*Green peppers/ })).toBeInTheDocument()
    // A unit other than "item" rides along: "1 box".
    const mochi = screen.getByRole('listitem', { name: /Mango mochi/ })
    expect(within(mochi).getByText(/Mango mochi · 1 box/)).toBeInTheDocument()
    expect(within(mochi).getByText('→ Freezer')).toBeInTheDocument()
  })

  it('groups Going in by place with each count, each group with Edit', () => {
    renderSheet()
    expect(screen.getByRole('heading', { name: /Going in 9/ })).toBeInTheDocument()
    const fridge = screen.getByRole('group', { name: /Fridge, 4 items/ })
    expect(within(fridge).getByText('Chicken thighs')).toBeInTheDocument()
    expect(within(fridge).getByText('Lemons')).toBeInTheDocument()
    expect(within(fridge).getByRole('button', { name: 'Edit Fridge items' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Freezer, 1 item/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Shelves, 2 items/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Basket, 2 items/ })).toBeInTheDocument()
  })

  it('leaves a place with nothing headed there out of Going in', () => {
    renderSheet({ ...SCAN, ready_to_add: [it_('Milk', 'fridge')], needs_review: [] })
    expect(screen.getByRole('group', { name: /Fridge, 1 item/ })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Basket/ })).not.toBeInTheDocument()
  })

  it('summarises the skipped lines and lets you see them', () => {
    renderSheet()
    expect(screen.getByText(/Skipped 2 lines: Bag fee, Tax\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show skipped lines' }))
    expect(screen.getByText('BAG FEE')).toBeInTheDocument()
    expect(screen.getByText('TAX')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide skipped lines' })).toBeInTheDocument()
  })

  it('has the primary key with the count and says nothing goes in until it is tapped', () => {
    renderSheet()
    expect(screen.getByRole('button', { name: 'Put away 9 items' })).toBeEnabled()
    expect(screen.getByText('Nothing goes in until you tap this.')).toBeInTheDocument()
  })

  it('shows the scan warnings', () => {
    renderSheet({ ...SCAN, warnings: ['Image quality was low.'] })
    expect(screen.getByText('Image quality was low.')).toBeInTheDocument()
  })
})

describe('nothing is written before the tap', () => {
  it('opens, edits and answers without a single pantry write', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: /^Yes.*Green peppers/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Fix Mango mochi' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Fridge items' }))
    expect(mockBulkAdd).not.toHaveBeenCalled()
  })

  it('writes every item with its displayed place when Put away is tapped', async () => {
    mockBulkAdd.mockResolvedValue({ count: 11, items: [] })
    const onPutAway = jest.fn()
    renderSheet(SCAN, { onPutAway })

    // The two asked-about lines go in once answered Yes.
    fireEvent.click(screen.getByRole('button', { name: /^Yes.*Green peppers/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Yes.*Mango mochi/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Put away 11 items' }))

    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    const payload = bulkPayload()
    expect(payload).toHaveLength(11)
    const place = (name: string) => payload.find((p) => p.name === name)?.storage_location
    expect(place('Milk')).toBe('fridge')
    expect(place('Peas')).toBe('freezer')
    expect(place('Orzo')).toBe('pantry')
    expect(place('Bananas')).toBe('counter')
    expect(place('Green peppers')).toBe('fridge')
    expect(place('Mango mochi')).toBe('freezer')
    // Skipped lines are never written.
    expect(payload.map((p) => p.name)).not.toContain('Bag fee')
    expect(payload.every((p) => p.source === 'scan')).toBe(true)
    await waitFor(() => expect(onPutAway).toHaveBeenCalledWith(11))
  })

  it('clears the pending scan after a successful write and closes the sheet', async () => {
    mockBulkAdd.mockResolvedValue({ count: 9, items: [] })
    const onClose = jest.fn()
    renderSheet(SCAN, { onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Put away 9 items' }))

    await waitFor(() => expect(readPendingPutAway()).toBeNull())
    expect(onClose).toHaveBeenCalled()
  })

  it('sends one write for a double tap', async () => {
    let resolve!: () => void
    mockBulkAdd.mockImplementation(
      () => new Promise((r) => { resolve = () => r({ count: 9, items: [] }) }),
    )
    renderSheet()
    const key = screen.getByRole('button', { name: 'Put away 9 items' })
    fireEvent.click(key)
    fireEvent.click(key)
    expect(mockBulkAdd).toHaveBeenCalledTimes(1)
    await act(async () => resolve())
  })
})

// Issue #753 says the review "keeps its tiers and its confirm semantics" and that
// Yes moves a needs-review item into Going in. So a line nobody answered is not
// going in: the key counts and writes only Going in (the ready tier plus any line
// answered Yes or fixed), and says so while any line is unanswered.
describe('unanswered lines stay out', () => {
  // 10 confident items and 2 the scan was unsure about.
  const TEN_AND_TWO: ScanResult = {
    ...SCAN,
    ready_to_add: [...SCAN.ready_to_add, it_('Rice', 'pantry')],
  }

  it('writes only Going in: 10 ready + 2 unanswered posts exactly 10', async () => {
    mockBulkAdd.mockResolvedValue({ count: 10, items: [] })
    renderSheet(TEN_AND_TWO)

    fireEvent.click(screen.getByRole('button', { name: 'Put away 10 items' }))

    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    const names = bulkPayload().map((p) => p.name)
    expect(names).toHaveLength(10)
    expect(names).not.toContain('Green peppers')
    expect(names).not.toContain('Mango mochi')
  })

  it('Yes on one of them makes it 11, and that one is written', async () => {
    mockBulkAdd.mockResolvedValue({ count: 11, items: [] })
    renderSheet(TEN_AND_TWO)

    fireEvent.click(screen.getByRole('button', { name: /^Yes.*Green peppers/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Put away 11 items' }))

    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    const names = bulkPayload().map((p) => p.name)
    expect(names).toHaveLength(11)
    expect(names).toContain('Green peppers')
    expect(names).not.toContain('Mango mochi')
  })

  it('a fixed line (Fix, then Done) counts as answered; one still being edited does not', () => {
    renderSheet(TEN_AND_TWO)
    const mochi = screen.getByRole('listitem', { name: /Mango mochi/ })
    fireEvent.click(within(mochi).getByRole('button', { name: 'Fix Mango mochi' }))
    fireEvent.change(within(mochi).getByRole('textbox', { name: 'Item name' }), {
      target: { value: 'Mango mochi box' },
    })
    expect(screen.getByRole('button', { name: 'Put away 10 items' })).toBeInTheDocument()

    fireEvent.click(within(mochi).getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Put away 11 items' })).toBeInTheDocument()
    const freezer = screen.getByRole('group', { name: /Freezer, 2 items/ })
    expect(within(freezer).getByText('Mango mochi box')).toBeInTheDocument()
  })

  it('says so under the key while any line is unanswered, then stops', () => {
    renderSheet(TEN_AND_TWO)
    expect(
      screen.getByText('2 still to check, they stay out until you tap Yes'),
    ).toBeInTheDocument()
    // The standing promise is still there beside it.
    expect(screen.getByText('Nothing goes in until you tap this.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Yes.*Green peppers/ }))
    expect(screen.getByText('1 still to check, it stays out until you tap Yes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Yes.*Mango mochi/ }))
    expect(screen.queryByText(/still to check/)).not.toBeInTheDocument()
  })

  it('leaving an unanswered line out drops it from "still to check" too', () => {
    renderSheet(TEN_AND_TWO)
    const peppers = screen.getByRole('listitem', { name: /Green peppers/ })
    fireEvent.click(within(peppers).getByRole('button', { name: 'Fix Green peppers' }))
    fireEvent.click(within(peppers).getByRole('button', { name: 'Leave out Green peppers' }))
    expect(screen.getByText('1 still to check, it stays out until you tap Yes')).toBeInTheDocument()
  })

  it('with nothing going in but lines to check, the key is off and the line says why', () => {
    renderSheet({ ...SCAN, ready_to_add: [], skipped: [] })
    expect(screen.getByRole('button', { name: 'Nothing to put away' })).toBeDisabled()
    expect(screen.getByText('2 still to check, they stay out until you tap Yes')).toBeInTheDocument()
  })
})

describe('Yes and Fix', () => {
  it('Yes moves a needs-review item into Going in', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: /^Yes.*Green peppers/ }))

    expect(screen.queryByRole('listitem', { name: /Green peppers/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Did I read these right\? 1/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Going in 10/ })).toBeInTheDocument()
    const fridge = screen.getByRole('group', { name: /Fridge, 5 items/ })
    expect(within(fridge).getByText('Green peppers')).toBeInTheDocument()
    // Answering Yes puts it into what will be put away.
    expect(screen.getByRole('button', { name: 'Put away 10 items' })).toBeInTheDocument()
  })

  it('Yes on the last question takes the section away', () => {
    renderSheet({ ...SCAN, needs_review: [SCAN.needs_review[0]] })
    fireEvent.click(screen.getByRole('button', { name: /^Yes.*Green peppers/ }))
    expect(screen.queryByRole('heading', { name: /Did I read these right/ })).not.toBeInTheDocument()
  })

  it('Fix edits the name, quantity and place inline', async () => {
    mockBulkAdd.mockResolvedValue({ count: 9, items: [] })
    renderSheet()
    const peppers = screen.getByRole('listitem', { name: /Green peppers/ })
    fireEvent.click(within(peppers).getByRole('button', { name: 'Fix Green peppers' }))

    fireEvent.change(within(peppers).getByRole('textbox', { name: 'Item name' }), {
      target: { value: 'Green bell peppers' },
    })
    fireEvent.change(within(peppers).getByRole('spinbutton', { name: 'Quantity' }), {
      target: { value: '3' },
    })
    fireEvent.click(within(peppers).getByRole('radio', { name: 'Basket' }))
    fireEvent.click(within(peppers).getByRole('button', { name: 'Done' }))

    // Done answers the line: it moves into Going in, under its new place.
    expect(screen.queryByRole('listitem', { name: /Green/ })).not.toBeInTheDocument()
    const basket = screen.getByRole('group', { name: /Basket, 3 items/ })
    expect(within(basket).getByText('Green bell peppers')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Put away 10 items' }))
    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    const written = bulkPayload().find((p) => p.name === 'Green bell peppers')
    expect(written).toMatchObject({ quantity: 3, storage_location: 'counter' })
  })

  it('moving an item to another place moves it between the Going in groups', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Fridge items' }))
    const row = screen.getByRole('group', { name: 'Edit Milk' })
    fireEvent.click(within(row).getByRole('radio', { name: 'Freezer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done editing Fridge' }))

    expect(screen.getByRole('group', { name: /Fridge, 3 items/ })).toBeInTheDocument()
    const freezer = screen.getByRole('group', { name: /Freezer, 2 items/ })
    expect(within(freezer).getByText('Milk')).toBeInTheDocument()
  })

  it('a quantity that is not a number never replaces the real one', () => {
    renderSheet()
    const peppers = screen.getByRole('listitem', { name: /Green peppers/ })
    fireEvent.click(within(peppers).getByRole('button', { name: 'Fix Green peppers' }))
    const qty = within(peppers).getByRole('spinbutton', { name: 'Quantity' })
    fireEvent.change(qty, { target: { value: '' } })
    fireEvent.blur(qty)
    expect(qty).toHaveValue(2)
  })

  it('leaves an item out of the shopping', async () => {
    mockBulkAdd.mockResolvedValue({ count: 9, items: [] })
    renderSheet()
    const peppers = screen.getByRole('listitem', { name: /Green peppers/ })
    fireEvent.click(within(peppers).getByRole('button', { name: 'Fix Green peppers' }))
    fireEvent.click(within(peppers).getByRole('button', { name: 'Leave out Green peppers' }))

    expect(screen.getByRole('button', { name: 'Put away 9 items' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Put away 9 items' }))
    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    expect(bulkPayload().map((p) => p.name)).not.toContain('Green peppers')
  })

  it('a skipped line can be added back, to be asked about', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Show skipped lines' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Bag fee' }))
    expect(screen.getByRole('listitem', { name: /Bag fee/ })).toBeInTheDocument()
    // Added back means asked about, not going in: the key still says 9.
    expect(screen.getByRole('button', { name: 'Put away 9 items' })).toBeInTheDocument()
    expect(screen.getByText('3 still to check, they stay out until you tap Yes')).toBeInTheDocument()
    expect(screen.getByText(/Skipped 1 line: Tax\./)).toBeInTheDocument()
  })
})

describe('the pending scan', () => {
  it('writes edits back, so a reload reopens put-away with them', () => {
    const view = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: /^Yes.*Green peppers/ }))

    const stored = readPendingPutAway()!
    expect(stored.review.map((i) => i.name)).toEqual(['Mango mochi'])
    expect(stored.ready.map((i) => i.name)).toContain('Green peppers')

    view.unmount()
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('heading', { name: /Going in 10/ })).toBeInTheDocument()
  })

  it('Discard clears the pending scan, after asking once', () => {
    const onClose = jest.fn()
    renderSheet(SCAN, { onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Discard this scan' }))
    expect(readPendingPutAway()).not.toBeNull()
    expect(screen.getByText('Discard this scan?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Yes, discard it' }))
    expect(readPendingPutAway()).toBeNull()
    expect(window.localStorage.getItem(PENDING_PUTAWAY_KEY)).toBeNull()
    expect(onClose).toHaveBeenCalled()
    expect(mockBulkAdd).not.toHaveBeenCalled()
  })

  it('"Keep it" backs out of a discard', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Discard this scan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(readPendingPutAway()).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Put away 9 items' })).toBeInTheDocument()
  })

  it('closing the sheet leaves the scan pending', () => {
    const onClose = jest.fn()
    renderSheet(SCAN, { onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
    expect(readPendingPutAway()).not.toBeNull()
  })

  it('finishes with the scan when every line is left out, rather than keep an empty one', () => {
    const onClose = jest.fn()
    renderSheet(
      { ...SCAN, ready_to_add: [it_('Milk', 'fridge')], needs_review: [], skipped: [] },
      { onClose },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Fridge items' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave out Milk' }))
    expect(readPendingPutAway()).toBeNull()
    expect(onClose).toHaveBeenCalled()
    expect(mockBulkAdd).not.toHaveBeenCalled()
  })

  it('clears the pending scan when every item is left out and only skipped lines remain', () => {
    // So the home row can never say "0 items".
    const onClose = jest.fn()
    renderSheet({ ...SCAN, ready_to_add: [it_('Milk', 'fridge')], needs_review: [] }, { onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Fridge items' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave out Milk' }))
    expect(readPendingPutAway()).toBeNull()
    expect(onClose).toHaveBeenCalled()
    expect(mockBulkAdd).not.toHaveBeenCalled()
  })
})

describe('a failed write', () => {
  it('keeps the sheet and the items, shows a friendly error and wiggles the key', async () => {
    mockBulkAdd.mockRejectedValue(new Error('duplicate key value violates constraint "x"'))
    const onClose = jest.fn()
    const onPutAway = jest.fn()
    renderSheet(SCAN, { onClose, onPutAway })

    const wiggle = () => screen.getByTestId('put-away-key').getAttribute('data-wiggles')
    expect(wiggle()).toBe('0')

    fireEvent.click(screen.getByRole('button', { name: 'Put away 9 items' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't put the shopping away/i)
    // Never the raw server message.
    expect(document.body.textContent).not.toMatch(/duplicate key|constraint/)
    expect(wiggle()).toBe('1')

    // The sheet, the items and the pending scan are all still there; nothing animates in.
    expect(screen.getByRole('dialog', { name: 'Put the shopping away?' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Going in 9/ })).toBeInTheDocument()
    expect(readPendingPutAway()).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(onPutAway).not.toHaveBeenCalled()

    // And the key works again: a retry that succeeds finishes the job.
    mockBulkAdd.mockResolvedValue({ count: 9, items: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Put away 9 items' }))
    await waitFor(() => expect(readPendingPutAway()).toBeNull())
    expect(onPutAway).toHaveBeenCalledWith(9)
  })

  it('a second failure wiggles again', async () => {
    mockBulkAdd.mockRejectedValue(new Error('nope'))
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Put away 9 items' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Put away 9 items' }))
    await waitFor(() =>
      expect(screen.getByTestId('put-away-key').getAttribute('data-wiggles')).toBe('2'),
    )
  })
})

it('survives the record vanishing under it (put away in another tab)', () => {
  renderSheet()
  expect(() => act(() => clearPendingPutAway())).not.toThrow()
})
