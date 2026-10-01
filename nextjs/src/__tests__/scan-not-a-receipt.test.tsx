/**
 * Issue #856: a scan of something that is not a receipt (an app screenshot read
 * as "Fresh bread") must say so before anything is put away.
 *
 * The AI service's receipt parse returns `is_receipt`. The scan client carries it
 * (a missing field means a receipt, so an older service changes nothing), the
 * pending put-away record keeps it, and the shared `ReviewSurface` shows "This
 * doesn't look like a receipt" with "Try another photo" first and "Use it anyway"
 * second. While it is up nothing is going in: the put-away key is off.
 * Every model call is mocked (no network at all).
 */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReviewSurface from '@/components/scan/ReviewSurface'
import PutAwaySheet from '@/components/kitchen/PutAwaySheet'
import { usePendingPutAway } from '@/hooks/usePendingPutAway'
import { uploadReceipt } from '@/lib/api/scan'
import {
  clearPendingPutAway,
  pendingFromScan,
  parsePendingPutAway,
  readPendingPutAway,
  savePendingPutAway,
  PENDING_PUTAWAY_KEY,
} from '@/lib/kitchen/pending-putaway'
import * as pantryApi from '@/lib/api/pantry'
import type { ScanResult } from '@/types/scan'
import type { ScannedItemWithId } from '@/lib/scan-helpers'

jest.mock('@/lib/api/pantry')
const mockBulkAdd = pantryApi.bulkAddPantryItems as jest.MockedFunction<
  typeof pantryApi.bulkAddPantryItems
>

const BREAD = {
  name: 'Fresh bread',
  original_name: 'fresh bread',
  source_line: 'Fresh bread',
  price: null,
  quantity: 1,
  unit: 'item',
  category: 'bakery',
  location: 'pantry',
  confidence: 0.9,
}

const SCREENSHOT_SCAN: ScanResult = {
  ocr_text: 'BubblyChef\nFresh bread\nExpires in 2 days',
  ready_to_add: [BREAD],
  needs_review: [],
  skipped: [],
  total_items: 1,
  warnings: [],
  is_receipt: false,
}

const RECEIPT_SCAN: ScanResult = { ...SCREENSHOT_SCAN, is_receipt: true }

function stamped(): ScannedItemWithId {
  return { ...BREAD, _id: 'bread-1' }
}

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo
})

describe('the scan client carries is_receipt', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  function respondWith(body: object) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    }) as unknown as typeof fetch
  }
  const file = () => new File(['x'], 'shot.png', { type: 'image/png' })

  it('passes a false verdict through', async () => {
    respondWith(SCREENSHOT_SCAN)
    await expect(uploadReceipt(file())).resolves.toMatchObject({ is_receipt: false })
  })

  it('reads a response without the field as a receipt', async () => {
    const { is_receipt: _omit, ...legacy } = SCREENSHOT_SCAN
    respondWith(legacy)
    await expect(uploadReceipt(file())).resolves.toMatchObject({ is_receipt: true })
  })
})

describe('the pending put-away record keeps the verdict', () => {
  it('marks a non-receipt scan and survives a reload', () => {
    savePendingPutAway(pendingFromScan(SCREENSHOT_SCAN))
    expect(readPendingPutAway()?.notReceipt).toBe(true)
    expect(parsePendingPutAway(window.localStorage.getItem(PENDING_PUTAWAY_KEY))?.notReceipt).toBe(
      true,
    )
  })

  it('does not mark a receipt, or a scan with no verdict', () => {
    expect(pendingFromScan(RECEIPT_SCAN).notReceipt).toBeFalsy()
    const { is_receipt: _omit, ...legacy } = SCREENSHOT_SCAN
    expect(pendingFromScan(legacy).notReceipt).toBeFalsy()
  })
})

describe('ReviewSurface when the image is not a receipt', () => {
  const noop = () => {}

  it('says so, with Try another photo first and Use it anyway second', () => {
    render(
      <ReviewSurface
        readyToAdd={[stamped()]}
        needsReview={[]}
        skipped={[]}
        notReceipt
        onTryAnother={noop}
        onUseAnyway={noop}
        onChange={noop}
      />,
    )
    expect(screen.getByText("This doesn't look like a receipt")).toBeInTheDocument()
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons.indexOf('Try another photo')).toBeGreaterThanOrEqual(0)
    expect(buttons.indexOf('Try another photo')).toBeLessThan(buttons.indexOf('Use it anyway'))
    // What it read is not listed as going in until the user chooses to use it.
    expect(screen.queryByText(/Going in/)).not.toBeInTheDocument()
    expect(screen.queryByText('Fresh bread')).not.toBeInTheDocument()
  })

  it('wires the two buttons to their handlers', () => {
    const onTryAnother = jest.fn()
    const onUseAnyway = jest.fn()
    render(
      <ReviewSurface
        readyToAdd={[stamped()]}
        needsReview={[]}
        skipped={[]}
        notReceipt
        onTryAnother={onTryAnother}
        onUseAnyway={onUseAnyway}
        onChange={noop}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Use it anyway' }))
    expect(onUseAnyway).toHaveBeenCalledTimes(1)
    expect(onTryAnother).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Try another photo' }))
    expect(onTryAnother).toHaveBeenCalledTimes(1)
  })

  it('shows the normal tiers for a receipt', () => {
    render(
      <ReviewSurface readyToAdd={[stamped()]} needsReview={[]} skipped={[]} onChange={noop} />,
    )
    expect(screen.queryByText("This doesn't look like a receipt")).not.toBeInTheDocument()
    expect(screen.getByText(/Going in/)).toBeInTheDocument()
  })
})

describe('put-away sheet with a non-receipt scan', () => {
  function Harness({
    onClose = jest.fn(),
    onTryAnother,
  }: {
    onClose?: () => void
    onTryAnother?: () => void
  }) {
    const record = usePendingPutAway()
    return (
      <PutAwaySheet
        open
        record={record}
        onClose={onClose}
        onPutAway={jest.fn()}
        onTryAnother={onTryAnother}
      />
    )
  }

  function renderSheet(scan: ScanResult, props: React.ComponentProps<typeof Harness> = {}) {
    savePendingPutAway(pendingFromScan(scan))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <Harness {...props} />
      </QueryClientProvider>,
    )
  }

  it('warns and keeps the put-away key off, writing nothing', () => {
    renderSheet(SCREENSHOT_SCAN)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText("This doesn't look like a receipt")).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /^Put away \d/ })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Nothing to put away' })).toBeDisabled()
    expect(mockBulkAdd).not.toHaveBeenCalled()
  })

  it('Use it anyway reveals the items and turns the key on; still nothing written', () => {
    renderSheet(SCREENSHOT_SCAN)
    fireEvent.click(screen.getByRole('button', { name: 'Use it anyway' }))
    expect(screen.queryByText("This doesn't look like a receipt")).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Put away 1 item' })).toBeEnabled()
    expect(screen.getByText('Fresh bread')).toBeInTheDocument()
    expect(readPendingPutAway()?.notReceipt).toBeFalsy()
    expect(mockBulkAdd).not.toHaveBeenCalled()
  })

  it('Try another photo drops the scan and hands over to the host', () => {
    const onTryAnother = jest.fn()
    const onClose = jest.fn()
    renderSheet(SCREENSHOT_SCAN, { onTryAnother, onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Try another photo' }))
    expect(readPendingPutAway()).toBeNull()
    expect(onTryAnother).toHaveBeenCalledTimes(1)
    expect(mockBulkAdd).not.toHaveBeenCalled()
  })

  it('Try another photo with no host handler just closes', () => {
    const onClose = jest.fn()
    renderSheet(SCREENSHOT_SCAN, { onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Try another photo' }))
    expect(readPendingPutAway()).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a receipt is untouched: no warning, key on', () => {
    renderSheet(RECEIPT_SCAN)
    expect(screen.queryByText("This doesn't look like a receipt")).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Put away 1 item' })).toBeEnabled()
    clearPendingPutAway()
  })
})
